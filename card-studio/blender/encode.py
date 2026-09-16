"""Assemble a frame folder into an animated WebP.

The front foil shimmer loops forever, so pass no loop count (default 0 =
infinite). Pass loops as argv[3] for a finite count.

Run:  python encode.py <framesDir> <outWebp> [loops]
"""
import glob
import os
import sys
from PIL import Image

frames_dir = sys.argv[1]
out = sys.argv[2]
loops = int(sys.argv[3]) if len(sys.argv) > 3 else 0

files = sorted(glob.glob(os.path.join(frames_dir, "f_*.png")))
frames = [Image.open(f).convert("RGBA") for f in files]

frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    duration=60,
    loop=loops,
    format="WEBP",
    method=6,
    quality=82,
)
print("WEBP", out, os.path.getsize(out), "bytes,", len(frames), "frames")
