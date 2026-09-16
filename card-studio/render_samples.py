"""Render a few real cards from cards.csv across all five rarities, then stitch
them into one contact sheet so we can review the design with real data."""
import csv
import html
import os
import subprocess
from pathlib import Path
from PIL import Image

BASE = Path(r"C:\Users\vaugh\discord\card-studio")
FRAMED = (BASE / "templates" / "card.template.html").read_text(encoding="utf-8")
FULLART = (BASE / "templates" / "card.fullart.html").read_text(encoding="utf-8")
OUT = BASE / "out"
OUT.mkdir(exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
PROFILE = os.path.join(os.environ["TEMP"], "edge-cardgen")

# rarity key -> (accent, accent_soft, pip label, finish label)
RARITY = {
    "normal": ("#9ca3af", "#d1d5db", "Normal", "Normal finish"),
    "illustrated_rare": ("#3b82f6", "#93c5fd", "IR", "Illustrated Rare finish"),
    "secret_rare": ("#8b5cf6", "#c4b5fd", "SIR", "Secret Illustrated Rare finish"),
    "full_art": ("#ec4899", "#f9a8d4", "Full Art", "Full Art finish"),
    "gold": ("#f59e0b", "#fde68a", "Gold", "Gold finish"),
}


def load_cards():
    with open(BASE / "cards.csv", encoding="utf-8-sig", newline="") as f:
        return {r["Card Name"]: r for r in csv.DictReader(f)}


def render(name, genre, lore, rarity, outfile):
    accent, soft, pip, finish = RARITY[rarity]
    template = FULLART if rarity == "full_art" else FRAMED
    doc = (
        template.replace("%%ACCENT%%", accent)
        .replace("%%ACCENT_SOFT%%", soft)
        .replace("%%CLASS%%", rarity)
        .replace("%%NAME%%", html.escape(name))
        .replace("%%GENRE%%", html.escape(genre.upper()))
        .replace("%%LORE%%", html.escape(lore))
        .replace("%%PIP%%", html.escape(pip))
        .replace("%%FINISH%%", finish)
        .replace("%%ARTIST%%", "Art pending")
        .replace("%%ART%%", "ART")
    )
    tmp = OUT / "_tmp.html"
    tmp.write_text(doc, encoding="utf-8")
    subprocess.run(
        [
            EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
            f"--user-data-dir={PROFILE}", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--virtual-time-budget=4000",
            f"--screenshot={outfile}", "--window-size=500,700",
            f"file:///{tmp.as_posix()}",
        ],
        check=True, capture_output=True,
    )


cards = load_cards()
# one card per genre, each at a different rarity
samples = [
    ("LionoftheWest's Tsareena", "gold"),
    ("Brego's Link", "full_art"),
    ("Xeno's Blueprint", "secret_rare"),
    ("KobeDunk's Golf Cart", "illustrated_rare"),
    ("Pineapple on Pizza", "normal"),
]

paths = []
for name, rarity in samples:
    row = cards[name]
    out = OUT / f"sample_{rarity}.png"
    render(name, row["Genre"], row["Lore Description"], rarity, str(out))
    paths.append(out)

# stitch into a horizontal contact sheet
imgs = [Image.open(p) for p in paths]
gap = 16
w = sum(i.width for i in imgs) + gap * (len(imgs) + 1)
h = max(i.height for i in imgs) + gap * 2
sheet = Image.new("RGB", (w, h), (10, 12, 18))
x = gap
for im in imgs:
    sheet.paste(im, (x, gap))
    x += im.width + gap
sheet_path = OUT / "samples_contact.png"
sheet.save(sheet_path)
print("SAVED", sheet_path)
