"""STAGE 5a - RETOPOLOGY: the BODY.
Blender Studio order is head -> body -> hair -> clothing, and clothes are "mostly copies of
the underlying body", so the body must exist first.

For a CLOTHED character the body under the clothes is not present in the concept art (the
high-poly's 'body' part is only visible skin: hands, feet, face). So the clean base mesh
PROVIDES that anatomy; we fit it to the character rather than shrinkwrap it to nothing.
The Mixamo base is already production retopology (98.8% quads, edge loops at joints).

Steps: import base+skeleton -> scale to the character -> pose to the art's A-pose (MediaPipe)
-> verify the visible landmarks (hands/feet/head) line up with the high-poly.
Run: blender -b -P stage5_retopo_body.py -- <ninja_dir>
"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix
ND = sys.argv[sys.argv.index("--") + 1]
MX = os.path.join(ND, "mixamo")
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage4_parts.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer

def wbb(objs):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

parts = [o for o in sc.objects if o.name.startswith("Part_")]
for o in parts: o.hide_viewport = False
hmn, hmx = wbb(parts)           # the whole generated character

# --- import the retopologised base + skeleton ---
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=os.path.join(MX, "xbot_base_tpose.fbx"))
imp = [o for o in bpy.data.objects if o not in before]
base = max([o for o in imp if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
base.name = "Body_retopo"
arm = next(o for o in imp if o.type == 'ARMATURE'); arm.name = "Rig"
for o in imp:
    if o.type == 'MESH' and o is not base: bpy.data.objects.remove(o, do_unlink=True)
# The Mixamo FBX carries a T-pose ACTION. If it stays attached, the action re-evaluates on
# file load and OVERWRITES our pose back to T-pose. Clear it before posing.
if arm.animation_data:
    arm.animation_data.action = None
    arm.animation_data_clear()
for pb in arm.pose.bones: pb.matrix_basis.identity()
vl.update()

# --- scale to the character's height, feet on the floor ---
bmn, bmx = wbb([base])
s = (hmx.z - hmn.z) / max(1e-6, (bmx.z - bmn.z))
arm.scale = tuple(v * s for v in arm.scale); vl.update()
bmn, bmx = wbb([base])
arm.location.z += hmn.z - bmn.z
arm.location.x += ((hmn.x + hmx.x) / 2) - ((bmn.x + bmx.x) / 2)
vl.update()

# --- pose to the concept art's A-pose (the high-poly has arms DOWN) ---
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

P = json.load(open(os.path.join(ND, "pose.json"))); L = P["landmarks"]
IW, IH = P["image"]
def d2(a, b):
    v = Vector(((L[b]["x"] - L[a]["x"]) * IW, 0.0, -(L[b]["y"] - L[a]["y"]) * IH))
    return v
def _dir(bn):
    pb = arm.pose.bones.get(bn)
    if not pb: return None
    return ((arm.matrix_world @ pb.tail) - (arm.matrix_world @ pb.head)).normalized()
print("DBG pre  LeftArm", [round(v,3) for v in (_dir("mixamorig:LeftArm") or Vector())])
print("DBG target LeftArm", [round(v,3) for v in d2(11,13).normalized()])
for bone, a, b in [("mixamorig:LeftArm", 11, 13), ("mixamorig:LeftForeArm", 13, 15),
                   ("mixamorig:RightArm", 12, 14), ("mixamorig:RightForeArm", 14, 16),
                   ("mixamorig:LeftUpLeg", 23, 25), ("mixamorig:LeftLeg", 25, 27),
                   ("mixamorig:RightUpLeg", 24, 26), ("mixamorig:RightLeg", 26, 28)]:
    aim(bone, d2(a, b))
vl.update()
print("DBG post LeftArm", [round(v,3) for v in (_dir("mixamorig:LeftArm") or Vector())])

# --- GATES ---
bmn, bmx = wbb([base])
quads = sum(1 for p in base.data.polygons if len(p.vertices) == 4)
print("GATE topology quads %d/%d (%.1f%%) verts=%d"
      % (quads, len(base.data.polygons), 100.0*quads/len(base.data.polygons), len(base.data.vertices)))
print("GATE silhouette  base W=%.3f H=%.3f   |  highpoly W=%.3f H=%.3f"
      % (bmx.x-bmn.x, bmx.z-bmn.z, hmx.x-hmn.x, hmx.z-hmn.z))
# do the visible landmarks agree? compare base hand/foot to the generated body part
bodypart = bpy.data.objects.get("Part_body")
if bodypart:
    pmn, pmx = wbb([bodypart])
    print("GATE skin_extent  Part_body W=%.3f z=%.3f..%.3f" % (pmx.x-pmn.x, pmn.z, pmx.z))
def bh(n):
    pb = arm.pose.bones.get("mixamorig:"+n); return (arm.matrix_world @ pb.head) if pb else None
for n in ("LeftHand", "RightHand", "LeftFoot", "Head"):
    v = bh(n)
    if v: print("   base %-10s (%.3f, %.3f, %.3f)" % (n, v.x, v.y, v.z))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage5_body.blend"))
print("STAGE5a saved character_stage5_body.blend")
