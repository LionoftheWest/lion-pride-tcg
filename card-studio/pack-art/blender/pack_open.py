"""Lion Pride TCG pack opening (Blender 5.2, EEVEE): idle sway, gold charge-up, a clean
tear along a natural path (D-91), burst. One script for the trailer and the game clips.

From out/pack-anim-v2/pack_open_v4.py (2026-10-07, the approved v4). Cleaned: the paths
are arguments, the unused hand-built pouch is removed, the timing and look are unchanged.

Run (headless):
  blender --factory-startup -b --python pack_open.py -- <outDir> diffuse=<png> [options]

Arguments after "--":
  <outDir>        where the frames go (made if missing)
  diffuse=<png>   REQUIRED: our pack texture (1920 x 1080), from ../front/make_front.py.
                  Never the model's own DIFFUSE.png (a scan of a third-party pack).
  back=<png>      the pack back art (default: card-studio/blender/pack_front.png)
  model=<dir>     the folder with cardpack2.fbx and optional_NORMAL.png
                  (default: card-studio/pack-art/model/, git-ignored; see ../README.md)
  game            the game clips (D-93..D-95): 800 x 1120, 60 ms frames,
                  <outDir>/idle/f_0001..0025.png (1.5 s seamless loop), <outDir>/open/f_*.png
                  (~1 s charge-up, tear, burst) and <outDir>/seam_check_next.png
  rare            the rare open clip (D-96): rainbow rays, star burst. With "game" only
                  the open clip is rendered (the idle loop is the same for all, D-98).
  f=N             (trailer) render only frame N (repeat for more frames)
  nomb / mb5      no motion blur / a longer shutter (trailer tests)
  save            (trailer) also save <outDir>/pack_open.blend
Without "game": the 4.8 s trailer at 1000 x 1400, 30 fps, <outDir>/f_0001.png ...
"""
import bpy
import math
import os
import random
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
CARD_STUDIO = os.path.normpath(os.path.join(HERE, "..", ".."))


def arg(name, default=None):
    return next((x[len(name) + 1:] for x in argv if x.startswith(name + "=")), default)


def need(path, what):
    if not path or not os.path.isfile(path):
        sys.stderr.write(f"\nSTOP: {what} not found: {path}\n\n")
        sys.exit(2)
    return path


if not argv or "=" in argv[0] or argv[0] in ("game", "rare"):
    sys.stderr.write("\nSTOP: usage: blender -b --python pack_open.py -- <outDir> diffuse=<png> [game] [rare]\n\n")
    sys.exit(2)
OUT_DIR = os.path.abspath(argv[0])
MODEL_DIR = os.path.abspath(arg("model", os.path.join(HERE, "..", "model")))
MODEL_FBX = os.path.join(MODEL_DIR, "cardpack2.fbx")
MODEL_NORMAL = os.path.join(MODEL_DIR, "optional_NORMAL.png")
for p in (MODEL_FBX, MODEL_NORMAL):
    if not os.path.isfile(p):
        sys.stderr.write(f"\nSTOP: the pack model file is missing: {p}\n"
                         "Put cardpack2.fbx and optional_NORMAL.png in card-studio/pack-art/model/ "
                         "(git-ignored; the model license must be recorded first, see pack-art/README.md).\n\n")
        sys.exit(2)
OUR_DIFFUSE = need(arg("diffuse"), "diffuse=<png> (our pack texture from front/make_front.py)")
back_art = need(arg("back", os.path.join(CARD_STUDIO, "blender", "pack_front.png")), "the pack back art")

# ---- Scene -----------------------------------------------------------------
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

scene = bpy.context.scene
for cand in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
    try:
        scene.render.engine = cand
        break
    except TypeError:
        continue
scene.render.resolution_x = 800
scene.render.resolution_y = 1120   # portrait: the tall pack fills the frame
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = True
scene.view_settings.view_transform = "Standard"
scene.frame_start = 1

# A GRADIENT environment (bright cool top -> dark bottom) gives the metallic foil
# real reflections + a bright specular streak, so it reads as shiny foil, not a
# flat block. Film stays transparent, so only the reflections show, not the sky.
world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
wnt = world.node_tree
wbg = wnt.nodes.get("Background")
wtc = wnt.nodes.new("ShaderNodeTexCoord")
wsep = wnt.nodes.new("ShaderNodeSeparateXYZ"); wnt.links.new(wtc.outputs["Generated"], wsep.inputs[0])
wramp = wnt.nodes.new("ShaderNodeValToRGB")
wramp.color_ramp.elements[0].position = 0.35; wramp.color_ramp.elements[0].color = (0.03, 0.03, 0.06, 1.0)
wramp.color_ramp.elements[1].position = 0.85; wramp.color_ramp.elements[1].color = (0.85, 0.82, 1.0, 1.0)
wramp.color_ramp.elements.new(0.6).color = (0.35, 0.3, 0.55, 1.0)
wnt.links.new(wsep.outputs["Z"], wramp.inputs["Fac"])
wnt.links.new(wramp.outputs["Color"], wbg.inputs[0])
wbg.inputs[1].default_value = 1.0

try:
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "BEZIER"
except Exception:
    pass


def key(obj, frame, loc=None, rot=None, scale=None):
    if loc is not None:
        obj.location = loc
        obj.keyframe_insert("location", frame=frame)
    if rot is not None:
        obj.rotation_euler = rot
        obj.keyframe_insert("rotation_euler", frame=frame)
    if scale is not None:
        obj.scale = scale
        obj.keyframe_insert("scale", frame=frame)




# =============================================================================
# v2 (2026-10-07): idle sway -> gold charge-up -> progressive tear -> burst.
# Every motion is sampled per frame from an explicit easing curve and keyed as
# Bezier, so nothing moves linearly and nothing pops. Only the shape-key
# cross-fade of the tear poses is linear (it blends two neighbouring poses).
# =============================================================================
from mathutils import Vector

FPS = 30
GAME = "game" in argv
RARE_G = "rare" in argv   # D-96/D-98: rare open clip (rainbow rays, star burst, rainbow ring)
SPECTRUM = [(0.0, (1.0, 0.16, 0.22)), (0.17, (1.0, 0.52, 0.06)), (0.33, (1.0, 0.94, 0.18)),
            (0.5, (0.22, 1.0, 0.38)), (0.67, (0.14, 0.78, 1.0)), (0.83, (0.36, 0.34, 1.0)), (1.0, (0.88, 0.3, 1.0))]


def rainbow_tint(m, a_lo, a_hi, white=0.15, hot=(1.0, 1.0, 1.0)):
    """Holographic colour: a smooth spectrum by angle (atan2(z, x) in object
    space) from a_lo to a_hi, lightly mixed with white so it stays luminous."""
    nt = m.node_tree
    mix = [n for n in nt.nodes if n.bl_idname == "ShaderNodeMix"][0]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], sep.inputs[0])
    ang = nt.nodes.new("ShaderNodeMath"); ang.operation = "ARCTAN2"
    nt.links.new(sep.outputs["Z"], ang.inputs[0]); nt.links.new(sep.outputs["X"], ang.inputs[1])
    mr = nt.nodes.new("ShaderNodeMapRange"); mr.clamp = True
    mr.inputs["From Min"].default_value = a_lo; mr.inputs["From Max"].default_value = a_hi
    nt.links.new(ang.outputs[0], mr.inputs["Value"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = SPECTRUM[0][0], (*SPECTRUM[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = SPECTRUM[-1][0], (*SPECTRUM[-1][1], 1)
    for pos, col in SPECTRUM[1:-1]:
        cr.elements.new(pos).color = (*col, 1)
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    wm = nt.nodes.new("ShaderNodeMix"); wm.data_type = "RGBA"; wm.inputs[0].default_value = white
    nt.links.new(ramp.outputs["Color"], wm.inputs[6]); wm.inputs[7].default_value = (1, 1, 1, 1)
    nt.links.new(wm.outputs[2], mix.inputs[6])
    mix.inputs[7].default_value = (*hot, 1)
   # D-93..D-95: two game clips (idle loop + open with a ~1 s charge-up)
FRAMES = 144                     # 4.8 s
F_CH0, F_CH1 = 46, 96            # charge-up 1.5 s -> 3.2 s
F_T0, F_T1 = 96, 110             # v4: catch 97-100, fast rip 100-105, slow 105-108, corner hangs, lets go 109-110
F_B = 110                        # burst (when the last corner lets go)
scene.frame_end = FRAMES
scene.render.fps = FPS
scene.render.resolution_x = 1000
scene.render.resolution_y = 1400
try:
    scene.eevee.taa_render_samples = 32
except Exception:
    pass
try:
    scene.render.use_motion_blur = "nomb" not in argv
    scene.render.motion_blur_shutter = 0.5 if "mb5" in argv else 0.22
    scene.eevee.motion_blur_steps = 2
except Exception:
    pass

GOLD = (0.905, 0.473, 0.045)     # #F4B73C (linear)
GOLD_HI = (1.0, 0.680, 0.157)    # #FFD76E (linear)
HOT = (1.0, 0.93, 0.75)


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def sstep(a, b, x):
    t = clamp01((x - a) / (b - a))
    return t * t * (3 - 2 * t)


def sstep5(a, b, x):  # smootherstep
    t = clamp01((x - a) / (b - a))
    return t * t * t * (t * (t * 6 - 15) + 10)


def ease_out(a, b, x, pw=3.0):
    t = clamp01((x - a) / (b - a))
    return 1 - (1 - t) ** pw


def ease_in_out_cubic(a, b, x):
    t = clamp01((x - a) / (b - a))
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def bump(a, b, x):
    t = clamp01((x - a) / (b - a))
    return math.sin(math.pi * t) ** 2


def lerp(a, b, t):
    return a + (b - a) * t


def keyv(sock, frame, v):
    sock.default_value = v
    sock.keyframe_insert("default_value", frame=frame)


def new_empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    scene.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def mesh_obj(name, verts, faces, uvs=None, mat_idx=None, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    if uvs is not None:
        uvl = me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    if mat_idx is not None:
        for poly, mi in zip(me.polygons, mat_idx):
            poly.material_index = mi
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if parent:
        o.parent = parent
    try:
        o.visible_shadow = False
    except Exception:
        pass
    return o


def quad_xz(name, parent=None, w=1.0, h=1.0):
    v = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return mesh_obj(name, v, [(0, 1, 2, 3)], uvs=uv, parent=parent)


# ---- FX material: emission over transparency, alpha from a shape function ---
class G:
    """Tiny node-graph helper: math on sockets or floats."""
    def __init__(self, nt):
        self.nt = nt

    def m(self, op, a, b=None, c=None):
        n = self.nt.nodes.new("ShaderNodeMath"); n.operation = op
        for i, x in enumerate((a, b, c)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                n.inputs[i].default_value = x
            else:
                self.nt.links.new(x, n.inputs[i])
        return n.outputs[0]


def fx_mat(name, color, strength, shape, hot=HOT, hot_pow=3.0):
    """shape(g, obj_xyz_sep, uv_sep) -> alpha socket. A 'Vis' Value node
    multiplies alpha and a 'Boost' Value node multiplies the emission strength.
    The colour turns from brand gold to a hot near-white in the dense core."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    g = G(nt)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    so = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], so.inputs[0])
    su = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["UV"], su.inputs[0])
    vis = nt.nodes.new("ShaderNodeValue"); vis.name = "Vis"; vis.outputs[0].default_value = 1.0
    boost = nt.nodes.new("ShaderNodeValue"); boost.name = "Boost"; boost.outputs[0].default_value = 1.0
    a0 = shape(g, so, su)
    a = g.m("MULTIPLY", a0, vis.outputs[0])
    a = g.m("MINIMUM", g.m("MAXIMUM", a, 0.0), 1.0)
    core = g.m("POWER", g.m("MINIMUM", g.m("MAXIMUM", a0, 0.0), 1.0), hot_pow)
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    nt.links.new(core, mix.inputs[0])
    mix.inputs[6].default_value = (*color, 1); mix.inputs[7].default_value = (*hot, 1)
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mix.outputs[2], em.inputs["Color"])
    nt.links.new(g.m("MULTIPLY", boost.outputs[0], strength), em.inputs["Strength"])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    ms = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(a, ms.inputs[0]); nt.links.new(tr.outputs[0], ms.inputs[1]); nt.links.new(em.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs["Surface"])
    try: m.surface_render_method = "BLENDED"
    except Exception: pass
    try: m.blend_method = "BLEND"
    except Exception: pass
    try: m.use_transparency_overlap = True
    except Exception: pass
    return m


def _radius(g, so, div):
    return g.m("DIVIDE", g.m("SQRT", g.m("ADD", g.m("MULTIPLY", so.outputs["X"], so.outputs["X"]), g.m("MULTIPLY", so.outputs["Z"], so.outputs["Z"]))), div)


def shape_radial(pw=2.2):
    def f(g, so, su):
        r = _radius(g, so, 0.5)
        return g.m("POWER", g.m("MAXIMUM", g.m("SUBTRACT", 1.0, r), 0.0), pw)
    return f


def shape_ring(r0=0.84, w=0.13, inner=0.18):
    def f(g, so, su):
        r = _radius(g, so, 0.5)
        band = g.m("POWER", g.m("MAXIMUM", g.m("SUBTRACT", 1.0, g.m("DIVIDE", g.m("ABSOLUTE", g.m("SUBTRACT", r, r0)), w)), 0.0), 2.0)
        fill = g.m("MULTIPLY", g.m("MULTIPLY", g.m("POWER", g.m("MINIMUM", g.m("DIVIDE", r, r0), 1.0), 3.0), g.m("LESS_THAN", r, r0)), inner)
        return g.m("ADD", band, fill)
    return f


def shape_streak():
    # UV: y along (0 tail -> 1 head), x across. Bright head, fading tail, soft sides.
    def f(g, so, su):
        along = g.m("MULTIPLY", g.m("POWER", su.outputs["Y"], 1.6), g.m("SUBTRACT", 1.0, g.m("POWER", su.outputs["Y"], 24.0)))
        across = g.m("POWER", g.m("MAXIMUM", g.m("SUBTRACT", 1.0, g.m("ABSOLUTE", g.m("MULTIPLY_ADD", su.outputs["X"], 2.0, -1.0))), 0.0), 1.5)
        return g.m("MULTIPLY", g.m("MULTIPLY", along, across), 1.6)
    return f


def shape_ribbon(gain):
    # UV x along the arc (0 tail -> 1 head): a long fading tail, a soft rounded head.
    def f(g, so, su):
        u = su.outputs["X"]
        tail = g.m("POWER", u, 1.8)
        head = g.m("SUBTRACT", 1.0, g.m("POWER", u, 40.0))
        return g.m("MULTIPLY", g.m("MULTIPLY", tail, head), gain)
    return f


def shape_leak():
    # A thin horizontal glow line: gaussian in object Z, soft at both ends (UV x).
    def f(g, so, su):
        z = g.m("DIVIDE", so.outputs["Z"], 0.5)
        vert = g.m("EXPONENT", g.m("MULTIPLY", g.m("MULTIPLY", z, z), -9.0))
        u = su.outputs["X"]
        ends = g.m("MULTIPLY", g.m("MINIMUM", g.m("DIVIDE", u, 0.12), 1.0), g.m("MINIMUM", g.m("DIVIDE", g.m("SUBTRACT", 1.0, u), 0.25), 1.0))
        return g.m("MULTIPLY", vert, ends)
    return f


def shape_rect_glow(hw, hh, reach):
    # A soft glow just OUTSIDE a rectangle (sits behind the pack = an edge halo).
    def f(g, so, su):
        dx = g.m("MAXIMUM", g.m("SUBTRACT", g.m("ABSOLUTE", so.outputs["X"]), hw), 0.0)
        dz = g.m("MAXIMUM", g.m("SUBTRACT", g.m("ABSOLUTE", so.outputs["Z"]), hh), 0.0)
        d = g.m("SQRT", g.m("ADD", g.m("MULTIPLY", dx, dx), g.m("MULTIPLY", dz, dz)))
        return g.m("POWER", g.m("MAXIMUM", g.m("SUBTRACT", 1.0, g.m("DIVIDE", d, reach)), 0.0), 2.4)
    return f


# ---- The pack -----------------------------------------------------------------
# ---- The DOWNLOADED pack model (cardpack2.fbx) ----------------------------------
# A free model from online (Nathan, 2026-10-07); its source and license are not recorded
# yet, so it is not in the repo. Its own DIFFUSE.png is a scan of a real third-party pack
# and is never used; we use OUR texture (diffuse=) + the model's wrinkle normal map.
import bmesh
from mathutils import Matrix

U0, U1 = 0.353, 0.644            # the model's UV island (u) = the printed width
V_ART0, V_ART1 = 0.099, 0.889    # printed art band; silver crimps above / below
H_MODEL = 2.511
W, H = 0.535, 1.02               # scene size (same framing as v2)
MS = H / H_MODEL


def load_model():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=MODEL_FBX)
    new = [o for o in bpy.data.objects if o not in before]
    ob = [o for o in new if o.type == "MESH"][0]
    mw = ob.matrix_world.copy()
    ob.parent = None
    for o in new:
        if o is not ob:
            bpy.data.objects.remove(o, do_unlink=True)
    me = ob.data
    me.transform(mw)
    ob.matrix_world = Matrix.Identity(4)
    # local X (long) -> Z up, local Y (width) -> X, local Z (thin) -> Y; a 180 deg
    # turn so the printed front faces the camera (-Y).
    M = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0))).to_4x4()
    me.transform(Matrix.Rotation(math.radians(180), 4, "Z") @ M)
    xs = [v.co.x for v in me.vertices]; zs = [v.co.z for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    me.transform(Matrix.Scale(MS, 4) @ Matrix.Translation(-c))
    me.update()
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    try:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    except Exception as e:
        print("custom normals:", e)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.clear()
    return ob


def z_of_v(ob, v_target):
    """Scene height of a texture row v (least squares over front-face loops)."""
    me = ob.data; uv = me.uv_layers.active.data
    pts = [(uv[li].uv.y, me.vertices[me.loops[li].vertex_index].co.z)
           for p in me.polygons if p.normal.y < -0.5 for li in p.loop_indices]
    n = len(pts); sv = sum(a for a, _ in pts); sz = sum(b for _, b in pts)
    svv = sum(a * a for a, _ in pts); svz = sum(a * b for a, b in pts)
    k = (n * svz - sv * sz) / (n * svv - sv * sv); b0 = (sz - k * sv) / n
    return k * v_target + b0


def _srelu(t, e=0.03):
    return 0.5 * (t + math.sqrt(t * t + e * e))


def make_cut(z_start):
    """v4: a natural tear PATH (the edge itself stays clean): it starts just under
    the crimp at the notch (left), drifts down ~2.5% of the pack height as it
    crosses, with two gentle kinks where the foil changes direction."""
    def cut(x):
        u = (x + W / 2) / W
        return (z_start - 0.012 * u - 0.026 * (_srelu(u - 0.40) - _srelu(-0.40))
                + 0.011 * (_srelu(u - 0.76) - _srelu(-0.76)) + 0.0018 * math.sin(7.0 * u + 0.6))
    return cut


def tag_rest(mesh):
    """'orig' = rest position (glow + rim masks survive the shape-key peel);
    'region' = 1 on faces that face +Y at rest (the back: gets our back art)."""
    oa = mesh.attributes.new("orig", "FLOAT_VECTOR", "POINT")
    oa.data.foreach_set("vector", [c for v in mesh.vertices for c in v.co])
    ra = mesh.attributes.new("region", "FLOAT", "FACE")
    ra.data.foreach_set("value", [1.0 if p.normal.y > 0.3 else 0.0 for p in mesh.polygons])
    ca = mesh.attributes.new("cutd", "FLOAT", "POINT")   # distance to the tear path (rim mask)
    ca.data.foreach_set("value", [abs(v.co.z - CUT(v.co.x)) for v in mesh.vertices])


def split_at(ob, z, cut):
    """Bisect the pack along the tear path cut(x): shear each column so the path
    is flat at z, cut with a plane, shear back. Body keeps below, cap above."""
    cap_me = ob.data.copy(); cap_me.name = "PackCap"
    for mesh, keep_above in ((ob.data, False), (cap_me, True)):
        bm = bmesh.new(); bm.from_mesh(mesh)
        for v in bm.verts:
            v.co.z -= cut(v.co.x) - z
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, z), plane_no=(0, 0, 1),
                               clear_outer=not keep_above, clear_inner=keep_above)
        for v in bm.verts:
            v.co.z += cut(v.co.x) - z
        bm.normal_update()
        bm.to_mesh(mesh); bm.free(); mesh.update()
    cap_ob = bpy.data.objects.new("PackCap", cap_me)
    scene.collection.objects.link(cap_ob)
    return ob, cap_ob


def model_material(name, back_art):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    L = nt.links.new
    g = G(nt)
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "UVMap"
    su = nt.nodes.new("ShaderNodeSeparateXYZ"); L(uvn.outputs["UV"], su.inputs[0])
    dif = nt.nodes.new("ShaderNodeTexImage"); dif.image = bpy.data.images.load(OUR_DIFFUSE); L(uvn.outputs["UV"], dif.inputs["Vector"])
    # back art over the printed band, mirrored in u (it is seen from behind)
    bu = g.m("SUBTRACT", 1.0, g.m("DIVIDE", g.m("SUBTRACT", su.outputs["X"], U0), U1 - U0))
    bv = g.m("DIVIDE", g.m("SUBTRACT", su.outputs["Y"], V_ART0), V_ART1 - V_ART0)
    bco = nt.nodes.new("ShaderNodeCombineXYZ"); L(bu, bco.inputs[0]); L(bv, bco.inputs[1])
    btex = nt.nodes.new("ShaderNodeTexImage"); btex.image = bpy.data.images.load(back_art); btex.extension = "EXTEND"
    L(bco.outputs[0], btex.inputs["Vector"])
    band = g.m("MULTIPLY", g.m("GREATER_THAN", su.outputs["Y"], V_ART0), g.m("LESS_THAN", su.outputs["Y"], V_ART1))
    crimp = g.m("SUBTRACT", 1.0, band)
    reg = nt.nodes.new("ShaderNodeAttribute"); reg.attribute_name = "region"; reg.attribute_type = "GEOMETRY"
    useback = g.m("MULTIPLY", reg.outputs["Fac"], band)
    art = nt.nodes.new("ShaderNodeMixRGB"); L(useback, art.inputs[0]); L(dif.outputs["Color"], art.inputs[1]); L(btex.outputs["Color"], art.inputs[2])
    # rest position -> masks
    orig = nt.nodes.new("ShaderNodeAttribute"); orig.attribute_name = "orig"; orig.attribute_type = "GEOMETRY"
    og = nt.nodes.new("ShaderNodeSeparateXYZ"); L(orig.outputs["Vector"], og.inputs[0])
    # the INSIDE of the foil (seen through the opening) is plain foil, not art
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    inside = nt.nodes.new("ShaderNodeMixRGB"); L(geo.outputs["Backfacing"], inside.inputs[0])
    L(art.outputs[0], inside.inputs[1]); inside.inputs[2].default_value = (0.55, 0.52, 0.47, 1)
    # thin bright metallic RIM along the clean cut, only where it is already cut
    seamz = nt.nodes.new("ShaderNodeValue"); seamz.name = "SeamZ"; seamz.outputs[0].default_value = -99.0
    tearx = nt.nodes.new("ShaderNodeValue"); tearx.name = "TearX"; tearx.outputs[0].default_value = -99.0
    cutd = nt.nodes.new("ShaderNodeAttribute"); cutd.attribute_name = "cutd"; cutd.attribute_type = "GEOMETRY"
    adz = cutd.outputs["Fac"]
    rimr = nt.nodes.new("ShaderNodeMapRange"); rimr.interpolation_type = "SMOOTHSTEP"; rimr.clamp = True
    rimr.inputs["From Min"].default_value = 0.003; rimr.inputs["From Max"].default_value = 0.006
    rimr.inputs["To Min"].default_value = 1.0; rimr.inputs["To Max"].default_value = 0.0
    L(adz, rimr.inputs["Value"])
    cutm = nt.nodes.new("ShaderNodeMapRange"); cutm.interpolation_type = "SMOOTHSTEP"; cutm.clamp = True
    cutm.inputs["From Min"].default_value = -0.03; cutm.inputs["From Max"].default_value = 0.0
    cutm.inputs["To Min"].default_value = 1.0; cutm.inputs["To Max"].default_value = 0.0
    L(g.m("SUBTRACT", og.outputs["X"], tearx.outputs[0]), cutm.inputs["Value"])
    rim = g.m("MULTIPLY", rimr.outputs["Result"], cutm.outputs["Result"])
    rimc = nt.nodes.new("ShaderNodeMixRGB"); L(rim, rimc.inputs[0])
    L(inside.outputs[0], rimc.inputs[1]); rimc.inputs[2].default_value = (0.95, 0.9, 0.78, 1)
    L(rimc.outputs[0], b.inputs["Base Color"])
    # metal: crimps + rim are mirror foil; the printed art is ink (low metal), so
    # its real colours read (no wash). Emission keeps the art true under any light.
    L(g.m("MAXIMUM", g.m("MULTIPLY_ADD", crimp, 0.85, 0.12), rim), b.inputs["Metallic"])
    L(g.m("MULTIPLY_ADD", crimp, -0.12, 0.34), b.inputs["Roughness"])
    front_only = g.m("SUBTRACT", 1.0, geo.outputs["Backfacing"])
    artk = g.m("MULTIPLY", g.m("MULTIPLY", band, front_only), g.m("SUBTRACT", 1.0, rim))
    e_art = nt.nodes.new("ShaderNodeVectorMath"); e_art.operation = "SCALE"
    L(art.outputs[0], e_art.inputs[0]); L(g.m("MULTIPLY", artk, 0.42), e_art.inputs["Scale"])
    # gold CHARGE glow on the EDGES only (rest-space rim of the silhouette)
    charge = nt.nodes.new("ShaderNodeValue"); charge.name = "Charge"; charge.outputs[0].default_value = 0.0
    def mr(src, lo, hi):
        n = nt.nodes.new("ShaderNodeMapRange"); n.interpolation_type = "SMOOTHSTEP"; n.clamp = True
        n.inputs["From Min"].default_value = lo; n.inputs["From Max"].default_value = hi
        L(src, n.inputs["Value"]); return n.outputs["Result"]
    ex = mr(g.m("ABSOLUTE", og.outputs["X"]), W / 2 * 0.95, W / 2 * 1.0)
    ez = mr(g.m("ABSOLUTE", og.outputs["Z"]), H / 2 * 0.955, H / 2 * 1.0)
    edge = g.m("MULTIPLY", g.m("MULTIPLY", g.m("MAXIMUM", ex, ez), 1.6), charge.outputs[0])
    gold = nt.nodes.new("ShaderNodeVectorMath"); gold.operation = "SCALE"; gold.inputs[0].default_value = (1.0, 0.62, 0.12)
    L(g.m("MULTIPLY", edge, front_only), gold.inputs["Scale"])
    esum = nt.nodes.new("ShaderNodeVectorMath"); esum.operation = "ADD"
    L(e_art.outputs[0], esum.inputs[0]); L(gold.outputs[0], esum.inputs[1])
    L(esum.outputs[0], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 1.0
    # the model's wrinkle normal map (geometry detail only, no printed content)
    nrm = nt.nodes.new("ShaderNodeTexImage"); nrm.image = bpy.data.images.load(MODEL_NORMAL)
    nrm.image.colorspace_settings.name = "Non-Color"; L(uvn.outputs["UV"], nrm.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8
    L(nrm.outputs["Color"], nm.inputs["Color"]); L(nm.outputs["Normal"], b.inputs["Normal"])
    return m


pack = load_model()
pack.name = "Pack"
Z_START = z_of_v(pack, V_ART1) - 0.010    # starts just below the top crimp at the notch
CUT = make_cut(Z_START)
SEAM_Z = sum(CUT(-W / 2 + W * i / 40) for i in range(41)) / 41   # mean height (flash, rays, glow)
pack, cap = split_at(pack, Z_START, CUT)
for o in (pack, cap):
    tag_rest(o.data)
pouch_mat = model_material("PackModel", back_art)
for o in (pack, cap):
    o.data.materials.clear(); o.data.materials.append(pouch_mat)
SEAM = [(-0.45 + 0.9 * i / 180, CUT(-0.45 + 0.9 * i / 180)) for i in range(181)]
print("MODEL pack", [round(v, 3) for v in pack.dimensions], "seam z", round(SEAM_Z, 4), "cap verts", len(cap.data.vertices))

pivot = new_empty("PackPivot")
pack.parent = pivot
CHARGE = pouch_mat.node_tree.nodes["Charge"].outputs[0]
pouch_mat.node_tree.nodes["SeamZ"].outputs[0].default_value = SEAM[0][1]
TEARX = pouch_mat.node_tree.nodes["TearX"].outputs[0]


def _interp(prof, x):
    if x <= prof[0][0]:
        return prof[0][1]
    for (x0, z0), (x1, z1) in zip(prof, prof[1:]):
        if x <= x1:
            return lerp(z0, z1, (x - x0) / (x1 - x0))
    return prof[-1][1]


def seam_z(x):
    return _interp(SEAM, x)


# A low-passed seam line (+-10 columns) used as the bend axis of the peel. Bending
# each column about its own frayed height turned the fray into a depth
# corrugation (vertical specular streaks on the cap).
_n = len(SEAM)
SEAM_SMOOTH = SEAM   # v4: the path is already smooth (clean edge)


def seam_zs(x):
    return _interp(SEAM_SMOOTH, x)


# ---- Tear: the front runs left -> right; behind it the cap peels up + back --
XL, XR = -0.34, 0.41             # tear front start (outside left edge) / end
YA = 0.030                       # bend axis just behind the back sheet: no dip into the body


TEAR_KEYS = [  # (frame, progress): catch at the notch, fast rip, slow near the
    (96, -0.07), (98, -0.03), (100, 0.07),        # far edge, the last corner hangs, then lets go
    (101, 0.18), (102, 0.36), (103, 0.55), (104, 0.69),
    (105, 0.77), (106, 0.81), (107, 0.83), (108, 0.845),
    (109, 0.93), (110, 1.08)]


def _pchip(keys, x):
    """Monotone cubic through the keys (smooth speed changes, no overshoot)."""
    xs = [k[0] for k in keys]; ys = [k[1] for k in keys]
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    n = len(xs)
    dl = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [dl[0]] + [0.0 if dl[i - 1] * dl[i] <= 0 else 2 * dl[i - 1] * dl[i] / (dl[i - 1] + dl[i]) for i in range(1, n - 1)] + [dl[-1]]
    i = max(j for j in range(n - 1) if xs[j] <= x)
    h = xs[i + 1] - xs[i]; t = (x - xs[i]) / h
    return ((2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h * m[i]
            + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h * m[i + 1])


def tear_p(f):
    return _pchip(TEAR_KEYS, f)


def catch(f):
    """The stretch/bulge at the notch before the foil gives."""
    return bump(96.5, 101.5, f)


def tear_x(f):
    return lerp(XL, XR, tear_p(f))


def peel(P, xf, bul=0.0):
    x, y, z = P
    zs = seam_zs(x)
    h = z - zs
    # the stretch at the notch: the foil bulges toward the camera before it gives
    by = -0.012 * bul * math.exp(-((x + W / 2) / 0.07) ** 2) * math.exp(-(max(h, 0.0) / 0.05) ** 2)
    d = xf - x
    a = sstep(0.0, 0.11, d)
    if a <= 0.0:
        return (x, y + by, z)
    dn = clamp01(d / 0.62)
    # thin foil: the bend grows along the torn length AND up the strip (a curl),
    # so it curves like foil instead of staying a flat board
    th = -a * (math.radians(9) + math.radians(48) * dn + math.radians(32) * clamp01(h / 0.10) * (0.4 + dn))
    yy = y - YA
    y2 = YA + yy * math.cos(th) - h * math.sin(th)
    h2 = yy * math.sin(th) + h * math.cos(th)
    lift = a * (0.012 + 0.12 * dn ** 1.5)
    sag = -a * 0.035 * dn * dn            # the long torn tail bows toward the camera
    return (x - a * 0.03 * dn, y2 + by + sag, z + (h2 - h) + lift)


me = cap.data
rest = [v.co.copy() for v in me.vertices]
cx = sum(v.x for v in rest) / len(rest); cy = sum(v.y for v in rest) / len(rest); cz = sum(v.z for v in rest) / len(rest)
CAP_C = (cx, cy, cz)
# The art is mapped in OBJECT space, so the cap mesh keeps the pack's origin;
# a parent empty at the cap centre carries the flight + tumble.
cap_fly = new_empty("CapFly", parent=pivot, loc=CAP_C)
cap.parent = cap_fly
cap.location = (-cx, -cy, -cz)
cap.shape_key_add(name="Basis", from_mix=False)
tear_keys = []
for f in range(F_T0, F_T1 + 1):
    sk = cap.shape_key_add(name=f"tear_{f}", from_mix=False)
    xf = tear_x(f)
    for i, r in enumerate(rest):
        nx_, ny_, nz_ = peel((r.x, r.y, r.z), xf, catch(f))
        sk.data[i].co = (nx_, ny_, nz_)
    tear_keys.append((f, sk))
for idx, (f, sk) in enumerate(tear_keys):
    last = idx == len(tear_keys) - 1
    seq = [(f - 1, 0.0), (f, 1.0)] + ([] if last else [(f + 1, 0.0)])
    for ff, val in seq:
        sk.value = val
        sk.keyframe_insert("value", frame=ff)

# v4: once free, the thin strip keeps curling (an additive shape key, eased).
curl = cap.shape_key_add(name="curl", from_mix=False)
for i, r in enumerate(rest):
    dxc = r.x - cx
    curl.data[i].co = (r.x, r.y - 0.55 * dxc * dxc, r.z + 0.30 * dxc * dxc + 0.25 * (r.z - cz) * abs(dxc))
for f in range(F_T1 - 2, F_T1 + 22):
    curl.value = sstep(F_T1 - 1, F_T1 + 16, f)
    curl.keyframe_insert("value", frame=f)

# v4: the body's opening edge flexes slightly open behind the tear front (front
# sheet toward the camera, back sheet away), with a small settle after release.
bme = pack.data
brest = [v.co.copy() for v in bme.vertices]
pack.shape_key_add(name="Basis", from_mix=False)
flex_keys = []
F_FLEX1 = F_T1 + 10
for f in range(F_T0, F_FLEX1 + 1):
    sk = pack.shape_key_add(name=f"flex_{f}", from_mix=False)
    xf = tear_x(min(f, F_T1)); bul = catch(f)
    amp = 1.0 + 0.3 * bump(F_T1, F_T1 + 9, f)
    for i, r in enumerate(brest):
        dz = CUT(r.x) - r.z
        if dz > 0.07 or abs(r.y) < 1e-5:
            sk.data[i].co = r
            continue
        w = (1.0 - dz / 0.07) ** 2
        opn = sstep(0.0, 0.14, xf - r.x) * amp
        by = -0.012 * bul * math.exp(-((r.x + W / 2) / 0.07) ** 2) * w if r.y < 0 else 0.0
        sgn = -1.0 if r.y < 0 else 1.0
        sk.data[i].co = (r.x, r.y + sgn * 0.010 * w * opn + by, r.z)
    flex_keys.append((f, sk))
for idx, (f, sk) in enumerate(flex_keys):
    last = idx == len(flex_keys) - 1
    for ff, val in [(f - 1, 0.0), (f, 1.0)] + ([] if last else [(f + 1, 0.0)]):
        sk.value = val
        sk.keyframe_insert("value", frame=ff)

# The freed cap pops up-left (the way it was pulled), tumbling, eased in-out;
# it is out of frame well before the curve slows down.
F_FLY0, F_FLY1 = 108, 130     # starts as the hanging corner lets go
D = (-1.55, -0.45, 2.5)
for f in range(1, FRAMES + 1):
    s = ease_in_out_cubic(F_FLY0, F_FLY1, f)
    cap_fly.location = (CAP_C[0] + D[0] * s, CAP_C[1] + D[1] * s, CAP_C[2] + D[2] * s)
    cap_fly.rotation_euler = (math.radians(-55) * s, math.radians(-170) * s, math.radians(25) * s)
    cap_fly.keyframe_insert("location", frame=f)
    cap_fly.keyframe_insert("rotation_euler", frame=f)
cap.hide_render = False; cap.keyframe_insert("hide_render", frame=F_FLY1)
cap.hide_render = True; cap.keyframe_insert("hide_render", frame=F_FLY1 + 1)

# ---- Pivot: idle float + sway -> charge tilt + soft shake -> recoil ----------
for f in range(1, FRAMES + 1):
    t = (f - 1) / FPS
    c = sstep(F_CH0, F_CH1 - 4, f)
    amp = (1.0 - 0.7 * c) * ((1.0 - sstep(F_B, F_B + 16, f)) if GAME else 1.0)   # GAME: settle still (WebP size)
    shake = sstep(86, 97, f) * (1.0 - sstep(103, 110, f))
    kick = bump(F_B - 1, F_B + 16, f)
    settle = sstep(F_B + 4, F_B + 18 if GAME else FRAMES, f)
    # GAME (D-93): the idle is periodic in exactly 1.5 s (45 frames), so the
    # idle clip loops seamlessly and the open clip starts on the loop's frame 1.
    P1, P2, P3 = (1.5, 1.5, 0.75) if GAME else (2.6, 3.4, 2.2)
    z = 0.024 * math.sin(2 * math.pi * t / P1) * amp + 0.03 * c - 0.012 * bump(F_T0, F_T1, f) + 0.012 * kick
    y = -0.10 * c + 0.035 * kick
    x = 0.0035 * shake * math.sin(2 * math.pi * f / 3.1)
    rx = math.radians(10) * c - math.radians(3.5) * kick - math.radians(3.0) * settle
    ry = math.radians(2.5) * math.sin(2 * math.pi * t / P3 + 1.1) * amp + math.radians(1.5) * shake * math.sin(2 * math.pi * f / 4.3)
    rz = math.radians(6 if GAME else 7) * math.sin(2 * math.pi * t / P2 + 0.3) * amp + math.radians(1.1) * shake * math.sin(2 * math.pi * f / 3.7 + 0.7)
    pivot.location = (x, y, z); pivot.rotation_euler = (rx, ry, rz)
    pivot.keyframe_insert("location", frame=f); pivot.keyframe_insert("rotation_euler", frame=f)
    # the foil warms + its edges glow gold with the charge; residual warmth after the burst
    keyv(TEARX, f, tear_x(f) if f >= F_T0 else -99.0)
    keyv(CHARGE, f, sstep(50, 95, f) * (1.0 + 0.35 * bump(92, 108, f)) * (1.0 - sstep(104, 118, f)) + 0.10 * sstep(108, 124 if GAME else 132, f))

# A soft gold halo just outside the pack silhouette (sits behind it).
halo = quad_xz("EdgeHalo", parent=pivot, w=W + 0.3, h=H + 0.3)
halo.location = (0, 0.045, 0)
halo_m = fx_mat("EdgeHalo", GOLD, 1.25, shape_rect_glow(W / 2 - 0.01, H / 2 - 0.01, 0.10), hot_pow=6)
halo.data.materials.append(halo_m)
hv = halo_m.node_tree.nodes["Vis"].outputs[0]
for f in range(1, FRAMES + 1):
    keyv(hv, f, 0.9 * sstep(52, 95, f) * (1.0 - sstep(99, 106, f)))


# ---- Charge-up ribbons: thin gold tubes orbiting on tilted paths ------------
def ribbon_mesh(arc_deg, seg=96, r_core=0.016, r_halo=0.06, sides=8):
    verts, faces, uvs, mats = [], [], [], []
    for rad, mi in ((r_core, 0), (r_halo, 1)):
        base = len(verts)
        for i in range(seg + 1):
            u = i / seg
            a = math.radians(-arc_deg + arc_deg * u)
            ca, sa = math.cos(a), math.sin(a)
            r = rad * (0.25 + 0.75 * u) * (1.0 - 0.55 * sstep(0.93, 1.0, u))
            for k in range(sides):
                ph = 2 * math.pi * k / sides
                verts.append((ca * (1 + r * math.cos(ph)), sa * (1 + r * math.cos(ph)), r * math.sin(ph)))
                uvs.append((u, k / sides))
        for i in range(seg):
            for k in range(sides):
                a0 = base + i * sides + k; a1 = base + i * sides + (k + 1) % sides
                faces.append((a0, a1, a1 + sides, a0 + sides)); mats.append(mi)
    return verts, faces, uvs, mats


RIBBONS = [  # (height, tilt x, tilt y, phase, arc deg, speed scale)
    (0.05, 7, -9, 0.0, 150, 1.00),      # v3: lowest path stays above the ORIGINS plate
    (0.17, -12, 15, 2.2, 125, 1.12),
    (0.29, 18, 7, 4.1, 140, 0.92),
]
R0 = 0.46
ribbon_core = fx_mat("RibbonCore", GOLD_HI, 1.35, shape_ribbon(1.0), hot_pow=5.0)
ribbon_halo = fx_mat("RibbonHalo", GOLD, 1.1, shape_ribbon(0.38), hot_pow=12.0)
for mt in (ribbon_core, ribbon_halo):
    vn = mt.node_tree.nodes["Vis"].outputs[0]; bn = mt.node_tree.nodes["Boost"].outputs[0]
    for f in range(1, FRAMES + 1):
        keyv(vn, f, sstep(F_CH0, F_CH0 + 16, f) * (1.0 - sstep(94, 102, f)))
        keyv(bn, f, 0.8 + 0.35 * sstep(F_CH0, 94, f))

for ri, (hz, tx, ty, ph, arc, sp) in enumerate(RIBBONS):
    frame_e = new_empty(f"Orbit{ri}", parent=pivot)
    frame_e.rotation_euler = (math.radians(tx), math.radians(ty), 0)
    v, fc, uv, mi = ribbon_mesh(arc)
    rb = mesh_obj(f"Ribbon{ri}", v, fc, uvs=uv, mat_idx=mi, parent=frame_e)
    rb.data.materials.append(ribbon_core); rb.data.materials.append(ribbon_halo)
    light_d = bpy.data.lights.new(f"RibbonLight{ri}", type="POINT")
    light_d.color = GOLD_HI; light_d.shadow_soft_size = 0.05
    try: light_d.use_shadow = False
    except Exception: pass
    lo = bpy.data.objects.new(f"RibbonLight{ri}", light_d); scene.collection.objects.link(lo)
    lo.parent = rb; lo.location = (1.0, 0.0, 0.0)
    ang = ph
    for f in range(1, FRAMES + 1):
        c = sstep(F_CH0, 94, f)
        gather = sstep(88, 101, f)
        ang += (2 * math.pi / FPS) * (0.85 + 1.6 * c) * sp
        R = lerp(R0 - 0.05 * c, 0.37, gather)
        frame_e.location = (0, 0, lerp(hz, SEAM_Z - 0.03, gather))
        frame_e.scale = (R, R * 0.62, R)
        rb.rotation_euler = (0, 0, ang)
        frame_e.keyframe_insert("location", frame=f); frame_e.keyframe_insert("scale", frame=f)
        rb.keyframe_insert("rotation_euler", frame=f)
        light_d.energy = 0.6 * sstep(F_CH0, F_CH0 + 16, f) * (1.0 - sstep(94, 102, f)) * (0.6 + c)
        light_d.keyframe_insert("energy", frame=f)

# ---- Tear light: a glow line along the opened seam + a hot spark at the front -
def shape_leak_path():
    # v4: glow line along the curved path; UV y across, gated at the tear front.
    def f(g, so, su):
        zz = g.m("MULTIPLY_ADD", su.outputs["Y"], 2.0, -1.0)
        vert = g.m("EXPONENT", g.m("MULTIPLY", g.m("MULTIPLY", zz, zz), -9.0))
        left = g.m("MINIMUM", g.m("DIVIDE", su.outputs["X"], 0.10), 1.0)
        tx = g.nt.nodes.new("ShaderNodeValue"); tx.name = "TearX"; tx.outputs[0].default_value = -99.0
        gate = g.nt.nodes.new("ShaderNodeMapRange"); gate.interpolation_type = "SMOOTHSTEP"; gate.clamp = True
        gate.inputs["From Min"].default_value = -0.06; gate.inputs["From Max"].default_value = 0.0
        gate.inputs["To Min"].default_value = 1.0; gate.inputs["To Max"].default_value = 0.0
        g.nt.links.new(g.m("SUBTRACT", so.outputs["X"], tx.outputs[0]), gate.inputs["Value"])
        return g.m("MULTIPLY", g.m("MULTIPLY", vert, left), gate.outputs["Result"])
    return f


leak_m = fx_mat("Leak", GOLD_HI, 1.2, shape_leak_path(), hot_pow=6.0)
_lv, _lf, _lu = [], [], []
for i in range(81):
    xx = -W / 2 * 1.04 + (W * 1.04) * i / 80
    zc = CUT(xx) + 0.006
    _lv += [(xx, 0.0, zc - 0.0225), (xx, 0.0, zc + 0.0225)]
    _lu += [(i / 80, 0.0), (i / 80, 1.0)]
    if i:
        _lf.append((2 * i - 2, 2 * i, 2 * i + 1, 2 * i - 1))
leak = mesh_obj("Leak", _lv, _lf, uvs=_lu, parent=pivot)
leak.location = (0, -0.04, 0)
LEAK_TX = leak_m.node_tree.nodes["TearX"].outputs[0]
leak.data.materials.append(leak_m)
tip_m = fx_mat("TearTip", GOLD_HI, 1.8, shape_radial(2.6), hot_pow=2.0)
tip = quad_xz("TearTip", parent=pivot)
tip.data.materials.append(tip_m)
inner_m = fx_mat("InnerGlow", GOLD_HI, 1.6, shape_leak(), hot_pow=1.5)
inner = mesh_obj("InnerGlow", [(0, 0, -0.5), (1, 0, -0.5), (1, 0, 0.5), (0, 0, 0.5)], [(0, 1, 2, 3)],
                 uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], parent=pivot)
inner.data.materials.append(inner_m)
inner_vis = inner_m.node_tree.nodes["Vis"].outputs[0]
leak_vis = leak_m.node_tree.nodes["Vis"].outputs[0]; tip_vis = tip_m.node_tree.nodes["Vis"].outputs[0]
XLEFT = -W / 2 * 1.04
for f in range(1, FRAMES + 1):
    xf = max(XLEFT, tear_x(f))
    xr = min(xf, W / 2 * 1.04)
    span = max(0.004, xr - XLEFT)
    keyv(LEAK_TX, f, xf)
    keyv(leak_vis, f, 1.0 * sstep(99, 101, f) * (1.0 - sstep(107, 112, f)))
    inner.location = (XLEFT, 0.0, SEAM_Z + 0.01)
    inner.scale = (max(0.004, min(xf + 0.05, W / 2 * 1.04) - XLEFT), 1, 0.24)
    inner.keyframe_insert("location", frame=f); inner.keyframe_insert("scale", frame=f)
    keyv(inner_vis, f, 1.2 * sstep(99.5, 102, f) * (1.0 - sstep(107, 112, f)))
    tx_ = min(xf, W / 2 * 1.02)
    tip.location = (tx_, -0.05, seam_z(max(-W / 2, min(W / 2, tx_))) + 0.004)
    tip.scale = [0.10 + 0.08 * bump(98, 110, f)] * 3
    tip.keyframe_insert("location", frame=f); tip.keyframe_insert("scale", frame=f)
    keyv(tip_vis, f, sstep(98.5, 100.5, f) * (1.0 - sstep(108.5, 110.5, f)))

# ---- v3: a few tiny foil GLINTS at the peel point (no paper shreds) ----------
glint_m = fx_mat("Glint", GOLD_HI, 1.8, shape_radial(3.0), hot_pow=2.0)
random.seed(11)
for k in range(7):
    f0 = 100.3 + k * 1.15
    gl = quad_xz(f"Glint{k}", parent=pivot)
    gl.data.materials.append(glint_m)
    x0 = max(-W / 2, min(W / 2, tear_x(f0)))
    p0 = (x0, -0.045, seam_z(x0) + 0.005)
    vel = (random.uniform(-0.25, 0.25), -0.05, random.uniform(0.25, 0.6))
    size = random.uniform(0.035, 0.055)
    for f in range(1, FRAMES + 1):
        tt = max(0.0, (f - f0) / FPS)
        gl.location = (p0[0] + vel[0] * tt, p0[1], p0[2] + vel[2] * tt)
        sc = max(0.0001, size * bump(f0 - 1, f0 + 8, f))
        gl.scale = (sc, sc, sc)
        gl.keyframe_insert("location", frame=f); gl.keyframe_insert("scale", frame=f)

# ---- Burst: white flash, gold shockwave rings, sparks, then light rays ------
flash_m = fx_mat("Flash", (1.0, 0.86, 0.55), 2.4, shape_radial(2.6), hot=(1, 1, 1), hot_pow=0.8)
flash = quad_xz("Flash", parent=pivot)
flash.location = (0, -0.06, SEAM_Z + 0.09)
flash.data.materials.append(flash_m)
fv = flash_m.node_tree.nodes["Vis"].outputs[0]
for f in range(1, FRAMES + 1):
    flash.scale = [0.2 + 0.65 * ease_out(F_B - 2, F_B + 3, f, 2.5)] * 3
    flash.keyframe_insert("scale", frame=f)
    keyv(fv, f, 0.7 * sstep(F_B - 2.0, F_B, f) * (1.0 - sstep(F_B, F_B + 3, f)))

burst_ld = bpy.data.lights.new("BurstLight", type="POINT"); burst_ld.color = (1.0, 0.85, 0.55)
burst_ld.shadow_soft_size = 0.2
burst_l = bpy.data.objects.new("BurstLight", burst_ld); scene.collection.objects.link(burst_l)
burst_l.parent = pivot; burst_l.location = (0, -0.25, SEAM_Z + 0.05)
for f in range(1, FRAMES + 1):
    burst_ld.energy = 2.5 * sstep(F_B - 2, F_B + 1, f) * (1.0 - sstep(F_B + 1, F_B + 18, f)) + 1.2 * sstep(F_B + 4, F_B + 20, f)
    burst_ld.keyframe_insert("energy", frame=f)

# World-space burst origin = the seam at the burst frame (rings + sparks do not
# follow the pack's later sway).
scene.frame_set(F_B)
bpy.context.view_layer.update()
BURST_W = pivot.matrix_world @ Vector((0.0, -0.06, SEAM_Z + 0.02))

RINGS = ((0, 2.6, 1.0, 0.11),) if GAME else ((0, 2.6, 1.0, 0.11), (3, 1.9, 0.55, 0.07))   # GAME: one ring, no fill (WebP size)
for ri, (delay, rmax, gain, wid) in enumerate(RINGS):
    ring_m = fx_mat(f"Shock{ri}", GOLD_HI, 1.15, shape_ring(0.84, wid, 0.0 if GAME else (0.16 if ri == 0 else 0.0)), hot_pow=6.0)
    if RARE_G:
        rainbow_tint(ring_m, -math.pi, math.pi, white=0.08)
    ring = quad_xz(f"Shock{ri}")
    ring.location = BURST_W
    ring.rotation_euler = (math.radians(-12), 0, 0)
    ring.data.materials.append(ring_m)
    rv = ring_m.node_tree.nodes["Vis"].outputs[0]
    f0 = F_B + delay
    for f in range(1, FRAMES + 1):
        ring.scale = [0.12 + rmax * ease_out(f0 - 0.5, f0 + 20, f, 3.2)] * 3
        ring.keyframe_insert("scale", frame=f)
        keyv(rv, f, gain * sstep(f0 - 1, f0 + 1.5, f) * (1.0 - sstep(f0 + 3, f0 + 21, f)))

# RARE: a burst of four- and five-point STAR sparkles (mixed sizes + colours),
# twinkling as they fly out and fade.
STAR_COLS = [(1.0, 0.7, 0.08), (1.0, 0.25, 0.62), (0.15, 0.75, 1.0), (0.6, 0.32, 1.0), (1.0, 0.92, 0.3), (0.3, 1.0, 0.4)]


def star_obj(name, pts):
    v = [(0.0, 0.0, 0.0)]
    for i in range(2 * pts):
        a = math.pi / 2 + i * math.pi / pts
        r = 0.5 if i % 2 == 0 else (0.15 if pts == 4 else 0.2)
        v.append((r * math.cos(a), 0.0, r * math.sin(a)))
    return mesh_obj(name, v, [(0, i + 1, (i + 1) % (2 * pts) + 1) for i in range(2 * pts)])


if RARE_G:
    star_mats = [fx_mat(f"Star{i}", c, 1.3, shape_radial(0.3), hot=(1, 1, 1), hot_pow=14.0) for i, c in enumerate(STAR_COLS)]
    random.seed(31)
    for k in range(26):
        st = star_obj(f"Star{k}", 4 if k % 3 else 5)
        st.data.materials.append(star_mats[k % len(star_mats)])
        ang = random.uniform(-1.3, 1.3) if random.random() < 0.7 else random.uniform(0, 2 * math.pi)
        dx, dz = math.sin(ang), math.cos(ang)
        dist = random.uniform(0.4, 1.1)
        dy = random.uniform(-0.35, 0.1)
        f0 = F_B + random.uniform(-0.5, 3.0)
        life = random.uniform(15, 21)
        size = random.choice((0.08, 0.11, 0.15, 0.2)) * random.uniform(0.85, 1.15)
        per = random.uniform(7.0, 11.0); ph = random.uniform(0, 6.28)
        spin = random.uniform(-0.12, 0.12)
        for f in range(1, FRAMES + 1):
            e = ease_out(f0, f0 + life, f, 3.0)
            fall = 0.08 * sstep(f0 + 4, f0 + life, f)
            st.location = (BURST_W.x + dx * dist * e, BURST_W.y + dy * e, BURST_W.z + dz * dist * e - fall)
            st.rotation_euler = (0, spin * (f - f0) * (1.0 - 0.5 * e), 0)
            alive = sstep(f0 - 0.5, f0 + 1.5, f) * (1.0 - sstep(f0 + life * 0.5, f0 + life, f))
            tw = 0.7 + 0.3 * math.sin(2 * math.pi * (f - f0) / per + ph)
            sc = max(0.0001, size * alive * tw)
            st.scale = (sc, sc, sc)
            st.keyframe_insert("location", frame=f); st.keyframe_insert("rotation_euler", frame=f); st.keyframe_insert("scale", frame=f)

spark_m = fx_mat("Spark", GOLD_HI, 1.7, shape_streak(), hot_pow=2.5)
random.seed(23)
for k in range(0 if RARE_G else (28 if GAME else 46)):
    sp = mesh_obj(f"Spark{k}", [(-0.5, 0, 0), (0.5, 0, 0), (0.5, 0, 1), (-0.5, 0, 1)], [(0, 1, 2, 3)],
                  uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    sp.data.materials.append(spark_m)
    ang = random.uniform(-1.25, 1.25) if random.random() < 0.7 else random.uniform(0, 2 * math.pi)
    dx, dz = math.sin(ang), math.cos(ang)
    beta = math.atan2(dx, dz)
    dist = random.uniform(0.45, 1.15)
    dy = random.uniform(-0.35, 0.15)
    f0 = F_B + random.uniform(-0.5, 3.0)
    life = random.uniform(12, 18) if GAME else random.uniform(15, 27)
    width = random.uniform(0.010, 0.020)
    ln = random.uniform(0.10, 0.26)
    for f in range(1, FRAMES + 1):
        e = ease_out(f0, f0 + life, f, 3.0)
        fall = 0.10 * sstep(f0 + 4, f0 + life, f)
        sp.location = (BURST_W.x + dx * dist * e, BURST_W.y + dy * e, BURST_W.z + dz * dist * e - fall)
        sp.rotation_euler = (0, beta + 0.15 * sstep(f0, f0 + life, f) * (1 if dx < 0 else -1), 0)
        alive = sstep(f0 - 0.5, f0 + 1.0, f) * (1.0 - sstep(f0 + life * 0.55, f0 + life, f))
        speed_len = ln * (0.35 + 0.65 * (1.0 - e)) + 0.02
        sp.scale = (max(0.0001, width * alive), 1, max(0.0001, speed_len * alive))
        sp.keyframe_insert("location", frame=f); sp.keyframe_insert("rotation_euler", frame=f); sp.keyframe_insert("scale", frame=f)

# Light rays: the original seam fan (glow_fan), recoloured to the brand gold.
RAY_R = 1.7


def glow_fan(name, radius, seg=64, spread=math.radians(56)):
    verts = [(0.0, 0.0, 0.0)]
    a0 = math.radians(90) - spread / 2.0
    for i in range(seg + 1):
        a = a0 + spread * i / seg
        verts.append((math.cos(a) * radius, 0.0, math.sin(a) * radius))
    faces = [(0, i + 1, i + 2) for i in range(seg)]
    return mesh_obj(name, verts, faces)


def ray_gold_mat(name):
    def f(g, so, su):
        r = _radius(g, so, RAY_R)
        radial = g.m("POWER", g.m("MAXIMUM", g.m("SUBTRACT", 1.0, r), 0.0), 1.3)
        # v3: fade in ABOVE the opening (no bright fringe on the cut edge) ...
        rise = g.nt.nodes.new("ShaderNodeMapRange"); rise.interpolation_type = "SMOOTHSTEP"; rise.clamp = True
        rise.inputs["From Min"].default_value = SEAM_Z + 0.015; rise.inputs["From Max"].default_value = SEAM_Z + 0.16
        g.nt.links.new(so.outputs["Z"], rise.inputs["Value"])
        radial = g.m("MULTIPLY", radial, rise.outputs["Result"])
        # ... and grow outward with a 'Reach' value instead of scaling the fan.
        reach = g.nt.nodes.new("ShaderNodeValue"); reach.name = "Reach"; reach.outputs[0].default_value = 1.0
        front = g.m("SUBTRACT", 1.0, g.m("DIVIDE", g.m("MAXIMUM", g.m("SUBTRACT", r, g.m("SUBTRACT", reach.outputs[0], 0.15)), 0.0), 0.15))
        radial = g.m("MULTIPLY", radial, g.m("MAXIMUM", front, 0.0))
        ang = g.m("ARCTAN2", so.outputs["Z"], so.outputs["X"])
        b1 = g.m("POWER", g.m("MAXIMUM", g.m("SINE", g.m("MULTIPLY", ang, 30.0)), 0.0), 1.8)
        b2 = g.m("POWER", g.m("MAXIMUM", g.m("SINE", g.m("MULTIPLY_ADD", ang, 13.0, 1.3)), 0.0), 3.0)
        band = g.m("MAXIMUM", b1, g.m("MULTIPLY", b2, 0.8))
        return g.m("MULTIPLY", g.m("MULTIPLY", radial, band), 0.75)
    return fx_mat(name, GOLD_HI, 0.95, f, hot=GOLD_HI, hot_pow=5.0)


ray_root = new_empty("RayRoot", parent=pivot)
fan = glow_fan("RayGlow", RAY_R, seg=96, spread=math.radians(62))
rmat = ray_gold_mat("RayGlow")
if RARE_G:
    rainbow_tint(rmat, math.radians(90 - 31), math.radians(90 + 31), white=0.0)
    rmat.node_tree.nodes["Boost"].outputs[0].default_value = 1.15
fan.data.materials.append(rmat)
fan.parent = ray_root
rvis = rmat.node_tree.nodes["Vis"].outputs[0]
for f in range(1, FRAMES + 1):
    grow = ease_out(F_B + 1, F_B + 10, f, 3.0)
    keyv(rmat.node_tree.nodes["Reach"].outputs[0], f, 0.2 + 0.95 * grow - 0.05 * sstep(F_B + 10, F_B + 18 if GAME else F_B + 24, f))
    ray_root.rotation_euler = (0, 0 if GAME else math.radians(5) * math.sin((f - F_B) / 22.0) * sstep(F_B, F_B + 10, f), 0)
    ray_root.keyframe_insert("scale", frame=f); ray_root.keyframe_insert("rotation_euler", frame=f)
    keyv(rvis, f, (1.7 if RARE_G else 1.0) * sstep(F_B + 0.5, F_B + 5, f) * (1.0 - 0.3 * sstep(F_B + 12, F_B + 20 if GAME else FRAMES, f)))

# ---- Camera + lights ------------------------------------------------------------
cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.radians(90), 0, 0)
cam.location = (0, -2.4, 0.08)
cam_data.lens = 52


def area(name, loc, rot, energy, size):
    ld = bpy.data.lights.new(name, type="AREA")
    ld.energy = energy
    ld.size = size
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = rot
    scene.collection.objects.link(o)
    return o


key_l = area("Key", (2.4, -3.4, 3.2), (math.radians(50), 0, math.radians(34)), 800, 2.2)
key_l.data.color = (1.0, 0.97, 0.9)
area("Fill", (-2.8, -3.0, 0.6), (math.radians(78), 0, math.radians(-34)), 70, 6)
rim = area("Rim", (-0.6, 3.2, 2.6), (math.radians(-118), 0, math.radians(-8)), 700, 2.5)
rim.data.color = (1.0, 0.85, 0.6)
acc = area("Accent", (-3.2, -1.6, 0.4), (math.radians(90), 0, math.radians(-70)), 300, 3)
acc.data.color = (0.8, 0.35, 1.0)


# ---- Interpolation pass: Bezier everywhere, linear only for tear shape keys ---
def all_fcurves(ad):
    # Blender 5 shares ONE action between an object and its shape keys (slots),
    # so only walk the channelbag of this holder's own slot.
    action = ad.action
    if hasattr(action, "layers"):
        for layer in action.layers:
            for strip in layer.strips:
                cb = strip.channelbag(ad.action_slot)
                if cb:
                    for fc in cb.fcurves:
                        yield fc
    else:
        for fc in action.fcurves:
            yield fc


n_lin = n_bez = 0
holders = list(bpy.data.objects) + [m.node_tree for m in bpy.data.materials if m.node_tree] + list(bpy.data.lights) + list(bpy.data.shape_keys)
for holder in holders:
    ad = getattr(holder, "animation_data", None)
    if not ad or not ad.action:
        continue
    lin = isinstance(holder, bpy.types.Key)
    for fc in all_fcurves(ad):
        for kp in fc.keyframe_points:
            if lin:
                kp.interpolation = "LINEAR"; n_lin += 1
            elif fc.data_path != "hide_render":
                kp.interpolation = "BEZIER"; n_bez += 1
                kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()
print("KEYS bezier", n_bez, "linear(shape-key crossfade)", n_lin)

# ---- GAME clips: compress the charge-up to ~1 s, then retime to 60 ms frames -------
# v4 timeline (30 fps): idle 1-45 | charge 46-96 | tear 96-110 | burst + rays -> 144.
# Game: the charge 46-96 (50 frames) plays in 30 frames; then every key is moved to
# 60 ms frames (like today's tear_open.webp): idle = 25 frames, open = 39 frames.
WEBP_STEP = 1.8   # 30 fps frames per 60 ms frame


def game_time(f):
    h = f if f <= 46 else (46 + (f - 46) * 0.6 if f <= 96 else f - 20)
    return 1 + (h - 1) / WEBP_STEP


GAME_IDLE = (1, 25)                                     # 25 x 60 ms = 1.5 s, loops
GAME_OPEN = (26, int(math.floor(game_time(135))))       # charge -> tear -> burst -> rays
if GAME:
    for holder in holders:
        ad = getattr(holder, "animation_data", None)
        if not ad or not ad.action:
            continue
        for fc in all_fcurves(ad):
            for kp in fc.keyframe_points:
                kp.co.x = game_time(kp.co.x)
                kp.handle_left.x = game_time(kp.handle_left.x)
                kp.handle_right.x = game_time(kp.handle_right.x)
            fc.update()
    scene.render.resolution_x = 800
    scene.render.resolution_y = 1120
    scene.render.fps = 50
    scene.render.fps_base = 3.0   # 16.67 fps = 60 ms per frame
    scene.frame_start, scene.frame_end = 1, GAME_OPEN[1]
    print("GAME idle", GAME_IDLE, "open", GAME_OPEN)

# ---- Save + render ----------------------------------------------------------------
os.makedirs(OUT_DIR, exist_ok=True)
scene.frame_set(1)
if "save" in argv and not GAME:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "pack_open.blend"))
ONLY = [int(a[2:]) for a in argv if a.startswith("f=")]
if bpy.app.background:
    if GAME:
        clips = (("open", GAME_OPEN),) if RARE_G else (("idle", GAME_IDLE), ("open", GAME_OPEN))
        for clip, (a, b) in clips:
            os.makedirs(os.path.join(OUT_DIR, clip), exist_ok=True)
            for fr in range(a, b + 1):
                scene.frame_set(fr)
                scene.render.filepath = os.path.join(OUT_DIR, clip, "f_%04d.png" % (fr - a + 1))
                bpy.ops.render.render(write_still=True)
        if not RARE_G:
            # the frame after the idle loop (must equal idle frame 1) for the seam check
            scene.frame_set(GAME_IDLE[1] + 1)
            scene.render.filepath = os.path.join(OUT_DIR, "seam_check_next.png")
            bpy.ops.render.render(write_still=True)
    elif ONLY:
        for fr in ONLY:
            scene.frame_set(fr)
            scene.render.filepath = os.path.join(OUT_DIR, "f_%04d.png" % fr)
            bpy.ops.render.render(write_still=True)
    else:
        scene.render.filepath = os.path.join(OUT_DIR, "f_")
        bpy.ops.render.render(animation=True)
    print("RENDERED ->", OUT_DIR)
