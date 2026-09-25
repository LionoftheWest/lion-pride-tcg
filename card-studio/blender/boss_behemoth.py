"""High-quality Pride Hunt raid boss — THE BEHEMOTH (Hercules-style rock titan).

Built in Blender for far higher fidelity than the real-time Three.js version:
- a craggy displaced-rock body (Subsurf + Displace) instead of flat facets,
- layered stone plating, big rock shoulders, fists, legs, a fan of back shards,
- glowing lava eyes / mouth / chest core / limb veins (emissive),
- dramatic three-point lighting on a transparent film for compositing.

Still:   blender --background --python boss_behemoth.py -- <outDir> still
Anim:    blender --background --python boss_behemoth.py -- <outDir> <state> <frames>
         states: idle hit stun attack spawn defeat
"""
import bpy, math, os, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "..", "out", "behemoth")
MODE = argv[1] if len(argv) > 1 else "still"
FRAMES = int(argv[2]) if len(argv) > 2 and argv[2].lstrip("-").isdigit() else 1

# ---- clean scene ----
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = cand; break
    except TypeError:
        continue
scene.render.resolution_x = 760
scene.render.resolution_y = 940
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
try:
    scene.eevee.taa_render_samples = 48
except Exception:
    pass
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
_wb = world.node_tree.nodes.get("Background")
_wb.inputs[0].default_value = (0.02, 0.02, 0.03, 1.0)
_wb.inputs[1].default_value = 0.35

# ---- materials ----
def rock_mat(name, color, rough=0.92):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    # noise-driven bump for stone grain
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 6.0
    noise.inputs["Detail"].default_value = 8.0
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.5
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # subtle darker crevices via color ramp on the noise into base color mix
    return m

def lava_mat(name, color=(1.0, 0.22, 0.03), strength=7.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Emission Color"].default_value = (*color, 1.0)
    b.inputs["Emission Strength"].default_value = strength
    b.inputs["Roughness"].default_value = 0.4
    # subtle darker crust veining over the glow
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 9.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.4; ramp.color_ramp.elements[0].color = (0.55, 0.06, 0.0, 1)
    ramp.color_ramp.elements[1].position = 0.72; ramp.color_ramp.elements[1].color = (1.0, 0.42, 0.06, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Emission Color"])
    return m

ROCK = rock_mat("Rock", (0.052, 0.05, 0.06))
ROCK_DK = rock_mat("RockDk", (0.028, 0.026, 0.032), rough=0.96)
LAVA = lava_mat("Lava")

bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
root = bpy.context.active_object; root.name = "Root"

def add(kind, loc, scale=(1, 1, 1), rot=(0, 0, 0), material=None, **kw):
    if kind == "ico":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kw.get("sub", 3), radius=kw.get("r", 1.0), location=loc)
    elif kind == "cone":
        bpy.ops.mesh.primitive_cone_add(radius1=kw.get("r1", 0.3), radius2=kw.get("r2", 0.0), depth=kw.get("d", 1.0), vertices=kw.get("v", 8), location=loc)
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(radius=kw.get("r", 0.2), depth=kw.get("d", 1.0), vertices=kw.get("v", 14), location=loc)
    elif kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=kw.get("size", 1.0), location=loc)
    o = bpy.context.active_object
    o.scale = scale; o.rotation_euler = rot
    if material:
        o.data.materials.append(material)
    for pg in o.data.polygons:
        pg.use_smooth = True
    o.parent = root
    return o

def craggy(o, strength=0.22, sub=2, scale=0.4):
    s = o.modifiers.new("sub", "SUBSURF"); s.levels = sub; s.render_levels = sub
    tex = bpy.data.textures.new(o.name + "disp", "CLOUDS")
    tex.noise_scale = scale; tex.noise_depth = 4
    d = o.modifiers.new("disp", "DISPLACE"); d.texture = tex; d.strength = strength; d.mid_level = 0.42
    return o

# ---- BODY (hulking, hunched, craggy) — a tapered massive torso, not a ball ----
body = add("ico", (0, 0.05, 1.6), scale=(1.42, 1.0, 1.02), material=ROCK, sub=4, r=1.05); craggy(body, 0.3, 2, 0.5)
belly = add("ico", (0, 0.42, 0.9), scale=(1.1, 0.82, 0.9), material=ROCK, sub=4, r=0.72); craggy(belly, 0.2, 2, 0.6)
# broad shoulder / trapezius mass rising toward the neck
add("ico", (0, -0.1, 2.25), scale=(1.55, 0.95, 0.62), material=ROCK, sub=3, r=0.72);
for (px, pz, sc) in [(0.55, 1.5, 0.42), (-0.55, 1.5, 0.42), (0.0, 1.2, 0.46)]:
    add("ico", (px, -0.78, pz), scale=(sc*1.4, 0.4, sc), material=ROCK_DK, sub=2, r=0.5)

# ---- NECK + DISTINCT HEAD (blocky, beveled, lava face) high on the shoulders ----
add("cyl", (0, -0.12, 2.4), rot=(math.radians(6), 0, 0), material=ROCK, r=0.34, d=0.55, v=12)
head = add("cube", (0, -0.35, 2.92), scale=(0.6, 0.56, 0.54), material=ROCK, size=1.0)
bev = head.modifiers.new("bev", "BEVEL"); bev.width = 0.12; bev.segments = 2
add("cube", (0, -0.66, 3.14), scale=(0.64, 0.16, 0.12), rot=(math.radians(-14), 0, 0), material=ROCK_DK, size=1.0)  # brow
add("ico", (0.24, -0.82, 2.96), scale=(1.2, 0.7, 0.6), material=LAVA, sub=3, r=0.12)   # eye R
add("ico", (-0.24, -0.82, 2.96), scale=(1.2, 0.7, 0.6), material=LAVA, sub=3, r=0.12)  # eye L
add("cube", (0, -0.8, 2.62), scale=(0.36, 0.1, 0.09), material=LAVA, size=1.0)          # mouth
add("cone", (0.34, -0.18, 3.36), rot=(math.radians(-24), 0, math.radians(16)), material=ROCK_DK, r1=0.11, r2=0, d=0.62, v=8)
add("cone", (-0.34, -0.18, 3.36), rot=(math.radians(-24), 0, math.radians(-16)), material=ROCK_DK, r1=0.11, r2=0, d=0.62, v=8)

# ---- CHEST CORE + lava cracks ----
add("ico", (0, -0.98, 1.55), scale=(1.0, 0.7, 1.3), material=LAVA, sub=3, r=0.24)       # chest core
add("cube", (0, -0.74, 1.25), scale=(0.5, 0.06, 0.1), material=LAVA, size=1.0)
add("cube", (0, -0.74, 1.55), scale=(0.08, 0.06, 0.42), material=LAVA, size=1.0)

# ---- SHOULDERS + long two-segment ARMS to huge FISTS (lava knuckles) ----
for s in (1, -1):
    add("ico", (s*1.5, -0.1, 2.12), scale=(1.05, 0.98, 1.0), material=ROCK, sub=3, r=0.66)
    add("cyl", (s*1.64, -0.12, 1.32), rot=(0, 0, math.radians(s*15)), material=ROCK, r=0.33, d=1.15, v=14)   # upper arm
    add("cyl", (s*1.8, -0.28, 0.55), rot=(math.radians(10), 0, math.radians(s*6)), material=ROCK, r=0.3, d=1.05, v=14)  # forearm
    fist = add("ico", (s*1.84, -0.42, -0.05), scale=(1.12, 1.02, 1.12), material=ROCK, sub=3, r=0.5); craggy(fist, 0.16, 1, 0.7)
    for off in (-0.16, 0.0, 0.16):
        add("ico", (s*1.84 + off, -0.86, 0.02), scale=(1, 1, 0.7), material=LAVA, sub=2, r=0.05)

# ---- LEGS + FEET ----
for s in (1, -1):
    add("cyl", (s*0.55, 0.1, 0.55), rot=(0, 0, math.radians(s*4)), material=ROCK, r=0.34, d=1.2, v=14)
    foot = add("ico", (s*0.55, -0.35, -0.05), scale=(1.3, 1.5, 0.8), material=ROCK_DK, sub=3, r=0.4); craggy(foot, 0.14, 1, 0.8)

# ---- BACK SHARDS (fan up-and-back) ----
shards = [(0.0, 3.1, 0.55, 0.34), (0.5, 2.95, 0.5, 0.28), (-0.5, 2.95, 0.5, 0.28),
          (0.95, 2.55, 0.6, 0.26), (-0.95, 2.55, 0.6, 0.26), (1.3, 2.1, 0.7, 0.22), (-1.3, 2.1, 0.7, 0.22)]
for (x, z, ry, r) in shards:
    c = add("cone", (x, 0.95, z), rot=(math.radians(28), 0, math.radians(-x*10)), material=ROCK_DK, r1=r, r2=0, d=1.5, v=7)

# ---- lights (dramatic three-point) ----
def area(name, loc, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.size = size; ld.color = color
    o = bpy.data.objects.new(name, ld); o.location = loc
    scene.collection.objects.link(o)
    o.constraints.new("TRACK_TO").target = body
    return o
area("Rim", (-3.0, 4.2, 4.5), 1400, 4, (0.62, 0.74, 1.0))
area("Key", (4.0, -3.2, 3.0), 620, 3.5, (1.0, 0.82, 0.62))
area("Fill", (-3.4, -3.2, 0.6), 120, 6, (0.9, 0.7, 0.8))

# ---- camera ----
cam_data = bpy.data.cameras.new("Cam"); cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam); scene.camera = cam
cam.location = (3.6, -11.0, 3.1); cam_data.lens = 62
cam.constraints.new("TRACK_TO").target = body
tgt = bpy.data.objects.new("Tgt", None); tgt.location = (0, 0, 1.45); scene.collection.objects.link(tgt)
cam.constraints[0].target = tgt

scene.frame_start = 1; scene.frame_end = max(1, FRAMES)
if not bpy.app.background:
    # GUI: drop the viewport into a rendered camera view so it looks like the render.
    scene.render.fps = 24
    scene.frame_set(1)
    for a in bpy.context.screen.areas:
        if a.type == "VIEW_3D":
            for sp in a.spaces:
                if sp.type == "VIEW_3D":
                    sp.shading.type = "RENDERED"
                    sp.region_3d.view_perspective = "CAMERA"
    print("GUI READY")
else:
    os.makedirs(OUT_DIR, exist_ok=True)
    if MODE == "orbit":
        r = 11.5; h = 3.1
        for i, a in enumerate([-38, -8, 34, 96]):
            rad = math.radians(a)
            cam.location = (r * math.sin(rad), -r * math.cos(rad), h)
            scene.render.filepath = os.path.join(OUT_DIR, "view_%d.png" % i)
            bpy.ops.render.render(write_still=True)
        print("ORBIT ->", OUT_DIR)
    elif MODE == "still":
        scene.frame_set(1)
        scene.render.filepath = os.path.join(OUT_DIR, "still.png")
        bpy.ops.render.render(write_still=True)
        print("STILL ->", scene.render.filepath)
    elif MODE in ("idle", "hit", "stun", "attack", "spawn", "defeat"):
        scene.render.filepath = os.path.join(OUT_DIR, MODE + "_")
        bpy.ops.render.render(animation=True)
        print("ANIM", MODE, FRAMES, "->", OUT_DIR)
    else:
        # "live" / anything else: build only, no render (used by the live-drive loop).
        print("BUILD ONLY (mode=%s)" % MODE)
