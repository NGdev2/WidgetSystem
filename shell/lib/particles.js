// One full-window canvas shared by every widget. Runs only while particles are alive.
const PRESETS = {
  confetti: { count: 70, colors: ['#ff5d8f', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff'], shapes: ['rect', 'circle'],
    speed: 520, gravity: 900, life: 1.8, size: 7, spread: 70, angle: -90, spin: true },
  hearts: { count: 10, colors: ['#ff5d8f', '#ff8fab', '#ff4d6d'], shapes: ['heart'], speed: 140, gravity: -120,
    life: 1.6, size: 14, spread: 50, angle: -90, fade: true },
  sparkles: { count: 22, colors: ['#fff6c2', '#ffd166', '#ffffff'], shapes: ['star'], speed: 180, gravity: 0,
    life: 0.9, size: 8, spread: 360, angle: 0, fade: true, shrink: true },
  stars: { count: 16, colors: ['#ffd166', '#ffe599', '#fff'], shapes: ['star'], speed: 320, gravity: 600,
    life: 1.3, size: 11, spread: 120, angle: -90, spin: true },
  smoke: { count: 14, colors: ['rgba(220,220,230,0.7)', 'rgba(180,180,190,0.6)'], shapes: ['circle'], speed: 50,
    gravity: -60, life: 1.4, size: 16, spread: 360, angle: 0, fade: true, grow: true },
};

export class Particles {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = [];
    this.running = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = devicePixelRatio || 1;
    this.canvas.width = innerWidth * dpr;
    this.canvas.height = innerHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  burst(opts = {}) {
    const o = { ...PRESETS.sparkles, ...(PRESETS[opts.preset] || {}), ...opts };
    for (let i = 0; i < o.count; i++) {
      const a = ((o.angle + (Math.random() - 0.5) * o.spread) * Math.PI) / 180;
      const v = o.speed * (0.4 + Math.random() * 0.8);
      this.items.push({
        x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        g: o.gravity, life: o.life * (0.7 + Math.random() * 0.6), age: 0,
        size: o.size * (0.6 + Math.random() * 0.8),
        color: o.colors[(Math.random() * o.colors.length) | 0],
        shape: o.emoji ? 'emoji' : o.shapes[(Math.random() * o.shapes.length) | 0],
        emoji: o.emoji, rot: Math.random() * 6.28, vr: o.spin ? (Math.random() - 0.5) * 12 : 0,
        fade: o.fade, shrink: o.shrink, grow: o.grow,
      });
    }
    if (!this.running) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const c = this.ctx;
    c.clearRect(0, 0, innerWidth, innerHeight);
    this.items = this.items.filter((p) => (p.age += dt) < p.life);
    for (const p of this.items) {
      p.vy += p.g * dt;
      p.vx *= 0.99;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      const k = p.age / p.life;
      let s = p.size;
      if (p.shrink) s *= 1 - k;
      if (p.grow) s *= 1 + k * 1.5;
      c.globalAlpha = p.fade ? 1 - k : Math.min(1, (1 - k) * 3);
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.rot);
      c.fillStyle = p.color;
      drawShape(c, p.shape, s, p.emoji);
      c.restore();
    }
    c.globalAlpha = 1;
    if (this.items.length) requestAnimationFrame((t2) => this.frame(t2));
    else { this.running = false; c.clearRect(0, 0, innerWidth, innerHeight); }
  }
}

function drawShape(c, shape, s, emoji) {
  switch (shape) {
    case 'rect': c.fillRect(-s / 2, -s / 4, s, s / 2); break;
    case 'circle': c.beginPath(); c.arc(0, 0, s / 2, 0, 6.283); c.fill(); break;
    case 'emoji': c.font = `${s * 1.6}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(emoji, 0, 0); break;
    case 'heart': {
      const h = s / 2;
      c.beginPath();
      c.moveTo(0, h * 0.7);
      c.bezierCurveTo(-h * 1.6, -h * 0.4, -h * 0.5, -h * 1.4, 0, -h * 0.5);
      c.bezierCurveTo(h * 0.5, -h * 1.4, h * 1.6, -h * 0.4, 0, h * 0.7);
      c.fill();
      break;
    }
    case 'star': {
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.22 : s * 0.6;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      c.fill();
      break;
    }
  }
}
