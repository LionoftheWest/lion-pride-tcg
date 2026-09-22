"""STAGE 6b - SEPARATE the retopologised mesh, then rig EACH PART BY CATEGORY.
The single fused mesh smeared: automatic weights gave poncho vertices to the ARM bones, so
raising an arm dragged the poncho across the body. Fix = the modular rule from the research:
  body              -> skinned to the whole skeleton
  poncho (loose)    -> skinned to the SPINE ONLY, so the arms move freely underneath
  pants/shins/wraps -> skinned to their own limb bones
  mask / ears       -> BONE-PARENTED to the head (rigid props are never skinned)
Run: blender -b -P stage6b_modular_rig.py -- <ninja_dir>
"""
import bpy, sys, os, json, re
import numpy as np
from mathutils import Vector, Matrix

ND = sys.argv[sys.argv.index("--") + 1]
MX = os.path.join(ND, "mixamo")
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
src = bpy.data.objects["Char_retopo"]
src.hide_viewport = False
src.hide_set(False)
for n in ("source_highpoly", "REF_concept"):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(sc.objects):
    if o.name.startswith("Part_"):
        bpy.data.objects.remove(o, do_unlink=True)

# ---------- separate the RETOPO mesh with the same mask projection ----------
info = json.load(open(os.path.join(ND, "parts_info.json")))
IW, IH = info["image"]
cx0, cy0, cx1, cy1 = info.get("clean_bbox", info["char_bbox"])
mpp = 1.809 / (cy1 - cy0)
ccx = (cx0 + cx1) / 2.0
me = src.data
n = len(me.vertices)
co = np.empty(n * 3)
me.vertices.foreach_get("co", co)
co = co.reshape(n, 3)
mw = np.array(src.matrix_world.to_4x4())
world = co @ mw[:3, :3].T + mw[:3, 3]
px = (world[:, 0] / mpp + ccx).round().astype(np.int64)
py = (cy1 - world[:, 2] / mpp).round().astype(np.int64)
inb = (px >= 0) & (px < IW) & (py >= 0) & (py < IH)
px = np.clip(px, 0, IW - 1)
py = np.clip(py, 0, IH - 1)


def dilate(a, it=5):
    for _ in range(it):
        b = a.copy()
        b[1:, :] |= a[:-1, :]
        b[:-1, :] |= a[1:, :]
        b[:, 1:] |= a[:, :-1]
        b[:, :-1] |= a[:, 1:]
        a = b
    return a


def load_mask(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    a = buf.reshape(h, w, 4)[::-1, :, 0] > 0.5
    bpy.data.images.remove(img)
    return a


CAT = {p["name"]: p["part_type"] for p in info["visible_parts"]}
order = sorted(info["visible_parts"], key=lambda p: (p["part_type"] != "prop", -p["area"]))
label = np.full(n, -1, np.int32)
names = []
for i, part in enumerate(order):
    m = dilate(load_mask(os.path.join(ND, part["mask"])), 5)
    hit = m[py, px] & inb & (label < 0)
    label[hit] = i
    names.append(part["name"])
BODY = len(names)
names.append("body")
CAT["body"] = "body"
label[label < 0] = BODY

# ONLY separate what must move INDEPENDENTLY. Pants/shins/wraps/hood simply follow the
# body, so splitting them created ragged seams and gaps with nothing gained. Merge them
# into the body; keep the loose poncho and the rigid props separate.
MERGE_INTO_BODY = {"pants_L", "pants_R", "shin_L", "shin_R", "wrap_L", "wrap_R", "hood"}
for i, nm in enumerate(names):
    if nm in MERGE_INTO_BODY:
        label[label == i] = BODY

nf = len(me.polygons)
lt = np.empty(nf, np.int32)
me.polygons.foreach_get("loop_total", lt)
vp = int(lt[0])
fv = np.empty(nf * vp, np.int64)
me.polygons.foreach_get("vertices", fv)
fv = fv.reshape(nf, vp)
face_label = np.array([np.bincount(r).argmax() for r in label[fv]])

made = {}
for i, nm in enumerate(names):
    sel = np.where(face_label == i)[0]
    if sel.size < 30:
        continue
    used = np.unique(fv[sel])
    remap = -np.ones(n, np.int64)
    remap[used] = np.arange(used.size)
    nme = bpy.data.meshes.new("P_" + nm)
    nme.from_pydata([tuple(co[j]) for j in used], [],
                    [tuple(int(x) for x in remap[fv[f]]) for f in sel])
    nme.update()
    ob = bpy.data.objects.new("P_" + nm, nme)
    sc.collection.objects.link(ob)
    ob.matrix_world = src.matrix_world.copy()
    for p in nme.polygons:
        p.use_smooth = True
    ob["category"] = CAT.get(nm, "garment")
    made[nm] = ob
src.hide_viewport = True
src.hide_render = True

# ---------- skeleton, posed to the concept-art A-pose, applied as rest ----------
before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath=os.path.join(MX, "xbot_base_tpose.fbx"))
imp = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in imp if o.type == 'ARMATURE')
arm.name = "Rig"
for o in imp:
    if o.type != 'ARMATURE':
        bpy.data.objects.remove(o, do_unlink=True)
# the Mixamo FBX carries a T-pose ACTION that overwrites any pose on load
if arm.animation_data:
    arm.animation_data.action = None
    arm.animation_data_clear()
for pb in arm.pose.bones:
    pb.matrix_basis.identity()
vl.update()

allp = list(made.values())
mn = Vector((1e18,) * 3)
mx = Vector((-1e18,) * 3)
for o in allp:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])


def ab():
    pts = [arm.matrix_world @ b.head_local for b in arm.data.bones] + \
          [arm.matrix_world @ b.tail_local for b in arm.data.bones]
    return min(p.z for p in pts), max(p.z for p in pts), min(p.x for p in pts), max(p.x for p in pts)


z0, z1, x0, x1 = ab()
arm.scale = tuple(v * ((mx.z - mn.z) * 0.96 / max(1e-6, z1 - z0)) for v in arm.scale)
vl.update()
z0, z1, x0, x1 = ab()
arm.location.z += mn.z - z0
arm.location.x += ((mn.x + mx.x) / 2) - ((x0 + x1) / 2)
vl.update()

P = json.load(open(os.path.join(ND, "pose.json")))
L = P["landmarks"]


def d2(a, b):
    return Vector(((L[b]["x"] - L[a]["x"]) * IW, 0.0, -(L[b]["y"] - L[a]["y"]) * IH))


def aim(bone, wd):
    pb = arm.pose.bones.get(bone)
    if not pb or wd.length < 1e-6:
        return
    vl.update()
    hw = arm.matrix_world @ pb.head
    cur = (arm.matrix_world @ pb.tail) - hw
    if cur.length < 1e-6:
        return
    q = cur.normalized().rotation_difference(wd.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()


for bone, a, b in [("mixamorig:LeftArm", 11, 13), ("mixamorig:LeftForeArm", 13, 15),
                   ("mixamorig:RightArm", 12, 14), ("mixamorig:RightForeArm", 14, 16),
                   ("mixamorig:LeftUpLeg", 23, 25), ("mixamorig:LeftLeg", 25, 27),
                   ("mixamorig:RightUpLeg", 24, 26), ("mixamorig:RightLeg", 26, 28)]:
    aim(bone, d2(a, b))

bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
vl.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply()
bpy.ops.object.mode_set(mode='OBJECT')
vl.update()


def seg_dist(p, a, b):
    ab = b - a
    L2 = ab.dot(ab)
    t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
    return (p - (a + ab * t)).length


def restrict_weights(ob, arm, pattern):
    """Keep Blender's SMOOTH bone-heat weights, but restrict which bones may influence the
    part. Two earlier attempts failed:
      - deleting the disallowed groups left vertices with ZERO weight -> pinned at rest,
        neighbours move, mesh tears
      - weighting to the nearest 2 bones by inverse distance made HARD discontinuities ->
        adjacent faces follow different bones and rip apart (1898 boundary edges shredded)
    Correct: auto-weight first (smooth gradients), then REDISTRIBUTE each disallowed bone's
    weight onto the allowed bones the vertex already has, then normalise and smooth."""
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    arm.select_set(True)
    vl.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    allowed_idx = {g.index for g in ob.vertex_groups if re.search(pattern, g.name)}
    if not allowed_idx:
        return 0
    allowed_bones = [b for b in arm.data.bones if re.search(pattern, b.name)]
    segs = [(b.name, arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local)
            for b in allowed_bones]
    mw = ob.matrix_world
    for v in ob.data.vertices:
        tot_a = sum(g.weight for g in v.groups if g.group in allowed_idx)
        tot_d = sum(g.weight for g in v.groups if g.group not in allowed_idx)
        if tot_a > 1e-5:
            scale = (tot_a + tot_d) / tot_a
            for g in list(v.groups):
                if g.group in allowed_idx:
                    ob.vertex_groups[g.group].add([v.index], min(1.0, g.weight * scale), 'REPLACE')
        else:
            wp = mw @ v.co
            best = min(segs, key=lambda sg: seg_dist(wp, sg[1], sg[2]))[0]
            ob.vertex_groups[best].add([v.index], 1.0, 'REPLACE')
    for g in list(ob.vertex_groups):
        if g.index not in allowed_idx and not re.search(pattern, g.name):
            ob.vertex_groups.remove(g)
    # smooth the weights so no hard seams remain
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    vl.objects.active = ob
    try:
        bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
        bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=6)
        bpy.ops.object.mode_set(mode='OBJECT')
    except Exception as e:
        try:
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass
    return len(ob.vertex_groups)


# ---------- rig each part BY CATEGORY ----------
KEEP = {
    "poncho": r"(Hips|Spine|Neck|Head)",
    "hood": r"(Head|Neck|Spine2)",
    "pants_L": r"(Hips|LeftUpLeg|LeftLeg)",
    "pants_R": r"(Hips|RightUpLeg|RightLeg)",
    "shin_L": r"(LeftLeg|LeftFoot)",
    "shin_R": r"(RightLeg|RightFoot)",
    "wrap_L": r"(LeftForeArm|LeftHand)",
    "wrap_R": r"(RightForeArm|RightHand)",
}
report = []
for nm, ob in made.items():
    cat = ob["category"]
    if cat == "prop":
        ob.parent = arm
        ob.parent_type = 'BONE'
        ob.parent_bone = "mixamorig:Head"
        hb = arm.data.bones["mixamorig:Head"]
        ob.matrix_parent_inverse = (arm.matrix_world @ Matrix.Translation(hb.tail_local)).inverted()
        report.append((nm, cat, "bone_parent:Head", 0))
        continue
    keep = KEEP.get(nm)
    if keep:
        nb = restrict_weights(ob, arm, keep)
        report.append((nm, cat, "auto+restricted", nb))
    else:
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        arm.select_set(True)
        vl.objects.active = arm
        try:
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')
            report.append((nm, cat, "auto_weights", len(ob.vertex_groups)))
        except Exception as e:
            report.append((nm, cat, "BIND FAIL " + str(e)[:40], 0))
    vl.update()

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage6_modular.blend"))
print("STAGE6b modular rig")
for nm, cat, how, rem in sorted(report):
    print("  %-10s %-8s %-22s groups_removed=%d" % (nm, cat, how, rem))
