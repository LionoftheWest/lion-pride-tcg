"""Cleanup + walk + render for the anatomy-built golem. Run AFTER build_from_anatomy.py.
    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\walk_golem.py").read())
Renders a PNG sequence to out/behemoth/walk/. Assemble with ffmpeg afterwards.
"""
import bpy, sys, importlib, math, mathutils, os, numpy as np
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, animlib as A
importlib.reload(R); importlib.reload(A)
r=math.radians
arm=bpy.data.objects["GolemRig"]; scene=bpy.context.scene; vl=bpy.context.view_layer
RENDER=True; STR=0.55; LIFT=0.6

# ---- cleanup: merge tiny stray pieces into nearest neighbor ----
def cent(o): return sum((o.matrix_world@v.co for v in o.data.vertices),mathutils.Vector())/len(o.data.vertices)
pieces=[o for o in bpy.data.objects if o.name.startswith("Musc_")]
cents={o.name:cent(o) for o in pieces}
tiny=[o for o in pieces if len(o.data.vertices)<40]; big=[o for o in pieces if len(o.data.vertices)>=40]
for t in tiny:
    if t.name not in bpy.data.objects: continue
    nb=min(big,key=lambda b:(cents[b.name]-cents[t.name]).length); bn=nb.vertex_groups[0].name
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass
    t.select_set(True); nb.select_set(True); vl.objects.active=nb; bpy.ops.object.join()
    for m in [m for m in nb.modifiers if m.type=="ARMATURE"]: nb.modifiers.remove(m)
    nb.vertex_groups.clear(); R.bind_rigid({bn:[nb]},arm)
print("merged tiny:",len(tiny))

# ---- walk ----
MW=arm.matrix_world
def wtail(bn): return MW@arm.data.bones[bn].tail_local
def whead(bn): return MW@arm.data.bones[bn].head_local
ankL=wtail("shin.l"); ankR=wtail("shin.r"); kneeL=whead("shin.l"); kneeR=whead("shin.r")
for nm in ("IK_foot.l","IK_knee.l","IK_foot.r","IK_knee.r"):
    o=bpy.data.objects.get(nm)
    if o: bpy.data.objects.remove(o,do_unlink=True)
tL,pL=R.add_ik(arm,"shin.l",2,"IK_foot.l",tuple(ankL),"IK_knee.l",(ankL.x,ankL.y-3,kneeL.z+0.2),pole_angle_deg=-90)
tR,pR=R.add_ik(arm,"shin.r",2,"IK_foot.r",tuple(ankR),"IK_knee.r",(ankR.x,ankR.y-3,kneeR.z+0.2),pole_angle_deg=-90)
A.new_action(arm,"walk"); A.frames(1,32,24)
def foot(base,phase):
    ax,ay,az=base.x,base.y,base.z
    if not phase: return [(1,(ax,ay-STR,az)),(9,(ax,ay,az)),(17,(ax,ay+STR,az)),(25,(ax,ay,az+LIFT)),(33,(ax,ay-STR,az))]
    return [(1,(ax,ay+STR,az)),(9,(ax,ay,az+LIFT)),(17,(ax,ay-STR,az)),(25,(ax,ay,az)),(33,(ax,ay+STR,az))]
for f,loc in foot(ankR,False): R.key_loc(tR,f,loc)
for f,loc in foot(ankL,True):  R.key_loc(tL,f,loc)
for f,dz in [(1,0),(9,0.16),(17,0),(25,0.16),(33,0)]:
    arm.location.z=dz; arm.keyframe_insert("location",index=2,frame=f)
def K(b,f,rx=0,ry=0,rz=0):
    if b in arm.pose.bones: R.pose(arm,b,f,rot=(r(rx),r(ry),r(rz)))
for f,a in [(1,24),(9,0),(17,-24),(25,0),(33,24)]: K("upperarm.r",f,rx=a)
for f,a in [(1,-24),(9,0),(17,24),(25,0),(33,-24)]: K("upperarm.l",f,rx=a)
K("forearm.r",1,rx=-28); K("forearm.l",1,rx=-28)
for f,a in [(1,0),(17,0),(21,32),(27,12),(33,0)]: K("toe.r",f,rx=a)
for f,a in [(1,12),(5,32),(9,0),(25,0),(33,12)]: K("toe.l",f,rx=a)
for f,a in [(1,4),(17,-4),(33,4)]: K("spineB",f,rz=a)
for f,a in [(1,-3),(17,3),(33,-3)]: K("pelvis",f,rz=a)
A.ease(arm); arm.data.pose_position='POSE'
for nm in ("IK_foot.l","IK_knee.l","IK_foot.r","IK_knee.r"):
    o=bpy.data.objects.get(nm);
    if o: o.hide_viewport=True; o.hide_render=True
print("walk built")

# ---- lighting + world ----
for o in list(bpy.data.objects):
    if o.type=='LIGHT': bpy.data.objects.remove(o,do_unlink=True)
sd=bpy.data.lights.new("Sun","SUN"); sd.energy=1.4; sd.angle=r(8); so=bpy.data.objects.new("Sun",sd)
scene.collection.objects.link(so); so.rotation_euler=(r(52),r(12),r(35))
kd=bpy.data.lights.new("Key","AREA"); kd.energy=300; kd.size=12; ko=bpy.data.objects.new("Key",kd)
scene.collection.objects.link(ko); ko.location=(-7,-9,8); ko.rotation_euler=(r(55),0,r(-38))
fd=bpy.data.lights.new("Fill","AREA"); fd.energy=180; fd.size=12; fo=bpy.data.objects.new("Fill",fd)
scene.collection.objects.link(fo); fo.location=(8,-6,4); fo.rotation_euler=(r(70),0,r(50))
w=bpy.data.worlds.get("World") or bpy.data.worlds.new("World"); scene.world=w; w.use_nodes=True
bg=next(n for n in w.node_tree.nodes if n.type=='BACKGROUND'); bg.inputs[0].default_value=(0.05,0.05,0.055,1); bg.inputs[1].default_value=1.3
try: scene.view_settings.view_transform='AgX'
except Exception: pass
# tune stone material a touch darker
st=bpy.data.materials.get("StoneClean")
if st:
    b=next(n for n in st.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value=(0.26,0.255,0.25,1); b.inputs["Roughness"].default_value=0.92

# ---- camera + render ----
cam=scene.camera
cam.location=(7,-8.5,3.4); d=mathutils.Vector((0,0,2.3))-cam.location; cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler(); cam.data.lens=62
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        for sp in area.spaces:
            if sp.type=='VIEW_3D': sp.region_3d.view_perspective='CAMERA'
if RENDER:
    scene.render.engine='BLENDER_EEVEE'; scene.render.image_settings.file_format='PNG'
    scene.render.resolution_x=800; scene.render.resolution_y=900; scene.render.fps=24
    scene.frame_start=1; scene.frame_end=32
    d=r"C:\Users\vaugh\discord\card-studio\out\behemoth\walk"; os.makedirs(d,exist_ok=True)
    for f in os.listdir(d):
        if f.endswith(".png"): os.remove(os.path.join(d,f))
    scene.render.filepath=os.path.join(d,"frame_")
    bpy.ops.render.render(animation=True)
    print("rendered frames:",len([f for f in os.listdir(d) if f.endswith('.png')]))
print("WALK+RENDER DONE")
