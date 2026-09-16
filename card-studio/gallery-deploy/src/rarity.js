// SINGLE SOURCE OF TRUTH for card tiers. To add a new tier (like Event / Promo),
// add ONE block to TIERS below, then run `npm run sync-tiers` to add it to the
// Supabase enum. Everything else — the studio, the gallery, the render pipeline,
// the draw-pool rule, the chip/badge colors — reads from here.
//
// Fields per tier:
//   label      the human name shown everywhere (studio, gallery, add-tier list)
//   accent     the tier color (border, chip, pip, badge — one color drives all)
//   soft       a lighter accent used for subtitles / soft text
//   pip        the short tag printed on the card face
//   finish     the finish caption
//   template   'framed' (bordered art) or 'fullart' (art fills the card)
//   animated   true = rendered through Blender (foil / metallic motion)
//   inDrawPool false = never in a regular pack draw (awarded manually)
//   needsPeriod true = requires the Event / Promo period field
//
// THE ONE CUSTOM PART: a tier's visual foil look is a shader branch in
// blender/card_scene.py (matched by the tier key). A new tier can reuse an
// existing look by adding its key to that branch, or get its own branch.

export const TIERS = {
  normal:           { label: 'Normal',                  accent: '#9ca3af', soft: '#d1d5db', pip: 'Normal',   finish: 'Normal finish',                  template: 'framed',  animated: false },
  illustrated_rare: { label: 'Illustrated Rare',        accent: '#3b82f6', soft: '#93c5fd', pip: 'IR',       finish: 'Illustrated Rare finish',        template: 'framed',  animated: false },
  secret_rare:      { label: 'Secret Illustrated Rare', accent: '#8b5cf6', soft: '#c4b5fd', pip: 'SIR',      finish: 'Secret Illustrated Rare finish', template: 'framed',  animated: true },
  full_art:         { label: 'Full Art',                accent: '#ec4899', soft: '#f9a8d4', pip: 'Full Art', finish: 'Full Art finish',                template: 'fullart', animated: true },
  gold:             { label: 'Gold',                    accent: '#f59e0b', soft: '#fde68a', pip: 'Gold',     finish: 'Gold finish',                    template: 'fullart', animated: true },
  promo:            { label: 'Promo',                   accent: '#c9ced8', soft: '#eef1f6', pip: 'Promo',    finish: 'Promo finish',                   template: 'fullart', animated: true, inDrawPool: false, needsPeriod: true },
  event:            { label: 'Event',                   accent: '#10b981', soft: '#6ee7b7', pip: 'Event',    finish: 'Event finish',                   template: 'fullart', animated: true, inDrawPool: false, needsPeriod: true },
};

// Tier keys in display / draw order (object key order is the source of truth).
export const ORDER = Object.keys(TIERS);

// The Google Sheet's rarity tokens -> our tier keys (import only).
export const SHEET_TO_KEY = {
  normal: 'normal',
  ir: 'illustrated_rare',
  sir: 'secret_rare',
  'full art': 'full_art',
  gold: 'gold',
};

// --- Back-compat aliases (existing callers keep working) ---
// RARITY exposes accent/soft/pip/finish/template per tier (render.js).
export const RARITY = TIERS;
// SLOT_LABEL maps a tier key to its label (server.js, studio).
export const SLOT_LABEL = Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, v.label]));

// --- Derived helpers (read the flags above; never hard-code a tier list) ---
export const ANIMATED = new Set(ORDER.filter((k) => TIERS[k].animated));
export function isAnimated(rarity) { return TIERS[rarity]?.animated === true; }
export function inDrawPool(rarity) { return TIERS[rarity]?.inDrawPool !== false; }
export function needsPeriod(rarity) { return TIERS[rarity]?.needsPeriod === true; }
export const PERIOD_TIERS = ORDER.filter(needsPeriod);

// The public tier list the studio + gallery fetch, so their labels / colors /
// order / flags all come from this one file (never copied into the front-end).
export function tiersPublic() {
  return ORDER.map((key) => {
    const t = TIERS[key];
    return {
      key,
      label: t.label,
      accent: t.accent,
      animated: t.animated === true,
      inDrawPool: t.inDrawPool !== false,
      needsPeriod: t.needsPeriod === true,
    };
  });
}

// Each tier has its OWN art slot (reuse across tiers is opt-in via artsources.js).
export function artKeyFor(rarity) {
  return rarity;
}

// The distinct art images a card needs (one per finish).
export function artSlots(finishes) {
  return [...new Set(finishes)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
}

export function mapRarity(token) {
  return SHEET_TO_KEY[String(token).trim().toLowerCase()] ?? null;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
