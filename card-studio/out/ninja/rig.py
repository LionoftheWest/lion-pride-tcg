"""Stage 2 (rig + motion). Takes the T-pose foundation and makes it a SKINNED, animated
character:
  1. consolidate the per-bone base capsules into ONE clean body mesh (join + voxel remesh
     + shade smooth) — the blocky proxy becomes a continuous skin;
  2. bake the fitted skeleton's scale so pose rotations stay clean;
  3. skin the body AND each garment/accessory to the skeleton (automatic weights) — parts
     stay SEPARATE meshes (swap-able) but now deform with the rig;
  4. apply a Mixamo-rig attack clip (native playback — the skeleton is mixamorig).
Run: blender -b -P rig.py -- <ninja_dir> [clip]   clip in behemoth/mixamo/*.fbx (default swipe)
Output: ninja_rigged.blend (+ ninja_rig_manifest.json)."""
import bpy, sys, os, json
ND = sys.argv[sys.argv.index("--") + 1]
CLIP = sys.argv[sys.argv.index("--") + 2] if len(sys.argv) > sys.argv.index("--") + 2 else "swipe"
CLIP_FBX = r"C:\Users\vaugh\discord\card-studio\out\behemoth\mixamo\%s.fbx" % CLIP
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "ninja_foundation.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer

def only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    vl.objects.active = objs[0]

arm = next(o for o in sc.objects if o.type == 'ARMATURE')
bases = [o for o in sc.objects if o.get("part_type") == "body"]
garments = [o for o in sc.objects if o.get("part_type") in ("garment", "accessory")]

# 1. consolidate the base capsules -> one clean continuous body
only(bases); bpy.ops.object.join()
body = vl.objects.active; body.name = "Base_Body"
rm = body.modifiers.new("Remesh", "REMESH"); rm.mode = 'VOXEL'; rm.voxel_size = 0.025
only([body]); bpy.ops.object.modifier_apply(modifier="Remesh")
for p in body.data.polygons: p.use_smooth = True
body["part_type"] = "body"; body["sim"] = "skin"

# NOTE: do NOT transform_apply the armature. It is a native Mixamo object (tiny non-
# uniform scale + 90deg X rot, bones in cm space); applying scale garbles the rest pose.
# Leaving it intact is exactly how idle.fbx built the foundation and how the clips import.

# 3. skin body + each separate garment/accessory to the skeleton (auto weights)
skinned = []
for m in [body] + garments:
    if m.name not in bpy.data.objects: continue
    only([m]); m.select_set(True); arm.select_set(True); vl.objects.active = arm
    try:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO'); skinned.append(m.name)
    except Exception as e:
        print("skin failed", m.name, e)

# 4. apply the Mixamo-rig attack clip (native playback onto mixamorig)
clip_ok = False
if os.path.exists(CLIP_FBX):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=CLIP_FBX)
    imp = [o for o in bpy.data.objects if o not in before]
    src = next((o for o in imp if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action), None)
    if src:
        act = src.animation_data.action
        if not arm.animation_data: arm.animation_data_create()
        arm.animation_data.action = act
        slot = arm.animation_data.action_slot or (act.slots[0] if act.slots else None)
        if slot: arm.animation_data.action_slot = slot
        # strip the clip's Hips TRANSLATION -> play IN PLACE (its root motion is authored
        # in the golem's units and would fling this differently-scaled rig off-world).
        nstrip = 0
        for lay in act.layers:
            for stp in lay.strips:
                cb = stp.channelbag(slot) if slot else None
                if not cb: continue
                for fc in list(cb.fcurves):
                    if fc.data_path.endswith('.location') and 'Hips' in fc.data_path:
                        cb.fcurves.remove(fc); nstrip += 1
        print("stripped hips-location fcurves:", nstrip)
        fr = act.frame_range; sc.frame_start = int(fr[0]); sc.frame_end = int(fr[1])
        sc.frame_set(int((fr[0] + fr[1]) / 2))
        clip_ok = True
    only(imp); bpy.ops.object.delete()   # drop the imported golem mesh+rig, keep the action
    arm.hide_set(False)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "ninja_rigged.blend"))
man = {"body_verts": len(body.data.vertices), "skinned": skinned,
       "clip": CLIP if clip_ok else None,
       "frames": [sc.frame_start, sc.frame_end] if clip_ok else None}
json.dump(man, open(os.path.join(ND, "ninja_rig_manifest.json"), "w"), indent=2)
print("RIG body_verts", man["body_verts"], "| skinned", len(skinned), "| clip", man["clip"], "| frames", man["frames"])
