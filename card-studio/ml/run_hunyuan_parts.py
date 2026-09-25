"""PER-PART generation.

The whole-body generation spends ONE octree budget on the ENTIRE character, so the kabuki
mask gets about 3% of it and comes back as a bump on a head. Generating each element from its
OWN cropped image spends the FULL budget on that element, so the mask gets a real muzzle, the
ears get real blades, and the poncho gets real folds.

The pipeline is loaded ONCE and reused for every part, because loading it costs more than
generating.

Run (in the Hunyuan venv):
  python run_hunyuan_parts.py <part_dir> [octree] [steps] [only_name]
<part_dir> holds parts_info.json plus the g_*/p_* mask PNGs and source.png.
"""
import sys, os, json, time, gc
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "Hunyuan3D-2"))
import numpy as np
from PIL import Image
import torch
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

ND = sys.argv[1]
# SAFE CEILING - measured, do not raise.
# Octree 512 with the full 1.11B model CRASHED the machine (2026-09-22). A 512 grid is 134M
# voxels of marching cubes on an 8GB card while Blender also holds VRAM. 384 is stable and
# still yields ~1M triangles per part, which is 3x the detail the whole old character had.
OCT_MAX = 384
OCT = min(int(sys.argv[2]) if len(sys.argv) > 2 else 384, OCT_MAX)
STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 30
ONLY = sys.argv[4] if len(sys.argv) > 4 else None
# The FULL Hunyuan3D-2 (1.11B params) beats the mini (0.6B) and still fits 8GB. Verified.
MODEL = os.environ.get("HY_MODEL", "full")
REPO, SUB = (("tencent/Hunyuan3D-2", "hunyuan3d-dit-v2-0-turbo") if MODEL == "full"
             else ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini"))

info = json.load(open(os.path.join(ND, "parts_info.json")))
src = Image.open(os.path.join(ND, "source.png")).convert("RGB")
OUT = os.path.join(ND, "parts3d")
os.makedirs(OUT, exist_ok=True)

# Hands, feet and their digits are painted ~36px wide. A 36px crop carries no shape for any
# generator to read, so those stay anatomy-modelled in the blockout. Everything else is drawn
# large enough to generate.
SKIP_PREFIX = ("hand_", "foot_")
MIN_PIX = 3500

# GROUPS - the fix for the thin parts.
# A floating bandage 59px wide carries NO orientation cue, so the generator turned it edge-on
# (measured: ear_L came back 3x too narrow, silhouette IoU 0.44). A LIMB SEGMENT is a far more
# informative silhouette, and it is also the unit the Mixamo skeleton wants: one group per
# bone. So we generate by bone group, not by loose element.
ALL = {p["name"]: p for p in info.get("blockout_parts", info["visible_parts"])}
GROUPS = {
    "head":       ["mask", "ear_L", "ear_R", "hood", "ear_L_inner", "ear_R_inner"],
    "torso":      ["poncho", "collar"],
    "forearm_L":  ["wrap_L"] + [k for k in ALL if k.startswith("hand_L")],
    "forearm_R":  ["wrap_R"] + [k for k in ALL if k.startswith("hand_R")],
    "lowerleg_L": ["shin_L"] + [k for k in ALL if k.startswith("foot_L")],
    "lowerleg_R": ["shin_R"] + [k for k in ALL if k.startswith("foot_R")],
    "thigh_L":    ["pants_L"],
    "thigh_R":    ["pants_R"],
    # the shin+foot group still failed (IoU 0.57/0.63): an L-shaped stump is still ambiguous.
    # A WHOLE LEG is unambiguous. We split it back at the knee afterwards, which we can do
    # exactly because the knee landmark is measured.
    "leg_L":      ["pants_L", "shin_L"] + [k for k in ALL if k.startswith("foot_L")],
    "leg_R":      ["pants_R", "shin_R"] + [k for k in ALL if k.startswith("foot_R")],
}


def union_part(gname, members):
    """one pseudo-part whose mask is the union of its members"""
    acc = None
    for k in members:
        p = ALL.get(k)
        if not p:
            continue
        m = np.asarray(Image.open(os.path.join(ND, p["mask"])).convert("L")) > 127
        acc = m if acc is None else (acc | m)
    if acc is None or acc.sum() < MIN_PIX:
        return None
    path = "grp_%s_mask.png" % gname
    Image.fromarray((acc * 255).astype(np.uint8)).save(os.path.join(ND, path))
    ys, xs = np.where(acc)
    return {"name": gname, "mask": path, "area": int(acc.sum()),
            "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
            "members": [k for k in members if k in ALL]}


allg = []
for g, mem in GROUPS.items():
    j = union_part(g, mem)
    if j:
        allg.append(j)
info["groups"] = allg          # always record EVERY group, even when only one is generated,
jobs = [j for j in allg if not ONLY or j["name"] == ONLY]   # or the gate loses the others
json.dump(info, open(os.path.join(ND, "parts_info.json"), "w"), indent=2)
print("GROUPS TO GENERATE: %d -> %s" % (len(jobs), ", ".join(j["name"] for j in jobs)))


def crop_part(p):
    """tight RGBA crop of just this element, padded and squared, long side 512.
    The alpha IS the element mask, so the generator sees the element and nothing else."""
    m = np.asarray(Image.open(os.path.join(ND, p["mask"])).convert("L")) > 127
    x0, y0, x1, y1 = p["bbox"]
    pad = int(0.06 * max(x1 - x0, y1 - y0)) + 4
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(src.width - 1, x1 + pad), min(src.height - 1, y1 + pad)
    rgb = np.asarray(src)[y0:y1 + 1, x0:x1 + 1]
    a = (m[y0:y1 + 1, x0:x1 + 1] * 255).astype(np.uint8)
    rgba = np.dstack([rgb, a])
    im = Image.fromarray(rgba, "RGBA")
    s = max(im.size)
    sq = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq.resize((512, 512), Image.LANCZOS)


print("loading %s / %s (once for all parts) ..." % (REPO, SUB))
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(REPO, subfolder=SUB,
                                                        use_safetensors=True)
try:
    pipe.enable_flashvdm()
except Exception:
    pass

done = []
for k, p in enumerate(jobs):
    n = p["name"]
    img = crop_part(p)
    img.save(os.path.join(OUT, "crop_%s.png" % n))
    out = os.path.join(OUT, "part_%s.glb" % n)
    t = time.time()
    # The 8GB card fragments after ~7 parts at octree 512 and throws "CUDA error: unknown
    # error". Releasing the cache between parts fixes it. The retry at a lower octree means
    # one heavy part can never cost us the rest of the run.
    for oct_try in (OCT, OCT // 2 if OCT > 256 else 0):
        if not oct_try:
            break
        try:
            gc.collect()
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
            mesh = pipe(image=img, num_inference_steps=STEPS, octree_resolution=oct_try,
                        num_chunks=8000)[0]
            mesh.export(out)
            mb = os.path.getsize(out) / 1e6
            print("[%d/%d] %-14s %6.1fs  %5.2f MB  oct=%d  %s"
                  % (k + 1, len(jobs), n, time.time() - t, mb, oct_try, out))
            done.append(n)
            break
        except Exception as e:
            print("[%d/%d] %-14s oct=%d FAILED %s" % (k + 1, len(jobs), n, oct_try, str(e)[:90]))

print("GENERATED %d/%d parts into %s" % (len(done), len(jobs), OUT))
