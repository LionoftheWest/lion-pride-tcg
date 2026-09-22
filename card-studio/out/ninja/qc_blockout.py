import bpy, sys, os, math
from mathutils import Vector
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND,"step2_blockout.blend"))
sc=bpy.context.scene
blocks=[o for o in sc.objects if o.get("blockout")]
ref=bpy.data.objects.get("REF_concept")
mn=Vector((1e18,)*3); mx=Vector((-1e18,)*3)
for o in blocks:
    for c in o.bound_box:
        w=o.matrix_world@Vector(c)
        for i in range(3): mn[i]=min(mn[i],w[i]); mx[i]=max(mx[i],w[i])
ctr=(mn+mx)/2
eng=[e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
sc.render.resolution_x=620; sc.render.resolution_y=900; sc.render.film_transparent=False
sc.world=bpy.data.worlds.new("W"); sc.world.use_nodes=True
sc.world.node_tree.nodes["Background"].inputs[0].default_value=(0.12,0.12,0.12,1)
sun=bpy.data.objects.new("S",bpy.data.lights.new("S",'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler=(math.radians(55),0,math.radians(25)); sun.data.energy=3.5
for tag,l,r,sr in (("front",(ctr.x,ctr.y-6,ctr.z),(math.radians(90),0,0),True),
                   ("side",(ctr.x+6,ctr.y,ctr.z),(math.radians(90),0,math.radians(90)),False),
                   ("q34",(ctr.x+3.6,ctr.y-4.6,ctr.z+0.35),(math.radians(82),0,math.radians(38)),False)):
    if ref: ref.hide_render = not sr
    cd=bpy.data.cameras.new("C"); cam=bpy.data.objects.new("C",cd); sc.collection.objects.link(cam)
    cd.type='ORTHO'; cd.ortho_scale=max(mx.x-mn.x,mx.z-mn.z)*1.12; sc.camera=cam
    cam.location=l; cam.rotation_euler=r
    sc.render.filepath=os.path.join(ND,"qc_block_%s.png"%tag)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    print("RENDERED", sc.render.filepath)
