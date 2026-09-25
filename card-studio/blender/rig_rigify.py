"""Rigify backbone — fit Blender's professional rig generator to our creature.

Instead of hand-building a fragile skeleton, we position a Rigify metarig with our anatomy
anchors, strip the parts a boss does not need (face, fingers), and let Rigify GENERATE a
pro control rig: stable IK/FK with snapping, pole targets, foot roll, and twist bones.
The generated rig has DEF- bones we bind the rock plates to.

    import rig_rigify as RG; importlib.reload(RG)
    meta = RG.fit_metarig(mesh_obj)      # position + strip
    rig  = RG.generate(meta)             # -> the generated "RIG-*" object
"""
import bpy, math
import numpy as np
from mathutils import Vector
import anatomy as AN

META2OUR = {"L": "r", "R": "l"}   # Rigify +x side (L) is our +x anchors (r)

# metarig bones we keep (a game boss body). Everything else (face, fingers) is stripped.
_FACE = ("face", "nose", "brow", "lid", "eye", "ear", "cheek", "chin", "jaw", "lip",
         "teeth", "tongue", "temple", "forehead", "breast")
_FING = ("f_index", "f_middle", "f_ring", "f_pinky", "thumb", "palm")


def _V(p):
    return Vector((float(p[0]), float(p[1]), float(p[2])))


def _strip(eb):
    kill = [b.name for b in eb
            if b.name.startswith(_FACE) or b.name.startswith(_FING)]
    for n in kill:
        if n in eb:
            eb.remove(eb[n])
    return len(kill)


def fit_metarig(mesh_obj, shoulder_raise=0.08, tpl_name="human"):
    """Add a Rigify human metarig and position its body bones onto the mesh via anchors."""
    tpl = AN.load(tpl_name)
    A = AN.measure_anchors(mesh_obj, shoulder_raise=shoulder_raise)
    J = AN.anchored_joints(tpl, A)                     # world joints (incl. pre-bend)
    def j(k): return _V(J[k])
    def a(k): return _V(A[k])

    before = set(bpy.data.objects)
    bpy.ops.object.armature_human_metarig_add()
    meta = [o for o in bpy.data.objects if o not in before][0]
    meta.name = "meta_boss"
    meta.location = (0, 0, 0); meta.rotation_euler = (0, 0, 0); meta.scale = (1, 1, 1)
    bpy.context.view_layer.objects.active = meta
    bpy.ops.object.mode_set(mode="EDIT")
    eb = meta.data.edit_bones
    _strip(eb)

    def setb(name, head, tail):
        b = eb.get(name)
        if b: b.head, b.tail = _V(head), _V(tail)

    # spine chain (Sacrum -> Frontal) using our real joints
    C3 = j("Vertebra C3"); FR = j("Frontal bone"); mid = C3 + (FR - C3) * 0.5
    setb("spine",     j("Sacrum"),        j("Vertebra L4"))
    setb("spine.001", j("Vertebra L4"),   j("Vertebra L1"))
    setb("spine.002", j("Vertebra L1"),   j("Vertebra T7"))
    setb("spine.003", j("Vertebra T7"),   j("Vertebra C7"))
    setb("spine.004", j("Vertebra C7"),   C3)
    setb("spine.005", C3,                 mid)
    setb("spine.006", mid,                FR)

    fz = A["foot_z"]
    for M, s in META2OUR.items():
        setb("shoulder.%s" % M, j("sternoclav.%s" % s), j("shoulder.%s" % s))
        setb("upper_arm.%s" % M, j("shoulder.%s" % s), j("elbow.%s" % s))
        setb("forearm.%s" % M,  j("elbow.%s" % s),    j("wrist.%s" % s))
        setb("hand.%s" % M,     j("wrist.%s" % s),    j("hand.%s" % s))
        setb("thigh.%s" % M,    j("femhead.%s" % s),  j("knee.%s" % s))
        setb("shin.%s" % M,     j("knee.%s" % s),     j("ankle.%s" % s))
        setb("foot.%s" % M,     j("ankle.%s" % s),    j("ball.%s" % s))
        setb("toe.%s" % M,      j("ball.%s" % s),     j("balltip.%s" % s))
        # heel marker: a small bone across the back of the foot, on the ground
        an = a("ankle.%s" % s)
        heelY = an.y + 0.10 * A["_H"]
        setb("heel.02.%s" % M, (an.x - 0.09 * A["_H"], heelY, fz), (an.x + 0.09 * A["_H"], heelY, fz))
        # pelvis marker
        hip = a("hip.%s" % s)
        setb("pelvis.%s" % M, j("Sacrum"), (hip.x, hip.y, hip.z + 0.10 * A["_H"]))

    bpy.ops.object.mode_set(mode="OBJECT")
    # let Rigify compute clean roll/hinge axes on the limbs
    for bn in ("upper_arm.L", "upper_arm.R", "thigh.L", "thigh.R"):
        pb = meta.pose.bones.get(bn)
        if pb and hasattr(pb, "rigify_parameters"):
            try: pb.rigify_parameters.rotation_axis = "automatic"
            except Exception: pass
    return meta


def generate(meta):
    """Generate the Rigify control rig. Returns the generated armature object."""
    before = set(bpy.data.objects)
    bpy.context.view_layer.objects.active = meta
    for o in bpy.context.view_layer.objects:
        try: o.select_set(False)
        except Exception: pass
    meta.select_set(True)
    bpy.ops.pose.rigify_generate()
    rig = [o for o in bpy.data.objects if o not in before and o.type == "ARMATURE"]
    return rig[0] if rig else bpy.data.objects.get("RIG-" + meta.name)
