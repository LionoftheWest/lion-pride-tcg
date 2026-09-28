"""Make a downloaded boss GLB light enough for the browser: textures to max N px (JPEG).
  blender -b --python optimize_glb.py -- <in.glb> <out.glb> [max_px]"""
import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
max_px = int(argv[2]) if len(argv) > 2 else 1024
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > max_px:
        s = max_px / max(w, h); img.scale(max(1, int(w * s)), max(1, int(h * s)))
bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_image_format="JPEG", export_image_quality=85)
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
print(f"WROTE {dst} | images {len(bpy.data.images)} | triangles ~{tris}")
