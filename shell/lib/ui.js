// Shell UI primitives: context menus, panels, dialogs, toolbar, launcher.
const layer = () => document.getElementById('ws-ui');
let modal = null; // the open menu/panel/dialog (only one at a time)

export const isModalOpen = () => !!modal;

export function closeModal() {
  if (!modal) return;
  const m = modal;
  modal = null;
  m.el.remove();
  m.onClose?.();
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
export { h };

function openModal(el, { onClose, catcher = true } = {}) {
  closeModal();
  // A full-window catcher closes the modal on any outside click. While a modal is open
  // the runtime makes the whole window clickable, so the catcher actually receives it.
  const wrap = catcher ? h('div', { style: 'position:absolute;inset:0' }) : el;
  if (catcher) {
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeModal(); });
    wrap.addEventListener('contextmenu', (e) => { e.preventDefault(); if (e.target === wrap) closeModal(); });
    wrap.append(el);
  }
  layer().append(wrap);
  modal = { el: wrap, onClose };
  return el;
}
export { openModal }; // used by lib/navigator.js

// Esc closes the open menu/dialog and nothing else: preventDefault tells the runtime it was handled.
addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal) { closeModal(); e.preventDefault(); } });

/** items: {label, icon, action, danger} | 'sep' | {label, kind:'label'} | {kind:'seg', options:[{label,value}], value, onChange} */
export function menu(x, y, items, opts = {}) {
  const el = h('div', { class: 'ws-menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { el.append(h('div', { class: 'ws-menu-sep' })); continue; }
    if (it.kind === 'label') { el.append(h('div', { class: 'ws-menu-label' }, it.label)); continue; }
    if (it.kind === 'seg') {
      const seg = h('div', { class: 'ws-seg' });
      for (const o of it.options) {
        seg.append(h('button', {
          class: o.value === it.value ? 'on' : '',
          onclick: () => { it.onChange(o.value); closeModal(); },
        }, o.label));
      }
      el.append(seg);
      continue;
    }
    el.append(h('div', {
      class: 'ws-menu-item' + (it.danger ? ' danger' : ''),
      onclick: () => { closeModal(); it.action?.(); },
    }, h('span', { class: 'ico' }, it.icon || ''), h('span', {}, it.label)));
  }
  openModal(el, opts);
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
  el.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
  return el;
}

export function gallery(widgets, onAdd, opts = {}) {
  const list = h('div', { class: 'list' });
  // A widget with variants gets one card per variant.
  const entries = widgets.flatMap((w) => (w.variants?.length
    ? w.variants.map((v) => ({ w, variant: v.id, name: v.name, description: v.description, icon: v.icon }))
    : [{ w, variant: null, name: w.name, description: w.description, icon: w.icon }]));
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const icon = /\.(png|svg|webp|jpe?g|gif)$/i.test(e.icon)
      ? h('img', { src: `/w/${e.w.id}/${e.w._version}/${e.icon}`, alt: '' })
      : e.icon;
    list.append(h('div', { class: 'ws-card' },
      h('div', { class: 'icon' }, icon),
      h('div', { class: 'meta' }, h('b', {}, e.name), h('span', {}, e.description || e.w.id)),
      h('button', { class: 'ws-btn2 primary', onclick: () => onAdd(e.w, e.variant) }, 'Add')));
  }
  const el = h('div', { class: 'ws-panel' },
    h('header', {}, 'Widgets', h('button', { class: 'ws-btn2', onclick: closeModal }, 'Done')),
    list);
  return openModal(el, opts);
}

/** fields: manifest.settings; values: current; onSave(newValues) */
export function settingsDialog(title, fields, values, onSave) {
  const inputs = {};
  const rows = fields.map((f) => {
    const v = values[f.key] ?? f.default;
    let input;
    if (f.type === 'boolean') input = h('input', { type: 'checkbox', checked: !!v });
    else if (f.type === 'number') input = h('input', { type: f.min != null && f.max != null ? 'range' : 'number', min: f.min, max: f.max, step: f.step ?? 1, value: v });
    else if (f.type === 'select') input = h('select', {}, (f.options || []).map((o) => {
      const val = typeof o === 'object' ? o.value : o;
      return h('option', { value: val, selected: String(val) === String(v) }, typeof o === 'object' ? o.label : o);
    }));
    else if (f.type === 'color') input = h('input', { type: 'color', value: v || '#4f8cff' });
    else input = h('input', { type: 'text', value: v ?? '' });
    inputs[f.key] = [f, input];
    return h('label', { class: 'ws-field' }, h('span', {}, f.label || f.key), input);
  });
  const read = () => Object.fromEntries(Object.entries(inputs).map(([k, [f, i]]) => [k,
    f.type === 'boolean' ? i.checked : f.type === 'number' ? Number(i.value) : i.value]));
  const el = h('div', { class: 'ws-dialog' }, h('h3', {}, title), rows,
    h('div', { class: 'actions' },
      h('button', { class: 'ws-btn2', onclick: closeModal }, 'Cancel'),
      h('button', { class: 'ws-btn2 primary', onclick: () => { onSave(read()); closeModal(); } }, 'Save')));
  const wrap = h('div', { class: 'ws-dialog-wrap' }, el);
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) closeModal(); });
  return openModal(wrap, { catcher: false });
}

let toolbarEl = null;
export function toolbar(show, { onAdd, onDone } = {}) {
  toolbarEl?.remove();
  toolbarEl = null;
  if (!show) return;
  toolbarEl = h('div', { class: 'ws-toolbar' },
    h('b', {}, 'Editing widgets'),
    h('button', { class: 'ws-btn2', onclick: onAdd }, '＋ Add widget'),
    h('button', { class: 'ws-btn2 primary', onclick: onDone }, 'Done'));
  layer().append(toolbarEl);
}

export function launcher(corner, onClick) {
  const pos = { 'bottom-right': 'right:10px;bottom:10px', 'bottom-left': 'left:10px;bottom:10px',
    'top-right': 'right:10px;top:10px', 'top-left': 'left:10px;top:10px' }[corner] || 'right:10px;bottom:10px';
  const el = h('button', { class: 'ws-launcher', style: pos, title: 'Widgets' }, '✦');
  el.addEventListener('click', (e) => onClick(e, el));
  layer().append(el);
  return el;
}
