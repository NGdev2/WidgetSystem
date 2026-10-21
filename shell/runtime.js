// WidgetSystem web runtime: places widget frames, builds each widget's ctx API,
// handles edit mode / menus / glass / effects, and tells the host where input is needed.
import { call, listen, log, HOST } from './lib/bridge.js';
import { Particles } from './lib/particles.js';
import { blurredWallpaper } from './lib/glass.js';
import * as ui from './lib/ui.js';

const $ = (s) => document.querySelector(s);
const desk = $('#ws-desk');
const overlayLayer = $('#ws-overlay');
const bubbleLayer = $('#ws-bubbles');
const particles = new Particles($('#ws-particles'));

const S = {
  widgets: new Map(),     // widget id -> manifest
  instances: new Map(),   // instance id -> Instance
  theme: { dark: false },
  config: {},
  host: null,             // {origin, monitor, size} when running in the desktop host
  edit: false,
  hidden: false,
  glassUrl: null,
  pointer: { x: -1, y: -1 },
  pointerTracking: false,
};
const GRID = 8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = (w) => `${w}-${Math.random().toString(36).slice(2, 7)}`;

if (HOST === 'browser') document.body.classList.add('ws-browser');

// ---------------------------------------------------------------- storage
const stores = new Map(); // scope -> {data, timer}
async function loadStore(scope) {
  if (!stores.has(scope)) stores.set(scope, { data: await call('storage.get', { scope }).catch(() => ({})), timer: 0 });
  return stores.get(scope);
}
function storageApi(scope) {
  const st = stores.get(scope);
  const save = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => call('storage.set', { scope, data: st.data }), 400);
  };
  return {
    get: (k, d) => (k in st.data ? st.data[k] : d),
    set: (k, v) => { st.data[k] = v; save(); return v; },
    delete: (k) => { delete st.data[k]; save(); },
    all: () => ({ ...st.data }),
  };
}

// ---------------------------------------------------------------- layout persistence
let saveTimer = 0, layoutTimer = 0;
function saveLayout() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const instances = [...S.instances.values()].map((i) => i.cfg);
    call('layout.save', { layout: { version: 1, instances } });
  }, 300);
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => broadcast('layout', snapshot()), 60);
  scheduleRegion();
}
const snapshot = () => [...S.instances.values()].map((i) => ({
  id: i.id, widget: i.manifest.id, rect: i.rect(), expanded: !!i.cfg.expanded,
}));
function broadcast(name, payload) { for (const i of S.instances.values()) i.emit(name, payload); }

// ---------------------------------------------------------------- geometry helpers
function geometry() {
  const h = S.host;
  return h ? { ox: h.origin.x - h.monitor.x, oy: h.origin.y - h.monitor.y, mw: h.monitor.w, mh: h.monitor.h }
    : { ox: 0, oy: 0, mw: innerWidth, mh: innerHeight };
}

function styleLinks(manifest) {
  const links = ['/shell/kit.css', ...manifest.styles.map((s) => `/w/${manifest.id}/${manifest._version}/${s}`)];
  return links.map((href) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.loaded = new Promise((res) => { l.onload = res; l.onerror = res; setTimeout(res, 1500); });
    return l;
  });
}

const ICONS = {
  expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5 9 7M2.5 13.5 7 9"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M13 7H9V3M3 9h4v4M9 7l4.5-4.5M7 9l-4.5 4.5"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12.5" cy="8" r="1.5"/></svg>',
};

// ---------------------------------------------------------------- Instance
class Instance {
  constructor(cfg) {
    this.cfg = cfg;
    this.id = cfg.id;
    this.manifest = S.widgets.get(cfg.widget);
    this.listeners = new Map();
    this.disposers = [];
    this.menuItems = [];
    this.interactive = new Set();
    this.build();
  }

  get style() { return { ...this.manifest.frame, ...(this.cfg.style || {}) }; }
  get settings() {
    const defs = Object.fromEntries((this.manifest.settings || []).map((s) => [s.key, s.default]));
    return { ...defs, ...(this.cfg.settings || {}) };
  }
  rect() {
    return this.cfg.expanded ? { x: 0, y: 0, w: innerWidth, h: innerHeight }
      : { x: this.cfg.x, y: this.cfg.y, w: this.cfg.w, h: this.cfg.h };
  }

  build() {
    const el = (this.el = document.createElement('div'));
    el.className = 'ws-frame';
    el.dataset.id = this.id;
    el.innerHTML = `
      <div class="ws-bg"><div class="ws-bg-img"></div></div>
      <div class="ws-body">
        <div class="ws-titlebar"><span class="ws-title"></span></div>
        <div class="ws-content"></div>
      </div>
      <div class="ws-controls">
        <button class="ws-ctl" data-act="expand" title="Expand">${ICONS.expand}</button>
        <button class="ws-ctl" data-act="menu" title="Options">${ICONS.more}</button>
      </div>
      <div class="ws-resize"></div>
      <div class="ws-editcover"><button class="ws-edit-x" title="Remove">×</button><span class="ws-edit-name"></span></div>`;
    this.bgImg = el.querySelector('.ws-bg-img');
    this.titleEl = el.querySelector('.ws-title');
    el.querySelector('.ws-edit-name').textContent = this.manifest.name;
    el.querySelector('[data-act=expand]').onclick = () => this.toggleExpand();
    el.querySelector('[data-act=menu]').onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      frameMenu(this, r.left, r.bottom + 6);
    };
    el.querySelector('.ws-edit-x').onclick = (e) => { e.stopPropagation(); this.close(); };
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); frameMenu(this, e.clientX, e.clientY); });
    el.querySelector('.ws-titlebar').addEventListener('dblclick', () => this.toggleExpand());
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
    desk.append(el);
    this.applyStyle();
    this.applyRect();
  }

  applyStyle() {
    const s = this.style;
    const d = this.el.dataset;
    d.look = s.look;
    d.border = String(s.look !== 'clear' && !!s.border);
    d.shadow = String(s.look !== 'clear' && !!s.shadow);
    d.title = String(s.look !== 'clear' && !!s.showTitle);
    d.overflow = s.overflow === 'visible' ? 'visible' : 'hidden';
    d.resizable = String(this.manifest.size.resizable !== false);
    this.el.style.setProperty('--r', (this.cfg.expanded ? 0 : s.radius) + 'px');
    this.el.style.setProperty('--pad', s.padding + 'px');
    if (s.tint) this.el.style.setProperty('--tint', s.tint); else this.el.style.removeProperty('--tint');
    this.titleEl.textContent = s.title || this.manifest.name;
    this.el.querySelector('[data-act=expand]').style.display = this.manifest.expandable ? '' : 'none';
    this.el.querySelector('[data-act=expand]').innerHTML = this.cfg.expanded ? ICONS.collapse : ICONS.expand;
    this.applyGlass();
  }

  applyRect() {
    const r = this.rect();
    Object.assign(this.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    this.applyGlass();
  }

  applyGlass() {
    if (this.style.look !== 'glass' || !S.glassUrl) { this.bgImg.style.backgroundImage = ''; return; }
    const g = geometry();
    const r = this.rect();
    Object.assign(this.bgImg.style, {
      backgroundImage: `url("${S.glassUrl}")`,
      left: -(g.ox + r.x) + 'px', top: -(g.oy + r.y) + 'px', width: g.mw + 'px', height: g.mh + 'px',
    });
  }

  emit(name, payload) {
    for (const fn of this.listeners.get(name) || []) {
      try { fn(payload); } catch (e) { reportError(this, e); }
    }
  }

  // ---- lifecycle
  async mount() {
    const m = this.manifest;
    const old = this.el.querySelector('.ws-content');
    const content = old.cloneNode(false); // fresh element => fresh shadow root on remount
    old.replaceWith(content);
    this.contentEl = content;
    this.shadow = content.attachShadow({ mode: 'open' });
    const links = styleLinks(m);
    this.shadow.append(...links);
    this.root = document.createElement('div');
    this.root.className = 'ws-root';
    this.shadow.append(this.root);
    this.disposers = [];
    this.listeners = new Map();
    this.menuItems = [];
    this.interactive = new Set();
    this.mounted = true;

    const ro = new ResizeObserver(([e]) => this.emit('resize', { w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(content);
    this.disposers.push(() => ro.disconnect());

    try {
      await Promise.all([...links.map((l) => l.loaded), loadStore('i-' + this.id), loadStore('w-' + m.id)]);
      const mod = await import(`/w/${m.id}/${m._version}/${m.entry}`);
      const mountFn = mod.mount || mod.default?.mount || (typeof mod.default === 'function' ? mod.default : null);
      this.unmountFn = mod.unmount || mod.default?.unmount;
      if (!mountFn) throw new Error(`${m.entry} must export mount(ctx)`);
      this.ctx = makeCtx(this);
      const ret = await mountFn(this.ctx);
      if (typeof ret === 'function') this.disposers.push(ret);
    } catch (e) {
      this.showError(e);
    }
  }

  unmount() {
    if (!this.mounted) return;
    this.mounted = false;
    try { this.unmountFn?.(this.ctx); } catch (e) { reportError(this, e); }
    for (const d of this.disposers.reverse()) { try { d(); } catch (e) { reportError(this, e); } }
    this.disposers = [];
    this.overlayHost?.remove();
    this.overlayHost = null;
    this.bubble?.close();
    updatePointerTracking();
  }

  async remount() {
    this.unmount();
    this.manifest = S.widgets.get(this.cfg.widget) || this.manifest;
    this.applyStyle();
    await this.mount();
  }

  showError(e) {
    reportError(this, e);
    const box = document.createElement('div');
    box.className = 'ws-error';
    box.textContent = `${this.manifest.name} failed to load:\n${e?.stack || e}`;
    const btn = document.createElement('button');
    btn.textContent = 'Reload';
    btn.className = 'ws-btn';
    btn.onclick = () => this.remount();
    box.append(document.createElement('br'), btn);
    this.root.replaceChildren(box);
  }

  // ---- frame operations
  resize(w, h) {
    const s = this.manifest.size;
    this.cfg.w = Math.round(clamp(w, s.minW || 60, s.maxW || innerWidth));
    this.cfg.h = Math.round(clamp(h, s.minH || 40, s.maxH || innerHeight));
    this.applyRect();
    saveLayout();
  }

  moveTo(x, y) {
    this.cfg.x = Math.round(clamp(x, -this.cfg.w + 40, innerWidth - 40));
    this.cfg.y = Math.round(clamp(y, 0, innerHeight - 30));
    this.applyRect();
    this.emit('move', { x: this.cfg.x, y: this.cfg.y });
    saveLayout();
  }

  setExpanded(on) {
    if (on && !this.manifest.expandable) return;
    if (!!this.cfg.expanded === on) return;
    this.cfg.expanded = on;
    this.el.classList.add('ws-animate');
    this.el.classList.toggle('ws-expanded', on);
    this.applyStyle();
    this.applyRect();
    setTimeout(() => this.el.classList.remove('ws-animate'), 400);
    this.emit(on ? 'expand' : 'collapse');
    saveLayout();
  }
  toggleExpand() { this.setExpanded(!this.cfg.expanded); }

  setStyle(partial) {
    this.cfg.style = { ...(this.cfg.style || {}), ...partial };
    this.applyStyle();
    saveLayout();
  }

  setSettings(values) {
    this.cfg.settings = { ...(this.cfg.settings || {}), ...values };
    this.emit('settings', this.settings);
    saveLayout();
  }

  close() {
    this.unmount();
    this.el.classList.add('ws-closing');
    setTimeout(() => this.el.remove(), 300);
    S.instances.delete(this.id);
    call('storage.delete', { scope: 'i-' + this.id });
    stores.delete('i-' + this.id);
    saveLayout();
  }

  // ---- drag / resize
  onPointerDown(e) {
    if (e.button !== 0) return;
    const path = e.composedPath();
    const onResize = e.target.classList?.contains('ws-resize');
    if (this.cfg.expanded) return;
    const inTitle = path.some((n) => n.classList?.contains('ws-titlebar'));
    const onControl = path.some((n) => n.classList?.contains('ws-ctl') || n.classList?.contains('ws-edit-x'));
    const handle = path.some((n) => n.hasAttribute?.('data-ws-drag'));
    if (onControl) return;
    if (!(onResize || S.edit || inTitle || handle || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, ...this.cfg };
    const snap = (v) => (S.edit ? Math.round(v / GRID) * GRID : v);
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add('ws-dragging');
    const move = (ev) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (onResize) {
        const s = this.manifest.size;
        this.cfg.w = clamp(snap(start.w + dx), s.minW || 60, s.maxW || innerWidth);
        this.cfg.h = clamp(snap(start.h + dy), s.minH || 40, s.maxH || innerHeight);
      } else {
        this.cfg.x = clamp(snap(start.x + dx), -start.w + 40, innerWidth - 40);
        this.cfg.y = clamp(snap(start.y + dy), 0, innerHeight - 30);
      }
      this.applyRect();
    };
    const up = () => {
      this.el.removeEventListener('pointermove', move);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.el.classList.remove('ws-dragging');
      if (!onResize) this.emit('move', { x: this.cfg.x, y: this.cfg.y });
      saveLayout();
    };
    this.el.addEventListener('pointermove', move);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }
}

// ---------------------------------------------------------------- ctx (the widget API)
function makeCtx(inst) {
  const m = inst.manifest;
  const track = (fn) => { inst.disposers.push(fn); return fn; };
  const on = (name, fn) => {
    if (!inst.listeners.has(name)) inst.listeners.set(name, new Set());
    inst.listeners.get(name).add(fn);
    if (name === 'pointer') updatePointerTracking();
    return () => { inst.listeners.get(name)?.delete(fn); if (name === 'pointer') updatePointerTracking(); };
  };
  const hostCall = (method, params = {}) => call(method, { widget: m.id, ...params });

  const overlay = {
    get root() {
      if (!inst.overlayHost) {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;pointer-events:none';
        host.dataset.owner = inst.id;
        const sh = host.attachShadow({ mode: 'open' });
        const root = document.createElement('div');
        root.className = 'ws-root';
        root.style.cssText = 'position:absolute;inset:0;pointer-events:none';
        sh.append(...styleLinks(m), root);
        overlayLayer.append(host);
        inst.overlayHost = host;
        inst.overlayRoot = root;
      }
      return inst.overlayRoot;
    },
    create({ interactive = false, className = '', html = '' } = {}) {
      const el = document.createElement('div');
      el.className = className;
      el.style.cssText = `position:absolute;left:0;top:0;pointer-events:${interactive ? 'auto' : 'none'}`;
      el.innerHTML = html;
      overlay.root.append(el);
      if (interactive) inst.interactive.add(el);
      el.setInteractive = (on) => {
        el.style.pointerEvents = on ? 'auto' : 'none';
        if (on) inst.interactive.add(el); else inst.interactive.delete(el);
        scheduleRegion();
      };
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); frameMenu(inst, e.clientX, e.clientY); });
      return el;
    },
  };

  return {
    id: inst.id,
    widget: m,
    root: inst.root,
    shadow: inst.shadow,
    asset: (p) => `/w/${m.id}/${m._version}/${p}`,
    log: (...args) => {
      console.log(`[${m.id}]`, ...args);
      log('info', args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '), `${m.id}:${inst.id}`);
    },
    get settings() { return inst.settings; },
    setSetting: (k, v) => inst.setSettings({ [k]: v }),
    openSettings: () => openSettings(inst),
    storage: storageApi('i-' + inst.id),
    shared: storageApi('w-' + m.id),
    frame: {
      setTitle: (t) => inst.setStyle({ title: t }),
      showTitle: (b) => inst.setStyle({ showTitle: !!b }),
      setStyle: (p) => inst.setStyle(p),
      getStyle: () => ({ ...inst.style }),
      resize: (w, h) => inst.resize(w, h),
      moveTo: (x, y) => inst.moveTo(x, y),
      getRect: () => inst.rect(),
      expand: () => inst.setExpanded(true),
      collapse: () => inst.setExpanded(false),
      toggleExpand: () => inst.toggleExpand(),
      isExpanded: () => !!inst.cfg.expanded,
      close: () => inst.close(),
    },
    menu: {
      add(item) {
        inst.menuItems.push(item);
        return () => { inst.menuItems = inst.menuItems.filter((i) => i !== item); };
      },
    },
    on,
    every: (ms, fn) => { const t = setInterval(fn, ms); return track(() => clearInterval(t)); },
    after: (ms, fn) => { const t = setTimeout(fn, ms); return track(() => clearTimeout(t)); },
    raf(fn, { fps = 60 } = {}) {
      // Every changed frame recomposites the whole full-screen layer, so let widgets cap it.
      let id, last = performance.now(), alive = true;
      const minStep = 1000 / fps - 2;
      const loop = (t) => {
        if (!alive) return;
        if (t - last < minStep) { id = requestAnimationFrame(loop); return; }
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        if (!S.hidden) { try { fn(dt, t); } catch (e) { reportError(inst, e); alive = false; return; } }
        id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      return track(() => { alive = false; cancelAnimationFrame(id); });
    },
    get theme() { return { ...S.theme }; },
    say: (text, opts) => say(inst, text, opts),
    particles: {
      burst(opts = {}) {
        const r = inst.el.getBoundingClientRect();
        particles.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, ...opts });
      },
    },
    overlay,
    toWindow(x, y) { const r = inst.contentEl.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; },
    fromWindow(x, y) { const r = inst.contentEl.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; },
    desktop: { size: () => ({ w: innerWidth, h: innerHeight }), widgets: snapshot },
    pointer: () => ({ ...S.pointer }),
    send: (target, data) => deliver({ id: inst.id, widget: m.id }, target, data),
    host: {
      notify: (title, body = '') => hostCall('notify', { title, body }),
      stats: () => hostCall('stats'),
      open: (url) => hostCall('open', { url }),
      fetch: (url, opts = {}) => hostCall('fetch', { url, ...opts }),
      run: (cmd, opts = {}) => hostCall('run', { cmd, ...opts }),
      apps: () => hostCall('apps'),
      desktopItems: () => hostCall('desktopItems'),
      focus: () => hostCall('host.focus'),
    },
  };
}

function deliver(from, target, data) {
  for (const i of S.instances.values()) {
    if (i.id === from.id) continue;
    if (target === '*' || i.id === target || i.manifest.id === target) i.emit('message', { from, data });
  }
}

// ---------------------------------------------------------------- global pointer & keys
function updatePointerTracking() {
  const want = [...S.instances.values()].some((i) => i.mounted && i.listeners.get('pointer')?.size);
  if (want === S.pointerTracking) return;
  S.pointerTracking = want;
  if (HOST !== 'browser') call('host.pointer', { on: want }).catch(() => {});
}
function setPointer(x, y) {
  if (x === S.pointer.x && y === S.pointer.y) return;
  S.pointer = { x, y };
  if (S.pointerTracking) broadcast('pointer', { x, y });
}
window.__wsPointer = setPointer; // called by the desktop host (~30 Hz, works outside the input region)
addEventListener('pointermove', (e) => setPointer(e.clientX, e.clientY), true);

for (const type of ['keydown', 'keyup']) {
  addEventListener(type, (e) => {
    const t = e.composedPath()[0];
    const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    broadcast('key', { key: e.key, code: e.code, type, repeat: e.repeat, inInput, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
  }, true);
}

// ---------------------------------------------------------------- speech bubbles
function say(inst, text, opts = {}) {
  inst.bubble?.close();
  const el = document.createElement('div');
  el.className = 'ws-bubble';
  bubbleLayer.append(el);
  let alive = true, full = String(text), shown = opts.typing ? 0 : full.length;
  const anchor = opts.anchor;
  const place = () => {
    if (!alive) return;
    let x, y;
    if (anchor instanceof Element) { const r = anchor.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top - 10; }
    else if (anchor && 'x' in anchor) { x = anchor.x; y = anchor.y; }
    else { const r = inst.el.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top - 10; }
    const bw = el.offsetWidth / 2 + 6;
    const left = Math.round(clamp(x, bw, innerWidth - bw)) + 'px';
    const top = Math.round(Math.max(el.offsetHeight + 6, y)) + 'px';
    if (el.style.left !== left) el.style.left = left; // unchanged writes still cost a repaint
    if (el.style.top !== top) el.style.top = top;
    if (opts.typing && shown < full.length) { shown += 0.6; el.textContent = full.slice(0, Math.ceil(shown)); }
    requestAnimationFrame(place);
  };
  el.textContent = opts.typing ? '' : full;
  place();
  const handle = {
    update(t) { full = String(t); shown = opts.typing ? 0 : full.length; el.textContent = full.slice(0, shown); },
    close() {
      if (!alive) return;
      alive = false;
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
      if (inst.bubble === handle) inst.bubble = null;
    },
  };
  const duration = opts.duration ?? 2200 + 55 * full.length;
  if (duration > 0) setTimeout(handle.close, duration);
  inst.bubble = handle;
  return handle;
}

// ---------------------------------------------------------------- menus & dialogs
function openSettings(inst) {
  const fields = inst.manifest.settings || [];
  if (!fields.length) return;
  ui.settingsDialog(`${inst.manifest.name} settings`, fields, inst.settings, (v) => inst.setSettings(v));
}

function frameMenu(inst, x, y) {
  const s = inst.style, m = inst.manifest;
  inst.el.classList.add('ws-menu-open');
  ui.menu(x, y, [
    ...inst.menuItems.map((it) => ({ ...it, action: () => it.action?.() })),
    inst.menuItems.length ? 'sep' : null,
    m.expandable ? { icon: inst.cfg.expanded ? '⤡' : '⤢', label: inst.cfg.expanded ? 'Exit full screen' : 'Expand to full screen', action: () => inst.toggleExpand() } : null,
    m.settings?.length ? { icon: '⚙', label: 'Settings…', action: () => openSettings(inst) } : null,
    { kind: 'label', label: 'Look' },
    { kind: 'seg', value: s.look, onChange: (v) => inst.setStyle({ look: v }),
      options: [{ label: 'Glass', value: 'glass' }, { label: 'Tint', value: 'tint' }, { label: 'Solid', value: 'solid' }, { label: 'Clear', value: 'clear' }] },
    { kind: 'seg', value: `${!!s.showTitle}|${!!s.border}`, onChange: (v) => inst.setStyle({ showTitle: v[0] === 't', border: v.endsWith('true') }),
      options: [{ label: 'Title', value: `${!s.showTitle}|${!!s.border}` }, { label: 'Border', value: `${!!s.showTitle}|${!s.border}` }]
        .map((o, i) => ({ ...o, label: (i === 0 ? s.showTitle : s.border) ? `✓ ${o.label}` : o.label })) },
    'sep',
    m.multiInstance ? { icon: '⧉', label: 'Duplicate', action: () => addInstance(m.id, { settings: inst.cfg.settings, style: inst.cfg.style }) } : null,
    { icon: '↻', label: 'Reload widget', action: () => inst.remount() },
    { icon: '✎', label: 'Edit widgets', action: () => setEdit(true) },
    { icon: '＋', label: 'Add widget…', action: openGallery },
    'sep',
    { icon: '✕', label: 'Remove', danger: true, action: () => inst.close() },
  ], { onClose: () => inst.el.classList.remove('ws-menu-open') });
  scheduleRegion();
}

function launcherMenu(e, el) {
  const r = el.getBoundingClientRect();
  ui.menu(r.left - 200, r.top - 170, [
    { icon: '＋', label: 'Add widget…', action: openGallery },
    { icon: '✎', label: S.edit ? 'Finish editing' : 'Edit widgets', action: () => setEdit(!S.edit) },
    { icon: S.hidden ? '◉' : '◌', label: S.hidden ? 'Show widgets' : 'Hide widgets', action: toggleHidden },
    { icon: '↻', label: 'Reload all', action: () => location.reload() },
  ]);
  scheduleRegion();
}

function openGallery() {
  ui.gallery([...S.widgets.values()], (w) => addInstance(w.id), { onClose: scheduleRegion });
  scheduleRegion();
}

function setEdit(on) {
  S.edit = on;
  document.body.classList.toggle('ws-edit', on);
  ui.toolbar(on, { onAdd: openGallery, onDone: () => setEdit(false) });
  broadcast('editmode', { on });
  scheduleRegion();
}

function toggleHidden() {
  S.hidden = !S.hidden;
  document.body.classList.toggle('ws-hidden', S.hidden);
  broadcast('visibility', { visible: !S.hidden });
  scheduleRegion();
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || ui.isModalOpen()) return;
  if (S.edit) setEdit(false);
  else for (const i of S.instances.values()) i.setExpanded(false);
});

// ---------------------------------------------------------------- instances
function freeSpot(w, h) {
  const taken = [...S.instances.values()].map((i) => i.rect());
  const hit = (x, y) => taken.some((r) => x < r.x + r.w + 12 && x + w + 12 > r.x && y < r.y + r.h + 12 && y + h + 12 > r.y);
  for (let y = 24; y + h < innerHeight; y += 24)
    for (let x = innerWidth - w - 24; x > 0; x -= 24) if (!hit(x, y)) return { x, y };
  return { x: (innerWidth - w) / 2, y: (innerHeight - h) / 2 };
}

async function addInstance(widgetId, extra = {}) {
  const m = S.widgets.get(widgetId);
  if (!m) return null;
  if (!m.multiInstance) {
    const existing = [...S.instances.values()].find((i) => i.manifest.id === widgetId);
    if (existing) { existing.el.animate([{ transform: 'scale(1.04)' }, { transform: 'none' }], 300); return existing; }
  }
  const { w, h } = m.size;
  const pos = extra.x != null ? { x: extra.x, y: extra.y } : freeSpot(w, h);
  const cfg = { id: uid(widgetId), widget: widgetId, ...pos, w, h, style: extra.style || {}, settings: extra.settings || {}, expanded: false };
  const inst = new Instance(cfg);
  S.instances.set(cfg.id, inst);
  saveLayout();
  await inst.mount();
  return inst;
}

function defaultLayout() {
  const W = innerWidth;
  const pick = (id, x, y) => (S.widgets.has(id) ? { widget: id, x, y } : null);
  return [
    pick('clock', W - 324, 24),
    pick('tasks', W - 324, 196),
    pick('sysmon', W - 324 - 236, 24),
    pick('pet', 60, innerHeight - 250),
  ].filter(Boolean);
}

// ---------------------------------------------------------------- input region (click-through)
let regionTimer = 0, lastRegion = '';
function scheduleRegion() { clearTimeout(regionTimer); regionTimer = setTimeout(updateRegion, 16); }
function updateRegion() {
  if (HOST === 'browser') return;
  const anyExpanded = [...S.instances.values()].some((i) => i.cfg.expanded);
  let payload;
  if (S.edit || ui.isModalOpen() || anyExpanded) payload = { full: true };
  else {
    const rects = [];
    const add = (r, pad = 0) => { if (r.width && r.height) rects.push([r.left - pad, r.top - pad, r.width + 2 * pad, r.height + 2 * pad].map(Math.round)); };
    if (!S.hidden) {
      for (const i of S.instances.values()) {
        add(i.el.getBoundingClientRect(), 6);
        for (const el of i.interactive) if (el.isConnected) add(el.getBoundingClientRect(), 10);
      }
    }
    for (const el of document.getElementById('ws-ui').children) add(el.getBoundingClientRect());
    payload = { rects };
  }
  const key = JSON.stringify(payload);
  if (key !== lastRegion) {
    lastRegion = key;
    call('host.inputRegion', payload).catch(() => {});
  }
}
setInterval(updateRegion, 120); // keeps up with moving interactive overlays (creatures)

// ---------------------------------------------------------------- errors
function reportError(inst, e) {
  console.error(e);
  log('error', e?.stack || String(e), inst ? `${inst.manifest.id}:${inst.id}` : 'shell');
}
addEventListener('error', (e) => log('error', `${e.message} @ ${e.filename}:${e.lineno}`, (e.filename?.match(/\/w\/([^/]+)\//) || [, 'shell'])[1]));
addEventListener('unhandledrejection', (e) => log('error', e.reason?.stack || String(e.reason), (String(e.reason?.stack).match(/\/w\/([^/]+)\//) || [, 'shell'])[1]));

// ---------------------------------------------------------------- theme & glass
async function applyTheme(t) {
  const darkChanged = t.dark !== S.theme.dark;
  S.theme = { dark: !!t.dark };
  document.documentElement.dataset.theme = t.dark ? 'dark' : 'light';
  if (darkChanged) broadcast('theme', { ...S.theme });
  if (t.wallpaper) {
    document.body.style.setProperty('--ws-wallpaper', `url("${t.wallpaper}")`);
    try {
      S.glassUrl = (await blurredWallpaper(t.wallpaper, S.config.glassBlur || 28)).url;
    } catch (e) { S.glassUrl = null; reportError(null, e); }
  } else S.glassUrl = null;
  for (const i of S.instances.values()) i.applyGlass();
}

// ---------------------------------------------------------------- events from the core
function onEvent(type, data) {
  switch (type) {
    case 'theme': applyTheme(data); break;
    case 'host':
      S.host = data;
      for (const i of S.instances.values()) i.applyRect();
      break;
    case 'widgets':
      S.widgets = new Map(data.map((w) => [w.id, w]));
      break;
    case 'widget-changed':
      S.widgets.set(data.id, data);
      for (const i of S.instances.values()) if (i.manifest.id === data.id) i.remount();
      break;
    case 'command': onCommand(data); break;
  }
}

function onCommand(c) {
  switch (c.cmd) {
    case 'edit': setEdit(c.on ?? !S.edit); break;
    case 'gallery': openGallery(); break;
    case 'toggle': toggleHidden(); break;
    case 'reload': location.reload(); break;
    case 'add': addInstance(c.widget, { settings: c.settings }); break;
    case 'remove': S.instances.get(c.id)?.close(); break;
    case 'send': deliver({ id: 'widgetctl', widget: 'widgetctl' }, c.target, c.data); break;
  }
}

// ---------------------------------------------------------------- boot
async function boot() {
  const st = await call('state');
  S.config = st.config || {};
  S.host = st.host;
  S.widgets = new Map(st.widgets.map((w) => [w.id, w]));
  await applyTheme(st.theme);
  if (S.config.launcher !== false) ui.launcher(S.config.launcherCorner, launcherMenu);

  let cfgs = st.layout?.instances;
  if (!cfgs) {
    for (const d of defaultLayout()) await addInstance(d.widget, d);
  } else {
    for (const cfg of cfgs) {
      if (!S.widgets.has(cfg.widget)) { log('warn', `widget ${cfg.widget} not found; instance ${cfg.id} skipped`); continue; }
      const inst = new Instance({ ...cfg, expanded: false });
      S.instances.set(cfg.id, inst);
    }
    await Promise.all([...S.instances.values()].map((i) => i.mount()));
  }
  listen(onEvent);
  saveLayout();
  addEventListener('resize', () => { for (const i of S.instances.values()) i.applyRect(); scheduleRegion(); });
}

boot().catch((e) => { reportError(null, e); document.body.textContent = 'WidgetSystem failed to start: ' + e; });
