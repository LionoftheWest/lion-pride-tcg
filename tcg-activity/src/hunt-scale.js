// HUNT-HEADER-V2 (Nathan, 2026-11-06: "this hp bar is not accurate to what it actually is in game").
// With combat v2 live (hunt_v2_view.live), every member fights a PRIVATE copy of the boss. Its max HP is hunt_v2_view.boss_max: the max of
// combat_v2_hunt_boss, the one function that makes the fight's boss (hunt_v2_start). The shared row (hunts.hp_remaining / hp_max) keeps
// the v1 scale; hunt_v2_credit moves it by the private decrease x hp_max / private max. So the Hunt header shows the shared FRACTION on the
// private scale: hp = round(hp_remaining / hp_max x boss_max) of boss_max. The bar fraction does not change. No balance number is here.
// The v2 fight shows no boss ATK and no Weak to (ui-v2-gauntlet2.js foesOf: name, level, HP, statuses), so with v2 the header shows none.
// Flag OFF (or a view for another Hunt, or no boss_max): the v1 numbers, as before.

/** v2 = the view of a live v2 Hunt for this boss row (h). */
export function huntV2Scale(h, v2) {
  const max = Number(v2?.boss_max);
  return !!(v2?.ok && v2.live === true && max > 0 && Number(h?.hp_max) > 0 && v2.hunt && Number(v2.hunt.id) === Number(h.id));
}

/** The boss HP of the header: { hp, max, v2 }. The max is rounded up as the fight shows it (ui-v2-gauntlet2.js maxShown). */
export function huntHpShown(h, v2) {
  if (!huntV2Scale(h, v2)) return { hp: Number(h?.hp_remaining) || 0, max: Number(h?.hp_max) || 0, v2: false };
  const max = Number(v2.boss_max);
  return { hp: Math.max(0, Math.round((Number(h.hp_remaining) / Number(h.hp_max)) * max)), max: Math.ceil(max), v2: true };
}
