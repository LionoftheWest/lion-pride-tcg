"""Pose-aware GARMENT segmenter (clothed-humanoid path). The body comes from Mixamo, so
this extracts ONLY the clothing/accessories as clean, INDIVIDUAL, unconnected pieces.
Method: prompt SAM at each garment's pose-derived point (MediaPipe joints) and take the
well-isolated multimask result (validated: a chest prompt returns just the poncho). Skin/
limbs are excluded. Overlaps resolve to the nearest prompt so pieces never fuse.
Requires pose.json (run pose_estimate.py first). Run in the Hunyuan venv."""
import numpy as np, os, sys, json
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\ml\Hunyuan3D-2")
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from scipy import ndimage
import torch
from segment_anything import sam_model_registry, SamPredictor
BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
CKPT = r"C:\Users\vaugh\discord\card-studio\ml\sam\sam_vit_b_01ec64.pth"

im = Image.open(os.path.join(BASE, "source.png")).convert("RGB")
rgb = np.asarray(im).astype(np.uint8); H, W = rgb.shape[:2]
char = ndimage.binary_fill_holes(np.asarray(BackgroundRemover()(im.convert("RGBA")))[:, :, 3] > 128)
char_area = int(char.sum()); ys, xs = np.where(char)
ix0, ix1, iy0, iy1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
chH = iy1 - iy0; chW = ix1 - ix0; cxc = int(np.median(xs))
P = json.load(open(os.path.join(BASE, "pose.json"))); LM = P["landmarks"]
def pt(i): return np.array([LM[i]["x"] * W, LM[i]["y"] * H])
def mid(a, b, t): return pt(a) * (1 - t) + pt(b) * t
def vis(i): return LM[i]["v"] > 0.3

# garment prompt points from the pose (name, point, expected side, hint-scale)
# MediaPipe idx: 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees,
# 27/28 ankles, 0 nose.  L/R here are the character's anatomical sides.
sh_c = (pt(11) + pt(12)) / 2; hip_c = (pt(23) + pt(24)) / 2
PROMPTS = []
PROMPTS.append(("poncho", sh_c + (hip_c - sh_c) * 0.30))          # torso cloth
PROMPTS.append(("hood",   pt(0) + np.array([0, -0.14 * chH])))    # head cloth
PROMPTS.append(("ear_L",  pt(0) + np.array([0.10 * chW, -0.24 * chH])))
PROMPTS.append(("ear_R",  pt(0) + np.array([-0.10 * chW, -0.24 * chH])))
PROMPTS.append(("pants_L", mid(23, 25, 0.6)))                      # left thigh
PROMPTS.append(("pants_R", mid(24, 26, 0.6)))
PROMPTS.append(("shin_L", mid(25, 27, 0.55)))                      # left shin/lower pants
PROMPTS.append(("shin_R", mid(26, 28, 0.55)))
PROMPTS.append(("wrap_L", mid(13, 15, 0.65)))                      # left forearm wrap
PROMPTS.append(("wrap_R", mid(14, 16, 0.65)))
# RIGID PROPS - these are white/grey so they must BYPASS the skin filter
PROMPTS.append(("mask",  pt(0)))                                   # fox kabuki mask (face)
PROMPTS.append(("ear_L", pt(0) + np.array([ 0.060 * chW, -0.135 * chH])))
PROMPTS.append(("ear_R", pt(0) + np.array([-0.060 * chW, -0.135 * chH])))
PROPS = {"mask", "ear_L", "ear_R"}
PROMPTS = [(n, p) for n, p in PROMPTS if 0 <= p[0] < W and 0 <= p[1] < H]

# skin mask (exclude bare limbs/face from garments): high value, low saturation, warm
mx = rgb.max(2).astype(np.float32); mn = rgb.min(2).astype(np.float32)
V = mx / 255; S = (mx - mn) / np.maximum(1, mx)
skin = char & (V > 0.55) & (S < 0.30) & (rgb[:, :, 0] >= rgb[:, :, 2])

device = "cuda" if torch.cuda.is_available() else "cpu"
try: sam = sam_model_registry["vit_b"](checkpoint=CKPT).to(device)
except RuntimeError: device = "cpu"; sam = sam_model_registry["vit_b"](checkpoint=CKPT).to("cpu")
pr = SamPredictor(sam); pr.set_image(rgb)

def best_mask(point):
    masks, scores, _ = pr.predict(point_coords=np.array([point]), point_labels=np.array([1]), multimask_output=True)
    cand = []
    for m, sc in zip(masks, scores):
        seg = m & char; a = int(seg.sum())
        if a < 1200 or a > 0.55 * char_area: continue     # skip tiny + whole-body-blob masks
        cand.append((sc, a, seg))
    if not cand: return None
    cand.sort(key=lambda c: (-c[0], c[1]))                 # highest score, then smaller
    return cand[0][2]

# claim masks; a pixel goes to the NEAREST prompt so pieces never fuse
raw = []
for name, p in PROMPTS:
    seg = best_mask(p)
    if seg is not None: raw.append((name, p, seg))
own = -np.ones((H, W), np.int32); dist = np.full((H, W), 1e9)
for k, (name, p, seg) in enumerate(raw):
    yy, xx = np.where(seg)
    d = (xx - p[0]) ** 2 + (yy - p[1]) ** 2
    take = d < dist[yy, xx]
    own[yy[take], xx[take]] = k; dist[yy[take], xx[take]] = d[take]

white = np.ones((H, W, 3), np.float32); used = {}; visible = []
for k, (name, p, seg0) in enumerate(raw):
    seg = (own == k) if name.split('_')[0] in {'mask','ear'} else ((own == k) & ~skin)
    if seg.sum() < 1200: continue
    lbl, n = ndimage.label(seg)                            # keep the largest connected piece
    if n > 1: seg = lbl == (1 + np.argmax([(lbl == i).sum() for i in range(1, n + 1)]))
    a = int(seg.sum()); Y, X = np.where(seg)
    base = name.split("_")[0]; side = ("_" + name.split("_")[1]) if "_" in name else ""
    nm = base + side; c = used.get(nm, 0); used[nm] = c + 1
    if c: nm = f"{nm}{c+1}"
    bw = X.max() - X.min() + 1; bh = Y.max() - Y.min() + 1; fill = a / max(1, bw * bh)
    is_prop = base in ("ear", "mask")
    pt_type = "prop" if is_prop else "garment"
    sim = "rigid" if is_prop else "cloth"
    flat = base == "ear" or a < 5000 or min(bw, bh) < 0.05 * chH or fill < 0.32
    method = "extrude" if flat else "generate"
    cut = f"g_{nm}.png"; mask = f"g_{nm}_mask.png"
    Image.fromarray((np.where(seg[..., None], rgb / 255, white) * 255).astype(np.uint8)).save(os.path.join(BASE, cut))
    Image.fromarray((seg * 255).astype(np.uint8)).save(os.path.join(BASE, mask))
    visible.append({"name": nm, "cutout": cut, "mask": mask, "method": method,
                    "bbox": [int(X.min()), int(Y.min()), int(X.max()), int(Y.max())],
                    "part_type": pt_type, "sim": sim, "area": a})

info = {"image": [W, H], "char_bbox": [ix0, iy0, ix1, iy1], "body_plan": "biped",
        "character_type": "clothed-humanoid",
        "landmarks": {"height_px": chH, "width_px": chW, "center_x": cxc,
                      "shoulder_y": int(sh_c[1]), "hip_y": int(hip_c[1]), "neck_y": int(pt(0)[1]),
                      "shoulder_half": int(abs(pt(11)[0] - pt(12)[0]) / 2),
                      "hip_half": int(abs(pt(23)[0] - pt(24)[0]) / 2), "leg_count": 2},
        "visible_parts": visible}
json.dump(info, open(os.path.join(BASE, "parts_info.json"), "w"), indent=2)
print(json.dumps({"device": device, "n_parts": len(visible),
                  "parts": [(v["name"], v["part_type"], v["method"], v["area"]) for v in visible]}))
