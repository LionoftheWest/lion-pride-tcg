"""Kerrigan boss GLB: her own game rig (Sketchfab, Vasian-Digital3D, CC-BY) + the 8 Mixamo
boss clips retargeted from the X Bot. The Mixamo Auto-Rigger fails on her proportions
(the neck starts 8 cm above the shoulders), so the clips are moved onto her rig instead.
Both rigs rest in a T-pose, so each mapped bone gets the X Bot bone's WORLD rotation
relative to its rest, applied on top of her rest (bone roll does not matter). The hips'
vertical movement goes to her ground bone, scaled by the hip heights. Fingers, face, hair and wings
follow their parents. Run headless:
  blender -b --python retarget_kerrigan.py -- <kerrigan.glb> <xbot_clip_dir> <out.glb>
The raw Mixamo FBX files are never committed or shared (Mixamo terms).
"""
import bpy, sys, pathlib
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, CLIPS, OUT = pathlib.Path(argv[0]), pathlib.Path(argv[1]), pathlib.Path(argv[2])
ORDER = ["idle", "roar", "strike", "slam", "punch", "hit", "flex", "death", "taunt"]

# X Bot bone -> her bones (the hips drive both of her hip-level siblings).
MAP = {
    "Hips": ["spine_lower_04", "root_hips_0199"],
    "Spine": ["spine_upper_1a_05"], "Spine1": ["spine_upper_1b_06"], "Spine2": ["spine_upper_1c_07"],
    "Neck": ["head_neck_lower_036"], "Head": ["head_face_038"],
    "LeftShoulder": ["arm_left_shoulder_1_09"], "LeftArm": ["arm_left_shoulder_2_010"],
    "LeftForeArm": ["arm_left_elbow_011"], "LeftHand": ["arm_left_wrist_012"],
    "RightShoulder": ["arm_right_shoulder_1_0138"], "RightArm": ["arm_right_shoulder_2_0139"],
    "RightForeArm": ["arm_right_elbow_0140"], "RightHand": ["arm_right_wrist_0141"],
    "LeftUpLeg": ["leg_left_thigh_0203"], "LeftLeg": ["leg_left_knee_0204"],
    "LeftFoot": ["leg_left_ankle_0205"], "LeftToeBase": ["leg_left_toes_0206"],
    "RightUpLeg": ["leg_right_thigh_0200"], "RightLeg": ["leg_right_knee_0201"],
    "RightFoot": ["leg_right_ankle_0181"], "RightToeBase": ["leg_right_toes_0202"],
}
ROOT = "root_ground_03"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SRC))
for o in [o for o in bpy.data.objects if o.name == "Icosphere"]:   # a stray helper in the file
    bpy.data.objects.remove(o, do_unlink=True)
K = next(o for o in bpy.data.objects if o.type == "ARMATURE")
K.name = "Boss"
K.animation_data_clear()
for o in bpy.data.objects:   # the source's face (shape-key) loop "Motion" is not a boss clip
    if o.type == "MESH" and o.data.shape_keys:
        o.data.shape_keys.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
K.data.pose_position = "POSE"
Wk = K.matrix_world.copy()
Wk_inv = Wk.inverted()

def depth(b):
    n = 0
    while b.parent: b, n = b.parent, n + 1
    return n

targets = sorted({t for ts in MAP.values() for t in ts}, key=lambda n: depth(K.data.bones[n]))
rest_w = {n: Wk @ K.data.bones[n].matrix_local for n in targets + [ROOT]}   # her rest, world
hips_h = rest_w["root_hips_0199"].translation.z

def import_clip(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)
    new = [o for o in bpy.data.objects if o not in before]
    return new, next(o for o in new if o.type == "ARMATURE")

sc = bpy.context.scene
for clip in ORDER:
    new, S = import_clip(CLIPS / f"{clip}.fbx")
    src_act = S.animation_data.action
    f0, f1 = int(src_act.frame_range[0]), int(src_act.frame_range[1])
    Ws = S.matrix_world
    s_rest = {b.name.split(":")[-1]: Ws @ b.matrix_local for b in S.data.bones}
    s_hips_h = s_rest["Hips"].translation.z
    scale = hips_h / s_hips_h
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    K.animation_data_create(); K.animation_data.action = act
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        s_pose = {pb.name.split(":")[-1]: Ws @ pb.matrix for pb in S.pose.bones}
        # the root: the X Bot hips' VERTICAL movement, scaled to her size. The slam is a jump
        # attack that travels 3.8 units toward the camera, so she stays on her spot.
        d = Vector((0, 0, (s_pose["Hips"].translation.z - s_rest["Hips"].translation.z) * scale))
        pr = K.pose.bones[ROOT]
        pr.matrix = Wk_inv @ (Matrix.Translation(d) @ rest_w[ROOT])
        bpy.context.view_layer.update()
        pr.keyframe_insert("location", frame=f)
        # the mapped bones, parents first (each needs its parent's evaluated pose)
        last_depth = None
        for n in targets:
            src = next(s for s, ts in MAP.items() if n in ts)
            if src not in s_pose:
                continue
            dq = s_pose[src].to_quaternion() @ s_rest[src].to_quaternion().inverted()
            pb = K.pose.bones[n]
            b = K.data.bones[n]
            if last_depth is not None and depth(b) != last_depth:
                bpy.context.view_layer.update()
            last_depth = depth(b)
            # the head where the parent chain puts it now; the rotation from the X Bot
            par = pb.parent
            head_arm = (par.matrix @ (par.bone.matrix_local.inverted() @ b.matrix_local)).translation if par else b.head_local
            rw = rest_w[n]
            loc_w, rot_w, scl_w = rw.decompose()
            want_w = Matrix.LocRotScale((Wk @ head_arm.to_4d()).to_3d(), dq @ rot_w, scl_w)
            pb.matrix = Wk_inv @ want_w
            pb.keyframe_insert("rotation_quaternion", frame=f)
        bpy.context.view_layer.update()
    print(f"clip {clip}: {f1 - f0 + 1} frames")
    K.animation_data.action = None
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in [a for a in bpy.data.actions if a.name != clip and not a.use_fake_user]:
        bpy.data.actions.remove(a)
    for pb in K.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)

# One NLA track per clip, so the glTF exporter writes one animation per clip.
K.animation_data_create(); K.animation_data.action = None
for name in ORDER:
    act = bpy.data.actions[name]
    tr = K.animation_data.nla_tracks.new(); tr.name = name
    tr.strips.new(name, int(act.frame_range[0]), act)
K.animation_data.action = bpy.data.actions["idle"]
for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > 1024:
        s = 1024 / max(w, h); img.scale(max(1, int(w * s)), max(1, int(h * s)))
OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format="GLB", export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_image_format="JPEG",
                          export_image_quality=85, export_apply=False)
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == "MESH" for p in o.data.polygons)
print(f"WROTE {OUT} | actions: {ORDER} | triangles ~{tris}")
