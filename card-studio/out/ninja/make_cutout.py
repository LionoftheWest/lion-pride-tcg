"""Clean character cutout for generation.
rembg alone keeps painted background brush-strokes that touch the character, and they get
generated as geometry. Fix: prompt SAM with points across the body to get the TRUE
character region, then intersect with rembg's crisp matte. Strokes outside SAM's region
are removed while rembg's fine edges (ears, fingers) are preserved.
"""
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
rem = np.asarray(BackgroundRemover()(im.convert("RGBA")))[:, :, 3] > 128
rem = ndimage.binary_fill_holes(rem)

P = json.load(open(os.path.join(BASE, "pose.json"))); L = P["landmarks"]
def pxy(i): return [L[i]["x"] * W, L[i]["y"] * H]
def mid(a, b, t=0.5):
    A, B = pxy(a), pxy(b); return [A[0]*(1-t)+B[0]*t, A[1]*(1-t)+B[1]*t]
# spread foreground points over the whole figure so SAM returns the entire character
ys_, xs_ = np.where(rem)
chH_ = ys_.max() - ys_.min(); chW_ = xs_.max() - xs_.min()
nose = pxy(0)
# thin appendages (fox ears) sit ABOVE the head and get clipped unless SAM is told they
# belong to the character - prompt directly on them, derived from the pose
ears = [[nose[0] + dx * 0.060 * chW_, nose[1] - dy * chH_]
        for dx in (-1, 1) for dy in (0.115, 0.155)]
fg = [pxy(0), mid(11, 12), mid(11, 23, 0.35), mid(23, 24), pxy(25), pxy(26),
      pxy(27), pxy(28), pxy(15), pxy(16), pxy(13), pxy(14), mid(25, 27), mid(26, 28)] + ears
fg = [p for p in fg if 0 <= p[0] < W and 0 <= p[1] < H]

dev = "cuda" if torch.cuda.is_available() else "cpu"
try: sam = sam_model_registry["vit_b"](checkpoint=CKPT).to(dev)
except RuntimeError: dev = "cpu"; sam = sam_model_registry["vit_b"](checkpoint=CKPT).to("cpu")
pr = SamPredictor(sam); pr.set_image(rgb)
m, sc_, _ = pr.predict(point_coords=np.array(fg), point_labels=np.ones(len(fg), int),
                       multimask_output=False)
sam_mask = m[0]
# allow a margin for thin bits (ears/fingers) rembg caught but SAM clipped
grown = ndimage.binary_dilation(sam_mask, iterations=14)
char = rem & grown
char = ndimage.binary_fill_holes(char)
lbl, n = ndimage.label(char)
if n > 1:
    sizes = ndimage.sum(char, lbl, range(1, n + 1))
    char = lbl == (1 + int(np.argmax(sizes)))

out = np.dstack([rgb, (char * 255).astype(np.uint8)])
Image.fromarray(out, "RGBA").save(os.path.join(BASE, "source_clean_rgba.png"))
flat = Image.new("RGB", (W, H), (255, 255, 255))
flat.paste(Image.fromarray(out, "RGBA"), mask=Image.fromarray((char * 255).astype(np.uint8)))
flat.save(os.path.join(BASE, "source_cutout.png"))
print("CUTOUT rembg_px=%d sam_px=%d final_px=%d removed=%d (%.1f%% of rembg)"
      % (rem.sum(), sam_mask.sum(), char.sum(), rem.sum() - char.sum(),
         100.0 * (rem.sum() - char.sum()) / max(1, rem.sum())))
