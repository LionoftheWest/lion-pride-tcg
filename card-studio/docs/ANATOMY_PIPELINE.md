# Anatomy Pipeline — how we build creature models

This document records the process. It explains how we made the correct anatomy, how we
modeled it, and how we mapped it onto a creature. Read this before you change a boss model.

The rule is simple. Build the anatomy first. Add the surface second.
- Layer 1 is the skeleton. It has many bones and joints.
- Layer 2 is the muscle map. Each muscle is a region on the skeleton.
- Layer 3 is the outer surface. This is skin, scales, or armor.

A muscle spans an origin bone and an insertion bone. It crosses a joint. The muscle pulls
that joint. This model is universal. It applies to a biped, a serpent, a spider, and a
dragon. Not every creature is a biped. Build one template for each body plan.

---

## 1. The anatomy reference — Z-Anatomy

Z-Anatomy is the source of the correct human anatomy.
- License: Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0).
- Attribution: Lluis Vinent Juanico. The models derive from BodyParts3D, the Database
  Center for Life Science (DBCLS).
- A derived work must keep the same license.

**Download.**
- Repository: `github.com/LluisV/Z-Anatomy`, branch `PC-Version`.
- The `.blend` files stay on Google Drive. A browser is necessary for those files.
- The FBX files are git-fetchable. Use these files.
  - `Resources/Models/FBX/SkeletalSystem100.fbx` (41 MB, all bones).
  - `Resources/Models/FBX/MuscularSystem100.fbx` (37 MB, all muscles).

**Local copies.**
- `card-studio/ml/z-anatomy/SkeletalSystem.fbx`
- `card-studio/ml/z-anatomy/MuscularSystem.fbx`
- `card-studio/ml/z-anatomy/human_reference.blend` (44 MB) — the full atlas. It has two
  collections, `Skeleton` and `Muscles`. It keeps every named part. Keep the whole thing.
  The muscle relationships matter.

**Coordinate frame.** Z is up. The unit is the meter. The model stands about 1.79 m tall.

**Naming convention (verified from the real file).**
- Bones: a whole bone has a plain name with `.l` or `.r`. Examples: `Femur.l`, `Humerus.r`,
  `Vertebra C3`, `Vertebra T1` to `T12`, `Vertebra L1` to `L5`, `Sacrum`, `Hip bone.l`.
- A name that starts with `(` or `[`, or ends with `.j`, is a bony landmark. It is not a
  whole bone. Skip these names for the skeleton.
- Muscles: `.g` is an empty group node, not geometry. The geometry is in the `.l` and `.r`
  parts. Group the `.l` and `.r` parts to find each muscle body.

---

## 2. The template — anatomy_human.json

The template is `card-studio/blender/anatomy_human.json`. It holds two maps.
- `joints`: 49 joints. Each joint is a normalized point.
- `muscle_seeds`: 475 muscle seeds. Each seed is one muscle group on one side.

**Normalization.** The template divides every point by the body height. The feet sit at
z=0. The top sits at z=1. The x axis is centered. This lets the template scale to any mesh.

**How we extracted it (one pass in `human_reference.blend`).**
1. Read the raw world position of each major bone. Compute joints from the bones.
   - For a long bone, find the two tips along the longest axis. These are the head and tail.
   - For a compact bone, use the centroid.
2. Compute z0, height, and x-center from the joint cloud. Normalize every joint.
3. Group the muscle meshes by base name and by side (`l`, `r`, or `c` for a central muscle).
   Compute a centroid for each group. Normalize each centroid.
4. Exclude a fascia, a bursa, a tendon, a ligament, a membrane, and a cartilage. These
   parts are not contractile muscle.
5. Exclude a seed outside the body volume.

**Trap — do not average the two sides.** The first extraction merged the left part and the
right part of each muscle into one centroid. Every bilateral muscle collapsed onto the
spine. The x range shrank to near zero. The segmentation then collapsed to nine pieces.
Keep the left seed and the right seed separate.

---

## 3. The pipeline modules

- `card-studio/blender/riglib.py` — build an armature, bind a mesh, pose a bone, add IK.
- `card-studio/blender/anatomy.py` — the anatomy layer. It loads the template, measures a
  mesh, fits the skeleton, and warps the muscle seeds.
- `card-studio/blender/build_from_anatomy.py` — the build script. It imports a mesh, fits
  the anatomy, segments the skin, and adds the two-layer surface.
- `card-studio/blender/walk_golem.py` — cleanup, the walk animation, the lighting, and the
  render.

---

## 4. The build process (build_from_anatomy.py)

1. **Import and align.** Import the AI mesh. Stand it up. Scale it to the target height.
   Center it. Put the feet at z=0.
2. **Measure anchors.** `anatomy.measure_anchors` reads landmarks from the real mesh.
   - It finds the shoulder width, the hip width, the arm reach, and the leg length.
   - It reads these landmarks from mesh cross-sections.
   - `shoulder_raise` lifts the shoulder line. Use it for a neckless creature.
3. **Fit the skeleton.** `anatomy.anchored_joints` places the joints.
   - The endpoints come from the mesh. The interior joints come from the anatomy ratios.
   - This gives the same anatomy with each creature's own proportions.
4. **Build the armature.** `anatomy.build_skeleton` builds the bones from the joints.
5. **Warp the muscle seeds.** `anatomy.place_muscles_warped` moves each seed through its
   nearest template bone into the fitted rig. Each muscle follows its bone.
6. **Segment the skin.** The script assigns each mesh face to the nearest muscle seed. This
   is a Voronoi partition. It splits the single skin into per-muscle pieces.
   - A coherence pass peels a torso face off an arm bone. This stops the chest from moving
     with the arm.
7. **Make each piece solid.** The script adds a thin inward shell to each piece. It keeps
   the outer detailed surface. It binds each piece rigidly to one bone.
8. **Add the inner skin (the two-layer surface).**
   - The outer layer is the detailed rock shell.
   - The inner layer is a soft, dark skin. It sits deep, near the skeleton. It fills the
     gaps between the plates. It uses smooth shading.

---

## 5. The CONFIG block (build_from_anatomy.py)

| Key | Value | Purpose |
|---|---|---|
| `MESH` | path | The AI mesh to build from. |
| `HEIGHT` | 4.58 | The target height in Blender units. |
| `SHOULDER_RAISE` | 0.08 | Lift the shoulders. Use it for a neckless creature. |
| `THICK` | 0.03 | The plate thickness. A thin plate keeps the detail. |
| `GROW` | 1.0 | No grow. A grow inflates a piece into a pillow. |
| `SMOOTH` | True | Smooth shading inside a plate. A hard seam stays between plates. |
| `CORE` | True | Add the soft inner skin. |
| `CORE_INSET` | 0.18 | Push the inner skin deep, near the skeleton. |

---

## 6. Lessons — the traps that bite

- **The pudge (the michelin look).** A thick shell, a grow, and smooth shading turn each
  muscle into a closed pillow. Use a thin plate. Remove the grow. The outer surface then
  stays the original detailed skin.
- **The flat-shading patchwork.** Flat shading makes each plate one tone. A rotated arm
  becomes a bright and dark patchwork. Use smooth shading on a thin plate.
- **The inner skin pokes out.** The AI mesh has inconsistent normals. An offset along a
  bad normal pushes a vertex outward. Recalculate the normals outward first. Then push the
  inner skin inward.
- **The pectoral moves with the arm.** A chest face near the shoulder binds to an arm bone.
  The coherence pass peels a torso face back to a trunk muscle.
- **The muscle seed collapse.** Do not average the left side and the right side. See §2.
- **FFMPEG is not assignable.** The format enum lists FFMPEG. The assignment fails. Render
  a PNG sequence. Then assemble the video with the system `ffmpeg`.
- **read_homefile leaves a stale context.** Do not call `read_homefile` inside one execute
  call and then use an operator. Clear the scene by data removal instead.

---

## 7. Reproduce the behemoth

Run the build, then one animation, in the live Blender session.
```
exec(open(r"C:\Users\vaugh\discord\card-studio\blender\build_from_anatomy.py").read())
exec(open(r"C:\Users\vaugh\discord\card-studio\blender\walk_golem.py").read())   # walk
exec(open(r"C:\Users\vaugh\discord\card-studio\blender\stomp_golem.py").read())  # stomp attack
```
Each animation script renders a PNG sequence. Assemble the video with the system `ffmpeg`.
```
ffmpeg -y -framerate 24 -stream_loop 5 -i frame_%04d.png -c:v libx264 -pix_fmt yuv420p walk.mp4
```

Outputs (in `card-studio/out/behemoth/`):
- `behemoth_anat.blend` — the scene, with the last animation baked.
- `walk.mp4` / `walk.gif` — the walk. `stomp.mp4` / `stomp.gif` — the stomp attack.
- `detail_check.png` — a still.

---

## 8. Extend to a new creature or a new body plan

- **Same body plan (another biped).** Change `MESH` in the CONFIG block. Run the two
  scripts. Tune `SHOULDER_RAISE` for a neckless creature.
- **New body plan (serpent, spider, quadruped, dragon).** Add a sibling template.
  1. Author a joint map and a muscle-seed map. Save it as `anatomy_<plan>.json`.
  2. Add a bone hierarchy table in `anatomy.py`, like `BIPED_BONES`.
  3. Add a measure function for that body plan.
  The segmentation engine and the two-layer surface stay the same.

---

## 9. Animation notes (lessons from the walk and the stomp)

The animation scripts are `walk_golem.py` and `stomp_golem.py`. Each one cleans up the
strays, builds an action, sets the lighting and camera, and renders a PNG sequence.

**IK versus FK.**
- The legs use IK for a plant. An IK foot target plants the foot. The knee bends by itself.
- A pole target sets the knee direction.
- IK is good for a small, near-ground move. IK is UNSTABLE for a big fold on this
  auto-generated skeleton. A high knee made the solver flip — the ankle stuck low, then
  jumped above the hip. The knee hinge from the anatomy joints is not a clean plane.
- **Rule: drive a big joint motion (a high knee, a raised arm) with FK. Keep IK only for a
  planted foot.** FK is direct and stable. It does not flip.
- Verified FK signs on this rig (find a sign by a test render, never a guess):
  - `thigh.r` rx = -90 lifts the knee forward to hip height (thigh horizontal).
  - `shin.r` rx = +100 hangs the shin straight down from the raised thigh.
  - A slam swings the thigh forward-down (rx about -28) and straightens the shin (rx about
    +14) so the foot lands ahead of the other foot.

**The high knee (the stomp).** A far-forward foot target leaves the knee low. This was the
main trap. Tuck the foot target up, close under the hip. The leg then folds. The knee juts
up to hip height. Use `foot_high=(hipx, hipy-0.25, hipz-Ls*0.55)` with the knee pole raised
up and forward. Slam the foot down and forward. The stomp foot lands ahead of the other
foot. It stays stepped forward.

**A body translate fights a world-space IK target.** The IK target is a world object. When
the armature object rises, the target stays fixed. A big body rise then lowers the knee.
Keep the coil rise small.

**Find a rotation sign by a test, not by a guess.** Set one test pose. Render it. Read the
result. Then keep the correct sign. Do not guess a sign and render the whole cycle.

**The arm flare (the angry-stomp pose).**
- `upperarm` rotation about local Z (rz) abducts the arm. It moves the elbow out to the
  side. Use a positive rz on the right and a negative rz on the left.
- `forearm` rotation about local X (rx) bends the elbow. A POSITIVE rx sends the fist UP.
  A negative rx folds the fist down and in. That is the wrong way.
- A large overhead arm raise opens big shoulder gaps. Keep the raise moderate.

**Camera framing.** A tall pose or a raised arm leaves the frame. Pull the camera back.
Raise the camera target. A stomp reads best from a 3/4 view or a side view.

**Render and assemble.** Blender lists FFMPEG in the format enum. The assignment fails.
Render a PNG sequence. Assemble the video with the system `ffmpeg`.

**The cleanup threshold.** A pose opens gaps and reveals small stray pieces. Merge a piece
below a vertex count into its nearest neighbor. Raise the threshold if strays remain.

---

## 10. Attribution (required by the license)

This pipeline uses Z-Anatomy. Z-Anatomy is licensed CC BY-SA 4.0. The author is Lluis
Vinent Juanico. The models derive from BodyParts3D, DBCLS. A model that ships to a player
must keep this attribution and the same license.
