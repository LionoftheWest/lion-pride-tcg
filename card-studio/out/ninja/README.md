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

## Not in this stage (later steps)

Rigging (weight-bind + Rigify Generate Rig), cloth sim on `sim=cloth` parts, sculpt/
retopo refinement, texturing, animation. This stage only builds the foundation.
