// ON-UI (ON SPEC 3.5): the v1 refusals of combat v2 for everyone. The SQL refuses (dungeon_start, hunt_attack, hunt_support: R2-ON,
// R3-ON); the routes only map the code to HTTP 409 with a message the member can read. No gate here: the guard is in SQL.
export const V2_REFUSAL = {
  v2_on: 'Combat v2 is live. Play this in the new fight.',
  v2_today: 'You already played in combat v2 today.',
  v1_today: 'You already played in the old fight today.',
};
/** A refused answer with a combat v2 code: send 409 with the message and answer true; else answer false (the caller goes on). */
export function sendV2Refusal(res, data) {
  const m = data && data.ok === false ? V2_REFUSAL[data.error] : null;
  if (!m) return false;
  res.status(409).json({ ...data, ok: false, message: m });
  return true;
}
