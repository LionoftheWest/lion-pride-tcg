# Single-image part-aware 3D pipeline (first stage)

Turn ONE character image into a **foundational, part-separated 3D model** ready to
import into Blender for rigging + refinement. Robust across body plans; every part
(visible garments, occluded anatomy, flat accessories) comes out as its own tagged
mesh, with a fitted skeleton — so the Blender "mold + rig" stage starts from a solid,
complete base instead of a fused blob.

## One command

```sh
python orchestrate.py <image.png> [biped|quadruped|bird|serpent]
```

The optional 2nd arg is a **body-plan hint** you give on submit; it overrides the
silhouette auto-detection (the least-reliable step). Output: `ninja_foundation.blend`
+ `foundation_manifest.json` (every part with `part_type` / `sim` / `region` tags).

## Stages

1. **Segment (`sam_parts.py`)** — rembg matte (robust bg removal on any art) +
   silhouette **body-plan detection** + landmarks (shoulder/hip lines). **SAM**
   (Segment Anything) isolates every distinct layer; a garment's own fold-fragments
   are merged, distinct parts stay separate. Each part is labeled (zone + side +
   color → garment/cloth, body/skin, accessory/rigid) and routed to a method:
   `generate` (volumetric) or `extrude` (flat/thin — ears, patches).
   (`parts_seg.py` is a lighter color/anatomy fallback: `SEGMENTER=heuristic`.)
2. **Estimate pose (`pose_estimate.py`, biped only)** — **MediaPipe** Tasks
   PoseLandmarker reads the character's 2D pose (33 joints) → `pose.json`. Robust even
   on a stylized subject (the fox-ninja reads at 0.96–1.0 joint confidence). A miss
   (`NO_POSE_DETECTED`) is non-fatal — the assembler falls back to bbox placement.
3. **Generate (`gen_part.py`)** — each volumetric part → its own mesh via the local
   **Hunyuan3D** API (`POST :8081/generate`). A failed/degenerate part is skipped, not
   fatal.
4. **Assemble (`assemble.py`, headless Blender)** — imports the generated parts + the
   **skeleton for the detected plan** (Mixamo for biped, **Rigify** metarig for
   non-biped), fits it to the image proportions, and builds the **occluded base body
   as one capsule per bone** (the bones ARE the part list). Flat parts are **extruded
   from their SAM mask** into thin meshes. **Pose-normalize** then poses the fitted
   skeleton to the image pose, and moves each garment part by its nearest bone's
   capture→rest delta — so an image-posed limb part (sleeve, gauntlet, greave) swings
   onto the **T-pose** skeleton, while a torso/head/leg part sits on a non-aimed bone
   (identity delta) and stays put. The whole foundation lands in one consistent T-pose,
   native-Mixamo ready, with no auto-weight distortion of the generated blobs. Tags
   every part, saves the foundation. (`render_foundation.py` renders a tagged front
   view for verification.)

## Local, free dependencies (paths are machine-specific in the scripts)

- **Hunyuan3D-2** shape server (`card-studio/ml/Hunyuan3D-2/api_server.py --port 8081`).
- **SAM** ViT-B checkpoint (`card-studio/ml/sam/`), free (Apache-2.0).
- **MediaPipe** Tasks PoseLandmarker — isolated venv `card-studio/ml/mp_venv` (kept
  apart from the Hunyuan venv to avoid numpy/protobuf conflicts); model bundle
  `pose_landmarker_heavy.task` beside that venv. Free (Apache-2.0).
- **Rigify** (bundled with Blender) for non-biped skeleton metarigs.
- The venv `card-studio/ml/venv` (uv-managed) with torch + hy3dgen + segment-anything.

## Stage 2 — rig + motion (`rig.py`)

```sh
blender -b -P rig.py -- <ninja_dir> [clip]   # clip in behemoth/mixamo/*.fbx, default swipe
```

Takes `ninja_foundation.blend` and makes it a skinned, animated character:
1. **Consolidate** the per-bone base capsules into ONE continuous body mesh (join + voxel
   remesh + shade smooth).
2. **Skin** the body AND each separate garment/accessory to the skeleton with automatic
   weights — the parts stay separate (swap-able) but now deform with the rig.
3. **Apply a Mixamo-rig clip** natively (the skeleton is mixamorig). The clip's Hips
   TRANSLATION is stripped so it plays IN PLACE (its root motion is in the source rig's
   units and would fling this differently-scaled rig off-world). Do NOT `transform_apply`
   the armature — it is a native Mixamo object (tiny non-uniform scale + 90deg X rot,
   bones in cm space) and applying scale garbles the rest pose.

Output: `ninja_rigged.blend` + `ninja_rig_manifest.json`.

**KNOWN LIMITATION:** the consolidated base body is a crude proxy — the voxel remesh
fuses the legs and inflates the arms, so the silhouette is bulky. It animates correctly
but needs a proper humanoid base mesh (or slimmer capsules + finer remesh) to look good.
The "sculpt the base clean" work is the next improvement.

## Not in this stage (later steps)

Cloth sim on `sim=cloth` parts, a proper anatomy base body, sculpt/retopo refinement,
texturing, and real ninja-specific Mixamo moves (needs a browser login).
