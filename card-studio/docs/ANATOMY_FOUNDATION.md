# Anatomy Foundation — Rigify + Z-Anatomy, codified

This document is the codified foundation for creature motion, clipping, and body physics.
The rule: get the foundation right and everything downstream becomes easy. The foundation
is built from two sources that fit together:

- **Rigify** (ships with Blender) — the proven control and deformation layer. It generates a
  professional rig: IK/FK with snapping, pole targets, foot roll, twist bones, spline chains.
  It has metarigs for many body plans (human, quadruped, bird, shark, and custom).
- **Z-Anatomy** (CC BY-SA) — the anatomical truth. It gives the real skeleton, 475 muscles,
  and geometric origin/insertion. It sets the joint positions, the proportions, and the
  muscle map.

Rigify says HOW a joint moves. Z-Anatomy says WHERE the joints are and how the muscles run.
Together they give a consistent, anatomically-bounded rig for any creature.

The whole thing is DATA-DRIVEN. A body plan is a table of parameters. A creature is NOT
assumed to be a biped. See `bodyplans.py`.

---

## The four parameter categories (the foundation)

### 1. Joint kinematics — the biggest realism lever
Every joint gets, as data:
- **Type** — hinge (elbow, knee), ball (shoulder, hip), pivot (neck), spline (tail, spine).
- **Range of motion** — real degrees per axis. A pose then physically cannot exceed real
  anatomy, so it cannot clip into the body, and IK cannot flip.
- **Hinge axis + roll** — the joint bends on its correct single axis.
- **Pre-bend** — the knee and the elbow start slightly bent, so IK never hits a straight-chain
  singularity (the bug that flipped our knee).

Real human ROM baked in (degrees, from AAOS / CDC norms), in `joint_spec.py` / `bodyplans.ROM_BIPED`:
- Elbow flex 0–150 (hinge). Knee 0–140 (hinge).
- Shoulder flex 170 / extend 60 / abduct 170. Hip flex 125 / extend 30 / abduct 45.
- Wrist ±70. Ankle −50/+20. Neck ±45, rotate 70. Each spine segment a small share.

Applied as **Limit Rotation** on the FK controls plus **IK limits** on the chains. Verified:
driving the elbow to 300 degrees clamps it to a natural bend.

### 2. Deformation
- **Twist bones** on the forearm, the upper arm, and the thigh (Rigify makes these) stop the
  candy-wrapper collapse.
- **Corrective shape keys** at the shoulder, the hip, the elbow, and the knee for extreme poses.
- **Preserve volume** (dual-quaternion) skinning to keep mass at a bend.

### 3. Proportions and structure
- Segment lengths and joint positions come from the Z-Anatomy anchors, fit to each mesh.
- Symmetry is enforced by the `.L` / `.R` naming.
- Add bones only where the creature needs them (fingers, toes, a jaw, a tail).

### 4. Muscle interaction (how the body works)
- A muscle spans an origin bone and an insertion bone across a joint. When the joint flexes,
  the muscle shortens and bulges. This is derivable from the Z-Anatomy origin/insertion.
- Implement as a driver: the joint angle drives a muscle bone scale or a corrective shape, so
  the bicep balls up as the elbow bends. Visible on a fleshy creature; hidden under rock.

---

## The body-plan registry (`bodyplans.py`)

Each plan is one data entry: the Rigify metarig to start from, the ROM table, the muscle
template, and the anchor map. `bodyplans.build(mesh, plan)` runs the pipeline for that plan.

| Plan | Rigify metarig | Status | Notes |
|---|---|---|---|
| biped | human | IMPLEMENTED | fit + generate + segment + ROM all wired |
| quadruped | wolf / cat / horse | framework-ready | fit spine + 4 legs + tail, then ROM_QUADRUPED |
| bird | bird | framework-ready | wings = wide arm chains, legs = digitigrade |
| serpent | shark | framework-ready | long spline-IK spine, travelling sine wave |
| spider | custom | custom needed | central body + 8 radial 3-seg legs, tripod gait |

To add a plan: pick the Rigify metarig, write its anchor map (where its bones sit on the
mesh), give it a ROM table, and a muscle template. The rest of the pipeline is shared.

---

## The foundation principles (motion, clipping, physics)

- **Clipping is prevented at the source** by joint ROM limits — not patched per animation.
- **IK never flips** because every two-bone chain has a pre-bend and a single-axis hinge limit.
- **Weight and physics** read through timing (see `ANIMATION_CRAFT.md`) on a rig that already
  moves correctly. Secondary motion (jiggle bones) is added on loose mass.
- **Deformation is signed off before any surface** — the range-of-motion test on the clean
  figure (see `ANATOMY_PIPELINE.md`) must be clean first.
- **The stone/skin/armor is a layer on top** of the working, bounded skeleton.

---

## How this connects to the rest

- `ANATOMY_PIPELINE.md` — the build order (image → figure → rig → skin → ROM → stone → export).
- `CREATURE_PIPELINE_AUDIT.md` — every stage, pro practice vs ours, with resources.
- `ANIMATION_CRAFT.md` — the animator's craft (timing, weight, arcs) for any subject.
- Code: `bodyplans.py` (registry), `joint_spec.py` (ROM), `rig_rigify.py` (fit + generate),
  `anatomy.py` (anchors + muscle map), `build_base.py` / `build_stone.py` (build),
  `anim_rigify.py` (moves), `rigcheck.py` (validation), `matlib.py` (materials).

## Attribution
Z-Anatomy is CC BY-SA 4.0 (Lluis Vinent Juanico, from BodyParts3D/DBCLS). A shipped model
must keep the attribution and the same license.
