"""Headless front render of the assembled foundation for verification. Colors parts by
tag (body=grey, garment=green, accessory=purple, skeleton hidden) so the T-pose + part
seating are legible.  blender -b -P render_foundation.py -- <ninja_dir> [front|persp]"""
import bpy, sys, math
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
VIEW = sys.argv[-1] if sys.argv[-1] in ("front", "persp") else "front"
bpy.ops.wm.open_mainfile(filepath=ND + r"\ninja_foundation.blend")
sc = bpy.context.scene
COL = {"body": (0.55, 0.55, 0.58, 1), "garment": (0.10, 0.45, 0.20, 1),
       "accessory": (0.45, 0.20, 0.55, 1), "skeleton": None}
def mat(rgba):
    m = bpy.data.materials.new("v"); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = rgba; return m
mn = Vector((1e9,)*3); mx = Vector((-1e9,)*3)
for o in list(sc.objects):
    pt = o.get("part_type")
    if o.type == 'ARMATURE' or pt == "skeleton": o.hide_render = True; continue
    if o.type != 'MESH': continue
    o.data.materials.clear(); o.data.materials.append(mat(COL.get(pt, (0.7, 0.7, 0.7, 1))))
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn[i], w[i]) for i in range(3))); mx = Vector((max(mx[i], w[i]) for i in range(3)))
ctr = (mn + mx) / 2; span = max((mx - mn).x, (mx - mn).z) * 1.25
cam_d = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cam_d); sc.collection.objects.link(cam)
cam_d.type = 'ORTHO'; cam_d.ortho_scale = span; sc.camera = cam
if VIEW == "front":
    cam.location = (ctr.x, ctr.y - 6, ctr.z); cam.rotation_euler = (math.radians(90), 0, 0)
else:
    cam.location = (ctr.x + 3.5, ctr.y - 5, ctr.z + 1.2)
    d = ctr - cam.location; cam.rotation_euler = (math.atan2((d.x**2+d.y**2)**.5, d.z)*0 + math.radians(78), 0, math.atan2(d.y, d.x)+math.radians(90))
sun = bpy.data.objects.new("S", bpy.data.lights.new("S", 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(30)); sun.data.energy = 3.5
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items] else 'BLENDER_WORKBENCH'
sc.render.resolution_x = 700; sc.render.resolution_y = 1000
sc.render.film_transparent = True
sc.render.filepath = ND + r"\foundation_render.png"
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath)
