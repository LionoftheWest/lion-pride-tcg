"""Live-drive Blender session for interactive boss modeling.

Loads a boss build script (default boss_behemoth.py) WITHOUT auto-rendering, then
loops forever: it watches <outDir>/cmd/*.py, executes each snippet against the live
scene (so edits accumulate), and re-renders <outDir>/view.png after any change.

The driver (me) edits the model by dropping numbered .py files into cmd/, then reads
view.png. Errors go to <outDir>/error.txt. A snapshot on demand: drop a file that
calls snap() or snap(angle_degrees).

Run:  blender --background --python live_boss.py -- <outDir> [buildScript]
"""
import bpy, os, sys, time, glob, math, traceback

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = os.path.abspath(argv[0]) if argv else os.path.join(os.path.dirname(__file__), "..", "out", "behemoth")
BUILD = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(__file__), "boss_behemoth.py")

# Build the scene by running the boss script in "live" mode (builds, no render).
sys.argv = ["blender", "--", OUT_DIR, "live"]
with open(BUILD, "r", encoding="utf-8") as fh:
    exec(compile(fh.read(), BUILD, "exec"), globals())

CMD = os.path.join(OUT_DIR, "cmd"); os.makedirs(CMD, exist_ok=True)
VIEW = os.path.join(OUT_DIR, "view.png")
ERR = os.path.join(OUT_DIR, "error.txt")

_base_cam = tuple(cam.location)

def snap(angle=None, name="view.png", radius=11.5, height=3.1):
    """Render the current scene to OUT_DIR/name. angle in degrees orbits around Z."""
    if angle is not None:
        rad = math.radians(angle)
        cam.location = (radius * math.sin(rad), -radius * math.cos(rad), height)
    scene.render.filepath = os.path.join(OUT_DIR, name)
    bpy.ops.render.render(write_still=True)
    if angle is not None:
        cam.location = _base_cam

snap()  # initial frame
print("LIVE READY ->", OUT_DIR)

_seen = 0
while True:
    files = sorted(glob.glob(os.path.join(CMD, "*.py")))
    changed = False
    for f in files:
        try:
            with open(f, "r", encoding="utf-8") as fh:
                exec(compile(fh.read(), f, "exec"), globals())
            if os.path.exists(ERR):
                os.remove(ERR)
        except Exception:
            with open(ERR, "w", encoding="utf-8") as eh:
                eh.write(traceback.format_exc())
        os.remove(f)
        changed = True
    if changed:
        snap()
    time.sleep(0.6)
