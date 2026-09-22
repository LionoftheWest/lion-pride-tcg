"""STAGE 6c - convert the bound character from A-POSE REST to T-POSE REST.
Mixamo clips store rotations RELATIVE TO A T-POSE REST. We bound at A-pose rest (so the
skeleton matched the mesh), which means every clip rotation lands on an already-A-posed
skeleton and doubly-rotates it - the mesh mangles.

Fix (the golem-pipeline rule: "T-pose the mesh FIRST, then bind a fitted T-pose skeleton
for NATIVE playback"):
  1. pose the limb bones back to the Mixamo T-pose directions
  2. APPLY the armature modifier on every skinned part -> bakes the mesh into T-pose
  3. apply the pose as rest -> rest becomes T-pose
  4. re-add the armature modifiers (vertex groups are preserved)
Run: blender -b -P stage6c_to_tpose.py -- <ninja_dir>
"""
import bpy, sys, os
from mathutils import Vector, Matrix

ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage6_modular.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
arm = bpy.data.objects["Rig"]
parts = [o for o in sc.objects if o.name.startswith("P_")]


def aim(bone, wd):
    pb = arm.pose.bones.get(bone)
    if not pb:
        return
    vl.update()
    hw = arm.matrix_world @ pb.head
    cur = (arm.matrix_world @ pb.tail) - hw
    if cur.length < 1e-6:
        return
    q = cur.normalized().rotation_difference(Vector(wd).normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()


# Mixamo T-pose: arms straight out along +/-X, legs straight down -Z
TPOSE = [
    ("mixamorig:LeftArm", (1, 0, 0)), ("mixamorig:LeftForeArm", (1, 0, 0)),
    ("mixamorig:LeftHand", (1, 0, 0)),
    ("mixamorig:RightArm", (-1, 0, 0)), ("mixamorig:RightForeArm", (-1, 0, 0)),
    ("mixamorig:RightHand", (-1, 0, 0)),
    ("mixamorig:LeftUpLeg", (0, 0, -1)), ("mixamorig:LeftLeg", (0, 0, -1)),
    ("mixamorig:RightUpLeg", (0, 0, -1)), ("mixamorig:RightLeg", (0, 0, -1)),
]
for b, d in TPOSE:
    aim(b, d)
vl.update()

# bake each skinned part into the T-pose, then re-add the modifier
rebound = []
for o in parts:
    mods = [m for m in o.modifiers if m.type == 'ARMATURE']
    if not mods:
        continue  # bone-parented props follow the head automatically
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    vl.objects.active = o
    try:
        bpy.ops.object.modifier_apply(modifier=mods[0].name)
        rebound.append(o)
    except Exception as e:
        print("  apply failed", o.name, str(e)[:60])

# rest becomes T-pose
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
vl.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode='OBJECT')
vl.update()

# re-add armature modifiers (vertex groups survived the apply)
for o in rebound:
    md = o.modifiers.new("Armature", "ARMATURE")
    md.object = arm
    o.parent = arm
    o.matrix_parent_inverse = arm.matrix_world.inverted()

la = arm.pose.bones.get("mixamorig:LeftArm")
d = ((arm.matrix_world @ la.tail) - (arm.matrix_world @ la.head)).normalized()
print("GATE rest_is_T LeftArm dir = %s  (expect ~1,0,0)" % [round(v, 3) for v in d])
print("GATE rebound %d parts, vgroups kept: %s"
      % (len(rebound), {o.name: len(o.vertex_groups) for o in rebound[:4]}))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage6_tpose.blend"))
print("STAGE6c saved character_stage6_tpose.blend")
