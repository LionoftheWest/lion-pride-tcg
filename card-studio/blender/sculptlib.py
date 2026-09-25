"""Code-driven sculpting toolkit for Blender (numpy vertex deformation).

Each function is a "brush": it moves the vertices of an object's mesh within a
radius, with a smooth radial falloff, the same way interactive sculpt brushes do
— but driven from Python so an agent can sculpt via the MCP + render loop.

Usage inside Blender:
    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import sculptlib as S; import importlib; importlib.reload(S)
    S.inflate(obj, center, radius, amount)
"""
import numpy as np
import bmesh
import mathutils


def _co(me):
    n = len(me.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", a)
    return a.reshape(n, 3)


def _set(me, co):
    me.vertices.foreach_set("co", co.astype(np.float32).reshape(-1))
    me.update()


def _normals(me):
    n = len(me.vertices)
    a = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("normal", a)
    return a.reshape(n, 3)


def _falloff(dist, radius, mode="smooth"):
    t = np.clip(1.0 - dist / radius, 0.0, 1.0)
    if mode == "smooth":
        return t * t * (3 - 2 * t)      # smoothstep
    if mode == "sharp":
        return t * t
    if mode == "round":
        return np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1))
    if mode == "linear":
        return t
    return t


def grab(obj, center, offset, radius, falloff="smooth"):
    """Move a region bodily by `offset` (the Grab brush)."""
    me = obj.data
    co = _co(me)
    d = np.linalg.norm(co - np.array(center, dtype=np.float32), axis=1)
    f = _falloff(d, radius, falloff)
    co += np.array(offset, dtype=np.float32)[None, :] * f[:, None]
    _set(me, co)


def inflate(obj, center, radius, amount, falloff="smooth"):
    """Push vertices out (or in, if amount<0) along their normals."""
    me = obj.data
    co = _co(me)
    no = _normals(me)
    d = np.linalg.norm(co - np.array(center, dtype=np.float32), axis=1)
    f = _falloff(d, radius, falloff)
    co += no * (amount * f)[:, None]
    _set(me, co)


def pinch(obj, center, radius, amount, falloff="smooth"):
    """Pull vertices toward the center point (positive) or push away (negative)."""
    me = obj.data
    co = _co(me)
    d = co - np.array(center, dtype=np.float32)
    dist = np.linalg.norm(d, axis=1)
    f = _falloff(dist, radius, falloff)
    with np.errstate(invalid="ignore", divide="ignore"):
        dirv = d / dist[:, None]
    dirv[~np.isfinite(dirv)] = 0
    co -= dirv * (amount * f)[:, None]
    _set(me, co)


def flatten(obj, center, radius, amount=1.0, plane_no=None, falloff="smooth"):
    """Flatten a region toward its average plane (the Flatten brush)."""
    me = obj.data
    co = _co(me)
    c = np.array(center, dtype=np.float32)
    d = np.linalg.norm(co - c, axis=1)
    m = d < radius
    if not m.any():
        return
    if plane_no is None:
        pn = _normals(me)[m].mean(0)
    else:
        pn = np.array(plane_no, dtype=np.float32)
    pn = pn / (np.linalg.norm(pn) + 1e-9)
    pc = co[m].mean(0)
    f = _falloff(d, radius, falloff)
    proj = (co - pc) @ pn
    co -= pn[None, :] * (proj * f * amount)[:, None]
    _set(me, co)


def crease(obj, a, b, radius, amount, falloff="sharp"):
    """Carve a crease/ridge along the segment a->b (negative amount = ridge)."""
    me = obj.data
    co = _co(me)
    A = np.array(a, dtype=np.float32)
    B = np.array(b, dtype=np.float32)
    ab = B - A
    L = float(ab @ ab) + 1e-9
    t = np.clip(((co - A) @ ab) / L, 0, 1)
    proj = A + t[:, None] * ab
    d = co - proj
    dist = np.linalg.norm(d, axis=1)
    f = _falloff(dist, radius, falloff)
    with np.errstate(invalid="ignore", divide="ignore"):
        dirv = d / dist[:, None]
    dirv[~np.isfinite(dirv)] = 0
    co -= dirv * (amount * f)[:, None]
    _set(me, co)


def smooth(obj, iterations=1, factor=0.5, center=None, radius=None):
    """Laplacian smoothing, optionally limited to a sphere of influence."""
    me = obj.data
    for _ in range(iterations):
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        co = _co(me)
        new = co.copy()
        c = None if center is None else np.array(center, dtype=np.float32)
        for v in bm.verts:
            le = v.link_edges
            if not le:
                continue
            avg = np.mean([np.array(e.other_vert(v).co) for e in le], axis=0)
            w = factor
            if c is not None:
                if np.linalg.norm(np.array(v.co) - c) > radius:
                    w = 0.0
            new[v.index] = co[v.index] * (1 - w) + avg * w
        bm.free()
        _set(me, new)


def noise_rock(obj, scale=2.0, strength=0.08, seed=0, center=None, radius=None):
    """Displace along normals by 3D value noise — rocky/stony surface."""
    me = obj.data
    co = _co(me)
    no = _normals(me)
    off = mathutils.Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    disp = np.array([mathutils.noise.noise(mathutils.Vector(tuple(p)) * scale + off) for p in co], dtype=np.float32)
    f = np.ones(len(co), dtype=np.float32)
    if center is not None and radius is not None:
        d = np.linalg.norm(co - np.array(center, dtype=np.float32), axis=1)
        f = _falloff(d, radius, "smooth")
    co += no * (disp * strength * f)[:, None]
    _set(me, co)


def facet(obj, angle_deg=14.0):
    """Merge coplanar faces into big flat facets (chiseled look) + flat shade."""
    import bpy
    dec = obj.modifiers.new("facet", "DECIMATE")
    dec.decimate_type = "DISSOLVE"
    dec.angle_limit = np.radians(angle_deg)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier="facet")
    for p in obj.data.polygons:
        p.use_smooth = False


def subdivide(obj, cuts=1, smooth_val=0.0):
    """Add resolution so brushes have vertices to move."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True, smooth=smooth_val)
    bm.to_mesh(me)
    bm.free()
    me.update()
