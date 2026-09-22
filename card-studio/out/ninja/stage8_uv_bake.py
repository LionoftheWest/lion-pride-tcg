"""STAGE 8 - UV UNWRAP + BAKE (the steps I skipped).
therookies: "After retopology, I unwrapped the model... split the model into two UV sets:
one for the body, and another for the armour... baked the maps... normal, AO and curvature,
which were KEY TO CAPTURING THE SCULPTED DETAIL ON THE LOW-RES MESH."

ORDER MATTERS: baking needs the low-poly and high-poly ALIGNED, so this must run on the
A-POSE retopo (which still matches the high-poly) and BEFORE rigging/T-posing.
They used Substance 3D Painter (paid); we bake in Blender Cycles for free, per the GitHub
pipeline: Cycles, Selected-to-Active, extrusion 0.02-0.05, order Normal -> AO.
Run: blender -b -P stage8_uv_bake.py -- <ninja_dir> [res]
"""
import bpy, sys, os
ND = sys.argv[sys.argv.index("--") + 1]
i = sys.argv.index("--")
RES = int(sys.argv[i + 2]) if len(sys.argv) > i + 2 else 2048
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage5_quad.blend"))
sc = bpy.context.scene
vl = bpy.context.view_layer
bpy.data.collections["HIGH_POLY"].hide_select = False
low = bpy.data.objects["Char_retopo"]
high = bpy.data.objects["source_highpoly"]
for o in (low, high):
    o.hide_viewport = False
    o.hide_render = False
    o.hide_set(False)
ref = bpy.data.objects.get("REF_concept")
if ref:
    bpy.data.objects.remove(ref, do_unlink=True)
for o in list(sc.objects):
    if o.name.startswith("Part_") or o.name.startswith("P_"):
        bpy.data.objects.remove(o, do_unlink=True)

# ---------- UV UNWRAP the low-poly ----------
bpy.ops.object.select_all(action='DESELECT')
low.select_set(True)
vl.objects.active = low
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004, scale_to_bounds=False)
# "ensuring good distribution for baking and texturing" - equalise texel density then pack
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
uvl = low.data.uv_layers.active
print("GATE uv layers=%d loops=%d" % (len(low.data.uv_layers), len(uvl.data)))

# UV area coverage (rough stretch/utilisation check)
import statistics
areas = []
for p in low.data.polygons:
    pts = [uvl.data[li].uv for li in p.loop_indices]
    a = 0.0
    for k in range(len(pts)):
        x1, y1 = pts[k]
        x2, y2 = pts[(k + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    areas.append(abs(a) * 0.5)
print("GATE uv_coverage total=%.3f of 1.0 (islands packed)" % sum(areas))

# ---------- material + bake targets ----------
mat = bpy.data.materials.new("NinjaBaked")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
low.data.materials.clear()
low.data.materials.append(mat)

def make_img(name, is_data):
    img = bpy.data.images.new(name, RES, RES, alpha=False, float_buffer=False, is_data=is_data)
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.select = False
    return img, node

nrm_img, nrm_node = make_img("ninja_normal", True)
ao_img, ao_node = make_img("ninja_ao", True)

sc.render.engine = 'CYCLES'
try:
    sc.cycles.device = 'GPU'
except Exception:
    pass
sc.cycles.samples = 32
sc.render.bake.use_selected_to_active = True
sc.render.bake.cage_extrusion = 0.03
sc.render.bake.max_ray_distance = 0.06
sc.render.bake.use_clear = True

def bake(bake_type, node, img, tag):
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)      # source (selected)
    low.select_set(True)
    vl.objects.active = low    # target (active)
    kw = {}
    if bake_type == 'NORMAL':
        kw = dict(normal_space='TANGENT')
    bpy.ops.object.bake(type=bake_type, use_selected_to_active=True,
                        cage_extrusion=0.03, max_ray_distance=0.06, **kw)
    path = os.path.join(ND, "bake_%s.png" % tag)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    print("BAKED %-8s -> %s" % (tag, path))

bake('NORMAL', nrm_node, nrm_img, "normal")
bake('AO', ao_node, ao_img, "ao")

# wire the normal map into the shader so the low-poly SHOWS the high-poly detail
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nrm_node.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage8_baked.blend"))
print("STAGE8 saved character_stage8_baked.blend")
