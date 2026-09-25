"""Hunyuan3D-2mv: FRONT / LEFT / BACK / RIGHT views -> one shape. The view-first pipeline.

Any subset of the four views is accepted (front is required). Each view is an RGBA image with a
clean alpha; RGB inputs get their background removed first.

SAFE CEILING: octree 384 max (octree 512 crashed this machine on 2026-09-22). The peak GPU memory
is printed, so every run records the real margin.

Run (Hunyuan venv): python run_hunyuan_mv.py <views_dir> <out.glb> [octree] [steps]
"""
import sys, os, time, gc
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "Hunyuan3D-2"))
import torch
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

VD, OUT = sys.argv[1], sys.argv[2]
OCT = min(int(sys.argv[3]) if len(sys.argv) > 3 else 380, 384)
STEPS = int(sys.argv[4]) if len(sys.argv) > 4 else 30

views, rembg = {}, None
for k in ("front", "left", "back", "right"):
    p = os.path.join(VD, k + ".png")
    if not os.path.exists(p):
        continue
    im = Image.open(p)
    if im.mode != "RGBA" or im.getextrema()[3][0] == 255:
        rembg = rembg or BackgroundRemover()
        im = rembg(im.convert("RGB"))
    views[k] = im
if "front" not in views:
    print("NO front.png in %s" % VD)
    sys.exit(1)
print("VIEWS:", ", ".join("%s %s" % (k, v.size) for k, v in views.items()))

torch.cuda.reset_peak_memory_stats()
t0 = time.time()
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
    'tencent/Hunyuan3D-2mv', subfolder='hunyuan3d-dit-v2-mv-turbo', variant='fp16')
try:
    pipe.enable_flashvdm()
except Exception as e:
    print("flashvdm not enabled:", str(e)[:60])
print("LOADED in %.0fs, GPU %.2f GB" % (time.time() - t0, torch.cuda.memory_allocated() / 2**30))
gc.collect()
torch.cuda.empty_cache()
t1 = time.time()
mesh = pipe(image=views, num_inference_steps=STEPS, octree_resolution=OCT, num_chunks=8000,
            generator=torch.manual_seed(12345), output_type='trimesh')[0]
mesh.export(OUT)
print("GENERATED in %.0fs: %d verts, %d tris, watertight=%s -> %s"
      % (time.time() - t1, len(mesh.vertices), len(mesh.faces), mesh.is_watertight, OUT))
print("GPU PEAK %.2f GB of %.2f GB" % (torch.cuda.max_memory_allocated() / 2**30,
                                       torch.cuda.get_device_properties(0).total_memory / 2**30))
