const SEGMENTS = 10;
const fmtRate = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : (b / 1e3).toFixed(0) + ' kB/s');
const fmtUptime = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}D ${h}H` : `${h}H ${m}M`; };
const LABELS = {
  'night-cron': { cpu: 'CPU', mem: 'MEM', bat: 'PWR', net: 'NET' },
  glass: { cpu: 'CPU', mem: 'Memory', bat: 'Battery', net: 'Network' },
};

export function mount(ctx) {
  const labels = () => LABELS[ctx.theme.name] || LABELS.glass;
  function build() {
    ctx.root.innerHTML = `<div class="sys"><div class="grid">
      ${['cpu', 'mem', 'bat', 'net'].map((k) => `<div class="m" data-k="${k}">
        <div class="l"><span>${labels()[k]}</span><span class="x"></span></div>
        <div class="v">–</div>
        <div class="ws-seg">${'<i></i>'.repeat(SEGMENTS)}</div></div>`).join('')}
      </div><div class="ws-micro"><i class="bars"></i><span class="grow"></span></div></div>`;
    for (const k in last) delete last[k];
  }

  // Each metric repaints only when its visible text or segment count changed.
  const last = {};
  function set(k, value, pct, extra = '', level = 'on') {
    const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * SEGMENTS);
    const key = `${value}|${extra}|${n}|${level}`;
    if (last[k] === key) return;
    last[k] = key;
    const el = ctx.root.querySelector(`[data-k=${k}]`);
    el.querySelector('.v').textContent = value;
    el.querySelector('.x').textContent = extra;
    el.querySelectorAll('.ws-seg i').forEach((seg, i) => { seg.className = i < n ? level : ''; });
  }
  const levelFor = (pct, warnAt, hotAt) => (pct >= hotAt ? 'hot' : pct >= warnAt ? 'warn' : 'on');

  async function tick() {
    let s;
    try { s = await ctx.host.stats(); } catch (e) { ctx.log('stats failed', String(e)); return; }
    set('cpu', s.cpu.toFixed(0) + '%', s.cpu, s.temp ? s.temp.toFixed(0) + '°' : '', levelFor(s.cpu, 70, 90));
    set('mem', s.mem.percent.toFixed(0) + '%', s.mem.percent, (s.mem.used / 2 ** 30).toFixed(1) + 'G', levelFor(s.mem.percent, 80, 92));
    if (s.battery) {
      const p = s.battery.percent;
      set('bat', p + '%', p, s.battery.status === 'Charging' ? '⚡' : '', p <= 10 ? 'hot' : p <= 20 ? 'warn' : 'on');
    } else set('bat', 'AC', 100);
    set('net', fmtRate(s.net.rx), Math.min(100, (s.net.rx / 5e6) * 100), '↑' + fmtRate(s.net.tx));
    const micro = `LOAD ${s.load[0].toFixed(2)} · UP ${fmtUptime(s.uptime)} · DISK ${s.disk.percent.toFixed(0)}%`;
    const g = ctx.root.querySelector('.ws-micro .grow');
    if (g.textContent !== micro) g.textContent = micro;
  }

  build();
  tick();
  ctx.every(2000, tick);
  ctx.on('theme', () => { build(); tick(); });
}
