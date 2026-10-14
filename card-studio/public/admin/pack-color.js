// The pack color rule (D-191): the set holo frame is made from card_sets.pack_color, so a color needs enough color.
// The same rule as the SQL function pack_color_ok (tcg-bot/supabase/d191_pack_color_check.sql): HSL saturation >= 0.35 and
// HSL lightness between 0.25 and 0.75. packColorError gives the text of the refusal, or null when the color is fine.
export const PACK_COLOR_MIN_SATURATION = 0.35;
export const PACK_COLOR_MIN_LIGHTNESS = 0.25;
export const PACK_COLOR_MAX_LIGHTNESS = 0.75;
export function packColorHsl(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
  return { s, l };
}
export function packColorError(hex) {
  const c = packColorHsl(hex);
  if (!c) return 'the pack color is #rrggbb';
  if (c.s >= PACK_COLOR_MIN_SATURATION && c.l >= PACK_COLOR_MIN_LIGHTNESS && c.l <= PACK_COLOR_MAX_LIGHTNESS) return null;
  return 'the pack color needs more color: saturation 35% or more and lightness 25% to 75% (the set frame is made from it). Pick a stronger color.';
}
