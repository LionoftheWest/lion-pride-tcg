"""STAGE 5 - retopologise the WHOLE character (it is watertight) then re-separate.
Quadriflow needs a manifold mesh, so it must run on the closed high-poly, not on the
open shells we cut out of it.
Run: blender -b -P stage5_quad_whole.py -- <ninja_dir> [target_faces]
"""
import bpy, sys, os
ND = sys.argv[sys.argv.index("--") + 1]
TGT = int(sys.argv[sys.argv.index("--") + 2]) if len(sys.argv) > sys.argv.index("--") + 2 else 9000
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
hp = bpy.data.objects["source_highpoly"]
hp.hide_viewport = False

# manifold check
import bmesh
bm = bmesh.new(); bm.from_mesh(hp.data)
nonman = sum(1 for e in bm.edges if not e.is_manifold)
bound = sum(1 for e in bm.edges if e.is_boundary)
bm.free()
print("GATE manifold: non_manifold_edges=%d boundary_edges=%d (watertight needs 0/0)" % (nonman, bound))

lo = hp.copy(); lo.data = hp.data.copy(); lo.name = "Char_retopo"
sc.collection.objects.link(lo)
for c in list(lo.users_collection):
    if c.name == "HIGH_POLY": c.objects.unlink(lo)
if "RETOPO" in bpy.data.collections and lo.name not in bpy.data.collections["RETOPO"].objects:
    bpy.data.collections["RETOPO"].objects.link(lo)
bpy.ops.object.select_all(action='DESELECT')
lo.select_set(True); vl.objects.active = lo
before = len(lo.data.polygons)
err = ""
try:
    bpy.ops.object.quadriflow_remesh(target_faces=TGT, use_preserve_sharp=False,
                                     use_preserve_boundary=False, use_mesh_symmetry=True)
except Exception as e:
    err = str(e)[:120]
after = len(lo.data.polygons)
q = sum(1 for p in lo.data.polygons if len(p.vertices) == 4)
print("GATE quadriflow: %d tris -> %d faces, quads=%.1f%%  %s"
      % (before, after, 100.0*q/max(1,after), err))
for p in lo.data.polygons: p.use_smooth = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
print("STAGE5 saved character_stage5_quad.blend")
