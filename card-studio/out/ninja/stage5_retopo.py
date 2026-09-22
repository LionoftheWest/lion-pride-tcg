"""STAGE 5 - RETOPOLOGY of the actual character (the working method).
Retopology = rebuild the SAME SHAPE with clean quad topology. It does NOT mean replacing
the character with a generic body.

WHY VOXEL REMESH AND NOT QUADRIFLOW:
- bpy.ops.object.quadriflow_remesh silently NO-OPS in background (-b) mode, and even with a
  VIEW_3D context override it CANCELLED with "needs to be manifold and have face normals
  pointing in a consistent direction".
- Diagnosed: non-manifold edges 0, non-manifold verts 0, but 5 ZERO-AREA faces. Quadriflow
  refuses on degenerates; recalculating normals does not help.
- The Remesh modifier in VOXEL mode rebuilds from a signed-distance field, ignores those
  defects, works headless, and outputs 100% QUADS.
POLY BUDGET - READ THIS: the pipeline's "stylised PC 5k-15k tris" budget is for REALTIME
GAME assets. This project delivers RENDERED VIDEO CLIPS, so that budget does not apply.
Here retopology is for DEFORMATION QUALITY (clean quads), NOT polygon reduction. Using a
game budget threw away the Stage 1 detail for no reason.
Measured at 1.8m character height:
   voxel 0.022 ->   8,228 faces  (detail LOST - too coarse)
   voxel 0.012 ->  33,466 faces
   voxel 0.008 ->  78,828 faces  <- DEFAULT: full Stage 1 detail retained
   voxel 0.006 -> 141,854 faces  (max fidelity)
All 100% quads; shape at 0.008 is within ~0.5% of the high-poly.
Run: blender -b -P stage5_retopo.py -- <ninja_dir> [voxel_size]
"""
import bpy, bmesh, sys, os
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
VOX = float(sys.argv[sys.argv.index("--") + 2]) if len(sys.argv) > sys.argv.index("--") + 2 else 0.008
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
src = bpy.data.objects["source_highpoly"]; src.hide_viewport = False

def bbox(o):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

bm = bmesh.new(); bm.from_mesh(src.data)
print("GATE mesh_health non_manifold_edges=%d non_manifold_verts=%d zero_area_faces=%d"
      % (sum(1 for e in bm.edges if not e.is_manifold),
         sum(1 for v in bm.verts if not v.is_manifold),
         sum(1 for f in bm.faces if f.calc_area() < 1e-12)))
bm.free()

lo = src.copy(); lo.data = src.data.copy(); lo.name = "Char_retopo"
sc.collection.objects.link(lo)
for c in list(lo.users_collection):
    if c.name == "HIGH_POLY": c.objects.unlink(lo)
if "RETOPO" in bpy.data.collections: bpy.data.collections["RETOPO"].objects.link(lo)
before = len(lo.data.polygons)
rm = lo.modifiers.new("Retopo", "REMESH")
rm.mode = 'VOXEL'; rm.voxel_size = VOX; rm.adaptivity = 0.0
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); vl.objects.active = lo
bpy.ops.object.modifier_apply(modifier="Retopo")
for p in lo.data.polygons: p.use_smooth = True
after = len(lo.data.polygons)
q = sum(1 for p in lo.data.polygons if len(p.vertices) == 4)
a = bbox(lo); b = bbox(src)
print("GATE retopo %d tris -> %d faces, quads=%.1f%%, verts=%d"
      % (before, after, 100.0*q/max(1, after), len(lo.data.vertices)))
print("GATE shape retopo W=%.3f D=%.3f H=%.3f | highpoly W=%.3f D=%.3f H=%.3f"
      % (a[1].x-a[0].x, a[1].y-a[0].y, a[1].z-a[0].z, b[1].x-b[0].x, b[1].y-b[0].y, b[1].z-b[0].z))
src.hide_viewport = True; src.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
print("STAGE5 saved character_stage5_quad.blend")
