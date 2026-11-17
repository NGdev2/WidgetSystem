#!/usr/bin/env python3
"""Composite a transparent widget-layer snapshot onto the backdrop.
Usage: compose.py snapshot.png backdrop.png out.png [x y w h]   (optional crop, then saved as-is)"""
import sys

from PIL import Image

snap, back, out = sys.argv[1:4]
layer = Image.open(snap).convert("RGBA")
bg = Image.open(back).convert("RGBA").resize(layer.size)
bg.alpha_composite(layer)
if len(sys.argv) == 8:
    x, y, w, h = map(int, sys.argv[4:8])
    bg = bg.crop((x, y, x + w, y + h))
bg.convert("RGB").save(out, optimize=True)
print(out)
