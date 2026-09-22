"""Export the generated character for a Mixamo auto-rig test.
Mixamo wants a single humanoid mesh in T/A-pose, facing forward. It auto-rigs and skins,
but it CANNOT fix topology - the mesh stays triangle soup, so joints will still deform
lumpily. This is an empirical test of "how bad is it really", not a replacement for retopo.
Exports a full-res and a decimated version (Mixamo prefers lighter meshes).
"""
import bpy, sys, os
ND = sys.argv[sys.argv.index("--")+1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
hp = bpy.data.objects["source_highpoly"]
ref = bpy.data.objects.get("REF_concept")
if ref: bpy.data.objects.remove(ref, do_unlink=True)
hp.hide_viewport = False; hp.hide_render = False

def export(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); vl.objects.active = obj
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True,
                             global_scale=1.0, apply_unit_scale=True,
                             axis_forward='-Z', axis_up='Y',
                             object_types={'MESH'}, use_mesh_modifiers=True,
                             path_mode='COPY', embed_textures=False)
    print("EXPORTED", path, "tris", len(obj.data.polygons))

export(hp, os.path.join(ND, "ninja_for_mixamo_full.fbx"))

# decimated copy - Mixamo's auto-rigger is happier with a lighter mesh
low = hp.copy(); low.data = hp.data.copy(); low.name = "ninja_lowres"
sc.collection.objects.link(low)
d = low.modifiers.new("Dec", "DECIMATE"); d.ratio = 60000.0 / max(1, len(low.data.polygons))
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); vl.objects.active = low
bpy.ops.object.modifier_apply(modifier="Dec")
export(low, os.path.join(ND, "ninja_for_mixamo_60k.fbx"))
