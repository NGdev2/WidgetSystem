const fmtRate = (b) => (b > 1e6 ? (b / 1e6).toFixed(1) + ' MB/s' : (b / 1e3).toFixed(0) + ' kB/s');

export function mount(ctx) {
  ctx.root.innerHTML = `<div class="grid">
    ${['cpu', 'mem', 'bat', 'net'].map((k) => `<div class="m" data-k="${k}"><div class="l"><span>${{ cpu: 'CPU', mem: 'Memory', bat: 'Battery', net: 'Network' }[k]}</span><span class="x"></span></div><div class="v">–</div><div class="bar"><i style="width:0"></i></div></div>`).join('')}
  </div>`;
  const last = {};
  const set = (k, value, pct, extra = '') => {
    const width = Math.round(Math.max(0, Math.min(100, pct))) + '%';
    const key = value + '|' + extra + '|' + width;
    if (last[k] === key) return; // skip the repaint when nothing visible changed
    last[k] = key;
    const el = ctx.root.querySelector(`[data-k=${k}]`);
    el.querySelector('.v').textContent = value;
    el.querySelector('.x').textContent = extra;
    const bar = el.querySelector('.bar i');
    bar.style.width = width;
    bar.classList.toggle('hot', k === 'bat' ? pct < 15 : pct > 85);
  };
  async function tick() {
    try {
      const s = await ctx.host.stats();
      set('cpu', s.cpu.toFixed(0) + '%', s.cpu, s.temp ? s.temp.toFixed(0) + '°' : '');
      set('mem', s.mem.percent.toFixed(0) + '%', s.mem.percent, (s.mem.used / 2 ** 30).toFixed(1) + 'G');
      if (s.battery) set('bat', s.battery.percent + '%', s.battery.percent, s.battery.status === 'Charging' ? '⚡' : '');
      else set('bat', 'AC', 100);
      set('net', fmtRate(s.net.rx), Math.min(100, (s.net.rx / 5e6) * 100), '↑' + fmtRate(s.net.tx));
    } catch (e) {
      ctx.log('stats failed', String(e));
    }
  }
  tick();
  ctx.every(2000, tick);
}
