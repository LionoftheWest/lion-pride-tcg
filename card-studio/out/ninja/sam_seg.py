"""SAM-based general layering. Segment Anything finds ALL distinct regions on the
character (garments, accessories, fur zones, skin), which we then label into layers.
This validation pass runs SAM + writes a colored visualization + region stats."""
import numpy as np, os, sys, json
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\ml\Hunyuan3D-2")
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
import torch
from segment_anything import sam_model_registry, SamAutomaticMaskGenerator

BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
CKPT = r"C:\Users\vaugh\discord\card-studio\ml\sam\sam_vit_b_01ec64.pth"
device = "cuda" if torch.cuda.is_available() else "cpu"
try:
    sam = sam_model_registry["vit_b"](checkpoint=CKPT).to(device)
except RuntimeError as e:
    print("cuda failed (%s) -> cpu" % e); device = "cpu"; sam = sam_model_registry["vit_b"](checkpoint=CKPT).to("cpu")
print("SAM loaded on", device)

im = Image.open(os.path.join(BASE, "source.png")).convert("RGB")
matte = np.asarray(BackgroundRemover()(im.convert("RGBA")))
char = matte[:, :, 3] > 128
rgb = np.asarray(im)

gen = SamAutomaticMaskGenerator(sam, points_per_side=24, pred_iou_thresh=0.86,
                                stability_score_thresh=0.9, min_mask_region_area=1500)
masks = gen.generate(rgb)
# keep masks that lie mostly INSIDE the character
kept = []
for m in masks:
    seg = m["segmentation"]
    inside = (seg & char).sum() / max(1, seg.sum())
    if inside > 0.6 and seg.sum() > 2000:
        kept.append(m)
kept.sort(key=lambda m: -m["area"])
print("SAM masks: %d total, %d inside character" % (len(masks), len(kept)))

# colored visualization
H, W = char.shape
viz = np.zeros((H, W, 3), np.uint8)
rng = np.random.default_rng(3)
stats = []
for i, m in enumerate(kept):
    seg = m["segmentation"]; col = rng.integers(60, 255, 3)
    viz[seg] = col
    ys, xs = np.where(seg)
    stats.append({"i": i, "area": int(m["area"]),
                  "cx": int(xs.mean()), "cy": int(ys.mean()),
                  "mean_rgb": [int(c) for c in rgb[seg].mean(0)]})
Image.fromarray(viz).save(os.path.join(BASE, "sam_layers.png"))
json.dump(stats, open(os.path.join(BASE, "sam_stats.json"), "w"), indent=2)
print("wrote sam_layers.png ; top regions:")
for s in stats[:10]:
    print("  area %-7d center (%d,%d) rgb %s" % (s["area"], s["cx"], s["cy"], s["mean_rgb"]))
