"""Which part is smearing? Compare each part's REST bbox to its POSED bbox."""
import bpy, sys, os
from mathutils import Vector, Matrix

ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage6_modular.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
arm = bpy.data.objects["Rig"]
parts = [o for o in sc.objects if o.name.startswith("P_")]


def bb(o):
    dg = bpy.context.evaluated_depsgraph_get()
    m = o.evaluated_get(dg).to_mesh()
    if not m.vertices:
        return None
    pts = [o.matrix_world @ v.co for v in m.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return mn, mx


def aim(bone, wd):
    pb = arm.pose.bones.get(bone)
    if not pb:
        return
    vl.update()
    hw = arm.matrix_world @ pb.head
    cur = (arm.matrix_world @ pb.tail) - hw
    if cur.length < 1e-6:
        return
    q = cur.normalized().rotation_difference(wd.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()


rest = {o.name: bb(o) for o in parts}
for o in parts:
    grps = sorted({g.name.replace("mixamorig:", "") for g in o.vertex_groups})
    print("  %-12s verts=%-6d vgroups=%-3d %s" % (o.name, len(o.data.vertices), len(o.vertex_groups),
                                                  ",".join(grps[:6]) + ("..." if len(grps) > 6 else "")))
aim("mixamorig:LeftArm", Vector((0.9, -0.2, 0.35)))
aim("mixamorig:LeftForeArm", Vector((0.0, -0.7, 0.75)))
aim("mixamorig:LeftUpLeg", Vector((0.2, -0.85, -0.5)))
aim("mixamorig:LeftLeg", Vector((0.1, 0.75, -0.65)))
vl.update()
print("--- growth after extreme pose (diag = bbox diagonal) ---")
for o in parts:
    r = rest[o.name]
    p = bb(o)
    if not r or not p:
        continue
    dr = (r[1] - r[0]).length
    dp = (p[1] - p[0]).length
    flag = "  <== SMEARING" if dp > dr * 1.6 else ""
    print("  %-12s rest_diag=%.3f posed_diag=%.3f  x%.2f%s" % (o.name, dr, dp, dp / max(dr, 1e-6), flag))
