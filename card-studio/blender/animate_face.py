"""Headless: build the card scene and render the looping frames.

Run:
  blender --background --python animate_face.py -- <facePng> <framesOutDir> <rarity> [mask|-] [backPng]
"""
import bpy
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import card_scene  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
FACE = argv[0]
OUTDIR = argv[1]
rarity = argv[2] if len(argv) > 2 else "full_art"
mask = None if (len(argv) < 4 or argv[3] in ("-", "")) else argv[3]
back = argv[4] if (len(argv) > 4 and argv[4] not in ("-", "")) else None

card_scene.build(FACE, rarity, engine="CYCLES", mask_path=mask, back_path=back)

os.makedirs(OUTDIR, exist_ok=True)
# Clear any stale frames so a shorter render never inherits leftover frames
# from a previous, longer run (which the encoder would otherwise pick up).
import glob  # noqa: E402
for old in glob.glob(os.path.join(OUTDIR, "f_*.png")):
    os.remove(old)
bpy.context.scene.render.filepath = os.path.join(OUTDIR, "f_")
bpy.ops.render.render(animation=True)
print("ANIM FRAMES:", OUTDIR)
