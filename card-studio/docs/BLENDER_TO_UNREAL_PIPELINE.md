# Blender to Unreal Pipeline — top-tier animated characters

This document is the repeatable process for high-quality animated characters. The goal is a
"big game studio" result that scales across many projects. The tooling is reusable, not one
model at a time.

## The thesis

Get the rig right first. A correct skeleton has the right weights, motion, limits, and
interactions. Then put any character on top of that skeleton. The appearance is a layer.
The motion foundation is permanent.

## The two-stage model — make it in Blender, animate it in Unreal

Blender and Unreal are not competitors. Each owns a stage.

**Blender is the creation tool.**
- Model, sculpt, retopologize, and unwrap.
- Rig creatures with Rigify. No MetaHuman exists for animals.
- Author corrective shapes and custom deformation.

**Unreal Engine 5 is the character, animation, and render home.**
- MetaHuman gives the correct human skeleton with perfect weights and face controls.
- Control Rig and the IK Retargeter put any motion on any character.
- Sequencer, Lumen, and Nanite give the studio look.

Rule of thumb: create in Blender, and light and animate in Unreal.

## The standard — one skeleton per body plan

Build one rig per body plan. Examples: biped, quadruped, bird, serpent, spider. Retarget
every animation onto that standard skeleton. A motion library and swappable meshes then
reuse across all future characters. This standard is the scale lever.

- Humanoids use the Unreal MetaHuman skeleton.
- Creatures use our Rigify body-plan skeletons from `blender/bodyplans.py`.

## Humanoid pipeline — MetaHuman

MetaHuman is the thesis, already solved by Epic. Do not rebuild the human rig.

1. Open the Epic Launcher. Install the MetaHuman plugin for Unreal Engine 5.8.
2. Create a MetaHuman two ways:
   - Design one in MetaHuman Creator (face and body sliders).
   - Convert a sculpt or a scan with Mesh to MetaHuman.
3. Import the MetaHuman into an Unreal Engine 5.8 project through Quixel Bridge.
4. Animate the MetaHuman:
   - Retarget a motion clip with the IK Retargeter.
   - Hand-key with Control Rig in Sequencer.
5. Render with Movie Render Queue. Enable Lumen and Nanite for the studio look.

"Put any image on top" for a face uses Mesh to MetaHuman. The tool fits the MetaHuman rig
to any head mesh. The body customizes with the MetaHuman controls.

## Creature pipeline — Blender to Unreal

Animals have no MetaHuman. Build and rig them in Blender, then finish in Unreal.

1. Generate or sculpt the mesh. Hunyuan3D produces a clean creature mesh from one image.
2. Retopologize to clean topology. Bake the high detail to a normal map.
3. Fit and generate the Rigify body-plan rig. See `blender/rig_rigify.py` and
   `blender/bodyplans.py`.
4. Skin the mesh. Add preserve volume, corrective smooth, and range-of-motion limits.
5. Export FBX for Unreal. Use the export settings below.
6. Import the FBX into Unreal as a Skeletal Mesh.
7. Build an IK Rig for the creature skeleton. Build an IK Retargeter to a source rig.
8. Retarget a motion clip, or hand-key with Control Rig in Sequencer.
9. Render with Movie Render Queue.

### Blender FBX export settings for Unreal

- Select the armature and the mesh only.
- Apply the scale so one Blender meter equals Unreal units correctly.
- Set the primary bone axis to Y and the secondary bone axis to X.
- Disable add leaf bones.
- Export the mesh and the armature. Bake actions if the file has animation.

The helper `blender/export_unreal.py` writes an FBX with these settings.

## Motion sources — the largest quality lever

Motion capture plus polish is most of the studio feel. Use these sources:

- Move.ai captures motion from ordinary video. No suit is needed.
- Rokoko captures motion from a wearable suit.
- Mixamo gives free humanoid clips for fast tests.
- Cascadeur builds action keyframes with physics assistance.

Retarget every clip onto the standard skeleton. Then the clip reuses on any character.

## Surfacing — detail as maps, not geometry

Studios keep high detail in textures, not in polygons. This keeps the mesh light.

- Sculpt the high detail. Bake it to a normal map.
- Paint physically based materials in Substance Painter.
- Import the maps into Unreal. Nanite renders dense geometry when the mesh needs it.

## Rendering — the studio look in Unreal

- Assemble the shot in Sequencer.
- Enable Lumen for global illumination and reflections.
- Enable Nanite for dense geometry.
- Render with Movie Render Queue for final frames.

## Per-character checklist

- The mesh has clean topology and a normal map.
- The rig matches the standard skeleton for its body plan.
- The weights, correctives, and range-of-motion limits are correct.
- The FBX imports into Unreal with the correct scale and bone axes.
- The IK Retargeter maps the standard motion onto the character.
- The shot renders with Lumen, Nanite, and Movie Render Queue.

## Where the Blender modules fit

- `blender/bodyplans.py` — the body-plan registry and the skeleton standard.
- `blender/rig_rigify.py` — fit and generate the Rigify rig.
- `blender/joint_spec.py` — bake the range-of-motion limits.
- `blender/export_unreal.py` — export an FBX ready for Unreal.
- `docs/ANATOMY_FOUNDATION.md` — the rig and deformation foundation.
- `docs/ANIMATION_CRAFT.md` — timing, weight, and arcs for any subject.
