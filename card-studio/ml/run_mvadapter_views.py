"""MV-Adapter i2mv: ONE image -> six orthographic views at azimuth 0/45/90/180/270/315.

Azimuth 0 = front, 90 = left, 180 = back, 270 = right. That is exactly the set Hunyuan3D-2mv
wants, so this closes the loop: art -> turnaround -> 3D, with no hand-drawn views.

8 GB card, so: fp16, attention slicing, VAE slicing and sequential CPU offload. The peak GPU is
printed, so every run records the real margin.

Run (Hunyuan venv): python run_mvadapter_views.py <image> <out_dir> [size] [steps] [seed]
"""
import sys, os, time, gc
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "MV-Adapter"))
import numpy as np
import torch
from PIL import Image
from diffusers import AutoencoderKL, DDPMScheduler
from mvadapter.pipelines.pipeline_mvadapter_i2mv_sdxl import MVAdapterI2MVSDXLPipeline
from mvadapter.schedulers.scheduling_shift_snr import ShiftSNRScheduler
from mvadapter.utils.mesh_utils import get_orthogonal_camera
from mvadapter.utils.geometry import get_plucker_embeds_from_cameras_ortho

IMG, OUT = sys.argv[1], sys.argv[2]
SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 768
STEPS = int(sys.argv[4]) if len(sys.argv) > 4 else 50
SEED = int(sys.argv[5]) if len(sys.argv) > 5 else 12345
os.makedirs(OUT, exist_ok=True)
NV = 6
AZ = [0, 45, 90, 180, 270, 315]
NAME = {0: "front", 45: "front_left", 90: "left", 180: "back", 270: "right", 315: "front_right"}

torch.cuda.reset_peak_memory_stats()
t0 = time.time()
pipe = MVAdapterI2MVSDXLPipeline.from_pretrained(
    "stabilityai/stable-diffusion-xl-base-1.0",
    vae=AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16),
    torch_dtype=torch.float16, variant="fp16")
pipe.scheduler = ShiftSNRScheduler.from_scheduler(
    pipe.scheduler, shift_mode="interpolated", shift_scale=8.0, scheduler_class=DDPMScheduler)
pipe.init_custom_adapter(num_views=NV)
pipe.load_custom_adapter("huanngzh/mv-adapter", weight_name="mvadapter_i2mv_sdxl.safetensors")
pipe.enable_attention_slicing()
pipe.vae.enable_slicing()
# 8 GB card. SEQUENTIAL offload broke this: `cond_encoder` is a CUSTOM attribute, not a registered
# pipeline component, so the offload hooks skipped it and it stayed on the CPU while its input was
# on the GPU ("Input type HalfTensor / weight type HalfTensor"). Whole-MODEL offload moves one
# component at a time, and cond_encoder is pinned to the GPU by hand - it is small.
pipe.enable_model_cpu_offload()
pipe.cond_encoder.to(device="cuda", dtype=torch.float16)
print("LOADED in %.0fs" % (time.time() - t0))

cameras = get_orthogonal_camera(
    elevation_deg=[0] * NV, distance=[1.8] * NV, left=-0.55, right=0.55, bottom=-0.55, top=0.55,
    azimuth_deg=[x - 90 for x in AZ], device="cuda")
# the official script's exact usage: ONE tensor back, then mapped to 0..1
plucker = get_plucker_embeds_from_cameras_ortho(cameras.c2w, [1.1] * NV, SIZE)
ctrl = ((plucker + 1.0) / 2.0).clamp(0, 1)

# the official preprocess: keep the ALPHA, fit inside the square with a margin, white behind
def preprocess_image(image, height, width):
    image = np.array(image)
    alpha = image[..., 3] > 0
    H, W = alpha.shape
    y, x = np.where(alpha)
    y0, y1 = max(y.min() - 1, 0), min(y.max() + 1, H)
    x0, x1 = max(x.min() - 1, 0), min(x.max() + 1, W)
    image_center = image[y0:y1, x0:x1]
    resize_side = max(image_center.shape[:2])
    ratio = 0.85
    image_center = Image.fromarray(image_center).resize(
        (int(image_center.shape[1] / resize_side * height * ratio),
         int(image_center.shape[0] / resize_side * width * ratio)), Image.LANCZOS)
    out = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    out.paste(image_center, ((width - image_center.width) // 2,
                             (height - image_center.height) // 2))
    out = np.array(out).astype(np.float32) / 255.0
    out = out[:, :, :3] * out[:, :, 3:4] + (1 - out[:, :, 3:4]) * 0.5
    return Image.fromarray((out * 255).astype(np.uint8))


ref = preprocess_image(Image.open(IMG).convert("RGBA"), SIZE, SIZE)
ref.save(os.path.join(OUT, "_reference.png"))

t1 = time.time()
imgs = pipe(
    "high quality character turnaround, clean flat studio lighting, plain background",
    height=SIZE, width=SIZE, num_inference_steps=STEPS, guidance_scale=3.0,
    num_images_per_prompt=NV, control_image=ctrl, control_conditioning_scale=1.0,
    reference_image=ref, reference_conditioning_scale=1.0,
    negative_prompt="watermark, text, shadow, dark, blurry, deformed",
    cross_attention_kwargs={"scale": 1.0},
    generator=torch.Generator(device="cuda").manual_seed(SEED),
).images
for k, im in enumerate(imgs):
    im.save(os.path.join(OUT, "%s.png" % NAME[AZ[k]]))
print("GENERATED %d views in %.0fs -> %s" % (len(imgs), time.time() - t1, OUT))
print("   " + ", ".join(NAME[a] for a in AZ))
print("GPU PEAK %.2f GB of %.2f GB" % (torch.cuda.max_memory_allocated() / 2**30,
                                       torch.cuda.get_device_properties(0).total_memory / 2**30))
