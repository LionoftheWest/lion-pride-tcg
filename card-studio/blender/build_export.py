"""Step 8: GAME EXPORT — a single glTF (.glb) with the rig (deform bones only) and the
animation clips, ready to load in the game. Run after build_base.py + build_stone.py.

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\build_export.py").read())
"""
import bpy, sys, importlib, os
sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
import anim_rigify as AR
importlib.reload(AR)
scene=bpy.context.scene; vl=bpy.context.view_layer
rig=bpy.data.objects["RIG-meta_boss"]

def desel():
    for o in vl.objects:
        try:o.select_set(False)
        except Exception:pass

# 1) build the animation clips (kept so the exporter emits one glTF animation each)
for a in list(bpy.data.actions):
    if a.name in ("walk","stomp"): bpy.data.actions.remove(a)
wa=AR.walk(rig);  wa.name="walk";  wa.use_fake_user=True
sa=AR.stomp(rig); sa.name="stomp"; sa.use_fake_user=True
rig.animation_data.action=None                      # rest for export
scene.frame_set(1)
for pb in rig.pose.bones:
    pb.matrix_basis.identity()

# 2) join the rock plates + dark core into ONE skinned mesh (game-friendly: one mesh, one skin)
parts=[o for o in bpy.data.objects if o.name.startswith("Plate_") or o.name=="Core"]
desel()
for o in parts: o.select_set(True)
merged=[o for o in parts if o.name!="Core"] or parts
active=parts[0]; vl.objects.active=active
bpy.ops.object.join()
active.name="Behemoth"
print("joined into Behemoth:",len(active.data.vertices),"verts,",len(active.data.polygons),"polys")

# 3) export .glb — deform bones only, all actions as clips
desel(); active.select_set(True); rig.select_set(True); vl.objects.active=rig
out=r"C:\Users\vaugh\discord\card-studio\out\behemoth\behemoth.glb"
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True,
    export_apply=False, export_skins=True, export_def_bones=True,
    export_animations=True, export_animation_mode='ACTIONS', export_bake_animation=True,
    export_influence_nb=4, export_all_influences=False,
)
print("EXPORTED", os.path.exists(out), round(os.path.getsize(out)/1e6,2),"MB ->",out)
