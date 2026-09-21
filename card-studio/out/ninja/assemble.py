"""Plan-driven Blender assembler. Reads the detected body_plan + landmarks + dynamic
visible-part list, imports each generated part, selects the plan's skeleton + base-body
spec from a registry, anatomy-fills the base as named parts, tags every part, saves the
foundation. No hardcoded parts/plan.  Run: blender -b -P assemble.py -- <ninja_dir>"""
import bpy, bmesh, sys, json, math, os, re, addon_utils, numpy as np
from mathutils import Vector, Matrix
try: addon_utils.enable("rigify", default_set=True)   # non-biped metarigs live here
except Exception as e: print("rigify enable:", e)

ND = sys.argv[-1]
info = json.load(open(os.path.join(ND, "parts_info.json")))
cb = info["char_bbox"]; chTop, chBot = cb[1], cb[3]; chH = chBot - chTop; chCx = (cb[0] + cb[2]) / 2
LM = info["landmarks"]; PLAN = info["body_plan"]
Hworld = 1.8
MIX = r"C:\Users\vaugh\discord\card-studio\out\behemoth\mixamo\idle.fbx"

# ---- plan -> skeleton registry. Non-biped uses Rigify metarigs (bundled, free).
# The base body is built GENERICALLY: one capsule per skeleton bone (the bones ARE
# the part list), so a new plan needs only a skeleton entry here, no hand spec.
PLAN_SKELETON = {
    "biped":     {"kind": "mixamo_fbx", "src": MIX},
    "quadruped": {"kind": "rigify_op",  "op": "armature_basic_quadruped_metarig_add"},
    "bird":      {"kind": "rigify_op",  "op": "armature_bird_metarig_add"},
    "serpent":   {"kind": "rigify_op",  "op": "armature_shark_metarig_add"},
}
SK = PLAN_SKELETON.get(PLAN, PLAN_SKELETON["biped"])

def radius_for(name, blen, body):
    n = name.lower(); g = 0.045
    if re.search(r'spine|chest|hips|pelvis|torso|breast|abdomen', n): g = 0.12
    elif re.search(r'neck', n): g = 0.06
    elif re.search(r'head|skull', n): g = 0.09
    elif re.search(r'shoulder', n): g = 0.07
    elif re.search(r'thigh|upper_arm|upperarm', n): g = 0.065
    elif re.search(r'shin|forearm|leg', n): g = 0.05
    elif re.search(r'hand|foot|toe|paw', n): g = 0.045
    elif re.search(r'tail', n): g = 0.05
    return max(0.02, min(g * body, blen * 0.6))

bpy.ops.wm.read_homefile(use_empty=True); sc = bpy.context.scene
def wbb(o):
    mn=Vector((1e9,)*3); mx=Vector((-1e9,)*3)
    for c in o.bound_box:
        w=o.matrix_world@Vector(c); mn=Vector((min(mn[i],w[i]) for i in range(3))); mx=Vector((max(mx[i],w[i]) for i in range(3)))
    return mn,mx
def tag(o, pt, sim, region=""):
    o["part_type"]=pt; o["sim"]=sim
    if region: o["region"]=region

def imp_part(part):
    glb=os.path.join(ND, part["name"]+".glb"); pbb=part["bbox"]
    before=set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=glb)
    o=next(x for x in bpy.data.objects if x not in before and x.type=='MESH'); o.name="Part_"+part["name"]
    mn,mx=wbb(o); size=mx-mn
    if size.z < max(size.x,size.y):
        o.rotation_euler[0]+=math.radians(90); bpy.context.view_layer.update(); mn,mx=wbb(o); size=mx-mn
    target_h=(pbb[3]-pbb[1])/chH*Hworld; s=target_h/max(1e-6,size.z); o.scale=tuple(v*s for v in o.scale)
    bpy.context.view_layer.update(); mn,mx=wbb(o); cen=(mn+mx)/2
    pcy=(pbb[1]+pbb[3])/2; pcx=(pbb[0]+pbb[2])/2
    des=Vector(((pcx-chCx)*(Hworld/chH),0.0,Hworld*(1-(pcy-chTop)/chH)))
    o.location+=des-cen
    for p in o.data.polygons: p.use_smooth=True
    tag(o, part["part_type"], part["sim"])
    return o

# Flat/thin accessories (ears, patches) — extrude a thin mesh from the SAM mask
# instead of a poor Hunyuan blob. Captures parts too thin to volumetrically generate.
def extrude_from_mask(part):
    img=bpy.data.images.load(os.path.join(ND, part["mask"]))
    W,H=img.size; px=np.array(img.pixels[:],dtype=np.float32).reshape(H,W,4)[::-1]
    m=px[:,:,0]>0.5; ys,xs=np.where(m)
    if xs.size==0: return None
    sub=m[ys.min():ys.max()+1, xs.min():xs.max()+1]
    step=max(1, max(sub.shape)//56); gg=sub[::step,::step]; gh,gw=gg.shape
    bm=bmesh.new(); vmap={}; cw=1.0/max(gw,gh)
    def V(a,b):
        if (a,b) not in vmap: vmap[(a,b)]=bm.verts.new((a*cw,0.0,-b*cw))
        return vmap[(a,b)]
    for r in range(gh):
        for c in range(gw):
            if gg[r,c]: bm.faces.new((V(c,r),V(c+1,r),V(c+1,r+1),V(c,r+1)))
    if not bm.faces: bm.free(); return None
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    me=bpy.data.meshes.new("Part_"+part["name"]); bm.to_mesh(me); bm.free()
    o=bpy.data.objects.new("Part_"+part["name"], me); sc.collection.objects.link(o)
    sol=o.modifiers.new("Solid","SOLIDIFY"); sol.thickness=0.03; sol.offset=0.0
    mn,mx=wbb(o); size=mx-mn
    target_h=(part["bbox"][3]-part["bbox"][1])/chH*Hworld; s=target_h/max(1e-6,size.z)
    o.scale=tuple(v*s for v in o.scale); bpy.context.view_layer.update(); mn,mx=wbb(o); cen=(mn+mx)/2
    pcy=(part["bbox"][1]+part["bbox"][3])/2; pcx=(part["bbox"][0]+part["bbox"][2])/2
    o.location+=Vector(((pcx-chCx)*(Hworld/chH),0.0,Hworld*(1-(pcy-chTop)/chH)))-cen
    tag(o, part["part_type"], part["sim"]); return o

vis={}
for part in info["visible_parts"]:
    if not part.get("bbox"): continue
    if part.get("method")=="extrude" and part.get("mask"):
        o=extrude_from_mask(part)
        if o: vis[part["name"]]=o
    elif os.path.exists(os.path.join(ND, part["name"]+".glb")):
        vis[part["name"]]=imp_part(part)     # volumetric parts that generated
# ground, then tuck a 'lower' garment under an 'upper' one if both exist
allv=list(vis.values())
mn=Vector((1e9,)*3);mx=Vector((-1e9,)*3)
for o in allv:
    a,b=wbb(o); mn=Vector((min(mn[i],a[i]) for i in range(3))); mx=Vector((max(mx[i],b[i]) for i in range(3)))
for o in allv: o.location.z-=mn.z
bpy.context.view_layer.update()
if "upper" in vis and "lower" in vis:
    pmn,pmx=wbb(vis["upper"]); lmn,lmx=wbb(vis["lower"])
    vis["lower"].location.z += (pmn.z+0.06)-lmx.z; vis["upper"].location.y=-0.06
    bpy.context.view_layer.update()
mn=Vector((1e9,)*3);mx=Vector((-1e9,)*3)
for o in allv:
    a,b=wbb(o); mn=Vector((min(mn[i],a[i]) for i in range(3))); mx=Vector((max(mx[i],b[i]) for i in range(3)))
for o in allv: o.location.z-=mn.z
ninja_h=(mx-mn).z

# ---- skeleton per plan: Mixamo fbx (biped) or Rigify metarig (non-biped) ----
before=set(bpy.data.objects)
if SK["kind"] == "mixamo_fbx":
    bpy.ops.import_scene.fbx(filepath=SK["src"])
else:
    bpy.context.view_layer.objects.active = None
    getattr(bpy.ops.object, SK["op"])()          # add the Rigify metarig
arm=next(o for o in bpy.data.objects if o not in before and o.type=='ARMATURE')
if arm.animation_data: arm.animation_data.action=None
for pb in arm.pose.bones: pb.matrix_basis.identity()
bpy.context.view_layer.update()
smn,smx=wbb(arm); arm.scale=tuple(v*(ninja_h/max(1e-4,(smx.z-smn.z))) for v in arm.scale); bpy.context.view_layer.update()
smn,smx=wbb(arm); arm.location.z-=smn.z; bpy.context.view_layer.update()
if SK["kind"] == "mixamo_fbx":   # biped: extra shoulder-width fit from landmarks
    def Hb(bn):
        b=arm.data.bones.get(bn); return (arm.matrix_world@b.head_local) if b else None
    img_sh=(LM["shoulder_half"]*2)*(Hworld/chH); skel_sh=(Hb("mixamorig:LeftArm").x-Hb("mixamorig:RightArm").x)
    wf=max(0.7,min(1.5, img_sh/max(1e-4,skel_sh)))
    arm.scale=(arm.scale[0]*wf, arm.scale[1], arm.scale[2]); bpy.context.view_layer.update()
    smn,smx=wbb(arm); arm.location.z-=smn.z; bpy.context.view_layer.update()
tag(arm, "skeleton", "none")

# ---- base body: ONE capsule per bone (the skeleton's bones ARE the part list) ----
def capsule(p0,p1,r,name):
    d=p1-p0; Ln=max(1e-4,d.length); me=bpy.data.meshes.new(name); bm=bmesh.new()
    bmesh.ops.create_cone(bm,segments=12,radius1=r,radius2=r,depth=Ln,cap_ends=True)
    bmesh.ops.create_icosphere(bm,subdivisions=1,radius=r,matrix=Matrix.Translation((0,0,-Ln/2)))
    bmesh.ops.create_icosphere(bm,subdivisions=1,radius=r,matrix=Matrix.Translation((0,0,Ln/2)))
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth=True
    o=bpy.data.objects.new(name,me); sc.collection.objects.link(o)
    o.location=(p0+p1)/2; o.rotation_mode='QUATERNION'
    o.rotation_quaternion=Vector((0,0,1)).rotation_difference(d.normalized()); return o
smn,smx=wbb(arm); body=(smx-smn).length; nbase=0
for b in arm.data.bones:
    h=arm.matrix_world@b.head_local; t=arm.matrix_world@b.tail_local
    if (t-h).length < 1e-4: continue
    o=capsule(h,t,radius_for(b.name,(t-h).length,body),"Base_"+b.name)
    tag(o,"body","skin",region=b.name); nbase+=1

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND,"ninja_foundation.blend"))
manifest={"body_plan":PLAN,"landmarks":LM,
          "parts":[{"name":o.name,"part_type":o.get("part_type"),"sim":o.get("sim"),"region":o.get("region","")}
                   for o in bpy.data.objects if o.get("part_type")]}
json.dump(manifest, open(os.path.join(ND,"foundation_manifest.json"),"w"), indent=2)
print("PLAN", PLAN, "| foundation parts", len(manifest["parts"]), "| base", nbase)
