"""SAM-driven segmenter (full capability): Segment Anything finds every distinct
layer; we detect the body plan + landmarks, then LABEL each SAM region (name / type /
sim) by zone + side + color, merge over-split duplicates, and emit the dynamic part
list + per-part cutouts. Drop-in replacement for parts_seg.py in the orchestrator."""
import numpy as np, os, sys, json
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\ml\Hunyuan3D-2")
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from scipy import ndimage
import torch
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
CKPT = r"C:\Users\vaugh\discord\card-studio\ml\sam\sam_vit_b_01ec64.pth"

im = Image.open(os.path.join(BASE, "source.png")).convert("RGB")
rgb = np.asarray(im).astype(np.uint8)
matte = np.asarray(BackgroundRemover()(im.convert("RGBA")))
char = ndimage.binary_fill_holes(matte[:, :, 3] > 128)
H, W = char.shape
ys, xs = np.where(char)
ix0, ix1, iy0, iy1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
chH = iy1 - iy0; chW = ix1 - ix0; cxc = int(np.median(xs))

# --- landmarks + body-plan from the silhouette (same as parts_seg) ---
def runs(rowmask):
    idx = np.where(rowmask)[0]
    if idx.size == 0: return []
    brk = np.where(np.diff(idx) > 1)[0]
    s = np.concatenate(([0], brk + 1)); e = np.concatenate((brk, [idx.size - 1]))
    return [(int(idx[a]), int(idx[b])) for a, b in zip(s, e)]
rr = [runs(char[y]) for y in range(H)]
row_w = np.array([sum(e - s + 1 for s, e in rr[y]) if rr[y] else 0 for y in range(H)])
maxw = max(1, row_w[iy0:iy1 + 1].max())
def yf(y): return (y - iy0) / max(1, chH)
leg_count = 0; hip_y = iy0 + int(chH * 0.55)
for y in range(iy1, iy0, -1):
    if yf(y) > 0.55 and len(rr[y]) >= 2 and leg_count == 0: leg_count = len(rr[y])
    if leg_count >= 2 and len(rr[y]) == 1: hip_y = y; break
shoulder_y = iy0 + int(chH * 0.2)
for y in range(iy0 + int(chH * 0.06), iy1):
    if row_w[y] >= 0.6 * maxw: shoulder_y = y; break
neck_y = iy0 + int(chH * 0.14)
body_plan = "biped" if (leg_count == 2 and chH > 1.2 * chW) else ("quadruped" if leg_count >= 4 else "unknown")
hint = os.environ.get("NINJA_PLAN", "").strip().lower()
if hint in ("biped", "quadruped", "bird", "serpent"): body_plan = hint

# --- SAM regions ---
device = "cuda" if torch.cuda.is_available() else "cpu"
try: sam = sam_model_registry["vit_b"](checkpoint=CKPT).to(device)
except RuntimeError: device = "cpu"; sam = sam_model_registry["vit_b"](checkpoint=CKPT).to("cpu")
gen = SamAutomaticMaskGenerator(sam, points_per_side=24, pred_iou_thresh=0.86,
                                stability_score_thresh=0.9, min_mask_region_area=1200)
masks = [m for m in gen.generate(rgb)
         if (m["segmentation"] & char).sum() / max(1, m["segmentation"].sum()) > 0.6 and m["segmentation"].sum() > 1800]
masks.sort(key=lambda m: -m["area"])

# --- partition: keep each SAM region DISTINCT; drop only nested unions/duplicates ---
masks.sort(key=lambda m: m["area"])         # smallest first -> keep fine parts, drop big unions
union = np.zeros((H, W), bool); kept = []
for m in masks:
    seg = m["segmentation"] & char
    excl = seg & ~union                     # exclusive (unclaimed) area of this region
    if excl.sum() < 1500: continue
    if excl.sum() / max(1, seg.sum()) < 0.5: continue   # mostly already covered = a union/dup
    kept.append(excl); union |= seg
resid = char & ~union                        # any uncovered skin/body -> a residual part
if resid.sum() > 0.012 * char.sum():
    lbl, n = ndimage.label(resid)
    for i in range(1, n + 1):
        blob = lbl == i
        if blob.sum() > 1500: kept.append(blob)

# --- merge WITHIN-part fragments: same zone + adjacent + similar color (a poncho's
# fold-shading fragments become one part; distinct parts stay separate) ---
def zof(seg):
    Y, _ = np.where(seg); my = Y.mean()
    return "head" if my < shoulder_y else ("torso" if my < hip_y else "legs")
metas = [{"seg": s, "col": rgb[s].mean(0), "zone": zof(s)} for s in kept]
changed = True
while changed:
    changed = False
    for i in range(len(metas)):
        if metas[i] is None: continue
        for j in range(i + 1, len(metas)):
            if metas[j] is None: continue
            A, Bm = metas[i], metas[j]
            if A["zone"] != Bm["zone"]: continue
            if np.linalg.norm(A["col"] - Bm["col"]) >= 26: continue   # same garment/material in a zone
            A["seg"] = A["seg"] | Bm["seg"]; A["col"] = rgb[A["seg"]].mean(0); metas[j] = None; changed = True
    metas = [m for m in metas if m]
kept = [m["seg"] for m in metas]

# --- label each region by zone + side + color (SAM did the separation) ---
def classify(col, zone, area):
    V = max(col) / 255; sat = (max(col) - min(col)) / 255
    if area < 0.015 * chH * chW and zone == "head": return "ear", "accessory", "rigid"
    if V > 0.6 and sat < 0.18: return ("face" if zone == "head" else "skin"), "body", "skin"
    return ("hood" if zone == "head" else zone), "garment", "cloth"
white = np.ones((H, W, 3), np.float32); used = {}; visible = []
for seg in sorted(kept, key=lambda s: -s.sum()):
    a = int(seg.sum()); Y, X = np.where(seg); cy = int(Y.mean()); cx = int(X.mean())
    col = rgb[seg].mean(0)
    zone = "head" if cy < shoulder_y else ("torso" if cy < hip_y else "legs")
    side = "L" if cx < cxc - 0.08 * chW else ("R" if cx > cxc + 0.08 * chW else "C")
    base, pt, sim = classify(col, zone, a)
    name = f"{base}_{side}"; n = used.get(name, 0); used[name] = n + 1
    if n: name = f"{name}{n+1}"
    # flat/thin fill-ratio -> extrude a thin mesh from the mask; big volumetric -> Hunyuan gen
    bw = X.max() - X.min() + 1; bh = Y.max() - Y.min() + 1
    fill = a / max(1, bw * bh)
    flat = pt == "accessory" or a < 6000 or (min(bw, bh) < 0.06 * chH) or fill < 0.35
    method = "extrude" if flat else "generate"
    cut = f"sam_{name}.png"; mask = f"sam_{name}_mask.png"
    out = np.where(seg[..., None], rgb.astype(np.float32) / 255, white)
    Image.fromarray((out * 255).astype(np.uint8)).save(os.path.join(BASE, cut))
    Image.fromarray((seg * 255).astype(np.uint8)).save(os.path.join(BASE, mask))
    visible.append({"name": name, "cutout": cut, "mask": mask, "method": method,
                    "bbox": [int(X.min()), int(Y.min()), int(X.max()), int(Y.max())],
                    "part_type": pt, "sim": sim, "area": a})

info = {"image": [W, H], "char_bbox": [ix0, iy0, ix1, iy1], "body_plan": body_plan,
        "landmarks": {"height_px": chH, "width_px": chW, "center_x": cxc,
                      "shoulder_y": int(shoulder_y), "hip_y": int(hip_y), "neck_y": int(neck_y),
                      "shoulder_half": max(1, int(row_w[min(H-1, shoulder_y+3)] / 2)),
                      "hip_half": max(1, int(row_w[max(0, hip_y-3)] / 2)), "leg_count": int(leg_count)},
        "visible_parts": visible}
json.dump(info, open(os.path.join(BASE, "parts_info.json"), "w"), indent=2)
print(json.dumps({"body_plan": body_plan, "device": device, "n_parts": len(visible),
                  "parts": [(v["name"], v["part_type"], v["area"]) for v in visible]}))
