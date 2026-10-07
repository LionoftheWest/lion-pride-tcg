"""The title check: a title is ONE merged shape (the rule of lettering round 5).

For each title it tests:
  1. the SVG has exactly one fill, one inner line, one outline and one edge path,
     and one use of the fill gradient (no letter has its own fill or outline);
  2. the set-color outline is ONE polygon, and the dark edge is ONE polygon
     (the letters are merged; no letter has its own outline);
  3. the merged shape is a valid geometry.

Run:
  py -3.14 check.py                       all ten themes, word ORIGINS, sample colors
  py -3.14 check.py --word ORIGINS --color "#ff8d4d" [--render <dir>]
  py -3.14 check.py <title.svg> ...       only test 1 on SVG files
Exit code 1 if a test fails.
"""
import argparse
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lettering import polys  # noqa: E402


def check_svg(path):
    s = open(path, encoding="utf-8").read()
    n = {k: s.count(f'id="{k}"') for k in ("fill", "line", "outline", "edge")}
    ok = all(v == 1 for v in n.values()) and s.count("url(#fillg)") == 1
    if not ok:
        raise AssertionError(f"{path}: expected one fill/line/outline/edge path, got {n}")
    return "1 fill, 1 line, 1 outline, 1 edge"


def check_shape(word, counters):
    from themes import layers
    dark, outl, _ = layers(word, counters)
    no, nd = len(polys(outl)), len(polys(dark))
    if not word.is_valid or no != 1 or nd != 1:
        raise AssertionError(f"not one merged shape: outline pieces={no}, edge pieces={nd}, valid={word.is_valid}")
    return f"outline 1 piece, edge 1 piece, fill pieces {len(polys(word))}, counters {len(polys(counters))}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("svgs", nargs="*")
    ap.add_argument("--word", default="ORIGINS")
    ap.add_argument("--color", help="one color for every theme (default: each theme's sample color)")
    ap.add_argument("--render", help="also render the PNGs into this folder (theme-NN-<slug>/)")
    a = ap.parse_args()
    bad = 0
    if a.svgs:
        for p in a.svgs:
            try:
                print("ok  ", p, check_svg(p))
            except AssertionError as e:
                bad += 1; print("FAIL", e)
        sys.exit(1 if bad else 0)
    from themes import THEMES, make_title
    root = a.render or tempfile.mkdtemp(prefix="title-check-")
    for t in THEMES:
        color = a.color or t["sample"]
        out = os.path.join(root, f'theme-{t["n"]:02d}-{t["slug"]}')
        try:
            sp, _, word, counters = make_title(t["slug"], a.word.upper(), color, out, png=bool(a.render))
            print(f'ok   {t["n"]:2d} {t["slug"]:12s} {color}  {check_svg(sp)} | {check_shape(word, counters)}')
        except AssertionError as e:
            bad += 1; print(f'FAIL {t["n"]:2d} {t["slug"]:12s} {e}')
    print(f"{len(THEMES) - bad}/{len(THEMES)} themes pass" + (f" (files in {root})" if a.render else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
