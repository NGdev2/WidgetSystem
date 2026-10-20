export function mount(ctx) {
  const pad = (n) => String(n).padStart(2, '0');

  function render() {
    const s = ctx.settings;
    const now = new Date();
    const expanded = ctx.frame.isExpanded();
    const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (s.mode === 'analog' && !expanded) {
      if (!ctx.root.querySelector('.analog')) {
        ctx.root.innerHTML = `<div class="analog"><svg viewBox="0 0 100 100">
          <circle class="face" cx="50" cy="50" r="47"/>
          ${Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return `<line class="tick" x1="${50 + Math.sin(a) * 40}" y1="${50 - Math.cos(a) * 40}" x2="${50 + Math.sin(a) * 44}" y2="${50 - Math.cos(a) * 44}" stroke-width="${i % 3 ? 1.5 : 3}"/>`;
          }).join('')}
          <line class="hand h" x1="50" y1="50" x2="50" y2="27" stroke-width="4"/>
          <line class="hand m" x1="50" y1="50" x2="50" y2="16" stroke-width="2.6"/>
          <line class="hand s" x1="50" y1="56" x2="50" y2="12" stroke-width="1.2"/>
          <circle cx="50" cy="50" r="2.6" fill="var(--ws-accent)"/></svg>
          <div class="side"><div class="d1"></div><div class="ws-muted d2"></div></div></div>`;
      }
      const sec = now.getSeconds() + now.getMilliseconds() / 1000;
      const min = now.getMinutes() + sec / 60;
      const hr = (now.getHours() % 12) + min / 60;
      ctx.root.querySelector('.h').style.transform = `rotate(${hr * 30}deg)`;
      ctx.root.querySelector('.m').style.transform = `rotate(${min * 6}deg)`;
      ctx.root.querySelector('.s').style.transform = `rotate(${Math.floor(sec) * 6}deg)`;
      ctx.root.querySelector('.d1').textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
      ctx.root.querySelector('.d2').textContent = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
      return;
    }
    let h = now.getHours();
    let ampm = '';
    if (!s.h24) { ampm = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; }
    ctx.root.innerHTML = `<div class="clock ${expanded ? 'expanded' : ''}">
      <div class="time">${s.h24 ? pad(h) : h}:${pad(now.getMinutes())}${s.seconds || expanded ? `<span class="sec">${pad(now.getSeconds())}</span>` : ''}${ampm ? `<span class="ampm">${ampm}</span>` : ''}</div>
      <div class="date">${date}</div></div>`;
  }

  render();
  ctx.every(1000, render);
  ctx.on('settings', () => { ctx.root.innerHTML = ''; render(); });
  ctx.on('expand', () => { ctx.root.innerHTML = ''; render(); });
  ctx.on('collapse', () => { ctx.root.innerHTML = ''; render(); });
  ctx.menu.add({ icon: '◷', label: 'Toggle analog / digital', action: () => ctx.setSetting('mode', ctx.settings.mode === 'analog' ? 'digital' : 'analog') });
}
