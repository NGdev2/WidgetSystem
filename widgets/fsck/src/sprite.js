// fsck's look: a small maintenance daemon drawn on a canvas. It is redrawn only when its visual
// state (face, LED, arms, wheel phase, ...) changes, never on idle frames.
export const W = 64, H = 80;        // css px; the wheel touches the ground at (W/2, H - 2)

const FACES = { idle: 'o o', strain: '> <', done: '^ ^', sad: '. .', sleep: '- -', crash: 'x x', dizzy: '@ @', look: 'o o' };
const LED = { green: '#4dff7a', amber: '#ffb000', red: '#ff4d4d', blue: '#5aa0ff', off: '#3a3f4b' };

const PAL = {
  classic: { body: '#3b404c', bodyEdge: '#252931', bezel: '#2a2f39', screen: '#0b1a10', glyph: '#6dff8a', hat: '#ffb000', brim: '#d98f00', arm: '#8a909c', edge: null },
  neon: { body: '#1a070b', bodyEdge: '#ff5d55', bezel: '#14060a', screen: '#071318', glyph: '#5ef6ff', hat: '#ff9a1f', brim: '#ff5d55', arm: '#ff8178', edge: '#ff5d55' },
};

/** s: {face, led, stat, arm: 'down'|'up'|'work'|'fan', wheel (0..1), skin, progress (0..1), squish, pad, flip} */
export function drawFsck(g, s) {
  const p = PAL[s.skin] || PAL.classic;
  g.clearRect(0, 0, W, H);
  g.save();
  if (s.flip) { g.translate(W, 0); g.scale(-1, 1); }
  if (s.squish && s.squish !== 1) { g.translate(0, H - 2); g.scale(1, s.squish); g.translate(0, -(H - 2)); }

  // hover pad (maintenance platform) when working off the ground
  if (s.pad) {
    g.fillStyle = p.edge ? '#5ef6ff' : '#9aa3b2';
    g.fillRect(12, H - 4, W - 24, 2);
    g.fillStyle = p.edge ? 'rgba(94,246,255,.45)' : 'rgba(255,190,80,.6)';
    for (const x of [18, W - 18]) { g.beginPath(); g.moveTo(x - 3, H - 2); g.lineTo(x + 3, H - 2); g.lineTo(x, H + 3); g.fill(); }
  }

  // wheel
  const wy = H - 9;
  g.fillStyle = '#20232a';
  g.beginPath(); g.arc(32, wy, 7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.edge ? '#ff5d55' : '#6b7280'; g.lineWidth = 1.2;
  g.beginPath(); g.arc(32, wy, 6.2, 0, Math.PI * 2); g.stroke();
  const a = (s.wheel || 0) * Math.PI * 2;
  g.beginPath();
  for (let i = 0; i < 3; i++) { const t = a + (i * Math.PI * 2) / 3; g.moveTo(32, wy); g.lineTo(32 + Math.cos(t) * 5.5, wy + Math.sin(t) * 5.5); }
  g.stroke();

  // body + hi-vis plate (the readability anchor: always yellow with "fsck")
  roundRect(g, 18, 40, 28, 23, p.edge ? 0 : 4, p.body, p.bodyEdge);
  if (p.edge) chamferStroke(g, 18, 40, 28, 23, 5, p.edge);
  g.fillStyle = '#fcee0a';
  g.fillRect(19, 43, 26, 11);
  g.strokeStyle = '#16060a'; g.lineWidth = 1; g.strokeRect(19.5, 43.5, 25, 10);
  g.fillStyle = '#16060a';
  g.font = 'bold 9.5px "Share Tech Mono", ui-monospace, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('fsck', 32, 49);
  g.fillStyle = 'rgba(230,236,245,.85)';               // reflective stripes
  g.fillRect(20, 57, 24, 1.5); g.fillRect(20, 60, 24, 1.5);

  // arms: wrench (left), tape roll (right)
  const pose = { down: [[12, 57], [52, 57]], up: [[10, 35], [54, 35]], work: [[7, 45], [57, 45]], fan: [[8, 38], [56, 52]] }[s.arm] || [[12, 57], [52, 57]];
  g.strokeStyle = p.arm; g.lineWidth = 2.4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(19, 45); g.lineTo(pose[0][0], pose[0][1]); g.moveTo(45, 45); g.lineTo(pose[1][0], pose[1][1]); g.stroke();
  // wrench
  g.strokeStyle = '#c3c9d4'; g.lineWidth = 2;
  const [wx, wy2] = pose[0];
  g.beginPath(); g.moveTo(wx, wy2); g.lineTo(wx - 4, wy2 - 5); g.stroke();
  g.beginPath(); g.arc(wx - 5, wy2 - 6.5, 2.2, 0.6, Math.PI * 1.7); g.stroke();
  // tape roll
  const [tx, ty] = pose[1];
  g.fillStyle = '#fcee0a'; g.beginPath(); g.arc(tx + 2, ty, 4.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#16060a'; g.beginPath(); g.arc(tx + 2, ty, 1.8, 0, Math.PI * 2); g.fill();

  // head: a small CRT
  roundRect(g, 19, 21, 26, 19, p.edge ? 0 : 3, p.bezel, p.edge || '#171a20');
  g.fillStyle = p.screen; g.fillRect(22, 24, 20, 13);
  g.fillStyle = p.glyph;
  g.font = 'bold 8.5px "Share Tech Mono", ui-monospace, monospace';
  if (s.face === 'work') {
    const n = Math.round((s.progress || 0) * 5);
    g.font = '7px "Share Tech Mono", ui-monospace, monospace';
    g.fillText('[' + '#'.repeat(n) + '.'.repeat(5 - n) + ']', 32, 31);
  } else {
    g.fillText(FACES[s.face] || FACES.idle, 32, 29.5);
    g.fillRect(30, 33, 4, 1.4);                         // the cursor mouth
  }
  g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(22, 24, 20, 2);   // scanline glint

  // hard hat + status LED
  g.fillStyle = p.hat;
  g.beginPath(); g.ellipse(32, 21, 13, 8.5, 0, Math.PI, 0); g.fill();
  g.fillStyle = p.brim; g.fillRect(16, 20, 32, 2.6);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(31, 13, 2, 7);
  g.fillStyle = LED[s.led] || LED.green;
  g.beginPath(); g.arc(41, 14.5, 2.1, 0, Math.PI * 2); g.fill();
  g.restore();

  // ps STAT letter (never mirrored)
  g.fillStyle = s.skin === 'neon' ? '#ff8178' : '#9aa3b2';
  g.font = '8px "Share Tech Mono", ui-monospace, monospace';
  g.textAlign = 'left';
  g.fillText(s.stat || 'S', s.flip ? 6 : 50, 13);
}

function roundRect(g, x, y, w, h, r, fill, stroke) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
}

function chamferStroke(g, x, y, w, h, c, color) {
  g.beginPath();
  g.moveTo(x + 0.5, y + 0.5); g.lineTo(x + w - c, y + 0.5); g.lineTo(x + w - 0.5, y + c);
  g.lineTo(x + w - 0.5, y + h - 0.5); g.lineTo(x + c, y + h - 0.5); g.lineTo(x + 0.5, y + h - c); g.closePath();
  g.strokeStyle = color; g.lineWidth = 1; g.stroke();
}
