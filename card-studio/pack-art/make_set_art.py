"""Make the pack art of one card set with one command (D-111).

  title -> front -> texture -> Blender (normal + rare; the idle loop comes with normal) -> encode

Run from anywhere (py -3.14 with Pillow, numpy, fontTools, shapely, playwright; Blender 5.2):
  py -3.14 card-studio/pack-art/make_set_art.py --set ORI --name ORIGINS --theme electricity \\
      --color "#ff8d4d" --cover card-studio/art/lionofthewest-s-pikachu-full_art.jpg

Output (default card-studio/out/sets/<code>/, never committed):
  title/title.svg, title.png, title-160.png    the set title (check: one merged shape)
  front/flat-front.png, pack_DIFFUSE.png        the pack front and our model texture
  frames/, frames_rare/                         the Blender frames
  idle_loop.webp, open.webp, open_rare.webp     the three game clips (D-93, D-96)
  set.json                                      the values for the card_sets row

--review stops after the front (title + front only, seconds), for the review loop with
Nathan. The full run renders 25 + 39 + 39 frames in Blender (minutes).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
CARD_STUDIO = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "title"))
sys.path.insert(0, os.path.join(HERE, "front"))
sys.path.insert(0, os.path.join(HERE, "encode"))
MODEL_DIR = os.path.join(HERE, "model")
MODEL_FILES = ("cardpack2.fbx", "optional_NORMAL.png")
BLENDER_DEFAULT = r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"


def stop(msg):
    sys.stderr.write(f"\nSTOP: {msg}\n\n")
    sys.exit(2)


def step(name):
    print(f"\n== {name} ({time.strftime('%H:%M:%S')})", flush=True)


def is_subsequence(code, name):
    it = iter(name)
    return all(ch in it for ch in code)


def blender(exe, out_dir, diffuse, *mode):
    cmd = [exe, "--factory-startup", "-b", "--python-exit-code", "1", "--python",
           os.path.join(HERE, "blender", "pack_open.py"), "--", out_dir, f"diffuse={diffuse}", "game", *mode]
    print(" ".join(f'"{c}"' if " " in c else c for c in cmd), flush=True)
    log = os.path.join(os.path.dirname(out_dir), f"blender-{'rare' if mode else 'normal'}.txt")
    with open(log, "w", encoding="utf-8") as f:
        r = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        stop(f"Blender failed (exit {r.returncode}); see {log}")
    print("log:", log)


def count(d):
    return len([f for f in os.listdir(d) if f.startswith("f_") and f.endswith(".png")]) if os.path.isdir(d) else 0


def main():
    ap = argparse.ArgumentParser(description="Make the pack art of one card set.")
    ap.add_argument("--set", required=True, help="the set code, letters from the name (D-103), for example ORI")
    ap.add_argument("--name", required=True, help="the set name on the pack, for example ORIGINS")
    ap.add_argument("--theme", required=True, help="a title theme (title/themes.py --list), for example electricity")
    ap.add_argument("--color", required=True, help="the set color = card_sets.pack_color (D-105), for example #ff8d4d")
    ap.add_argument("--cover", required=True, help="the cover card art: a popular card of the set (D-86)")
    ap.add_argument("--cover-x", type=float, default=0.5, help="the horizontal center of the cover crop, 0..1")
    ap.add_argument("--season", type=int, help="the season number, written to set.json")
    ap.add_argument("--out", help="the output folder (default card-studio/out/sets/<code>/)")
    ap.add_argument("--blender", default=os.environ.get("BLENDER", BLENDER_DEFAULT), help="blender.exe (or env BLENDER)")
    ap.add_argument("--review", action="store_true", help="stop after the title and the front")
    a = ap.parse_args()

    code, name, color = a.set.upper(), a.name.upper(), a.color.lower()
    if not re.fullmatch(r"[A-Z0-9]{1,8}", code):
        stop(f"--set must be 1-8 letters or digits (card_sets.code), got {a.set!r}")
    if not is_subsequence(code, name.replace(" ", "")):
        print(f"WARNING: the set code {code} is not letters from the name {name} (D-103)")
    if not re.fullmatch(r"#[0-9a-f]{6}", color):
        stop(f"--color must be #rrggbb (card_sets.pack_color), got {a.color!r}")
    if not os.path.isfile(a.cover):
        stop(f"the cover art is not found: {a.cover}")
    out = os.path.abspath(a.out or os.path.join(CARD_STUDIO, "out", "sets", code))
    if not a.review:
        missing = [f for f in MODEL_FILES if not os.path.isfile(os.path.join(MODEL_DIR, f))]
        if missing:
            stop(f"the pack model is missing in {MODEL_DIR}: {', '.join(missing)}\n"
                 "It is not in git (its license is not recorded yet). Copy it there; see pack-art/README.md, section 6.")
        if not os.path.isfile(a.blender):
            stop(f"Blender is not found: {a.blender} (use --blender or the env BLENDER)")
    os.makedirs(out, exist_ok=True)
    t0 = time.time()

    step("1. title")
    from check import check_shape, check_svg
    from themes import make_title, theme
    th = theme(a.theme)
    sp, title_png, word, counters = make_title(a.theme, name, color, os.path.join(out, "title"))
    try:
        print(f"{th['name']} in {color}: {check_svg(sp)} | {check_shape(word, counters)}")
    except AssertionError as e:
        stop(f"the title check failed: {e}")

    step("2. front + 3. texture")
    from make_front import make_front
    diffuse = make_front(a.cover, title_png, os.path.join(out, "front"), a.cover_x)
    print(diffuse)
    if a.review:
        print(f"\nreview files: {os.path.join(out, 'title', 'title.png')}, title-160.png, "
              f"{os.path.join(out, 'front', 'flat-front.png')}")
        return

    step("4. Blender: normal (idle loop + open)")
    for d in ("frames", "frames_rare"):
        shutil.rmtree(os.path.join(out, d), ignore_errors=True)
    blender(a.blender, os.path.join(out, "frames"), diffuse)
    step("4. Blender: rare open")
    blender(a.blender, os.path.join(out, "frames_rare"), diffuse, "rare")
    n = (count(os.path.join(out, "frames", "idle")), count(os.path.join(out, "frames", "open")),
         count(os.path.join(out, "frames_rare", "open")))
    print("frames: idle %d, open %d, rare open %d" % n)
    if n != (25, 39, 39):
        stop(f"expected 25 / 39 / 39 frames, got {n}")

    step("5. encode")
    from encode_game import encode
    seam = encode({"normal": os.path.join(out, "frames"), "rare": os.path.join(out, "frames_rare")}, out)
    if seam > 1.0:   # the approved Origins loop measures 0.571; one idle step is 2-7
        print(f"WARNING: the idle loop is not seamless (next-after-loop vs first = {seam})")

    info = {"code": code, "name": name.title(), "pack_color": color, "season": a.season, "theme": th["slug"],
            "cover": os.path.abspath(a.cover), "clips": ["idle_loop.webp", "open.webp", "open_rare.webp"],
            "place_clips_in": "tcg-activity/public/packs/<card_sets.id>/ (D-101, PR #237)"}
    json.dump(info, open(os.path.join(out, "set.json"), "w"), indent=2)
    print(f"\ndone in {round(time.time() - t0)} s -> {out}")


if __name__ == "__main__":
    main()
