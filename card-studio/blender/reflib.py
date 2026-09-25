"""Reference-image toolkit for Blender: model against an image, project it as texture.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import reflib as RF; import importlib; importlib.reload(RF)
"""
import bpy
import os


def import_reference(image_path, view="front", location=(0, 0, 1.5), size=3.0, name=None):
    """Add the image as an Empty (reference), oriented for a view: front|side|top."""
    img = bpy.data.images.load(image_path, check_existing=True)
    bpy.ops.object.empty_add(type="IMAGE", location=location)
    e = bpy.context.active_object
    e.data = img
    e.empty_display_size = size
    e.name = name or ("ref_" + os.path.splitext(os.path.basename(image_path))[0])
    if view == "front":     # face -Y (toward the default camera)
        e.rotation_euler = (1.5708, 0, 0)
    elif view == "side":    # face -X
        e.rotation_euler = (1.5708, 0, 1.5708)
    elif view == "top":
        e.rotation_euler = (0, 0, 0)
    e.use_empty_image_alpha = True
    e.color[3] = 0.5
    return e


def camera_background(image_path, camera=None, alpha=0.5):
    """Show the image behind the camera view (compositing reference)."""
    cam = camera or bpy.context.scene.camera
    cam.data.show_background_images = True
    img = bpy.data.images.load(image_path, check_existing=True)
    bg = cam.data.background_images.new()
    bg.image = img
    bg.alpha = alpha
    return bg


def project_from_camera(obj, image_path, camera=None, emissive=False):
    """Project the image onto the mesh from the camera (UV Project) as its texture.
    Good for a quick 'photo-textured' look on a sculpt that matches the reference."""
    cam = camera or bpy.context.scene.camera
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="proj")
    m = obj.modifiers.new("uvproj", "UV_PROJECT")
    m.projector_count = 1
    m.projectors[0].object = cam
    img = bpy.data.images.load(image_path, check_existing=True)
    mat = bpy.data.materials.new("Projected"); mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    obj.data.materials.clear(); obj.data.materials.append(mat)
    return m
