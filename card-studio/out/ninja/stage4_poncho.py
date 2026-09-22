"""Stage 4 - the LOOSE garment, built from the correct real-world pattern.
The reference shows a SQUARE poncho worn as a diamond: a sharp point at front centre, the
side edges angling up. A circular pattern has far too much material and balloons into a
cone, so we cut a square panel with a neck hole, rotate it 45 degrees, pin the neck, and
let cloth simulation find the drape over the body. Then we transfer the body's weights so
it rides the rig (simulate the resting shape -> then skin it).
Run: blender -b -P stage4_poncho.py -- <ninja_dir>
"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
ND = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=os.path.join(ND, "character_stage3.blend"))
sc = bpy.context.scene; vl = bpy.context.view_layer
body = bpy.data.objects["Body"]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
def bh(n):
    pb = arm.pose.bones.get("mixamorig:" + n); return (arm.matrix_world @ pb.head).copy()
shL = bh("LeftArm"); shR = bh("RightArm"); sh_z = (shL.z + shR.z) / 2

# hem height from the concept art
info = json.load(open(os.path.join(ND, "parts_info.json")))
pon = next((p for p in info["visible_parts"] if p["name"] == "poncho"), None)
cy0, cy1 = info["char_bbox"][1], info["char_bbox"][3]; chH = cy1 - cy0
body_h = max((body.matrix_world @ Vector(c)).z for c in body.bound_box)
hem_z = body_h * (1.0 - ((pon["bbox"][3] - cy0) / chH)) if pon else 0.70

neck_r = 0.090
start_z = sh_z + 0.11
corner = (start_z - hem_z) + neck_r          # the FRONT POINT drapes this far
S = corner / math.sqrt(0.5)                  # square side; corner dist = S*sqrt(0.5)
half = S / 2.0
N = 34

bm = bmesh.new(); V = {}
rot = Matrix.Rotation(math.radians(45), 4, 'Z')   # corner -> front centre
for i in range(N + 1):
    for j in range(N + 1):
        x = -half + S * i / N; y = -half + S * j / N
        co = rot @ Vector((x, y, 0.0)); co.z = start_z
        V[(i, j)] = bm.verts.new(co)
for i in range(N):
    for j in range(N):
        cx = -half + S * (i + 0.5) / N; cy = -half + S * (j + 0.5) / N
        if math.hypot(cx, cy) < neck_r: continue          # neck hole
        bm.faces.new((V[(i, j)], V[(i+1, j)], V[(i+1, j+1)], V[(i, j+1)]))
me = bpy.data.meshes.new("Garment_poncho"); bm.to_mesh(me); bm.free()
pon_o = bpy.data.objects.new("Garment_poncho", me); sc.collection.objects.link(pon_o)
for p in me.polygons: p.use_smooth = True
me.materials.append(bpy.data.materials.get("Cloth"))

vg = pon_o.vertex_groups.new(name="pin")
vg.add([v.index for v in me.vertices if Vector(v.co).xy.length <= neck_r * 1.45], 1.0, 'REPLACE')
body.modifiers.get("Collision") or body.modifiers.new("Collision", "COLLISION")
body.collision.thickness_outer = 0.012; body.collision.thickness_inner = 0.02
cl = pon_o.modifiers.new("Cloth", "CLOTH")
cl.settings.vertex_group_mass = "pin"
cl.settings.quality = 8
cl.settings.mass = 0.20
cl.settings.tension_stiffness = 40          # resist stretch
cl.settings.compression_stiffness = 40
cl.settings.shear_stiffness = 40
cl.settings.bending_stiffness = 0.08        # soft -> folds instead of coning
cl.collision_settings.distance_min = 0.008
cl.collision_settings.use_self_collision = True
cl.collision_settings.self_distance_min = 0.006
def aim(bone, wdir):
    pb = arm.pose.bones.get(bone)
    if not pb: return
    vl.update()
    hw = arm.matrix_world @ pb.head; tw = arm.matrix_world @ pb.tail
    cur = (tw - hw).normalized(); q = cur.rotation_difference(wdir.normalized())
    T = Matrix.Translation(hw)
    pb.matrix = arm.matrix_world.inverted() @ (T @ q.to_matrix().to_4x4() @ T.inverted() @ (arm.matrix_world @ pb.matrix))
    vl.update()
# arms DOWN (A-pose) so the cloth hangs naturally instead of tenting over T-posed arms
aim("mixamorig:LeftArm",  Vector(( 0.30, 0, -1)));  aim("mixamorig:LeftForeArm",  Vector(( 0.16, 0, -1)))
aim("mixamorig:RightArm", Vector((-0.30, 0, -1)));  aim("mixamorig:RightForeArm", Vector((-0.16, 0, -1)))
sc.frame_start = 1; sc.frame_end = 80
for f in range(1, 81): sc.frame_set(f)

dg = bpy.context.evaluated_depsgraph_get()
baked = bpy.data.meshes.new_from_object(pon_o.evaluated_get(dg))
for m in list(pon_o.modifiers): pon_o.modifiers.remove(m)
old = pon_o.data; pon_o.data = baked; bpy.data.meshes.remove(old)
for p in pon_o.data.polygons: p.use_smooth = True
pon_o.data.materials.clear(); pon_o.data.materials.append(bpy.data.materials.get("Cloth"))
sc.frame_set(1)
for pb in arm.pose.bones: pb.matrix_basis.identity()
vl.update()

bpy.ops.object.select_all(action='DESELECT')
pon_o.select_set(True); body.select_set(True); vl.objects.active = body
bpy.ops.object.data_transfer(data_type='VGROUP_WEIGHTS', vert_mapping='POLYINTERP_NEAREST',
                             layers_select_src='ALL', layers_select_dst='NAME')
import re as _re
for g in list(pon_o.vertex_groups):
    if _re.search(r'(Arm|ForeArm|Hand|Shoulder|Leg|Foot|Toe)', g.name, _re.I):
        pon_o.vertex_groups.remove(g)      # torso-only: the poncho must not follow the arms
am = pon_o.modifiers.new("Armature", "ARMATURE"); am.object = arm
pon_o.parent = arm
pon_o.matrix_parent_inverse = arm.matrix_world.inverted()
pon_o["part_type"] = "garment"; pon_o["sim"] = "cloth"
mn = min((pon_o.matrix_world @ v.co).z for v in pon_o.data.vertices)
wx = [ (pon_o.matrix_world @ v.co).x for v in pon_o.data.vertices ]
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ND, "character_stage4.blend"))
print("STAGE4 square poncho | side %.2f corner %.2f | hem_z %.2f actual_z %.2f width %.2f verts %d"
      % (S, corner, hem_z, mn, max(wx)-min(wx), len(pon_o.data.vertices)))
