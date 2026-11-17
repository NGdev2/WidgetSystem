// Navigator: browse the widget index, install / update / remove widgets, add them to the desktop.
// The server side is widgetsystem/navigator.py (POST /api/nav.<op>). See docs/NAVIGATOR.md.
import { call } from './bridge.js';
import { h, openModal, closeModal } from './ui.js';

const PERM_INFO = {
  shell: 'Run any command on your computer, as you',
  network: 'Fetch any URL on the internet, outside the page sandbox',
};
const DANGEROUS = ['shell', 'network'];
const STATUS = {
  builtin: ['Built-in', 'muted'], user: ['Installed', 'accent'], dev: ['Dev folder', 'warn'],
  update: ['Update available', 'hot'], soon: ['Coming soon', 'muted dashed'],
};

let host = null;         // {widgets(): Map, addInstance(id, {variant}), onClose()} from runtime.js
let panel = null;        // the open panel element, or null
let parts = null;        // {list, detail, foot, tabs, search}
let refreshTimer = 0;
const st = {
  tab: 'browse', q: '', sel: null,
  data: null, meta: null, loading: false, loadError: null,
  busy: {},              // id -> 'install' | 'update' | 'remove'
  err: {},               // id -> message
  note: {},              // id -> message
  confirm: null,         // {id, kind: 'install' | 'remove', perms}
};

const cleanErr = (e) => String(e?.message || e).replace(/^(NavError|RuntimeError|KeyError|PermissionError|ValueError): /, '').replace(/^'(.*)'$/, '$1');

function ensureCss() {
  if (document.getElementById('ws-navigator-css')) return;
  document.head.append(h('link', { id: 'ws-navigator-css', rel: 'stylesheet', href: '/shell/navigator.css' }));
}

// ---------------------------------------------------------------- public API
export function openNavigator(opts) {
  host = opts;
  ensureCss();
  st.confirm = null;
  const search = h('input', { class: 'ws-nav-search', type: 'search', placeholder: 'Search widgets, tags, authors', spellcheck: 'false' });
  search.value = st.q;
  search.addEventListener('input', () => { st.q = search.value; renderBody(); });
  const tabs = h('div', { class: 'ws-nav-tabs', role: 'tablist' });
  const list = h('div', { class: 'ws-nav-list', role: 'listbox' });
  const detail = h('div', { class: 'ws-nav-detail' });
  const foot = h('div', { class: 'ws-nav-foot' });
  parts = { list, detail, foot, tabs, search };
  panel = h('div', { class: 'ws-nav', role: 'dialog', 'aria-label': 'Navigator' },
    h('header', { class: 'ws-nav-head' },
      h('span', { class: 'ws-nav-title' }, 'Navigator'),
      h('span', { class: 'ws-nav-sub' }, 'widget index'),
      h('span', { class: 'grow' }),
      h('button', { class: 'ws-nav-x', title: 'Close (Esc)', onclick: closeModal }, '✕')),
    h('div', { class: 'ws-nav-bar' }, tabs, search,
      h('button', { class: 'ws-btn2 ws-nav-refresh', title: 'Reload the index and check for updates', onclick: () => load(true) }, '↻')),
    h('div', { class: 'ws-nav-main' }, list, detail),
    foot);
  panel.addEventListener('keydown', onKey);
  openModal(panel, { onClose: () => { panel = null; parts = null; host?.onClose?.(); } });
  call('host.focus').catch(() => {});   // the desktop layer needs keyboard focus for the search box
  renderAll();
  load(false);
  return panel;
}

/** runtime.js calls this on every `widgets` event; re-reads local state while the panel is open. */
export function refreshNavigator() {
  if (!panel) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => load(false, true), 150);
}

// ---------------------------------------------------------------- data
async function load(refresh, quiet = false) {
  if (!quiet) { st.loading = true; renderFoot(); }
  try {
    const r = await call('nav.index', { refresh, checkUpdates: true });
    st.data = r.widgets;
    st.meta = r;
    st.loadError = null;
  } catch (e) {
    st.loadError = cleanErr(e);
  }
  st.loading = false;
  if (st.data && !st.data.some((w) => w.id === st.sel)) st.sel = null;
  renderAll();
}

const byId = (id) => st.data?.find((w) => w.id === id);
const visibleOn = (tab) => (st.data || []).filter((w) => (tab === 'installed' ? w.installed : w.inIndex));

function filtered() {
  const q = st.q.trim().toLowerCase();
  return visibleOn(st.tab)
    .filter((w) => !q || [w.name, w.id, w.description, w.author, ...(w.tags || [])].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.private - b.private) || a.name.localeCompare(b.name));
}

function statusOf(w) {
  if (!w.installed) return w.private ? 'soon' : null;
  if (w.updateAvailable) return 'update';
  return w.source;
}

const permsOf = (w) => (w.installed ? w.manifestPermissions : w.permissions) || [];

// ---------------------------------------------------------------- actions
async function run(w, kind, params = {}) {
  st.busy[w.id] = kind;
  delete st.err[w.id];
  delete st.note[w.id];
  st.confirm = null;
  renderBody();
  try {
    const r = await call('nav.' + kind, { id: w.id, ...params });
    if (kind === 'install') st.note[w.id] = 'Installed. Add it to your desktop below.';
    if (kind === 'update') st.note[w.id] = r.updated ? `Updated ${r.from} → ${r.to}.` : 'Already up to date.';
    if (kind === 'remove') {
      st.note[w.id] = r.kind === 'unregistered' ? `Folder unregistered: ${r.path}` : 'Removed.';
      if (r.removed?.length > 1) st.note[w.id] += ` Also gone: ${r.removed.filter((x) => x !== w.id).join(', ')}.`;
    }
  } catch (e) {
    st.err[w.id] = cleanErr(e);
  }
  delete st.busy[w.id];
  await load(false, true);
}

function askInstall(w) {
  const perms = (w.permissions || []).filter((p) => DANGEROUS.includes(p));
  st.sel = w.id;
  if (perms.length) { st.confirm = { id: w.id, kind: 'install', perms }; renderBody(); return; }
  run(w, 'install');
}

function askRemove(w) {
  st.sel = w.id;
  st.confirm = { id: w.id, kind: 'remove' };
  renderBody();
}

async function addToDesktop(w, variant) {
  const label = variant ? (w.variantInfo || []).find((v) => v.id === variant)?.name || variant : w.name;
  delete st.err[w.id];
  if (!host.widgets().has(w.id)) { st.err[w.id] = 'The shell has not loaded this widget yet. Try again in a second.'; renderBody(); return; }
  try {
    const inst = await host.addInstance(w.id, { variant });
    st.note[w.id] = inst ? `Added ${label} to the desktop.` : `Couldn't add ${label}.`;
  } catch (e) {
    st.err[w.id] = cleanErr(e);
  }
  renderBody();
}

function select(id) {
  if (st.sel === id) return;
  st.sel = id;
  if (st.confirm && st.confirm.id !== id) st.confirm = null;
  renderBody();
}

function onKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = filtered();
  if (!items.length) return;
  const i = items.findIndex((w) => w.id === st.sel);
  const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
  e.preventDefault();
  select(next.id);
  parts?.list.querySelector('.ws-nav-card.sel')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- rendering
function icon(w, cls = 'ws-nav-icon') {
  const src = (w.installed && w.localIcon) || w.icon || '🧩';
  const isUrl = /^(https:\/\/|\/w\/)/.test(src);
  const el = h('div', { class: cls });
  if (isUrl) {
    const img = h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.replaceWith('🧩'); });
    el.append(img);
  } else el.append(src);
  return el;
}

function chip(kind) {
  const [label, cls] = STATUS[kind];
  return h('span', { class: `ws-nav-chip ${cls}` }, label);
}

function permBadges(w) {
  return permsOf(w).map((p) => h('span', { class: `ws-nav-perm ${DANGEROUS.includes(p) ? p : ''}`, title: PERM_INFO[p] || p }, '⚠ ' + p));
}

function progress(kind) {
  const label = { install: 'Cloning…', update: 'Pulling…', remove: 'Removing…' }[kind];
  return h('div', { class: 'ws-nav-progress' }, h('i'), h('span', {}, label));
}

function variantButtons(w, cls = 'ws-btn2 primary') {
  const vs = w.variantInfo || [];
  if (!vs.length) return [h('button', { class: cls, onclick: (e) => { e.stopPropagation(); addToDesktop(w, null); } }, '＋ Add to desktop')];
  return vs.map((v) => h('button', { class: cls, title: v.description || '', onclick: (e) => { e.stopPropagation(); addToDesktop(w, v.id); } }, '＋ ' + v.name));
}

function actionButtons(w, { compact = false } = {}) {
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  if (st.busy[w.id]) return [progress(st.busy[w.id])];
  if (!w.installed) {
    if (w.private) return compact ? [] : [h('button', { class: 'ws-btn2', disabled: true }, 'Coming soon')];
    return [h('button', { class: 'ws-btn2 primary', onclick: stop(() => askInstall(w)) }, 'Install')];
  }
  const out = compact ? variantButtons(w).slice(0, 2) : [];
  if (w.updatable) out.push(h('button', { class: 'ws-btn2' + (w.updateAvailable ? ' primary' : ''), onclick: stop(() => run(w, 'update')) }, 'Update'));
  if (w.source !== 'builtin' && !compact) {
    out.push(h('button', { class: 'ws-btn2 danger', onclick: stop(() => askRemove(w)) }, w.source === 'dev' ? 'Unregister' : 'Remove'));
  }
  return out;
}

function card(w) {
  const status = statusOf(w);
  return h('div', {
    class: 'ws-nav-card' + (st.sel === w.id ? ' sel' : '') + (w.private ? ' soon' : ''),
    role: 'option', 'aria-selected': st.sel === w.id ? 'true' : 'false', 'data-id': w.id,
    onclick: () => select(w.id),
  },
  icon(w),
  h('div', { class: 'ws-nav-meta' },
    h('div', { class: 'ws-nav-name' }, h('b', {}, w.name),
      w.author ? h('span', { class: 'ws-nav-author' }, w.author) : null,
      status ? chip(status) : null),
    h('p', {}, w.description || w.id),
    h('div', { class: 'ws-nav-tags' }, (w.tags || []).slice(0, 4).map((t) => h('span', { class: 'ws-nav-tag' }, t)), permBadges(w)),
    st.err[w.id] ? h('div', { class: 'ws-nav-msg err' }, st.err[w.id]) : null),
  h('div', { class: 'ws-nav-actions' }, actionButtons(w, { compact: true })));
}

function section(label, ...body) {
  return h('section', {}, h('h4', {}, label), ...body);
}

function confirmBox(w) {
  const c = st.confirm;
  if (!c || c.id !== w.id) return null;
  if (c.kind === 'install') {
    return h('div', { class: 'ws-nav-confirm' },
      h('b', {}, `${w.name} asks for extra permissions`),
      h('ul', {}, c.perms.map((p) => h('li', {}, h('span', { class: `ws-nav-perm ${p}` }, '⚠ ' + p), ' ', PERM_INFO[p] || ''))),
      h('p', {}, 'Only install it if you trust the author and the code in its repository.'),
      h('div', { class: 'row' },
        h('button', { class: 'ws-btn2', onclick: () => { st.confirm = null; renderBody(); } }, 'Cancel'),
        h('button', { class: 'ws-btn2 primary', onclick: () => run(w, 'install', { acceptPermissions: c.perms }) }, `Allow ${c.perms.join(' + ')} and install`)));
  }
  const text = w.source === 'dev'
    ? `Unregister the dev folder ${w.devPath || w.path}? Nothing is deleted on disk.`
    : w.linked ? `Remove the link ${w.path}? The folder it points to stays.`
      : `Delete ${w.path}? Its desktop instances close. Its shared data stays and comes back if you reinstall.`;
  return h('div', { class: 'ws-nav-confirm' },
    h('b', {}, `Remove ${w.name}?`), h('p', {}, text),
    h('div', { class: 'row' },
      h('button', { class: 'ws-btn2', onclick: () => { st.confirm = null; renderBody(); } }, 'Cancel'),
      h('button', { class: 'ws-btn2 danger solid', onclick: () => run(w, 'remove') }, w.source === 'dev' ? 'Unregister' : 'Remove')));
}

function details(w) {
  if (!w) {
    const n = visibleOn('browse').filter((x) => !x.private).length;
    return h('div', { class: 'ws-nav-empty' },
      h('div', { class: 'big' }, '⬢'),
      h('p', {}, st.data ? `${n} widget${n === 1 ? '' : 's'} in the index. Select one to see details.` : 'Loading the widget index…'),
      h('p', { class: 'small' }, 'Publish your own: put it in a public GitHub repo with widget.json at the root, then open a pull request that adds it to registry/index.json.'));
  }
  const status = statusOf(w);
  const perms = permsOf(w);
  const sourceText = { builtin: 'Built into WidgetSystem', user: w.linked ? 'Linked into your widgets folder' : w.updatable ? 'Installed from git' : 'Copied into your widgets folder', dev: 'Dev folder you registered' }[w.source];
  return h('div', { class: 'ws-nav-detail-in' },
    h('div', { class: 'ws-nav-dhead' }, icon(w, 'ws-nav-icon big'),
      h('div', {}, h('h3', {}, w.name),
        h('div', { class: 'ws-nav-byline' }, w.author ? `by ${w.author}` : w.id, w.version ? h('span', { class: 'mono' }, ` v${w.version}`) : null),
        h('div', { class: 'ws-nav-chips' }, status ? chip(status) : null, w.inIndex ? null : h('span', { class: 'ws-nav-chip muted' }, 'Local only')))),
    st.err[w.id] ? h('div', { class: 'ws-nav-msg err' }, st.err[w.id]) : null,
    st.note[w.id] ? h('div', { class: 'ws-nav-msg ok' }, st.note[w.id]) : null,
    confirmBox(w),
    st.confirm?.id === w.id ? null : h('div', { class: 'ws-nav-dactions' }, actionButtons(w)),
    w.installed ? section(w.variantInfo?.length ? 'Add to desktop' : 'Desktop', h('div', { class: 'ws-nav-variants' }, variantButtons(w, 'ws-btn2'))) : null,
    section('About', h('p', {}, w.description || 'No description.'),
      w.tags?.length ? h('div', { class: 'ws-nav-tags' }, w.tags.map((t) => h('span', { class: 'ws-nav-tag' }, t))) : null),
    !w.installed && w.variantInfo?.length ? section('Variants', h('p', {}, w.variantInfo.map((v) => v.name).join(' · '))) : null,
    section('Permissions', perms.length
      ? h('ul', { class: 'ws-nav-plist' }, perms.map((p) => h('li', {}, h('span', { class: `ws-nav-perm ${DANGEROUS.includes(p) ? p : ''}` }, '⚠ ' + p), ' ', PERM_INFO[p] || '')))
      : h('p', { class: 'muted' }, 'None. It only uses the regular widget API.')),
    section('Source',
      w.repo && /^https:\/\//.test(w.repo) ? h('button', { class: 'ws-nav-link', onclick: () => call('open', { url: w.repo }) }, w.repo.replace(/^https:\/\//, '') + ' ↗') : null,
      w.installed ? h('p', { class: 'muted' }, sourceText) : null,
      w.path ? h('div', { class: 'ws-nav-path' }, h('code', {}, w.path),
        h('button', { class: 'ws-nav-link', title: 'Open folder', onclick: () => call('open', { url: w.path }) }, 'Open folder')) : null));
}

function renderTabs() {
  if (!parts) return;
  parts.tabs.replaceChildren(...[['installed', 'Installed'], ['browse', 'Browse']].map(([id, label]) => h('button', {
    class: 'ws-nav-tab' + (st.tab === id ? ' on' : ''), role: 'tab', 'aria-selected': st.tab === id ? 'true' : 'false',
    onclick: () => { st.tab = id; st.confirm = null; renderAll(); },
  }, label, h('span', { class: 'n' }, String(visibleOn(id).length)))));
}

function renderBody() {
  if (!parts) return;
  const items = filtered();
  if (!st.sel && items.length) st.sel = items[0].id;
  const scroll = parts.list.scrollTop;
  parts.list.replaceChildren(...(items.length ? items.map(card) : [h('div', { class: 'ws-nav-none' },
    !st.data ? (st.loadError ? 'Couldn’t load the index.' : 'Loading…')
      : st.q ? `Nothing matches “${st.q}”.` : st.tab === 'installed' ? 'Nothing installed yet. Open Browse.' : 'The index is empty.')]));
  parts.list.scrollTop = scroll;
  parts.detail.replaceChildren(details(byId(st.sel)));
}

function ago(ts) {
  const m = Math.round((Date.now() / 1000 - ts) / 60);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function renderFoot() {
  if (!parts) return;
  const m = st.meta;
  const src = !m ? '' : m.source === 'remote' ? `online index, ${ago(m.fetchedAt)}`
    : m.source === 'cache' ? `cached index, ${ago(m.fetchedAt)}` : m.source === 'local' ? 'local index (offline copy)' : 'no index';
  parts.foot.replaceChildren(...[
    h('i', { class: 'bars' }),
    h('span', {}, st.loading ? 'Loading index…' : src),
    m?.userWidgets ? h('span', { class: 'grow', title: m.userWidgets }, 'installs → ' + m.userWidgets) : h('span', { class: 'grow' }),
    st.loadError || m?.error ? h('span', { class: 'warn', title: st.loadError || m.error }, st.loadError || m.error) : null,
  ].filter(Boolean));
}

function renderAll() { renderTabs(); renderBody(); renderFoot(); }
