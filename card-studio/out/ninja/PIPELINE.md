# HARD RULE - NO BLOBS, NO CUT CORNERS

**Every stage must be PINPOINT ACCURATE to the artwork. No generic primitives standing in
for real forms. No "close enough".**

Look at the reference blockout in the source article: every armour plate, horn, strap,
finger and boot is its own accurately placed shape. That is the standard. A handful of
capsules is NOT a blockout.

Concretely, at every stage:
- EVERY design element in the concept art gets its own piece. Nothing is merged for
  convenience and nothing is omitted because it is small.
- Shapes are DERIVED FROM THE ARTWORK (its silhouette, its measured proportions), never
  invented or eyeballed.
- If a measurement can be taken from the source, TAKE IT. Do not substitute a guess.
- Verify against the 1:1 reference plane before calling a stage done.
- Do not advance a stage until Nathan signs it off.

# THE PROCESS — follow these 8 stages in order. Do not skip. Do not reorder.

**Canonical source:** The Rookies — *Step-by-Step 3D Character Workflow Using Blender and
Substance 3D* (Jorge / orc character).
https://www.therookies.co/blog/breakdowns/step-by-step-3d-character-workflow-using-blender-and-substance-3d-for-beginners

This is THE process. Everything else below is a free-tool substitution or a project note.
Supporting refs: github.com/73K-Y/3D-Workflow-Pipeline (AI-mesh + retopo + rig, single-mesh
only), Blender Studio *Stylized Character Workflow* (body/outfit separation, retopo order),
CG Cookie / Blender Artists (clothing rigging, cloth sim), Unreal + GameDev.net (modular
characters), Arma Reforger (rigid props are bone-parented).

---

## 1. CONCEPT SEARCH
> "Establish creative direction before modeling begins."

- **Have:** the fox-ninja concept art (`source.png`). Kabuki fox mask over a human face,
  green hooded poncho, black pants, green wraps on forearms and shins, bare feet.
- **STATUS: DONE**

## 2. BLOCKING THE BASE
> "This part helped me build a solid base before delving into the details."
> Import the reference image into Blender, block out with basic shapes, adjust proportions
> and silhouette.

- **NO BLOBS. PIXEL-PERFECT CUSTOM 3D SHAPES.**
- **THREE FAILED APPROACHES — never repeat:**
  1. generic capsules -> blobs (a 31cm-thick upper arm)
  2. silhouette extruded front/back with a distance-transform dome -> perfect from the FRONT
     (it IS the front silhouette) but a FLAT LENS from the side. A bas-relief, not a form.
  3. lofted ellipses with an invented depth-to-width ratio -> radially symmetric LAMPSHADE,
     because the poncho's lateral flare made its cross-section equally deep.
  All three failed in the SAME axis: depth was being INVENTED.
- **CORRECT — measure depth, never invent it:**
  - X and Z come from the part's own mask at PIXEL resolution (2px grid = 2.5mm)
  - Y is RAYCAST into the AI high-poly at EVERY grid point (it is real 3D geometry inferred
    from the artwork, aligned 1:1 with it)
  - front + back surfaces are stitched with side walls -> a closed custom solid whose
    outline is the drawing and whose depth is measured geometry
  - colour is SAMPLED from the artwork
- **16 pieces:** poncho, hood, kabuki mask, both ears, both pant legs, both shin wraps, both
  forearm wraps, and every visible skin island (face, hands, feet). ~216k verts total.
- **Scripts:** `make_cutout.py` -> `pose_estimate.py` -> `sam_parts_v2.py` ->
  `step2a_depthmaps.py` -> `step2_blocking.py` -> `qc_blockout.py`
- **GATES PASSED:** height 1.795 vs 1.800 (**0.27%**) · width 0.758 vs 0.759 (**0.16%**) ·
  depth 0.477 MEASURED · raycast coverage **99.48%** (567 misses of 108,035 points)
- **VERIFIED FROM THREE VIEWS** — front matches the reference; the SIDE shows a real head
  profile, muzzle, poncho drape and forward-pointing feet (this is the view that exposed all
  three earlier failures).
- **STATUS: AWAITING SIGN-OFF**

## 3. SCULPTING THE DETAILS
> "Separate each part (body, hair, armour) to manage the complexity."
> High-poly version; research anatomy; add edge wear and detail.

- **Our substitution:** the AI high-poly IS the sculpt (309,666 tris). We do not hand-sculpt.
- **Part separation happens HERE** (their rule), by projecting the SAM masks onto the mesh.
- **Scripts:** `sam_parts_v2.py`, `stage4_separate.py`
- **STATUS: DONE** — 12 parts, symmetric (ears 1494/1503)

## 4. RETOPOLOGY
> "This step is key to optimising the model for animation or games."
> "Pay close attention to edge loops around eyes, mouth, and hands."

- **Our substitution:** Blender REMESH modifier in VOXEL mode (Quadriflow refuses this mesh).
- **Script:** `stage5_retopo.py`
- **STATUS: DONE** — 309,666 tris / 0% quads -> **78,828 faces / 100% quads**, shape within 0.5%

## 5. UVs & BAKING   <<< WE ARE HERE
> "After retopology, I unwrapped the model using Blender and the UV Toolkit add-on. I split
> the model into two UV sets: one for the body, and another for the armour, ensuring good
> distribution for baking and texturing."
> "I exported both the high- and low-poly models in FBX and baked the maps... This gave me
> **normal, AO, and curvature maps, which were key to capturing the sculpted detail on the
> low-res mesh.**"

- **This is the stage that RECOVERS the detail retopology removes.** Skipping it is why the
  low-poly looked flat.
- **Our substitution:** they bake in Substance 3D Painter (paid). We bake in **Blender Cycles**
  (Selected-to-Active, extrusion 0.02-0.05, order Normal -> AO), which is free.
- **UV sets:** they split body / armour. Ours: body / poncho / props.
- **ORDER IS LOAD-BEARING:** baking requires the low-poly and high-poly to be ALIGNED, so this
  MUST run on the A-pose retopo, BEFORE any rigging or T-posing.
- **Script:** `stage8_uv_bake.py`
- **STATUS: IN PROGRESS**

## 6. TEXTURING
> "Use baked maps as foundation. Paint textures staying close to original concept. Maintain
> cartoon, stylised visual approach. Use masks and layers."

- **Our substitution:** no Substance. Colour comes from the concept art (the clean per-part
  cutouts from `sam_parts_v2.py`) projected onto the UVs, layered over the baked normal/AO.
- **STATUS: NOT STARTED**

## 7. RIGGING
> "Start with the human base rig from Rigify. Manually adjust the rig to fit the anatomy.
> Facial bones and hands were the most challenging."

- **Our substitution:** Mixamo `mixamorig` skeleton instead of Rigify, because the downloaded
  Mixamo clips then play NATIVELY. Plus the modular rules the Rookies does not cover:
  - body (pants/shins/wraps/hood merged in) -> skinned normally
  - poncho (loose) -> spine-weighted, and should be CLOTH SIMULATED
  - mask + ears (rigid props) -> BONE-PARENTED to the head, never skinned
- **Scripts:** `stage6b_modular_rig.py`, `stage6c_to_tpose.py`
- **STATUS: PROTOTYPED OUT OF ORDER — must be re-run after stage 6 texturing**

## 8. LIGHTING & RENDERING
> "Simple scene with a base plane. Three-point lighting plus additional lights to enhance
> shapes and materials. Import all textures. Focus on making the character feel alive."
> Render engine: **Blender Cycles**.

- **Our target:** rendered video clips (mp4 + alpha webm) to replace the raid-boss sprites.
- **Script:** `stage7_animate.py` (clip playback), render pass to follow.
- **STATUS: NOT STARTED**

---

# PROJECT NOTES (free-tool substitutions + traps)

**We deliver RENDERED VIDEO, not a realtime game asset.** The "stylised PC 5k-15k tris"
budget from the GitHub pipeline does NOT apply. Retopology here is for DEFORMATION QUALITY,
not polygon reduction. Measured at 1.8m height (all 100% quads):
`voxel 0.022 -> 8,228 faces (detail LOST)` · `0.012 -> 33,466` ·
**`0.008 -> 78,828 (DEFAULT, full detail)`** · `0.006 -> 141,854 (max)`

**Input mask (stage 2)** — each of these produced background geometry:
- `img.convert("RGB")` on an RGBA cutout KEEPS the original background pixels under the
  transparency. Composite onto flat colour: `flat.paste(cut, mask=cut.split()[3])`.
- rembg keeps painted background strokes that TOUCH the character (connected, so island
  filtering cannot remove them) -> intersect with a SAM body region.
- SAM CLIPS thin appendages (fox ears fell to 33% coverage) -> add pose-derived foreground
  prompt points ON them. Target gate: 1 island, 0 dropped verts.

**Part projection (stage 3)** — use the CLEAN cutout bbox, not the raw rembg `char_bbox`
(which still contains strokes; its centre sits ~75px off and dumps a band into "body").
Dilate masks ~5px: the generated garment is thicker than the painted silhouette.

**Retopology (stage 4)** — QUADRIFLOW DOES NOT WORK HERE. It silently no-ops in background
(-b) mode, and with a VIEW_3D context override it CANCELS: "needs to be manifold and have
face normals pointing in a consistent direction". Diagnosed: 0 non-manifold edges, 0
non-manifold verts, but **5 ZERO-AREA faces**; it refuses on degenerates and
`normals_make_consistent` does not help. Use the REMESH modifier in VOXEL mode.

**Weighting (stage 7)** — three attempts, only the third works:
1. auto-weight then DELETE disallowed groups -> vertices with ZERO weight stay pinned at rest
   while neighbours move -> the mesh TEARS
2. nearest-2-bones by inverse distance -> HARD discontinuities, adjacent faces rip apart
   (measured 1,898 boundary edges, poncho shredded)
3. CORRECT: auto-weight (smooth bone-heat), then REDISTRIBUTE each disallowed bone's weight
   onto the allowed bones the vertex already has, normalise, smooth

**Separate only what moves INDEPENDENTLY** — splitting pants/shins/wraps/hood off the body
gained nothing and created ragged seams and gaps. Only the loose poncho and rigid props.

**A-REST vs T-REST** — Mixamo clips store rotations relative to a T-POSE rest. Binding at
A-pose (needed so the skeleton matches the mesh) doubly-rotates every clip and mangles the
mesh. Fix: pose limbs back to T, APPLY the armature modifier per part (bakes mesh to T-pose),
apply pose as rest, re-add modifiers.

**Mixamo/Blender traps**
- The Mixamo FBX ships with a **T-pose ACTION attached**; it re-evaluates on file load and
  OVERWRITES any pose you set. Clear `animation_data` before posing.
- The Mixamo armature has ~0.0088 NON-UNIFORM scale + 90deg X rotation, bones in cm space.
  NEVER `transform_apply(scale)` it. When parenting to it set
  `obj.matrix_parent_inverse = arm.matrix_world.inverted()` or the child shrinks 100x.
- Blender 5.2 actions are LAYERED (no `action.fcurves`): use
  `act.layers[].strips[].channelbag(slot).fcurves`.
- Strip a clip's Hips LOCATION curves or its root motion flings the rig off-world.
- The FBX importer fails in the live Blender MCP context; import in a headless script.

**Character type branches at stage 2**
- clothed humanoid (fox-ninja) -> body is a standard human under clothing
- creature / non-human (stone golem, WolfLink) -> the body IS the character
