// The packs a daily pays NOW (dailies.sql claim_daily): its reward, but never past the daily cap.
// A streak-day check-in (reward 2) with 1 pack left under the cap pays 1, so the button says +1.
// (The claim also multiplies by settings.pack_earn_multiplier; the view's reward does not, and it is 1.)
export const payNow = (reward, cap, earned) => Math.max(0, Math.min(Number(reward) || 0, (Number(cap) || 0) - (Number(earned) || 0)));

// The two display numbers of the Dailies window that dailies_view does not send (UI-36): the streak week (the flame
// marks) and the packs of the next chat reward. Both come from the balance key 'daily' (the server's balance cache),
// so the client keeps no copy (one source of truth). A view that is off, or no balance row, stays as it is.
export function dailyExtras(view, daily) {
  if (!view?.enabled || !daily || !Array.isArray(view.tasks)) return view;
  const cycle = Number(daily.streak_cycle);
  const chat = Number(daily.chat), bonus = Number(daily.chat_bonus);
  const tasks = view.tasks.map((t) => {
    if (t.task !== 'chat') return t;
    const packs = Number(t.packs) || 0, max = Number(t.max) || 0;
    return { ...t, next: packs >= max ? 0 : packs < chat ? chat : bonus };
  });
  return { ...view, ...(cycle > 0 ? { streak_cycle: cycle } : {}), tasks };
}
