const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD

export function mount(ctx) {
  let tasks = ctx.storage.get('tasks', [
    { id: 1, text: 'Drink water', daily: true, done: false },
    { id: 2, text: 'Plan the day', daily: true, done: false },
  ]);
  const save = () => ctx.storage.set('tasks', tasks);

  // New day: daily tasks come back unchecked, finished one-off tasks disappear.
  function rollover() {
    if (ctx.storage.get('day') === today()) return;
    tasks = tasks.filter((t) => t.daily || !t.done).map((t) => ({ ...t, done: false }));
    ctx.storage.set('day', today());
    save();
  }

  ctx.root.innerHTML = `<div class="wrap">
    <div class="head">
      <svg class="ring" viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" stroke-dasharray="113.1" stroke-dashoffset="113.1"/></svg>
      <div><div class="count"></div><div class="sub ws-muted"></div></div>
    </div>
    <ul></ul>
    <form><input class="ws-input" placeholder="Add a task…  (prefix * for daily)" maxlength="140"><button class="ws-btn primary">+</button></form>
  </div>`;
  const ul = ctx.root.querySelector('ul');
  const input = ctx.root.querySelector('input');

  function render(enterId) {
    const done = tasks.filter((t) => t.done).length;
    ctx.root.querySelector('.count').textContent = `${done} / ${tasks.length}`;
    ctx.root.querySelector('.sub').textContent = tasks.length && done === tasks.length ? 'All done. Nice!' : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    ctx.root.querySelector('.fg').style.strokeDashoffset = 113.1 * (1 - (tasks.length ? done / tasks.length : 0));
    ul.innerHTML = tasks.length ? '' : '<div class="empty">Nothing planned. Enjoy the day ☀️</div>';
    for (const t of tasks) {
      const li = document.createElement('li');
      li.className = (t.done ? 'done ' : '') + (t.id === enterId ? 'enter' : '');
      li.innerHTML = `<input type="checkbox" class="ws-check" ${t.done ? 'checked' : ''}><span class="text"></span><span class="tag ${t.daily ? 'on' : ''}" title="Repeat daily">daily</span><button class="del" title="Delete">×</button>`;
      li.querySelector('.text').textContent = t.text;
      li.querySelector('input').onchange = (e) => toggle(t, e.target);
      li.querySelector('.tag').onclick = () => { t.daily = !t.daily; save(); render(); };
      li.querySelector('.del').onclick = () => { tasks = tasks.filter((x) => x !== t); save(); render(); };
      ul.append(li);
    }
  }

  function toggle(t, box) {
    t.done = box.checked;
    save();
    if (t.done) {
      const r = box.getBoundingClientRect();
      ctx.particles.burst({ preset: 'sparkles', x: r.left + r.width / 2, y: r.top + r.height / 2, count: 14 });
      if (ctx.settings.celebrate && tasks.every((x) => x.done)) {
        const f = ctx.frame.getRect();
        ctx.after(250, () => ctx.particles.burst({ preset: 'confetti', x: f.x + f.w / 2, y: f.y + 40 }));
      }
    }
    render();
  }

  ctx.root.querySelector('form').onsubmit = (e) => {
    e.preventDefault();
    let text = input.value.trim();
    if (!text) return;
    const daily = text.startsWith('*');
    if (daily) text = text.slice(1).trim();
    const t = { id: Date.now(), text, daily, done: false };
    tasks.push(t);
    input.value = '';
    save();
    render(t.id);
  };

  // Other widgets / scripts can add tasks: widgetctl send tasks '{"add":"Buy milk"}'
  ctx.on('message', ({ data }) => {
    if (data && data.add) { tasks.push({ id: Date.now(), text: String(data.add), daily: !!data.daily, done: false }); save(); render(); }
  });

  ctx.every(60_000, () => {
    rollover();
    render();
    const now = new Date();
    const left = tasks.filter((t) => !t.done).length;
    if (ctx.settings.remind && now.getHours() === 20 && now.getMinutes() === 0 && left)
      ctx.host.notify('Today', `${left} task${left > 1 ? 's' : ''} left for today`);
  });
  ctx.menu.add({ icon: '🧹', label: 'Clear finished', action: () => { tasks = tasks.filter((t) => !t.done || t.daily); save(); render(); } });

  rollover();
  render();
}
