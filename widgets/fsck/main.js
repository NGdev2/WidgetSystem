// fsck: the system's repair daemon. It sleeps on its dock (this widget), wakes on a cron schedule
// or when a ticket is filed, and fixes what other widgets break: torn full-screen panels, cracks
// left after fights, lost objects, crashed widgets. Between jobs it patrols, checks system health
// and widget alignment. Everything it touches is cosmetic: it works on /dev/desk, never on files.
import { W, H, drawFsck } from './src/sprite.js';
import { line } from './src/lines.js';

const G = 1500;
const ABORT = Symbol('abort');
const PERIOD = { rare: 45 * 60e3, normal: 15 * 60e3, busy: 5 * 60e3 };
const PRIORITY = { tear: 0, error: 1, crack: 2, orphan: 3 };
const dayKey = (d = new Date()) => d.toLocaleDateString('sv');
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const inPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function mount(ctx) {
  let alive = true;
  const T = ctx.desktop.tickets;

  // ---------------------------------------------------------------- persistent stats (one fsck)
  const stats = Object.assign({ fixed: {}, lost: [], log: [], lastReport: '', lastExit: 0, emptyPatrols: 0, errors: 0 }, ctx.shared.get('stats', {}));
  const save = () => ctx.shared.set('stats', stats);
  const logLine = (msg) => { stats.log.push({ t: Date.now(), msg }); stats.log = stats.log.slice(-30); save(); };

  // ---------------------------------------------------------------- dock (the widget itself)
  ctx.root.innerHTML = `<div class="dock">
    <div class="row status"><i class="led"></i><span class="st"></span></div>
    <div class="row"><span>NEXT RUN</span><b class="next"></b></div>
    <div class="row"><span>LAST EXIT</span><b class="exit"></b></div>
    <div class="row"><span>FIXED TODAY</span><b class="fixed"></b></div>
    <div class="row link" title="Show lost+found"><span>LOST+FOUND</span><b class="lost"></b></div>
    <div class="row"><span>OPEN TICKETS</span><b class="open"></b></div>
    <div class="foot">cosmetic daemon · touches no files</div>
  </div>`;
  const $ = (s) => ctx.root.querySelector(s);
  $('.link').onclick = () => say(stats.lost.length ? 'lost+found: ' + stats.lost.slice(0, 4).map((l) => l.label).join(', ') : 'lost+found is empty. Suspicious.', { force: true, duration: 5000 });

  // ---------------------------------------------------------------- sprite
  const el = ctx.overlay.create({ interactive: true, className: 'fsck', actor: { role: 'repair', name: 'fsck', kind: 'daemon' } });
  el.innerHTML = '<canvas></canvas>';
  const cv = el.querySelector('canvas');
  const dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = W * dpr; cv.height = (H + 4) * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 4 + 'px';
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);

  const look = { face: 'sleep', led: 'blue', stat: 'S', arm: 'down', wheel: 0, progress: 0, squish: 1, pad: false, flip: false };
  let drawnKey = '';
  const skin = () => (ctx.settings.look === 'auto' ? (ctx.theme.name === 'night-cron' ? 'neon' : 'classic') : ctx.settings.look);
  function draw() {
    const s = { ...look, skin: skin() };
    const key = JSON.stringify(s);
    if (key !== drawnKey) { drawnKey = key; drawFsck(g, s); }
  }
  const setLook = (p) => { Object.assign(look, p); draw(); };

  // ---------------------------------------------------------------- position & physics
  const me = { x: 0, y: 0, vx: 0, vy: 0, air: false, layer: 'back', target: null };
  let placed = '';
  function place() {
    const t = `translate(${Math.round(me.x - W / 2)}px, ${Math.round(me.y - H)}px)`;
    if (t !== placed) { el.style.transform = t; placed = t; }
  }
  const clampX = (x) => Math.max(W / 2, Math.min(ctx.desktop.size().w - W / 2, x));
  function surfaces(layer) {
    const sheet = ctx.desktop.sheet();
    if (layer === 'front' && sheet) return sheet.tears.filter((t) => t.ledge?.w > 24).map((t) => t.ledge);
    return ctx.desktop.widgets().filter((w) => !w.expanded).map((w) => ({ x: w.rect.x, y: w.rect.y, w: w.rect.w }));
  }
  function supportY(x, y, layer) {
    let best = ctx.desktop.size().h - 2;
    for (const p of surfaces(layer)) if (x > p.x + 6 && x < p.x + p.w - 6 && p.y >= y - 3 && p.y < best) best = p.y;
    return best;
  }

  let lowPower = false, mochiNear = false;
  let urgent = false;
  const speed = () => 70 * (lowPower ? 0.5 : 1) * (mochiNear ? 0.6 : 1) * (urgent ? 2 : 1);

  // The animation loop runs only while fsck rolls or falls.
  let stopLoop = null, pending = null, carried = false;
  const loopOn = () => { if (!stopLoop) stopLoop = ctx.raf(step, { fps: 30 }); };
  function step(dt) {
    if (carried) return;
    if (me.air) {
      me.vy += G * dt;
      const py = me.y;
      me.y += me.vy * dt;
      me.x = clampX(me.x + me.vx * dt);
      const s = supportY(me.x, py, me.layer);
      if (me.vy > 0 && me.y >= s) { const v = me.vy; me.y = s; me.vy = me.vx = 0; me.air = false; landed(v); }
    } else if (me.target != null) {
      const d = me.target - me.x, v = speed() * dt;
      if (Math.abs(d) <= v) {
        me.x = me.target; me.target = null;
        const p = pending; pending = null; p?.res();
      } else {
        me.x += Math.sign(d) * v;
        setLook({ flip: d < 0, wheel: Math.round(((look.wheel + v / 44) % 1) * 12) / 12 });
      }
      if (supportY(me.x, me.y, me.layer) > me.y + 2) { me.air = true; me.vy = 0; }
    }
    place();
    if (!me.air && me.target == null) { stopLoop?.(); stopLoop = null; }
  }

  // ---------------------------------------------------------------- abortable jobs
  let token = 0;
  function abortJob() {
    token++;
    me.target = null;
    const p = pending; pending = null; p?.rej(ABORT);
  }
  const wait = (ms) => { const my = token; return new Promise((res, rej) => ctx.after(ms, () => (alive && my === token ? res() : rej(ABORT)))); };
  function rollTo(x) {
    x = clampX(x);
    if (Math.abs(x - me.x) < 2) return Promise.resolve();
    return new Promise((res, rej) => { pending = { res, rej }; me.target = x; loopOn(); });
  }
  function crt(kind) {
    el.classList.remove('crt-on', 'crt-off');
    void el.offsetWidth;
    el.classList.add('crt-' + kind);
    return wait(kind === 'off' ? 350 : 420);
  }
  async function hopTo(x, y, layer = me.layer, opts = {}) {
    await crt('off');
    Object.assign(me, { x: clampX(x), y, layer, air: false, target: null });
    el.setLayer(layer);
    el.setActorState({ layer });
    setLook({ pad: !!opts.pad });
    place();
    await crt('on');
  }
  // Roll when the target is close on the same surface, otherwise "reboot" over there.
  async function go(x, y, layer = 'back', opts = {}) {
    if (layer === me.layer && !opts.pad && !look.pad && Math.abs(y - me.y) < 4 && Math.abs(x - me.x) < 600) return rollTo(x);
    return hopTo(x, y, layer, opts);
  }

  // ---------------------------------------------------------------- speech (rate limited)
  let lastSay = 0, sayTimes = [];
  function say(text, opts = {}) {
    if (!text || (!ctx.settings.talk && !opts.force)) return;
    const now = Date.now();
    sayTimes = sayTimes.filter((t) => now - t < 60000);
    if (!opts.force && (now - lastSay < (opts.rl ? 20000 : 4000) || sayTimes.length >= 6)) return;
    lastSay = now; sayTimes.push(now);
    ctx.say(text, { anchor: el, channel: 'fsck', duration: opts.duration });
  }

  // ---------------------------------------------------------------- effects (one-shot overlays)
  function fx(layer, className, rect, html = '', ms = 1200) {
    const e = ctx.overlay.create({ layer, className, html });
    Object.assign(e.style, { transform: `translate(${Math.round(rect.x)}px, ${Math.round(rect.y)}px)`, width: Math.round(rect.w) + 'px', height: Math.round(rect.h) + 'px' });
    if (ms) ctx.after(ms, () => e.remove());
    return e;
  }
  const scan = (r, layer) => { fx(layer, 'fsck-scan', r, '', 850); return wait(850); };
  const stamp = (r, layer) => fx(layer, 'fsck-stamp', { x: r.x + r.w / 2 - 46, y: r.y + r.h / 2 - 16, w: 92, h: 32 }, 'EXIT 0', 1300);
  function patch(r, layer) {
    const e = fx(layer, 'fsck-patch', { x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }, '', 0);
    const w = r.w + 12, h = r.h + 12;
    const tape = [0.25, 0.55, 0.8].map((k) => `<rect class="tape" x="${-w * 0.1}" y="${h * k - 5}" width="${w * 1.2}" height="10" transform="rotate(-18 ${w / 2} ${h * k})"/>`).join('');
    const stitches = Array.from({ length: 7 }, (_, i) => { const x = (w / 8) * (i + 1); return `<path class="stitch" d="M${x - 4} ${h / 2 - 4}L${x + 4} ${h / 2 + 4}M${x + 4} ${h / 2 - 4}L${x - 4} ${h / 2 + 4}"/>`; }).join('');
    return {
      stage(s) { e.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="${s}">${tape}${s !== 'tape' ? stitches : ''}</svg>`; },
      remove() { e.remove(); },
    };
  }

  // ---------------------------------------------------------------- dock rendering
  let awake = false, sessionOn = false, stopped = false, cancelRun = null, nextRunAt = 0;
  const openTickets = () => T.list().filter(handles);
  function renderDock() {
    const fmt = (t) => new Date(t).toTimeString().slice(0, 5);
    const status = stopped ? 'stopped (SIGSTOP)' : awake ? 'active (running)' : 'active (sleeping)';
    const set = (sel, v) => { const n = $(sel); if (n.textContent !== String(v)) n.textContent = v; };
    set('.st', `fsck.service · ${status}`);
    $('.led').className = 'led ' + (stopped ? 'off' : look.led);
    set('.next', stopped ? '—' : nextRunAt ? fmt(nextRunAt) : '—');
    set('.exit', String(stats.lastExit));
    set('.fixed', String(stats.fixed[dayKey()] || 0));
    set('.lost', String(stats.lost.length));
    set('.open', String(openTickets().length));
  }
  function setState(stat, led) { setLook({ stat, led: led || look.led }); el.setActorState({ state: { S: 'sleep', R: 'run', D: 'work', T: 'stopped', Z: 'crashed' }[stat] }); renderDock(); }

  // Home is on top of the dock; when the dock sits at the screen top, fsck stands beside it instead.
  function dockSpot() {
    const r = ctx.frame.getRect();
    if (r.y >= H + 8) return { x: r.x + r.w / 2, y: r.y };
    const right = r.x + r.w + W / 2 - 6 < ctx.desktop.size().w - W / 2;
    return { x: right ? r.x + r.w + W / 2 - 6 : r.x - W / 2 + 6, y: r.y + r.h };
  }
  function sitOnDock() {
    const d = dockSpot();
    Object.assign(me, { x: d.x, y: d.y, layer: 'back', air: false, target: null });
    el.classList.remove('crt-off');
    el.setLayer('back');
    setLook({ face: 'sleep', arm: 'down', pad: false, squish: 1, flip: false });
    place();
  }

  // ---------------------------------------------------------------- scheduling
  function schedule(ms = PERIOD[ctx.settings.patrol] || PERIOD.normal) {
    cancelRun?.();
    nextRunAt = Date.now() + ms;
    cancelRun = ctx.after(ms, () => startSession('cron'));
    renderDock();
  }
  function soon(reason, delay) {
    if (sessionOn || stopped) return;
    cancelRun?.();
    nextRunAt = Date.now() + delay;
    cancelRun = ctx.after(delay, () => startSession(reason));
    renderDock();
  }

  function handles(t) {
    if (t.claimedBy && t.claimedBy !== ctx.id) return false;
    if (t.kind === 'tear') return !!ctx.settings.autoTears;
    return t.kind in PRIORITY;
  }
  let preferId = null;
  function pickTicket() {
    const list = T.list().filter(handles);
    const pref = list.find((t) => t.id === preferId);
    preferId = null;
    if (pref) return pref;
    return list.sort((a, b) => b.sev - a.sev || PRIORITY[a.kind] - PRIORITY[b.kind] || a.born - b.born)[0] || null;
  }

  async function startSession(reason) {
    if (sessionOn || stopped || !alive || carried) return;
    sessionOn = true;
    let fixedAny = false;
    try {
      if (!awake) await boot();
      for (let round = 0; round < 12; round++) {
        const t = pickTicket();
        if (t) { if (await work(t)) fixedAny = true; continue; }
        if (pendingAlign) { await inspectAlignment(); continue; }
        if (reason === 'cron' && round === 0) { if (await patrol()) fixedAny = true; continue; }
        break;
      }
      if (reason === 'cron' && !fixedAny) { if (++stats.emptyPatrols >= 2) await sulk(); } else stats.emptyPatrols = 0;
      await shutdown();
    } catch (e) {
      if (e !== ABORT) ctx.log('fsck job failed', String(e?.stack || e));
    } finally {
      sessionOn = false;
      urgent = false;
      save();
      if (!stopped && !carried) schedule();
    }
  }

  async function boot() {
    awake = true;
    setState('R', lowPower ? 'amber' : 'green');
    setLook({ face: 'idle' });
    await crt('on');
    say(line('boot'), { force: true });
    await morningReport();
    await wait(700);
  }

  async function shutdown() {
    const d = dockSpot();
    if (me.layer !== 'back' || Math.abs(me.x - d.x) > 3 || Math.abs(me.y - d.y) > 3 || look.pad) await hopTo(d.x, d.y, 'back');
    if (Math.random() < 0.3) say(line('sleepy', { next: Math.round((PERIOD[ctx.settings.patrol] || PERIOD.normal) / 60000) + ' min' }), { rl: true });
    setLook({ face: 'sleep', arm: 'down', pad: false, squish: 1, flip: false });
    awake = false;
    setState('S', 'blue');
  }

  async function sulk() {
    setLook({ face: 'sad', arm: 'down' });
    say(line('sad'), { force: true });
    await wait(5000 + Math.random() * 4000);
  }

  async function morningReport() {
    const today = dayKey();
    if (stats.lastReport === today || new Date().getHours() < 5) return;
    stats.lastReport = today;
    const y = new Date(); y.setDate(y.getDate() - 1);
    let uptime = '?';
    try { const s = await ctx.host.stats(); uptime = s.uptime > 86400 ? Math.floor(s.uptime / 86400) + 'd' : Math.floor(s.uptime / 3600) + 'h'; } catch { /* stats unavailable */ }
    say(line('morning', { errors: stats.errors, fixed: stats.fixed[dayKey(y)] || 0, uptime }), { force: true, duration: 6000 });
    stats.errors = 0;
    await wait(1200);
  }

  async function finishFix(kind, label = '') {
    setLook({ face: 'done', arm: 'up', progress: 1 });
    setState('R', lowPower ? 'amber' : 'green');
    stats.fixed[dayKey()] = (stats.fixed[dayKey()] || 0) + 1;
    stats.lastExit = 0;
    logLine(`${kind}${label ? ' ' + label : ''}: EXIT 0`);
    if (kind !== 'orphan') say(line('done'), { rl: kind === 'crack' });
    renderDock();
    await wait(1000);
    setLook({ face: 'idle', arm: 'down' });
    return true;
  }

  // ---------------------------------------------------------------- jobs
  const current = (id) => T.list().find((t) => t.id === id);
  async function work(t) {
    urgent = t.sev === 3;
    if (t.kind === 'tear') return repairTear(t);
    if (t.kind === 'crack') return sealCrack(t);
    if (t.kind === 'orphan') return collectOrphan(t);
    if (t.kind === 'error') return doctor(t);
    return false;
  }

  async function repairTear(t0) {
    let t = current(t0.id);
    for (let i = 0; t?.busy && i < 10; i++) { say(line('occupied'), { rl: true }); await wait(1500); t = current(t0.id); }
    if (!t || !T.claim(t.id)) return false;
    const b = bbox(t.points);
    say(line('grumpy'), { rl: true });
    await hopTo(b.x - 22, Math.min(ctx.desktop.size().h - 2, b.y + b.h + 6), 'front', { pad: true });
    setState('D', 'amber');
    say(`e2fsck: hole ${Math.round(t.x)},${Math.round(t.y)} · ${(t.area / 1000).toFixed(1)}k px²`, { force: true, duration: 2600 });
    await scan(b, 'front');
    const p = patch(b, 'front');
    const steps = [['tape', 0.35, 'work'], ['stitch', 0.7, 'up'], ['restore', 1, 'work']];
    for (const [stage, prog, arm] of steps) {
      p.stage(stage);
      setLook({ face: 'work', arm, progress: prog - 0.2 });
      if (stage === 'stitch') say(line('working'), { rl: true });
      await wait(stage === 'restore' ? 700 : 900);
      if (!T.progress(t.id, prog)) { p.remove(); setLook({ face: 'idle' }); return false; }
    }
    p.remove();
    stamp(b, 'front');
    return finishFix('tear');
  }

  async function sealCrack(t) {
    if (!T.claim(t.id)) return false;
    say(line('crack'), { rl: true });
    const r = t.r || 24;
    await hopTo(t.x - r - 18, t.y + r + 20, 'back', { pad: true });
    setState('D', 'amber');
    const p = patch({ x: t.x - r, y: t.y - r, w: 2 * r, h: 2 * r }, 'back');
    for (const [stage, prog, arm] of [['tape', 0.35, 'work'], ['stitch', 0.7, 'up'], ['restore', 1, 'work']]) {
      p.stage(stage);
      setLook({ face: 'work', arm, progress: prog - 0.2 });
      await wait(700);
      if (!T.progress(t.id, prog)) { p.remove(); return false; }
    }
    p.remove();
    return finishFix('crack');
  }

  async function collectOrphan(t) {
    if (!T.claim(t.id)) return false;
    await go(t.x, supportY(t.x, t.y - 2, 'back'), 'back');
    setLook({ arm: 'up', face: 'look' });
    await wait(450);
    T.resolve(t.id, { x: me.x, y: me.y - H / 2 });
    stats.lost.unshift({ label: t.label || 'unnamed object', at: Date.now() });
    stats.lost = stats.lost.slice(0, 50);
    say(line('orphan', { label: t.label || 'object' }), { rl: true });
    return finishFix('orphan', t.label);
  }

  async function doctor(t) {
    const target = ctx.desktop.widgets().find((w) => w.id === t.target);
    if (!T.claim(t.id)) return false;
    stats.errors++;
    const r = target?.rect || { x: t.x - 40, y: t.y, w: 80 };
    await go(r.x + r.w - 30, r.y, 'back');
    setState('D', 'amber');
    setLook({ face: 'strain', arm: 'up' });
    say(line('error', { label: t.label }), { force: true, duration: 8000 });
    T.progress(t.id, 0.3);
    const choice = target ? await askRestart() : 'none';
    if (choice === 'restart') {
      ctx.desktop.restart(target.id);
      T.progress(t.id, 1);
      say(line('restarted'), { force: true });
      return finishFix('error', target.widget);
    }
    T.resolve(t.id, { exit: 1 });
    stats.lastExit = 1;
    say(line('declined'), { force: true });
    logLine(`error ${t.label}: EXIT 1 (restart declined)`);
    renderDock();
    setLook({ face: 'sad' });
    await wait(1500);
    return false;
  }
  function askRestart() {
    const btn = ctx.overlay.create({ interactive: true, className: 'fsck-ask', layer: me.layer,
      html: '<button class="ws-btn primary">Restart</button><button class="ws-btn">Leave it</button>' });
    btn.style.transform = `translate(${Math.round(me.x - 70)}px, ${Math.round(me.y - H - 74)}px)`;
    const my = token;
    return new Promise((res, rej) => {
      const done = (v) => { btn.remove(); my === token ? res(v) : rej(ABORT); };
      const [yes, no] = btn.querySelectorAll('button');
      yes.onclick = () => done('restart');
      no.onclick = () => done('leave');
      ctx.after(18000, () => btn.isConnected && done('timeout'));
    });
  }

  // ---------------------------------------------------------------- patrol & health rounds
  async function patrol() {
    const ws = ctx.desktop.widgets().filter((w) => !w.expanded && w.id !== ctx.id).sort(() => Math.random() - 0.5).slice(0, 3);
    for (const w of ws) {
      await go(w.rect.x + w.rect.w / 2, w.rect.y, 'back');
      await scan({ x: w.rect.x, y: w.rect.y, w: w.rect.w, h: Math.min(w.rect.h, 160) }, 'back');
      say(line('patrol', { name: w.widget }), { rl: true });
      if (Math.random() < 0.25) say(line('proud'), { rl: true });
    }
    return (await health()) > 0;
  }

  let hotCount = 0;
  async function health() {
    if (!ctx.settings.health) return 0;
    let s;
    try { s = await ctx.host.stats(); } catch { return 0; }
    let issues = 0;
    lowPower = !!s.battery && s.battery.status !== 'Charging' && s.battery.percent < 20;
    if (lowPower) { setLook({ led: 'amber' }); say(line('battery', { bat: s.battery.percent }), { rl: true }); issues++; }
    hotCount = s.cpu > 85 ? hotCount + 1 : 0;
    if (hotCount >= 2 || s.cpu > 95) {
      const sys = ctx.desktop.widgets().find((w) => w.widget === 'sysmon' && !w.expanded);
      if (sys) await go(sys.rect.x + sys.rect.w - 24, sys.rect.y, 'back');
      say(line('cpuHot', { load: s.load[0].toFixed(2), cpu: Math.round(s.cpu) }), { force: true });
      for (let i = 0; i < 6; i++) {
        setLook({ arm: i % 2 ? 'fan' : 'up', face: 'strain' });
        ctx.particles.burst({ x: me.x - 30, y: me.y - H + 40, count: 3, colors: ['rgba(200,230,255,.8)'], shapes: ['circle'], speed: 120, gravity: -40, life: 0.6, size: 3, spread: 30, angle: 180, layer: me.layer });
        await wait(220);
      }
      issues++;
    }
    if (s.temp > 80) {
      setLook({ face: 'strain' });
      ctx.particles.burst({ x: me.x + 6, y: me.y - H + 26, count: 4, colors: ['#7fd4ff'], shapes: ['circle'], speed: 60, gravity: 300, life: 0.8, size: 4, layer: me.layer });
      say(line('heat', { temp: Math.round(s.temp) }), { rl: true });
      issues++;
    }
    if (s.mem.percent > 90) {
      setLook({ squish: 0.86 });
      say(line('memFull', { mem: Math.round(s.mem.percent) }), { rl: true });
      await wait(1500);
      setLook({ squish: 1 });
      issues++;
    }
    setLook({ face: 'idle', arm: 'down' });
    return issues;
  }

  // ---------------------------------------------------------------- alignment inspector
  let prevRects = new Map(ctx.desktop.widgets().map((w) => [w.id, { ...w.rect }]));
  let pendingAlign = null;
  function alignment(w) {
    const r = w.rect;
    let best = null;
    for (const o of ctx.desktop.widgets()) {
      if (o.id === w.id || o.expanded) continue;
      const q = o.rect;
      for (const [a, b] of [[r.x, q.x], [r.x + r.w, q.x + q.w], [r.y, q.y], [r.y + r.h, q.y + q.h], [r.x, q.x + q.w], [r.x + r.w, q.x]]) {
        const d = Math.abs(a - b);
        if (d <= 24 && (!best || d < best.d)) best = { d, other: o.widget };
      }
    }
    return best;
  }
  async function inspectAlignment() {
    const id = pendingAlign;
    pendingAlign = null;
    const w = ctx.desktop.widgets().find((x) => x.id === id);
    if (!w || w.expanded) return;
    await go(w.rect.x + w.rect.w / 2, w.rect.y, 'back');
    fx('back', 'fsck-level', { x: w.rect.x + w.rect.w / 2 - 40, y: w.rect.y - 8, w: 80, h: 8 }, '<i></i>', 1700);
    setLook({ face: 'look', arm: 'up' });
    await wait(900);
    const a = alignment(w);
    if (!a) say(line('free', { name: w.widget }), { rl: true });
    else if (a.d <= 4) say(line('aligned', { name: w.widget, other: a.other }), { force: true });
    else say(line('misaligned', { name: w.widget, px: a.d }), { force: true });
    await wait(900);
    setLook({ face: 'idle', arm: 'down' });
  }

  // ---------------------------------------------------------------- user interaction
  let down = null, clicks = [];
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, moved: false };
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      down.moved = true;
      carried = true;
      if (sessionOn) say(line('interrupted'), { force: true });
      abortJob();
      el.classList.remove('crt-on', 'crt-off');   // an interrupted hop must not leave it switched off
      setLook({ face: 'dizzy', pad: false });
    }
    if (carried) {
      me.vx = Math.max(-500, Math.min(500, (e.clientX - me.x) * 10));
      me.x = clampX(e.clientX);
      me.y = e.clientY + H * 0.6;
      place();
    }
  });
  el.addEventListener('pointerup', () => {
    if (carried) {
      carried = false;
      awake = true;
      me.air = true;
      me.vy = 0;
      dropAt = { x: me.x, y: me.y - H / 2 };
      loopOn();
    } else if (down) onClick();
    down = null;
  });
  el.addEventListener('dblclick', () => say(statusLine(), { force: true, duration: 5000 }));
  let dropAt = null;

  function onClick() {
    const now = Date.now();
    clicks = clicks.filter((t) => now - t < 3000);
    clicks.push(now);
    if (clicks.length >= 5) return say(line('spam'), { force: true });
    if (!awake && !sessionOn) return startSession('poke');
    say(line('click'), { force: true, duration: 1800 });
  }
  function statusLine() {
    const up = Math.round(performance.now() / 60000);
    return `uptime ${up}m · fixed today ${stats.fixed[dayKey()] || 0} · lost+found ${stats.lost.length} · last exit ${stats.lastExit}`;
  }

  function landed(v) {
    if (v > 900) {
      setLook({ face: 'crash' });
      setState('Z', 'red');
      say(line('thrown'), { force: true });
      ctx.after(1200, resume);
    } else resume();
  }
  // After being carried: dropping fsck onto a tear makes it repair that tear first.
  function resume() {
    const sheet = ctx.desktop.sheet();
    const hit = dropAt && sheet?.tears.find((t) => inPoly(dropAt.x, dropAt.y, t.points));
    dropAt = null;
    if (hit) preferId = hit.id;
    setLook({ face: 'idle' });
    startSession('resume');
  }

  // ---------------------------------------------------------------- events
  ctx.on('ticket', ({ type, ticket }) => {
    renderDock();
    if (type !== 'open' || stopped || !handles(ticket)) return;
    const delay = ticket.kind === 'tear' ? (Number(ctx.settings.repairDelay) || 0) * 1000 + 300 : 2500;
    soon('ticket', delay);
  });
  ctx.on('layout', (list) => {
    const moved = list.find((w) => {
      const p = prevRects.get(w.id);
      return p && w.id !== ctx.id && !w.expanded && (p.x !== w.rect.x || p.y !== w.rect.y);
    });
    prevRects = new Map(list.map((w) => [w.id, { ...w.rect }]));
    if (moved && ctx.settings.align) { pendingAlign = moved.id; soon('align', 1500); }
    if (!awake && !sessionOn && !carried) sitOnDock();
  });
  // Mochi likes to "help", which slows fsck down.
  ctx.every(3000, () => {
    if (!awake) return;
    const near = ctx.desktop.actors().some((a) => a.role === 'pet' && a.layer === me.layer && Math.abs(a.rect.x + a.rect.w / 2 - me.x) < 70);
    if (near && !mochiNear) say(line('mochi'), { rl: true });
    mochiNear = near;
  });
  ctx.on('settings', () => { draw(); if (!sessionOn) schedule(); });
  ctx.on('theme', draw);

  // ---------------------------------------------------------------- menu
  ctx.menu.add({ icon: '▶', label: 'Run fsck now', action: () => { cancelRun?.(); startSession('cron'); } });
  ctx.menu.add({ icon: '≡', label: 'Show log', action: () => say(stats.log.slice(-4).map((l) => l.msg).join(' · ') || 'Log is empty.', { force: true, duration: 6000 }) });
  ctx.menu.add({ icon: '⏸', label: 'SIGSTOP / SIGCONT', action: () => {
    stopped = !stopped;
    if (stopped) { abortJob(); cancelRun?.(); setLook({ face: 'sleep', led: 'off' }); setState('T'); say('SIGSTOP received. Frozen.', { force: true }); }
    else { setState('S', 'blue'); say('SIGCONT. Resuming schedule.', { force: true }); schedule(); }
  } });

  // ---------------------------------------------------------------- start
  sitOnDock();
  setState('S', 'blue');
  draw();
  schedule(45000 + Math.random() * 30000);   // first check shortly after login
  return () => { alive = false; abortJob(); };
}
