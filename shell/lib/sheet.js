// Sheets, tears and tickets.
// The "sheet" is the expanded (full-screen) widget. Tickets are small work orders any widget can
// file and any widget can fix ("tear", "crack", "orphan", "error", ...). A tear is a ticket with a
// polygon: the host cuts it out of the sheet (clip-path) so the layer behind shows through, draws
// its rim, and enforces the rules that keep tears harmless for the user.

const RULES = {
  maxTears: 3, maxW: 240, maxH: 300, maxArea: 45000, maxTotal: 0.08, maxPoints: 48,
  openGrace: 5000,      // no tears in the first seconds after a panel opens
  pointerGap: 160,      // never near the pointer
  keyGap: 3000,         // never right after a keystroke
  minUpdateMs: 250,     // tear growth at most 4 updates per second
  claimTimeout: 20000,  // a claim without progress is released
};
const TTL = { tear: 90000, crack: 120000, orphan: 300000, error: 600000 };
const KINDS = new Set(['tear', 'crack', 'orphan', 'error', 'overdue', 'hung', 'care']);

// ---------------------------------------------------------------- geometry
const bbox = (pts) => {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const area = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const centroid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// The bottom edge of a hole: a ledge creatures can sit on.
function ledgeOf(pts) {
  const b = bbox(pts);
  const low = pts.filter((p) => p[1] > b.y + b.h * 0.6);
  const xs = low.map((p) => p[0]);
  return { x: Math.min(...xs), y: Math.round(b.y + b.h), w: Math.max(...xs) - Math.min(...xs) };
}
const cleanPoints = (pts) => (Array.isArray(pts) ? pts : [])
  .filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  .map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);

export function createTickets({ S, broadcast, rimsEl }) {
  const tickets = new Map();
  let seq = 0;
  const st = { lastKey: 0, sheetSince: 0, hover: new Map() };

  const sheetInst = () => [...S.instances.values()].find((i) => i.cfg.expanded) || null;
  const tearsOf = (inst) => [...tickets.values()].filter((t) => t.kind === 'tear' && t.sheet === inst?.id);

  function tearable(inst) {
    return !!inst && S.config.tears !== false && inst.manifest.frame?.tearable !== false && inst.tearable !== false;
  }

  // Protected zones in window coordinates: the top band, the bottom corners, and what the sheet declares.
  function protectRects(inst) {
    const r = inst.rect();
    const zones = [{ x: 0, y: 0, w: r.w, h: 56 }, { x: 0, y: r.h - 64, w: 64, h: 64 }, { x: r.w - 64, y: r.h - 64, w: 64, h: 64 }];
    const c = inst.contentEl?.getBoundingClientRect();
    for (const p of inst.protect || []) if (c) zones.push({ x: c.left + p.x, y: c.top + p.y, w: p.w, h: p.h });
    return zones;
  }

  function pub(t) {
    const { base, hoverSince, lastUpdate, lastProgress, mending, ...rest } = t;
    return { ...rest, by: { ...t.by }, points: t.points?.map((p) => [...p]) };
  }
  const emit = (type, t) => broadcast('ticket', { type, ticket: pub(t) });

  function sheetInfo() {
    const inst = sheetInst();
    if (!inst) return null;
    return { id: inst.id, instance: inst.id, widget: inst.manifest.id, rect: inst.rect(), tearable: tearable(inst),
      protect: protectRects(inst), maxTears: RULES.maxTears, tears: tearsOf(inst).map(pub) };
  }

  // ---------------------------------------------------------------- clip + rims (only on change)
  function render(inst) {
    const tears = tearsOf(inst);
    if (inst) {
      const { w, h } = inst.rect();
      inst.el.style.clipPath = tears.length
        ? `path(evenodd, "M0 0H${w}V${h}H0Z ${tears.map((t) => 'M' + t.points.map((p) => p.join(' ')).join('L') + 'Z').join(' ')}")`
        : '';
    }
    rimsEl.innerHTML = tears.length
      ? `<svg width="100%" height="100%">${tears.map((t) => {
        const d = 'M' + t.points.map((p) => p.join(' ')).join('L') + 'Z';
        return `<path class="ws-rim-outer" d="${d}"/><path class="ws-rim-inner" d="${d}"/>`;
      }).join('')}</svg>`
      : '';
  }

  // ---------------------------------------------------------------- tear checks
  function checkTear(inst, pts, ignoreId) {
    if (!tearable(inst)) return 'disabled';
    if (pts.length < 3 || pts.length > RULES.maxPoints) return 'cap';
    const b = bbox(pts), a = area(pts), sheet = inst.rect();
    if (b.w > RULES.maxW || b.h > RULES.maxH || a > RULES.maxArea) return 'cap';
    const others = tearsOf(inst).filter((t) => t.id !== ignoreId);
    if (!ignoreId && others.length >= RULES.maxTears) return 'cap';
    if (others.reduce((s, t) => s + t.area, 0) + a > sheet.w * sheet.h * RULES.maxTotal) return 'cap';
    if (protectRects(inst).some((z) => overlaps(b, z))) return 'protected';
    return null;
  }
  function userBusy(inst, pts) {
    const now = Date.now();
    if (now - st.sheetSince < RULES.openGrace || now - st.lastKey < RULES.keyGap) return true;
    const b = bbox(pts), g = RULES.pointerGap, p = S.pointer;
    if (p.x >= b.x - g && p.x <= b.x + b.w + g && p.y >= b.y - g && p.y <= b.y + b.h + g) return true;
    const active = inst.shadow?.activeElement;
    return !!active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
  }

  // ---------------------------------------------------------------- API (bound per instance in makeCtx)
  function file(inst, spec = {}) {
    const kind = String(spec.kind || '');
    if (!KINDS.has(kind)) throw new Error(`unknown ticket kind ${kind}`);
    const now = Date.now();
    const t = {
      id: 't' + (++seq), kind, x: +spec.x || 0, y: +spec.y || 0, r: +spec.r || 0,
      sev: [1, 2, 3].includes(spec.sev) ? spec.sev : 1, label: String(spec.label || '').slice(0, 60),
      layer: spec.layer === 'front' ? 'front' : 'back', by: { id: inst.id, widget: inst.manifest.id },
      claimedBy: null, progress: 0, born: now, expiresAt: now + Math.max(20000, +spec.ttl || TTL[kind] || 120000),
      busy: false, sheet: null, points: null, area: 0,
    };
    if (kind === 'tear') {
      const sheet = sheetInst();
      const pts = cleanPoints(spec.points);
      const reason = !sheet ? 'disabled' : checkTear(sheet, pts) || (userBusy(sheet, pts) ? 'busy' : null);
      if (reason) { broadcast('ticket', { type: 'reject', ticket: { kind, by: t.by, reason } }); return { rejected: reason }; }
      Object.assign(t, { sheet: sheet.id, base: pts, points: pts, area: area(pts), ledge: ledgeOf(pts), lastUpdate: now });
      [t.x, t.y] = centroid(pts);
    }
    tickets.set(t.id, t);
    if (kind === 'tear') render(sheetInst());
    emit('open', t);
    return pub(t);
  }

  function update(inst, id, patch = {}) {
    const t = tickets.get(id);
    if (!t || t.by.id !== inst.id || t.mending) return false;
    const now = Date.now();
    if (patch.points && t.kind === 'tear') {
      if (now - t.lastUpdate < RULES.minUpdateMs) return false;
      const sheet = S.instances.get(t.sheet);
      const pts = cleanPoints(patch.points);
      if (!sheet || checkTear(sheet, pts, t.id)) return false;
      Object.assign(t, { base: pts, points: pts, area: area(pts), ledge: ledgeOf(pts), lastUpdate: now });
      [t.x, t.y] = centroid(pts);
      render(sheet);
    }
    const fields = t.kind === 'tear' ? ['label', 'sev', 'busy'] : ['x', 'y', 'label', 'sev', 'busy'];
    for (const k of fields) if (k in patch) t[k] = k === 'label' ? String(patch[k]).slice(0, 60) : patch[k];
    emit('update', t);
    return true;
  }

  function claim(inst, id) {
    const t = tickets.get(id);
    if (!t || t.mending || (t.claimedBy && t.claimedBy !== inst.id)) return false;
    t.claimedBy = inst.id;
    t.lastProgress = Date.now();
    emit('claim', t);
    return true;
  }

  function setProgress(t, p) {
    t.progress = Math.max(0, Math.min(1, p));
    t.lastProgress = Date.now();
    if (t.kind === 'tear' && t.progress < 1) {
      const [cx, cy] = centroid(t.base), k = 1 - t.progress;
      t.points = t.base.map(([x, y]) => [Math.round((cx + (x - cx) * k) * 10) / 10, Math.round((cy + (y - cy) * k) * 10) / 10]);
      t.area = area(t.points);
      t.ledge = ledgeOf(t.points);
      render(S.instances.get(t.sheet));
    }
  }

  function progress(inst, id, p) {
    const t = tickets.get(id);
    if (!t || t.claimedBy !== inst.id || t.mending) return false;
    setProgress(t, p);
    if (t.progress >= 1) return close(t, 'resolve', { by: inst.id });
    emit('progress', t);
    return true;
  }

  function resolve(inst, id, info = {}) {
    const t = tickets.get(id);
    // The claimer or the filer may resolve; an unclaimed ticket only by its filer.
    if (!t || (t.claimedBy ? t.claimedBy !== inst.id && t.by.id !== inst.id : t.by.id !== inst.id)) return false;
    return close(t, 'resolve', { ...info, by: inst.id });
  }

  function close(t, type, extra = {}) {
    tickets.delete(t.id);
    st.hover.delete(t.id);
    if (t.kind === 'tear') render(S.instances.get(t.sheet) || sheetInst());
    broadcast('ticket', { type, ticket: { ...pub(t), ...extra } });
    return true;
  }

  const list = (filter = {}) => [...tickets.values()].filter((t) => !filter.kind || t.kind === filter.kind).map(pub);

  // A tear nobody fixes is mended by the host itself, in three visible steps.
  function mend(t, type = 'expire') {
    if (t.mending) return;
    t.mending = true;
    [0.35, 0.7].forEach((p, i) => setTimeout(() => { if (tickets.has(t.id)) { setProgress(t, p); emit('progress', t); } }, 400 * (i + 1)));
    setTimeout(() => tickets.has(t.id) && close(t, type), 1200);
  }

  // ---------------------------------------------------------------- housekeeping
  setInterval(() => {
    if (!tickets.size) return;
    const now = Date.now();
    for (const t of [...tickets.values()]) {
      if (t.claimedBy && now - t.lastProgress > RULES.claimTimeout && !t.mending) { t.claimedBy = null; emit('release', t); }
      if (now > t.expiresAt) t.kind === 'tear' ? mend(t) : close(t, 'expire');
    }
  }, 500);

  return {
    file, update, claim, progress, resolve, list, sheetInfo, inPolygon,
    noteKey() { st.lastKey = Date.now(); },
    // The pointer wins: hovering a hole for 1.2 s or clicking it makes the tear urgent.
    notePointer(x, y, down) {
      const now = Date.now();
      for (const t of tickets.values()) {
        if (t.kind !== 'tear' || t.sev === 3) continue;
        if (!inPolygon(x, y, t.points)) { st.hover.delete(t.id); continue; }
        if (!st.hover.has(t.id)) st.hover.set(t.id, now);
        if (down || now - st.hover.get(t.id) > 1200) {
          t.sev = 3;
          t.expiresAt = Math.min(t.expiresAt, now + 2500);
          emit('update', t);
        }
      }
    },
    sheetChanged(inst, on) {
      if (on) st.sheetSince = Date.now();
      else for (const t of [...tickets.values()]) if (t.kind === 'tear' && t.sheet === inst.id) close(t, 'resolve', { reason: 'sheet-closed' });
      if (!on) inst.el.style.clipPath = '';
      broadcast('sheet', sheetInfo());
    },
    instanceGone(inst) {
      for (const t of [...tickets.values()]) {
        if (t.claimedBy === inst.id) { t.claimedBy = null; emit('release', t); }
        if (t.by.id === inst.id && t.kind !== 'tear') close(t, 'expire');
      }
    },
  };
}
