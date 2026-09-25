"""Consolidated humanoid rock-golem build: segment the AI single-skin into many rigid
muscle-pieces bound to a robust skeleton, then a walk. Edit SEEDS/params + re-exec.

Run inside Blender:  exec(open(r"...\\build_golem.py").read())
Requires: a "GolemRig" armature already in the scene, the TripoSR mesh.glb on disk.
"""
import bpy, sys, importlib, math, mathutils, bmesh, numpy as np
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, animlib as A
importlib.reload(R); importlib.reload(A)

GLB = r"C:\Users\vaugh\discord\card-studio\ml\golem\0\mesh.glb"
HEIGHT = 4.58
r = math.radians
scene = bpy.context.scene; vl = bpy.context.view_layer
arm = bpy.data.objects["GolemRig"]; stone = bpy.data.materials.get("StoneClean")

def desel():
    for o in vl.objects:
        try: o.select_set(False)
        except Exception: pass
def vb(o, w=True):
    M = o.matrix_world if w else mathutils.Matrix(); cs=[M@v.co for v in o.data.vertices]
    return (min(c.x for c in cs),max(c.x for c in cs),min(c.y for c in cs),max(c.y for c in cs),min(c.z for c in cs),max(c.z for c in cs))

if bpy.context.mode != 'OBJECT':
    try: bpy.ops.object.mode_set(mode='OBJECT')
    except Exception: pass
for o in list(scene.objects):
    if o.type=='MESH' and o.name.startswith(("Musc_","Golem","GolemOrig")): bpy.data.objects.remove(o,do_unlink=True)

before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=GLB)
g=[o for o in bpy.data.objects if o not in before and o.type=='MESH'][0]; g.name="GolemOrig"
desel(); g.select_set(True); vl.objects.active=g
try: bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
except Exception: pass
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
x0,x1,y0,y1,z0,z1=vb(g,False); dx,dy,dz=x1-x0,y1-y0,z1-z0
if dy>=dx and dy>=dz: g.data.transform(mathutils.Matrix.Rotation(r(90),4,'X'))
elif dx>=dy and dx>=dz: g.data.transform(mathutils.Matrix.Rotation(r(-90),4,'Y'))
g.data.update()
x0,x1,y0,y1,z0,z1=vb(g); s=HEIGHT/(z1-z0); g.scale=(s,s,s); bpy.ops.object.transform_apply(scale=True)
x0,x1,y0,y1,z0,z1=vb(g); g.location=(-(x0+x1)/2,-0.1-(y0+y1)/2,0.2-z0); bpy.ops.object.transform_apply(location=True)

# ---- muscle SEEDS: center + right (auto-mirrored to left). bone .R -> .L, x negated ----
C=[("head","head",0,-0.15,4.55),("neck1","neck",0,-0.1,4.08),("neck2","neck",0,-0.12,3.88),
   ("absU","spineB",0,-0.35,3.1),("absL","spineA",0,-0.3,2.66),("lowbk","spineB",0,0.5,2.75)]
Rs=[("pec","spineC",0.5,-0.42,3.55),("pecUp","spineC",0.5,-0.3,3.95),("trap","spineC",0.3,0.14,4.12),
    ("upbk","spineC",0.5,0.5,3.65),("midbk","spineB",0.45,0.55,3.05),("obl","spineB",0.62,-0.1,2.9),
    ("hip","thigh.R",0.5,-0.05,2.12),
    ("deltCap","upperarm.R",1.02,-0.03,4.05),("delt","upperarm.R",1.34,-0.05,3.85),("deltBk","upperarm.R",1.28,0.3,3.7),
    ("bic","upperarm.R",1.4,-0.3,2.95),("tri","upperarm.R",1.4,0.3,2.95),
    ("farmU","forearm.R",1.5,0,2.15),("farmL","forearm.R",1.55,0,1.72),
    ("wrist","hand.R",1.6,0,1.55),("fist","hand.R",1.62,-0.15,1.3),
    ("quadU","thigh.R",0.5,-0.15,2.2),("quadL","thigh.R",0.5,-0.1,1.6),("ham","thigh.R",0.5,0.35,1.9),
    ("knee","shin.R",0.5,-0.05,1.45),("calfU","shin.R",0.5,0,1.1),("calfL","shin.R",0.5,0.05,0.72),
    ("ankle","foot.R",0.5,0.15,0.5),("heel","foot.R",0.5,0.22,0.3),("ball","toe.R",0.5,-0.35,0.32)]
S=list(C)
for nm,bone,x,y,z in Rs:
    S.append((nm+"R",bone,x,y,z))
    lb=bone[:-2]+".L" if bone.endswith(".R") else bone
    S.append((nm+"L",lb,-x,y,z))
seeds=np.array([[s[2],s[3],s[4]] for s in S]); bones=[s[1] for s in S]; names=[s[0] for s in S]
me0=g.data; F=len(me0.polygons); cen=np.empty(F*3); me0.polygons.foreach_get("center",cen); cen=cen.reshape(F,3)
assign=((cen[:,None,:]-seeds[None,:,:])**2).sum(2).argmin(1)
flatset={"ankleR","ankleL","heelR","heelL","ballR","ballL"}
Tflat=mathutils.Matrix.Translation((0,0,0.2))@mathutils.Matrix.Scale(0.6,4,(0,0,1))@mathutils.Matrix.Translation((0,0,-0.2))
made=0
for si in range(len(S)):
    fi=np.where(assign==si)[0]
    if len(fi)<6: continue
    me=me0.copy(); bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    keep=set(int(i) for i in fi)
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in range(F) if i not in keep], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me); bm.free()
    if names[si] in flatset: me.transform(Tflat)
    mo=bpy.data.objects.new("Musc_%s"%names[si], me); scene.collection.objects.link(mo)
    desel(); mo.select_set(True); vl.objects.active=mo
    so=mo.modifiers.new("sol","SOLIDIFY"); so.thickness=0.07; so.offset=0.0
    bpy.ops.object.modifier_apply(modifier="sol")
    c=sum((mathutils.Vector(cc) for cc in mo.bound_box), mathutils.Vector())/8.0
    mo.data.transform(mathutils.Matrix.Translation(c)@mathutils.Matrix.Scale(1.04,4)@mathutils.Matrix.Translation(-c))
    if stone: mo.data.materials.append(stone)
    for p in mo.data.polygons: p.use_smooth=True
    R.bind_rigid({bones[si]:[mo]}, arm); made+=1
bpy.data.objects.remove(g, do_unlink=True)
print("BUILD pieces:", made)

# ---- WALK ----
for nm in ("IK_foot.R","IK_knee.R","IK_foot.L","IK_knee.L"):
    o=bpy.data.objects.get(nm)
    if o: bpy.data.objects.remove(o,do_unlink=True)
tR,pR=R.add_ik(arm,"shin.R",2,"IK_foot.R",(0.5,0.05,0.5),"IK_knee.R",(0.5,-2.6,1.4),pole_angle_deg=-90)
tL,pL=R.add_ik(arm,"shin.L",2,"IK_foot.L",(-0.5,0.05,0.5),"IK_knee.L",(-0.5,-2.6,1.4),pole_angle_deg=-90)
A.new_action(arm,"walk"); A.frames(1,32,24)
for f,loc in [(1,(0.5,-0.35,0.5)),(9,(0.5,0.05,0.5)),(17,(0.5,0.4,0.5)),(25,(0.5,0.0,0.98)),(33,(0.5,-0.35,0.5))]: R.key_loc(tR,f,loc)
for f,loc in [(1,(-0.5,0.4,0.5)),(9,(-0.5,0.0,0.98)),(17,(-0.5,-0.35,0.5)),(25,(-0.5,0.05,0.5)),(33,(-0.5,0.4,0.5))]: R.key_loc(tL,f,loc)
for f,dz in [(1,0),(9,0.13),(17,0),(25,0.13),(33,0)]:
    arm.location.z=dz; arm.keyframe_insert("location",index=2,frame=f)
def K(b,f,rx=0,rz=0): R.pose(arm,b,f,rot=(r(rx),0,r(rz)))
for f,a in [(1,20),(9,0),(17,-20),(25,0),(33,20)]: K("upperarm.R",f,rx=a)
for f,a in [(1,-20),(9,0),(17,20),(25,0),(33,-20)]: K("upperarm.L",f,rx=a)
K("forearm.R",1,rx=-22); K("forearm.L",1,rx=-22)
for f,a in [(1,0),(17,0),(21,28),(27,12),(33,0)]: K("toe.R",f,rx=a)
for f,a in [(1,12),(5,28),(9,0),(25,0),(33,12)]: K("toe.L",f,rx=a)
for f,a in [(1,3),(17,-3),(33,3)]: K("spineB",f,rz=a)
A.ease(arm)
arm.data.pose_position='POSE'
print("BUILD DONE")
