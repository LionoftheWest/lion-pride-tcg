"""Open in the Blender GUI and watch card_scene.py — rebuild live when it changes.

Run (with a window):
  blender --python live_preview.py -- <facePng> <rarity>

All building happens inside a timer, so the context is ready. build() uses the
data API only (no operators), so it is context-safe.
"""
import bpy
import os
import sys
import importlib
import traceback

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import card_scene  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
FACE = argv[0]
RARITY = argv[1] if len(argv) > 1 else "full_art"
MASK = argv[2] if len(argv) > 2 else None
SCENE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "card_scene.py")
STATUS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "out", "live_status.txt")

_state = {"built": False, "mtime": 0.0, "n": 0}


def _status(msg):
    try:
        with open(STATUS, "w", encoding="utf-8") as f:
            f.write(msg)
    except Exception:
        pass


def _set_viewport():
    screen = getattr(bpy.context, "screen", None)
    if not screen:
        return
    for area in screen.areas:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "RENDERED"
                    space.region_3d.view_perspective = "CAMERA"


def rebuild():
    importlib.reload(card_scene)
    card_scene.build(FACE, RARITY, engine="BLENDER_EEVEE_NEXT", mask_path=MASK)
    bpy.context.scene.frame_set(12)
    _set_viewport()


def watch():
    try:
        if not _state["built"]:
            rebuild()
            _state["built"] = True
            _state["mtime"] = os.path.getmtime(SCENE_FILE)
            _status("built OK")
        else:
            mtime = os.path.getmtime(SCENE_FILE)
            if mtime != _state["mtime"]:
                _state["mtime"] = mtime
                _state["n"] += 1
                rebuild()
                _status(f"rebuilt {_state['n']}")
    except Exception:
        _status("ERROR:\n" + traceback.format_exc())
    return 0.8


bpy.app.timers.register(watch, first_interval=1.0, persistent=True)
print("LIVE PREVIEW: registered watcher")
