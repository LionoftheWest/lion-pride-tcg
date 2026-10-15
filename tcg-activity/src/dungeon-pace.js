// The pace of the monsters' turn in the Dungeon fight (ui-v2-dungeon.js act()). Each acting monster takes
// FOE_MS (450 name + 380 strike + 650 rest). With 4 or 5 monsters (a horde) the turn took 6 s or more, and the
// squad could not act in that time. The whole monsters' turn now takes at most TURN_MS: one monster keeps the
// old pace, 2 or more share the same time (the browser measure of 4 monsters: 2.7-3.3 s with TURN_MS 3000 and up to 3.05 s with 2700, so 2500 keeps the turn under 3 s). The pace never goes below MIN_PACE, so a pop still shows.
export const FOE_MS = 450 + 380 + 650;
export const TURN_MS = 2500;
export const MIN_PACE = 0.3;
export const foePace = (n) => (n > 0 ? Math.max(MIN_PACE, Math.min(1, TURN_MS / (n * FOE_MS))) : 1);
export const turnMs = (n) => Math.round(n * FOE_MS * foePace(n));
// Auto on the server plays AUTO_ROUNDS rounds in one request. After OFF the rounds that are not shown yet are skipped (they stay played on the
// server): this gives what the skipped rounds hold, so that the screen settles as after a full batch.
export const AUTO_ROUNDS = 2;
export const skippedRounds = (rounds, from) => {
  const rest = (rounds || []).slice(from);
  return { kill: rest.some((rd) => !!rd?.atk?.kill), loot: rest.some((rd) => !!(rd?.atk?.loot?.card || rd?.sup?.loot?.card)) };
};
