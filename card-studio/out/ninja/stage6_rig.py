"""STAGE 6 - RIG the retopologised character and test deformation.
The mesh is in the concept art's A-pose, so the skeleton must MATCH it before binding:
Blender's armature modifier deforms from the REST pose, so rest must equal the mesh pose or
the mesh jumps on bind. Sequence: import skeleton -> clear the Mixamo T-pose ACTION (it
overwrites poses on load) -> pose to the art's A-pose -> APPLY POSE AS REST -> bind with
automatic weights.
Run: blender -b -P stage6_rig.py -- <ninja_dir>
"""
import bpy, sys, os, json
from mathutils import Vector, Matrix
ND = sys.argv[sys.argv.index("--") + 1]
MX = os.path.join(ND, "mixamo")
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
mesh = bpy.data.objects["Char_retopo"]; mesh.hide_viewport = False; mesh.hide_set(False)
for n in ("source_highpoly", "REF_concept"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)
for o in list(sc.objects):
    if o.name.startswith("Part_"): bpy.data.objects.remove(o, do_unlink=True)

def wbb(o):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=os.path.join(MX, "xbot_base_tpose.fbx"))
imp = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in imp if o.type == 'ARMATURE'); arm.name = "Rig"
for o in imp:
    if o.type != 'ARMATURE': bpy.data.objects.remove(o, do_unlink=True)
# the Mixamo FBX carries a T-pose ACTION that overwrites any pose on load
if arm.animation_data:
    arm.animation_data.action = None; arm.animation_data_clear()
for pb in arm.pose.bones: pb.matrix_basis.identity()
vl.update()

# scale + ground the skeleton to the character
mmn, mmx = wbb(mesh)
def arm_bounds():
    hs = [arm.matrix_world @ b.head_local for b in arm.data.bones]
    ts = [arm.matrix_world @ b.tail_local for b in arm.data.bones]
    zs = [p.z for p in hs + ts]; xs = [p.x for p in hs + ts]
    return min(zs), max(zs), min(xs), max(xs)
z0, z1, x0, x1 = arm_bounds()
s = (mmx.z - mmn.z) * 0.96 / max(1e-6, (z1 - z0))
arm.scale = tuple(v * s for v in arm.scale); vl.update()
z0, z1, x0, x1 = arm_bounds()
arm.location.z += mmn.z - z0
arm.location.x += ((mmn.x + mmx.x) / 2) - ((x0 + x1) / 2)
vl.update()

# pose to the concept art's A-pose so the skeleton matches the mesh
P = json.load(open(os.path.join(ND, "pose.json"))); L = P["landmarks"]; IW, IH = P["image"]
def d2(a, b):
    return Vector(((L[b]["x"] - L[a]["x"]) * IW, 0.0, -(L[b]["y"] - L[a]["y"]) * IH))
def aim(bone, wdir):
    pb = arm.pose.bones.get(bone)
    if not pb or wdir.length < 1e-6: return
    vl.update()
    hw = arm.matrix_world @ pb.head; tw = arm.matrix_world @ pb.tail
    cur = (tw - hw)
    if cur.length < 1e-6: return
    q = cur.normalized().rotation_difference(wdir.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()
for bone, a, b in [("mixamorig:LeftArm", 11, 13), ("mixamorig:LeftForeArm", 13, 15),
                   ("mixamorig:RightArm", 12, 14), ("mixamorig:RightForeArm", 14, 16),
                   ("mixamorig:LeftUpLeg", 23, 25), ("mixamorig:LeftLeg", 25, 27),
                   ("mixamorig:RightUpLeg", 24, 26), ("mixamorig:RightLeg", 26, 28)]:
    aim(bone, d2(a, b))
vl.update()

# APPLY POSE AS REST so rest == the mesh's pose (otherwise the mesh jumps on bind)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); vl.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode='OBJECT')
vl.update()

# bind
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); arm.select_set(True); vl.objects.active = arm
bound = True
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
except Exception as e:
    bound = False; print("BIND FAILED:", str(e)[:120])
vl.update()
print("GATE bind ok=%s vgroups=%d modifiers=%s" %
      (bound, len(mesh.vertex_groups), [m.type for m in mesh.modifiers]))
z0, z1, x0, x1 = arm_bounds()
print("GATE fit skeleton z=%.3f..%.3f  mesh z=%.3f..%.3f" % (z0, z1, mmn.z, mmx.z))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage6_rigged.blend"))
print("STAGE6 saved character_stage6_rigged.blend")
