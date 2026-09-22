"""STAGE 5 (corrected) - RETOPOLOGY OF THE ACTUAL CHARACTER.
Retopology means rebuilding the SAME SHAPE with clean quad topology - not replacing the
character with a generic body. Blender's built-in QUADRIFLOW does this for free.
Each separated part is remeshed to quads at a sensible budget, keeping its silhouette.
Run: blender -b -P stage5_quadriflow.py -- <ninja_dir>
"""
import bpy, sys, os
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage4_parts.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer

# face budgets per part (stylised PC target: whole character ~5k-15k tris)
BUDGET = {"body": 3500, "poncho": 3000, "pants_L": 900, "pants_R": 900,
          "shin_L": 500, "shin_R": 500, "wrap_L": 400, "wrap_R": 400,
          "hood": 800, "mask": 700, "ear_L": 250, "ear_R": 250}

parts = [o for o in sc.objects if o.name.startswith("Part_")]
for o in parts: o.hide_viewport = False; o.hide_select = False
results = []
for o in sorted(parts, key=lambda x: x.name):
    short = o.name.replace("Part_", "")
    tgt = BUDGET.get(short, 600)
    before = len(o.data.polygons)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); vl.objects.active = o
    ok, err = True, ""
    try:
        bpy.ops.object.quadriflow_remesh(target_faces=tgt, use_preserve_sharp=False,
                                         use_preserve_boundary=True, use_mesh_symmetry=False)
    except Exception as e:
        ok = False; err = str(e)[:60]
    after = len(o.data.polygons)
    q = sum(1 for p in o.data.polygons if len(p.vertices) == 4)
    results.append((short, ok, before, after, 100.0*q/max(1,after), err))
    for p in o.data.polygons: p.use_smooth = True

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
tot = 0
print("STAGE5 quadriflow retopology")
for short, ok, b, a, qp, err in results:
    tot += a
    print("  %-10s %s  %7d tris -> %5d faces  quads=%3.0f%% %s"
          % (short, "OK " if ok else "FAIL", b, a, qp, err))
print("TOTAL retopo faces: %d" % tot)
