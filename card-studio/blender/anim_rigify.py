"""Animate a generated Rigify rig with professional controls.
Legs on IK (foot_ik + foot roll), arms on FK, body via torso. Weight comes from timing:
ease out, snap, cushion, overshoot, settle (see docs/ANIMATION_CRAFT.md).

    import anim_rigify as AR; importlib.reload(AR)
    AR.walk(rig); AR.stomp(rig)
"""
import bpy, math
from mathutils import Vector, Matrix
r = math.radians


def _rest_world(rig, bn):
    return rig.matrix_world @ rig.pose.bones[bn].bone.matrix_local.translation


def place(rig, bn, frame, world):
    """Place a control's head at a world position, keeping its rest orientation."""
    pb = rig.pose.bones[bn]
    m = pb.bone.matrix_local.copy(); m.translation = Vector(world)
    pb.matrix = m
    pb.keyframe_insert("location", frame=frame)


def rot(rig, bn, frame, rx=0.0, ry=0.0, rz=0.0):
    pb = rig.pose.bones.get(bn)
    if not pb: return
    pb.rotation_mode = "XYZ"; pb.rotation_euler = (r(rx), r(ry), r(rz))
    pb.keyframe_insert("rotation_euler", frame=frame)


def prop(rig, bn, key, val, frame):
    pb = rig.pose.bones.get(bn)
    if pb and key in pb.keys():
        pb[key] = val; pb.keyframe_insert('["%s"]' % key, frame=frame)


def ease(rig):
    act = rig.animation_data.action if rig.animation_data else None
    if not act: return
    for fc in _all_fcurves(act):
        for k in fc.keyframe_points:
            k.interpolation = "BEZIER"; k.handle_left_type = k.handle_right_type = "AUTO_CLAMPED"
        fc.update()


def _all_fcurves(act):
    if hasattr(act, "fcurves") and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for lay in act.layers:
        for st in lay.strips:
            for cb in st.channelbags:
                out.extend(cb.fcurves)
    return out


def _new_action(rig, name):
    if rig.animation_data is None: rig.animation_data_create()
    act = bpy.data.actions.new(name); rig.animation_data.action = name and act
    rig.animation_data.action = act
    return act


def _fk_arms(rig, frame=1):
    for s in ("L", "R"):
        prop(rig, "upper_arm_parent." + s, "IK_FK", 1.0, frame)   # FK arms
        prop(rig, "thigh_parent." + s, "IK_FK", 0.0, frame)       # IK legs


def walk(rig, F=32, fps=24, stride=0.5, lift=0.5):
    _new_action(rig, "walk"); sc = bpy.context.scene; sc.frame_start = 1; sc.frame_end = F
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
    _fk_arms(rig)
    FL = _rest_world(rig, "foot_ik.L"); FR = _rest_world(rig, "foot_ik.R")
    T = _rest_world(rig, "torso")
    end = F + 1
    def cyc(base, phase):  # phase 0 = plant-forward at f1 (forward = -Y)
        p = [(1, (0, -stride, 0)), (9, (0, 0, lift)), (17, (0, stride, 0)), (25, (0, 0, 0)), (end, (0, -stride, 0))]
        if phase:
            p = [(1, (0, stride, 0)), (9, (0, 0, 0)), (17, (0, -stride, 0)), (25, (0, 0, lift)), (end, (0, stride, 0))]
        return [(f, (base.x + d[0], base.y + d[1], base.z + d[2])) for f, d in p]
    for f, w in cyc(FR, False): place(rig, "foot_ik.R", f, w)
    for f, w in cyc(FL, True):  place(rig, "foot_ik.L", f, w)
    # body: bob down at contacts, up at passing; slight side sway
    for f, dz in [(1, -0.10), (9, 0.06), (17, -0.10), (25, 0.06), (end, -0.10)]:
        place(rig, "torso", f, (T.x, T.y, T.z + dz))
    # arms FK swing opposite the legs
    for f, a in [(1, 22), (9, 0), (17, -22), (25, 0), (end, 22)]: rot(rig, "upper_arm_fk.R", f, rx=a)
    for f, a in [(1, -22), (9, 0), (17, 22), (25, 0), (end, -22)]: rot(rig, "upper_arm_fk.L", f, rx=a)
    rot(rig, "forearm_fk.R", 1, rx=-24); rot(rig, "forearm_fk.L", 1, rx=-24)
    # toe push-off (foot roll via toe_ik rotation)
    for f, a in [(1, 0), (17, 0), (21, 26), (27, 10), (end, 0)]: rot(rig, "toe_ik.R", f, rx=a)
    for f, a in [(1, 10), (5, 26), (9, 0), (25, 0), (end, 10)]: rot(rig, "toe_ik.L", f, rx=a)
    ease(rig); bpy.ops.object.mode_set(mode="OBJECT")
    return rig.animation_data.action


def rom(rig, fps=24):
    """Range-of-motion sweep: drive every joint to its extreme so we can sign off clean
    deformation before adding any surface layer."""
    _new_action(rig, "rom"); sc = bpy.context.scene
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
    for s in ("L", "R"):
        prop(rig, "upper_arm_parent." + s, "IK_FK", 1.0, 1)
        prop(rig, "thigh_parent." + s, "IK_FK", 0.0, 1)
    T = _rest_world(rig, "torso")
    FL = _rest_world(rig, "foot_ik.L"); FR = _rest_world(rig, "foot_ik.R")
    def hold(bn, f, **k): rot(rig, bn, f, **k)
    # neutral bookends helper
    def neutral(f):
        place(rig, "torso", f, (T.x, T.y, T.z)); place(rig, "foot_ik.L", f, FL); place(rig, "foot_ik.R", f, FR)
        for s in ("L", "R"):
            rot(rig, "upper_arm_fk." + s, f, 0, 0, 0); rot(rig, "forearm_fk." + s, f, rx=0)
        for b in ("chest", "spine_fk.001", "spine_fk.002", "neck", "head", "toe_ik.L", "toe_ik.R"):
            rot(rig, b, f, 0, 0, 0)
    # 1: deep squat (knees + hips)
    neutral(1); place(rig, "torso", 12, (T.x, T.y, T.z - 0.8)); place(rig, "torso", 24, (T.x, T.y, T.z))
    # 2: high knees (hip flex) L then R
    place(rig, "foot_ik.L", 34, (FL.x + 0.15, FL.y - 0.45, FL.z + 0.95)); place(rig, "foot_ik.L", 44, FL)
    place(rig, "foot_ik.R", 54, (FR.x - 0.15, FR.y - 0.45, FR.z + 0.95)); place(rig, "foot_ik.R", 64, FR)
    # 3: arms — side raise (abduction) then front raise
    for s, sg in (("L", 1), ("R", -1)):
        rot(rig, "upper_arm_fk." + s, 44, 0, 0, 0)
        rot(rig, "upper_arm_fk." + s, 74, rz=70 * sg); rot(rig, "upper_arm_fk." + s, 84, 0, 0, 0)
        rot(rig, "upper_arm_fk." + s, 94, rx=-90); rot(rig, "upper_arm_fk." + s, 104, 0, 0, 0)
    # 4: elbows bend
    for s in ("L", "R"):
        rot(rig, "forearm_fk." + s, 104, rx=0); rot(rig, "forearm_fk." + s, 112, rx=120); rot(rig, "forearm_fk." + s, 120, rx=0)
    # 5: spine — forward, back, twist, side
    for b in ("chest", "spine_fk.002"):
        rot(rig, b, 120, 0, 0, 0); rot(rig, b, 128, rx=35); rot(rig, b, 136, rx=-25)
        rot(rig, b, 144, rz=35); rot(rig, b, 152, rz=-35); rot(rig, b, 160, ry=25); rot(rig, b, 168, 0, 0, 0)
    # 6: neck + head turn/tilt
    for b in ("neck", "head"):
        rot(rig, b, 168, 0, 0, 0); rot(rig, b, 176, rz=35); rot(rig, b, 184, rz=-35); rot(rig, b, 192, rx=25); rot(rig, b, 200, 0, 0, 0)
    # 7: feet/toes
    rot(rig, "toe_ik.L", 200, rx=0); rot(rig, "toe_ik.R", 200, rx=0)
    rot(rig, "toe_ik.L", 208, rx=40); rot(rig, "toe_ik.R", 208, rx=40)
    rot(rig, "toe_ik.L", 216, rx=0); rot(rig, "toe_ik.R", 216, rx=0)
    sc.frame_start = 1; sc.frame_end = 216
    ease(rig); bpy.ops.object.mode_set(mode="OBJECT")
    return rig.animation_data.action


def clap(rig, F=44, fps=24):
    """Clap: hands (IK) snap together in front of the chest 3x, elbows flared out, with a
    body bob on each impact. Ease apart-slow, snap-together-fast for weight."""
    _new_action(rig, "clap"); sc = bpy.context.scene; sc.frame_start = 1; sc.frame_end = F
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
    for s in ("L", "R"):
        prop(rig, "upper_arm_parent." + s, "IK_FK", 0.0, 1)   # IK arms (hand targets)
        prop(rig, "thigh_parent." + s, "IK_FK", 0.0, 1)       # IK legs, planted
    HL = _rest_world(rig, "hand_ik.L"); HR = _rest_world(rig, "hand_ik.R")
    C = _rest_world(rig, "chest"); T = _rest_world(rig, "torso")
    PL = _rest_world(rig, "upper_arm_ik_target.L"); PR = _rest_world(rig, "upper_arm_ik_target.R")
    cy = C.y - 0.9; cz = C.z - 0.15                 # clap point: forward of the chest
    ax = 1.25; cx = 0.06                            # hands apart / together (x)
    def keys(side):                                  # side: +1 = Rigify L (+x), -1 = R
        return [(1, side * abs(HL.x) if side > 0 else -abs(HR.x), (HL if side > 0 else HR).y, (HL if side > 0 else HR).z)]
    # explicit clap keys (world pos), together=fast, apart=slower
    seqL = [(1, (HL.x, HL.y, HL.z)), (7, (ax, cy + 0.25, cz + 0.1)), (11, (cx, cy, cz)), (13, (cx, cy, cz)),
            (18, (ax, cy + 0.25, cz + 0.1)), (22, (cx, cy, cz)), (27, (ax, cy + 0.25, cz + 0.1)),
            (31, (cx, cy, cz)), (F + 1, (cx * 3, cy + 0.1, cz))]
    seqR = [(f, (-w[0], w[1], w[2])) for f, w in seqL]
    for f, w in seqL: place(rig, "hand_ik.L", f, w)
    for f, w in seqR: place(rig, "hand_ik.R", f, w)
    # elbows flared OUT (poles to the sides)
    place(rig, "upper_arm_ik_target.L", 1, (PL.x + 1.5, PL.y, PL.z)); place(rig, "upper_arm_ik_target.R", 1, (PR.x - 1.5, PR.y, PR.z))
    # body bob down on each clap impact, slight forward lean
    for f, dz in [(1, 0), (11, -0.10), (14, 0.02), (22, -0.10), (25, 0.02), (31, -0.10), (34, 0.02), (F + 1, 0)]:
        place(rig, "torso", f, (T.x, T.y - 0.15, T.z + dz))
    for f, a in [(1, 0), (11, 8), (14, 0), (22, 8), (31, 8), (F + 1, 0)]: rot(rig, "head", f, rx=a)
    ease(rig); bpy.ops.object.mode_set(mode="OBJECT")
    return rig.animation_data.action


def stomp(rig, F=48, fps=24):
    """A heavy stomp on the pro rig. Legs on IK — Rigify's IK folds the high knee without
    flipping. Foot roll on the slam. Arms flared. Body coils, drops hard, and shakes."""
    _new_action(rig, "stomp"); sc = bpy.context.scene; sc.frame_start = 1; sc.frame_end = F
    bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode="POSE")
    _fk_arms(rig)
    FR = _rest_world(rig, "foot_ik.R"); T = _rest_world(rig, "torso")
    KP = _rest_world(rig, "thigh_ik_target.R")
    # right foot: knee drives FORWARD-and-up (clears the belly, no clip) then SLAMs down-forward.
    # tucking the foot back (+Y) buries the thigh in the belly — keep it forward (-Y).
    for f, w in [(1, (FR.x, FR.y, FR.z)), (7, (FR.x, FR.y - 0.2, FR.z + 0.5)),
                 (13, (FR.x - 0.15, FR.y - 0.45, FR.z + 0.95)), (17, (FR.x - 0.15, FR.y - 0.45, FR.z + 0.95)),
                 (21, (FR.x, FR.y - 0.9, FR.z - 0.05)), (25, (FR.x, FR.y - 0.9, FR.z)),
                 (F + 1, (FR.x, FR.y - 0.9, FR.z))]:
        place(rig, "foot_ik.R", f, w)
    # knee pole well forward + up so the knee juts forward (in front of the belly), out slightly
    for f, w in [(1, (KP.x, KP.y, KP.z)), (13, (KP.x - 0.6, KP.y - 0.5, KP.z + 1.3)),
                 (17, (KP.x - 0.6, KP.y - 0.5, KP.z + 1.3)), (21, (KP.x, KP.y, KP.z)), (F + 1, (KP.x, KP.y, KP.z))]:
        place(rig, "thigh_ik_target.R", f, w)
    # body: small coil rise, hard drop on impact, secondary dip, settle
    for f, dz in [(1, 0), (13, 0.15), (17, 0.15), (21, -0.42), (24, -0.2), (28, -0.3), (32, -0.1), (F + 1, 0)]:
        place(rig, "torso", f, (T.x, T.y, T.z + dz))
    # foot roll + toe on the slam (heel-to-flat, toe push)
    for f, a in [(1, 0), (13, -35), (17, -35), (21, 0), (F + 1, 0)]: rot(rig, "toe_ik.R", f, rx=a)
    # torso coil back then whip forward
    for f, a in [(1, 0), (13, -12), (17, -12), (21, 16), (25, 7), (F + 1, 0)]: rot(rig, "chest", f, rx=a)
    # arms: kept FORWARD of the torso (positive rx = forward) so the shoulder plates rotate
    # into open space, not into the back; elbows flared OUT moderately (negative rz), forearms up.
    for f, rx, rz in [(1, 14, -24), (13, 18, -28), (17, 18, -28), (21, 10, -26), (F + 1, 14, -24)]:
        rot(rig, "upper_arm_fk.R", f, rx=rx, rz=rz); rot(rig, "upper_arm_fk.L", f, rx=rx, rz=-rz)
    for f, a in [(1, 52), (21, 62), (F + 1, 52)]:
        rot(rig, "forearm_fk.R", f, rx=a); rot(rig, "forearm_fk.L", f, rx=a)
    ease(rig); bpy.ops.object.mode_set(mode="OBJECT")
    return rig.animation_data.action
