import bpy, sys, os
from mathutils import Vector, Matrix
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND,"character_stage5_body.blend"))
vl = bpy.context.view_layer
arm = bpy.data.objects["Rig"]
def wdir(bone):
    pb = arm.pose.bones[bone]
    h = arm.matrix_world @ pb.head; t = arm.matrix_world @ pb.tail
    return (t-h).normalized()
print("mode:", arm.mode, " pose bones:", len(arm.pose.bones))
print("BEFORE LeftArm dir:", [round(v,3) for v in wdir("mixamorig:LeftArm")])
print("BEFORE basis:", [round(v,3) for v in arm.pose.bones["mixamorig:LeftArm"].matrix_basis.to_quaternion()])

target = Vector((0.24,0,-1)).normalized()
pb = arm.pose.bones["mixamorig:LeftArm"]
vl.update()
hw = arm.matrix_world @ pb.head
cur = wdir("mixamorig:LeftArm")
q = cur.rotation_difference(target)
T = Matrix.Translation(hw)
newm = T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix)
pb.matrix = arm.matrix_world.inverted() @ newm
vl.update()
print("AFTER  LeftArm dir:", [round(v,3) for v in wdir("mixamorig:LeftArm")])
print("AFTER  basis:", [round(v,3) for v in pb.matrix_basis.to_quaternion()])
print("target:", [round(v,3) for v in target])
