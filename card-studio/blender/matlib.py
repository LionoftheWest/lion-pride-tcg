"""Procedural creature materials. No UVs needed (Object coordinates) — good for EEVEE preview
and cinematics. NOTE: procedural node textures do NOT export to glTF; for a game .glb, BAKE
these to image maps (base color / normal / roughness) after a UV unwrap.

    import matlib as M; importlib.reload(M)
    M.rock_material("StoneClean", dark=(0.06,0.055,0.05), light=(0.44,0.40,0.35))
"""
import bpy


def rock_material(name, dark=(0.06, 0.055, 0.05), light=(0.44, 0.40, 0.35),
                  bump_str=1.4, rough=0.85, crackscale=4.5):
    """Cracked-stone: noise base color + per-plate variation + sharp Voronoi crack grooves
    (darken the color AND cut bump grooves) + fine grain bump."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear(); L = nt.links.new
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (1100, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (820, 0)
    coord = nt.nodes.new("ShaderNodeTexCoord"); coord.location = (-1000, 0)
    n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.location = (-750, 250)
    n1.inputs["Scale"].default_value = 3.0; n1.inputs["Detail"].default_value = 10.0; n1.inputs["Roughness"].default_value = 0.7
    oi = nt.nodes.new("ShaderNodeObjectInfo"); oi.location = (-750, -450)
    mr = nt.nodes.new("ShaderNodeMath"); mr.location = (-520, -400); mr.operation = 'MULTIPLY'; mr.inputs[1].default_value = 0.4
    addf = nt.nodes.new("ShaderNodeMath"); addf.location = (-330, 120); addf.operation = 'ADD'
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.location = (-140, 220)
    ramp.color_ramp.elements[0].position = 0.2; ramp.color_ramp.elements[0].color = (dark[0], dark[1], dark[2], 1)
    ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (light[0], light[1], light[2], 1)
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.location = (-750, -120); vor.feature = 'DISTANCE_TO_EDGE'; vor.inputs["Scale"].default_value = crackscale
    cr = nt.nodes.new("ShaderNodeValToRGB"); cr.location = (-520, -150)
    cr.color_ramp.elements[0].position = 0.0;  cr.color_ramp.elements[0].color = (0, 0, 0, 1)
    cr.color_ramp.elements[1].position = 0.06; cr.color_ramp.elements[1].color = (1, 1, 1, 1)
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.location = (180, 150); mix.blend_type = 'MULTIPLY'; mix.inputs["Fac"].default_value = 1.0
    n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.location = (-750, -650); n2.inputs["Scale"].default_value = 35; n2.inputs["Detail"].default_value = 8
    inv = nt.nodes.new("ShaderNodeMath"); inv.location = (-330, -250); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
    hb = nt.nodes.new("ShaderNodeMath"); hb.location = (-140, -350); hb.operation = 'MULTIPLY_ADD'; hb.inputs[1].default_value = 0.6
    bumpn = nt.nodes.new("ShaderNodeBump"); bumpn.location = (560, -250); bumpn.inputs["Strength"].default_value = bump_str
    L(coord.outputs["Object"], n1.inputs["Vector"]); L(coord.outputs["Object"], vor.inputs["Vector"]); L(coord.outputs["Object"], n2.inputs["Vector"])
    L(oi.outputs["Random"], mr.inputs[0]); L(n1.outputs["Fac"], addf.inputs[0]); L(mr.outputs[0], addf.inputs[1])
    L(addf.outputs[0], ramp.inputs["Fac"]); L(vor.outputs["Distance"], cr.inputs["Fac"])
    L(ramp.outputs["Color"], mix.inputs["Color1"]); L(cr.outputs["Color"], mix.inputs["Color2"])
    L(mix.outputs["Color"], bsdf.inputs["Base Color"])
    L(cr.outputs["Color"], inv.inputs[1]); L(inv.outputs[0], hb.inputs[0]); L(n2.outputs["Fac"], hb.inputs[2])
    L(hb.outputs[0], bumpn.inputs["Height"]); L(bumpn.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = rough
    L(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat
