"""The ten set-title themes (round 5, 2026-10-07) as reusable presets.

ONE idea for each title, applied the same way to every letter, nothing extra. The
theme drives the whole title: the base letterform, the layout warp, the one cut or
edge, the fill gradient and the colors. Every title is ONE merged shape with ONE
fill, ONE outline (in the SET color), ONE dark edge (check.py tests this).

The color of each theme below is only a SAMPLE (the round-5 review color). A real
set always passes its own color (card_sets.pack_color, D-105) as --color.

Base outlines (SIL OFL 1.1, modified, used in artwork only): Russo One, Pirata One,
Cinzel (Black instance), Rubik Mono One, Lilita One, Titan One, Bungee,
Passion One, Black Ops One. The fonts and their OFL texts are in ../fonts.

Run:
  py -3.14 themes.py --theme electricity --word ORIGINS --color "#ff8d4d" --out <dir>
  py -3.14 themes.py --list
Writes <dir>/title.svg, title.png (1600 px wide, transparent) and title-160.png.
"""
import argparse
import math
import os
import re
import sys

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lettering import EDGE, d_of, glyph, mix, polys, render, small, warp  # noqa: E402

C = 260                                   # the cap height in shape units
J = dict(join_style=1, quad_segs=12)


def segs(g, top=True, band=0.07):
    x0, y0, x1, y1 = g.bounds
    b = box(x0 - 5, y0 - 1, x1 + 5, y0 + C * band) if top else box(x0 - 5, y1 - C * band, x1 + 5, y1 + 1)
    return [(p.bounds[0], p.bounds[2]) for p in polys(g.intersection(b)) if p.bounds[2] - p.bounds[0] > C * 0.06]


def tri(*p):
    return Polygon(p)


def ring_o(g, stem):
    P = Polygon(max(polys(g), key=lambda p: p.area).exterior)
    return P.difference(P.buffer(-stem, join_style=1))


# ======================================================== theme operations (letter -> letter)
def op_bolt(g):                                   # 1: the Z-shaped bolt break
    x0, _, x1, _ = g.bounds; w = x1 - x0
    B = [(-0.15, 0.66), (0.58, 0.66), (0.38, 0.36), (1.15, 0.36)]
    return g.difference(LineString([(x0 + u * w, -v * C) for u, v in B]).buffer(C * 0.085 / 2, cap_style=2, join_style=2))


def op_thorns(g):                                 # 2: every bottom edge grows the same hooked barb
    yb = g.bounds[3]
    add = [tri((a, yb - 2), (b, yb - 2), (a + (b - a) * 0.10, yb + C * 0.22)) for a, b in segs(g, top=False)]
    return unary_union([g] + add)


def op_chip(g):                                   # 3: the same carved V-chip in the middle of every top edge
    yt = g.bounds[1]
    s = segs(g, top=True, band=0.12)
    if not s:
        return g
    a, b = max(s, key=lambda ab: ab[1] - ab[0])          # the widest top edge of the letter
    return g.difference(tri(((a + b) / 2 - C * 0.13, yt - 3), ((a + b) / 2 + C * 0.13, yt - 3), ((a + b) / 2, yt + C * 0.27)))


def op_speed(g):                                  # 4: two tapered speed slices from the back edge
    x0, _, x1, _ = g.bounds; w = x1 - x0
    cuts = [Polygon([(x0 - 10, -v * C - C * 0.04), (x0 + w * L, -v * C), (x0 - 10, -v * C + C * 0.04)])
            for v, L in ((0.62, 0.95), (0.38, 0.70))]
    return g.difference(unary_union(cuts))


def op_rays(g):                                   # 5: three thin rays fan up through every letter
    x0, _, x1, _ = g.bounds; cx = (x0 + x1) / 2
    cuts = []
    for ang in (-26, 0, 26):
        a = math.radians(ang); L = C * 0.80; tw = C * 0.03
        ax, ay = cx, -C * 0.42
        tx, ty = ax + math.sin(a) * L, ay - math.cos(a) * L
        cuts.append(tri((ax, ay), (tx + math.cos(a) * tw, ty + math.sin(a) * tw), (tx - math.cos(a) * tw, ty - math.sin(a) * tw)))
    return g.difference(unary_union(cuts))


def op_surf(g):                                   # 6: the same surf wave line cut low through every letter
    x0, _, x1, _ = g.bounds; w = x1 - x0
    pts = [(x0 - 10 + i * (w + 20) / 40, -C * (0.30 + 0.06 * math.sin(2 * math.pi * i / 40 * 1.5))) for i in range(41)]
    return g.difference(LineString(pts).buffer(C * 0.04, cap_style=2))


def op_peaks(g):                                  # 7: every top edge rises into the same twin peaks
    yt = g.bounds[1]
    add = [Polygon([(a, yt + 2), (a + (b - a) * 0.28, yt - C * 0.09), (a + (b - a) * 0.42, yt - C * 0.03),
                    (a + (b - a) * 0.68, yt - C * 0.19), (b, yt + 2)]) for a, b in segs(g, top=True)]
    return unary_union([g] + add)


def op_icicles(g):                                # 8: every bottom edge drips the same long-short icicles
    yb = g.bounds[3]
    add = []
    for a, b in segs(g, top=False):
        w = b - a
        for u0, u1, L in ((0.04, 0.42, 0.26), (0.48, 0.72, 0.13), (0.74, 0.98, 0.20)):
            if w < C * 0.25 and u0 > 0.4:
                continue
            add.append(tri((a + w * u0, yb - 2), (a + w * u1, yb - 2), (a + w * (u0 + u1) / 2, yb + C * L)))
    return unary_union([g] + add)


def op_flames(g):                                 # 9: every top edge burns into the same curling tongues
    yt = g.bounds[1]
    add = []
    for a, b in segs(g, top=True):
        w = b - a; n = max(1, round(w / (C * 0.22)))
        for k in range(n):
            xa = a + w * k / n; xb = a + w * (k + 1) / n; ww = xb - xa
            h = C * (0.30 if k % 2 == 0 else 0.19)
            left = [(xa + ww * 0.5 * t - math.sin(math.pi * t) * ww * 0.30 - ww * 0.45 * t * t, yt + 2 - h * t) for t in [i / 14 for i in range(15)]]
            right = [(xb - ww * 0.5 * t - math.sin(math.pi * t) * ww * 0.05 - ww * 0.45 * t * t, yt + 2 - h * t) for t in [i / 14 for i in range(15)]]
            add.append(Polygon(left + right[::-1]).buffer(0))
    return unary_union([g] + add)


def op_rivets(g):                                 # 10: the same row of rivet holes near the top of every stem
    x0, _, x1, _ = g.bounds; y = -C * 0.80
    holes = [Point((p.bounds[0] + p.bounds[2]) / 2, y).buffer(C * 0.062, quad_segs=16)
             for p in polys(g.intersection(box(x0 - 5, y - 1, x1 + 5, y + 1))) if p.bounds[2] - p.bounds[0] > C * 0.16]
    return g.difference(unary_union(holes)) if holes else g


# ======================================================== word layouts (list of letters -> list)
def lay_slant(deg):
    return lambda L: [affinity.skew(g, xs=deg, origin=(0, 0)) for g in L]


def lay_arch(sag):
    def f(L):
        x0, x1 = L[0].bounds[0], L[-1].bounds[2]; xm = (x0 + x1) / 2
        R = (x1 - x0) ** 2 / (8 * sag)
        def p(x, y):
            th = (x - xm) / R; r = R - y
            return xm + r * math.sin(th), R - r * math.cos(th)
        return [warp(g, p) for g in L]
    return f


def lay_wave(amp, waves=1.0, tilt=0.0):
    def f(L):
        x0, x1 = L[0].bounds[0], L[-1].bounds[2]
        return [warp(g, lambda x, y: (x, y - amp * math.sin(2 * math.pi * waves * (x - x0) / (x1 - x0)) + tilt * (x - x0))) for g in L]
    return f


def lay_ridge(lift):                              # taller in the middle (a mountain profile)
    def f(L):
        x0, x1 = L[0].bounds[0], L[-1].bounds[2]
        return [warp(g, lambda x, y: (x, y * (1 + lift * math.sin(math.pi * (x - x0) / (x1 - x0))))) for g in L]
    return f


def lay_flare(k, sag):                            # each letter widens toward its top, then a gentle arch
    def f(L):
        out = []
        for g in L:
            cx = (g.bounds[0] + g.bounds[2]) / 2
            out.append(warp(g, lambda x, y, cx=cx: (cx + (x - cx) * (1 + k * min(max(-y / C, 0), 1.3) ** 2), y)))
        return lay_arch(sag)(out)
    return f


# ======================================================== fills (top -> bottom)
CHROME = [(0, "#ffffff"), (0.28, "#f1f3f8"), (0.42, "#d5dbe5"), (0.455, "#ffffff"), (0.475, "#ffffff"),
          (0.50, "#7d869b"), (0.57, "#a6aec0"), (0.80, "#eef1f6"), (1, "#cfd5e1")]
DARK = [(0, "#8d6cc4"), (0.10, "#4b2c78"), (0.42, "#2a1446"), (0.47, "#b9a6e8"), (0.50, "#1c0b30"), (1, "#3d1f63")]
GOLD = [(0, "#fff1b8"), (0.30, "#f2c862"), (0.48, "#fff0bf"), (0.52, "#a8701f"), (0.75, "#d6a24a"), (1, "#8a5a1f")]
RACE = [(0, "#ffffff"), (0.45, "#f3f4f7"), (0.50, "#c9ccd6"), (1, "#eef0f4")]
LIGHT = [(0, "#ffffff"), (0.45, "#fff7da"), (0.75, "#ffe28a"), (1, "#ffc93c")]
SUN = [(0, "#fff8a6"), (0.40, "#ffd04a"), (0.75, "#ff9a3c"), (1, "#ff6f61")]
SNOW = [(0, "#ffffff"), (0.30, "#ffffff"), (0.34, "#c9d6e3"), (0.70, "#8195aa"), (1, "#5b6e84")]
FROST = [(0, "#ffffff"), (0.35, "#e3f7ff"), (0.50, "#a9e2fa"), (0.56, "#ffffff"), (1, "#bfeaff")]
FIRE = [(0, "#c41d0e"), (0.30, "#ff5a1a"), (0.62, "#ffb22e"), (1, "#fff1a0")]
STEEL = [(0, "#e9edf2"), (0.12, "#a9b2bd"), (0.22, "#d8dde4"), (0.34, "#8c96a3"), (0.46, "#c9cfd7"),
         (0.58, "#7c8693"), (0.70, "#b8c0ca"), (0.84, "#6c7683"), (1, "#a3acb7")]


# ======================================================== letter preparation (before the theme cut)
def prep_open_o(stem):
    return lambda ch, g: ring_o(g, C * stem) if ch == "O" else g


def prep_simplify(tol):
    return lambda ch, g: g.simplify(C * tol, preserve_topology=True).buffer(0)


# ======================================================== the ten themes
def T(n, slug, name, font, op, layout, fill, sample, sample_name, track, xscale=1.0, prep=None, glow=False):
    return dict(n=n, slug=slug, name=name, font=font, op=op, layout=layout, fill=fill, sample=sample,
                sample_name=sample_name, track=track, xscale=xscale, prep=prep, glow=glow)


THEMES = [
    T(1, "electricity", "Electricity", "RussoOne-Regular.ttf", op_bolt, lay_slant(-13), CHROME, "#ffcc33", "Volt Yellow", 20),
    T(2, "edgy-dark", "Edgy Dark", "PirataOne-Regular.ttf", op_thorns, lay_slant(-4), DARK, "#d01b45", "Night Crimson", 16, 1.15),
    T(3, "ancient", "Ancient", "Cinzel-Black.ttf", op_chip, lay_arch(55), GOLD, "#b5793a", "Aged Bronze", 14),
    T(4, "speed", "Speed", "RubikMonoOne-Regular.ttf", op_speed, lay_slant(-26), RACE, "#ff2b36", "Racing Red", 6, 1.30),
    T(5, "light", "Light", "LilitaOne-Regular.ttf", op_rays, lay_flare(0.28, 60), LIGHT, "#f2a516", "Dawn Gold", 26, glow=True),
    T(6, "tropical", "Tropical", "TitanOne-Regular.ttf", op_surf, lay_wave(C * 0.16, 1.0), SUN, "#14b8a6", "Lagoon Teal", 14, prep=prep_open_o(0.27)),
    T(7, "mountain", "Mountain", "Bungee-Regular.ttf", op_peaks, lay_ridge(0.22), SNOW, "#3f7d6e", "Pine Slate", 16, prep=prep_open_o(0.26)),
    T(8, "ice", "Ice", "RussoOne-Regular.ttf", op_icicles, lay_slant(-6), FROST, "#3fb8f0", "Glacier Blue", 18, prep=prep_simplify(0.05)),
    T(9, "fire", "Fire", "PassionOne-Black.ttf", op_flames, lay_wave(C * 0.05, 1.0, -0.04), FIRE, "#b3200e", "Ember Red", 18, prep=prep_open_o(0.28)),
    T(10, "metal", "Metal", "BlackOpsOne-Regular.ttf", op_rivets, lay_slant(0), STEEL, "#e8712c", "Forge Copper", 14, 1.05),
]
BY_SLUG = {t["slug"]: t for t in THEMES}


def theme(key):
    """A theme by slug ('electricity') or number ('1' / '01')."""
    if str(key).isdigit():
        return THEMES[int(key) - 1]
    if key not in BY_SLUG:
        raise SystemExit(f"unknown theme {key!r}; choose one of: {', '.join(BY_SLUG)}")
    return BY_SLUG[key]


def build(t, word):
    """The merged title shape and its counters (the letter holes kept open)."""
    letters, x = [], 0
    for ch in word:
        if ch == " ":
            x += C * 0.45
            continue
        g = glyph(t["font"], ch, C)
        if t["prep"]:
            g = t["prep"](ch, g)
        if t["xscale"] != 1.0:
            g = affinity.scale(g, t["xscale"], 1, origin=(0, 0))
        g = affinity.translate(g, x - g.bounds[0], 0)
        x = g.bounds[2] + t["track"]
        letters.append(t["op"](g))
    letters = t["layout"](letters)
    m = unary_union([p.buffer(0) for p in letters]).buffer(1.0, **J).buffer(-1.0, **J)
    m = unary_union([Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= 600]) for p in polys(m)])
    own = unary_union([Polygon(i) for p in letters for q in polys(p) for i in q.interiors])
    counters = unary_union([Polygon(h) for q in polys(m) for h in q.interiors
                            if Polygon(h).intersection(own).area > 0.5 * Polygon(h).area])
    return m, counters


def layers(word, counters, O=26, D=10, LINE=4, o_in=11, d_in=5, close=30):
    """dark edge, set-color outline and thin inner line around the merged word."""
    shut = lambda g: g.buffer(close, **J).buffer(-close, **J)
    nopocket = lambda g: unary_union([Polygon(p.exterior) for p in polys(g)])
    dark = nopocket(shut(word.buffer(O + D, **J))).difference(counters.buffer(-(o_in + d_in), **J))
    outl = nopocket(shut(word.buffer(O, **J))).difference(counters.buffer(-o_in, **J))
    line = word.buffer(LINE, **J)
    return dark, outl, line


def svg(text, word, counters, fill, color, glow, pad=70, OW=1600):
    dark, outl, line = layers(word, counters)
    minx, miny, maxx, maxy = dark.bounds
    W, H = maxx - minx + 2 * pad, maxy - miny + 2 * pad
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in fill)
    defs = ['<filter id="sh" x="-10%" y="-20%" width="120%" height="150%"><feGaussianBlur stdDeviation="11"/></filter>',
            '<filter id="gl" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="18"/></filter>',
            '<linearGradient id="rimg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/>'
            '<stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>',
            f'<linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient>']
    body = []
    if glow:   # Light: a soft glow behind the title (a halo, not an ornament)
        body.append(f'<path d="{d_of(dark)}" fill="{color}" opacity=".55" filter="url(#gl)"/>')
    body += [f'<path d="{d_of(affinity.translate(dark, 0, 14))}" fill="#000" opacity=".6" filter="url(#sh)"/>',
             f'<path id="edge" d="{d_of(dark)}" fill="{EDGE}" fill-rule="evenodd"/>',
             f'<path id="outline" d="{d_of(outl)}" fill="{color}" fill-rule="evenodd"/>',
             f'<path id="line" d="{d_of(line)}" fill="{mix(color, EDGE, 0.55)}" fill-rule="evenodd"/>',
             f'<path id="fill" d="{d_of(word)}" fill="url(#fillg)" fill-rule="evenodd"/>',
             f'<path d="{d_of(word.buffer(-5, **J))}" fill="none" stroke="url(#rimg)" stroke-width="2.6" stroke-linejoin="round"/>']
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{OW}" height="{H * OW / W:.0f}" viewBox="0 0 {W:.1f} {H:.1f}">'
            f'<title>{text}</title><defs>{"".join(defs)}</defs>'
            f'<g transform="translate({pad - minx:.1f} {pad - miny:.1f})">{"".join(body)}</g></svg>')


def check_color(c):
    if not re.fullmatch(r"#[0-9a-f]{6}", c or ""):
        raise SystemExit(f"--color must be a lowercase #rrggbb hex like card_sets.pack_color (got {c!r})")
    return c


def make_title(theme_key, text, color, out_dir, png=True):
    """Build one title. Returns (svg path, png path or None, shape, counters)."""
    t = theme(theme_key)
    color = check_color(color)
    os.makedirs(out_dir, exist_ok=True)
    word, counters = build(t, text)
    assert word.is_valid, "the merged title shape is not valid"
    sp = os.path.join(out_dir, "title.svg")
    open(sp, "w", encoding="utf-8").write(svg(text, word, counters, t["fill"], color, t["glow"]))
    pp = None
    if png:
        pp = os.path.join(out_dir, "title.png")
        render(sp, pp)
        small(pp, os.path.join(out_dir, "title-160.png"))
    return sp, pp, word, counters


def main():
    ap = argparse.ArgumentParser(description="Build a set title from one of the ten theme presets.")
    ap.add_argument("--theme", help="slug or number, for example electricity or 1")
    ap.add_argument("--word", help="the set name, for example ORIGINS")
    ap.add_argument("--color", help="the set color (card_sets.pack_color), for example #ff8d4d")
    ap.add_argument("--out", help="the output folder")
    ap.add_argument("--list", action="store_true", help="list the themes and their sample colors")
    a = ap.parse_args()
    if a.list or not a.theme:
        for t in THEMES:
            print(f'{t["n"]:2d}  {t["slug"]:12s} {t["font"]:26s} sample {t["sample"]} ({t["sample_name"]})')
        return
    if not (a.word and a.color and a.out):
        ap.error("--theme needs --word, --color and --out")
    from check import check_svg
    sp, pp, word, _ = make_title(a.theme, a.word.upper(), a.color, a.out)
    print(sp, pp, check_svg(sp))


if __name__ == "__main__":
    main()
