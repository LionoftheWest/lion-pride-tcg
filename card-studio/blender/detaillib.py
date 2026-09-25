"""Detailing / further modeling helpers for Blender.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import detaillib as D; import importlib; importlib.reload(D)
"""
import bpy
import math
import os


def _img_tex(image_path, non_color=False):
    img = bpy.data.images.load(image_path, check_existing=True)
    if non_color:
        try: img.colorspace_settings.name = "Non-Color"
        except Exception: pass
    return img


def displace_from_image(obj, image_path, strength=0.3, mid=0.0, coords="UV"):
    """Add geometric relief from an image height map (needs UVs for coords='UV')."""
    img = _img_tex(image_path)
    tex = bpy.data.textures.new(os.path.basename(image_path), "IMAGE"); tex.image = img
    d = obj.modifiers.new("disp_img", "DISPLACE")
    d.texture = tex; d.strength = strength; d.mid_level = mid; d.texture_coords = coords
    return d


def bump_from_image(obj, image_path, strength=0.3):
    """Fake surface detail from an image via a Bump node (no extra geometry)."""
    mat = obj.active_material or _new_mat(obj, "Bumped")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = _img_tex(image_path)
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def normal_from_image(obj, image_path, strength=1.0):
    """Apply a tangent-space normal map for fine surface detail."""
    mat = obj.active_material or _new_mat(obj, "Normaled")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = _img_tex(image_path, non_color=True)
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _new_mat(obj, name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    obj.data.materials.append(m); return m


def boolean(obj, cutter, op="DIFFERENCE", apply=True):
    """op: DIFFERENCE (cut) | UNION (merge) | INTERSECT."""
    m = obj.modifiers.new("bool", "BOOLEAN"); m.operation = op; m.object = cutter; m.solver = "EXACT"
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(cutter, do_unlink=True)


def bevel(obj, width=0.02, segments=2, angle_deg=30, apply=True):
    m = obj.modifiers.new("bevel", "BEVEL"); m.width = width; m.segments = segments
    m.limit_method = "ANGLE"; m.angle_limit = math.radians(angle_deg)
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


def mirror(obj, axis="X", apply=False):
    m = obj.modifiers.new("mirror", "MIRROR")
    m.use_axis = (axis == "X", axis == "Y", axis == "Z")
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


def solidify(obj, thickness=0.1, apply=True):
    m = obj.modifiers.new("solid", "SOLIDIFY"); m.thickness = thickness
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)


def remesh(obj, voxel=0.1, smooth_shade=False, apply=True):
    m = obj.modifiers.new("remesh", "REMESH"); m.mode = "VOXEL"; m.voxel_size = voxel
    m.use_smooth_shade = smooth_shade
    if apply:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=m.name)
