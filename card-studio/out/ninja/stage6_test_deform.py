"""STAGE 6 gate - test the weights at EXTREME angles (the pipeline's stated gate).
Bends the elbow, knee and shoulder hard and renders, so we MEASURE whether the joints
deform smoothly or tear/collapse - the exact failure that killed WolfLink.
Run: blender -b -P stage6_test_deform.py -- <ninja_dir>
"""
import bpy, sys, os, math
from mathutils import Vector, Matrix
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage6_rigged.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
mesh = bpy.data.objects["Char_retopo"]; arm = bpy.data.objects["Rig"]

def aim(bone, wdir):
    pb = arm.pose.bones.get(bone)
    if not pb: return
    vl.update()
    hw = arm.matrix_world @ pb.head; tw = arm.matrix_world @ pb.tail
    cur = (tw - hw)
    if cur.length < 1e-6: return
    q = cur.normalized().rotation_difference(wdir.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()

def render(tag):
    for o in sc.objects:
        if o.type == 'MESH': o.hide_render = (o is not mesh)
        if o.type == 'ARMATURE': o.hide_render = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = mesh.evaluated_get(dg).to_mesh()
    pts = [mesh.matrix_world @ v.co for v in me.vertices]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    ctr = (mn + mx) / 2; span = max(mx.x-mn.x, mx.z-mn.z) * 1.15
    eng = [e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
    sc.render.resolution_x = 620; sc.render.resolution_y = 860; sc.render.film_transparent = True
    cd = bpy.data.cameras.new("C"); cam = bpy.data.objects.new("C", cd); sc.collection.objects.link(cam)
    cd.type = 'ORTHO'; cd.ortho_scale = span; sc.camera = cam
    cam.location = (ctr.x + 4.5, ctr.y - 4.5, ctr.z); cam.rotation_euler = (math.radians(90), 0, math.radians(45))
    sun = bpy.data.objects.new("S", bpy.data.lights.new("S", 'SUN')); sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), 0, math.radians(25)); sun.data.energy = 3.2
    sc.render.filepath = os.path.join(ND, "qc_deform_%s.png" % tag)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True); bpy.data.objects.remove(sun, do_unlink=True)
    print("RENDERED", sc.render.filepath)

render("rest")
# EXTREME angles: elbow fully bent, knee fully bent, shoulder raised
aim("mixamorig:LeftArm",      Vector(( 0.9, -0.2, 0.35)))   # arm up and out
aim("mixamorig:LeftForeArm",  Vector(( 0.0, -0.7, 0.75)))   # elbow ~90+ deg
aim("mixamorig:RightArm",     Vector((-0.5, -0.8, -0.2)))
aim("mixamorig:RightForeArm", Vector((-0.1, -0.9,  0.45)))
aim("mixamorig:LeftUpLeg",    Vector(( 0.2, -0.85, -0.5)))  # hip raised forward
aim("mixamorig:LeftLeg",      Vector(( 0.1,  0.75, -0.65))) # knee bent back
vl.update()
render("extreme")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage6_posed.blend"))
