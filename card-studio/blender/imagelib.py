"""Turn an IMAGE into a 3D starting mesh in Blender (no AI, no GPU).

- silhouette_mesh: extrude the image's shape (alpha, or dark-on-light) into a solid
  3D cut-out you then round and sculpt — a fast "good start" from any image.
- relief_from_image: displace a grid by the image's brightness -> a bas-relief.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import imagelib as IM; import importlib; importlib.reload(IM)
"""
import bpy
import bmesh
import numpy as np
import os


def _load_np(image_path):
    img = bpy.data.images.load(image_path, check_existing=True)
    W, H = img.size
    a = np.empty(W * H * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return img, a.reshape(H, W, 4)   # row 0 = bottom of image


def silhouette_mesh(image_path, res=80, threshold=0.5, depth=0.5, size=3.0,
                    use_alpha=True, subject="light", smooth=True, name="ImageMesh"):
    """Build a solid 3D mesh from the image's silhouette, standing in the XZ plane
    (facing -Y, toward the default camera). Round it afterwards with sculptlib.
    subject: 'light' = bright object on dark bg, 'dark' = dark object on light bg."""
    img, px = _load_np(image_path)
    H, W, _ = px.shape
    if use_alpha and float(px[:, :, 3].min()) < 0.98:
        val = px[:, :, 3]                    # transparent-bg image -> alpha is the shape
    elif subject == "dark":
        val = 1.0 - px[:, :, :3].mean(2)     # dark subject on light bg
    else:
        val = px[:, :, :3].mean(2)           # light subject on dark bg
    aspect = W / H
    ry = int(res)
    rx = max(1, int(res * aspect))
    ys = np.linspace(0, H - 1, ry).astype(int)
    xs = np.linspace(0, W - 1, rx).astype(int)
    grid = val[np.ix_(ys, xs)]
    mask = grid > threshold
    cw = size / max(rx, ry)
    bm = bmesh.new()
    ox = -cw * rx / 2.0
    oz = -cw * ry / 2.0
    vc = {}
    def vert(ix, iz):
        k = (ix, iz)
        if k not in vc:
            vc[k] = bm.verts.new((ox + ix * cw, 0.0, oz + iz * cw))
        return vc[k]
    for j in range(ry):
        for i in range(rx):
            if mask[j, i]:
                bm.faces.new((vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    sol = obj.modifiers.new("solid", "SOLIDIFY"); sol.thickness = depth; sol.offset = 0.0
    if smooth:
        sub = obj.modifiers.new("sub", "SUBSURF"); sub.levels = 1
    return obj


def relief_from_image(image_path, res=160, strength=0.4, size=3.0, name="Relief"):
    """A grid displaced by image brightness — a bas-relief facing -Y."""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=res, y_subdivisions=res, size=size)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = (1.5708, 0, 0)
    img = bpy.data.images.load(image_path, check_existing=True)
    tex = bpy.data.textures.new(name + "_h", "IMAGE"); tex.image = img
    d = obj.modifiers.new("relief", "DISPLACE")
    d.texture = tex; d.strength = strength; d.mid_level = 0.0; d.texture_coords = "UV"
    return obj
