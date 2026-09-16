"""PROTOTYPE — booster pack opening animation.

A thin crinkled foil pack shakes, its top tears off, and the cards rise out and
fan close together so the art reads. A Secret-Rare-or-better pull adds a quick
sunlight flash + a burst of sparkles out of the pack.

Rendered on a transparent film so it overlays in the Discord Activity (the real
card faces are composited by the app; here the cards are coloured stand-ins).

Headless:  blender --background --python pack_open.py -- <outDir> [frames] [rare]
Live GUI:  blender --python pack_open.py -- <outDir> [frames] [rare]
Encode:    python encode.py <outDir> <outDir>/pack_open.webp 1
"""
import bpy
import math
import os
import random
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "..", "out", "proto_pack")
FRAMES = int(argv[1]) if len(argv) > 1 else 54
RARE = "rare" in argv or "1" in argv
# INTRO = the reusable "wrapper": the pack shakes + tears open, no cards emerge
# (the app composites the real face-down cards). Ends on the burst.
INTRO = "intro" in argv
# HERO = one dramatic still of the intact pack, angled for depth (a product shot).
HERO = "hero" in argv
if HERO:
    INTRO = True  # no emerging cards

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
scene.frame_end = FRAMES

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


def emissive(name, color, strength=2.0, rough=0.45, metallic=0.0, base=None):
    # base=(0,0,0) makes the surface pure-emission, so scene lights can't wash it
    # out (used for the card faces, which are lit by their own art, not the lamps).
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*(base if base else color), 1.0)
    b.inputs["Emission Color"].default_value = (*color, 1.0)
    b.inputs["Emission Strength"].default_value = strength
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    return m


def foil(name, color):
    """Crinkled metallic foil: high metallic + a noise bump for the creases."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.3
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 26.0
    noise.inputs["Detail"].default_value = 5.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def holo_foil(name, color, art_path=None, holo=0.6):
    """Holographic tinfoil: metallic base (or a crest image) with a view-dependent
    rainbow sheen that shifts as the pack tilts + a crinkle bump. If art_path is
    given the crest image shows through, overlaid with the rainbow."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Metallic"].default_value = 1.0 if art_path is None else 0.35
    b.inputs["Roughness"].default_value = 0.16

    # Rainbow value: a UV/position gradient + the facing angle, wrapped 0..1.
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    grad = nt.nodes.new("ShaderNodeMath"); grad.operation = "ADD"
    nt.links.new(sep.outputs["X"], grad.inputs[0]); nt.links.new(sep.outputs["Y"], grad.inputs[1])
    bands = nt.nodes.new("ShaderNodeMath"); bands.operation = "MULTIPLY"; bands.inputs[1].default_value = 7.0
    nt.links.new(grad.outputs["Value"], bands.inputs[0])
    shift = nt.nodes.new("ShaderNodeMath"); shift.operation = "MULTIPLY"; shift.inputs[1].default_value = 7.0
    nt.links.new(lw.outputs["Facing"], shift.inputs[0])
    summ = nt.nodes.new("ShaderNodeMath"); summ.operation = "ADD"
    nt.links.new(bands.outputs["Value"], summ.inputs[0]); nt.links.new(shift.outputs["Value"], summ.inputs[1])
    wrap = nt.nodes.new("ShaderNodeMath"); wrap.operation = "WRAP"; wrap.inputs[1].default_value = 1.0; wrap.inputs[2].default_value = 0.0
    nt.links.new(summ.outputs["Value"], wrap.inputs[0])
    rb = nt.nodes.new("ShaderNodeValToRGB"); cr = rb.color_ramp
    cr.elements[0].color = (1, 0.15, 0.15, 1); cr.elements[1].position = 1.0; cr.elements[1].color = (1, 0.15, 0.15, 1)
    for pos, col in [(0.17, (1, 1, 0.2, 1)), (0.34, (0.2, 1, 0.3, 1)), (0.5, (0.2, 1, 1, 1)), (0.67, (0.3, 0.4, 1, 1)), (0.84, (1, 0.3, 1, 1))]:
        cr.elements.new(pos).color = col
    nt.links.new(wrap.outputs["Value"], rb.inputs["Fac"])

    if art_path:
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(art_path)
        mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "OVERLAY"; mix.inputs[0].default_value = holo
        nt.links.new(tex.outputs["Color"], mix.inputs[1]); nt.links.new(rb.outputs["Color"], mix.inputs[2])
        nt.links.new(mix.outputs[0], b.inputs["Base Color"])
        nt.links.new(mix.outputs[0], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 1.0
        nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
        try: m.surface_render_method = "BLENDED"
        except Exception: pass
        try: m.blend_method = "BLEND"
        except Exception: pass
    else:
        mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "SCREEN"; mix.inputs[0].default_value = holo
        mix.inputs[1].default_value = (*color, 1.0)
        nt.links.new(rb.outputs["Color"], mix.inputs[2])
        nt.links.new(mix.outputs[0], b.inputs["Base Color"])
    # A fine crinkle so the metal reads as foil, not plastic.
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 40.0; noise.inputs["Detail"].default_value = 4.0
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.18
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def pouch_material(name, front_art, back_art, pack_w, pack_h, base=(0.9, 0.73, 0.35)):
    """A fully-enclosed foil pouch: the FRONT wrapper art (spiral + lion crest) on
    the front face, the BACK wrapper art (spiral only) on the back face, and plain
    holographic tinfoil on the sealed sides + crimped lips. Front/back/side is read
    from a per-face "region" attribute (not the normal), so the art stays put even
    when the torn cap tumbles. Art is placed in OBJECT space for the same reason."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    b.inputs["Metallic"].default_value = 1.0   # tinfoil = full metal (art lowers it below)
    b.inputs["Roughness"].default_value = 0.22

    # Holo rainbow sheen value (shared by foil + crest).
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.5
    tc = nt.nodes.new("ShaderNodeTexCoord")
    g = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Generated"], g.inputs[0])
    grad = nt.nodes.new("ShaderNodeMath"); grad.operation = "ADD"; nt.links.new(g.outputs["X"], grad.inputs[0]); nt.links.new(g.outputs["Z"], grad.inputs[1])
    bands = nt.nodes.new("ShaderNodeMath"); bands.operation = "MULTIPLY"; bands.inputs[1].default_value = 7.0; nt.links.new(grad.outputs["Value"], bands.inputs[0])
    shift = nt.nodes.new("ShaderNodeMath"); shift.operation = "MULTIPLY"; shift.inputs[1].default_value = 7.0; nt.links.new(lw.outputs["Facing"], shift.inputs[0])
    summ = nt.nodes.new("ShaderNodeMath"); summ.operation = "ADD"; nt.links.new(bands.outputs["Value"], summ.inputs[0]); nt.links.new(shift.outputs["Value"], summ.inputs[1])
    wrap = nt.nodes.new("ShaderNodeMath"); wrap.operation = "WRAP"; wrap.inputs[1].default_value = 1.0; wrap.inputs[2].default_value = 0.0; nt.links.new(summ.outputs["Value"], wrap.inputs[0])
    rb = nt.nodes.new("ShaderNodeValToRGB"); cr = rb.color_ramp
    cr.elements[0].color = (1, 0.15, 0.15, 1); cr.elements[1].position = 1.0; cr.elements[1].color = (1, 0.15, 0.15, 1)
    for pos, col in [(0.17, (1, 1, 0.2, 1)), (0.34, (0.2, 1, 0.3, 1)), (0.5, (0.2, 1, 1, 1)), (0.67, (0.3, 0.4, 1, 1)), (0.84, (1, 0.3, 1, 1))]:
        cr.elements.new(pos).color = col
    nt.links.new(wrap.outputs["Value"], rb.inputs["Fac"])
    foil = nt.nodes.new("ShaderNodeMixRGB"); foil.blend_type = "SCREEN"; foil.inputs[0].default_value = 0.5; foil.inputs[1].default_value = (*base, 1.0)
    nt.links.new(rb.outputs["Color"], foil.inputs[2])

    # Wrapper art placed in OBJECT space (u = x/W + 0.5, v = z/H + 0.5), so it
    # sticks to the mesh and the torn cap keeps its art as it flies off.
    og = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], og.inputs[0])
    ux = nt.nodes.new("ShaderNodeMath"); ux.operation = "MULTIPLY_ADD"; ux.inputs[1].default_value = 1.0 / pack_w; ux.inputs[2].default_value = 0.5; nt.links.new(og.outputs["X"], ux.inputs[0])
    vz = nt.nodes.new("ShaderNodeMath"); vz.operation = "MULTIPLY_ADD"; vz.inputs[1].default_value = 1.0 / pack_h; vz.inputs[2].default_value = 0.5; nt.links.new(og.outputs["Z"], vz.inputs[0])
    combo = nt.nodes.new("ShaderNodeCombineXYZ"); nt.links.new(ux.outputs[0], combo.inputs[0]); nt.links.new(vz.outputs[0], combo.inputs[1])
    ftex = nt.nodes.new("ShaderNodeTexImage"); ftex.image = bpy.data.images.load(front_art); ftex.extension = "EXTEND"
    btex = nt.nodes.new("ShaderNodeTexImage"); btex.image = bpy.data.images.load(back_art); btex.extension = "EXTEND"
    nt.links.new(combo.outputs[0], ftex.inputs["Vector"]); nt.links.new(combo.outputs[0], btex.inputs["Vector"])
    # FRONT / BACK / SIDE from a per-face attribute: 0 = front, 0.5 = side, 1 = back.
    reg = nt.nodes.new("ShaderNodeAttribute"); reg.attribute_name = "region"; reg.attribute_type = "GEOMETRY"
    frontmask = nt.nodes.new("ShaderNodeMath"); frontmask.operation = "LESS_THAN"; frontmask.inputs[1].default_value = 0.25; nt.links.new(reg.outputs["Fac"], frontmask.inputs[0])
    backmask = nt.nodes.new("ShaderNodeMath"); backmask.operation = "GREATER_THAN"; backmask.inputs[1].default_value = 0.75; nt.links.new(reg.outputs["Fac"], backmask.inputs[0])

    # Base colour: foil -> paint back art on the back -> paint front art on the front.
    back_mix = nt.nodes.new("ShaderNodeMixRGB"); nt.links.new(backmask.outputs[0], back_mix.inputs[0])
    nt.links.new(foil.outputs[0], back_mix.inputs[1]); nt.links.new(btex.outputs["Color"], back_mix.inputs[2])
    base_mix = nt.nodes.new("ShaderNodeMixRGB"); nt.links.new(frontmask.outputs[0], base_mix.inputs[0])
    nt.links.new(back_mix.outputs[0], base_mix.inputs[1]); nt.links.new(ftex.outputs["Color"], base_mix.inputs[2])
    nt.links.new(base_mix.outputs[0], b.inputs["Base Color"])

    # A faint holo shimmer over the printed art so it still catches the light.
    artcol = nt.nodes.new("ShaderNodeMixRGB"); nt.links.new(backmask.outputs[0], artcol.inputs[0])
    nt.links.new(ftex.outputs["Color"], artcol.inputs[1]); nt.links.new(btex.outputs["Color"], artcol.inputs[2])
    art_holo = nt.nodes.new("ShaderNodeMixRGB"); art_holo.blend_type = "OVERLAY"; art_holo.inputs[0].default_value = 0.25
    nt.links.new(artcol.outputs[0], art_holo.inputs[1]); nt.links.new(rb.outputs["Color"], art_holo.inputs[2])
    artmask = nt.nodes.new("ShaderNodeMath"); artmask.operation = "ADD"; nt.links.new(frontmask.outputs[0], artmask.inputs[0]); nt.links.new(backmask.outputs[0], artmask.inputs[1])
    emis = nt.nodes.new("ShaderNodeMixRGB"); nt.links.new(artmask.outputs[0], emis.inputs[0]); emis.inputs[1].default_value = (0, 0, 0, 1)
    nt.links.new(art_holo.outputs[0], emis.inputs[2])
    nt.links.new(emis.outputs[0], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = 0.6

    # Printed art reads as ink on foil: drop Metallic on the art faces (foil=1.0,
    # art~0.35), so the sealed sides stay mirror-bright tinfoil and the art matte.
    met = nt.nodes.new("ShaderNodeMath"); met.operation = "MULTIPLY_ADD"
    met.inputs[1].default_value = -0.65; met.inputs[2].default_value = 1.0
    nt.links.new(artmask.outputs[0], met.inputs[0]); nt.links.new(met.outputs[0], b.inputs["Metallic"])

    # Crinkled tinfoil: two octaves of fine wrinkles in the surface normal, so the
    # reflections break up like crimped foil instead of a smooth plastic sheet.
    fine = nt.nodes.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 220.0; fine.inputs["Detail"].default_value = 3.0
    coarse = nt.nodes.new("ShaderNodeTexNoise"); coarse.inputs["Scale"].default_value = 32.0; coarse.inputs["Detail"].default_value = 4.0
    crmix = nt.nodes.new("ShaderNodeMixRGB"); crmix.inputs[0].default_value = 0.5
    nt.links.new(coarse.outputs["Fac"], crmix.inputs[1]); nt.links.new(fine.outputs["Fac"], crmix.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.16
    nt.links.new(crmix.outputs[0], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def crimp_strip(name, width, inner_z, out_dir, mat, teeth=24, tooth=0.026, band=0.045, y=-0.01):
    """A crimped/pinked sealed edge: a solid foil band with a zigzag (pinked)
    outer edge — the classic tinfoil-pack seal. out_dir +1 = top, -1 = bottom."""
    x0 = -width / 2
    step = width / teeth
    base_z = inner_z - out_dir * band  # solid inner edge (toward the pack body)
    verts = []
    base = []
    inner = []
    for i in range(teeth + 1):
        x = x0 + i * step
        base.append(len(verts)); verts.append((x, y, base_z))
    for i in range(teeth + 1):
        x = x0 + i * step
        inner.append(len(verts)); verts.append((x, y, inner_z))
    tips = []
    for i in range(teeth):
        xc = x0 + (i + 0.5) * step
        tips.append(len(verts)); verts.append((xc, y, inner_z + out_dir * tooth))
    faces = []
    for i in range(teeth):
        faces.append((base[i], base[i + 1], inner[i + 1], inner[i]))  # solid band
        faces.append((inner[i], tips[i], inner[i + 1]))               # pinked teeth
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def build_pouch(name, W, H, mat, nx=30, ny=52, seal=0.0015, thick=0.05, lip=0.07, flare_amt=0.1, tear_frac=None):
    """ONE closed foil pouch shaped like the real thing: a front sheet and a back
    sheet, sealed together down both sides and pressed FLAT at clean lips on BOTH
    ends (like a crimping machine squished a tinfoil sleeve — the foil flares out
    a little at the very edge). The middle holds a flat rectangular STACK of cards,
    so the front and back are nearly flat and parallel over the card area.

    Returns (body, cap). With tear_frac set, the mesh is split at a ragged tear
    line near the top into a BODY (keeps, ragged open top) and a CAP (the torn
    top seal, flies off). With tear_frac=None it is one sealed pouch and cap=None."""
    hw, hh = W / 2.0, H / 2.0

    def shoulder(x, m):
        # 1 across the middle, smoothly to 0 at x=0 and x=1 over a margin m.
        if x < m:
            s = x / m
        elif x > 1.0 - m:
            s = (1.0 - x) / m
        else:
            return 1.0
        return s * s * (3.0 - 2.0 * s)

    def pillow(u, v):
        # Thin seal inside the lip zones; a flat slab (the card stack) across the
        # body with short rounded shoulders at the edges — not a swollen dome.
        if v <= lip or v >= 1.0 - lip:
            return 0.0
        t = (v - lip) / (1.0 - 2.0 * lip)
        return thick * shoulder(t, 0.07) * shoulder(u, 0.05)

    verts = []
    F = [[0] * nx for _ in range(ny)]
    B = [[0] * nx for _ in range(ny)]
    for iz in range(ny):
        v = iz / (ny - 1)
        z = -hh + v * H
        # A clean, squished seal: the side runs straight down, then flares out on
        # a straight DIAGONAL (a chamfer) to a flat flange edge — wider than the
        # body but a clean angled corner, not a horn and not a pointed ear.
        edge = 0.0
        if v < lip:
            edge = 1.0 - v / lip
        elif v > 1.0 - lip:
            edge = (v - (1.0 - lip)) / lip
        s = max(0.0, (edge - 0.55) / 0.45)   # straight side, then linear flare
        flare = 1.0 + flare_amt * s
        for row, sign in ((F, -1.0), (B, +1.0)):
            for ix in range(nx):
                u = ix / (nx - 1)
                x = (-hw + u * W) * flare
                d = seal / 2.0 + pillow(u, v)
                row[iz][ix] = len(verts)
                verts.append((x, sign * d, z))
    # Ragged tear near the top. The cut is a SINGLE clean row, so there are no
    # stair-stepped teeth; the ragged look comes from DISPLACING that edge's
    # vertices to continuous, organic heights. Neighbouring columns connect with
    # diagonals and sharp fibres — a real torn-foil edge, not a digital barcode.
    # The shift tapers smoothly over a band of rows below the edge, so the body
    # deforms naturally instead of folding.
    if tear_frac is not None:
        R = int(round(tear_frac * (ny - 1)))
        rowH = H / (ny - 1)
        random.seed(5)
        octs = [(2.1, random.uniform(0, 6.2831853), 1.0),
                (4.7, random.uniform(0, 6.2831853), 0.60),
                (9.3, random.uniform(0, 6.2831853), 0.34),
                (19.0, random.uniform(0, 6.2831853), 0.20),
                (37.0, random.uniform(0, 6.2831853), 0.12)]
        norm = sum(a for _, _, a in octs)
        jag = []
        for ix in range(nx):
            u = ix / (nx - 1)
            wander = sum(a * math.sin(u * f * 6.2831853 + ph) for f, ph, a in octs) / norm
            fibre = random.uniform(-0.7, 0.7)   # fine per-column fray
            jag.append((wander * 2.4 + fibre) * rowH)
        K = 7   # blend the shift over this many rows below the cut
        for ix in range(nx):
            lo = max(0, R - K)
            for r in range(lo, R + 1):
                t = (r - lo) / (R - lo) if R > lo else 1.0
                t = t * t * (3.0 - 2.0 * t)   # smoothstep taper
                dz = jag[ix] * t
                for arr in (F, B):
                    vi = arr[r][ix]
                    vx, vy, vz = verts[vi]
                    verts[vi] = (vx, vy, vz + dz)
        tear = [R] * nx   # clean split row; raggedness is in the z-shift above
    else:
        tear = [ny + 1] * nx   # nothing tears — all one body

    # Collect faces tagged with (region, is_cap). region: 0 front, 0.5 side, 1 back.
    tagged = []   # (quad, region, is_cap)
    for iz in range(ny - 1):
        for ix in range(nx - 1):
            cap = iz >= tear[ix]
            tagged.append(((F[iz][ix], F[iz][ix + 1], F[iz + 1][ix + 1], F[iz + 1][ix]), 0.0, cap))
            tagged.append(((B[iz + 1][ix], B[iz + 1][ix + 1], B[iz][ix + 1], B[iz][ix]), 1.0, cap))
    for iz in range(ny - 1):  # the two long sealed sides
        tagged.append(((B[iz][0], B[iz + 1][0], F[iz + 1][0], F[iz][0]), 0.5, iz >= tear[0]))
        r = nx - 1
        tagged.append(((F[iz][r], F[iz + 1][r], B[iz + 1][r], B[iz][r]), 0.5, iz >= tear[nx - 1]))
    for ix in range(nx - 1):  # bottom lip -> body; top lip -> cap (or body if no tear)
        tagged.append(((F[0][ix], F[0][ix + 1], B[0][ix + 1], B[0][ix]), 0.5, False))
        t = ny - 1
        tagged.append(((B[t][ix], B[t][ix + 1], F[t][ix + 1], F[t][ix]), 0.5, tear_frac is not None))

    def make_obj(nm, subset):
        used, vlist, faces, regions = {}, [], [], []
        def rv(i):
            if i not in used:
                used[i] = len(vlist); vlist.append(verts[i])
            return used[i]
        for quad, region, _ in subset:
            faces.append(tuple(rv(i) for i in quad)); regions.append(region)
        mesh = bpy.data.meshes.new(nm)
        mesh.from_pydata(vlist, [], faces)
        mesh.update()
        for p in mesh.polygons:
            p.use_smooth = True
        attr = mesh.attributes.new("region", "FLOAT", "FACE")
        for i, rgn in enumerate(regions):
            attr.data[i].value = rgn
        o = bpy.data.objects.new(nm, mesh)
        scene.collection.objects.link(o)
        o.data.materials.append(mat)
        ss = o.modifiers.new("PSmooth", "SUBSURF")
        ss.subdivision_type = "SIMPLE"; ss.levels = 1; ss.render_levels = 2
        return o

    body = make_obj(name, [t for t in tagged if not t[2]])
    if tear_frac is None:
        return body, None
    cap = make_obj(name + "Cap", [t for t in tagged if t[2]])
    return body, cap


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


# ---- The pack: holographic tinfoil, full crest, crimped edges, ragged rip ---
# Camera looks along +Y; up is +Z, right is +X, toward camera is -Y.
front_art = os.path.join(os.path.dirname(__file__), "pack_front.png")  # spiral + crest
back_art = os.path.join(os.path.dirname(__file__), "pack_back.png")    # spiral only
W, H = 0.54, 1.02  # pack front: tall + slim, like a card rectangle (ratio ~1.9)

# The pack is ONE flattened foil sleeve, sealed + pinked flat at both ends by a
# crimping machine and puffed into a pillow where the cards sit. Crest on front.
# When opening (not HERO), the mesh is split at a ragged tear line so the top
# seal (cap) rips off and the body is left with a torn, open top.
pouch_mat = pouch_material("Pouch", front_art, back_art, W, H) if os.path.exists(front_art) else holo_foil("PackFoil", (0.92, 0.74, 0.36))
pack, cap = build_pouch("Pack", W, H, pouch_mat, nx=130, ny=90, thick=0.028, tear_frac=(None if HERO else 0.84))
face = None
fold = None
crimp_bot = None

# The pivot: the body + the cap shake together until the cap tears free.
bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
pivot = bpy.context.active_object
pivot.name = "PackPivot"
for part in (pack, cap, face, fold, crimp_bot):
    if part:
        part.parent = pivot

# ---- Cards that rise out (bigger, fanned close together) --------------------
CARD_COLORS = [(0.35, 0.62, 1.0), (0.72, 0.45, 1.0), (1.0, 0.55, 0.35), (0.4, 1.0, 0.66), (1.0, 0.84, 0.3)]
N = 0 if INTRO else 5  # the intro wrapper has no emerging cards; the app adds them
cards = []
for i in range(N):
    bpy.ops.mesh.primitive_plane_add(size=1)
    c = bpy.context.active_object
    c.name = f"Card{i}"
    c.scale = (0.58, 0.78, 1.0)                    # bigger
    c.rotation_euler = (math.radians(90), 0, 0)    # face the camera (-Y)
    c.location = (0, 0.02 + 0.006 * i, -0.12)       # tucked inside the thin pack
    strength = 1.3 if (RARE and i == N - 1) else 1.0
    c.data.materials.append(emissive(f"Card{i}", CARD_COLORS[i], strength))
    cards.append(c)

# ---- Light rays that pour OUT of the tear seam (from inside the pack) --------
# Replaces the old white "burst" blob. A soft rainbow glow-fan + crisp white ray
# spikes + a bright seam line, all rooted at the opening, so light bursts up and
# out of the pack as the cap rips (the Pokemon-Pocket "open" look). Rays sit at
# the card-stack depth, so the torn body edge occludes their base — they read as
# escaping from INSIDE the pack, not floating in front of it.
SEAM_Z = -H / 2.0 + 0.84 * H   # the tear line (matches build_pouch(tear_frac=0.84))
CENTER_Z = 0.0                 # the pack's vertical middle (the swirl / lion focal point)
RAY_R = 1.7                    # how far the longest rays reach from the pack centre


def glow_fan(name, radius, seg=64, spread=math.radians(56)):
    """A flat half-disc fan in the XZ plane (faces the camera), rooted at the
    origin and opening straight up, spanning `spread` degrees."""
    verts = [(0.0, 0.0, 0.0)]
    a0 = math.radians(90) - spread / 2.0
    for i in range(seg + 1):
        a = a0 + spread * i / seg
        verts.append((math.cos(a) * radius, 0.0, math.sin(a) * radius))
    faces = [(0, i + 1, i + 2) for i in range(seg)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    return o


def ray_glow_mat(name):
    """Soft rainbow rays pouring from the seam. Angular banding cuts the solid fan
    into discrete rays with transparent gaps, a radial falloff fades them at the
    tips, and the hue shifts across the fan. Kept near strength 1 so the colour is
    not clamped to white by the Standard view transform."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(tc.outputs["Object"], sep.inputs[0])
    # normalised radius rn = sqrt(x^2 + z^2) / RAY_R
    x2 = nt.nodes.new("ShaderNodeMath"); x2.operation = "MULTIPLY"; nt.links.new(sep.outputs["X"], x2.inputs[0]); nt.links.new(sep.outputs["X"], x2.inputs[1])
    z2 = nt.nodes.new("ShaderNodeMath"); z2.operation = "MULTIPLY"; nt.links.new(sep.outputs["Z"], z2.inputs[0]); nt.links.new(sep.outputs["Z"], z2.inputs[1])
    r2 = nt.nodes.new("ShaderNodeMath"); r2.operation = "ADD"; nt.links.new(x2.outputs[0], r2.inputs[0]); nt.links.new(z2.outputs[0], r2.inputs[1])
    rr = nt.nodes.new("ShaderNodeMath"); rr.operation = "SQRT"; nt.links.new(r2.outputs[0], rr.inputs[0])
    rn = nt.nodes.new("ShaderNodeMath"); rn.operation = "DIVIDE"; rn.inputs[1].default_value = RAY_R; nt.links.new(rr.outputs[0], rn.inputs[0])
    # radial falloff = max(0, 1 - rn)
    inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0; nt.links.new(rn.outputs[0], inv.inputs[1])
    radial = nt.nodes.new("ShaderNodeMath"); radial.operation = "MAXIMUM"; radial.inputs[1].default_value = 0.0; nt.links.new(inv.outputs[0], radial.inputs[0])
    # angle a = arctan2(z, x)
    ang = nt.nodes.new("ShaderNodeMath"); ang.operation = "ARCTAN2"; nt.links.new(sep.outputs["Z"], ang.inputs[0]); nt.links.new(sep.outputs["X"], ang.inputs[1])
    # ray banding: pow(max(0, sin(a * 13)), 2.2) -> bright ray cores, clear gaps
    freq = nt.nodes.new("ShaderNodeMath"); freq.operation = "MULTIPLY"; freq.inputs[1].default_value = 30.0; nt.links.new(ang.outputs[0], freq.inputs[0])
    sinb = nt.nodes.new("ShaderNodeMath"); sinb.operation = "SINE"; nt.links.new(freq.outputs[0], sinb.inputs[0])
    posb = nt.nodes.new("ShaderNodeMath"); posb.operation = "MAXIMUM"; posb.inputs[1].default_value = 0.0; nt.links.new(sinb.outputs[0], posb.inputs[0])
    band = nt.nodes.new("ShaderNodeMath"); band.operation = "POWER"; band.inputs[1].default_value = 1.6; nt.links.new(posb.outputs[0], band.inputs[0])
    # alpha = radial * band * 0.62  (kept translucent so the rays read soft)
    a1 = nt.nodes.new("ShaderNodeMath"); a1.operation = "MULTIPLY"; nt.links.new(radial.outputs[0], a1.inputs[0]); nt.links.new(band.outputs[0], a1.inputs[1])
    a2 = nt.nodes.new("ShaderNodeMath"); a2.operation = "MULTIPLY"; a2.inputs[1].default_value = 0.62; nt.links.new(a1.outputs[0], a2.inputs[0])
    # rainbow hue by angle
    hue = nt.nodes.new("ShaderNodeMath"); hue.operation = "MULTIPLY_ADD"; hue.inputs[1].default_value = 1.0 / (2.0 * math.pi); hue.inputs[2].default_value = 0.5; nt.links.new(ang.outputs[0], hue.inputs[0])
    rbw = nt.nodes.new("ShaderNodeValToRGB"); rc = rbw.color_ramp
    rc.elements[0].color = (1, 0.4, 0.45, 1); rc.elements[-1].position = 1.0; rc.elements[-1].color = (1, 0.4, 0.45, 1)
    for pos, col in [(0.22, (1, 0.95, 0.5, 1)), (0.44, (0.5, 1, 0.6, 1)), (0.62, (0.45, 0.85, 1, 1)), (0.82, (0.75, 0.55, 1, 1))]:
        rc.elements.new(pos).color = col
    nt.links.new(hue.outputs[0], rbw.inputs["Fac"])
    # mostly the rainbow, with just a hint of white so the ray cores read bright
    mixw = nt.nodes.new("ShaderNodeMixRGB"); mixw.inputs[0].default_value = 0.82; mixw.inputs[1].default_value = (1, 1, 1, 1)
    nt.links.new(rbw.outputs["Color"], mixw.inputs[2])
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    b.inputs["Roughness"].default_value = 1.0
    nt.links.new(mixw.outputs[0], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.15
    nt.links.new(a2.outputs[0], b.inputs["Alpha"])
    try: m.surface_render_method = "BLENDED"
    except Exception: pass
    try: m.blend_method = "BLEND"
    except Exception: pass
    return m


def ray_spike(name, half_w, length, mat):
    """A thin crisp spike: narrow base at the seam, converging to a point outward
    along +Z (a single triangle in the XZ plane)."""
    verts = [(-half_w, 0.0, 0.0), (half_w, 0.0, 0.0), (0.0, 0.0, length)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [(0, 1, 2)])
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


ray_root = None
if not HERO:
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0.0, 0.0, CENTER_Z))
    ray_root = bpy.context.active_object
    ray_root.name = "RayRoot"

    fan = glow_fan("RayGlow", RAY_R)
    fan.data.materials.append(ray_glow_mat("RayGlow"))
    fan.parent = ray_root

# ---- Camera + lights (so the foil reads as shiny metal) ---------------------
cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.rotation_euler = (math.radians(90), 0, 0)
if HERO:  # tighter framing for a product shot that fills the portrait frame
    cam.location = (0, -3.6, 0.0)
    cam_data.lens = 58
else:      # animation: pack sits low so the torn cap has room to fly up + off
    cam.location = (0, -2.4, 0.12)
    cam_data.lens = 56


def area(name, loc, rot, energy, size):
    ld = bpy.data.lights.new(name, type="AREA")
    ld.energy = energy
    ld.size = size
    o = bpy.data.objects.new(name, ld)
    o.location = loc
    o.rotation_euler = rot
    scene.collection.objects.link(o)
    return o


# Dramatic, glossy lighting: a punchy key hotspot, a strong rim for edge glow,
# a soft fill, and a colored accent for mood.
key_l = area("Key", (2.4, -3.4, 3.2), (math.radians(50), 0, math.radians(34)), 800, 2.2)
key_l.data.color = (1.0, 0.97, 0.9)
area("Fill", (-2.8, -3.0, 0.6), (math.radians(78), 0, math.radians(-34)), 70, 6)
rim = area("Rim", (-0.6, 3.2, 2.6), (math.radians(-118), 0, math.radians(-8)), 700, 2.5)
rim.data.color = (0.8, 0.85, 1.0)
acc = area("Accent", (-3.2, -1.6, 0.4), (math.radians(90), 0, math.radians(-70)), 300, 3)
acc.data.color = (0.8, 0.35, 1.0)  # magenta rim on the left edge

# ---- Timeline ---------------------------------------------------------------
# 1-10  : pack idle + anticipation shake (the pivot moves body + face together).
# In HERO mode the pack instead holds a dynamic 3/4 pose for a product shot.
if HERO:
    pivot.rotation_euler = (math.radians(8), 0, math.radians(-21))
else:
    key(pivot, 1, rot=(0, 0, 0))
    key(pivot, 4, rot=(0, math.radians(5), 0))
    key(pivot, 7, rot=(0, math.radians(-5), 0))
    key(pivot, 10, rot=(0, 0, 0))
    key(pivot, FRAMES, rot=(0, 0, 0))

# 12-30 : the top seal RIPS off and tumbles away raggedly (not a clean lift).
if cap:
    key(cap, 1, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1))
    key(cap, 12, loc=(0, 0, 0), rot=(0, 0, 0))
    key(cap, 15, loc=(-0.04, -0.05, 0.03), rot=(0, 0, math.radians(-6)))   # the rip catches
    key(cap, 24, loc=(0.34, -0.5, 1.1), rot=(math.radians(70), math.radians(30), math.radians(55)))
    key(cap, 30, loc=(0.7, -0.85, 2.3), rot=(math.radians(150), math.radians(80), math.radians(130)))
    key(cap, 30, scale=(1, 1, 1))
    key(cap, 34, scale=(0.001, 0.001, 0.001))

# 10-40 : the light rays shoot out of the seam, hold, then retract + fade.
# Scaling the root about the seam origin makes the fan + spikes burst outward.
if ray_root:
    key(ray_root, 10, scale=(0.02, 1.0, 0.02), rot=(0.0, 0.0, 0.0))
    key(ray_root, 14, scale=(1.12, 1.0, 1.12))
    key(ray_root, 20, scale=(1.0, 1.0, 1.0))
    key(ray_root, 30, scale=(1.06, 1.0, 1.06))
    key(ray_root, 40, scale=(0.02, 1.0, 0.02))
    key(ray_root, 40, rot=(0.0, math.radians(-7), 0.0))

# 16.. : cards rise one by one and fan CLOSE together (a held hand)
start, stagger = 16, 6
for i, c in enumerate(cards):
    f0 = start + i * stagger
    off = i - (N - 1) / 2
    x = off * 0.66                 # closer spacing = slight overlap fan
    z = 1.0 - abs(off) * 0.05      # gentle arc, centre highest
    tilt = math.radians(off * 7)
    key(c, 1, loc=c.location, rot=(math.radians(90), 0, 0))
    key(c, f0, loc=c.location, rot=(math.radians(90), 0, 0))
    key(c, f0 + 12, loc=(x, -0.6, z), rot=(math.radians(90), 0, tilt))

# ---- Rare celebration: a quick sunlight flash + a sparkle burst -------------
if RARE:
    # Sunlight flash — a bright bloom right as the pack opens, gone in a few frames.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.3, location=(0, 0.28, 0.45))
    flash = bpy.context.active_object
    flash.name = "Flash"
    flash.data.materials.append(emissive("Flash", (1.0, 0.97, 0.82), 4.0))
    key(flash, 12, scale=(0.01, 0.01, 0.01))
    key(flash, 16, scale=(1.9, 1.9, 1.9))
    key(flash, 21, scale=(0.001, 0.001, 0.001))

    # Sparkles — small bright points that shoot out of the opening and twinkle out.
    random.seed(7)
    for k in range(18):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.03, location=(0, 0.12, 0.45))
        sp = bpy.context.active_object
        sp.name = f"Spark{k}"
        sp.data.materials.append(emissive("Spark", (1.0, 0.95, 0.7), 4.0))
        ang = random.uniform(0, 2 * math.pi)
        dist = random.uniform(1.1, 2.3)
        dx = math.cos(ang) * dist
        dz = 0.5 + abs(math.sin(ang)) * dist * 0.9
        f0 = 14 + random.randint(0, 6)
        key(sp, f0, loc=(0, 0.12, 0.45), scale=(0.15, 0.15, 0.15))
        key(sp, f0 + 3, scale=(1.0, 1.0, 1.0))
        key(sp, f0 + 11, loc=(dx, -0.25, dz), scale=(0.7, 0.7, 0.7))
        key(sp, f0 + 17, loc=(dx * 1.25, -0.25, dz * 1.12), scale=(0.001, 0.001, 0.001))

# ---- Render (headless) or live preview (GUI) --------------------------------
if bpy.app.background and HERO:
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1400
    try:
        scene.eevee.taa_render_samples = 128
    except Exception:
        pass
    scene.frame_set(1)
    scene.render.filepath = os.path.join(OUT_DIR, "hero.png")
    bpy.ops.render.render(write_still=True)
    print("HERO still ->", os.path.join(OUT_DIR, "hero.png"))
elif bpy.app.background:
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(OUT_DIR, "f_")
    bpy.ops.render.render(animation=True)
    print("RENDERED", FRAMES, "frames ->", OUT_DIR)
else:
    scene.render.fps = 24
    scene.frame_set(1)
    for a in bpy.context.screen.areas:
        if a.type == "VIEW_3D":
            for space in a.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "RENDERED"
                    space.region_3d.view_perspective = "CAMERA"
    try:
        bpy.ops.screen.animation_play()
    except Exception:
        pass
    print("GUI READY — camera view, looping. Press Space to pause/scrub.")
