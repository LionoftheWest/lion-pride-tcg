"""STAGE 6 gate - extreme-angle deformation test on the MODULAR rig.
Same brutal pose as the fused-mesh test, so the two are directly comparable.
Run: blender -b -P stage6_test_modular.py -- <ninja_dir>
"""
import bpy, sys, os, math
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
    q = cur.normalized().rotation_difference(wd.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()


def render(tag):
    for o in sc.objects:
        if o.type == 'MESH':
            o.hide_render = o.name.startswith("Char_")
        if o.type == 'ARMATURE':
            o.hide_render = True
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in parts:
        ev = o.evaluated_get(dg)
        m = ev.to_mesh()
        pts += [o.matrix_world @ v.co for v in m.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (mn + mx) / 2
    span = max(mx.x - mn.x, mx.z - mn.z) * 1.15
    eng = [e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
    sc.render.resolution_x = 620
    sc.render.resolution_y = 860
    sc.render.film_transparent = True
    cd = bpy.data.cameras.new("C")
    cam = bpy.data.objects.new("C", cd)
    sc.collection.objects.link(cam)
    cd.type = 'ORTHO'
    cd.ortho_scale = span
    sc.camera = cam
    cam.location = (ctr.x + 4.5, ctr.y - 4.5, ctr.z)
    cam.rotation_euler = (math.radians(90), 0, math.radians(45))
    sun = bpy.data.objects.new("S", bpy.data.lights.new("S", 'SUN'))
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), 0, math.radians(25))
    sun.data.energy = 3.2
    sc.render.filepath = os.path.join(ND, "qc_modular_%s.png" % tag)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)
    print("RENDERED", sc.render.filepath)


render("rest")
aim("mixamorig:LeftArm", Vector((0.9, -0.2, 0.35)))
aim("mixamorig:LeftForeArm", Vector((0.0, -0.7, 0.75)))
aim("mixamorig:RightArm", Vector((-0.5, -0.8, -0.2)))
aim("mixamorig:RightForeArm", Vector((-0.1, -0.9, 0.45)))
aim("mixamorig:LeftUpLeg", Vector((0.2, -0.85, -0.5)))
aim("mixamorig:LeftLeg", Vector((0.1, 0.75, -0.65)))
vl.update()
render("extreme")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage6_modular_posed.blend"))
