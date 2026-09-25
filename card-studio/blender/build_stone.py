"""Step 6 (v2): the STONE LAYER as RIGID rock plates over the working figure.
Rock does not stretch. So the shell is segmented into per-muscle-group plates, each bound
RIGIDLY to ONE bone (no stretch). They pivot at their seams. The smooth rigged figure
stays underneath as the dark backing, so a seam shows rock body — never a hollow gap.
Run AFTER build_base.py (needs 'Base' + 'RIG-meta_boss').

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\build_stone.py").read())
"""
import bpy, sys, importlib, math, mathutils, bmesh, numpy as np
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import riglib as R, anatomy as AN
importlib.reload(R); importlib.reload(AN)

MESH=r"C:\Users\vaugh\discord\card-studio\ml\golem\0\mesh.glb"
HEIGHT=4.58; SHOULDER_RAISE=0.08; THICK=0.05   # THIN crisp plates (thick+grow = michelin puff)
r=math.radians; scene=bpy.context.scene; vl=bpy.context.view_layer
base=bpy.data.objects["Base"]; rig=bpy.data.objects["RIG-meta_boss"]

_CENTER={"pelvis":"DEF-spine","spineA":"DEF-spine.001","spineB":"DEF-spine.002",
         "spineC":"DEF-spine.003","neck":"DEF-spine.004","head":"DEF-spine.006"}
_SIDED={"clav":"DEF-shoulder","upperarm":"DEF-upper_arm","forearm":"DEF-forearm",
        "hand":"DEF-hand","thigh":"DEF-thigh","shin":"DEF-shin","foot":"DEF-foot","toe":"DEF-toe"}
def def_bone(our):
    if "." in our:
        b,side=our.split(".",1)
        if b in _SIDED: return _SIDED[b]+("."+("R" if side=="l" else "L"))
    return _CENTER.get(our,"DEF-spine")
def desel():
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass
def vb(o,w=True):
    M=o.matrix_world if w else mathutils.Matrix(); cs=[M@v.co for v in o.data.vertices]
    return (min(c.x for c in cs),max(c.x for c in cs),min(c.y for c in cs),max(c.y for c in cs),min(c.z for c in cs),max(c.z for c in cs))

for o in list(bpy.data.objects):
    if o.name.startswith(("StoneShell","Plate_","SRC")): bpy.data.objects.remove(o,do_unlink=True)

# figure becomes the dark rock backing (shows between plates, never hollow)
darkstone=bpy.data.materials.get("DarkStone")
if not darkstone:
    darkstone=bpy.data.materials.new("DarkStone"); darkstone.use_nodes=True
    b=next(n for n in darkstone.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    # near-black + fully rough -> reads as shadow/void between rocks, never as skin
    b.inputs["Base Color"].default_value=(0.03,0.03,0.032,1); b.inputs["Roughness"].default_value=1.0
base.data.materials.clear(); base.data.materials.append(darkstone)

# import + align the detailed AI mesh (the rock source)
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=MESH)
g=[o for o in bpy.data.objects if o not in before and o.type=='MESH'][0]; g.name="SRC"
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

# remove loose islands (AI-mesh artifacts that become floating rock chunks)
desel(); g.select_set(True); vl.objects.active=g
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE'); bpy.ops.object.mode_set(mode='OBJECT')
parts=[o for o in bpy.data.objects if o.name.startswith("SRC")]
parts.sort(key=lambda o: len(o.data.vertices), reverse=True)
g=parts[0]
for o in parts[1:]: bpy.data.objects.remove(o,do_unlink=True)
g.name="SRC"; desel(); g.select_set(True); vl.objects.active=g
print("kept largest component:",len(g.data.vertices),"verts; removed",len(parts)-1,"loose islands")

# muscle seeds -> DEF bones
tpl=AN.load("human"); A=AN.measure_anchors(g,shoulder_raise=SHOULDER_RAISE); J=AN.anchored_joints(tpl,A)
seeds=AN.place_muscles_warped(tpl,J)
# add crown/skull seeds bound to the HEAD bone, so the top of the head is covered and FOLLOWS
# the head (the muscle map has no skull cap, so crown faces were binding to the neck)
_top=A["top"]; _H=A["_H"]
for _dx,_dy in [(0,-0.02),(-0.09,0),(0.09,0),(0,0.07),(0,-0.11),(0,0.0)]:
    seeds.append(("skull","head",float(_top[0]+_dx*_H),float(_top[1]+_dy*_H),float(_top[2]-0.02*_H)))
# extra chunks on HANDS and FEET (blobby in the AI mesh -> one big plate reads michelin)
_HF=[(0,0,0),(0.05,0,0),(-0.05,0,0),(0,0,-0.05),(0,0,0.05),(0,-0.05,0),(0.04,0,-0.05),(-0.04,0,-0.05)]
for _s in ("l","r"):
    _hw=J.get("hand."+_s); _an=J.get("ankle."+_s); _bl=J.get("ball."+_s)
    if _hw:
        for _dx,_dy,_dz in _HF:
            seeds.append(("hand","hand."+_s,float(_hw[0]+_dx*_H),float(_hw[1]+_dy*_H),float(_hw[2]+_dz*_H)))
    if _an and _bl:
        _fc=[(_an[i]+_bl[i])/2 for i in range(3)]
        for _dx,_dy,_dz in _HF:
            seeds.append(("foot","foot."+_s,float(_fc[0]+_dx*_H),float(_fc[1]+_dy*_H),float(_fc[2]+_dz*_H)))
defset=set(b.name for b in rig.pose.bones if b.name.startswith("DEF-"))
S=np.array([[s[2],s[3],s[4]] for s in seeds]); Sname=[s[0] for s in seeds]
Sdef=[def_bone(s[1]) if def_bone(s[1]) in defset else "DEF-spine.003" for s in seeds]

stone=bpy.data.materials.get("StoneClean")
if not stone:
    stone=bpy.data.materials.new("StoneClean"); stone.use_nodes=True
    b=next(n for n in stone.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value=(0.30,0.29,0.28,1); b.inputs["Roughness"].default_value=0.9

me0=g.data; F=len(me0.polygons)
cen=np.empty(F*3); me0.polygons.foreach_get("center",cen); cen=cen.reshape(F,3)
# assign each face to its nearest muscle seed -> plate (each plate bound to that seed's bone)
assign=((cen[:,None,:]-S[None,:,:])**2).sum(2).argmin(1)
# peel torso faces off arm bones (chest must not ride the arm plate)
ARM={"DEF-upper_arm.L","DEF-upper_arm.R","DEF-forearm.L","DEF-forearm.R","DEF-hand.L","DEF-hand.R"}
TRUNK={"DEF-spine","DEF-spine.001","DEF-spine.002","DEF-spine.003","DEF-spine.004","DEF-spine.006"}
inb=0.72*abs(J["shoulder.l"][0]); trunk_idx=np.array([i for i,b in enumerate(Sdef) if b in TRUNK])
if len(trunk_idx):
    on_arm=np.array([Sdef[a2] in ARM for a2 in assign]); peel=np.where(on_arm & (np.abs(cen[:,0])<inb))[0]
    for fi in peel:
        d=((cen[fi]-S[trunk_idx])**2).sum(1); assign[fi]=int(trunk_idx[d.argmin()])
made=0
for si in range(len(seeds)):
    fi=np.where(assign==si)[0]
    if len(fi)<6: continue
    me=me0.copy(); bm=bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    keep=set(int(i) for i in fi)
    bmesh.ops.delete(bm,geom=[bm.faces[i] for i in range(F) if i not in keep],context='FACES')
    bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_faces],context='VERTS')
    bm.to_mesh(me); bm.free()
    mo=bpy.data.objects.new("Plate_%s"%Sname[si][:34], me); scene.collection.objects.link(mo)
    desel(); mo.select_set(True); vl.objects.active=mo
    so=mo.modifiers.new("sol","SOLIDIFY"); so.thickness=THICK; so.offset=-1.0  # solid chunk, depth INWARD
    bpy.ops.object.modifier_apply(modifier="sol")
    # NO grow — growing inflates each plate into a puffy michelin lump. The outer face stays
    # the original crisp detailed surface; the dark core (recessed just behind) prevents hollow.
    mo.data.materials.clear(); mo.data.materials.append(stone)
    for p in mo.data.polygons: p.use_smooth=True
    R.bind_rigid({Sdef[si]:[mo]},rig); made+=1   # RIGID -> one bone, no stretch

# dark core built from the SAME SRC mesh as the plates (shrunk inward) so it is ALWAYS inside
# them and never pokes through. Smooth-skinned to the rig. Fills the interior (no hollow).
cdat=g.data.copy()
bmn=bmesh.new(); bmn.from_mesh(cdat); bmesh.ops.recalc_face_normals(bmn,faces=bmn.faces); bmn.to_mesh(cdat); bmn.free(); cdat.update()
_nv=len(cdat.vertices); _co=np.empty(_nv*3); cdat.vertices.foreach_get("co",_co); _co=_co.reshape(_nv,3)
_no=np.empty(_nv*3); cdat.vertices.foreach_get("normal",_no); _no=_no.reshape(_nv,3)
cdat.vertices.foreach_set("co",(_co-0.12*_no).ravel()); cdat.update()
core=bpy.data.objects.new("Core",cdat); scene.collection.objects.link(core)
core.data.materials.clear(); core.data.materials.append(darkstone)
for _p in core.data.polygons: _p.use_smooth=True
R.bind_auto(core,rig)
bpy.data.objects.remove(g,do_unlink=True)

# clean stray tiny plates: merge each into its nearest neighbor plate (rebind to its bone)
def _cent(o): return sum((o.matrix_world@v.co for v in o.data.vertices),mathutils.Vector())/len(o.data.vertices)
plates=[o for o in bpy.data.objects if o.name.startswith("Plate_")]
cents={o.name:_cent(o) for o in plates}
tinies=[o for o in plates if len(o.data.vertices)<70]; bigs=[o for o in plates if len(o.data.vertices)>=70]
for t in tinies:
    if t.name not in bpy.data.objects or not bigs: continue
    nb=min(bigs,key=lambda b:(cents[b.name]-cents[t.name]).length); bn=nb.vertex_groups[0].name
    desel(); t.select_set(True); nb.select_set(True); vl.objects.active=nb; bpy.ops.object.join()
    for m in [m for m in nb.modifiers if m.type=="ARMATURE"]: nb.modifiers.remove(m)
    nb.vertex_groups.clear(); R.bind_rigid({bn:[nb]},rig)
print("merged tiny plates:",len(tinies))

# inner shell = a NEAR-BLACK core, recessed just under the solid rocks. The rocks are solid
# 3D chunks that fill most of the volume; this core backs any remaining seam so it reads as
# dark void (never hollow, never skin). Visible but recessed. (Nathan 2026-09-19)
# the voxel FIGURE was only the rigging/ROM foundation and is puffier than the plates -> hide
# it. The visual backing is the SRC-shaped dark Core built above (never pokes).
base.hide_render=True
try: base.hide_set(True)
except Exception: pass
print("dark Core = SRC-shaped, skinned; voxel figure hidden (foundation only)")
print("STONE PLATES:",made,"(rigid, thick, overlapping) — inner shell HIDDEN (foundation only)")
