import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "Hunyuan3D-2"))
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

img_path, out = sys.argv[1], sys.argv[2]
os.makedirs(os.path.dirname(out), exist_ok=True)
print("loading image", img_path)
image = Image.open(img_path).convert("RGBA")
rembg = BackgroundRemover()
image = rembg(image)          # clean background -> alpha

print("loading Hunyuan3D-2mini shape pipeline ...")
try:
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
        'tencent/Hunyuan3D-2mini', subfolder='hunyuan3d-dit-v2-mini', use_safetensors=True)
except Exception as e:
    print("mini subfolder load failed (%s); trying default id" % e)
    pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2mini')
try:
    pipe.enable_flashvdm()    # low-VRAM path if available
except Exception:
    pass

print("generating mesh ...")
mesh = pipe(image=image, num_inference_steps=30, octree_resolution=256, num_chunks=8000)[0]
mesh.export(out)
print("EXPORTED", out, os.path.exists(out), round(os.path.getsize(out)/1e6, 2), "MB")
