"""STEP 2a - per-part DEPTH MAPS for an accurate blockout.
Every blockout piece must match the artwork exactly, so each piece is built from ITS OWN
silhouette. A distance transform of each part mask gives a rounded depth profile, so the
piece has real volume instead of being a flat slab - and its outline is pixel-accurate to
the drawing. Runs in the Hunyuan venv (needs scipy).
"""
import numpy as np, os, json
from PIL import Image
from scipy import ndimage
BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
info = json.load(open(os.path.join(BASE, "parts_info.json")))

# the visible SKIN (face, hands, feet) is whatever the garment/prop masks do not claim
alpha = np.asarray(Image.open(os.path.join(BASE, "source_clean_rgba.png")))[:, :, 3] > 128
claimed = np.zeros_like(alpha)
for p in info["visible_parts"]:
    m = np.asarray(Image.open(os.path.join(BASE, p["mask"])).convert("L")) > 127
    claimed |= m
skin = alpha & ~claimed
skin = ndimage.binary_opening(skin, np.ones((3, 3)))
lbl, n = ndimage.label(skin)
sizes = ndimage.sum(skin, lbl, range(1, n + 1)) if n else []
out = []
for i in range(n):
    if sizes[i] < 1500:
        continue
    blob = lbl == (i + 1)
    ys, xs = np.where(blob)
    nm = "skin_%d" % (i + 1)
    Image.fromarray((blob * 255).astype(np.uint8)).save(os.path.join(BASE, "g_%s_mask.png" % nm))
    out.append({"name": nm, "mask": "g_%s_mask.png" % nm, "part_type": "body",
                "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                "area": int(blob.sum())})
print("SKIN parts found:", [(o["name"], o["area"]) for o in out])

allparts = info["visible_parts"] + out
for p in allparts:
    m = np.asarray(Image.open(os.path.join(BASE, p["mask"])).convert("L")) > 127
    d = ndimage.distance_transform_edt(m)
    if d.max() > 0:
        d = d / d.max()
    d = np.sqrt(np.clip(d, 0, 1))          # dome profile: full at the centre, 0 at the edge
    Image.fromarray((d * 255).astype(np.uint8)).save(os.path.join(BASE, "d_%s.png" % p["name"]))
info["blockout_parts"] = allparts
json.dump(info, open(os.path.join(BASE, "parts_info.json"), "w"), indent=2)
print("DEPTHMAPS written for %d parts: %s" % (len(allparts), [p["name"] for p in allparts]))
