# Creature Pipeline Audit — pro practice vs our system

This document audits the whole creature pipeline. It covers the model, the skin, the
skeleton, the skinning, the animation, the weight, and the export. For each stage it lists
the professional practice, our current state, the gap, and the action. It ends with a
resource list.

The purpose is to capture correctness in the build, so we do not rediscover a lesson per
boss. Turn each practice into a spec value or a fail‑closed check.

---

## Stage 1 — Reference and concept
- **Pro practice:** collect real reference (video, photos, anatomy) before modeling. Study
  weight and motion from life.
- **Our state:** we use the Z‑Anatomy atlas for the skeleton and muscles.
- **Gap:** no motion reference. We hand‑guess timing.
- **Action:** collect motion reference (video or mocap) per action. See Stage 8.

## Stage 2 — Base mesh (model)
- **Pro practice:** sculpt a high‑detail form, or generate one, as the *starting* shape.
- **Our state:** TripoSR turns an image into a mesh.
- **Gap:** the AI mesh is a smooth triangle blob. It is soft and low on real detail.
- **Action:** keep TripoSR for the block‑in. Add a sculpt/detail pass for surface (rock
  cracks, scales) before or after retopology. Test better generators later.

## Stage 3 — Topology and retopology (THE deepest gap)
- **Pro practice:** retopologize to clean **quads**. Put **edge loops around every joint**
  (knee, elbow, shoulder, hip) so the skin bends and keeps volume. Concentrate polygons at
  joints, fewer in flat areas. Triangulate only at export.
- **Our state:** we never retopologize. We cut the AI triangle mesh into rigid rock plates.
- **Gap:** with no deformation topology, smooth bending is impossible. This is the root
  reason our joints open gaps. Our rigid‑plate approach is a *stylization* that avoids
  topology, not a replacement for it.
- **Action:** decide per creature. A rock golem can stay rigid plates (with our two‑layer
  skin). A fleshy or scaled creature needs real quad retopology with joint loops. Add a
  retopology step (Quad Remesh or hand retopo) for smooth‑skinned creatures.

## Stage 4 — UVs, materials, and skin
- **Pro practice:** unwrap UVs. Author PBR maps (base color, roughness, normal, height).
  Bake high‑detail into a normal map. Layer skin, scales, or armor as materials.
- **Our state:** one flat stone material. No UVs. No maps.
- **Gap:** no surface texture, no normal‑mapped detail, no scale/armor variants.
- **Action:** add a UV + PBR pass. Bake sculpt detail to a normal map. Build a small
  material library (stone, scale, metal, flesh) as presets.

## Stage 5 — Skeleton and rig (rig‑ready)
- **Pro practice:** a control rig. Clean **bone roll** (one bend axis per joint). A slight
  **pre‑bend** at knee and elbow. **Rotation limits** on hinges. **IK with a pole** for
  legs. **IK/FK switch** on arms with snapping. **Foot roll** (heel‑ball‑toe). **Twist
  bones** on forearm, upper arm, and thigh to stop the candy‑wrapper collapse. **Spline
  IK** for a tail, a spine, or a serpent. **Control bones** separate from deform bones.
- **Our state:** bones placed at correct anatomy joints. Rigid IK on legs. No roll set, no
  pre‑bend, no limits, no twist bones, no foot roll, no IK/FK switch, no spline IK.
- **Gap:** the IK flips because the knee has no clean hinge. No twist bones. No tail system.
- **Action:** build a **rig‑ready** generator. Set roll, pre‑bend, limits, IK+pole,
  IK/FK switch, foot roll, twist bones. Add spline IK for tails and serpent spines. This
  is the single biggest capability upgrade.

## Stage 6 — Skinning and weights
- **Pro practice:** smooth weights. **Normalize** so weights sum to 1.0. **Four bone
  influences maximum** for a game engine. An iterative pose‑verify‑repaint loop.
  **Corrective shape keys** on shoulder, hip, knee, and elbow for extreme poses.
  **Dual‑quaternion** skin or **twist bones** to stop the candy‑wrapper collapse.
- **Our state:** rigid binding. One bone per rock piece at weight 1.0. A soft inner skin
  with automatic weights fills the gaps.
- **Gap:** rigid pieces separate at a joint and open a gap. No correctives. The inner skin
  is our substitute for smooth skinning.
- **Action:** keep the rigid‑plate stylization for rock creatures, but improve the inner
  skin coverage at extreme flex. For a smooth creature, use normalized 4‑influence weights
  plus correctives. Add a corrective‑shape step for the worst joints.

## Stage 7 — Animation (movement and weight)
- **Pro practice:** the **12 principles**. Work **blocking → spline → polish**. Use
  **arcs** (limbs move in curves, not lines). Control **timing and spacing** for weight (a
  heavy giant moves slow, then fast, then settles heavy). Add **anticipation**, **overshoot**,
  **follow‑through**, and **overlap**. Use **moving holds** (never fully still). Keep a
  readable **silhouette**. Add **secondary action**.
- **Our state:** we hand‑key primitives (walk, stomp). We added a coil, a slam, and a
  shake. We do not yet use arcs, spacing curves, overlap, or moving holds by method.
- **Gap:** motion can read stiff or light. Weight is not yet deliberate.
- **Action:** adopt the blocking → spline → polish method. Add reusable motion primitives:
  anticipation, ease, overshoot, follow‑through, and a moving hold. Build the action from
  these, not from raw keys.

## Stage 8 — Movement systems (reuse and mocap)
- **Pro practice:** **motion capture** retargeted to the rig for realistic weight and
  timing. **Bone mapping** from a source skeleton to the target. **Bake** the result. A
  shared skeleton so animations reuse across characters. **Root motion** for locomotion.
- **Our state:** none yet. Every action is hand‑keyed from scratch.
- **Gap:** slow to make each boss's moves. No mocap.
- **Action:** build the retarget pipeline. Fetch free mocap (CMU, Bandai Namco). Map the
  source bones to our rig. Copy rotations with a constraint. Bake with visual keying. This
  copies joint *angles*, so it is proportion‑independent and avoids the IK problem.

## Stage 9 — Physics and dynamics (secondary motion)
- **Pro practice:** **jiggle or wiggle bones** for soft parts that follow the main motion
  (a belly, a tail, straps, loose rock). **Cloth** and **soft body** for capes and flesh.
- **Our state:** none. Everything is rigid and keyed.
- **Gap:** no automatic secondary motion. Loose rock does not settle after a stomp.
- **Action:** add a jiggle‑bone pass (the Wiggle Bones addon, or a spring driver in code)
  on chosen loose pieces. This adds life with little work.

## Stage 10 — Export and game‑ready
- **Pro practice:** export **glTF** or **FBX** with the rig and the baked actions. Keep the
  **bone count** sane. Limit to **four influences**. Build **LODs**. Use a strict **naming
  convention**. Triangulate at export.
- **Our state:** we render video. We do not export a rigged, animated model for the game.
- **Gap:** no game‑ready export. 296 rigid pieces is heavy for a real‑time Activity.
- **Action:** add a glTF export with baked actions. Merge or decimate pieces for a real‑time
  budget. Add a LOD pass. Confirm the game loads it.

## Stage 11 — Validation and QA (capture the lessons)
- **Pro practice:** test deformation early. A rig checklist. A range‑of‑motion test.
- **Our state:** we verify by eye, per render.
- **Gap:** no automated checks. We rediscover a bug per boss.
- **Action:** build `rigcheck.py`. Turn each lesson into a fail‑closed check:
  - Every deform bone has weights.
  - Every face is assigned a seed.
  - Muscle seeds span both sides.
  - IK solves without a flip.
  - Each hinge has roll, pre‑bend, and a limit.
  - No stray pieces.
  - The inner skin stays inside at rest and at extreme poses.
  - Orientation and scale are sane.
  - Left and right match.
  - Render a range‑of‑motion test automatically.

---

## The biggest gaps, ranked
1. **Rig‑ready skeleton** — roll, pre‑bend, limits, IK/FK, twist bones, foot roll, spline IK.
2. **Validation harness** — `rigcheck.py` plus the range‑of‑motion render.
3. **Animation method** — blocking → spline → polish, with reusable motion primitives.
4. **Mocap retarget** — fast, realistic motion for every boss.
5. **Topology decision** — rigid plates for rock, quad retopo for smooth creatures.
6. **Skin and materials** — UVs, PBR, normal‑mapped detail, a material library.
7. **Secondary motion** — jiggle bones.
8. **Game export** — glTF with baked actions, a real‑time budget, LODs.

## Resources (what other creators use)
- Rigify workflow — CGDive, "Rig Anything with Rigify": https://cgdive.com/rig-anything-with-rigify-chapter-2-the-rigify-workflow/
- Auto‑Rig Pro (rig + retarget + game export): https://blendermarket.com/products/auto-rig-pro/ and the Remap doc: https://www.lucky3d.fr/auto-rig-pro/doc/remap_doc.html
- IK/FK switching guide — Whizzy Studios: https://www.whizzystudios.com/post/how-to-add-ik-fk-switching-to-any-rig-in-blender
- Rigging‑readiness checklist — Tripo3D: https://www.tripo3d.ai/blog/explore/rigging-readiness-checklist-for-character-models
- 12 principles of animation — Animation Mentor: https://www.animationmentor.com/blog/tutorial-12-principles-of-animation/ and CG Spectrum: https://www.cgspectrum.com/blog/12-principles-of-animation
- Timing and spacing — Lollypop: https://lollypop.design/blog/2019/march/the-forgotten-art-of-spacing/
- Character topology, knee edge flow — CGTyphoon: https://cgtyphoon.com/topology/human-knee-topology/ and elbow: https://cgtyphoon.com/topology/elbow-topology-explained-for-character-modeling/
- Quads vs triangles for game retopology — Triverse: https://triverse.ai/blog/quads-vs-triangles-game-retopology
- Weight painting and skinning — MoCap Online: https://mocaponline.com/blogs/mocap-news/weight-painting-skinning-guide and Kiel Figgins: https://www.3dfiggins.com/writeups/paintingWeights/
- Game‑ready rig, IK/FK, candy‑wrapper, twist bones — game-developers.org: https://game-developers.org/character-rigging-explained-the-complete-guide-to-skeletons-skinning-ik-fk-game-ready-rigs
- Jiggle / secondary motion — Wiggle Bones (Blender Extensions): https://extensions.blender.org/add-ons/wiggle-bones/ and Wiggle 2 (CGDive): https://addons.cgdive.com/tools/wiggle-bones
- Mocap retargeting — Rokoko guide: https://www.rokoko.com/insights/ace-retargeting-in-blender-with-this-simple-workflow-i-the-ultimate-retargeting-guide and MocapWork: https://mocapwork.com/blog/retargeting-mocap-custom-rigs/
- Free mocap libraries — CMU (una‑dinosauria BVH mirror): https://github.com/una-dinosauria/cmu-mocap and Bandai Namco Research: https://www.cgchannel.com/2022/05/download-3000-free-mocap-moves-from-bandai-namco-research/
- Official training — Blender Studio "Animation Fundamentals" and free rigs: https://studio.blender.org/
- Recommended book — "The Animator's Survival Kit" by Richard Williams (weight, timing, walks).
