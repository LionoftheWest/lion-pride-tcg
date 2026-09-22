import bpy, sys, os
from mathutils import Vector
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND,"character_stage5_body.blend"))
b = bpy.data.objects["Body_retopo"]; arm = bpy.data.objects["Rig"]
print("modifiers:", [(m.type, getattr(m,'object',None).name if getattr(m,'object',None) else None) for m in b.modifiers])
print("parent:", b.parent.name if b.parent else None, "vgroups:", len(b.vertex_groups))
pb = arm.pose.bones["mixamorig:LeftArm"]
d = ((arm.matrix_world@pb.tail)-(arm.matrix_world@pb.head)).normalized()
print("armature LeftArm dir:", [round(v,3) for v in d])
# raw (unposed) vs EVALUATED (posed) mesh bounds
dg = bpy.context.evaluated_depsgraph_get()
be = b.evaluated_get(dg); me = be.to_mesh()
xs = [ (b.matrix_world @ v.co).x for v in me.vertices ]
print("EVALUATED mesh x range: %.3f .. %.3f  (width %.3f)" % (min(xs), max(xs), max(xs)-min(xs)))
raw = [ (b.matrix_world @ v.co).x for v in b.data.vertices ]
print("RAW       mesh x range: %.3f .. %.3f  (width %.3f)" % (min(raw), max(raw), max(raw)-min(raw)))
