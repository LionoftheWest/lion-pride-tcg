"""Anatomy-driven build: import an AI mesh, fit the anatomy template by anchors, build
the skeleton, segment the single skin into per-muscle rigid pieces bound to bones.
Anatomy first, surface second. Edit the CONFIG block + re-exec.

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\build_from_anatomy.py").read())
"""
import bpy, sys, importlib, math, mathutils, bmesh, numpy as np
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, anatomy as AN
importlib.reload(R); importlib.reload(AN)

# ---- CONFIG ----
MESH   = r"C:\Users\vaugh\discord\card-studio\ml\golem\0\mesh.glb"
NAME   = "GolemRig"
HEIGHT = 4.58
SHOULDER_RAISE = 0.08     # neckless behemoth: lift the shoulder line
THICK  = 0.03             # thin plate — outer surface stays the original detailed skin
GROW   = 1.0              # NO grow — grow inflates pieces into michelin pillows
SMOOTH = True             # smooth WITHIN each thin plate; hard seams between plates.
                          # (pudge came from thick+grow lumps, not from smooth shading)
CORE   = True             # soft inner skin, deep near the skeleton, fills the shell gaps
CORE_INSET = 0.18         # push the inner skin well inside (nearer the skeleton)
r = math.radians

# clean the scene by data removal (read_homefile mid-exec leaves a stale context)
if bpy.context.mode!='OBJECT':
    try: bpy.ops.object.mode_set(mode='OBJECT')
    except Exception: pass
for _c in list(bpy.data.collections):
    if _c.name in ("Skeleton","Muscles"):
        for _o in list(_c.objects): bpy.data.objects.remove(_o,do_unlink=True)
for _o in list(bpy.data.objects): bpy.data.objects.remove(_o,do_unlink=True)
scene=bpy.context.scene; vl=bpy.context.view_layer
def vb(o,w=True):
    M=o.matrix_world if w else mathutils.Matrix(); cs=[M@v.co for v in o.data.vertices]
    return (min(c.x for c in cs),max(c.x for c in cs),min(c.y for c in cs),max(c.y for c in cs),min(c.z for c in cs),max(c.z for c in cs))
def desel():
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass

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

# ---- anatomy: fit + skeleton + warped muscle seeds ----
arm,J,seeds=AN.build_rig(g,NAME,shoulder_raise=SHOULDER_RAISE)

# ---- stone material ----
stone=bpy.data.materials.new("StoneClean"); stone.use_nodes=True
bsdf=next(n for n in stone.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value=(0.32,0.31,0.30,1); bsdf.inputs["Roughness"].default_value=0.9

# ---- segment single skin -> per-muscle rigid pieces ----
S=np.array([[s[2],s[3],s[4]] for s in seeds]); Sbone=[s[1] for s in seeds]; Sname=[s[0] for s in seeds]
me0=g.data; F=len(me0.polygons)
cen=np.empty(F*3); me0.polygons.foreach_get("center",cen); cen=cen.reshape(F,3)
assign=((cen[:,None,:]-S[None,:,:])**2).sum(2).argmin(1)
# coherence pass: peel torso faces that bled onto an arm bone back to a trunk muscle.
# an arm rock must not carry chest surface (the pec/delt boundary bleed).
ARM={"upperarm.l","upperarm.r","forearm.l","forearm.r","hand.l","hand.r"}
TRUNK={"spineA","spineB","spineC","pelvis","neck","head"}
sh_x=abs(J["shoulder.l"][0]); inb=0.72*sh_x
trunk_idx=np.array([i for i,b in enumerate(Sbone) if b in TRUNK])
if len(trunk_idx):
    on_arm=np.array([Sbone[a] in ARM for a in assign])
    peel=np.where(on_arm & (np.abs(cen[:,0])<inb))[0]
    for fi in peel:
        d=((cen[fi]-S[trunk_idx])**2).sum(1); assign[fi]=int(trunk_idx[d.argmin()])
    print("peeled torso faces off arms:",len(peel))
made=0; used=set()
for si in range(len(seeds)):
    fi=np.where(assign==si)[0]
    if len(fi)<6: continue
    me=me0.copy(); bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    keep=set(int(i) for i in fi)
    bmesh.ops.delete(bm,geom=[bm.faces[i] for i in range(F) if i not in keep],context='FACES')
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bm.to_mesh(me); bm.free()
    mo=bpy.data.objects.new("Musc_%s"%Sname[si][:38], me); scene.collection.objects.link(mo)
    desel(); mo.select_set(True); vl.objects.active=mo
    so=mo.modifiers.new("sol","SOLIDIFY"); so.thickness=THICK; so.offset=-1.0  # thicken inward
    bpy.ops.object.modifier_apply(modifier="sol")
    if GROW!=1.0:
        c=sum((mathutils.Vector(cc) for cc in mo.bound_box),mathutils.Vector())/8.0
        mo.data.transform(mathutils.Matrix.Translation(c)@mathutils.Matrix.Scale(GROW,4)@mathutils.Matrix.Translation(-c))
    mo.data.materials.clear(); mo.data.materials.append(stone)  # drop the inherited AI texture
    for p in mo.data.polygons: p.use_smooth=SMOOTH
    R.bind_rigid({Sbone[si]:[mo]},arm); made+=1; used.add(Sbone[si])
# dark inner core: original skin pushed inward along normals, smooth-skinned to the rig
if CORE:
    cdat=g.data.copy()
    # recalc normals consistently OUTWARD first (AI mesh normals are inconsistent, which
    # made -normal push some verts outward -> core poked through the plates)
    bmn=bmesh.new(); bmn.from_mesh(cdat); bmesh.ops.recalc_face_normals(bmn,faces=bmn.faces)
    bmn.to_mesh(cdat); bmn.free(); cdat.update()
    nv=len(cdat.vertices)
    co=np.empty(nv*3); cdat.vertices.foreach_get("co",co); co=co.reshape(nv,3)
    no=np.empty(nv*3); cdat.vertices.foreach_get("normal",no); no=no.reshape(nv,3)
    cdat.vertices.foreach_set("co",(co-CORE_INSET*no).ravel()); cdat.update()
    core=bpy.data.objects.new("Core",cdat); scene.collection.objects.link(core)
    dark=bpy.data.materials.new("CoreDark"); dark.use_nodes=True
    db=next(n for n in dark.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    db.inputs["Base Color"].default_value=(0.07,0.07,0.075,1); db.inputs["Roughness"].default_value=1.0
    core.data.materials.clear(); core.data.materials.append(dark)
    for p in core.data.polygons: p.use_smooth=True   # puffy soft inner skin
    R.bind_auto(core,arm)
bpy.data.objects.remove(g,do_unlink=True)
arm.show_in_front=False

# ---- camera ----
cam=scene.camera
if cam is None:
    cd=bpy.data.cameras.new("Cam"); cam=bpy.data.objects.new("Cam",cd); scene.collection.objects.link(cam); scene.camera=cam
cam.location=(0,-13,2.6); d=mathutils.Vector((0,0,2.4))-cam.location; cam.rotation_euler=d.to_track_quat('-Z','Y').to_euler()
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':
        for sp in area.spaces:
            if sp.type=='VIEW_3D': sp.region_3d.view_perspective='CAMERA'
print("ANAT BUILD DONE  pieces:",made,"bones used:",len(used),"seeds:",len(seeds))
