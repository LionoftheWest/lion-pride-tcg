// The pace of the monsters' turn in the Dungeon fight (ui-v2-dungeon.js act()). Each acting monster takes
// FOE_MS (450 name + 380 strike + 650 rest). With 4 or 5 monsters (a horde) the turn took 6 s or more, and the
// squad could not act in that time. The whole monsters' turn now takes at most TURN_MS: up to 2 monsters keep the
// old pace, more monsters share the same time. The pace never goes below MIN_PACE, so a pop still shows.
export const FOE_MS = 450 + 380 + 650;
export const TURN_MS = 3000;
export const MIN_PACE = 0.4;
export const foePace = (n) => (n > 0 ? Math.max(MIN_PACE, Math.min(1, TURN_MS / (n * FOE_MS))) : 1);
export const turnMs = (n) => Math.round(n * FOE_MS * foePace(n));
