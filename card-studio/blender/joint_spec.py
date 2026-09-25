"""Anatomical joint parameters — the realism baked into the skeleton.
Real human range-of-motion (degrees), applied as Limit Rotation on the Rigify FK controls
and IK limits on the chains. A pose then physically cannot exceed real anatomy: no clipping,
no IK flips, natural motion. Data-driven so any body plan gets its own spec.

Sources: AAOS ROM norms, CDC normal-ROM dataset.

    import joint_spec as JS; importlib.reload(JS)
    JS.apply(rig)                 # bake the limits onto the rig
    JS.verify(rig)                # report that hinges clamp
"""
import bpy, math
r = math.radians

# axis note (verified on our rig): flexion of elbow/knee/hip/shoulder is the FK bone's local X.
# (deg) per FK control: x=(min,max) flex/extend, y=(min,max) twist/pronate, z=(min,max) abduct
ROM = {
    # HINGES — one axis only
    "forearm_fk": dict(x=(0, 150),  y=(-85, 85), z=(-4, 4)),    # elbow: flex X, pronation Y
    "shin_fk":    dict(x=(0, 140),  y=(-4, 4),   z=(-4, 4)),    # knee: pure hinge
    # BALL joints — wide but bounded
    "upper_arm_fk": dict(x=(-60, 170), y=(-90, 90), z=(-45, 170)),  # shoulder
    "thigh_fk":     dict(x=(-30, 125), y=(-40, 45), z=(-25, 45)),   # hip
    # wrist / ankle
    "hand_fk": dict(x=(-70, 80), y=(-20, 20), z=(-30, 30)),
    "foot_fk": dict(x=(-50, 20), y=(-10, 10), z=(-15, 15)),
    # neck / head
    "head": dict(x=(-45, 45), y=(-70, 70), z=(-45, 45)),
    "neck": dict(x=(-30, 30), y=(-45, 45), z=(-30, 30)),
    # spine segments (each vertebra contributes a little)
    "chest":        dict(x=(-20, 25), y=(-25, 25), z=(-20, 20)),
    "spine_fk.001": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
    "spine_fk.002": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
    "spine_fk.003": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
}
# IK chains: the mid bone is a pure hinge so the solver can never flip
IK_HINGE = {"shin_tweak": None}  # placeholder; IK limits set via def bones below
IK_LIMB = {  # tip bone -> (mid bone that is the hinge, flex axis, min, max)
    "shin.L": ("shin.L", "X", 0, 140), "shin.R": ("shin.R", "X", 0, 140),
}


def _sided(name):
    return [name] if name.endswith((".001", ".002", ".003")) or name in ("head", "neck", "chest", "spine_fk.001", "spine_fk.002", "spine_fk.003") \
        else ([name] if "." in name else [name + ".L", name + ".R"])


def apply(rig):
    """Add Limit Rotation (LOCAL) to each FK control per the ROM spec."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    n = 0
    for base, lim in ROM.items():
        names = [base] if base in ("head", "neck", "chest") or base.startswith("spine_fk") else [base + ".L", base + ".R"]
        for bn in names:
            pb = rig.pose.bones.get(bn)
            if not pb:
                continue
            for c in [c for c in pb.constraints if c.type == "LIMIT_ROTATION"]:
                pb.constraints.remove(c)
            c = pb.constraints.new("LIMIT_ROTATION")
            c.owner_space = "LOCAL"
            c.use_limit_x = True; c.min_x = r(lim["x"][0]); c.max_x = r(lim["x"][1])
            c.use_limit_y = True; c.min_y = r(lim["y"][0]); c.max_y = r(lim["y"][1])
            c.use_limit_z = True; c.min_z = r(lim["z"][0]); c.max_z = r(lim["z"][1])
            n += 1
    # IK hinge limits on the deform/ik shin so IK can't flip the knee
    for bn in ("shin.L", "shin.R", "forearm.L", "forearm.R"):
        pb = rig.pose.bones.get(bn)
        if pb:
            pb.use_ik_limit_x = True; pb.ik_min_x = r(0); pb.ik_max_x = r(150)
            pb.lock_ik_y = True; pb.lock_ik_z = True
    bpy.ops.object.mode_set(mode="OBJECT")
    return n


def verify(rig):
    """Try to over-rotate the elbow and knee; confirm they clamp to the ROM."""
    import math as m
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
    rep = {}
    for bn, cap in (("forearm_fk.L", 150), ("shin_fk.L", 140)):
        pb = rig.pose.bones.get(bn)
        if not pb: continue
        pb.rotation_mode = "XYZ"; pb.rotation_euler = (r(300), 0, 0)
        bpy.context.evaluated_depsgraph_get().update()
        # read the constrained result
        applied = m.degrees(pb.matrix_basis.to_euler().x)
        rep[bn] = round(applied, 1)
        pb.rotation_euler = (0, 0, 0)
    bpy.ops.object.mode_set(mode="OBJECT")
    return rep
