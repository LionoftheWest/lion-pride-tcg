"""Integrated pipeline (image -> pro-rigged figurine), Rigify backbone.
Import an AI mesh -> fit + GENERATE a Rigify control rig via our anatomy anchors ->
segment the single skin into rock plates -> rigid-bind each plate to a Rigify DEF bone ->
add the soft inner skin. The result is driven by a professional rig (stable IK/FK, foot
roll, twist bones), ready for hand-animation or mocap retarget, and glTF export.

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\build_rigify.py").read())
"""
import bpy, sys, importlib, math, mathutils, bmesh, numpy as np
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, anatomy as AN, rig_rigify as RG
importlib.reload(R); importlib.reload(AN); importlib.reload(RG)

MESH=r"C:\Users\vaugh\discord\card-studio\ml\golem\0\mesh.glb"
HEIGHT=4.58; SHOULDER_RAISE=0.08; THICK=0.03; CORE_INSET=0.18; TEST_POSE=True
r=math.radians; scene=bpy.context.scene; vl=bpy.context.view_layer

# our seed bone -> Rigify DEF bone (our .l is -x = Rigify .R ; our .r is +x = Rigify .L)
_CENTER={"pelvis":"DEF-spine","spineA":"DEF-spine.001","spineB":"DEF-spine.002",
         "spineC":"DEF-spine.003","neck":"DEF-spine.004","head":"DEF-spine.006"}
_SIDED={"clav":"DEF-shoulder","upperarm":"DEF-upper_arm","forearm":"DEF-forearm",
        "hand":"DEF-hand","thigh":"DEF-thigh","shin":"DEF-shin","foot":"DEF-foot","toe":"DEF-toe"}
def def_bone(our):
    if "." in our:
        base,side=our.split(".",1)
        if base in _SIDED: return _SIDED[base]+("."+("R" if side=="l" else "L"))
    return _CENTER.get(our,"DEF-spine")

def desel():
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass
def vb(o,w=True):
    M=o.matrix_world if w else mathutils.Matrix(); cs=[M@v.co for v in o.data.vertices]
    return (min(c.x for c in cs),max(c.x for c in cs),min(c.y for c in cs),max(c.y for c in cs),min(c.z for c in cs),max(c.z for c in cs))

# ---- clean ----
if bpy.context.mode!='OBJECT':
    try: bpy.ops.object.mode_set(mode='OBJECT')
    except Exception: pass
for o in list(bpy.data.objects):
    if o.name.startswith(("Musc_","Core","GolemOrig","meta_boss","RIG-meta","GolemRig")):
        bpy.data.objects.remove(o,do_unlink=True)

# ---- import + align ----
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=MESH)
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

# ---- fit + generate the Rigify rig ----
meta=RG.fit_metarig(g,shoulder_raise=SHOULDER_RAISE)
rig=RG.generate(meta)
bpy.data.objects.remove(meta,do_unlink=True)
defset=set(b.name for b in rig.pose.bones if b.name.startswith("DEF-"))

# ---- muscle seeds (our bone names) -> DEF ----
tpl=AN.load("human"); A=AN.measure_anchors(g,shoulder_raise=SHOULDER_RAISE); J=AN.anchored_joints(tpl,A)
seeds=AN.place_muscles_warped(tpl,J)
S=np.array([[s[2],s[3],s[4]] for s in seeds]); Sname=[s[0] for s in seeds]
Sdef=[def_bone(s[1]) if def_bone(s[1]) in defset else "DEF-spine.003" for s in seeds]

# ---- stone material ----
stone=bpy.data.materials.new("StoneClean"); stone.use_nodes=True
bsdf=next(n for n in stone.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value=(0.26,0.255,0.25,1); bsdf.inputs["Roughness"].default_value=0.92

# ---- segment -> rigid bind to DEF ----
me0=g.data; F=len(me0.polygons)
cen=np.empty(F*3); me0.polygons.foreach_get("center",cen); cen=cen.reshape(F,3)
assign=((cen[:,None,:]-S[None,:,:])**2).sum(2).argmin(1)
# coherence: peel torso faces off arm DEF bones
ARM={"DEF-upper_arm.L","DEF-upper_arm.R","DEF-forearm.L","DEF-forearm.R","DEF-hand.L","DEF-hand.R"}
TRUNK={"DEF-spine","DEF-spine.001","DEF-spine.002","DEF-spine.003","DEF-spine.004","DEF-spine.006"}
sh_x=abs(J["shoulder.l"][0]); inb=0.72*sh_x
trunk_idx=np.array([i for i,b in enumerate(Sdef) if b in TRUNK])
if len(trunk_idx):
    on_arm=np.array([Sdef[a2] in ARM for a2 in assign])
    peel=np.where(on_arm & (np.abs(cen[:,0])<inb))[0]
    for fi in peel:
        d=((cen[fi]-S[trunk_idx])**2).sum(1); assign[fi]=int(trunk_idx[d.argmin()])
    print("peeled:",len(peel))
made=0; used=set()
for si in range(len(seeds)):
    fi=np.where(assign==si)[0]
    if len(fi)<6: continue
    me=me0.copy(); bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    keep=set(int(i) for i in fi)
    bmesh.ops.delete(bm,geom=[bm.faces[i] for i in range(F) if i not in keep],context='FACES')
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bm.to_mesh(me); bm.free()
    mo=bpy.data.objects.new("Musc_%s"%Sname[si][:36], me); scene.collection.objects.link(mo)
    desel(); mo.select_set(True); vl.objects.active=mo
    so=mo.modifiers.new("sol","SOLIDIFY"); so.thickness=THICK; so.offset=-1.0
    bpy.ops.object.modifier_apply(modifier="sol")
    mo.data.materials.clear(); mo.data.materials.append(stone)
    for p in mo.data.polygons: p.use_smooth=True
    R.bind_rigid({Sdef[si]:[mo]},rig); made+=1; used.add(Sdef[si])

# ---- soft inner skin, auto-weighted to the rig's DEF bones ----
cdat=g.data.copy()
bmn=bmesh.new(); bmn.from_mesh(cdat); bmesh.ops.recalc_face_normals(bmn,faces=bmn.faces); bmn.to_mesh(cdat); bmn.free(); cdat.update()
nv=len(cdat.vertices); co=np.empty(nv*3); cdat.vertices.foreach_get("co",co); co=co.reshape(nv,3)
no=np.empty(nv*3); cdat.vertices.foreach_get("normal",no); no=no.reshape(nv,3)
cdat.vertices.foreach_set("co",(co-CORE_INSET*no).ravel()); cdat.update()
core=bpy.data.objects.new("Core",cdat); scene.collection.objects.link(core)
dark=bpy.data.materials.new("CoreDark"); dark.use_nodes=True
db=next(n for n in dark.node_tree.nodes if n.type=="BSDF_PRINCIPLED"); db.inputs["Base Color"].default_value=(0.07,0.07,0.075,1)
core.data.materials.clear(); core.data.materials.append(dark)
for p in core.data.polygons: p.use_smooth=True
R.bind_auto(core,rig)
bpy.data.objects.remove(g,do_unlink=True)
print("RIGIFY BUILD DONE pieces:",made,"DEF used:",len(used),"seeds:",len(seeds))

if TEST_POSE:
    # verify the pro rig drives the plates: FK-swing an arm + lift a leg via IK
    bpy.context.view_layer.objects.active=rig; bpy.ops.object.mode_set(mode='POSE')
    ua=rig.pose.bones.get("upper_arm_fk.L")
    if ua: ua.rotation_mode='XYZ'; ua.rotation_euler=(r(-40),0,0)
    fik=rig.pose.bones.get("foot_ik.R")
    if fik: fik.location.z+=1.2
    bpy.ops.object.mode_set(mode='OBJECT')
    print("test pose applied (arm FK + foot IK)")
