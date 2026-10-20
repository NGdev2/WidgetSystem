// Frosted glass without compositor support: blur the wallpaper once (small canvas,
// box blur), then every glass frame shows the part of that image that is behind it.
export async function blurredWallpaper(url, radius = 28) {
  const img = new Image();
  img.src = url;
  await img.decode();
  // Work on a small copy: upscaling a pre-blurred thumbnail looks smooth and costs nothing.
  const W = 320;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const r = Math.max(1, Math.round((radius / 1920) * W * 2.2));
  const data = g.getImageData(0, 0, W, H);
  for (let pass = 0; pass < 3; pass++) {
    boxBlur(data.data, W, H, r, true);
    boxBlur(data.data, W, H, r, false);
  }
  saturate(data.data, 1.35);
  g.putImageData(data, 0, 0);
  return { url: c.toDataURL('image/jpeg', 0.9), width: img.naturalWidth, height: img.naturalHeight };
}

function boxBlur(px, W, H, r, horizontal) {
  const len = horizontal ? W : H;
  const lines = horizontal ? H : W;
  const buf = new Float32Array(len * 4);
  for (let l = 0; l < lines; l++) {
    const idx = (i) => 4 * (horizontal ? l * W + i : i * W + l);
    for (let i = 0; i < len; i++) {
      const o = idx(i);
      buf[i * 4] = px[o]; buf[i * 4 + 1] = px[o + 1]; buf[i * 4 + 2] = px[o + 2];
    }
    let sr = 0, sg = 0, sb = 0;
    const at = (i) => Math.min(len - 1, Math.max(0, i)) * 4;
    for (let i = -r; i <= r; i++) { const a = at(i); sr += buf[a]; sg += buf[a + 1]; sb += buf[a + 2]; }
    const n = 2 * r + 1;
    for (let i = 0; i < len; i++) {
      const o = idx(i);
      px[o] = sr / n; px[o + 1] = sg / n; px[o + 2] = sb / n;
      const add = at(i + r + 1), sub = at(i - r);
      sr += buf[add] - buf[sub]; sg += buf[add + 1] - buf[sub + 1]; sb += buf[add + 2] - buf[sub + 2];
    }
  }
}

function saturate(px, s) {
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    px[i] = l + (px[i] - l) * s;
    px[i + 1] = l + (px[i + 1] - l) * s;
    px[i + 2] = l + (px[i + 2] - l) * s;
  }
}
