"""rigcheck — verify EVERY part is rigged correctly and will react to the rig.
Each lesson we hit becomes a fail-closed check. Run after a build.

    exec(open(r"C:\\Users\\vaugh\\discord\\card-studio\\blender\\rigcheck.py").read())
"""
import bpy
from collections import Counter

rig = bpy.data.objects.get("RIG-meta_boss")
defbones = set(b.name for b in rig.pose.bones if b.name.startswith("DEF-"))
plates = [o for o in bpy.data.objects if o.name.startswith("Plate_")]
base = bpy.data.objects.get("Base")

problems = []; tiny = []; boneuse = Counter()
TINY = 70
for p in plates:
    amods = [m for m in p.modifiers if m.type == "ARMATURE" and m.object == rig]
    vgs = [vg.name for vg in p.vertex_groups]
    if not amods:
        problems.append((p.name, "NO armature modifier -> will NOT react"))
    if len(vgs) == 0:
        problems.append((p.name, "NO vertex group -> unbound"))
    elif len(vgs) > 1:
        problems.append((p.name, "multiple vgroups %s (not rigid)" % vgs))
    elif vgs[0] not in defbones:
        problems.append((p.name, "bound to '%s' which is NOT a deform bone" % vgs[0]))
    else:
        boneuse[vgs[0]] += 1
    if len(p.data.vertices) < TINY:
        tiny.append(p.name)

# base (inner shell) must be bound too
base_ok = base is not None and any(m.type == "ARMATURE" and m.object == rig for m in base.modifiers)

print("=== RIGCHECK ===")
print("plates:", len(plates), "| bound-correctly:", sum(boneuse.values()), "| problems:", len(problems), "| tiny/stray:", len(tiny))
print("inner shell bound:", base_ok)
print("DEF bones driven:", len(boneuse), "of", len(defbones))
unused = sorted(defbones - set(boneuse))
print("DEF bones with NO plate (uncovered):", unused)
for n, why in problems[:40]:
    print("  PROBLEM", n, "->", why)
print("PASS" if (not problems and base_ok) else "FAIL — fix the problems above")
