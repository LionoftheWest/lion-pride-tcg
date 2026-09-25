"""Anatomy template layer — the reusable skeleton + muscle map for creature models.

Data source: Z-Anatomy (CC BY-SA 4.0, Lluis Vinent Juanico), extracted to
`anatomy_human.json` (50 joints + ~245 muscle-group seeds, normalized: feet z=0,
height 1, x centered). This module fits that template to ANY target mesh, builds the
skeleton, and auto-assigns every muscle to the bone it moves with (its nearest bone
segment = the universal origin->insertion-across-a-joint model).

Pipeline habit (Nathan): build the anatomy FIRST (skeleton + muscle map), THEN the
outer surface (skin/scales/armor). Not every creature is bipedal — this is the BIPED
template; add serpent/quadruped/spider/dragon templates as sibling JSON + BONES tables.

    import sys; sys.path.insert(0, r"C:\\Users\\vaugh\\discord\\card-studio\\blender")
    import anatomy as AN; import importlib; importlib.reload(AN)
    tpl = AN.load("human")
    scale, origin = AN.fit_to_mesh(tpl, mesh_obj)      # match template to the mesh
    arm = AN.build_skeleton(tpl, "GolemRig", scale, origin)
    seeds = AN.muscle_seeds(tpl, scale, origin)        # [(name, bone, x,y,z), ...]
"""
import os, json, math
import numpy as np

DIR = os.path.dirname(__file__)
_CACHE = {}

# Bone hierarchy for the biped template: (bone, head_joint, tail_joint, parent).
# Joint keys come from anatomy_human.json. A denser spine/hands is possible by adding
# per-vertebra / per-finger rows — err toward MORE bones for realism.
BIPED_BONES = [
    ("pelvis",   "Sacrum",   "Vertebra L4", None),
    ("spineA",   "Vertebra L4", "Vertebra L1", "pelvis"),
    ("spineB",   "Vertebra L1", "Vertebra T7", "spineA"),
    ("spineC",   "Vertebra T7", "Vertebra C7", "spineB"),
    ("neck",     "Vertebra C7", "Vertebra C3", "spineC"),
    ("head",     "Vertebra C3", "Frontal bone", "neck"),
]
# limbs (built for .l and .r)
_LIMB = [
    ("clav",     "sternoclav", "shoulder", "spineC"),
    ("upperarm", "shoulder",   "elbow",    "clav"),
    ("forearm",  "elbow",      "wrist",    "upperarm"),
    ("hand",     "wrist",      "hand",     "forearm"),
    ("thigh",    "femhead",    "knee",     "pelvis"),
    ("shin",     "knee",       "ankle",    "thigh"),
    ("foot",     "ankle",      "ball",     "shin"),
    ("toe",      "ball",       "balltip",  "foot"),
]
_DROP = ("cross section", "tendinous ring")   # not muscles


def load(name="human"):
    if name in _CACHE:
        return _CACHE[name]
    p = os.path.join(DIR, "anatomy_%s.json" % name)
    tpl = json.load(open(p, encoding="utf-8"))
    # derive a synthetic 'balltip' joint per side (toe tip = ball pushed forward -Y)
    J = tpl["joints"]
    for s in ("l", "r"):
        b = J.get("ball." + s)
        if b:
            J["balltip." + s] = [b[0], b[1] - 0.06, max(0.0, b[2] - 0.01)]
    tpl["muscle_seeds"] = {k: v for k, v in tpl["muscle_seeds"].items()
                           if not any(d in k.lower() for d in _DROP)}
    # template bounding box (from joints) — used for proportion-aware fitting
    P = np.array(list(J.values()))
    tpl["extent"] = {"min": P.min(0).tolist(), "max": P.max(0).tolist()}
    _CACHE[name] = tpl
    return tpl


def bones(tpl):
    out = list(BIPED_BONES)
    for s in ("l", "r"):
        for bn, h, t, par in _LIMB:
            p = par if par in ("pelvis", "spineC") else par + "." + s
            out.append((bn + "." + s, h + "." + s, t + "." + s, p))
    # keep only bones whose joints exist
    J = tpl["joints"]
    return [(b, h, t, p) for (b, h, t, p) in out if h in J and t in J]


def fit_to_mesh(tpl, mesh_obj, uniform_xy=True):
    """Proportion-aware fit: map the template bounding box onto the mesh bounding box
    per axis, so a short/bulky giant spreads shoulders + hips and shortens limbs to
    match its own shape (same anatomy, different proportions). Returns (scale3, origin)
    where world = origin + (norm - tpl_min) * scale3.
    uniform_xy keeps width:depth square so the body is not skewed front-to-back."""
    M = mesh_obj.matrix_world
    vs = [M @ v.co for v in mesh_obj.data.vertices]
    xs = [v.x for v in vs]; ys = [v.y for v in vs]; zs = [v.z for v in vs]
    mn = np.array([min(xs), min(ys), min(zs)]); mx = np.array([max(xs), max(ys), max(zs)])
    tmn = np.array(tpl["extent"]["min"]); tmx = np.array(tpl["extent"]["max"])
    span_t = np.where((tmx - tmn) == 0, 1.0, tmx - tmn)
    scale = (mx - mn) / span_t
    if uniform_xy:
        sxy = (scale[0] + scale[1]) / 2.0
        scale[0] = scale[1] = sxy
    origin = mn - tmn * scale
    return tuple(scale.tolist()), tuple(origin.tolist())


def place(pn, scale, origin):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    return (origin[0] + pn[0] * scale[0], origin[1] + pn[1] * scale[1], origin[2] + pn[2] * scale[2])


def joints_world(tpl, scale, origin):
    return {k: place(v, scale, origin) for k, v in tpl["joints"].items()}


def build_skeleton(tpl, name, scale, origin, riglib=None):
    """Create the armature from the template joints + bone hierarchy."""
    if riglib is None:
        import riglib as riglib
    J = joints_world(tpl, scale, origin)
    B = bones(tpl)
    return riglib.make_armature(name, J, B)


def _seg_dist(p, a, b):
    p = np.array(p); a = np.array(a); b = np.array(b); ab = b - a
    t = 0.0 if (ab @ ab) == 0 else np.clip((p - a) @ ab / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t * ab))


def muscle_seeds(tpl, scale, origin):
    """Every muscle group -> world seed point + the bone it moves with (nearest bone
    segment). Returns [(muscle_name, bone_name, x, y, z), ...]. This IS the universal
    'muscle pulls the joint it crosses' assignment, derived geometrically."""
    J = joints_world(tpl, scale, origin)
    B = bones(tpl)
    segs = [(bn, J[h], J[t]) for (bn, h, t, p) in B]
    out = []
    for mname, pn in tpl["muscle_seeds"].items():
        w = place(pn, scale, origin)
        bn = min(segs, key=lambda s: _seg_dist(w, s[1], s[2]))[0]
        out.append((mname, bn, w[0], w[1], w[2]))
    return out


# ============================================================================
# Anchor-based proportion fit — measure a creature's real landmarks and place
# limb ENDPOINTS from the mesh, interior joints from anatomy ratios. Same anatomy,
# each creature's own proportions.
# ============================================================================

def _wverts(mesh_obj):
    import mathutils
    n = len(mesh_obj.data.vertices)
    a = np.empty(n * 3); mesh_obj.data.vertices.foreach_get("co", a); a = a.reshape(n, 3)
    M = np.array(mesh_obj.matrix_world)
    return (M[:3, :3] @ a.T).T + M[:3, 3]


def measure_anchors(mesh_obj, shoulder_raise=0.0):
    """Read landmark anchors from the mesh (assumes Z up, feet at bottom, faces -Y).
    Endpoints (shoulders, hands, hips, ankles, balls) come from real geometry.
    shoulder_raise (0..0.2 of body height) lifts the shoulder line up — use it for a
    neckless creature whose head sits straight on the shoulders."""
    P = _wverts(mesh_obj)
    z = P[:, 2]; z0 = float(z.min()); z1 = float(z.max()); H = z1 - z0
    def band(zt, bw=0.045):
        zc = z0 + zt * H; return P[np.abs(z - zc) < bw * H]
    # shoulders: widest slice in the upper body
    best = (0.8, 0.0, None)
    for zt in np.linspace(0.68, 0.93, 26):
        s = band(zt)
        if len(s) < 20: continue
        w = float(s[:, 0].max() - s[:, 0].min())
        if w > best[1]: best = (zt, w, s)
    sh_zt, sh_w, sh_s = best
    sh_zt = min(0.93, sh_zt + shoulder_raise)
    sh_s = band(sh_zt)
    sh_z = z0 + sh_zt * H; sh_y = float(np.median(sh_s[:, 1])); sh_hw = float(sh_s[:, 0].max() - sh_s[:, 0].min()) / 2
    A = {}
    A["top"] = np.array([0.0, sh_y, z1]); A["foot_z"] = z0
    A["neck_c"] = np.array([0.0, sh_y, sh_z])
    A["sh.r"] = np.array([+0.82 * sh_hw, sh_y, sh_z])
    A["sh.l"] = np.array([-0.82 * sh_hw, sh_y, sh_z])
    # hip: central (non-arm) cluster near mid-height
    hs = band(0.50, 0.06)
    core = hs[np.abs(hs[:, 0]) < 0.72 * sh_hw] if len(hs) else hs
    hip_hw = float(np.percentile(np.abs(core[:, 0]), 88)) if len(core) else 0.4 * sh_hw
    hip_z = z0 + 0.50 * H; hip_y = float(np.median(core[:, 1])) if len(core) else sh_y
    A["hip.r"] = np.array([+0.55 * hip_hw, hip_y, hip_z])
    A["hip.l"] = np.array([-0.55 * hip_hw, hip_y, hip_z])
    # arm bottom (hand): lowest slice still carrying lateral (arm) mass
    hand_zt = 0.45
    for zt in np.linspace(0.62, 0.28, 18):
        s = band(zt, 0.035)
        lat = s[np.abs(s[:, 0]) > hip_hw * 1.15]
        if len(lat) > 8: hand_zt = zt
        else: break
    hb = band(hand_zt, 0.05)
    for side, sgn in (("r", 1), ("l", -1)):
        lat = hb[np.sign(hb[:, 0]) == sgn]
        lat = lat[np.abs(lat[:, 0]) > hip_hw * 1.05]
        if len(lat) > 4:
            A["hand." + side] = np.array([float(lat[:, 0].mean()), float(lat[:, 1].mean()), z0 + hand_zt * H])
        else:
            A["hand." + side] = np.array([sgn * sh_hw, sh_y, z0 + hand_zt * H])
    # legs: two lobes low down -> ankle + ball
    lb = band(0.09, 0.05)
    for side, sgn in (("r", 1), ("l", -1)):
        lobe = lb[np.sign(lb[:, 0]) == sgn]
        if len(lobe) < 5: lobe = lb
        cx = float(lobe[:, 0].mean())
        A["ankle." + side] = np.array([cx, float(np.median(lobe[:, 1])), z0 + 0.07 * H])
        A["ball." + side] = np.array([cx, float(lobe[:, 1].min()), z0 + 0.03 * H])
    A["_H"] = H
    return A


def _lerp(a, b, t):
    return a + (np.array(b) - np.array(a)) * t


def anchored_joints(tpl, anchors):
    """World joint positions: endpoints from anchors, interior joints from template
    segment ratios. Covers exactly the joints the bone hierarchy references."""
    J = tpl["joints"]; A = anchors
    def tz(k):  # template z of a joint
        return J[k][2]
    def ratio(a, b, c):  # |a->b| / |a->c| in template space
        pa, pb, pc = np.array(J[a]), np.array(J[b]), np.array(J[c])
        return float(np.linalg.norm(pb - pa) / max(1e-6, np.linalg.norm(pc - pa)))
    out = {}
    out["Sacrum"] = A["hip.r"] * 0 + (A["hip.l"] + A["hip.r"]) / 2  # pelvis center
    out["Vertebra C7"] = A["neck_c"]
    for k in ("Vertebra L4", "Vertebra L1", "Vertebra T7"):
        f = (tz(k) - tz("Sacrum")) / max(1e-6, tz("Vertebra C7") - tz("Sacrum"))
        out[k] = _lerp(out["Sacrum"], out["Vertebra C7"], f)
    fc = (tz("Vertebra C3") - tz("Vertebra C7")) / max(1e-6, tz("Frontal bone") - tz("Vertebra C7"))
    out["Vertebra C3"] = _lerp(A["neck_c"], A["top"], fc)
    out["Frontal bone"] = _lerp(A["neck_c"], A["top"], 1.0)
    for s in ("l", "r"):
        out["sternoclav." + s] = A["neck_c"]
        out["shoulder." + s] = A["sh." + s]
        re_ = ratio("shoulder." + s, "elbow." + s, "hand." + s) if all(("elbow." + s in J, "hand." + s in J)) else 0.5
        rw_ = ratio("shoulder." + s, "wrist." + s, "hand." + s) if ("wrist." + s in J) else 0.85
        # pre-bend the elbow BACK (+Y) so the arm chain is never straight (IK singularity)
        out["elbow." + s] = _lerp(A["sh." + s], A["hand." + s], re_) + np.array([0.0, 0.035 * A["_H"], 0.0])
        out["wrist." + s] = _lerp(A["sh." + s], A["hand." + s], rw_)
        out["hand." + s] = A["hand." + s]
        out["femhead." + s] = A["hip." + s]
        rk = ratio("femhead." + s, "knee." + s, "ankle." + s) if ("knee." + s in J) else 0.5
        # pre-bend the knee FORWARD (-Y) so the leg chain is never straight (IK singularity)
        out["knee." + s] = _lerp(A["hip." + s], A["ankle." + s], rk) + np.array([0.0, -0.035 * A["_H"], 0.0])
        out["ankle." + s] = A["ankle." + s]
        out["ball." + s] = A["ball." + s]
        out["balltip." + s] = A["ball." + s] + np.array([0.0, -0.06 * A["_H"], 0.0])
    return {k: (float(v[0]), float(v[1]), float(v[2])) for k, v in out.items()}


def _bone_frame(head, tail):
    head = np.array(head); tail = np.array(tail); d = tail - head
    L = float(np.linalg.norm(d)); L = L if L > 1e-6 else 1e-6
    return head, d / L, L


def place_muscles_warped(tpl, joints_world):
    """Warp each muscle seed through its nearest template bone into the fitted rig, so
    muscles follow their bone under the per-limb proportion change. Returns
    [(name, bone, x,y,z), ...]."""
    B = bones(tpl); Jt = tpl["joints"]; Jw = joints_world
    old = [(bn, np.array(Jt[h]), np.array(Jt[t])) for (bn, h, t, p) in B if h in Jt and t in Jt]
    new = {bn: (np.array(Jw[h]), np.array(Jw[t])) for (bn, h, t, p) in B if h in Jw and t in Jw}
    out = []
    for mname, pn in tpl["muscle_seeds"].items():
        p = np.array(pn)
        bn, oh, ot = min(old, key=lambda s: _seg_dist(p, s[1], s[2]))
        if bn not in new: continue
        h0, d0, L0 = _bone_frame(oh, ot)
        t = float(np.clip((p - h0) @ d0 / L0, 0, 1))
        off = p - (h0 + t * L0 * d0)                      # perpendicular-ish offset
        nh, nt = new[bn]; h1, d1, L1 = _bone_frame(nh, nt)
        # rotate offset from old bone dir to new bone dir, scale by length change
        v = np.cross(d0, d1); c = float(np.dot(d0, d1)); s = float(np.linalg.norm(v))
        if s < 1e-6:
            R = np.eye(3) if c > 0 else -np.eye(3)
        else:
            vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
            R = np.eye(3) + vx + vx @ vx * ((1 - c) / (s * s))
        w = h1 + t * L1 * d1 + (L1 / L0) * (R @ off)
        out.append((mname, bn, float(w[0]), float(w[1]), float(w[2])))
    return out


def build_rig(mesh_obj, name="Rig", tpl_name="human", riglib=None, shoulder_raise=0.0):
    """Full anchor-based pipeline: measure -> place joints -> build skeleton -> warp
    muscle seeds. Returns (armature, joints_world, muscle_seeds)."""
    if riglib is None:
        import riglib as riglib
    tpl = load(tpl_name)
    A = measure_anchors(mesh_obj, shoulder_raise=shoulder_raise)
    J = anchored_joints(tpl, A)
    arm = riglib.make_armature(name, J, bones(tpl))
    seeds = place_muscles_warped(tpl, J)
    return arm, J, seeds
