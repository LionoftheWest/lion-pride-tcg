"""Stomp attack for the anatomy-built golem. Run AFTER build_from_anatomy.py.
    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\stomp_golem.py").read())
Right foot lifts high, coils, then slams hard. Body drops on impact + a ground shake.
Renders a PNG sequence to out/behemoth/stomp/.
"""
import bpy, sys, importlib, math, mathutils, os
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, animlib as A
importlib.reload(R); importlib.reload(A)
r=math.radians
arm=bpy.data.objects["GolemRig"]; scene=bpy.context.scene; vl=bpy.context.view_layer
RENDER=True; F_END=48

# ---- cleanup: merge tiny stray pieces into nearest neighbor ----
def cent(o): return sum((o.matrix_world@v.co for v in o.data.vertices),mathutils.Vector())/len(o.data.vertices)
pieces=[o for o in bpy.data.objects if o.name.startswith("Musc_")]
if pieces:
    cents={o.name:cent(o) for o in pieces}
    tiny=[o for o in pieces if len(o.data.vertices)<70]; big=[o for o in pieces if len(o.data.vertices)>=70]
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

# ---- IK legs ----
MW=arm.matrix_world
def wtail(bn): return MW@arm.data.bones[bn].tail_local
def whead(bn): return MW@arm.data.bones[bn].head_local
ankL=wtail("shin.l"); ankR=wtail("shin.r"); kneeL=whead("shin.l"); kneeR=whead("shin.r")
for nm in ("IK_foot.l","IK_knee.l","IK_foot.r","IK_knee.r"):
    o=bpy.data.objects.get(nm)
    if o: bpy.data.objects.remove(o,do_unlink=True)
tL,pL=R.add_ik(arm,"shin.l",2,"IK_foot.l",tuple(ankL),"IK_knee.l",(ankL.x,ankL.y-3,kneeL.z+0.2),pole_angle_deg=-90)
# stomp leg (right) is FK — IK is UNSTABLE on a big fold (it flips the knee). Drive the
# thigh and shin directly. Verified signs: thigh rx-90 lifts the knee to hip height,
# shin rx+100 hangs the shin straight down.
for c in list(arm.pose.bones["shin.r"].constraints):
    if c.type=='IK': arm.pose.bones["shin.r"].constraints.remove(c)

A.new_action(arm,"stomp"); A.frames(1,F_END,24)
bx,by,bz=ankL.x,ankL.y,ankL.z      # support foot (left, IK)
def K(b,f,rx=0,ry=0,rz=0):
    if b in arm.pose.bones: R.pose(arm,b,f,rot=(r(rx),r(ry),r(rz)))
# STOMP LEG (right) FK: lift the knee to hip height, hang the shin, then slam forward-down.
for f,a in [(1,-4),(7,-48),(13,-92),(17,-92),(21,-30),(25,-24),(48,-24)]: K("thigh.r",f,rx=a)
for f,a in [(1,6),(7,60),(13,102),(17,102),(21,18),(25,12),(48,12)]: K("shin.r",f,rx=a)
for f,a in [(1,0),(13,42),(17,42),(21,-4),(25,2),(48,2)]: K("foot.r",f,rx=a)
# support foot: plant, small weight shift
for f,loc in [(1,(bx,by,bz)),(17,(bx,by-0.04,bz)),(21,(bx,by-0.06,bz)),(48,(bx,by,bz))]:
    R.key_loc(tL,f,loc)
# body height: small coil rise (a big rise fights the high knee), drop HARD on impact
for f,dz in [(1,0),(13,0.14),(17,0.14),(21,-0.44),(24,-0.20),(28,-0.30),(32,-0.10),(36,0.03),(48,0)]:
    arm.location.z=dz; arm.keyframe_insert("location",index=2,frame=f)
# ground shake (side to side) after impact
for f,dx in [(1,0),(21,0),(22,0.06),(24,-0.05),(26,0.035),(29,-0.02),(32,0)]:
    arm.location.x=dx; arm.keyframe_insert("location",index=0,frame=f)
def K(b,f,rx=0,ry=0,rz=0):
    if b in arm.pose.bones: R.pose(arm,b,f,rot=(r(rx),r(ry),r(rz)))
# torso: coil back on the lift, whip forward on the slam, settle
for f,a in [(1,0),(13,-14),(17,-14),(21,20),(25,9),(32,2),(48,0)]: K("spineC",f,rx=a)
for f,a in [(1,0),(13,-8),(17,-8),(21,12),(25,5),(48,0)]: K("spineB",f,rx=a)
# arms: angry-stomp pose — elbows FLARED OUT to the sides, forearms bent UP (fists up).
# forearm rx is POSITIVE (negative folds the fists down-and-in, the wrong way).
for f,rx,rz in [(1,-4,44),(13,-8,50),(17,-8,50),(21,6,46),(25,-2,46),(48,-4,44)]: K("upperarm.r",f,rx=rx,rz=rz)
for f,rx,rz in [(1,-4,-44),(13,-8,-50),(17,-8,-50),(21,6,-46),(25,-2,-46),(48,-4,-44)]: K("upperarm.l",f,rx=rx,rz=rz)
for f,a in [(1,68),(21,80),(25,74),(48,68)]: K("forearm.r",f,rx=a)
for f,a in [(1,68),(21,80),(25,74),(48,68)]: K("forearm.l",f,rx=a)
# stomp foot toe: dangle down on the high knee, flat on the slam
for f,a in [(1,0),(13,-45),(17,-45),(21,0),(48,0)]: K("toe.r",f,rx=a)
A.ease(arm); arm.data.pose_position='POSE'
for nm in ("IK_foot.l","IK_knee.l","IK_foot.r","IK_knee.r"):
    o=bpy.data.objects.get(nm)
    if o: o.hide_viewport=True; o.hide_render=True
print("stomp built")

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
st=bpy.data.materials.get("StoneClean")
if st:
    b=next(n for n in st.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value=(0.26,0.255,0.25,1); b.inputs["Roughness"].default_value=0.92

# ---- camera (a touch lower for impact) + render ----
cam=scene.camera
cam.location=(7.5,-11.5,3.3); d=mathutils.Vector((0,0,2.6))-cam.location; cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler(); cam.data.lens=54
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        for sp in area.spaces:
            if sp.type=='VIEW_3D': sp.region_3d.view_perspective='CAMERA'
if RENDER:
    scene.render.engine='BLENDER_EEVEE'; scene.render.image_settings.file_format='PNG'
    scene.render.resolution_x=800; scene.render.resolution_y=900; scene.render.fps=24
    scene.frame_start=1; scene.frame_end=F_END
    d=r"C:\Users\vaugh\discord\card-studio\out\behemoth\stomp"; os.makedirs(d,exist_ok=True)
    for f in os.listdir(d):
        if f.endswith(".png"): os.remove(os.path.join(d,f))
    scene.render.filepath=os.path.join(d,"frame_")
    bpy.ops.render.render(animation=True)
    print("rendered frames:",len([f for f in os.listdir(d) if f.endswith('.png')]))
print("STOMP DONE")
