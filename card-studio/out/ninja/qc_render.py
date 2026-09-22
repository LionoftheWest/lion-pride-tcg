"""Deterministic QC renders (front + side) of a named object in a blend."""
import bpy, sys, os, math
from mathutils import Vector
args = sys.argv[sys.argv.index("--")+1:]
BLEND, OBJ, OUT = args[0], args[1], args[2]
bpy.ops.wm.open_mainfile(filepath=BLEND)
sc = bpy.context.scene
o = bpy.data.objects[OBJ]
for x in sc.objects:
    if x.type == 'MESH': x.hide_render = (x is not o)
mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
for c in o.bound_box:
    w = o.matrix_world @ Vector(c)
    for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
ctr=(mn+mx)/2; span=max((mx-mn).x,(mx-mn).y,(mx-mn).z)*1.15
eng=[e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
sc.render.resolution_x=560; sc.render.resolution_y=840; sc.render.film_transparent=True
sun=bpy.data.objects.new("S", bpy.data.lights.new("S",'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler=(math.radians(55),0,math.radians(30)); sun.data.energy=3.0
for name,loc,rot in (("front",(ctr.x,ctr.y-6,ctr.z),(math.radians(90),0,0)),
                     ("side", (ctr.x+6,ctr.y,ctr.z),(math.radians(90),0,math.radians(90)))):
    cd=bpy.data.cameras.new("C"); cam=bpy.data.objects.new("C",cd); sc.collection.objects.link(cam)
    cd.type='ORTHO'; cd.ortho_scale=span; sc.camera=cam
    cam.location=loc; cam.rotation_euler=rot
    sc.render.filepath=OUT+"_"+name+".png"
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("RENDERED", sc.render.filepath)
