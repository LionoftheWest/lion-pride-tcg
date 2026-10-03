// The packs a daily pays NOW (dailies.sql claim_daily): its reward, but never past the daily cap.
// A streak-day check-in (reward 2) with 1 pack left under the cap pays 1, so the button says +1.
// (The claim also multiplies by settings.pack_earn_multiplier; the view's reward does not, and it is 1.)
export const payNow = (reward, cap, earned) => Math.max(0, Math.min(Number(reward) || 0, (Number(cap) || 0) - (Number(earned) || 0)));
