"""Code-driven animation toolkit for Blender.

Manage one action per state (idle/hit/stun/attack/spawn/defeat), ease curves,
add organic F-curve noise, and render a frame range to PNGs for WebP encoding.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import animlib as A; import importlib; importlib.reload(A)
"""
import bpy
import os


def new_action(obj, name):
    """Start a fresh action on an object (armature). Returns the action."""
    if obj.animation_data is None:
        obj.animation_data_create()
    act = bpy.data.actions.new(name)
    obj.animation_data.action = act
    return act


def switch_action(obj, action_name):
    obj.animation_data.action = bpy.data.actions[action_name]


def frames(a, b, fps=24):
    sc = bpy.context.scene
    sc.frame_start = a
    sc.frame_end = b
    sc.render.fps = fps


def fcurves(obj):
    """Yield the action's F-curves across both the legacy and Blender 4.4+/5.x
    slotted-Action APIs."""
    ad = obj.animation_data
    if not (ad and ad.action):
        return []
    act = ad.action
    legacy = getattr(act, "fcurves", None)   # None on 5.x (attribute removed)
    if legacy is not None:
        try:
            return list(legacy)
        except Exception:
            pass
    out = []
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for slot in act.slots:
                    cb = strip.channelbag(slot)
                    if cb:
                        out.extend(cb.fcurves)
    except Exception as e:
        print("fcurve access:", e)
    return out


def ease(obj, interp="BEZIER", handle="AUTO_CLAMPED"):
    """Set interpolation on every keyframe of the object's current action."""
    for fc in fcurves(obj):
        for kp in fc.keyframe_points:
            kp.interpolation = interp
            kp.handle_left_type = handle
            kp.handle_right_type = handle


def add_noise(obj, strength=0.05, scale=25.0, only_paths=None):
    """Add a NOISE modifier to F-curves for organic jitter (great on idle)."""
    for fc in fcurves(obj):
        if only_paths and not any(p in fc.data_path for p in only_paths):
            continue
        m = fc.modifiers.new(type="NOISE")
        m.strength = strength
        m.scale = scale


def render_sequence(out_dir, prefix, a=None, b=None, res=(760, 940), transparent=True):
    """Render the frame range to out_dir/prefix####.png (for WebP encoding)."""
    sc = bpy.context.scene
    if a is not None:
        sc.frame_start = a
    if b is not None:
        sc.frame_end = b
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.film_transparent = transparent
    os.makedirs(out_dir, exist_ok=True)
    sc.render.filepath = os.path.join(out_dir, prefix)
    bpy.ops.render.render(animation=True)
    return out_dir


def export_gltf(filepath, selected_only=False):
    """Export the scene (or selection) as glTF/GLB with animations."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=filepath, export_format="GLB",
        use_selection=selected_only, export_animations=True,
        export_apply=True,
    )
    return filepath
