"""Render a looping shimmer for a rarity finish as a PNG frame sequence.

The card rocks a few degrees so the reflections sweep. Start and end poses match
for a seamless loop.

Run:
  blender --background --python blender/anim_card.py -- <rarity>
where <rarity> is one of: gold, full_art, secret_rare.
"""
import bpy
import math
import os
import sys

argv = sys.argv
rarity = argv[argv.index("--") + 1] if "--" in argv else "gold"

# Per-rarity material treatment.
PRESETS = {
    "gold": {"color": (1.00, 0.78, 0.30, 1), "metallic": 1.0, "rough": 0.22},
    "full_art": {"color": (0.95, 0.35, 0.75, 1), "metallic": 0.7, "rough": 0.14},
    "secret_rare": {"color": (0.55, 0.36, 0.95, 1), "metallic": 0.9, "rough": 0.20},
}
preset = PRESETS[rarity]

OUTDIR = rf"C:\Users\vaugh\discord\tcg-bot\blender\out\frames_{rarity}"
os.makedirs(OUTDIR, exist_ok=True)

scene = bpy.context.scene

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 360
scene.render.resolution_y = 480
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.05, 0.06, 0.10, 1.0)
bg.inputs[1].default_value = 0.5

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
card = bpy.context.active_object
card.scale = (1.25, 0.03, 1.75)
bevel = card.modifiers.new("Bevel", "BEVEL")
bevel.width = 0.03
bevel.segments = 3
bpy.ops.object.shade_smooth()

mat = bpy.data.materials.new("Finish")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = preset["color"]
bsdf.inputs["Metallic"].default_value = preset["metallic"]
bsdf.inputs["Roughness"].default_value = preset["rough"]
card.data.materials.append(mat)


def key(frame, z_deg):
    card.rotation_euler = (math.radians(8), 0.0, math.radians(z_deg))
    card.keyframe_insert("rotation_euler", frame=frame)


key(1, -22)
key(12, -14)
key(24, -22)
scene.frame_start = 1
scene.frame_end = 24

target = bpy.data.objects.new("Target", None)
bpy.context.collection.objects.link(target)


def add_area(name, location, energy, size):
    bpy.ops.object.light_add(type="AREA", location=location)
    lamp = bpy.context.active_object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.size = size
    lamp.constraints.new("TRACK_TO").target = target


add_area("Key", (3.5, -4.0, 4.0), 5000, 5.0)
add_area("Fill", (-3.5, -4.0, 1.5), 1500, 6.0)
add_area("Rim", (0.0, 3.5, 3.5), 4000, 4.0)

bpy.ops.object.camera_add(location=(0.0, -6.0, 1.0))
cam = bpy.context.active_object
cam.constraints.new("TRACK_TO").target = target
scene.camera = cam

scene.render.filepath = os.path.join(OUTDIR, "f_")
bpy.ops.render.render(animation=True)
print(f"FRAMES SAVED ({rarity}):", OUTDIR)
