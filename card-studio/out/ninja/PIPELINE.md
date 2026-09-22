# Character pipeline — the researched, correct process
Follow in order. Do not skip stages. Do not chase detail before its stage.

## Sources
- **Blender Studio — Stylized Character Workflow** (Blender Animation Studio) — AUTHORITATIVE
  for our case (stylized, body + outfit). studio.blender.org/training/stylized-character-workflow/
- github.com/73K-Y/3D-Workflow-Pipeline — AI-mesh → retopo → rig. NOTE: single-mesh only;
  it does **not** cover modular characters (clothing/props). Do not follow it blindly here.
- therookies.co step-by-step breakdown — separates parts at the sculpt stage.
- CG Cookie / Blender Artists — clothing rigging + cloth sim.
- GameDev.net + Unreal modular-character docs — modular/swappable parts.
- Arma Reforger gear docs / MoCap Online — rigid props attach by bone parenting.

## 0. Branch on CHARACTER TYPE first
- **Clothed humanoid** (fox-ninja): body is a standard human under clothing → use a
  retopologised humanoid base; the render supplies GARMENTS + PROPS.
- **Creature / non-human** (stone golem, WolfLink): the body IS the character → generate and
  retopologise the body itself. No garment derivation.

## 1. Reference
Concept art gathered. Load it into Blender as a **1:1 reference plane** and work against it.
Blocking and proportion decisions are made visually against this, not from pixel math.

## 2. Generate (AI) — REFERENCE ONLY
Whole character, image-to-3D, refine/high settings.
> "The AI mesh is triangle soup. A sculpt reference, **not a production mesh**.
> Never use it directly. Never skip retopology."

**Input mask is critical** (each of these produced background geometry):
- `img.convert("RGB")` on an RGBA cutout KEEPS the original background pixels under the
  transparency → composite onto flat colour: `flat.paste(cut, mask=cut.split()[3])`.
- rembg keeps painted background strokes that TOUCH the character (connected → island
  filtering cannot remove them) → intersect with a **SAM** body region.
- SAM **clips thin appendages** (fox ears fell to 33% coverage) → add pose-derived foreground
  prompt points ON them. Target gate: **1 island, 0 dropped verts**.

## 3. Import & prep — QUALITY GATES
Apply ALL transforms. Gates: normals correct · scale = 1,1,1 · proportions match the
reference plane · no floating/fused background geometry · confirm tri/quad makeup.

## 4. SEPARATE INTO PARTS  ← the modular step
> Rookies: "I separated each part (**body, hair, armour**) to manage the complexity."
> Blender Studio: body and clothing are **separate objects**; sculpt the body first, then
> create clothing basemeshes that sit on top.

Our parts: body · poncho · hood · pants · wraps · fox mask · ears.

## 5. Retopology — ORDER: head → body → hair → clothing
- Quads only in deformation zones. ≥3 edge loops at elbow/knee/shoulder, ≥2 at wrist.
  No poles at stress points. Follow surface curvature.
- **Clothes are retopologised separately**, and:
  > "The clothes are **mostly copies of the underlying body** but with different edge flow
  > where the geometry is different (shoulders) and where I modeled in wrinkles."
  This is exactly the derive-from-body method — it also inherits the body's weights.
- Stylized poly density: prioritise **clean topology for rigging**, not minimum polycount.

## 6. STYLIZED DETAIL RULE (corrects the naive "all detail goes to maps")
> "I definitely wanted to **hard-model the wrinkles** to not rely on any displacement or
> normal maps, since they are already very stylised & big elements."
- **Big stylised forms (major folds, poncho hem, cuffs) → MODEL them in the geometry.**
- **Fine surface detail (fabric weave, scratches, pores) → BAKE to normal/AO maps.**

## 7. UV unwrap — per part
Unwrap **each mesh separately** (body, clothes, mask, ears); shells clean and unstacked.

## 8. Bake high → low
Normal / AO / curvature from the high-poly onto the clean low-poly. Cycles, Selected-to-Active,
extrusion 0.02–0.05. Bake order: Normal → Diffuse → Roughness.

## 9. Texture
Paint on the baked maps. Colour comes from the concept art.

## 10. Rig + attach — BY PART CATEGORY
| Category | Examples | Build | Attach |
|---|---|---|---|
| Body | base mesh | retopologised quads | skinned to full skeleton |
| Conforming garment | pants, wraps, hood | **derived from body surface** | inherits body weights |
| Loose cloth | poncho, cape | separate panel | **simulate resting shape, then skin it** |
| Rigid prop | fox mask, weapons | own object, any topology | **bone-parent (Ctrl+P → Bone)** |

> "Colliders and rigid props **don't support skinning and have to be parented to bone**."
> Soft/deformable accessories use skinning with weight painting.

- Separately-modelled garments: **Data Transfer → "Nearest Face Interpolated"** copies body
  weights onto the garment.
- **Simulate cloth in a NATURAL pose (arms down), never T-pose** — in T-pose the cloth tents
  over outstretched arms (measured 1.70 m wide).
- Weight a poncho to the **spine only** so the arms move freely underneath.
- A poncho is a SQUARE worn as a diamond (point at front). Flat-pattern radius must equal the
  **drape length**; sizing from shoulder width makes it too short to hang.
- Weight-paint problem zones (always need manual fixing): shoulders, groin, wrists, knees, neck.
- "Landmarks" = places where separate objects touch and must move together.
- Keep the underlying body model for animation (do not delete body under clothes if it deforms).

## 11. Export / animate
Axis per target engine. Mixamo clips play natively on a `mixamorig` skeleton.

## Blender / Mixamo traps (each cost a debugging loop)
- The Mixamo armature is a native Mixamo object: ~0.0088 NON-UNIFORM scale + 90° X rotation,
  bones in cm space. **Never `transform_apply(scale)`** on it (teleports the rest pose).
- Parenting anything to it requires `obj.matrix_parent_inverse = arm.matrix_world.inverted()`
  or the child shrinks 100×.
- Blender 5.2 actions are LAYERED — no `action.fcurves`. Use
  `act.layers[].strips[].channelbag(slot).fcurves`.
- Strip a clip's Hips **location** curves or its root motion (authored in the source rig's cm
  units) flings the rig off-world.
- The FBX importer fails in the live Blender MCP context ("mode_set poll: Context missing
  active object") — import in a headless script, then open the result.
- The Mixamo X Bot body is a free, already-retopologised base: 14,222 faces, **98.8% quads**,
  proper edge loops. Excellent retopo target for clothed humanoids.

## Project status (fox-ninja)
- [x] 1 Reference plane at 1:1
- [x] 2 Generate — clean high-poly (gate: 1 island, 0 dropped verts; W 0.839 D 0.482 H 1.809)
- [x] 3 Import & prep — all gates pass (309,666 tris, 0 quads = retopo required)
- [ ] 4 Separate into parts   <-- NEXT
- [ ] 5 Retopology (head → body → hair → clothing)
- [ ] 6 Model stylised folds
- [ ] 7 UV per part
- [ ] 8 Bake high→low
- [ ] 9 Texture
- [ ] 10 Rig + attach by category
- [ ] 11 Export / animate
