"""Encode the three game clips like tcg-activity/public/tear_open.webp (800 x 1120, 60 ms frames).

Settings chosen by measurement (2026-10-07):
- idle_loop.webp: quality 40, alpha 100 (loops forever; 25 frames = 1.5 s)
- open.webp:      quality 22, alpha 72  (plays once). Alpha below ~72 bands the soft glows.
- open_rare.webp: quality 30, alpha 75  (plays once; rainbow rays + stars, D-96/D-98)
minimize_size merges identical frames, so a clip can have fewer frames than PNGs; the
total length stays the same.

Run:
  py -3.14 encode_game.py --normal <frames dir> --rare <frames_rare dir> --out <dir>
<frames dir> has idle/f_*.png, open/f_*.png and seam_check_next.png (pack_open.py ... game);
<frames_rare dir> has open/f_*.png (pack_open.py ... game rare).
It also prints the seamless-loop check: the frame after the loop must equal frame 1.
"""
import argparse
import glob
import os

from PIL import Image, ImageChops, ImageStat

CLIPS = (  # (source, clip folder, output, loop (0 = forever, 1 = once), quality, alpha quality)
    ("normal", "idle", "idle_loop.webp", 0, 40, 100),
    ("normal", "open", "open.webp", 1, 22, 72),
    ("rare", "open", "open_rare.webp", 1, 30, 75),
)
FRAME_MS = 60


def frames(d):
    fs = sorted(glob.glob(os.path.join(d, "f_*.png")))
    if not fs:
        raise SystemExit(f"no frames in {d}")
    return [Image.open(f).convert("RGBA") for f in fs]


def diff(a, b):
    return round(sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 4, 3)


def encode(src, out):
    os.makedirs(out, exist_ok=True)
    for key, clip, name, loop, q, aq in CLIPS:
        fr = frames(os.path.join(src[key], clip))
        path = os.path.join(out, name)
        fr[0].save(path, save_all=True, append_images=fr[1:], duration=FRAME_MS, loop=loop, format="WEBP",
                   method=6, quality=q, alpha_quality=aq, minimize_size=True, allow_mixed=True)
        print(f"{name}: {os.path.getsize(path)} bytes, {len(fr)} source frames, {len(fr) * FRAME_MS} ms, {fr[0].size}")
    idle = frames(os.path.join(src["normal"], "idle"))
    steps = [diff(idle[i], idle[i + 1]) for i in range(len(idle) - 1)]
    nxt = Image.open(os.path.join(src["normal"], "seam_check_next.png")).convert("RGBA")
    seam = diff(nxt, idle[0])
    print(f"idle loop: step diff {min(steps)}-{max(steps)} | last->first {diff(idle[-1], idle[0])} | next-after-loop vs first {seam}")
    return seam


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Encode the idle, open and rare open WebPs.")
    ap.add_argument("--normal", required=True)
    ap.add_argument("--rare", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    encode({"normal": a.normal, "rare": a.rare}, a.out)
