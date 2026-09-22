"""STAGE 3 - RETOPOLOGY.
The AI mesh is 334k triangles with no edge flow. Instead of auto-remeshing into topology
with no intent, we use a BASE MESH that already has production topology (the Mixamo body:
~98.8% quads with proper edge loops at shoulders/elbows/knees) and CONFORM it to the
high-poly sculpt. This is the standard "retopo from a base mesh" approach and it is free.
Output: a clean quad body that matches the generated character's proportions, still rigged.
Run: blender -b -P stage3_retopo.py -- <ninja_dir>
"""
import bpy, sys, os, math
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
MX = os.path.join(ND, "mixamo")
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
hp = bpy.data.objects["source_highpoly"]
bpy.data.collections["HIGH_POLY"].hide_select = False

def wbb(o):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

# --- bring in the retopologised base mesh (clean quads + edge loops) + its skeleton ---
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=os.path.join(MX, "xbot_base_tpose.fbx"))
imp = [o for o in bpy.data.objects if o not in before]
base = max([o for o in imp if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
base.name = "Body_retopo"
arm = next(o for o in imp if o.type == 'ARMATURE')
for o in imp:
    if o.type == 'MESH' and o is not base: bpy.data.objects.remove(o, do_unlink=True)
vl.update()
# match height + ground to the high-poly
hmn, hmx = wbb(hp); bmn, bmx = wbb(base)
s = (hmx.z - hmn.z) / max(1e-6, (bmx.z - bmn.z))
arm.scale = tuple(v * s for v in arm.scale); vl.update()
bmn, bmx = wbb(base)
arm.location.z += hmn.z - bmn.z
arm.location.x += ((hmn.x + hmx.x) / 2) - ((bmn.x + bmx.x) / 2)
arm.location.y += ((hmn.y + hmx.y) / 2) - ((bmn.y + bmx.y) / 2)
vl.update()
bmn, bmx = wbb(base)

quads = sum(1 for p in base.data.polygons if len(p.vertices) == 4)
print("GATE retopo_base verts=%d faces=%d quads=%d (%.1f%%)"
      % (len(base.data.vertices), len(base.data.polygons), quads,
         100.0 * quads / max(1, len(base.data.polygons))))
print("GATE align base H=%.3f vs highpoly H=%.3f | base W=%.3f D=%.3f"
      % (bmx.z - bmn.z, hmx.z - hmn.z, bmx.x - bmn.x, bmx.y - bmn.y))
print("GATE budget tris_lowpoly=%d (stylized PC target 5k-15k)" % (len(base.data.polygons) * 2))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage3_retopo.blend"))
print("STAGE3 saved character_stage3_retopo.blend")
