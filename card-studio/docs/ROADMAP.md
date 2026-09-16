# Card Studio — roadmap / where we left off

## Locked
- **Full Art tier — the standard.** Masked holographic sheen confined to the
  artwork only (whole art incl. bottom text, fills the rounded corners, the
  border stays clean), no finish labels. Self-lit (no spotlights).
- **Transparent rounded corners** — universal for every tier.
- **All five tiers designed** — Normal, Illustrated Rare, Secret Rare (silvery
  holo border/art), Full Art (rainbow holo + emboss), Gold (metallic + emboss).
- **Shared card back — LOCKED.** The lion spiral back is one asset for every
  card and every tier. Template `templates/card.back.html` + `assets/spiral_bg.png`.
  Canonical render: `assets/card-back.png` (rebuild with `renderBack()` in
  `src/render.js`).
- **Every tier is a flip-reveal.** The card is a double-sided object: face-down
  lion back -> flips -> tier front (holo shimmers through the reveal), seamless
  36-frame loop. Built by `card_scene.build(..., back_path=...)`; `push.js`
  renders the back once and animates all five tiers.
- Per-tier look lives in `blender/card_scene.py`. Studio pipeline: sheet ->
  per-finish art -> render face (+ mask) + shared back -> Blender flip animate
  (all tiers) -> WebP -> upload -> upsert.

## Preview a whole card (front + back) in Blender
`& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --python blender\showcase.py -- <frontFace> <rarity> <mask|-> <backFace>`
Add an output PNG arg with `--background` for a side-by-side still.

## Next
1. **Bulk art** — upload art for all ~112 cards and push them (each card now
   ships all five tiers as flip-reveal WebPs).
2. **Reveal wiring** — confirm the bot's pack-open reveal shows the flip WebP
   the way we want (`tcg-bot/src/ui/reveal.ts`).

## How to resume
- **Studio UI:** `cd C:\Users\vaugh\discord\card-studio && npm run studio`
  -> open http://localhost:4321 (grid + gallery, per-finish art upload, push).
- **Live Blender preview (watch tweaks in real time):**
  `& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --python blender\live_preview.py -- <facePng> <rarity> [maskPng]`
  Then edit `blender/card_scene.py` and the window rebuilds itself.
- **The bot runs 24/7 on the Oracle VM** (137.131.48.8) — independent of this PC.
  Re-push a card from the studio to update its live art.
