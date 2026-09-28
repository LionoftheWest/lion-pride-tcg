"""Join one Mixamo boss (a skinned idle.fbx + motion-only clip FBXs) into ONE .glb with
one named animation per clip, for three.js (AnimationMixer). Run headless:
  blender -b --python mixamo_to_glb.py -- <boss_dir> <out.glb> [max_texture_px]
<boss_dir>/idle.fbx must include the skin; every other <clip>.fbx is motion only.
The raw Mixamo FBX files are never committed or shared (Mixamo terms); only the game
loads the .glb, from Supabase storage.
"""
import bpy, sys, pathlib

argv = sys.argv[sys.argv.index("--") + 1:]
boss_dir, out_glb = pathlib.Path(argv[0]), pathlib.Path(argv[1])
max_px = int(argv[2]) if len(argv) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)

def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    return [o for o in bpy.data.objects if o not in before]

# 1. The skinned character + its idle action.
objs = import_fbx(boss_dir / "idle.fbx")
arm = next(o for o in objs if o.type == "ARMATURE")
arm.name = "Boss"
idle = arm.animation_data.action
idle.name = "idle"
idle.use_fake_user = True

# 2. Each motion-only clip: take its action, then delete its armature.
for fbx in sorted(boss_dir.glob("*.fbx")):
    if fbx.stem == "idle":
        continue
    new = import_fbx(fbx)
    src = next((o for o in new if o.type == "ARMATURE"), None)
    if src is None or not src.animation_data or not src.animation_data.action:
        print(f"SKIP {fbx.name}: no action")
    else:
        act = src.animation_data.action
        act.name = fbx.stem
        act.use_fake_user = True
        print(f"clip {fbx.stem}: {act.frame_range[1] - act.frame_range[0] + 1:.0f} frames")
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)

# 3. Keep the textures small enough for a browser.
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > max_px:
        s = max_px / max(w, h)
        img.scale(max(1, int(w * s)), max(1, int(h * s)))

# 4. Put every action on the NLA, so the glTF exporter writes one animation per action.
arm.animation_data.action = None
for act in [a for a in bpy.data.actions if a.use_fake_user]:
    tr = arm.animation_data.nla_tracks.new()
    tr.name = act.name
    tr.strips.new(act.name, int(act.frame_range[0]), act)
arm.animation_data.action = idle

out_glb.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_image_format="JPEG",
                          export_image_quality=85, export_apply=False)
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
print(f"WROTE {out_glb} | actions: {[a.name for a in bpy.data.actions if a.use_fake_user]} | triangles ~{tris}")
