"""STEP 2 - BLOCKING THE BASE   *** MODELLED FORMS. NO SCAN. NO BLOBS. NO PRIMITIVES. ***

HARD RULE: nothing generic, nothing invented where it can be measured, nothing merged,
nothing omitted. Every element is its OWN object.

FOUR FAILED APPROACHES (never repeat):
  1. generic capsules -> blobs, a 31cm-thick upper arm
  2. silhouette extruded front/back with a dome -> perfect from the FRONT, a flat lens from
     the SIDE. A bas-relief, not a form.
  3. lofted ellipses with an INVENTED depth-to-width ratio -> a radially symmetric lampshade
  4. per-pixel raycast of the AI high-poly -> correct proportions but TERRACED ("3D printed"),
     one fused shell, and it is a gloss over the AI mesh, not a blockout

CORRECT - the artist method, automated:
  SHELL forms (what the drawing shows) are LOFTED along their own principal axis.
     - the axis, the centre and the half-WIDTH of every slice come from the element mask at
       pixel resolution  -> the silhouette is the drawing
     - the half-DEPTH and the depth centre of every slice are RAYCAST into the AI high-poly
       and then AVERAGED OVER THE WHOLE SLICE -> depth is measured, never invented, and the
       per-pixel scan noise that caused the terracing is gone
     - each slice becomes a smooth superellipse ring, the rings are lofted and capped
       -> a clean closed modelled volume, not a scanned surface
  BODY forms (what the clothing hides) are built from the POSE LANDMARKS, which are also
     measured from the artwork, with researched anatomy proportions for the hidden depth.
  HANDS and FEET are built ANATOMICALLY: palm + 5 digits x 3 phalanges, sole + 5 toes, each
     phalanx its OWN object. The artwork paints a hand 36px wide, so no segmenter can find
     the fingers - an artist models them from anatomy. So do we.

Run: blender -b -P step2_blocking.py -- <ninja_dir>
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ND = sys.argv[sys.argv.index("--") + 1]
H = 1.80
SEG = 24          # ring segments
SE_N = 2.35       # superellipse exponent (organic, slightly boxy)

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

pose = json.load(open(os.path.join(ND, "pose.json")))
LMK = pose["landmarks"]


def W(i):
    """landmark -> world (x, z). The landmark z is unreliable, so depth never comes from it."""
    return np.array([(LMK[i]["x"] * IW - ccx) * mpp, (cy1 - LMK[i]["y"] * IH) * mpp])


mw = hp.matrix_world
bvh = BVHTree.FromPolygons([mw @ v.co for v in hp.data.vertices],
                           [list(p.vertices) for p in hp.data.polygons],
                           all_triangles=False, epsilon=0.0)
YFAR = 3.0


def march(x, z, limit=10):
    """every surface crossing along +Y at this point, front to back.
    A single front hit plus a single back hit is NOT enough: at the hip the front ray hits the
    pant leg and the back ray hits the PONCHO, which reported a 38cm-deep leg. Marching gives
    the NEAREST CLOSED SLAB, which is the piece we are actually measuring."""
    out = []
    y = -YFAR
    for _ in range(limit):
        h = bvh.ray_cast(Vector((x, y, z)), Vector((0, 1, 0)), 2 * YFAR)
        if h[0] is None:
            break
        y = h[0].y + 1e-4
        if y > YFAR:
            break
        out.append(h[0].y)
    return out


def measure(x, z):
    """front and back of the NEAREST slab at this point"""
    h = march(x, z)
    if len(h) < 2:
        return None
    return h[0], h[1]


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

COL_SHELL = bpy.data.collections.new("BLOCK_SHELL")     # measured from the drawing
COL_BODY = bpy.data.collections.new("BLOCK_BODY")       # anatomy under the clothing
sc.collection.children.link(COL_SHELL)
sc.collection.children.link(COL_BODY)
MATS = {}
MADE = []
SKIN = np.array([0.80, 0.63, 0.52])


# ----------------------------------------------------------------------------- smoothing
def lowpass(a, passes=4):
    """binomial low-pass on a 1-D profile. A profile holds ~40 samples, so this is cheap and
    it removes the scan noise WITHOUT shrinking the form, because the ends are held."""
    a = np.asarray(a, dtype=np.float64).copy()
    for _ in range(passes):
        b = a.copy()
        b[1:-1] = 0.25 * a[:-2] + 0.5 * a[1:-1] + 0.25 * a[2:]
        a = b
    return a


def clamp_outliers(a, k=2.5):
    a = np.asarray(a, dtype=np.float64)
    med = np.median(a)
    mad = np.median(np.abs(a - med)) + 1e-6
    return np.clip(a, med - k * 1.4826 * mad, med + k * 1.4826 * mad)


# ----------------------------------------------------------------------------- loft core
def ring(c3, ax_u, hw, hd, n=SE_N):
    """superellipse ring. ax_u is the in-plane direction, the depth axis is world Y."""
    pts = []
    for s in range(SEG):
        t = 2.0 * math.pi * s / SEG
        ct, st = math.cos(t), math.sin(t)
        u = math.copysign(abs(ct) ** (2.0 / n), ct) * hw
        v = math.copysign(abs(st) ** (2.0 / n), st) * hd
        pts.append(Vector((c3[0] + ax_u[0] * u, c3[1] + v, c3[2] + ax_u[1] * u)))
    return pts


def build_loft(name, centres, ax_u, hw, hd, col, colour, cap0=True, cap1=True):
    """centres: list of (x, y, z). ax_u: (ux, uz) in-plane unit. hw / hd: per-slice halves."""
    bm = bmesh.new()
    rows = []
    axis = np.array(centres[-1], dtype=float) - np.array(centres[0], dtype=float)
    na = np.linalg.norm(axis)
    axis = axis / na if na > 1e-9 else np.array([0.0, 0.0, 1.0])

    def add_cap(idx, sgn):
        cs = [(0.78, 0.30), (0.44, 0.52), (0.0, 0.62)]
        out = []
        c0 = np.array(centres[idx], dtype=float)
        r0 = max(hw[idx], hd[idx])
        for sc_, off in cs:
            c = c0 + axis * (sgn * off * r0)
            if sc_ <= 0.0:
                out.append([bm.verts.new(Vector(c))])
            else:
                out.append([bm.verts.new(p) for p in ring(c, ax_u, hw[idx] * sc_, hd[idx] * sc_)])
        return out

    if cap0:
        rows += list(reversed(add_cap(0, -1.0)))
    for i, c in enumerate(centres):
        rows.append([bm.verts.new(p) for p in ring(c, ax_u, hw[i], hd[i])])
    if cap1:
        rows += add_cap(len(centres) - 1, 1.0)

    for a, b in zip(rows[:-1], rows[1:]):
        if len(a) == 1 or len(b) == 1:
            first_is_tip = len(a) == 1
            tip = a[0] if first_is_tip else b[0]
            r = b if first_is_tip else a
            for s in range(SEG):
                try:
                    if first_is_tip:
                        bm.faces.new((tip, r[s], r[(s + 1) % SEG]))
                    else:
                        bm.faces.new((tip, r[(s + 1) % SEG], r[s]))
                except ValueError:
                    pass
        else:
            for s in range(SEG):
                try:
                    bm.faces.new((a[s], a[(s + 1) % SEG], b[(s + 1) % SEG], b[s]))
                except ValueError:
                    pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("BLK_" + name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new("BLK_" + name, me)
    col.objects.link(o)
    o["blockout"] = True
    key = tuple(round(float(c), 3) for c in colour)
    if key not in MATS:
        m = bpy.data.materials.new("BLKmat_%d" % len(MATS))
        m.use_nodes = True
        next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"
             ).inputs["Base Color"].default_value = (float(colour[0]), float(colour[1]),
                                                     float(colour[2]), 1.0)
        MATS[key] = m
    me.materials.append(MATS[key])
    MADE.append((name, len(me.vertices), len(me.polygons)))
    return o


# ------------------------------------------------------------------- SHELL: from the mask
def build_shell(part):
    name = part["name"]
    mask = load_gray(os.path.join(ND, part["mask"])) > 0.5
    ys, xs = np.where(mask)
    if xs.size < 250:
        return None
    colour = SRC[mask].mean(axis=0)

    wx = (xs.astype(np.float64) - ccx) * mpp
    wz = (cy1 - ys.astype(np.float64)) * mpp
    P = np.stack([wx, wz], axis=1)
    mu = P.mean(axis=0)
    C = np.cov((P - mu).T)
    ev, evec = np.linalg.eigh(C)
    a = evec[:, int(np.argmax(ev))]          # principal (long) axis
    if a[1] > 0:                             # point it downward for consistency
        a = -a
    u = np.array([-a[1], a[0]])              # in-plane perpendicular

    t = (P - mu) @ a
    q = (P - mu) @ u
    t0, t1 = t.min(), t.max()
    span = t1 - t0
    nsl = int(np.clip(span / (5.0 * mpp), 12, 70))
    edges = np.linspace(t0, t1, nsl + 1)
    idx = np.clip(np.digitize(t, edges) - 1, 0, nsl - 1)

    cu, hwv, cy_, hdv, tv = [], [], [], [], []
    miss = 0
    for k in range(nsl):
        sel = idx == k
        if sel.sum() < 6:
            continue
        qk = q[sel]
        q0, q1 = qk.min(), qk.max()
        c = 0.5 * (q0 + q1)
        hw = max(0.5 * (q1 - q0), 0.6 * mpp)
        tc = 0.5 * (edges[k] + edges[k + 1])
        yf, yb, n = [], [], 0
        for f in (-0.82, -0.55, -0.28, 0.0, 0.28, 0.55, 0.82):
            pw = mu + a * tc + u * (c + f * hw * 0.92)
            m = measure(pw[0], pw[1])
            if m:
                yf.append(m[0])
                yb.append(m[1])
                n += 1
        if n < 2:
            miss += 1
            continue
        cu.append(c)
        hwv.append(hw)
        tv.append(tc)
        cy_.append(0.5 * (np.mean(yf) + np.mean(yb)))
        hdv.append(max(0.5 * (np.mean(yb) - np.mean(yf)), 0.35 * mpp))
    if len(tv) < 6:
        return None

    cu = lowpass(np.array(cu), 3)
    hwv = lowpass(np.array(hwv), 2)
    cy_ = lowpass(clamp_outliers(np.array(cy_), 3.0), 4)
    hdv = np.array(hdv)
    # A slice near where one piece meets another still reads the neighbour's slab. The drawing
    # gives the width exactly, so the width is the ceiling: no piece here is deeper than it is
    # wide. Without this the fox ear (7cm wide) measured 16cm deep, which is the skull.
    hdv = np.minimum(hdv, 0.92 * hwv.max())
    hdv = lowpass(clamp_outliers(hdv, 2.5), 4)
    tv = np.array(tv)

    centres = [(mu[0] + a[0] * tv[i] + u[0] * cu[i], cy_[i],
                mu[1] + a[1] * tv[i] + u[1] * cu[i]) for i in range(len(tv))]
    build_loft(name, centres, u, hwv, hdv, COL_SHELL, colour)
    SHELL_HW[name] = hwv
    return name, len(tv), miss, float(hwv.max() * 2), float(hdv.max() * 2)


SHELL_HW = {}


def shell_hw(name, frac, fallback):
    """the measured half-width of a drawn garment at a fraction along its own axis.
    The body core inside that garment is sized FROM this, so the anatomy can never erupt
    through the cloth - which is what put white blobs on the shins."""
    hw = SHELL_HW.get(name)
    if hw is None or len(hw) == 0:
        return fallback
    return float(hw[int(np.clip(frac, 0.0, 1.0) * (len(hw) - 1))])


# ---------------------------------------------------------- BODY / DIGITS: from anatomy
def taper(name, p0, p1, r0, r1, d0, d1, col=None, colour=None, nseg=7, bulge=0.0):
    """a modelled tapered form between two world (x, z) points. r = half-width, d = half-depth"""
    p0 = np.asarray(p0, dtype=float)
    p1 = np.asarray(p1, dtype=float)
    ax = p1 - p0
    L = np.linalg.norm(ax)
    if L < 1e-5:
        return
    ax = ax / L
    u = np.array([-ax[1], ax[0]])
    centres, hw, hd, yc = [], [], [], []
    for i in range(nseg):
        s = i / (nseg - 1.0)
        p = p0 + (p1 - p0) * s
        m = measure(p[0], p[1])
        yc.append(0.5 * (m[0] + m[1]) if m else None)
    good = [v for v in yc if v is not None]
    fill = float(np.mean(good)) if good else 0.0
    yc = lowpass(np.array([v if v is not None else fill for v in yc]), 2)
    for i in range(nseg):
        s = i / (nseg - 1.0)
        b = 1.0 + bulge * math.sin(math.pi * s)
        p = p0 + (p1 - p0) * s
        # the core sits at the MEASURED depth centre of the body there. Pinning it to y=0
        # pushed the calves out through the front of the shin wraps.
        centres.append((p[0], float(yc[i]), p[1]))
        hw.append((r0 + (r1 - r0) * s) * b)
        hd.append((d0 + (d1 - d0) * s) * b)
    build_loft(name, centres, u, np.array(hw), np.array(hd),
               col or COL_BODY, colour if colour is not None else SKIN)


def depth_at(p, fallback):
    m = measure(p[0], p[1])
    return (0.5 * (m[0] + m[1]), 0.5 * (m[1] - m[0])) if m else (0.0, fallback)


# ----------------------------------------------------------------------------- run SHELL
shell_report = []
for part in parts:
    if part["name"].startswith(("hand_", "foot_")):
        continue                      # hands and feet are modelled anatomically below
    r = build_shell(part)
    if r:
        shell_report.append(r)
SHELL_NAMES = set(s[0] for s in shell_report)

# ------------------------------------------------------------------------------ run BODY
sho_L, sho_R = W(11), W(12)
elb_L, elb_R = W(13), W(14)
wri_L, wri_R = W(15), W(16)
hip_L, hip_R = W(23), W(24)
kne_L, kne_R = W(25), W(26)
ank_L, ank_R = W(27), W(28)
toe_L, toe_R = W(31), W(32)
sho_c = 0.5 * (sho_L + sho_R)
hip_c = 0.5 * (hip_L + hip_R)
SHW = float(np.linalg.norm(sho_L - sho_R))
HIPW = float(np.linalg.norm(hip_L - hip_R))

PB = {p["name"]: p for p in parts}

# head: the kabuki mask gives the face plate, the hood gives the crown. The skull sits behind.
mk = PB.get("mask")
hd_ = PB.get("hood")
if mk and hd_:
    mb, hb = mk["bbox"], hd_["bbox"]
    head_top = (cy1 - hb[1]) * mpp
    chin = (cy1 - mb[3]) * mpp
    # The SKULL is as wide as the EARS, not as wide as the kabuki mask. The mask bbox is
    # 236px because the fox cheek plates flare out past the face, which gave a 29cm skull.
    hw_head = 0.54 * float(abs(W(7)[0] - W(8)[0]))
    cxh = 0.5 * (W(7)[0] + W(8)[0])
    ycen, ydep = depth_at((cxh, 0.5 * (head_top + chin)), hw_head)
    ydep = max(ydep, hw_head * 1.05)          # a skull is deeper than it is wide
    cen, hwl, hdl = [], [], []
    for i in range(9):
        s = i / 8.0
        z = head_top - (head_top - chin) * s
        prof = math.sin(math.pi * (0.16 + 0.74 * s))       # crown narrow, cheek wide, jaw in
        cen.append((cxh, ycen, z))
        hwl.append(hw_head * (0.52 + 0.48 * prof))
        hdl.append(ydep * (0.55 + 0.45 * prof))
    build_loft("skull", cen, np.array([1.0, 0.0]), np.array(hwl), np.array(hdl),
               COL_BODY, SKIN)
    taper("neck", (cxh, chin + 0.02), (sho_c[0], sho_c[1] + 0.02),
          0.20 * SHW, 0.26 * SHW, 0.19 * SHW, 0.24 * SHW, nseg=5)

# torso: chest / abdomen / pelvis as three separate forms (the reference blocks them apart)
TD = 0.36 * SHW          # half-depth of the chest. Anatomy ratio: chest depth ~0.72 * sho_w
abd_t = sho_c + (hip_c - sho_c) * 0.42
abd_b = sho_c + (hip_c - sho_c) * 0.80
for nm, p0, p1, r0, r1, d0, d1 in (
        ("chest", sho_c + np.array([0, 0.03]), abd_t, 0.54 * SHW, 0.42 * SHW, TD, 0.80 * TD),
        ("abdomen", abd_t, abd_b, 0.42 * SHW, 0.46 * SHW, 0.80 * TD, 0.82 * TD),
        ("pelvis", abd_b, hip_c - np.array([0, 0.06]), 0.46 * SHW, 0.52 * HIPW,
         0.82 * TD, 0.86 * TD)):
    taper(nm, p0, p1, r0, r1, d0, d1, nseg=6, bulge=0.04)

# arms: the upper arm hides under the poncho -> anatomy. The forearm wrap is drawn -> measured.
for sd, sh, el in (("L", sho_L, elb_L), ("R", sho_R, elb_R)):
    ua = float(np.linalg.norm(sh - el))
    fa = 0.80 * shell_hw("wrap_" + sd, 0.2, 0.125 * ua)   # the wrap is drawn -> measured
    taper("upperarm_" + sd, sh, el, 1.30 * fa, 1.05 * fa, 1.30 * fa, 1.05 * fa,
          nseg=6, bulge=0.06)
    taper("shoulder_" + sd, sh + (sho_c - sh) * 0.30, sh + (el - sh) * 0.22,
          1.45 * fa, 1.35 * fa, 1.45 * fa, 1.35 * fa, nseg=5)
    taper("forearm_" + sd, el, W(15 if sd == "L" else 16),
          1.05 * fa, 0.74 * fa, 1.05 * fa, 0.74 * fa, nseg=6)

# thighs and calves sit inside the drawn pants and shins, so their radius comes FROM the
# measured garment width. An anatomy ratio put the calves out through the shin wraps.
for sd, hp_, kn, an in (("L", hip_L, kne_L, ank_L), ("R", hip_R, kne_R, ank_R)):
    th = float(np.linalg.norm(hp_ - kn))
    t0 = 0.74 * shell_hw("pants_" + sd, 0.10, 0.20 * th)
    t1 = 0.74 * shell_hw("pants_" + sd, 0.90, 0.115 * th)
    taper("thigh_" + sd, hp_, kn, t0, t1, t0, t1, nseg=6, bulge=0.04)
    c0 = 0.76 * shell_hw("shin_" + sd, 0.08, 0.135 * th)
    c1 = 0.76 * shell_hw("shin_" + sd, 0.80, 0.075 * th)
    taper("calf_" + sd, kn, an, c0, c1, c0, c1, nseg=6, bulge=0.06)


# ------------------------------------------------------------------ HANDS: palm + digits
def hand(sd, wrist, elbow, mask_part):
    fwd = wrist - elbow
    L = float(np.linalg.norm(fwd))
    if L < 1e-5:
        return
    fwd = fwd / L
    side = np.array([-fwd[1], fwd[0]])
    if mask_part:
        b = mask_part["bbox"]
        pw = max((b[2] - b[0]) * mpp, 0.055)
        plen = max((b[3] - b[1]) * mpp, 0.070)
    else:
        pw, plen = 0.085, 0.10
    _, ydep = depth_at(wrist + fwd * plen * 0.4, 0.5 * pw * 0.42)
    ydep = max(min(ydep, 0.30 * pw), 0.16 * pw)
    palm1 = wrist + fwd * (plen * 0.55)
    taper("palm_" + sd, wrist, palm1, 0.40 * pw, 0.50 * pw, ydep, ydep * 0.92, nseg=5)
    fl = plen * 0.52                                     # total finger length
    seglen = [0.40, 0.33, 0.27]
    rel = [0.92, 1.00, 0.95, 0.80]                       # index .. little
    off = [-0.34, -0.11, 0.12, 0.35]
    for f in range(4):
        p = palm1 + side * (off[f] * pw)
        d = fwd + side * (off[f] * 0.18)
        d = d / np.linalg.norm(d)
        for s in range(3):
            ln = fl * rel[f] * seglen[s]
            nxt = p + d * ln
            r0 = 0.115 * pw * (1.0 - 0.10 * s) * (0.85 + 0.2 * rel[f])
            taper("finger%d_%d_%s" % (f + 1, s + 1, sd), p, nxt, r0, r0 * 0.86,
                  r0 * 1.05, r0 * 0.86, nseg=4, bulge=0.12)
            p = nxt
    tdir = fwd * 0.55 + side * (-0.83 if sd == "L" else 0.83)
    tdir = tdir / np.linalg.norm(tdir)
    p = wrist + fwd * (plen * 0.20) + side * ((-0.42 if sd == "L" else 0.42) * pw)
    for s in range(2):
        ln = fl * (0.46 - 0.10 * s)
        nxt = p + tdir * ln
        r0 = 0.145 * pw * (1.0 - 0.12 * s)
        taper("thumb%d_%s" % (s + 1, sd), p, nxt, r0, r0 * 0.85, r0 * 1.05, r0 * 0.85,
              nseg=4, bulge=0.12)
        p = nxt


def foot(sd, ankle, toe, mask_part):
    fwd = toe - ankle
    if np.linalg.norm(fwd) < 1e-5:
        fwd = np.array([0.0, -1.0])
    fwd = fwd / np.linalg.norm(fwd)
    side = np.array([-fwd[1], fwd[0]])
    if mask_part:
        b = mask_part["bbox"]
        fw = max((b[2] - b[0]) * mpp, 0.055)
    else:
        fw = 0.085
    flen = max(float(np.linalg.norm(toe - ankle)) * 1.25, 0.14)
    heel = ankle - fwd * flen * 0.16
    ball = ankle + fwd * flen * 0.62
    taper("heel_" + sd, heel, ankle + fwd * flen * 0.12, 0.32 * fw, 0.42 * fw,
          0.36 * fw, 0.46 * fw, nseg=5)
    taper("instep_" + sd, ankle + fwd * flen * 0.10, ball, 0.42 * fw, 0.48 * fw,
          0.44 * fw, 0.34 * fw, nseg=6)
    rel = [1.00, 0.94, 0.84, 0.72, 0.58]
    off = [-0.34, -0.15, 0.04, 0.22, 0.38]
    if sd == "R":
        off = [-o for o in off]
    for t in range(5):
        base = ball + side * (off[t] * fw)
        r = 0.115 * fw * (0.7 + 0.3 * rel[t])
        tip = base + fwd * (flen * 0.20 * rel[t])
        taper("toe%d_%s" % (t + 1, sd), base, tip, r, r * 0.80, r * 1.05, r * 0.80,
              nseg=4, bulge=0.15)


hand("L", wri_L, elb_L, PB.get("hand_L_core"))
hand("R", wri_R, elb_R, PB.get("hand_R_core"))
foot("L", ank_L, toe_L, PB.get("foot_L_core"))
foot("R", ank_R, toe_R, PB.get("foot_R_core"))

# ------------------------------------------------------------------------------- report
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
print("STEP2 BLOCKING - %d SEPARATE modelled objects" % len(MADE))
print("  SHELL (measured from the drawing):")
for nm, nsl, miss, w_, d_ in sorted(shell_report):
    print("     %-14s slices=%-4d dropped=%-3d width=%.3f depth=%.3f" % (nm, nsl, miss, w_, d_))
body = [m[0] for m in MADE if m[0] not in SHELL_NAMES]
print("  BODY + DIGITS (anatomy, under the clothing): %d objects" % len(body))
print("     " + ", ".join(body))
tv_ = sum(m[1] for m in MADE)
tf_ = sum(m[2] for m in MADE)
print("GATE objects=%d verts=%d faces=%d (a blockout is LIGHT - it is forms, not a scan)"
      % (len(MADE), tv_, tf_))
print("GATE height blockout=%.3f artwork=%.3f (%.2f%%)"
      % (mx.z - mn.z, H, 100 * abs((mx.z - mn.z) - H) / H))
print("GATE width  blockout=%.3f artwork=%.3f (%.2f%%)"
      % (mx.x - mn.x, art_w, 100 * abs((mx.x - mn.x) - art_w) / art_w))
print("GATE depth  blockout=%.3f  (MEASURED per slice, not invented)" % (mx.y - mn.y))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "step2_blockout.blend"))
print("STEP2 saved step2_blockout.blend")
