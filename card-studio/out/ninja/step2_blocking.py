"""STEP 2 - BLOCKING THE BASE   *** PIXEL-PERFECT, CUSTOM 3D SHAPES. NO PRIMITIVES. ***

HARD RULE: nothing generic, nothing invented, nothing merged, nothing omitted.

THREE FAILED APPROACHES (never repeat):
  1. generic capsules -> blobs, a 31cm-thick upper arm
  2. silhouette extruded front/back with a dome -> perfect from the FRONT (it IS the front
     silhouette) but a flat lens from the SIDE. A bas-relief, not a form.
  3. lofted ellipses with an invented depth-to-width ratio -> radially symmetric lampshade,
     because a poncho's lateral flare made its cross-section equally deep.
All three failed in the SAME axis: I was INVENTING depth.

CORRECT - measure it, do not invent it:
  X and Z  come from the part's own mask at PIXEL resolution -> silhouette is pixel-perfect
  Y (depth) is RAYCAST into the AI high-poly at EVERY grid point -> real measured geometry
The high-poly is aligned 1:1 with the artwork, so the two combine exactly. Each piece is its
true custom 3D shape: the drawing's outline, the geometry's depth.
Run: blender -b -P step2_blocking.py -- <ninja_dir> [px_step]
"""
import bpy, bmesh, sys, os, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ND = sys.argv[sys.argv.index("--") + 1]
_i = sys.argv.index("--")
STEP = int(sys.argv[_i + 2]) if len(sys.argv) > _i + 2 else 2   # grid step in artwork pixels
H = 1.80

bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
hp = bpy.data.objects["source_highpoly"]
hp.hide_viewport = False

info = json.load(open(os.path.join(ND, "parts_info.json")))
IW, IH = info["image"]
cx0, cy0, cx1, cy1 = info.get("clean_bbox", info["char_bbox"])
mpp = H / (cy1 - cy0)
ccx = (cx0 + cx1) / 2.0
parts = info.get("blockout_parts", info["visible_parts"])

# BVH of the high-poly = our depth source
mw = hp.matrix_world
bvh = BVHTree.FromPolygons([mw @ v.co for v in hp.data.vertices],
                           [list(p.vertices) for p in hp.data.polygons],
                           all_triangles=False, epsilon=0.0)


def load_gray(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(h, w, 4)[::-1, :, 0]
    bpy.data.images.remove(img)
    return a


def load_rgb(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(h, w, 4)[::-1, :, :3]
    bpy.data.images.remove(img)
    return a


SRC = load_rgb(os.path.join(ND, "source.png"))
YFAR = 3.0


def measure(x, z):
    """front and back surface depth of the real geometry at this silhouette point"""
    hf = bvh.ray_cast(Vector((x, -YFAR, z)), Vector((0, 1, 0)), 2 * YFAR)
    hb = bvh.ray_cast(Vector((x, YFAR, z)), Vector((0, -1, 0)), 2 * YFAR)
    if hf[0] is None or hb[0] is None:
        return None
    yf, yb = hf[0].y, hb[0].y
    if yb < yf:
        yf, yb = yb, yf
    return yf, yb


def build_part(part):
    name = part["name"]
    mask = load_gray(os.path.join(ND, part["mask"])) > 0.5
    ys, xs = np.where(mask)
    if xs.size < 80:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    gx = list(range(x0, x1 + 1, STEP))
    gy = list(range(y0, y1 + 1, STEP))

    F, B = {}, {}
    misses = 0
    for j, py in enumerate(gy):
        wz = (cy1 - py) * mpp
        for i, px in enumerate(gx):
            if not mask[py, px]:
                continue
            wx = (px - ccx) * mpp
            m = measure(wx, wz)
            if m is None:
                misses += 1
                continue
            F[(i, j)] = m[0]
            B[(i, j)] = m[1]
    if len(F) < 30:
        return None

    bm = bmesh.new()
    vF, vB = {}, {}
    for (i, j), yf in F.items():
        px = gx[i]
        py = gy[j]
        wx = (px - ccx) * mpp
        wz = (cy1 - py) * mpp
        vF[(i, j)] = bm.verts.new((wx, yf, wz))
        vB[(i, j)] = bm.verts.new((wx, B[(i, j)], wz))

    quads = []
    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(k in vF for k in c):
                quads.append(c)
                try:
                    bm.faces.new([vF[k] for k in c])
                    bm.faces.new([vB[k] for k in reversed(c)])
                except ValueError:
                    pass
    if not quads:
        bm.free()
        return None
    from collections import Counter
    ec = Counter()
    for c in quads:
        for k in range(4):
            ec[tuple(sorted((c[k], c[(k + 1) % 4])))] += 1
    for (a, b), n in ec.items():
        if n == 1:
            try:
                bm.faces.new([vF[a], vF[b], vB[b], vB[a]])
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("BLK_" + name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new("BLK_" + name, me)
    sc.collection.objects.link(o)
    o["blockout"] = True
    col = SRC[mask].mean(axis=0)
    m2 = bpy.data.materials.new("BLK_" + name)
    m2.use_nodes = True
    next(n for n in m2.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (
        float(col[0]), float(col[1]), float(col[2]), 1.0)
    me.materials.append(m2)
    depth = max(B.values()) - min(F.values())
    return name, len(me.vertices), len(me.polygons), depth, misses, len(F)


made = []
for part in parts:
    r = build_part(part)
    if r:
        made.append(r)

hp.hide_viewport = True
hp.hide_render = True
ref = bpy.data.objects.get("REF_concept")
if ref:
    ref.location = (ref.location.x, 0.60, ref.location.z)

vl.update()
blocks = [o for o in sc.objects if o.get("blockout")]
mn = Vector((1e18,) * 3)
mx = Vector((-1e18,) * 3)
for o in blocks:
    for c in o.bound_box:
        wv = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], wv[i])
            mx[i] = max(mx[i], wv[i])
art_w = (cx1 - cx0) * mpp
tot_miss = sum(m[4] for m in made)
tot_pts = sum(m[5] for m in made)
print("STEP2 BLOCKING - %d custom pixel-perfect solids (step=%dpx = %.1fmm)" % (len(made), STEP, STEP * mpp * 1000))
for nm, v, f, d, ms, n in sorted(made, key=lambda t: -t[2]):
    print("   %-10s verts=%-7d faces=%-7d depth=%.3f  raycast_miss=%d/%d" % (nm, v, f, d, ms, n))
print("GATE height blockout=%.3f artwork=%.3f (%.2f%%)" % (mx.z - mn.z, H, 100 * abs((mx.z - mn.z) - H) / H))
print("GATE width  blockout=%.3f artwork=%.3f (%.2f%%)" % (mx.x - mn.x, art_w, 100 * abs((mx.x - mn.x) - art_w) / art_w))
print("GATE depth  blockout=%.3f  (MEASURED from geometry, not invented)" % (mx.y - mn.y))
print("GATE raycast coverage %.2f%% (%d misses of %d points)" % (100.0 * (tot_pts - tot_miss) / max(1, tot_pts), tot_miss, tot_pts))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "step2_blockout.blend"))
print("STEP2 saved step2_blockout.blend")
