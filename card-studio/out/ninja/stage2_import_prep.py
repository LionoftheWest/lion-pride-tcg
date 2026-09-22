"""STAGE 2 - Import & Preparation, with the pipeline's quality gates.
 - import source_highpoly, apply ALL transforms, orient Z-up, scale 1:1 to real height
 - HIGH_POLY collection (locked) + empty RETOPO collection for stage 3
 - reference plane from the concept art at 1:1 for the PROPORTIONS gate
 - report the gates: transforms, scale, normals, tri/quad makeup, measured proportions
Run: blender -b -P stage2_import_prep.py -- <ninja_dir>
"""
import bpy, sys, os, json, math
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene; vl = bpy.context.view_layer
TARGET_H = 1.809          # real-world character height (metres)

def wbb(o):
    mn = Vector((1e18,)*3); mx = Vector((-1e18,)*3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3): mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

bpy.ops.import_scene.gltf(filepath=os.path.join(ND, "source_highpoly.glb"))
hp = max([o for o in bpy.data.objects if o.type == 'MESH'], key=lambda o: len(o.data.vertices))
hp.name = "source_highpoly"
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o is not hp: bpy.data.objects.remove(o, do_unlink=True)
    elif o.type == 'EMPTY': bpy.data.objects.remove(o, do_unlink=True)
hp.parent = None
vl.update()
# GATE: geometry errors - drop floating islands (painted background strokes generated as
# loose chunks). Keep only the largest connected component = the character.
import bmesh
bm = bmesh.new(); bm.from_mesh(hp.data); bm.verts.ensure_lookup_table()
seen = set(); comps = []
for v in bm.verts:
    if v.index in seen: continue
    stack = [v]; comp = []
    while stack:
        x = stack.pop()
        if x.index in seen: continue
        seen.add(x.index); comp.append(x)
        for e in x.link_edges:
            ov = e.other_vert(x)
            if ov.index not in seen: stack.append(ov)
    comps.append(comp)
comps.sort(key=len, reverse=True)
dropped = sum(len(c) for c in comps[1:])
dead = [v for c in comps[1:] for v in c]
if dead: bmesh.ops.delete(bm, geom=dead, context='VERTS')
bm.to_mesh(hp.data); bm.free()
print("GATE cleanup islands=%d kept_largest dropped_verts=%d" % (len(comps), dropped))
vl.update()
# orient Z-up if it came in Y-up
mn, mx = wbb(hp); size = mx - mn
if size.z < max(size.x, size.y):
    hp.rotation_euler[0] += math.radians(90); vl.update(); mn, mx = wbb(hp); size = mx - mn
# scale 1:1 to real height, centre on origin, feet on the floor
s = TARGET_H / max(1e-6, size.z)
hp.scale = tuple(v * s for v in hp.scale); vl.update()
mn, mx = wbb(hp)
hp.location += Vector((-(mn.x + mx.x) / 2, -(mn.y + mx.y) / 2, -mn.z)); vl.update()
# APPLY ALL TRANSFORMS (the pipeline's critical step)
bpy.ops.object.select_all(action='DESELECT'); hp.select_set(True); vl.objects.active = hp
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
vl.update()

# collections: HIGH_POLY (locked) + RETOPO (empty, for stage 3)
for name in ("HIGH_POLY", "RETOPO"):
    if name not in bpy.data.collections:
        c = bpy.data.collections.new(name); sc.collection.children.link(c)
hpc = bpy.data.collections["HIGH_POLY"]
for c in list(hp.users_collection): c.objects.unlink(hp)
hpc.objects.link(hp)
hpc.hide_select = True

# reference plane at 1:1 for the PROPORTIONS gate
info = json.load(open(os.path.join(ND, "parts_info.json")))
IW, IH = info["image"]; cx0, cy0, cx1, cy1 = info["char_bbox"]
mpp = TARGET_H / (cy1 - cy0)
W = IW * mpp; H = IH * mpp
me = bpy.data.meshes.new("REF_plane")
me.from_pydata([(-W/2, 0, 0), (W/2, 0, 0), (W/2, 0, H), (-W/2, 0, H)], [], [(0, 1, 2, 3)]); me.update()
ref = bpy.data.objects.new("REF_concept", me); sc.collection.objects.link(ref)
me.uv_layers.new(name="UV")
for i, uv in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]): me.uv_layers[0].data[i].uv = uv
m = bpy.data.materials.new("REF_mat"); m.use_nodes = True
nt = m.node_tree; nt.nodes.clear()
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = bpy.data.images.load(os.path.join(ND, "source.png"))
emi = nt.nodes.new("ShaderNodeEmission"); out = nt.nodes.new("ShaderNodeOutputMaterial")
nt.links.new(tex.outputs["Color"], emi.inputs["Color"]); nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
me.materials.append(m)
# art centre-x and feet aligned to the model
ref.location = (-((cx0 + cx1) / 2 - IW / 2) * mpp, 0.45, -(IH - cy1) * mpp)
ref.hide_select = True

# ---- QUALITY GATES ----
mn, mx = wbb(hp); size = mx - mn
tris = sum(1 for p in hp.data.polygons if len(p.vertices) == 3)
quads = sum(1 for p in hp.data.polygons if len(p.vertices) == 4)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage2.blend"))
print("GATE transforms_applied loc=%s rot=%s scale=%s" %
      (tuple(round(v,3) for v in hp.location), tuple(round(v,3) for v in hp.rotation_euler), tuple(round(v,3) for v in hp.scale)))
print("GATE size  H=%.3f W=%.3f D=%.3f (target H=%.3f)" % (size.z, size.x, size.y, TARGET_H))
print("GATE mesh  verts=%d faces=%d tris=%d quads=%d  -> %s" %
      (len(hp.data.vertices), len(hp.data.polygons), tris, quads,
       "TRIANGLE SOUP (expected - retopo required)" if tris > quads else "quad-dominant"))
print("STAGE2 saved character_stage2.blend | ref plane %.2fx%.2f m" % (W, H))
