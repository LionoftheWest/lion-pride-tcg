"""Build the pack wrapper textures from the brand assets.

FRONT = deep background + full-bleed spiral + the lion crest badge in the centre.
BACK  = the same background + spiral, with NO crest (just the swirl).

Both are 1000x1889 — the pack front aspect (0.54 : 1.02) — so a circular badge
stays a circle when projected onto the tall pouch (no oval stretch).
"""
from PIL import Image, ImageDraw, ImageChops
import numpy as np
import os

HERE = os.path.dirname(__file__)
ASSETS = os.path.join(HERE, "..", "assets")
W, H = 1000, 1889


def dark_bg(w, h):
    # Deep purple-black radial gradient, a touch brighter in the middle so the
    # crest reads and the swirl has depth.
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    r = np.clip(r, 0, 1)
    mid = np.array([44, 18, 58]);  edge = np.array([9, 5, 15])
    col = (mid * (1 - r[..., None]) + edge * r[..., None]).astype("uint8")
    a = np.full((h, w, 1), 255, "uint8")
    return Image.fromarray(np.concatenate([col, a], 2), "RGBA")


def spiral_cover(w, h):
    # Scale the swirl to COVER the canvas (keeps it round) and centre-crop.
    sp = Image.open(os.path.join(ASSETS, "spiral_bg.png")).convert("RGBA")
    sw, sh = sp.size
    sc = max(w / sw, h / sh)
    sp = sp.resize((int(round(sw * sc)), int(round(sh * sc))), Image.LANCZOS)
    x = (sp.width - w) // 2;  y = (sp.height - h) // 2
    return sp.crop((x, y, x + w, y + h))


def crest_badge(diam):
    # Lift the finished lion badge (pink disc + white lion + white ring) straight
    # out of the card back, centred at (250,350) radius ~154, and circle-mask it.
    cb = Image.open(os.path.join(ASSETS, "card-back.png")).convert("RGBA")
    cx, cy, rad = 250, 350, 156
    crop = cb.crop((cx - rad, cy - rad, cx + rad, cy + rad)).resize((diam, diam), Image.LANCZOS)
    m = Image.new("L", (diam, diam), 0)
    ImageDraw.Draw(m).ellipse((0, 0, diam - 1, diam - 1), fill=255)
    crop.putalpha(ImageChops.multiply(crop.split()[3], m))
    return crop


back = dark_bg(W, H)
back.alpha_composite(spiral_cover(W, H))
back.save(os.path.join(HERE, "pack_back.png"))

front = back.copy()
badge = crest_badge(int(W * 0.5))
front.alpha_composite(badge, ((W - badge.width) // 2, (H - badge.height) // 2))
front.save(os.path.join(HERE, "pack_front.png"))
print("wrote pack_front.png + pack_back.png", (W, H))
