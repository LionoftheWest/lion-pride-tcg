"""The lettering library: font outlines -> shapely shapes -> SVG paths -> PNG.

Letter outlines come from the SIL OFL fonts in ../fonts. fontTools flattens each
glyph, shapely changes and merges the shapes, and Playwright Chromium renders the
SVG to a PNG. The result is artwork (a title), not a font.

From the 2026-10-07 lettering rounds (card-studio/out/pack-font/custom: lib.py and
round2/lib2.py). Only the parts that the round-5 themes use are kept.
"""
import asyncio
import os
import re
import tempfile

import numpy as np
import shapely
from fontTools.pens.basePen import BasePen
from fontTools.ttLib import TTFont
from PIL import Image
from shapely import affinity
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.normpath(os.path.join(HERE, "..", "fonts"))
EDGE = "#140A22"          # the dark outer edge (the app's ink color)


class FlatPen(BasePen):
    """Records each glyph contour as a list of points (curves flattened)."""

    def __init__(self, gs, steps=18):
        super().__init__(gs)
        self.contours, self.cur, self.steps = [], None, steps

    def _moveTo(self, p):
        self.cur = [p]

    def _lineTo(self, p):
        self.cur.append(p)

    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; m = 1 - t
            self.cur.append(tuple(m**3 * a + 3 * m * m * t * b + 3 * m * t * t * c + t**3 * d
                                  for a, b, c, d in zip(p0, p1, p2, p3)))

    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; m = 1 - t
            self.cur.append(tuple(m * m * a + 2 * m * t * b + t * t * c for a, b, c in zip(p0, p1, p2)))

    def _closePath(self):
        if self.cur and len(self.cur) > 2:
            self.contours.append(self.cur)
        self.cur = None

    _endPath = _closePath


_fonts = {}


def raw_glyph(fontfile, ch, cap):
    """Glyph `ch` scaled by cap / sCapHeight, y down, baseline y=0, left edge x=0."""
    if fontfile not in _fonts:
        _fonts[fontfile] = TTFont(os.path.join(FONTS, fontfile))
    f = _fonts[fontfile]
    gs = f.getGlyphSet()
    cmap = f.getBestCmap()
    if ord(ch) not in cmap:
        raise SystemExit(f"the font {fontfile} has no glyph for {ch!r}")
    pen = FlatPen(gs)
    gs[cmap[ord(ch)]].draw(pen)
    s = cap / f["OS/2"].sCapHeight
    g = Polygon()
    for c in pen.contours:
        g = g.symmetric_difference(Polygon([(x * s, -y * s) for x, y in c]).buffer(0))
    g = g.buffer(0)
    return affinity.translate(g, -g.bounds[0], 0)


_H = {}


def glyph(fontfile, ch, cap):
    """Glyph scaled so that the font's H is `cap` tall (works for fonts without sCapHeight)."""
    if fontfile not in _H:
        h = raw_glyph(fontfile, "H", 1000).bounds
        _H[fontfile] = (h[3] - h[1]) / 1000
    return raw_glyph(fontfile, ch, cap / _H[fontfile])


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    out = []
    for p in g.geoms:
        out += polys(p)
    return out


def d_of(g):
    out = []
    for p in polys(g):
        for ring in [p.exterior, *p.interiors]:
            cs = list(ring.coords)[:-1]
            out.append("M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in cs) + "Z")
    return "".join(out)


def mix(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]; b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(a, b))


def warp(g, fn, seg=3.0):
    """Map every outline point of g through fn(x, y) -> (x', y')."""
    g = shapely.segmentize(g, seg)
    return shapely.transform(g, lambda c: np.array([fn(x, y) for x, y in c]).reshape(-1, 2)).buffer(0)


async def _render(svg_path, png_path):
    from playwright.async_api import async_playwright
    txt = open(svg_path, encoding="utf-8").read()
    W, H = [float(v) for v in re.search(r'width="([\d.]+)" height="([\d.]+)"', txt).groups()]
    fd, html = tempfile.mkstemp(suffix=".html")
    os.close(fd)
    open(html, "w", encoding="utf-8").write(
        f'<!doctype html><html><body style="margin:0;background:transparent">{txt}</body></html>')
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={"width": int(W) + 2, "height": int(H) + 2})
            await pg.goto("file:///" + html.replace("\\", "/"))
            await pg.locator("svg").screenshot(path=png_path, omit_background=True)
            await b.close()
    finally:
        os.remove(html)


def render(svg_path, png_path):
    asyncio.run(_render(svg_path, png_path))


def small(png_path, out, w=160):
    """The title at tile size (default 160 px wide) on the app's dark background."""
    im = Image.open(png_path).convert("RGBA")
    h = round(im.height * w / im.width)
    s = im.resize((w, h), Image.LANCZOS)
    bg = Image.new("RGBA", (w + 20, h + 20), (9, 5, 15, 255))
    bg.alpha_composite(s, (10, 10))
    bg.save(out)
