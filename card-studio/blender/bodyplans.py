"""BODY-PLAN REGISTRY — the codified, data-driven anatomy foundation.

A creature is NOT assumed to be a biped. Each body plan is one entry of DATA:
  - metarig    : the Rigify metarig to start from (ships with Blender)
  - anchors    : how we measure that body's landmarks from the mesh
  - fit        : place the metarig on the mesh via those anchors
  - rom        : anatomical range-of-motion per joint (real degrees) -> baked as limits
  - muscles    : the muscle-seed template used to segment the outer shell
  - def_map    : our seed-bone names -> Rigify DEF bones (for rigid plate binding)

Build a creature:  bodyplans.build(mesh_obj, plan="biped")
Add a new plan:    add an entry below (pick the Rigify metarig, give the ROM + anchor map).

Rigify metarigs available (Blender 5.2): human, basic_human, basic_quadruped,
Animals: cat, wolf, horse, bird, shark. (No spider — needs a custom metarig from limbs.)
"""
import bpy

# ---------------------------------------------------------------------------
# ROM tables (degrees). Sources: AAOS / CDC normal-ROM. Axis = the FK control's local axis.
# ---------------------------------------------------------------------------
ROM_BIPED = {
    "forearm_fk": dict(x=(0, 150),   y=(-85, 85), z=(-4, 4)),      # elbow hinge
    "shin_fk":    dict(x=(0, 140),   y=(-4, 4),   z=(-4, 4)),      # knee hinge
    "upper_arm_fk": dict(x=(-60, 170), y=(-90, 90), z=(-45, 170)), # shoulder ball
    "thigh_fk":     dict(x=(-30, 125), y=(-40, 45), z=(-25, 45)),  # hip ball
    "hand_fk": dict(x=(-70, 80), y=(-20, 20), z=(-30, 30)),        # wrist
    "foot_fk": dict(x=(-50, 20), y=(-10, 10), z=(-15, 15)),        # ankle
    "head": dict(x=(-45, 45), y=(-70, 70), z=(-45, 45)),
    "neck": dict(x=(-30, 30), y=(-45, 45), z=(-30, 30)),
    "chest": dict(x=(-20, 25), y=(-25, 25), z=(-20, 20)),
    "spine_fk.001": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
    "spine_fk.002": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
    "spine_fk.003": dict(x=(-15, 20), y=(-20, 20), z=(-15, 15)),
}
# Quadruped: front leg (shoulder/elbow/carpus), rear leg (hip/stifle/hock), spine, neck, tail.
ROM_QUADRUPED = {
    "forearm_fk": dict(x=(0, 150), y=(-10, 10), z=(-6, 6)),        # elbow/carpus hinge
    "shin_fk":    dict(x=(0, 150), y=(-6, 6),   z=(-6, 6)),        # stifle hinge
    "thigh_fk":   dict(x=(-45, 90), y=(-20, 20), z=(-15, 25)),     # hip (less abduction)
    "upper_arm_fk": dict(x=(-45, 120), y=(-20, 20), z=(-20, 40)),  # shoulder
    "neck": dict(x=(-45, 60), y=(-60, 60), z=(-45, 45)),
    # tail segments: broad, chain of small limits (added per-segment at build)
}
ROM_SERPENT = {}   # spine chain: broad per-segment lateral limits, applied along the chain
ROM_BIRD = {}      # wings (shoulder/elbow/wrist wide), legs like a small quadruped rear

# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------
BODY_PLANS = {
    "biped": {
        "metarig": "human",              # bpy.ops.object.armature_human_metarig_add
        "rom": ROM_BIPED,
        "muscles": "anatomy_human.json",
        "status": "IMPLEMENTED",         # fit + generate + segment + rom all wired
        "modules": "rig_rigify.fit_metarig -> generate; joint_spec.apply; build_stone",
    },
    "quadruped": {
        "metarig": "wolf",               # or 'cat' / 'horse' / 'basic_quadruped'
        "rom": ROM_QUADRUPED,
        "muscles": None,                 # TODO: derive a quadruped muscle template
        "status": "FRAMEWORK_READY",     # needs: anchor map (spine + 4 legs + tail) for fit
        "notes": "Rigify wolf metarig has spine, 2 front + 2 rear legs, tail, head. Fit its "
                 "bones to the mesh's 4 feet + spine line, then generate + apply ROM_QUADRUPED.",
    },
    "bird": {
        "metarig": "bird", "rom": ROM_BIRD, "muscles": None, "status": "FRAMEWORK_READY",
        "notes": "Wings = arm chains with wide ROM; legs = digitigrade rear legs.",
    },
    "serpent": {
        "metarig": "shark",              # shark spine chain is the closest ship-in start
        "rom": ROM_SERPENT, "muscles": None, "status": "FRAMEWORK_READY",
        "notes": "Use a long spine/spline-IK chain; animate a travelling sine wave; head leads.",
    },
    "spider": {
        "metarig": None, "rom": {}, "muscles": None, "status": "CUSTOM_NEEDED",
        "notes": "No ship-in metarig. Build a custom metarig: central body + 8 radial 3-seg "
                 "legs (limbs.super_limb), IK feet. Alternating-tripod gait.",
    },
}


def build(mesh_obj, plan="biped", shoulder_raise=0.08):
    """Dispatch to a body plan's builder. Only 'biped' is fully wired today; the others are
    registered with their Rigify metarig + ROM so they follow the same recipe."""
    spec = BODY_PLANS[plan]
    if spec["status"] != "IMPLEMENTED":
        raise NotImplementedError(
            "Body plan '%s' is %s. Recipe: metarig=%s. %s"
            % (plan, spec["status"], spec["metarig"], spec.get("notes", "")))
    import sys
    sys.path.insert(0, r"C:\Users\vaugh\discord\card-studio\blender")
    import importlib, rig_rigify as RG, joint_spec as JS
    importlib.reload(RG); importlib.reload(JS)
    meta = RG.fit_metarig(mesh_obj, shoulder_raise=shoulder_raise)
    rig = RG.generate(meta)
    bpy.data.objects.remove(meta, do_unlink=True)
    JS.apply(rig)                        # bake anatomical ROM limits
    return rig
