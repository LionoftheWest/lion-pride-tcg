"""Proof render: a gold card, built and rendered entirely from script (headless).

Run:
  blender --background --python blender/proof_card.py
"""
import bpy
import math
import os

OUT = r"C:\Users\vaugh\discord\tcg-bot\blender\out\proof.png"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

scene = bpy.context.scene

# --- Clean the default scene ---
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

# --- Render settings (Cycles CPU is reliable headless) ---
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.render.resolution_x = 640
scene.render.resolution_y = 800
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "Standard"

# --- World: a soft dark backdrop ---
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (0.05, 0.06, 0.10, 1.0)
bg.inputs[1].default_value = 0.5

# --- Card mesh: a thin, bevelled card at a dynamic angle ---
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
card = bpy.context.active_object
card.scale = (1.25, 0.03, 1.75)
card.rotation_euler = (math.radians(8), 0.0, math.radians(-18))
bevel = card.modifiers.new("Bevel", "BEVEL")
bevel.width = 0.03
bevel.segments = 3
bpy.ops.object.shade_smooth()

# --- Gold material ---
mat = bpy.data.materials.new("Gold")
mat.use_nodes = True
bsdf = mat.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Base Color"].default_value = (1.0, 0.78, 0.30, 1.0)
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.28
card.data.materials.append(mat)

# --- Aim target at the origin ---
target = bpy.data.objects.new("Target", None)
bpy.context.collection.objects.link(target)


def add_area(name, location, energy, size):
    bpy.ops.object.light_add(type="AREA", location=location)
    lamp = bpy.context.active_object
    lamp.name = name
    lamp.data.energy = energy
    lamp.data.size = size
    lamp.constraints.new("TRACK_TO").target = target
    return lamp


# A three-point studio rig gives metal bright sources to reflect.
add_area("Key", (3.5, -4.0, 4.0), 5000, 5.0)   # main
add_area("Fill", (-3.5, -4.0, 1.5), 1500, 6.0)  # soften shadows
add_area("Rim", (0.0, 3.5, 3.5), 4000, 4.0)     # edge highlight from behind

# --- Camera ---
bpy.ops.object.camera_add(location=(0.0, -6.0, 1.0))
cam = bpy.context.active_object
cam.constraints.new("TRACK_TO").target = target
scene.camera = cam

# --- Render ---
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print("SAVED:", OUT)
