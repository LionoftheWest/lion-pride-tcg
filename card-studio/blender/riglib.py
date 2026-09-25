"""Code-driven rigging toolkit for Blender.

Build an armature from a joint map, bind a mesh (auto-weights for organic, or
rigid one-bone-per-part for hard-surface like a rock golem), and keyframe poses.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import riglib as R; import importlib; importlib.reload(R)
"""
import bpy


def make_armature(name, joints, bones):
    """joints: {name:(x,y,z)}. bones: [(bone, head_joint, tail_joint, parent_bone_or_None)]."""
    if bpy.context.mode != "OBJECT":
        try: bpy.ops.object.mode_set(mode="OBJECT")
        except Exception: pass
    arm = bpy.data.armatures.new(name)
    ao = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ao)
    for o in bpy.context.view_layer.objects:
        try: o.select_set(False)
        except Exception: pass
    ao.select_set(True)
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    made = {}
    for bn, h, t, parent in bones:
        b = eb.new(bn)
        b.head = joints[h]
        b.tail = joints[t]
        if parent and parent in made:
            b.parent = made[parent]
            b.use_connect = False
        made[bn] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return ao


def bind_auto(mesh_obj, arm_obj):
    """Automatic (smooth) weights — good for one continuous organic mesh."""
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def bind_rigid(parts_by_bone, arm_obj):
    """Rigid binding: parts_by_bone = {bone: [mesh_objs]}. Each mesh fully follows one bone.
    Ideal for a rock golem — every stone chunk moves as a solid piece."""
    for bone, objs in parts_by_bone.items():
        for o in objs:
            for m in [m for m in o.modifiers if m.type == "ARMATURE"]:
                o.modifiers.remove(m)
            mod = o.modifiers.new("arm", "ARMATURE")
            mod.object = arm_obj
            vg = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
            vg.add(range(len(o.data.vertices)), 1.0, "REPLACE")
            o.parent = arm_obj


def pose(arm_obj, bone, frame, rot=None, loc=None, scale=None):
    """Set + keyframe a bone at a frame. rot in radians (XYZ)."""
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm_obj.pose.bones[bone]
    pb.rotation_mode = "XYZ"
    if rot is not None:
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)
    if scale is not None:
        pb.scale = scale
        pb.keyframe_insert("scale", frame=frame)
    bpy.ops.object.mode_set(mode="OBJECT")


def rest(arm_obj):
    """Clear all pose transforms back to rest."""
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")


def key_loc(obj, frame, loc):
    """Keyframe an object's location (for animating IK target 'anchors')."""
    obj.location = loc
    obj.keyframe_insert("location", frame=frame)


def ik_hinge(arm_obj, bone, axis="X", min_deg=0.0, max_deg=160.0):
    """Make a mid-chain bone (knee/elbow) a single-axis IK hinge so the solver cannot flip.
    Locks the other two IK axes and limits the hinge axis. Call after add_ik. This is the
    professional fix for the straight-chain singularity that makes IK jump."""
    import math
    pb = arm_obj.pose.bones[bone]
    pb.lock_ik_x = axis != "X"; pb.lock_ik_y = axis != "Y"; pb.lock_ik_z = axis != "Z"
    lo, hi = math.radians(min_deg), math.radians(max_deg)
    if axis == "X":
        pb.use_ik_limit_x = True; pb.ik_min_x = lo; pb.ik_max_x = hi
    elif axis == "Y":
        pb.use_ik_limit_y = True; pb.ik_min_y = lo; pb.ik_max_y = hi
    else:
        pb.use_ik_limit_z = True; pb.ik_min_z = lo; pb.ik_max_z = hi


def add_ik(arm_obj, tip_bone, chain_count, target_name, target_loc,
           pole_name=None, pole_loc=None, pole_angle_deg=-90.0):
    """Add an IK constraint to `tip_bone` driven by a new empty 'anchor' target
    (and an optional knee/elbow pole anchor). Returns (target, pole).
    Animate target.location to plant/step the limb — legs bend automatically."""
    import bpy, math
    scene = bpy.context.scene
    tgt = bpy.data.objects.new(target_name, None)
    tgt.empty_display_type = "PLAIN_AXES"; tgt.empty_display_size = 0.35
    tgt.location = target_loc; scene.collection.objects.link(tgt)
    pole = None
    if pole_name:
        pole = bpy.data.objects.new(pole_name, None)
        pole.empty_display_type = "SPHERE"; pole.empty_display_size = 0.2
        pole.location = pole_loc; scene.collection.objects.link(pole)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm_obj.pose.bones[tip_bone]
    for c in [c for c in pb.constraints if c.type == "IK"]:
        pb.constraints.remove(c)
    ik = pb.constraints.new("IK")
    ik.target = tgt; ik.chain_count = chain_count
    if pole:
        ik.pole_target = pole; ik.pole_angle = math.radians(pole_angle_deg)
    bpy.ops.object.mode_set(mode="OBJECT")
    return tgt, pole
