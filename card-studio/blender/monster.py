"""Procedural stylized raid-boss monster for the Pride Hunt battle screen.

Builds a low-poly, EPIC/MENACING creature from primitives (bulky rocky body, fanged
head, horns, back spikes, stubby clawed arms, glowing eyes + chest core), rigs a
menacing idle loop, and renders on transparent film so it overlays on the Activity
battle screen. Parametric VARIANTS vary the colour so one system spawns many bosses.

Headless:  blender --background --python monster.py -- <outDir> [frames] [variant]
Live GUI:  blender --python monster.py -- <outDir> [frames] [variant]
Encode:    python encode.py <outDir> <outDir>/monster.webp 0
"""
import bpy
import math
import sys
import os

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "..", "out", "monster")
FRAMES = int(argv[1]) if len(argv) > 1 and argv[1].lstrip("-").isdigit() else 60
VARIANT = argv[2] if len(argv) > 2 else "default"

# Each variant recolours the same creature — a cheap way to many distinct bosses.
VARIANTS = {
    "default": {"body": (0.045, 0.045, 0.06), "accent": (1.0, 0.22, 0.06), "horn": (0.86, 0.80, 0.68)},
    "toxic":   {"body": (0.04, 0.06, 0.045),  "accent": (0.40, 1.0, 0.25),  "horn": (0.80, 0.85, 0.70)},
    "frost":   {"body": (0.05, 0.06, 0.08),   "accent": (0.35, 0.80, 1.0),  "horn": (0.85, 0.92, 1.0)},
    "void":    {"body": (0.05, 0.04, 0.07),   "accent": (0.70, 0.30, 1.0),  "horn": (0.80, 0.75, 0.90)},
}
P = VARIANTS.get(VARIANT, VARIANTS["default"])

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = cand
        break
    except TypeError:
        continue
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.frame_start = 1
scene.frame_end = FRAMES

world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
wbg = world.node_tree.nodes.get("Background")
wbg.inputs[0].default_value = (0.02, 0.02, 0.03, 1.0)
wbg.inputs[1].default_value = 0.6


def mat(name, color, rough=0.55, metallic=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    return m


def emis(name, color, strength=7.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Emission Color"].default_value = (*color, 1.0)
    b.inputs["Emission Strength"].default_value = strength
    return m


body_mat = mat("Body", P["body"], rough=0.5)
_nt = body_mat.node_tree
_noise = _nt.nodes.new("ShaderNodeTexNoise"); _noise.inputs["Scale"].default_value = 3.5; _noise.inputs["Detail"].default_value = 6.0
_bump = _nt.nodes.new("ShaderNodeBump"); _bump.inputs["Strength"].default_value = 0.35
_nt.links.new(_noise.outputs["Fac"], _bump.inputs["Height"])
_nt.links.new(_bump.outputs["Normal"], _nt.nodes.get("Principled BSDF").inputs["Normal"])

horn_mat = mat("Horn", P["horn"], rough=0.4)
accent_mat = emis("Accent", P["accent"], 7.0)
claw_mat = mat("Claw", (0.02, 0.02, 0.03), rough=0.3)

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.active_object; root.name = "Root"


def part(kind, loc, scale=(1, 1, 1), rot=(0, 0, 0), material=None, **kw):
    if kind == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.get("sub", 3), radius=kw.get("r", 1.0), location=loc)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(radius1=kw.get("r1", 0.3), radius2=kw.get("r2", 0.0), depth=kw.get("d", 1.0), vertices=kw.get("v", 16), location=loc)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(radius=kw.get("r", 0.2), depth=kw.get("d", 1.0), vertices=kw.get("v", 16), location=loc)
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = rot
    if material:
        o.data.materials.append(material)
    for pg in o.data.polygons:
        pg.use_smooth = True
    o.parent = root
    return o


body = part("ico", (0, 0, 0.95), scale=(1.35, 1.05, 1.0), material=body_mat, sub=4, r=1.0)
head = part("ico", (0, -0.55, 1.75), scale=(0.92, 0.95, 0.82), material=body_mat, sub=4, r=0.72)
part("ico", (0.3, -1.02, 1.9), scale=(1, 0.7, 1), material=accent_mat, sub=2, r=0.12)   # eye R
part("ico", (-0.3, -1.02, 1.9), scale=(1, 0.7, 1), material=accent_mat, sub=2, r=0.12)  # eye L
part("ico", (0, -0.95, 1.15), material=accent_mat, sub=3, r=0.26)                        # chest core
part("cone", (0.4, -0.3, 2.25), rot=(math.radians(-30), 0, math.radians(12)), material=horn_mat, r1=0.16, r2=0, d=0.95, v=12)
part("cone", (-0.4, -0.3, 2.25), rot=(math.radians(-30), 0, math.radians(-12)), material=horn_mat, r1=0.16, r2=0, d=0.95, v=12)
for x in (-0.5, 0.0, 0.5):
    part("cone", (x, 0.62, 1.95 - abs(x) * 0.22), rot=(math.radians(22), 0, 0), material=horn_mat, r1=0.12, r2=0, d=0.7, v=10)
part("cyl", (1.15, -0.2, 1.0), rot=(math.radians(20), 0, math.radians(28)), material=body_mat, r=0.26, d=1.15, v=14)
part("cyl", (-1.15, -0.2, 1.0), rot=(math.radians(20), 0, math.radians(-28)), material=body_mat, r=0.26, d=1.15, v=14)
for side in (1, -1):
    for off in (-0.16, 0.0, 0.16):
        part("cone", (side * 1.48 + off, -0.78, 0.5), rot=(math.radians(70), 0, 0), material=claw_mat, r1=0.06, r2=0, d=0.3, v=8)
part("ico", (0.6, -0.5, 0.18), scale=(1, 1.3, 0.6), material=body_mat, sub=3, r=0.42)
part("ico", (-0.6, -0.5, 0.18), scale=(1, 1.3, 0.6), material=body_mat, sub=3, r=0.42)


def key(obj, f, loc=None, rot=None, scale=None):
    if loc is not None:
        obj.location = loc; obj.keyframe_insert("location", frame=f)
    if rot is not None:
        obj.rotation_euler = rot; obj.keyframe_insert("rotation_euler", frame=f)
    if scale is not None:
        obj.scale = scale; obj.keyframe_insert("scale", frame=f)


q = FRAMES
key(root, 1, loc=(0, 0, 0), rot=(0, 0, math.radians(-1.6)))
key(root, q // 4, loc=(0, 0, 0.07))
key(root, q // 2, loc=(0, 0, 0), rot=(0, 0, math.radians(1.6)))
key(root, 3 * q // 4, loc=(0, 0, -0.04))
key(root, q, loc=(0, 0, 0), rot=(0, 0, math.radians(-1.6)))
key(body, 1, scale=(1.35, 1.05, 1.0))
key(body, q // 2, scale=(1.40, 1.08, 1.03))
key(body, q, scale=(1.35, 1.05, 1.0))
key(head, 1, loc=(0, -0.55, 1.75))
key(head, q // 2, loc=(0, -0.63, 1.72))
key(head, q, loc=(0, -0.55, 1.75))

cam_data = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam.location = (0, -6.2, 1.35)
cam.rotation_euler = (math.radians(80), 0, 0)
cam_data.lens = 62


def area(name, loc, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.size = size; ld.color = color
    o = bpy.data.objects.new(name, ld); o.location = loc
    scene.collection.objects.link(o)
    o.constraints.new("TRACK_TO").target = body
    return o


area("Rim", (-2.5, 4.0, 4.0), 900, 3, (0.70, 0.80, 1.0))
area("Key", (3.5, -3.0, 2.5), 420, 3, (1.0, 0.85, 0.70))
area("Fill", (-3.0, -3.0, 0.5), 80, 6)

if bpy.app.background:
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(OUT_DIR, "f_")
    bpy.ops.render.render(animation=True)
    print("RENDERED", FRAMES, "->", OUT_DIR)
else:
    scene.render.fps = 24
    scene.frame_set(1)
    for a in bpy.context.screen.areas:
        if a.type == "VIEW_3D":
            for s in a.spaces:
                if s.type == "VIEW_3D":
                    s.shading.type = "RENDERED"
                    s.region_3d.view_perspective = "CAMERA"
    try:
        bpy.ops.screen.animation_play()
    except Exception:
        pass
    print("GUI READY")
