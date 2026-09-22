import bpy, sys, os, math
from mathutils import Vector
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND,"character_stage7_animated.blend"))
sc=bpy.context.scene; vl=bpy.context.view_layer
sc.frame_set(37); vl.update()
pon=bpy.data.objects["P_poncho"]
import bmesh
bm=bmesh.new(); bm.from_mesh(pon.data)
bound=sum(1 for e in bm.edges if e.is_boundary)
# connected components
seen=set(); comps=0
for v in bm.verts:
    if v.index in seen: continue
    comps+=1; st=[v]
    while st:
        x=st.pop()
        if x.index in seen: continue
        seen.add(x.index)
        for e in x.link_edges:
            o=e.other_vert(x)
            if o.index not in seen: st.append(o)
bm.free()
print("PONCHO verts=%d faces=%d boundary_edges=%d islands=%d" %
      (len(pon.data.vertices), len(pon.data.polygons), bound, comps))
for o in sc.objects:
    if o.type=='MESH': o.hide_render = (o is not pon)
    if o.type=='ARMATURE': o.hide_render=True
dg=bpy.context.evaluated_depsgraph_get()
m=pon.evaluated_get(dg).to_mesh()
pts=[pon.matrix_world@v.co for v in m.vertices]
mn=Vector((min(p.x for p in pts),min(p.y for p in pts),min(p.z for p in pts)))
mx=Vector((max(p.x for p in pts),max(p.y for p in pts),max(p.z for p in pts)))
ctr=(mn+mx)/2
eng=[e.identifier for e in sc.render.bl_rna.properties['engine'].enum_items]
sc.render.engine='BLENDER_EEVEE' if 'BLENDER_EEVEE' in eng else 'BLENDER_WORKBENCH'
sc.render.resolution_x=560; sc.render.resolution_y=760; sc.render.film_transparent=True
cd=bpy.data.cameras.new("C"); cam=bpy.data.objects.new("C",cd); sc.collection.objects.link(cam)
cd.type='ORTHO'; cd.ortho_scale=max(mx.x-mn.x,mx.z-mn.z)*1.25; sc.camera=cam
cam.location=(ctr.x,ctr.y-6,ctr.z); cam.rotation_euler=(math.radians(90),0,0)
sun=bpy.data.objects.new("S",bpy.data.lights.new("S",'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler=(math.radians(55),0,math.radians(20)); sun.data.energy=3.2
sc.render.filepath=os.path.join(ND,"qc_poncho_only.png")
bpy.ops.render.render(write_still=True)
print("RENDERED", sc.render.filepath)
