// Mochi: a demo creature for the WidgetSystem API. The widget box is its "nest"; the
// creature itself is an interactive overlay element that roams the whole desktop and
// uses other widgets as platforms.
const G = 1500;              // gravity px/s²
const PHRASES = ['hi!', 'nice wallpaper', '♪ la la la', 'what are we doing today?', 'boop', 'I like it up here',
  'don\'t forget to drink water', '*yawn*', 'you\'re doing great', 'is it snack time?'];

export function mount(ctx) {
  // ---------- stats (decay while the computer is off, too)
  const now = () => Date.now() / 1000;
  const st = ctx.storage.get('stats', { food: 80, fun: 80, energy: 90, t: now() });
  const decay = (sec) => {
    const k = sec / 3600;
    st.food = clamp(st.food - 9 * k);
    st.fun = clamp(st.fun - 12 * k);
    st.energy = clamp(st.energy + (pet.sleeping ? 30 : -6) * k);
  };
  const pet = { x: 0, y: 0, vx: 0, vy: 0, ground: false, dir: 1, target: null, sleeping: false, dragged: false, next: 2 };
  decay(Math.min(now() - st.t, 86400));
  st.t = now();
  const save = () => { st.t = now(); ctx.storage.set('stats', st); };

  // ---------- nest UI
  ctx.root.innerHTML = `<div class="nest">
    <div class="top"><span class="name"></span><span class="mood"></span></div>
    ${[['food', '🍎', '#ff9f43'], ['fun', '🎾', '#4f8cff'], ['energy', '⚡', '#2ecc71']]
      .map(([k, i, c]) => `<div class="stat" data-k="${k}"><span>${i}</span><div class="bar"><i style="background:${c}"></i></div></div>`).join('')}
    <div class="btns"><button class="ws-btn" data-a="feed" title="Feed">🍎</button><button class="ws-btn" data-a="play" title="Play">🎾</button><button class="ws-btn" data-a="call" title="Call home">🏠</button></div>
  </div>`;
  const renderNest = () => {
    ctx.root.querySelector('.name').textContent = ctx.settings.name;
    for (const k of ['food', 'fun', 'energy']) ctx.root.querySelector(`[data-k=${k}] i`).style.width = st[k] + '%';
    ctx.root.querySelector('.mood').textContent = pet.sleeping ? 'sleeping 💤' : mood() > 60 ? 'happy' : mood() > 30 ? 'okay' : 'needs you';
  };
  const mood = () => (st.food + st.fun + st.energy) / 3;

  // ---------- creature
  const el = ctx.overlay.create({ interactive: true, className: 'pet',
    html: '<div class="shadow"></div><div class="body"><div class="eye l"></div><div class="eye r"></div><div class="cheek l"></div><div class="cheek r"></div><div class="mouth"></div></div><div class="zzz">z</div>' });
  const body = el.querySelector('.body');
  const applyColor = () => el.style.setProperty('--c', ctx.settings.color);
  applyColor();

  let platforms = [];
  const updatePlatforms = (list = ctx.desktop.widgets()) => {
    platforms = list.filter((w) => !w.expanded).map((w) => w.rect);
  };
  updatePlatforms();
  ctx.on('layout', updatePlatforms);

  const floor = () => ctx.desktop.size().h;
  // Highest surface under x at or below y.
  const support = (x, y) => {
    let best = floor();
    for (const r of platforms) if (x > r.x + 8 && x < r.x + r.w - 8 && r.y >= y - 3 && r.y < best) best = r.y;
    return best;
  };
  const surfaceOf = (y) => platforms.find((r) => Math.abs(r.y - y) < 3 && pet.x > r.x && pet.x < r.x + r.w);

  // start on top of the nest
  const home = ctx.frame.getRect();
  pet.x = home.x + home.w / 2;
  pet.y = home.y;
  pet.ground = true;

  function jumpTo(x, y) {
    const T = 0.55 + Math.min(0.5, Math.abs(x - pet.x) / 1200);
    pet.vx = (x - pet.x) / T;
    pet.vy = (y - pet.y - 0.5 * G * T * T) / T;
    pet.ground = false;
    pet.dir = Math.sign(pet.vx) || pet.dir;
    squash(0.8, 1.2);
  }
  function squash(sx, sy) {
    body.style.transform = `scale(${sx},${sy})`;
    ctx.after(140, () => { body.style.transform = ''; });
  }

  function decide() {
    if (pet.sleeping) return;
    const r = Math.random();
    const speed = ctx.settings.speed;
    pet.next = (1.5 + Math.random() * 4) / speed;
    const surf = surfaceOf(pet.y);
    if (r < 0.35 && platforms.length) {
      // jump to another widget (or the floor)
      const opts = platforms.filter((p) => p !== surf && p.y > 60);
      const p = opts[(Math.random() * opts.length) | 0];
      if (p && Math.abs(p.x + p.w / 2 - pet.x) < 900) return jumpTo(p.x + 20 + Math.random() * (p.w - 40), p.y);
    }
    if (r < 0.8) {
      const lo = surf ? surf.x + 14 : 30, hi = surf ? surf.x + surf.w - 14 : ctx.desktop.size().w - 30;
      pet.target = lo + Math.random() * (hi - lo);
    } else if (r < 0.9 && ctx.settings.talk) {
      ctx.say(st.food < 30 ? 'I\'m hungry…' : st.fun < 30 ? 'play with me?' : PHRASES[(Math.random() * PHRASES.length) | 0], { anchor: el });
    }
  }

  let blinkT = 3, lastTf = '';
  ctx.raf((dt) => {
    if (!pet.dragged) {
      if (!pet.ground) {
        pet.vy += G * dt;
        const prevY = pet.y;
        pet.x += pet.vx * dt;
        pet.y += pet.vy * dt;
        const s = support(pet.x, prevY);
        if (pet.vy > 0 && pet.y >= s) {
          pet.y = s; pet.vy = 0; pet.vx = 0; pet.ground = true;
          squash(1.25, 0.75);
        }
      } else {
        const s = support(pet.x, pet.y);
        if (s > pet.y + 2) pet.ground = false;             // the platform moved away
        else pet.y = s;                                     // follow a platform being dragged
        if (pet.target != null) {
          const d = pet.target - pet.x;
          pet.dir = Math.sign(d) || pet.dir;
          pet.x += pet.dir * Math.min(Math.abs(d), 70 * ctx.settings.speed * dt);
          if (Math.abs(d) < 1) pet.target = null;
        } else if ((pet.next -= dt) <= 0) decide();
      }
      const W = ctx.desktop.size().w;
      if (pet.x < 20 || pet.x > W - 20) { pet.x = Math.max(20, Math.min(W - 20, pet.x)); pet.vx *= -0.5; pet.target = null; }
    }
    const walking = pet.ground && pet.target != null;
    const bob = walking ? Math.abs(Math.sin(performance.now() / 110)) * -4 : 0;
    // Only touch the DOM when something moved: any change repaints the whole layer.
    const tf = `translate(${pet.x.toFixed(1)}px, ${(pet.y + bob).toFixed(1)}px) scaleX(${pet.dir})`;
    if (tf !== lastTf) { el.style.transform = tf; lastTf = tf; }
    if ((blinkT -= dt) < 0 && !pet.sleeping) { el.classList.add('blink'); ctx.after(130, () => el.classList.remove('blink')); blinkT = 2 + Math.random() * 4; }
  }, { fps: 40 });

  // ---------- interaction: click = pet, drag = carry, double click = jump
  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = pet.dragged = true;
    if (pet.dragged) { pet.x = e.clientX; pet.y = e.clientY + 25; pet.ground = false; pet.vx = pet.vy = 0; pet.target = null; wake(); }
  });
  el.addEventListener('pointerup', () => {
    if (down && !down.moved) {
      wake();
      st.fun = clamp(st.fun + 6);
      ctx.particles.burst({ preset: 'hearts', x: pet.x, y: pet.y - 50 });
      squash(1.15, 0.85);
      if (Math.random() < 0.5 && ctx.settings.talk) ctx.say(['hehe', '♥', 'that tickles!', 'more!'][(Math.random() * 4) | 0], { anchor: el, duration: 1500 });
      save(); renderNest();
    } else if (pet.dragged && ctx.settings.talk) ctx.say('wheee!', { anchor: el, duration: 1000 });
    pet.dragged = false;
    down = null;
  });
  el.addEventListener('dblclick', () => { if (pet.ground) { pet.vy = -620; pet.ground = false; } });

  function wake() {
    if (!pet.sleeping) return;
    pet.sleeping = false;
    el.classList.remove('sleep');
    renderNest();
  }

  // ---------- care buttons
  const nest = () => ctx.frame.getRect();
  const actions = {
    feed() {
      wake();
      const n = nest();
      ctx.particles.burst({ emoji: '🍎', x: n.x + n.w / 2, y: n.y, count: 3, speed: 200, gravity: 800, life: 1, spread: 60, angle: -90 });
      jumpTo(n.x + n.w / 2, n.y);
      ctx.after(900, () => { st.food = clamp(st.food + 25); save(); renderNest(); ctx.say('nom nom', { anchor: el, duration: 1400 }); });
    },
    play() {
      wake();
      st.fun = clamp(st.fun + 20); st.energy = clamp(st.energy - 5);
      jumpTo(Math.max(40, Math.min(ctx.desktop.size().w - 40, pet.x + (Math.random() - 0.5) * 500)), floor());
      ctx.after(700, () => ctx.particles.burst({ preset: 'stars', x: pet.x, y: pet.y - 30 }));
      save(); renderNest();
    },
    call() { wake(); const n = nest(); jumpTo(n.x + n.w / 2, n.y); },
  };
  for (const b of ctx.root.querySelectorAll('[data-a]')) b.onclick = () => actions[b.dataset.a]();
  ctx.menu.add({ icon: '🏠', label: `Call ${ctx.settings.name} home`, action: actions.call });

  // other widgets / scripts:  widgetctl send pet '{"say":"hello"}'
  ctx.on('message', ({ data }) => {
    if (data?.say) ctx.say(String(data.say), { anchor: el, typing: true });
    if (data?.feed) actions.feed();
    if (data?.jump) jumpTo(pet.x, pet.y - 1);
  });
  ctx.on('settings', () => { applyColor(); renderNest(); });

  // ---------- life tick
  ctx.every(5000, () => {
    decay(5);
    const h = new Date().getHours();
    const sleepy = st.energy < 15 || ((h >= 23 || h < 7) && Math.random() < 0.1);
    if (sleepy && !pet.sleeping && pet.ground) { pet.sleeping = true; pet.target = null; el.classList.add('sleep'); }
    if (pet.sleeping && st.energy > 95) wake();
    el.classList.toggle('sad', mood() < 30);
    save();
    renderNest();
  });
  renderNest();
  ctx.after(1200, () => ctx.settings.talk && ctx.say(`hi, I'm ${ctx.settings.name}!`, { anchor: el, typing: true }));
}

function clamp(v) { return Math.max(0, Math.min(100, v)); }
