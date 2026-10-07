"""The pack front and the model texture (D-104, D-105).

Layout (D-104): the cover art fills the front; a dark fade covers the bottom; the set
title sits at the bottom at 78% of the front width; the Lion Pride TCG lockup C sits
directly above the title at half the title width. No "SEASON 1" and no plate.

Steps:
  1. logo   - render the lockup C from logo.html (the app's font, emblem and colors)
  2. cover  - scale the cover card art to the pack height (1889 px), crop 1000 px wide
  3. front  - cover + fade + logo + title, at the model's front proportions (1000 x 1529)
  4. texture- the model texture (1920 x 1080): a dark field, our plain silver crimps
              (crimps.json) and the front in the printed band. The model's own
              DIFFUSE.png is a scan of a third-party pack: NEVER use it.

Run:
  py -3.14 make_front.py --cover <card art> --title <title.png> --out <dir> [--cover-x 0.5]
Writes <dir>/logo-lockup.png, cover.png, flat-front.png, pack_DIFFUSE.png.
"""
import argparse
import asyncio
import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
COVER_W, COVER_H = 1000, 1889          # the tall pack front the cover is cut to
DW, DH = 1000, 1529                    # the printed band proportions on the model (558 x 853 px)
FADE = (0.56, 0.74)                    # the bottom fade: starts at 56% of the height, solid at 74%
FADE_RGB = (9, 5, 15)                  # the app's darkest background
TITLE_W = 0.78                         # the title width, as a fraction of the front width
TITLE_CY = 0.845                       # the title center, as a fraction of the front height
LOGO_GAP = 14                          # px between the lockup and the title


async def _shot(path):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        await pg.goto("file:///" + os.path.join(HERE, "logo.html").replace("\\", "/"))
        await pg.wait_for_timeout(800)
        await pg.locator("#logo").screenshot(path=path, omit_background=True)
        await b.close()


def render_logo(path):
    asyncio.run(_shot(path))
    return path


def cut_cover(src, path, cx=0.5):
    """Scale the art to the pack height and crop COVER_W wide around cx (0..1 of the art width)."""
    art = Image.open(src).convert("RGBA")
    art = art.resize((round(art.width * COVER_H / art.height), COVER_H), Image.LANCZOS)
    if art.width < COVER_W:
        raise SystemExit(f"the cover art is too narrow for the pack ({art.width} px after scaling, {COVER_W} needed)")
    x = min(max(int(art.width * cx) - COVER_W // 2, 0), art.width - COVER_W)
    art.crop((x, 0, x + COVER_W, COVER_H)).save(path)
    return path


def compose(cover, title, logo, path):
    art = Image.open(cover).convert("RGBA").resize((DW, DH), Image.LANCZOS)
    y = np.linspace(0, 1, DH)[:, None]
    fade = np.clip((y - FADE[0]) / (FADE[1] - FADE[0]), 0, 1)
    band = np.zeros((DH, DW, 4), "uint8"); band[..., :3] = FADE_RGB
    band[..., 3] = (fade * 255).astype("uint8").repeat(DW, 1)
    front = art.copy(); front.alpha_composite(Image.fromarray(band, "RGBA"))
    name = Image.open(title).convert("RGBA"); nw = round(DW * TITLE_W)
    name = name.resize((nw, round(name.height * nw / name.width)), Image.LANCZOS)
    ny = round(DH * TITLE_CY - name.height / 2)
    lg = Image.open(logo).convert("RGBA"); lw = round(nw * 0.5)
    lg = lg.resize((lw, round(lg.height * lw / lg.width)), Image.LANCZOS)
    ly = ny - lg.height - LOGO_GAP
    front.alpha_composite(lg, ((DW - lw) // 2, ly))
    front.alpha_composite(name, ((DW - nw) // 2, ny))
    front.save(path)
    bottom = DH - (ny + name.height)
    print(f"front: title {name.size} at y {ny}-{ny + name.height}, logo {lg.size} at y {ly}, bottom margin {bottom} px of {DH}")
    if bottom < 0 or ly < DH * FADE[0]:
        raise SystemExit("the title or the logo does not fit the bottom band: check the title proportions")
    return path


def texture(front, path):
    """Our model texture: dark field + plain silver crimps + the front in the printed band."""
    c = json.load(open(os.path.join(HERE, "crimps.json")))
    W, H = c["size"]
    t = np.zeros((H, W, 4), "uint8"); t[..., :3] = c["background"]; t[..., 3] = 255
    col = np.array(c["cols"])
    for bd in c["bands"]:
        rows = np.array(bd["rows"])
        v = np.clip(np.rint(rows[:, None] + col[None, :]), 0, 255).astype("uint8")
        t[bd["y0"]:bd["y0"] + len(rows), c["x0"]:c["x1"], :3] = v[..., None]
    tex = Image.fromarray(t, "RGBA")
    x0, y0, x1, y1 = c["band"]
    tex.paste(Image.open(front).convert("RGBA").resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0))
    tex.save(path)
    return path


def make_front(cover_src, title, out, cover_x=0.5):
    os.makedirs(out, exist_ok=True)
    logo = render_logo(os.path.join(out, "logo-lockup.png"))
    cover = cut_cover(cover_src, os.path.join(out, "cover.png"), cover_x)
    front = compose(cover, title, logo, os.path.join(out, "flat-front.png"))
    return texture(front, os.path.join(out, "pack_DIFFUSE.png"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cover", required=True, help="the cover card art (a popular card of the set, D-86)")
    ap.add_argument("--title", required=True, help="the title PNG from ../title/themes.py")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cover-x", type=float, default=0.5, help="the horizontal center of the crop (0..1)")
    a = ap.parse_args()
    print(make_front(a.cover, a.title, a.out, a.cover_x))
