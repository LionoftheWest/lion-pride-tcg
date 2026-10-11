// UI-66 D-178: the "Last boss" view of the Hunt board. The last hunt is the newest finished one (status defeated or expired)
// that is not the live boss. `rows` are hunts rows (id, name, tier, status); the order of the rows does not matter.
export const FINISHED = ['defeated', 'expired'];
export function pickLastHunt(rows, activeId = null) {
  let best = null;
  for (const h of rows || []) {
    if (!h || !FINISHED.includes(h.status)) continue;
    if (activeId != null && String(h.id) === String(activeId)) continue;
    if (!best || Number(h.id) > Number(best.id)) best = h;
  }
  return best;
}
