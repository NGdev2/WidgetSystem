const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function mount(ctx) {
  let mode = null;   // which DOM is built: 'digital' | 'analog'
  let lastText = '';

  function dateText(now) {
    if (ctx.theme.name === 'night-cron') return `${DAYS[now.getDay()]} ${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
    return now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function build(m) {
    mode = m;
    lastText = '';
    const micro = '<div class="ws-micro"><i class="bars"></i><span class="grow"></span></div>';
    if (m === 'analog') {
      ctx.root.innerHTML = `<div class="clock"><div class="analog"><svg viewBox="0 0 100 100">
        <circle class="face-c" cx="50" cy="50" r="47"/>
        ${Array.from({ length: 12 }, (_, i) => {
          const a = (i * Math.PI) / 6;
          return `<line class="tick" x1="${50 + Math.sin(a) * 40}" y1="${50 - Math.cos(a) * 40}" x2="${50 + Math.sin(a) * 44}" y2="${50 - Math.cos(a) * 44}" stroke-width="${i % 3 ? 1.5 : 3}"/>`;
        }).join('')}
        <line class="hand h" x1="50" y1="50" x2="50" y2="27" stroke-width="4"/>
        <line class="hand m" x1="50" y1="50" x2="50" y2="16" stroke-width="2.6"/>
        <line class="hand s" x1="50" y1="56" x2="50" y2="12" stroke-width="1.2"/>
        <circle cx="50" cy="50" r="2.6" fill="var(--ws-accent)"/></svg>
        <div><div class="d1"></div><div class="date"></div></div></div>${micro}</div>`;
    } else {
      ctx.root.innerHTML = `<div class="clock"><div class="face"><div class="time"></div><div class="date"></div></div>${micro}</div>`;
    }
  }

  // Only touch the DOM when the visible text changes (the layer repaints on every change).
  function render() {
    const s = ctx.settings;
    const now = new Date();
    const expanded = ctx.frame.isExpanded();
    const want = s.mode === 'analog' && !expanded ? 'analog' : 'digital';
    if (want !== mode) build(want);
    ctx.root.querySelector('.clock').classList.toggle('expanded', expanded);
    const date = dateText(now);
    const mt = ctx.ui.micro();

    if (mode === 'analog') {
      const sec = now.getSeconds(), min = now.getMinutes() + sec / 60, hr = (now.getHours() % 12) + min / 60;
      ctx.root.querySelector('.h').style.transform = `rotate(${hr * 30}deg)`;
      ctx.root.querySelector('.m').style.transform = `rotate(${min * 6}deg)`;
      ctx.root.querySelector('.s').style.transform = `rotate(${sec * 6}deg)`;
      ctx.root.querySelector('.d1').textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
    } else {
      let h = now.getHours(), ampm = '';
      if (!s.h24) { ampm = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
      const showSec = s.seconds || expanded;
      const html = `${s.h24 ? pad(h) : h}:${pad(now.getMinutes())}${showSec ? `<span class="sec">${pad(now.getSeconds())}</span>` : ''}${ampm ? `<span class="ampm">${ampm}</span>` : ''}`;
      if (html !== lastText) { ctx.root.querySelector('.time').innerHTML = html; lastText = html; }
    }
    const d = ctx.root.querySelector('.date');
    if (d.textContent !== date) d.textContent = date;
    const g = ctx.root.querySelector('.ws-micro .grow');
    if (g.textContent !== mt.text) { g.textContent = mt.text; g.title = mt.title; }
  }

  render();
  ctx.every(1000, render); // cheap: render() writes to the DOM only when the visible text changed
  for (const ev of ['settings', 'expand', 'collapse', 'theme']) ctx.on(ev, () => { mode = null; render(); });
  ctx.menu.add({ icon: '◷', label: 'Toggle analog / digital', action: () => ctx.setSetting('mode', ctx.settings.mode === 'analog' ? 'digital' : 'analog') });
}
