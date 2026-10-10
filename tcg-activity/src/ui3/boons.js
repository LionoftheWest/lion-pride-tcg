// UI-27: the Boons tab (docs/design.md 6.5 pickers, D-42, D-43, D-62). Approved: design repo UI-27/approved.
// The pure rules of the tab, so that they can be checked without a browser: who the member picker lists, why a member
// or the whole day is blocked, how the lists page, and how the Card picker filters effect cards. The server keeps its
// own limits (play_card_effect); nothing here changes a rule.

/** The kinds of the Card picker switch (glossary 10.1, D-05: boon, prank, shield; the server kind "neutral" is a shield). */
export const KINDS = [
  { id: 'all', label: 'All' },
  { id: 'boon', label: 'Boon' },
  { id: 'prank', label: 'Prank' },
  { id: 'shield', label: 'Shield' },
];

/** The kind of the server ("boon", "prank", "neutral") as the glossary names it. */
export const kindName = (k) => (k === 'neutral' || !k ? 'shield' : k);

/**
 * The play history for the Member picker (Frequent = 2 or more plays, Recent = the rest): one entry for each play that
 * I made, newest data first as the picker sorts it. Pure.
 * plays: [{ from_id, to_id, to, at }], me: my id.
 */
export function playHistory(plays, me) {
  const self = String(me ?? '');
  return (plays || []).filter((p) => p && p.to_id != null && String(p.from_id) === self && String(p.to_id) !== self)
    .map((p) => ({ id: String(p.to_id), name: p.to, at: p.at }));
}

/**
 * Why a member cannot get a card now: the same count that play_card_effect uses (pair_per_day by the aimed member).
 * "" = open. Pure.
 */
export function memberReason(member, { pairs = {}, caps = {} } = {}) {
  if (!member) return '';
  const cap = Number(caps.pair_per_day) || 0;
  if (cap && (Number(pairs[String(member.id)]) || 0) >= cap) return `You played ${cap} cards on ${member.name} today.`;
  return '';
}

/** The day limit (PR #151): "" while plays are left, else the line with the time to the new day. Pure.
 *  fmt(seconds) -> "7h 25m". */
export function dayLine({ cap = 0, used = 0, resetIn = 0 }, fmt) {
  if (!cap || used < cap) return '';
  return `You played your ${cap} cards today. New plays in ${fmt(resetIn)}.`;
}

/** The share of the bar for an active effect: the time left of the whole time, 100 when it has no end. Pure. */
export function leftPct(durationS, expiresAt, now = Date.now()) {
  const total = (Number(durationS) || 0) * 1000;
  if (!total || !expiresAt) return 100;
  const left = new Date(expiresAt).getTime() - now;
  return Math.max(0, Math.min(100, Math.round((100 * left) / total)));
}

/** One page of a list (D-36, 3.4 [CI]): per rows fit; the page is kept inside 1..pages. Pure. */
export function pageOf(list, per, page) {
  const n = Math.max(1, per | 0);
  const pages = Math.max(1, Math.ceil((list || []).length / n));
  const at = Math.max(0, Math.min(pages - 1, page | 0));
  return { rows: (list || []).slice(at * n, at * n + n), page: at, pages };
}

/**
 * The cards of the Card picker (D-42: only effect cards): the kind switch, the rarity filter and the search.
 * Cards that are ready come first, then the strongest. Pure.
 * kindOf(card) -> the server kind. values: { kind, rarity }.
 */
export function pickerCards(cards, values, q, kindOf, readyIn = () => 0) {
  const t = String(q || '').trim().toLowerCase();
  return (cards || []).filter((c) => c?.effect?.primitive)
    .filter((c) => !values?.kind || values.kind === 'all' || kindName(kindOf(c)) === values.kind)
    .filter((c) => !values?.rarity || values.rarity === 'all' || c.rarity === values.rarity)
    .filter((c) => !t || [c.name, c.subject, c.effect?.name, ...(c.tags?.traits || [])].filter(Boolean).join(' ').toLowerCase().includes(t))
    .sort((a, b) => (readyIn(a) > 0) - (readyIn(b) > 0) || (b.power || 0) - (a.power || 0));
}
