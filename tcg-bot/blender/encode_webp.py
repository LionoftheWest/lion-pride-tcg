"""Assemble a rarity's PNG frame sequence into a looping animated WebP.

Run:
  python blender/encode_webp.py <rarity>
"""
import glob
import os
import sys
from PIL import Image

rarity = sys.argv[1] if len(sys.argv) > 1 else "gold"
FRAMES = rf"C:\Users\vaugh\discord\tcg-bot\blender\out\frames_{rarity}"
OUT = rf"C:\Users\vaugh\discord\tcg-bot\blender\out\{rarity}.webp"

files = sorted(glob.glob(os.path.join(FRAMES, "f_*.png")))
frames = [Image.open(f).convert("RGBA") for f in files]

frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=60,
    loop=0,
    format="WEBP",
    method=6,
    quality=80,
)
print("SAVED", OUT, os.path.getsize(OUT), "bytes,", len(frames), "frames")
