# Pack art: the set-art pipeline and guide

This folder makes the pack art of one card set: the set title, the pack front, and the
three game clips (`idle_loop.webp`, `open.webp`, `open_rare.webp`). One command runs all
steps. Nathan asked for this guide on 2026-10-07 (D-111): "Lets document this process so
that future art is better made".

The decisions with Nathan's words are in the private design repo
(`lion-pride-tcg-design/FEEDBACK.md`, D-80 to D-111). This guide quotes them.

## 1. Folder layout

| Path | Content |
|---|---|
| `make_set_art.py` | The one command: title, front, texture, Blender (normal and rare), encode. |
| `title/lettering.py` | The lettering library: font outlines to shapes, SVG, PNG. |
| `title/themes.py` | The ten title themes of round 5 as presets. Input: the word and the set color. |
| `title/check.py` | The title check: one merged shape, one fill, one outline, one edge. |
| `front/make_front.py` | The pack front (D-104) and our model texture. |
| `front/logo.html` | The Lion Pride TCG lockup C, from the app font, emblem and colors. |
| `front/crimps.json` | Our plain silver crimps of the model texture (two 1-D profiles). |
| `blender/pack_open.py` | The pack opening in Blender 5.2 (the approved v4). Trailer and game clips. |
| `encode/encode_game.py` | The WebP encoder for the three game clips (measured settings). |
| `fonts/` | The nine OFL fonts of the themes, each with its `OFL-<name>.txt`. |
| `model/` | The pack model. Git ignores this folder (section 6). |

The output goes to `card-studio/out/sets/<code>/`. Git ignores `out/`. Never commit it.

## 2. Tools

- `py -3.14` with Pillow, numpy, fontTools, shapely and playwright (Chromium installed).
- Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
  Use `--blender <path>` or the environment variable `BLENDER` for a different path.
- ffmpeg is only for preview videos. Its `drawtext` filter crashes on this computer.
  Put labels on images with Pillow.

## 3. Make the art of a new set

Do these steps in this sequence.

1. Choose the set name with Nathan (D-102: "Origins is a great set name").
2. Make the set code from letters of the name (D-103: "I like the 'ORI' signifier").
   The code has 1 to 8 capital letters or digits (`card_sets.code`).
3. Choose the season. A season can hold more than one set (D-103). The count of sets in
   each season is still open.
4. Choose the set color with Nathan. It is `card_sets.pack_color`, lowercase `#rrggbb` (D-105).
5. Choose a title theme (section 5). Show the ten themes in the set color (step 8).
6. Choose the cover card: a popular card of the set (D-86: "an image from the set
   itself"). The cover is also `card_sets.cover_card_id`. Use the card art file from
   `card-studio/art/`.
7. Put the pack model in `model/` (section 6). The script stops with a message if it is missing.
8. Make the review files first (seconds, no Blender):

   ```
   py -3.14 card-studio/pack-art/make_set_art.py --set ORI --name ORIGINS --theme electricity --color "#ff8d4d" --cover card-studio/art/lionofthewest-s-pikachu-full_art.jpg --review
   py -3.14 card-studio/pack-art/title/check.py --word ORIGINS --color "#ff8d4d" --render card-studio/out/sets/ORI/themes
   ```

   The second command makes all ten themes in the set color, for the choice of the theme.
9. Review the title, the 160 px title and the front with Nathan (section 7).
10. Run the full command (the same command without `--review`). It renders 25 + 39 + 39
    frames in Blender and encodes the three clips. Add `--season <n>` to record the season
    in `set.json`.
11. Review the three clips with Nathan.
12. Copy the three WebP files to `tcg-activity/public/packs/<set_id>/` (D-101, the
    convention in the comment on PR #237). `<set_id>` is `card_sets.id` (Origins = `S1`).
13. Set the `card_sets` row in a migration: `name`, `code`, `season`, `pack_color`,
    `cover_card_id`, `released_at`, and `pack_art_url` (the clip folder, PR #237).
    Follow the migration steps in the repo `CLAUDE.md`.

What the command does:

| Step | Script | Output |
|---|---|---|
| 1. Title | `title/themes.py`, then `title/check.py` | `title/title.svg`, `title.png`, `title-160.png` |
| 2. Front | `front/make_front.py` | `front/logo-lockup.png`, `cover.png`, `flat-front.png` |
| 3. Texture | `front/make_front.py` | `front/pack_DIFFUSE.png` (1920 x 1080) |
| 4. Blender | `blender/pack_open.py ... game` and `... game rare` | `frames/idle`, `frames/open`, `frames_rare/open` |
| 5. Encode | `encode/encode_game.py` | `idle_loop.webp`, `open.webp`, `open_rare.webp`, the loop check |

The full-length trailer (4.8 s, 1000 x 1400, 30 fps) is not part of the command. Make it with:
`blender --factory-startup -b --python blender/pack_open.py -- <outDir> diffuse=<pack_DIFFUSE.png>`.

## 4. The design rules from Nathan

| ID | Rule | Nathan's words |
|---|---|---|
| D-86 | The set picture (and the pack cover) is a card from the set. | "Yeah I'm thinking an image from the set itself" |
| D-90 | Each set has its own pack color, later its own artwork. | "I also want to look at having different colors for the packs themselves" |
| D-91 | The pack opens with a tear at the top. The tear is smooth. | "Tear the top but we also need to work on making that even smoother and better too" |
| D-93 | Two clips: an idle loop (about 1.5 s, seamless) and an open clip. One pair for each set. | "Yes split the two" |
| D-94 | A second tap does not skip the open clip. | "Nah I like the animation" |
| D-95 | The game clip has a short charge-up (about 1 s). The trailer keeps the full length. | "Sure" |
| D-96 | A rare pack (any SR+ card) plays its own clip with rainbow rays and stars. | "Yes rainbow" |
| D-97 | The rare clip uses the rare sound at the burst (about 1400 ms). | "Todays rare sound" |
| D-98 | The idle loop is the same for every pack. | "Nah keep the idle loop the same" |
| D-101 | The pack shows the art of its own set (idle, open, rare, multi-pack). | "whatever pack they're opening has that packs art as well" |
| D-103 | The set code is letters from the set name. | "I like the 'ORI' signifier" |
| D-104 | No "Season 1" on the pack. The title is at the bottom, large, with an outline around the letters (no plate). The logo sits above the title at half its width. | "remove the 'season 1' spot so the title is more obvious"; "have the background outline the letters themselves vs being a square background" |
| D-105 | The title outline is the set color (`card_sets.pack_color`). | "One color for each set so every time we make a new set we'll customize the pack art" |
| D-107 | In a multi-pack open, only the pack with the SR+ card plays the rainbow clip. | "only the pack that is 'rare' should have a rainbow shine" |
| D-110 | The Origins title is theme 01 Electricity, in the Origins orange `#ff8d4d`. | "I'm going to go with the electricity one for this pack"; "Lets do A" |

How the scripts apply these rules:

- The tear (D-91): a clean edge on a natural path. The path starts under the top crimp at
  the notch, drifts down about 2.5% of the pack height, and has two gentle kinks. The rip
  speed is uneven (a catch, a fast rip, a slow end, the last corner lets go).
- The game clips: 800 x 1120, 60 ms frames. The idle loop is 25 frames (1.5 s). The open
  clip is 39 frames (2.34 s). The open clip starts on frame 1 of the idle loop.
- The front (D-104): the cover fills the front. A dark fade starts at 56% of the height.
  The title is 78% of the front width, centered at 84.5% of the height. The logo is half
  the title width, 14 px above the title.
- The theme sample colors are only samples. The set color always drives the title outline
  (D-105, D-110).

## 5. The title: lessons from the five lettering rounds

Nathan reviewed five rounds of titles for ORIGINS on 2026-10-07. Obey these rules:

1. Apply one theme in the same way to every letter. Nathan: "stick with some theme, not
   try to add everything".
2. Change the letterforms themselves. Effects around the letters are not sufficient.
3. Let the theme drive the whole title: the letters, the fill, the colors and the layout.
   Do not reuse one base style with a different effect.
4. Do not scatter decorations around the title. Every part of the theme is in the letters.
5. Make the title one merged shape. No letter has its own outline. `title/check.py` tests this.
6. Do not use plates behind letters, unless the plates line up.
7. Make sure that the title is easy to read at tile size (160 px wide). Examine `title-160.png`.

How a theme is built (`title/themes.py`):

1. Read each letter outline from an OFL font (fontTools). Flatten the curves.
2. Change each letter with the theme operation (shapely booleans): for example a bolt cut.
3. Apply the layout to the word: slant, arch, wave, ridge or flare.
4. Merge all letters into one shape. Keep the letter holes (counters) open.
5. Add one dark edge, one outline in the set color, one thin inner line, one gradient fill.
6. Render the SVG with Chromium (Playwright) to a 1600 px PNG and a 160 px preview.

The ten themes (round 5). The color is the sample of the review, not the set color:

| No. | Theme | Font | The one idea on every letter | Layout | Sample color |
|---|---|---|---|---|---|
| 01 | `electricity` | Russo One | A Z-shaped bolt break | Slant -13 deg | Volt Yellow `#ffcc33` |
| 02 | `edgy-dark` | Pirata One | A hooked barb on each bottom edge | Slant -4 deg | Night Crimson `#d01b45` |
| 03 | `ancient` | Cinzel Black | A carved V-chip in each top edge | Arch | Aged Bronze `#b5793a` |
| 04 | `speed` | Rubik Mono One | Two tapered speed slices | Slant -26 deg | Racing Red `#ff2b36` |
| 05 | `light` | Lilita One | Three thin rays fan up | Flare and arch, glow | Dawn Gold `#f2a516` |
| 06 | `tropical` | Titan One | A surf wave line cut low | Wave | Lagoon Teal `#14b8a6` |
| 07 | `mountain` | Bungee | Twin peaks on each top edge | Ridge | Pine Slate `#3f7d6e` |
| 08 | `ice` | Russo One | Icicles on each bottom edge | Slant -6 deg | Glacier Blue `#3fb8f0` |
| 09 | `fire` | Passion One Black | Curling flame tongues on each top edge | Low wave | Ember Red `#b3200e` |
| 10 | `metal` | Black Ops One | A row of rivet holes | Straight | Forge Copper `#e8712c` |

Origins uses theme 01 in `#ff8d4d` (D-110). To add a theme, add one operation, one layout
and one fill to `title/themes.py`. Then run `title/check.py`.

## 6. Licenses

- The fonts are SIL Open Font License 1.1. Commercial use is permitted. Keep each
  `OFL-<name>.txt` with its font. The titles use modified outlines in artwork, which the OFL
  permits. Do not publish a modified font under a Reserved Font Name (Russo, Lilita, Titan,
  Pirata, Passion).
- The pack model (`cardpack2.fbx` and `optional_NORMAL.png`) is not in git. Nathan cleared it
  on 2026-10-07: "that is a free model from online so we're good to go". Source: Sketchfab
  (Nathan, 2026-10-07: "Sketchfab is it I believe, so just record it"). The model page and its
  license text are not recorded. When the page is found, add its URL and license here.
  Known facts: the download is `trading-card-pack.zip` (2024-04-29). It holds
  `source/packmodel.zip` and `textures/` (DIFFUSE.png, optional_NORMAL.png). This is the
  layout of a Sketchfab download, as Nathan confirmed. It has no license file.
- Put the two model files in `card-studio/pack-art/model/`. Until the license is recorded,
  do not commit them.
- Never use third-party scanned pack art. The model's own `DIFFUSE.png` is a scan of a real
  third-party pack. The scripts never read it. Our texture is `front/crimps.json` (our plain
  silver crimps) plus our own front.

## 7. Review images

- Copy the review images to `ui-audit/designs/pack-art/<code>/review-<k>/` in the main repo
  folder. Nathan reads them on his phone in T3.
- Never commit `ui-audit/`. The repo is public, and a local pre-commit hook blocks it.
- Show at least: `title.png`, `title-160.png` on the dark background, `flat-front.png`, and
  the three clips.

## 8. Checks and open points

- `title/check.py` with no arguments builds all ten themes and tests each one.
- The encoder prints the idle loop check: the frame after the loop against frame 1.
  The approved Origins loop measures 0.571. One idle frame step measures 2 to 7.
- `make_set_art.py` stops if the frame counts are not 25, 39 and 39.
- The cover is cut at 1000 x 1889 and then scaled to 1000 x 1529 (the band proportions).
  This squeezes the cover art to about 81% of its height. Nathan kept it on 2026-10-07
  ("No it looks fine"). Do not change it without his decision.
