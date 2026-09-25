"""Step 1 of the pro pipeline: a SMOOTH-SKINNED BASE BODY on the Rigify rig.
Get the skeleton deforming cleanly (no clip, no gap) BEFORE any stone plates go on top.
Import an AI mesh -> fit + generate the Rigify rig -> smooth-bind the whole mesh (auto
weights) to the deform bones. Then run the range-of-motion test to sign off the rig.

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\build_base.py").read())
"""
import bpy, sys, importlib, math, mathutils
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import anatomy as AN, rig_rigify as RG, riglib as R
importlib.reload(AN); importlib.reload(RG); importlib.reload(R)

MESH=r"C:\Users\vaugh\discord\card-studio\ml\golem\0\mesh.glb"
HEIGHT=4.58; SHOULDER_RAISE=0.08
r=math.radians; scene=bpy.context.scene; vl=bpy.context.view_layer

def desel():
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass
def vb(o,w=True):
    M=o.matrix_world if w else mathutils.Matrix(); cs=[M@v.co for v in o.data.vertices]
    return (min(c.x for c in cs),max(c.x for c in cs),min(c.y for c in cs),max(c.y for c in cs),min(c.z for c in cs),max(c.z for c in cs))

if bpy.context.mode!='OBJECT':
    try: bpy.ops.object.mode_set(mode='OBJECT')
    except Exception: pass
for o in list(bpy.data.objects):
    if o.name.startswith(("Musc_","Core","GolemOrig","GolemRig","meta_boss","RIG-meta","Base")):
        bpy.data.objects.remove(o,do_unlink=True)

# ---- import + align single mesh ----
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=MESH)
g=[o for o in bpy.data.objects if o not in before and o.type=='MESH'][0]; g.name="Base"
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

# ---- clean the mesh for good auto-weights ----
desel(); g.select_set(True); vl.objects.active=g
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ---- simplify to a clean generic FIGURE (primary/secondary forms only) ----
# the base we rig is a smooth muscle figure, NOT the finished AI surface. The AI mesh's
# detail is reference for the stone layer built on top later.
rm=g.modifiers.new("remesh","REMESH"); rm.mode='VOXEL'; rm.voxel_size=0.11; rm.adaptivity=0.0
bpy.ops.object.modifier_apply(modifier="remesh")
sm=g.modifiers.new("smooth","SMOOTH"); sm.factor=1.0; sm.iterations=8
bpy.ops.object.modifier_apply(modifier="smooth")
bpy.ops.object.shade_smooth()

# ---- fit + generate the Rigify rig ----
meta=RG.fit_metarig(g,shoulder_raise=SHOULDER_RAISE)
rig=RG.generate(meta)
bpy.data.objects.remove(meta,do_unlink=True)

# ---- smooth bind the base to the rig (automatic weights -> deform bones) ----
R.bind_auto(g,rig)

# ---- deformation polish: preserve volume + smooth weights + corrective smooth ----
for m in g.modifiers:
    if m.type=='ARMATURE': m.use_deform_preserve_volume=True
desel(); g.select_set(True); vl.objects.active=g
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
try: bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
except Exception as e: print("wsmooth",e)
bpy.ops.object.mode_set(mode='OBJECT')
cs=g.modifiers.new("csmooth","CORRECTIVE_SMOOTH"); cs.factor=0.6; cs.iterations=18; cs.smooth_type='LENGTH_WEIGHTED'

# ---- neutral clay material (reads deformation clearly) ----
clay=bpy.data.materials.new("Clay"); clay.use_nodes=True
b=next(n for n in clay.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
b.inputs["Base Color"].default_value=(0.55,0.55,0.57,1); b.inputs["Roughness"].default_value=0.7
g.data.materials.clear(); g.data.materials.append(clay)

print("BASE BUILD DONE  verts:",len(g.data.vertices),"rig:",rig.name)
