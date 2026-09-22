"""STAGE 4 - SEPARATE INTO PARTS.
  Rookies: "I separated each part (body, hair, armour) to manage the complexity."
  Blender Studio: body and clothing are SEPARATE objects.
The high-poly was generated from the concept art and is aligned 1:1 with the reference
plane, so the image<->world mapping is exact. We project every vertex to image space and
label it with the SAM part masks; anything in no mask is BODY (skin: hands, feet, neck).
Output: one object per part, each tagged with its category (garment / prop / body).
Run: blender -b -P stage4_separate.py -- <ninja_dir>
"""
import bpy, sys, os, json
import numpy as np
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
hp = bpy.data.objects["source_highpoly"]
me = hp.data

info = json.load(open(os.path.join(ND, "parts_info.json")))
IW, IH = info["image"]
# MUST use the CLEAN cutout bbox - the raw char_bbox still contains background strokes and
# its centre is ~75px off, which shifts the whole projection and drops a band into "body"
cx0, cy0, cx1, cy1 = info.get("clean_bbox", info["char_bbox"])
TARGET_H = 1.809
mpp = TARGET_H / (cy1 - cy0)
ccx = (cx0 + cx1) / 2.0            # world x = (px - ccx)*mpp ; world z = (cy1 - py)*mpp

# vertex positions -> image pixels (front orthographic, exact by construction)
n = len(me.vertices)
co = np.empty(n * 3, dtype=np.float64); me.vertices.foreach_get("co", co)
co = co.reshape(n, 3)
mw = np.array(hp.matrix_world.to_4x4())
world = co @ mw[:3, :3].T + mw[:3, 3]
px = (world[:, 0] / mpp + ccx).round().astype(np.int64)
py = (cy1 - world[:, 2] / mpp).round().astype(np.int64)
inb = (px >= 0) & (px < IW) & (py >= 0) & (py < IH)
px = np.clip(px, 0, IW - 1); py = np.clip(py, 0, IH - 1)

def dilate(a, it=4):
    """small binary dilation (no scipy in Blender) - the generated garment is slightly
    thicker than the painted silhouette, so its rim projects just outside the 2D mask"""
    for _ in range(it):
        b = a.copy()
        b[1:, :] |= a[:-1, :]; b[:-1, :] |= a[1:, :]
        b[:, 1:] |= a[:, :-1]; b[:, :-1] |= a[:, 1:]
        a = b
    return a

def load_mask(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(h, w, 4)[::-1, :, 0] > 0.5   # Blender images are bottom-up
    bpy.data.images.remove(img)
    return a

CATEGORY = {p["name"]: p["part_type"] for p in info["visible_parts"]}
# props claim first (mask/ears sit on top of cloth), then garments
order = sorted(info["visible_parts"], key=lambda p: (p["part_type"] != "prop", -p["area"]))
label = np.full(n, -1, dtype=np.int32)
names = []
for idx, part in enumerate(order):
    m = dilate(load_mask(os.path.join(ND, part["mask"])), 5)
    hit = m[py, px] & inb & (label < 0)
    label[hit] = idx
    names.append(part["name"])
BODY = len(names); names.append("body"); CATEGORY["body"] = "body"
label[label < 0] = BODY

# face label = majority of its verts
nf = len(me.polygons)
loop_tot = np.empty(nf, dtype=np.int32); me.polygons.foreach_get("loop_total", loop_tot)
verts_per = int(loop_tot[0])
fv = np.empty(nf * verts_per, dtype=np.int64); me.polygons.foreach_get("vertices", fv)
fv = fv.reshape(nf, verts_per)
flab = label[fv]
face_label = np.array([np.bincount(r).argmax() for r in flab])

made = []
for idx, nm in enumerate(names):
    sel = np.where(face_label == idx)[0]
    if sel.size < 40: continue
    used = np.unique(fv[sel])
    remap = -np.ones(n, dtype=np.int64); remap[used] = np.arange(used.size)
    verts = [tuple(co[i]) for i in used]
    faces = [tuple(int(x) for x in remap[fv[f]]) for f in sel]
    nme = bpy.data.meshes.new("Part_" + nm)
    nme.from_pydata(verts, [], faces); nme.update()
    ob = bpy.data.objects.new("Part_" + nm, nme)
    sc.collection.objects.link(ob)
    ob.matrix_world = hp.matrix_world.copy()
    ob["part_type"] = CATEGORY.get(nm, "garment")
    ob["attach"] = {"prop": "bone_parent", "body": "skin"}.get(CATEGORY.get(nm), "derive_or_transfer")
    for p in nme.polygons: p.use_smooth = True
    made.append((ob.name, CATEGORY.get(nm), len(nme.vertices), len(nme.polygons)))

hp.hide_viewport = True; hp.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage4_parts.blend"))
print("STAGE4 separated %d parts" % len(made))
for nm, cat, v, f in sorted(made, key=lambda x: -x[3]):
    print("   %-18s %-8s verts=%-7d faces=%d" % (nm, cat, v, f))
