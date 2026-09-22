"""STEP 2 - BLOCKING THE BASE  (therookies step 2)   *** NO BLOBS. ACTUAL SHAPES. ***

Every design element in the artwork gets its own piece, and each piece is built from ITS
OWN pixel-accurate silhouette taken from the drawing - not a primitive standing in for it.

Method per part:
  - its SAM mask gives the exact outline
  - its distance-transform depth map gives a rounded cross-section, so the piece has real
    volume instead of being a flat slab
  - a fine grid (millimetre-scale) is built inside the mask, displaced front and back by
    the depth profile, and closed with side walls -> a solid piece whose silhouette matches
    the artwork exactly
  - its colour is SAMPLED from the artwork, not invented

Parts: poncho, hood, kabuki mask, both ears, both thigh/pant pieces, both shin wraps, both
forearm wraps, and every visible skin island (face, hands, feet).
Run: blender -b -P step2_blocking.py -- <ninja_dir> [px_step]
"""
import bpy, bmesh, sys, os, json
import numpy as np
from mathutils import Vector

ND = sys.argv[sys.argv.index("--") + 1]
_i = sys.argv.index("--")
STEP = int(sys.argv[_i + 2]) if len(sys.argv) > _i + 2 else 3   # grid step in artwork pixels
H = 1.80

bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
vl = bpy.context.view_layer

info = json.load(open(os.path.join(ND, "parts_info.json")))
IW, IH = info["image"]
cx0, cy0, cx1, cy1 = info.get("clean_bbox", info["char_bbox"])
mpp = H / (cy1 - cy0)
ccx = (cx0 + cx1) / 2.0
parts = info.get("blockout_parts", info["visible_parts"])


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

# depth as a fraction of the part's own width - a limb is near-circular, a drape is flatter
DEPTH_FRAC = {"poncho": 0.42, "hood": 0.80, "mask": 0.42, "ear_L": 0.22, "ear_R": 0.22,
              "pants_L": 0.55, "pants_R": 0.55, "shin_L": 0.62, "shin_R": 0.62,
              "wrap_L": 0.62, "wrap_R": 0.62}
DEFAULT_DEPTH = 0.55


def W3(px, py, y):
    return ((px - ccx) * mpp, y, (cy1 - py) * mpp)


def build_part(part):
    name = part["name"]
    mask = load_gray(os.path.join(ND, part["mask"])) > 0.5
    dpath = os.path.join(ND, "d_%s.png" % name)
    depth = load_gray(dpath) if os.path.exists(dpath) else mask.astype(np.float32)
    ys, xs = np.where(mask)
    if xs.size < 50:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    wpx = x1 - x0 + 1
    half_depth = (wpx * mpp) * DEPTH_FRAC.get(name, DEFAULT_DEPTH) * 0.5

    gx = list(range(x0, x1 + 1, STEP))
    gy = list(range(y0, y1 + 1, STEP))
    inside = {}
    bm = bmesh.new()
    vF = {}
    vB = {}
    for j, py in enumerate(gy):
        for i, px in enumerate(gx):
            if mask[py, px]:
                d = float(depth[py, px])
                vF[(i, j)] = bm.verts.new(W3(px, py, -half_depth * d))
                vB[(i, j)] = bm.verts.new(W3(px, py, half_depth * d))
                inside[(i, j)] = True
    if len(vF) < 20:
        bm.free()
        return None

    quads = []
    for j in range(len(gy) - 1):
        for i in range(len(gx) - 1):
            c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            if all(k in inside for k in c):
                quads.append(c)
                bm.faces.new([vF[k] for k in c])
                bm.faces.new([vB[k] for k in reversed(c)])
    if not quads:
        bm.free()
        return None
    # close the sides: any grid edge used by exactly one quad is on the outline
    from collections import Counter
    edges = Counter()
    for c in quads:
        for k in range(4):
            a, b = c[k], c[(k + 1) % 4]
            edges[tuple(sorted((a, b)))] += 1
    for (a, b), cnt in edges.items():
        if cnt == 1:
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
    o["part"] = name

    col = SRC[mask].mean(axis=0)
    m = bpy.data.materials.new("BLK_" + name)
    m.use_nodes = True
    next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (
        float(col[0]), float(col[1]), float(col[2]), 1.0)
    me.materials.append(m)
    return o, len(me.vertices), len(me.polygons), half_depth * 2, col


made = []
for part in parts:
    r = build_part(part)
    if r:
        made.append((part["name"], r[1], r[2], r[3], r[4]))

# 1:1 reference plane behind
Wp, Hp = IW * mpp, IH * mpp
me = bpy.data.meshes.new("REF_plane")
me.from_pydata([(-Wp / 2, 0, 0), (Wp / 2, 0, 0), (Wp / 2, 0, Hp), (-Wp / 2, 0, Hp)], [], [(0, 1, 2, 3)])
me.update()
ref = bpy.data.objects.new("REF_concept", me)
sc.collection.objects.link(ref)
me.uv_layers.new(name="UV")
for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
    me.uv_layers[0].data[i].uv = uv
m = bpy.data.materials.new("REF_mat")
m.use_nodes = True
nt = m.node_tree
nt.nodes.clear()
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(os.path.join(ND, "source.png"))
emi = nt.nodes.new("ShaderNodeEmission")
out = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(tex.outputs["Color"], emi.inputs["Color"])
nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
me.materials.append(m)
ref.location = (-(ccx - IW / 2) * mpp, 0.50, -(IH - cy1) * mpp)
ref.hide_select = True

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

print("STEP2 BLOCKING - %d pieces, each from its own artwork silhouette" % len(made))
for nm, v, f, d, col in sorted(made, key=lambda t: -t[2]):
    print("   %-10s verts=%-6d faces=%-6d depth=%.3f  colour=(%.2f,%.2f,%.2f)"
          % (nm, v, f, d, col[0], col[1], col[2]))
print("GATE height  blockout=%.3f artwork=%.3f  (diff %.1f%%)" % (mx.z - mn.z, H, 100 * abs((mx.z - mn.z) - H) / H))
print("GATE width   blockout=%.3f artwork=%.3f  (diff %.1f%%)" % (mx.x - mn.x, art_w, 100 * abs((mx.x - mn.x) - art_w) / art_w))
print("GATE floor   lowest z=%.3f (should be ~0)" % mn.z)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "step2_blockout.blend"))
print("STEP2 saved step2_blockout.blend")
