"""Double-sided card showcase: a front tier + the shared lion back on ONE card
that spins, so both sides show.

GUI (live spin):
  blender --python showcase.py -- <frontFace> <rarity> <mask|-> <backFace>
Headless (front+back still to <outPng>):
  blender --background --python showcase.py -- <frontFace> <rarity> <mask|-> <backFace> <outPng>
"""
import bpy
import os
import sys
import math

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import card_scene  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
FRONT = argv[0]
RARITY = argv[1]
MASK = None if (len(argv) < 3 or argv[2] in ("-", "")) else argv[2]
BACK = argv[3]
OUT = argv[4] if len(argv) > 4 else None

# Build the front (with all its tier effects), then attach the back + a spin.
card_scene.build(FRONT, RARITY, engine="BLENDER_EEVEE_NEXT", mask_path=MASK)
scene = bpy.context.scene
card = bpy.data.objects["Card"]
pivot = bpy.data.objects["Pivot"]

# Back plane: same size, normal faces +Y (away at start). UVs mirrored on X so
# the back reads correctly once the card has spun 180 degrees to face the camera.
mesh = bpy.data.meshes.new("Back")
mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
mesh.update()
# UVs mirror on X (so it reads correctly after the 180-degree turn) AND flip on
# V (so the crest is right-side up, not upside down).
uv = mesh.uv_layers.new(name="UV").data
for i, coord in enumerate([(1, 1), (0, 1), (0, 0), (1, 0)]):
    uv[i].uv = coord
back = bpy.data.objects.new("Back", mesh)
scene.collection.objects.link(back)
back.scale = card.scale
back.rotation_euler = (math.radians(-90), 0, 0)
back.location = (0, 0.004, 0)  # nearly flush with the front: one thin card, no gap
back.parent = pivot

bmat = bpy.data.materials.new("BackMat")
bmat.use_nodes = True
back.data.materials.append(bmat)
bnt = bmat.node_tree
bbsdf = bnt.nodes.get("Principled BSDF")
bbsdf.inputs["Metallic"].default_value = 0.0
bbsdf.inputs["Roughness"].default_value = 1.0
btex = bnt.nodes.new("ShaderNodeTexImage")
btex.image = bpy.data.images.load(BACK)
bnt.links.new(btex.outputs["Color"], bbsdf.inputs["Base Color"])
bnt.links.new(btex.outputs["Color"], bbsdf.inputs["Emission Color"])
bbsdf.inputs["Emission Strength"].default_value = 1.0
bnt.links.new(btex.outputs["Alpha"], bbsdf.inputs["Alpha"])

# Replace the rock with a smooth turntable spin so both sides come around.
# New keys get LINEAR interpolation for a constant-speed turn (Blender 5.x
# slotted actions dropped action.fcurves, so set it at insert time).
try:
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
except Exception:
    pass
pivot.animation_data_clear()
for frame, rz in [(1, 0), (60, 360)]:
    pivot.rotation_euler = (0, 0, math.radians(rz))
    pivot.keyframe_insert("rotation_euler", frame=frame)
scene.frame_start = 1
scene.frame_end = 60

if OUT and bpy.app.background:
    # Render a clean front (frame 1) and a clean back (frame ~180 deg), then
    # place them side by side into one still.
    tmp = os.path.join(os.path.dirname(OUT), "_showcase_tmp")
    os.makedirs(tmp, exist_ok=True)
    shots = {}
    for label, frame in (("front", 1), ("back", 31)):
        scene.frame_set(frame)
        p = os.path.join(tmp, label + ".png")
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        shots[label] = p
    try:
        from PIL import Image
        f = Image.open(shots["front"]).convert("RGBA")
        b = Image.open(shots["back"]).convert("RGBA")
        gap = 40
        w = f.width + gap + b.width
        h = max(f.height, b.height)
        canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        canvas.paste(f, (0, (h - f.height) // 2), f)
        canvas.paste(b, (f.width + gap, (h - b.height) // 2), b)
        canvas.save(OUT)
        print("WROTE " + OUT)
    except Exception as e:
        print("compose failed, stills in " + tmp + " : " + str(e))
else:
    scene.frame_set(1)
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "RENDERED"
                    space.region_3d.view_perspective = "CAMERA"
    print("SHOWCASE READY - press Space to spin the card")
