"""The card animation scene, as a single build() function.

No spotlights: the card is self-lit (emission), so nothing washes it out. The
holographic sheen and the gold sheen both come from a view-dependent Layer Weight
node, so they move as the card rocks — a real holo/foil shift with no lamps.

Uses the data API (not operators) so it can run from any context, including the
live GUI preview's timer. Edit values here; both the headless render and the
live preview call build().
"""
import bpy
import math


def _clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.lights, bpy.data.cameras, bpy.data.worlds):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def build(face_path, rarity, engine="CYCLES", mask_path=None, back_path=None):
    is_gold = rarity == "gold"
    # Full Art + SIR + Event get 3D embossed relief on the art (IR stays flat).
    emboss = rarity in ("full_art", "secret_rare", "event")
    _clear()
    scene = bpy.context.scene

    for candidate in (engine, "BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = candidate
            break
        except TypeError:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.device = "CPU"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
    # 500x700 so every displayed card image is the same size in Discord (the
    # embed box never resizes between reveals). 5:7, matches the card shape.
    scene.render.resolution_x = 500
    scene.render.resolution_y = 700
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = True  # transparent corners outside the card
    scene.view_settings.view_transform = "Standard"

    # Near-black world: the emission carries the card, so no light washes it.
    world = bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.01, 0.01, 0.015, 1.0)
    bg.inputs[1].default_value = 1.0

    # Card quad (data API), 5:7, facing the camera.
    mesh = bpy.data.meshes.new("Card")
    mesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    mesh.update()
    uv = mesh.uv_layers.new(name="UV").data
    for i, coord in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv[i].uv = coord
    card = bpy.data.objects.new("Card", mesh)
    scene.collection.objects.link(card)
    card.scale = (1.0, 1.4, 1.0)
    card.rotation_euler = (math.radians(90), 0, 0)

    mat = bpy.data.materials.new("Foil")
    mat.use_nodes = True
    card.data.materials.append(mat)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(face_path)
    # the face's alpha (transparent outside the rounded card) drives the shape
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])

    # View-dependent facing: uniform across the flat card, so it acts as a global
    # PHASE that slides as the card rocks (shifts the bands over time).
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5

    if is_gold:
        # Deep, rich gold. The image becomes gold TONES only (duotone), plus a
        # gold sheen band that sweeps as it rocks. Embossed relief.
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
        gold = nt.nodes.new("ShaderNodeValToRGB")
        ge = gold.color_ramp.elements
        ge[0].position = 0.0
        ge[0].color = (0.09, 0.045, 0.008, 1.0)
        ge[1].position = 1.0
        ge[1].color = (0.92, 0.66, 0.20, 1.0)
        ge.new(0.5).color = (0.62, 0.40, 0.09, 1.0)
        nt.links.new(bw.outputs["Val"], gold.inputs["Fac"])

        smult = nt.nodes.new("ShaderNodeMath"); smult.operation = "MULTIPLY"; smult.inputs[1].default_value = 8.0
        nt.links.new(lw.outputs["Facing"], smult.inputs[0])
        swrap = nt.nodes.new("ShaderNodeMath"); swrap.operation = "WRAP"; swrap.inputs[1].default_value = 1.0; swrap.inputs[2].default_value = 0.0
        nt.links.new(smult.outputs["Value"], swrap.inputs[0])
        sheen = nt.nodes.new("ShaderNodeValToRGB")
        sc = sheen.color_ramp
        sc.elements[0].color = (0, 0, 0, 1); sc.elements[1].position = 1.0; sc.elements[1].color = (0, 0, 0, 1)
        sc.elements.new(0.5).color = (1.0, 0.82, 0.42, 1)
        nt.links.new(swrap.outputs["Value"], sheen.inputs["Fac"])

        add = nt.nodes.new("ShaderNodeMixRGB"); add.blend_type = "ADD"; add.inputs[0].default_value = 0.35
        nt.links.new(gold.outputs["Color"], add.inputs[1])
        nt.links.new(sheen.outputs["Color"], add.inputs[2])
        # Pronounced emboss: the art becomes a raised/recessed relief in the metal.
        bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.9; bump.inputs["Distance"].default_value = 0.03
        nt.links.new(tex.outputs["Color"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        nt.links.new(gold.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(add.outputs[0], bsdf.inputs["Emission Color"])
        # Real metal + a low base glow, so grazing light gives 3D highlights.
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = 0.32
        bsdf.inputs["Emission Strength"].default_value = 0.4
    elif rarity == "promo":
        # PROMO: platinum metallic border + holographic, ridged Full Art.
        # mask (white = art, black = border) splits the two treatments.
        if mask_path:
            mtex = nt.nodes.new("ShaderNodeTexImage")
            mtex.image = bpy.data.images.load(mask_path)
            mtex.image.colorspace_settings.name = "Non-Color"
            mask_col = mtex.outputs["Color"]
            mbw = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(mask_col, mbw.inputs["Color"])
            mask_v = mbw.outputs["Val"]
        else:
            sval = nt.nodes.new("ShaderNodeValue"); sval.outputs[0].default_value = 1.0
            mask_col = sval.outputs[0]; mask_v = sval.outputs[0]

        # Rainbow holo overlay (art region).
        texco = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(texco.outputs["UV"], sep.inputs[0])
        grad = nt.nodes.new("ShaderNodeMath"); grad.operation = "ADD"
        nt.links.new(sep.outputs["X"], grad.inputs[0]); nt.links.new(sep.outputs["Y"], grad.inputs[1])
        bands = nt.nodes.new("ShaderNodeMath"); bands.operation = "MULTIPLY"; bands.inputs[1].default_value = 5.0
        nt.links.new(grad.outputs["Value"], bands.inputs[0])
        shift = nt.nodes.new("ShaderNodeMath"); shift.operation = "MULTIPLY"; shift.inputs[1].default_value = 6.0
        nt.links.new(lw.outputs["Facing"], shift.inputs[0])
        summ = nt.nodes.new("ShaderNodeMath"); summ.operation = "ADD"
        nt.links.new(bands.outputs["Value"], summ.inputs[0]); nt.links.new(shift.outputs["Value"], summ.inputs[1])
        wrap = nt.nodes.new("ShaderNodeMath"); wrap.operation = "WRAP"; wrap.inputs[1].default_value = 1.0; wrap.inputs[2].default_value = 0.0
        nt.links.new(summ.outputs["Value"], wrap.inputs[0])
        rainbow = nt.nodes.new("ShaderNodeValToRGB"); cr = rainbow.color_ramp
        cr.elements[0].color = (1.0, 0.15, 0.15, 1.0); cr.elements[1].position = 1.0; cr.elements[1].color = (1.0, 0.15, 0.15, 1.0)
        for pos, col in [(0.17, (1, 1, 0.2, 1)), (0.34, (0.2, 1, 0.3, 1)), (0.5, (0.2, 1, 1, 1)), (0.67, (0.3, 0.4, 1, 1)), (0.84, (1, 0.3, 1, 1))]:
            cr.elements.new(pos).color = col
        nt.links.new(wrap.outputs["Value"], rainbow.inputs["Fac"])
        hstr = nt.nodes.new("ShaderNodeMath"); hstr.operation = "MULTIPLY"; hstr.inputs[1].default_value = 0.4
        nt.links.new(mask_v, hstr.inputs[0])
        art_holo = nt.nodes.new("ShaderNodeMixRGB"); art_holo.blend_type = "OVERLAY"
        nt.links.new(hstr.outputs["Value"], art_holo.inputs[0])
        nt.links.new(tex.outputs["Color"], art_holo.inputs[1])
        nt.links.new(rainbow.outputs["Color"], art_holo.inputs[2])

        # Platinum duotone + moving silver sheen band (border region).
        bw = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
        plat = nt.nodes.new("ShaderNodeValToRGB"); pe = plat.color_ramp.elements
        pe[0].position = 0.0; pe[0].color = (0.62, 0.68, 0.78, 1.0)
        pe[1].position = 1.0; pe[1].color = (0.99, 1.0, 1.0, 1.0)
        plat.color_ramp.elements.new(0.5).color = (0.84, 0.89, 0.97, 1.0)
        nt.links.new(bw.outputs["Val"], plat.inputs["Fac"])
        smult = nt.nodes.new("ShaderNodeMath"); smult.operation = "MULTIPLY"; smult.inputs[1].default_value = 8.0
        nt.links.new(lw.outputs["Facing"], smult.inputs[0])
        swrap = nt.nodes.new("ShaderNodeMath"); swrap.operation = "WRAP"; swrap.inputs[1].default_value = 1.0; swrap.inputs[2].default_value = 0.0
        nt.links.new(smult.outputs["Value"], swrap.inputs[0])
        sheen = nt.nodes.new("ShaderNodeValToRGB"); sc = sheen.color_ramp
        sc.elements[0].color = (0, 0, 0, 1); sc.elements[1].position = 1.0; sc.elements[1].color = (0, 0, 0, 1)
        sc.elements.new(0.5).color = (0.95, 0.97, 1.0, 1)
        nt.links.new(swrap.outputs["Value"], sheen.inputs["Fac"])
        plat_add = nt.nodes.new("ShaderNodeMixRGB"); plat_add.blend_type = "ADD"; plat_add.inputs[0].default_value = 0.45
        nt.links.new(plat.outputs["Color"], plat_add.inputs[1])
        nt.links.new(sheen.outputs["Color"], plat_add.inputs[2])

        # Combine: border = platinum, art = the illustration.
        basecol = nt.nodes.new("ShaderNodeMixRGB")
        nt.links.new(mask_col, basecol.inputs[0])
        nt.links.new(plat_add.outputs[0], basecol.inputs[1])
        nt.links.new(tex.outputs["Color"], basecol.inputs[2])
        nt.links.new(basecol.outputs[0], bsdf.inputs["Base Color"])
        # Emission: art holo self-lit, and the border self-lights with the bright
        # platinum sheen so it stays light silver-blue even in shadow.
        emis = nt.nodes.new("ShaderNodeMixRGB")
        nt.links.new(mask_col, emis.inputs[0])
        nt.links.new(plat_add.outputs[0], emis.inputs[1])
        nt.links.new(art_holo.outputs[0], emis.inputs[2])
        nt.links.new(emis.outputs[0], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 0.55
        # Metallic: border only.
        inv = nt.nodes.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
        nt.links.new(mask_v, inv.inputs[1])
        nt.links.new(inv.outputs["Value"], bsdf.inputs["Metallic"])
        # Roughness: shiny metal border (0.28) -> softer art (0.5).
        rmul = nt.nodes.new("ShaderNodeMath"); rmul.operation = "MULTIPLY"; rmul.inputs[1].default_value = 0.22
        nt.links.new(mask_v, rmul.inputs[0])
        radd = nt.nodes.new("ShaderNodeMath"); radd.operation = "ADD"; radd.inputs[1].default_value = 0.28
        nt.links.new(rmul.outputs["Value"], radd.inputs[0])
        nt.links.new(radd.outputs["Value"], bsdf.inputs["Roughness"])
        # Bump: ridged art only.
        eh = nt.nodes.new("ShaderNodeMath"); eh.operation = "MULTIPLY"
        nt.links.new(bw.outputs["Val"], eh.inputs[0]); nt.links.new(mask_v, eh.inputs[1])
        pbump = nt.nodes.new("ShaderNodeBump"); pbump.inputs["Strength"].default_value = 1.8; pbump.inputs["Distance"].default_value = 0.05
        nt.links.new(eh.outputs["Value"], pbump.inputs["Height"])
        nt.links.new(pbump.outputs["Normal"], bsdf.inputs["Normal"])
    elif rarity in ("illustrated_rare", "secret_rare", "full_art", "event"):
        # Holographic ONLY inside the artwork: diagonal rainbow bands that slide
        # as it rocks, confined to the art area (border + bottom text stay clean),
        # at a gentle strength so the art reads through.
        texco = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(texco.outputs["UV"], sep.inputs[0])
        u = sep.outputs["X"]
        v = sep.outputs["Y"]

        grad = nt.nodes.new("ShaderNodeMath"); grad.operation = "ADD"
        nt.links.new(u, grad.inputs[0]); nt.links.new(v, grad.inputs[1])
        bands = nt.nodes.new("ShaderNodeMath"); bands.operation = "MULTIPLY"; bands.inputs[1].default_value = 5.0
        nt.links.new(grad.outputs["Value"], bands.inputs[0])
        shift = nt.nodes.new("ShaderNodeMath"); shift.operation = "MULTIPLY"; shift.inputs[1].default_value = 6.0
        nt.links.new(lw.outputs["Facing"], shift.inputs[0])
        summ = nt.nodes.new("ShaderNodeMath"); summ.operation = "ADD"
        nt.links.new(bands.outputs["Value"], summ.inputs[0]); nt.links.new(shift.outputs["Value"], summ.inputs[1])
        wrap = nt.nodes.new("ShaderNodeMath"); wrap.operation = "WRAP"; wrap.inputs[1].default_value = 1.0; wrap.inputs[2].default_value = 0.0
        nt.links.new(summ.outputs["Value"], wrap.inputs[0])

        rainbow = nt.nodes.new("ShaderNodeValToRGB")
        cr = rainbow.color_ramp
        if rarity == "full_art":
            # Rainbow (Full Art — locked).
            cr.elements[0].color = (1.0, 0.15, 0.15, 1.0)
            cr.elements[1].position = 1.0
            cr.elements[1].color = (1.0, 0.15, 0.15, 1.0)
            for pos, col in [(0.17, (1, 1, 0.2, 1)), (0.34, (0.2, 1, 0.3, 1)),
                             (0.5, (0.2, 1, 1, 1)), (0.67, (0.3, 0.4, 1, 1)), (0.84, (1, 0.3, 1, 1))]:
                cr.elements.new(pos).color = col
        elif rarity == "event":
            # Emerald "colored foil" — a green/teal iridescent sheen (no metal).
            cr.elements[0].color = (0.04, 0.20, 0.14, 1.0)
            cr.elements[1].position = 1.0
            cr.elements[1].color = (0.04, 0.20, 0.14, 1.0)
            for pos, col in [(0.20, (0.13, 0.80, 0.52, 1)), (0.40, (0.55, 1.0, 0.82, 1)),
                             (0.60, (0.20, 0.85, 0.90, 1)), (0.80, (0.20, 0.90, 0.55, 1))]:
                cr.elements.new(pos).color = col
        else:
            # Silvery holographic sheen (SIR, IR): silver/white with faint iridescence.
            cr.elements[0].color = (0.22, 0.24, 0.30, 1.0)
            cr.elements[1].position = 1.0
            cr.elements[1].color = (0.22, 0.24, 0.30, 1.0)
            for pos, col in [(0.20, (0.55, 0.75, 0.85, 1)), (0.40, (0.96, 0.98, 1.0, 1)),
                             (0.60, (0.90, 0.80, 0.95, 1)), (0.80, (0.60, 0.62, 0.72, 1))]:
                cr.elements.new(pos).color = col
        nt.links.new(wrap.outputs["Value"], rainbow.inputs["Fac"])

        # Strength = the rendered mask (white = artwork incl. rounded corners,
        # black = border/outside) times a gentle amount. Holo covers the whole
        # art and the bottom text, but never the border.
        if mask_path:
            mtex = nt.nodes.new("ShaderNodeTexImage")
            mtex.image = bpy.data.images.load(mask_path)
            mtex.image.colorspace_settings.name = "Non-Color"
            # Keep the BAKED holo subtle so the still card reads clearly. The web
            # gallery adds the strong holographic shine interactively on tilt.
            strength = nt.nodes.new("ShaderNodeMath"); strength.operation = "MULTIPLY"; strength.inputs[1].default_value = 0.32
            nt.links.new(mtex.outputs["Color"], strength.inputs[0])
            strength_out = strength.outputs["Value"]
        else:
            sval = nt.nodes.new("ShaderNodeValue"); sval.outputs[0].default_value = 0.5
            strength_out = sval.outputs[0]

        add = nt.nodes.new("ShaderNodeMixRGB"); add.blend_type = "OVERLAY"
        nt.links.new(strength_out, add.inputs[0])
        nt.links.new(tex.outputs["Color"], add.inputs[1])
        nt.links.new(rainbow.outputs["Color"], add.inputs[2])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(add.outputs[0], bsdf.inputs["Emission Color"])
        if emboss:
            # Raise the art into relief; a soft grazing light (below) shades it 3D.
            ebump = nt.nodes.new("ShaderNodeBump")
            ebump.inputs["Strength"].default_value = 1.8
            ebump.inputs["Distance"].default_value = 0.06
            nt.links.new(tex.outputs["Color"], ebump.inputs["Height"])
            nt.links.new(ebump.outputs["Normal"], bsdf.inputs["Normal"])
            bsdf.inputs["Roughness"].default_value = 0.45
            bsdf.inputs["Emission Strength"].default_value = 0.25
        else:
            bsdf.inputs["Emission Strength"].default_value = 1.0
    else:
        # Plain (normal / back): flat textured card, no holo or emboss.
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0

    # Rock pivot for the loop (start == end for a seamless loop).
    pivot = bpy.data.objects.new("Pivot", None)
    scene.collection.objects.link(pivot)
    card.parent = pivot

    if back_path:
        # The shared lion back on the reverse face: one thin double-sided card.
        # UVs mirror on X (reads right after the 180-degree turn) and flip on V
        # (crest upright). Sits a hair behind the front so it never z-fights.
        bmesh = bpy.data.meshes.new("Back")
        bmesh.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
        bmesh.update()
        buv = bmesh.uv_layers.new(name="UV").data
        for i, coord in enumerate([(1, 1), (0, 1), (0, 0), (1, 0)]):
            buv[i].uv = coord
        back = bpy.data.objects.new("Back", bmesh)
        scene.collection.objects.link(back)
        back.scale = card.scale
        back.rotation_euler = (math.radians(-90), 0, 0)
        back.location = (0, 0.004, 0)
        back.parent = pivot
        bmat = bpy.data.materials.new("BackMat")
        bmat.use_nodes = True
        back.data.materials.append(bmat)
        bnt = bmat.node_tree
        bb = bnt.nodes.get("Principled BSDF")
        bb.inputs["Metallic"].default_value = 0.0
        bb.inputs["Roughness"].default_value = 1.0
        bt = bnt.nodes.new("ShaderNodeTexImage")
        bt.image = bpy.data.images.load(back_path)
        bnt.links.new(bt.outputs["Color"], bb.inputs["Base Color"])
        bnt.links.new(bt.outputs["Color"], bb.inputs["Emission Color"])
        bb.inputs["Emission Strength"].default_value = 1.0
        bnt.links.new(bt.outputs["Alpha"], bb.inputs["Alpha"])

        # Flip reveal (plays once, holds on the front): hold face-down, flip to
        # the front, then settle on the front. The last frame is the front, so
        # the WebP (encoded loop=1) freezes on the revealed card. Every keyframe
        # keeps a little motion (a face-down float, a holo rock) so no two frames
        # are identical -- identical frames get merged by the WebP encoder, which
        # would shorten the hold.
        for frame, rx, rz in [(1, -2, 179), (6, 2, 181), (16, 0, 360),
                              (26, 7, 366), (36, 1, 360)]:
            pivot.rotation_euler = (math.radians(rx), 0, math.radians(rz))
            pivot.keyframe_insert("rotation_euler", frame=frame)
        scene.frame_start = 1
        scene.frame_end = 36
    else:
        # Start FLAT, sweep the sheen once, settle FLAT and hold. Frame 1 and the
        # last frame are square-on (0,0), so the frozen still (gallery grid, studio
        # preview) shows the card flat with the artwork in exactly its framed
        # position — it never looks shifted. The WebP is encoded loop=1 (push.js),
        # so Discord plays the sweep once and rests on the flat card. The web
        # gallery carries the strong "shine on demand" via the interactive tilt.
        for frame, rx, rz in [(1, 0, 0), (12, 6, 8), (24, 0, 0)]:
            pivot.rotation_euler = (math.radians(rx), 0, math.radians(rz))
            pivot.keyframe_insert("rotation_euler", frame=frame)
        scene.frame_start = 1
        scene.frame_end = 24

    # Grazing lights so embossed cards read 3D. Gold gets bright warm light; the
    # embossed holo tiers get a soft dim light (kept low to avoid washing the art).
    def _area(loc, energy, size, color=(1.0, 1.0, 1.0)):
        ld = bpy.data.lights.new("L", "AREA")
        ld.energy = energy
        ld.size = size
        ld.color = color
        obj = bpy.data.objects.new("L", ld)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.constraints.new("TRACK_TO").target = card

    if is_gold:
        _area((4.2, -2.5, 1.2), 1500, 3.0, (1.0, 0.85, 0.55))
        _area((-3.5, -3.5, -0.6), 500, 6.0, (1.0, 0.90, 0.72))
        _area((0.0, -3.0, 3.6), 800, 3.5, (1.0, 0.92, 0.78))
    elif emboss:
        _area((5.0, -1.5, 0.8), 1100, 2.0, (1.0, 1.0, 1.0))   # strong raking key
        _area((-3.5, -2.5, -0.3), 220, 6.0, (1.0, 1.0, 1.0))  # soft fill
    elif rarity == "promo":
        # Bright, cool (blue-white) grazing light so the platinum border reads
        # like a light silvery sheen rather than dark metal.
        _area((4.5, -2.0, 1.0), 1700, 2.5, (0.92, 0.96, 1.0))
        _area((-3.5, -2.5, -0.3), 500, 6.0, (0.90, 0.95, 1.0))
        _area((0.0, -3.0, 3.2), 800, 3.5, (0.95, 0.97, 1.0))

    cam_data = bpy.data.cameras.new("Cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.85
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -6, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    return card
