#!/usr/bin/env python3
"""Generate a neutral Night Cron backdrop for screenshots: dark sky, a skyline with lit windows,
and a glowing perspective grid. Usage: tools/make_backdrop.py out.png [width height]"""
import random
import sys

from PIL import Image, ImageDraw, ImageFilter


def backdrop(w=1920, h=1080, seed=2077):
    rnd = random.Random(seed)
    img = Image.new("RGB", (w, h))
    px = img.load()
    horizon = int(h * 0.68)
    for y in range(h):                                  # sky: near-black maroon to a red glow at the horizon
        t = min(1, y / horizon)
        r, g, b = int(12 + 70 * t ** 3), int(5 + 10 * t ** 3), int(10 + 22 * t ** 3)
        if y > horizon:
            k = (y - horizon) / (h - horizon)
            r, g, b = int(28 - 16 * k), int(8 - 4 * k), int(16 - 6 * k)
        for x in range(w):
            px[x, y] = (r, g, b)
    d = ImageDraw.Draw(img)
    for layer, (shade, hmin, hmax) in enumerate([((34, 12, 20), 120, 260), ((22, 8, 14), 160, 360)]):   # skyline
        x = -20
        while x < w:
            bw = rnd.randint(40, 120)
            bh = rnd.randint(hmin, hmax)
            d.rectangle([x, horizon - bh, x + bw, horizon], fill=shade)
            for wy in range(horizon - bh + 10, horizon - 8, 14):
                for wx in range(x + 6, x + bw - 6, 10):
                    if rnd.random() < (0.10 if layer else 0.05):
                        d.rectangle([wx, wy, wx + 3, wy + 5], fill=rnd.choice([(255, 93, 85), (94, 246, 255), (252, 238, 10)]))
            x += bw + rnd.randint(0, 18)
    glow = Image.new("RGB", (w, h))
    gd = ImageDraw.Draw(glow)
    cx = w // 2
    for i in range(-24, 25):                            # perspective grid on the floor
        gd.line([(cx + i * 40, horizon), (cx + i * 260, h)], fill=(255, 70, 60), width=2)
    y, step = horizon, 6
    while y < h:
        gd.line([(0, y), (w, y)], fill=(94, 246, 255) if (y - horizon) % 5 == 0 else (255, 70, 60), width=1)
        y += step
        step = int(step * 1.18) + 1
    gd.line([(0, horizon), (w, horizon)], fill=(255, 120, 100), width=3)
    img = Image.blend(img, Image.composite(glow, img, glow.convert("L").point(lambda v: 160 if v else 0)), 0.55)
    img = Image.composite(img.filter(ImageFilter.GaussianBlur(1.2)), img, Image.new("L", (w, h), 90))
    return img


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "backdrop.png"
    w, h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1920, 1080)
    backdrop(w, h).save(out)
    print(out)
