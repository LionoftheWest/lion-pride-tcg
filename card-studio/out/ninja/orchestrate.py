"""ONE-COMMAND first-step pipeline: single image -> foundational multi-part model.
  python orchestrate.py [path-to-image] [body_plan]
body_plan (optional): biped | quadruped | bird | serpent — a HINT you give on submit
that overrides silhouette auto-detection (removes the least-reliable step). Omit to
auto-detect. Emits a dynamic part list, generates each visible part (local Hunyuan),
fits the plan's skeleton (Mixamo biped / Rigify metarig non-biped), anatomy-fills the
base body as named parts, tags every part, saves the foundation .blend."""
import subprocess, sys, os, shutil, json

ND = r"C:\Users\vaugh\discord\card-studio\out\ninja"
VENV = r"C:\Users\vaugh\discord\card-studio\ml\venv\Scripts\python.exe"
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"

env = os.environ.copy()
plan_hint = sys.argv[2].strip().lower() if len(sys.argv) > 2 else ""
if plan_hint:
    env["NINJA_PLAN"] = plan_hint; print("plan hint (user-provided):", plan_hint)

def step(title, cmd):
    print("\n=== %s ===" % title); r = subprocess.run(cmd, env=env)
    if r.returncode != 0:
        print("FAILED:", title, "rc", r.returncode); sys.exit(r.returncode)

img = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ND, "source.png")
if os.path.abspath(img) != os.path.join(ND, "source.png"):
    shutil.copy(img, os.path.join(ND, "source.png")); print("input ->", os.path.join(ND, "source.png"))

# SAM is the segmenter (full layering). Set env SEGMENTER=heuristic to use parts_seg.py instead.
SEGMENTER = "sam_parts.py" if os.environ.get("SEGMENTER", "sam") != "heuristic" else "parts_seg.py"
step("1/3 detect plan + SAM segment", [VENV, os.path.join(ND, SEGMENTER)])
info = json.load(open(os.path.join(ND, "parts_info.json")))
print("body_plan:", info["body_plan"], "| parts:", [p["name"] for p in info["visible_parts"]])
generated, skipped = [], []
for p in info["visible_parts"]:                       # DYNAMIC — whatever the segmenter emitted
    if not p.get("bbox") or p.get("method") == "extrude":   # extrude parts are meshed in Blender, not generated
        skipped.append(p["name"]); continue
    print("\n=== 2/3 generate %s (area %d) ===" % (p["name"], p.get("area", 0)))
    r = subprocess.run([VENV, os.path.join(ND, "gen_part.py"),
                        os.path.join(ND, p["cutout"]), os.path.join(ND, p["name"] + ".glb")], env=env)
    if r.returncode != 0:                             # a bad part must NOT kill the whole build
        print("  gen failed, skipping", p["name"]); skipped.append(p["name"])
    else:
        generated.append(p["name"])
print("generated:", generated, "| skipped:", skipped)
step("3/3 assemble + anatomy-fill + tag (Blender)", [BLENDER, "-b", "-P", os.path.join(ND, "assemble.py"), "--", ND])
print("\nDONE -> %s\\ninja_foundation.blend  (+ foundation_manifest.json)" % ND)
