"""STAGE 7 - apply a real Mixamo clip to the modular rig and render frames.
The skeleton is mixamorig, so the downloaded clips play natively. The clip's Hips LOCATION
curves are stripped so it plays IN PLACE (their root motion is authored in the source rig's
cm units and would fling this rig off-world).
Run: blender -b -P stage7_animate.py -- <ninja_dir> [clip]
"""
import bpy, sys, os, math
from mathutils import Vector

ND = sys.argv[sys.argv.index("--") + 1]
i = sys.argv.index("--")
CLIP = sys.argv[i + 2] if len(sys.argv) > i + 2 else "swordshield_slash"
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage6_tpose.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
arm = bpy.data.objects["Rig"]
parts = [o for o in sc.objects if o.name.startswith("P_")]

clip_path = os.path.join(ND, "mixamo", CLIP + ".fbx")
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=clip_path)
imp = [o for o in bpy.data.objects if o not in before]
src = next((o for o in imp if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action), None)
ok = False
if src:
    act = src.animation_data.action
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = act
    slot = arm.animation_data.action_slot or (act.slots[0] if act.slots else None)
    if slot:
        arm.animation_data.action_slot = slot
    stripped = 0
    for lay in act.layers:
        for stp in lay.strips:
            cb = stp.channelbag(slot) if slot else None
            if not cb:
                continue
            for fc in list(cb.fcurves):
                if fc.data_path.endswith('.location') and 'Hips' in fc.data_path:
                    cb.fcurves.remove(fc)
                    stripped += 1
    fr = act.frame_range
    sc.frame_start, sc.frame_end = int(fr[0]), int(fr[1])
    ok = True
    print("CLIP %s frames %d-%d stripped_hips=%d" % (CLIP, sc.frame_start, sc.frame_end, stripped))
bpy.ops.object.select_all(action='DESELECT')
for o in imp:
    o.select_set(True)
bpy.ops.object.delete()

for o in sc.objects:
    if o.type == 'MESH':
        o.hide_render = not o.name.startswith("P_")
    if o.type == 'ARMATURE':
        o.hide_render = True

eng = [e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
sc.render.resolution_x = 560
sc.render.resolution_y = 820
sc.render.film_transparent = True
sun = bpy.data.objects.new("S", bpy.data.lights.new("S", 'SUN'))
sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(20))
sun.data.energy = 3.2
cd = bpy.data.cameras.new("C")
cam = bpy.data.objects.new("C", cd)
sc.collection.objects.link(cam)
cd.type = 'ORTHO'
sc.camera = cam

mid = (sc.frame_start + sc.frame_end) // 2
for tag, f in (("a", sc.frame_start + 2), ("b", mid), ("c", sc.frame_end - 2)):
    sc.frame_set(f)
    vl.update()
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in parts:
        m = o.evaluated_get(dg).to_mesh()
        pts += [o.matrix_world @ v.co for v in m.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (mn + mx) / 2
    cd.ortho_scale = max(mx.x - mn.x, mx.z - mn.z) * 1.2
    cam.location = (ctr.x, ctr.y - 6, ctr.z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.filepath = os.path.join(ND, "qc_anim_%s_%s.png" % (CLIP, tag))
    bpy.ops.render.render(write_still=True)
    print("RENDERED frame %d -> %s" % (f, sc.render.filepath))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage7_animated.blend"))
