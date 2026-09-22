"""Corrected character pipeline (research-backed). Stages:
 1 BODY BASE   - a clean QUAD body + skeleton. The Mixamo body is already professionally
                 retopologized (quads, edge loops at joints), which is the stage we skipped.
 2 DERIVE      - each garment is DUPLICATED FROM THE BODY SURFACE by bone region, so it
                 shares the body's topology AND its weights. This is the documented modular
                 -character requirement: "unless you use the same topology as the base body
                 you get skin poking through the shirt". Fit + rigging come free.
 3 OFFSET      - push the shell out along its normals + solidify so it sits ON the skin.
 4 (later) loose cloth via simulation, and animation.
Run: blender -b -P build_character.py -- <ninja_dir>
"""
import bpy, bmesh, sys, os, re, json
from mathutils import Vector
ND = sys.argv[sys.argv.index("--") + 1]
MX = os.path.join(ND, "mixamo")

bpy.ops.wm.read_homefile(use_empty=True)
sc = bpy.context.scene
vl = bpy.context.view_layer

def mat(name, rgba, rough=0.7):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = rgba
    if "Roughness" in b.inputs: b.inputs["Roughness"].default_value = rough
    return m

# ---------- Stage 1: clean quad body base + skeleton ----------
bpy.ops.import_scene.fbx(filepath=os.path.join(MX, "xbot_base_tpose.fbx"))
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
body = max(meshes, key=lambda o: len(o.data.vertices))
body.name = "Body"
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for m in meshes:
    if m is not body: bpy.data.objects.remove(m, do_unlink=True)
vl.update()
# ground
mn = min((body.matrix_world @ Vector(c)).z for c in body.bound_box)
for o in bpy.data.objects: o.location.z -= mn
vl.update()
SKIN = mat("Skin", (0.78, 0.60, 0.50, 1))
body.data.materials.clear(); body.data.materials.append(SKIN)
quads = sum(1 for p in body.data.polygons if len(p.vertices) == 4)
print("STAGE1 body verts", len(body.data.vertices), "faces", len(body.data.polygons), "quads", quads)

# ---------- Stage 2+3: derive garments FROM the body by bone region ----------
def derive(name, bone_re, offset, material, thickness=0.006):
    """Duplicate the body faces whose verts are dominantly weighted to the matching bones.
    The copy keeps the body's topology, vertex groups, armature modifier and parent, so the
    garment is already fitted and already skinned to the rig."""
    o = body.copy(); o.data = body.data.copy(); o.name = name
    sc.collection.objects.link(o)
    gi = {g.index for g in o.vertex_groups if re.search(bone_re, g.name, re.I)}
    if not gi:
        bpy.data.objects.remove(o, do_unlink=True); print("  no groups for", name); return None
    me = o.data
    keep = set()
    for v in me.vertices:
        w = sum(g.weight for g in v.groups if g.group in gi)
        if w > 0.5: keep.add(v.index)
    if len(keep) < 12:
        bpy.data.objects.remove(o, do_unlink=True); print("  too few verts for", name); return None
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    dead = [v for v in bm.verts if v.index not in keep]
    if dead: bmesh.ops.delete(bm, geom=dead, context='VERTS')
    bm.to_mesh(me); bm.free()
    # push out along vertex normals so the garment sits ON the skin (no z-fighting/poke-through)
    nrm = [v.normal.copy() for v in me.vertices]
    for v, n in zip(me.vertices, nrm): v.co += n * offset
    sol = o.modifiers.new("Thick", "SOLIDIFY"); sol.thickness = thickness; sol.offset = 1
    # keep the armature modifier last so it deforms after thickening
    am = next((m for m in o.modifiers if m.type == 'ARMATURE'), None)
    if am: o.modifiers.move(o.modifiers.find(am.name), len(o.modifiers) - 1)
    for p in me.polygons: p.use_smooth = True
    o.data.materials.clear(); o.data.materials.append(material)
    o["part_type"] = "garment"; o["derived_from"] = "body"
    print("  derived", name, "verts", len(me.vertices), "faces", len(me.polygons))
    return o

DARK  = mat("Pants",  (0.045, 0.045, 0.055, 1))
WRAP  = mat("Wrap",   (0.13, 0.20, 0.15, 1))
GREEN = mat("Cloth",  (0.09, 0.28, 0.16, 1))

derive("Garment_pants", r"(UpLeg|Leg)$",  0.010, DARK,  0.008)
derive("Garment_wrapL", r"LeftForeArm$",  0.008, WRAP,  0.006)
derive("Garment_wrapR", r"RightForeArm$", 0.008, WRAP,  0.006)
derive("Garment_hood",  r"Head$",         0.014, GREEN, 0.008)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage3.blend"))
print("SAVED character_stage3.blend | objects", [o.name for o in sc.objects if o.type == 'MESH'])
