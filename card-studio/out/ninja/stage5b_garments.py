"""STAGE 5b - RETOPOLOGY: the CONFORMING GARMENTS.
Blender Studio: "the clothes are mostly COPIES OF THE UNDERLYING BODY but with different
edge flow where the geometry is different, and where I modeled in wrinkles."

  1. DERIVE - duplicate the body faces for that bone region. Inherits the body's clean quad
     topology, vertex groups and armature modifier -> fitted + rigged for free.
  2. CONFORM - measure, per vertex, how far the generated garment sits off the body by
     RAYCASTING along the vertex normal. Smooth that DISTANCE FIELD (a scalar - smoothing it
     cannot shrink the mesh, unlike smoothing geometry, which collapsed it), then offset each
     vertex along its normal. Gives the garment's real bagginess without the AI triangle-soup
     noise and without Laplacian collapse.
Run: blender -b -P stage5b_garments.py -- <ninja_dir>
"""
import bpy, bmesh, sys, os, re, statistics
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage5_body.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
body = bpy.data.objects["Body_retopo"]
arm = bpy.data.objects["Rig"]

def mat(name, rgba):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name); m.use_nodes = True
    next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = rgba
    return m
GREEN = mat("Cloth", (0.09, 0.28, 0.16, 1))
DARK  = mat("PantsMat", (0.045, 0.045, 0.055, 1))
WRAP  = mat("WrapMat", (0.13, 0.20, 0.15, 1))

SPEC = [
    ("Garment_pants", r"(UpLeg)$",              ["Part_pants_L", "Part_pants_R"], DARK,  0.16),
    ("Garment_shins", r"(:LeftLeg|:RightLeg)$", ["Part_shin_L", "Part_shin_R"],   WRAP,  0.10),
    ("Garment_wrapL", r"LeftForeArm$",          ["Part_wrap_L"],                  WRAP,  0.08),
    ("Garment_wrapR", r"RightForeArm$",         ["Part_wrap_R"],                  WRAP,  0.08),
    ("Garment_hood",  r"(Head|Neck)$",          ["Part_hood"],                    GREEN, 0.18),
]

def target_bvh(names):
    verts, faces = [], []
    for n in names:
        t = bpy.data.objects.get(n)
        if not t: continue
        off = len(verts)
        mwt = t.matrix_world
        verts += [mwt @ v.co for v in t.data.vertices]
        faces += [[i + off for i in p.vertices] for p in t.data.polygons]
    if not faces: return None
    return BVHTree.FromPolygons(verts, faces, all_triangles=False, epsilon=0.0)

def build(name, bone_re, targets, material, maxd):
    o = body.copy(); o.data = body.data.copy(); o.name = name
    sc.collection.objects.link(o)
    gi = {g.index for g in o.vertex_groups if re.search(bone_re, g.name)}
    if not gi:
        bpy.data.objects.remove(o, do_unlink=True); print("  no groups", name); return None
    me = o.data
    keep = {v.index for v in me.vertices if sum(g.weight for g in v.groups if g.group in gi) > 0.5}
    if len(keep) < 12:
        bpy.data.objects.remove(o, do_unlink=True); print("  too few verts", name); return None
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    dead = [v for v in bm.verts if v.index not in keep]
    if dead: bmesh.ops.delete(bm, geom=dead, context='VERTS')
    bm.to_mesh(me); bm.free()

    bvh = target_bvh(targets)
    mw = o.matrix_world; mwi = mw.inverted()
    nrm = [v.normal.copy() for v in me.vertices]
    rot = mw.to_3x3()
    dist = [None] * len(me.vertices)
    hits = 0
    if bvh:
        for i, v in enumerate(me.vertices):
            origin = mw @ v.co
            d = (rot @ nrm[i]).normalized()
            loc, n2, idx, dd = bvh.ray_cast(origin + d * 0.001, d, maxd)
            if loc is not None:
                dist[i] = min(dd, maxd); hits += 1
    known = [d for d in dist if d is not None]
    med = statistics.median(known) if known else 0.012
    dist = [med if d is None else d for d in dist]

    # smooth the DISTANCE FIELD over mesh adjacency (scalar -> cannot shrink the mesh)
    adj = [[] for _ in range(len(me.vertices))]
    for e in me.edges:
        a, b = e.vertices; adj[a].append(b); adj[b].append(a)
    for _ in range(14):
        dist = [(d if not adj[i] else 0.35*d + 0.65*(sum(dist[j] for j in adj[i])/len(adj[i])))
                for i, d in enumerate(dist)]

    for i, v in enumerate(me.vertices):
        v.co += nrm[i] * (dist[i] + 0.004)
    for p in me.polygons: p.use_smooth = True
    o.data.materials.clear(); o.data.materials.append(material)
    o["part_type"] = "garment"; o["attach"] = "derived_from_body"
    q = sum(1 for p in me.polygons if len(p.vertices) == 4)
    print("  %-15s verts=%-5d quads=%3.0f%%  raycast_hits=%4d/%-5d median_off=%.3f"
          % (name, len(me.vertices), 100.0*q/max(1,len(me.polygons)), hits, len(me.vertices), med))
    return o

print("STAGE5b derive + measured conform")
made = [build(*s) for s in SPEC]
for o in sc.objects:
    if o.name.startswith("Part_") or o.name == "source_highpoly":
        o.hide_viewport = True; o.hide_render = True
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage5_garments.blend"))
print("STAGE5b saved |", [o.name for o in made if o])
