"""General single-image part segmentation. Detects BODY PLAN + landmarks from the
matte silhouette (no fixed fractions), then emits a DYNAMIC list of visible-part
cutouts + parts_info.json. Robust across characters; the downstream steps read the
plan/part list instead of assuming a hooded biped."""
import numpy as np, json, os, sys
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\ml\Hunyuan3D-2")
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from scipy import ndimage

BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
im = Image.open(os.path.join(BASE, "source.png")).convert("RGB")
matte = BackgroundRemover()(im.convert("RGBA"))
m = np.asarray(matte).astype(np.float32) / 255.0
H, W, _ = m.shape
rgb = m[:, :, :3]; alpha = m[:, :, 3]
char = alpha > 0.5
char = ndimage.binary_fill_holes(char)
R, G, B = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
Vv = rgb.max(2); sat = Vv - rgb.min(2)
ys, xs = np.where(char)
ix0, ix1, iy0, iy1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
chH = iy1 - iy0; chW = ix1 - ix0

# --- per-row runs (contiguous char spans) -> landmarks + body-plan ---
def runs(row_mask):
    idx = np.where(row_mask)[0]
    if idx.size == 0: return []
    brk = np.where(np.diff(idx) > 1)[0]
    s = np.concatenate(([0], brk + 1)); e = np.concatenate((brk, [idx.size - 1]))
    return [(int(idx[a]), int(idx[b])) for a, b in zip(s, e)]
row_runs = [runs(char[y]) for y in range(H)]
row_w = np.array([sum(e - s + 1 for s, e in row_runs[y]) if row_runs[y] else 0 for y in range(H)])
maxw = row_w[iy0:iy1 + 1].max() if chW else 1

def yf(y): return (y - iy0) / max(1, chH)
# hip line = scanning UP from the bottom, the first y where the leg runs (>=2) merge to 1 (torso)
leg_count = 0; hip_y = iy0 + int(chH * 0.55)
for y in range(iy1, iy0, -1):
    n = len(row_runs[y])
    if yf(y) > 0.55 and n >= 2 and leg_count == 0: leg_count = n
    if leg_count >= 2 and len(row_runs[y]) == 1:
        hip_y = y; break
# shoulder line = going DOWN from the head, first row (below the top 8%) reaching >=0.6*maxw
shoulder_y = iy0 + int(chH * 0.20)
for y in range(iy0 + int(chH * 0.06), iy1):
    if row_w[y] >= 0.6 * maxw: shoulder_y = y; break
# neck = narrowest row between head-top and shoulder
seg = row_w[iy0 + int(chH*0.05):shoulder_y + 1]
neck_y = (iy0 + int(chH*0.05) + int(np.argmin(seg))) if seg.size else shoulder_y
center_x = int(np.median(xs))
# shoulder / hip half widths (for skeleton fit)
sh_runs = row_runs[min(H-1, shoulder_y + 3)]
shoulder_half = int((max(e for s, e in sh_runs) - min(s for s, e in sh_runs)) / 2) if sh_runs else chW // 3
hip_runs = row_runs[max(0, hip_y - 3)]
hip_half = int((max(e for s, e in hip_runs) - min(s for s, e in hip_runs)) / 2) if hip_runs else chW // 4
upright = chH > 1.2 * chW
body_plan = "biped" if (leg_count == 2 and upright) else ("quadruped" if leg_count >= 4 else ("serpent" if (chH > 2.2 * chW and leg_count < 2) else "unknown"))
# a user-provided plan hint (on submit) OVERRIDES silhouette auto-detection
hint = os.environ.get("NINJA_PLAN", "").strip().lower()
if hint in ("biped", "quadruped", "bird", "serpent"):
    body_plan = hint; detected = body_plan

white = np.ones((H, W, 3), np.float32)
def save_cut(mask, name):
    out = np.where(mask[..., None], rgb, white)
    Image.fromarray((out * 255).astype(np.uint8)).save(os.path.join(BASE, name + "_cut.png"))
def bbox(mask):
    if not mask.any(): return None
    Y, X = np.where(mask); return [int(X.min()), int(Y.min()), int(X.max()), int(Y.max())]

yy, xx = np.mgrid[0:H, 0:W]
# UPPER = the central mass between shoulder and hip (garment/torso); side thin runs (arms) excluded
upper = np.zeros((H, W), bool)
for y in range(shoulder_y, hip_y + 1):
    for s, e in row_runs[y]:
        if (s <= center_x <= e) or (e - s + 1) > 0.45 * chW:
            upper[y, s:e + 1] = True
lower = char & (yy > hip_y)     # below the hip line = legs/feet (+ hands at sides)

# classify upper as garment(cloth) vs bare body(skin) by skin-tone fraction
up_px = rgb[upper]; skin_frac = float(((up_px.max(1) > 0.6) & ((up_px.max(1) - up_px.min(1)) < 0.16)).mean()) if up_px.size else 0.0
upper_type, upper_sim = ("body", "skin") if skin_frac > 0.55 else ("garment", "cloth")

save_cut(upper, "upper"); save_cut(lower, "lower")
visible = [
    {"name": "upper", "cutout": "upper_cut.png", "bbox": bbox(upper), "part_type": upper_type, "sim": upper_sim},
    {"name": "lower", "cutout": "lower_cut.png", "bbox": bbox(lower), "part_type": "garment", "sim": "cloth"},
]
info = {"image": [W, H], "char_bbox": [ix0, iy0, ix1, iy1], "body_plan": body_plan,
        "landmarks": {"height_px": chH, "width_px": chW, "center_x": center_x,
                      "shoulder_y": int(shoulder_y), "hip_y": int(hip_y), "neck_y": int(neck_y),
                      "shoulder_half": shoulder_half, "hip_half": hip_half, "leg_count": int(leg_count)},
        "visible_parts": visible}
json.dump(info, open(os.path.join(BASE, "parts_info.json"), "w"), indent=2)
print(json.dumps({"body_plan": body_plan, "leg_count": leg_count, "shoulder_yf": round(yf(shoulder_y), 2),
                  "hip_yf": round(yf(hip_y), 2), "upper_type": upper_type, "parts": [v["name"] for v in visible]}))
