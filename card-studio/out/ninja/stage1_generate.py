"""STAGE 1 - Generate the WHOLE character from the concept art as source_highpoly.
Per the pipeline: image-to-3D, refine/high settings. This output is a PROPORTIONAL
REFERENCE / sculpt guide only - it is never the production mesh. Stage 3 retopologises
it and stage 5 bakes its detail onto the clean low-poly.
"""
import sys, os, base64, json, io, time
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\ml\Hunyuan3D-2")
from PIL import Image
import requests
BASE = r"C:\Users\vaugh\discord\card-studio\out\ninja"
src = os.path.join(BASE, "source.png")

# clean cutout is produced by make_cutout.py (rembg INTERSECT SAM body region) so that
# painted background strokes touching the character are not generated as geometry
cut_path = os.path.join(BASE, "source_cutout.png")
if not os.path.exists(cut_path):
    raise SystemExit("run make_cutout.py first")
flat = Image.open(cut_path).convert("RGB")
buf = io.BytesIO(); flat.save(buf, format="PNG")
b64 = base64.b64encode(buf.getvalue()).decode()

for octree, steps in ((320, 30), (256, 25), (256, 15)):
    print("trying octree=%d steps=%d ..." % (octree, steps)); t = time.time()
    try:
        r = requests.post("http://127.0.0.1:8081/generate", json={
            "image": b64, "octree_resolution": octree,
            "num_inference_steps": steps, "guidance_scale": 5.0, "type": "glb"}, timeout=1200)
    except Exception as e:
        print("  request failed:", e); continue
    if r.status_code == 200 and len(r.content) > 5000:
        out = os.path.join(BASE, "source_highpoly.glb")
        open(out, "wb").write(r.content)
        print("STAGE1 OK octree=%d steps=%d bytes=%d time=%.0fs -> source_highpoly.glb"
              % (octree, steps, len(r.content), time.time() - t))
        break
    print("  HTTP", r.status_code, len(r.content))
else:
    print("STAGE1 FAILED at all settings")
