"""Generate a 3D mesh from one image via the local Hunyuan3D API. Bypasses the
Blender addon (protocol mismatch). Usage: gen_part.py <input_png> <output_glb>"""
import sys, base64, json, urllib.request
inp, outp = sys.argv[1], sys.argv[2]
b64 = base64.b64encode(open(inp, "rb").read()).decode()
payload = json.dumps({
    "image": b64,
    "octree_resolution": 256,
    "num_inference_steps": 8,
    "guidance_scale": 5.0,
    "type": "glb",
}).encode()
req = urllib.request.Request("http://127.0.0.1:8081/generate", data=payload,
                            headers={"Content-Type": "application/json"})
with urllib.request.urlopen(req, timeout=900) as r:
    data = r.read()
open(outp, "wb").write(data)
print("saved", outp, len(data), "bytes")
