// UI-13 Achievement tracks, badges, titles and frames: the pure logic (no DOM), tested in tracks.test.js.
// The data comes from GET /api/achievements (the tracks and the tag badges: achievement_view) and
// GET /api/achievements/gallery (every title and frame: achievement_gallery). The SQL holds the rules and pays; this module
// only names, orders and words them. Tier names: D-74 (Bronze, Silver, Platinum, Diamond, Obsidian, then "Obsidian +N").
// The frame ids in the data stay 'diamond:<track>' and 'mythic:<track>' (internal keys, never shown): the label is
// "Diamond frame" and "Obsidian frame" (D-74).

import { setFrameOf } from '../achievements.js';

export const TIER_NAMES = ['Bronze', 'Silver', 'Platinum', 'Diamond', 'Obsidian'];
export const TIER_KEYS = ['bronze', 'silver', 'platinum', 'diamond', 'obsidian'];
export const SEGMENTS = [['tracks', 'Tracks'], ['badges', 'Badges'], ['titles', 'Titles'], ['frames', 'Frames']];

/** Tier n (1..5), then "Obsidian +1" for tier 6 and so on. */
export const tierName = (n) => (n <= 5 ? TIER_NAMES[Math.max(1, n) - 1] : `${TIER_NAMES[4]} +${n - 5}`);
/** The token name of tier n (bronze .. obsidian): the steps after the last tier keep the last color. */
export const tierKey = (n) => TIER_KEYS[Math.min(5, Math.max(1, n)) - 1];

/** The line icon and the one-line rule of each track (the SQL has the name; the rule text is here). */
export const TRACK_LOOK = {
  collector: { icon: 'image', desc: 'Own different cards' },
  shine: { icon: 'gem', desc: 'Own different rare cards (IR, SR, Full Art, Gold)' },
  elementalist: { icon: 'rainbow', desc: 'Own different cards with an element' },
  fullsets: { icon: 'puzzle', desc: 'Own every version of a character' },
  ascension: { icon: 'star', desc: 'Earn ascension stars on your cards' },
  trainer: { icon: 'dumbbell', desc: 'Assign stat points' },
  packs: { icon: 'package', desc: 'Open packs' },
  generous: { icon: 'hand-heart', desc: 'Gift packs and cards to members' },
  trader: { icon: 'handshake', desc: 'Complete trades' },
  market: { icon: 'landmark', desc: 'Close a Trade Hall deal or an auction' },
  wish: { icon: 'star', desc: "Give a card that is on the receiver's wishlist" },
  shards: { icon: 'hexagon', desc: 'Earn Shards' },
  shopper: { icon: 'shopping-cart', desc: 'Buy in the Shop' },
  recycler: { icon: 'recycle', desc: 'Convert duplicate copies to Shards' },
  grind: { icon: 'calendar-check', desc: 'Claim daily tasks' },
  streak: { icon: 'flame', desc: 'Check in on days in a row (best streak)' },
  raider: { icon: 'swords', desc: 'Join Hunts' },
  heavy: { icon: 'hammer', desc: 'Deal Hunt damage in total' },
  bighit: { icon: 'target', desc: 'Land one big Hunt hit' },
  slayer: { icon: 'skull', desc: 'Defeat a boss in a Hunt you joined' },
  podium: { icon: 'trophy', desc: 'Finish a Hunt in the top 3' },
  prankster: { icon: 'drama', desc: 'Play pranks' },
  vibes: { icon: 'sun', desc: 'Play boons' },
  voice: { icon: 'mic', desc: 'Days with the voice daily or the 25-message chat daily' },
};
export const trackIcon = (key) => TRACK_LOOK[key]?.icon || 'award';
export const trackDesc = (t) => TRACK_LOOK[t?.key]?.desc || '';

/** The line icon of a tag set badge (tag = "origin:smash", "type:place", ...). */
export const TAG_ICON = {
  'origin:smash': 'swords', 'origin:pokemon': 'circle', 'origin:party': 'party-popper', 'origin:minecraft': 'pickaxe', 'origin:meme': 'laugh',
  'origin:community': 'users', 'type:character': 'user', 'type:creature': 'paw-print', 'type:moment': 'hourglass', 'type:item': 'backpack', 'type:place': 'map',
};
/** The line icon of a one-time badge by its key (the old achievements that stay). */
const BADGE_ICON = { s1: 'trophy', smash20: 'swords', poke10: 'circle', party5: 'party-popper', mc5: 'pickaxe', place3: 'map', moment10: 'hourglass', item5: 'backpack',
  support10: 'shield', royal10: 'crown', beast10: 'paw-print', dup2: 'layers', dup5: 'layers' };
export const badgeIcon = (key, tag) => TAG_ICON[tag] || BADGE_ICON[key] || 'award';

// ---- Rewards: the amounts come from the balance table (GET /api/achievements `rewards` = balance achievement_rewards: { tiers: [5], step }) ----
// This module holds no amount. A missing or malformed `rewards` gives the title and the frame only (no packs, no Shards): fail closed.
const amount = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
const pick = (o) => (o && typeof o === 'object' ? { packs: amount(o.packs), shards: amount(o.shards) } : { packs: 0, shards: 0 });
const goodRewards = (r) => !!r && Array.isArray(r.tiers) && r.tiers.length === 5 && !!r.step && typeof r.step === 'object';
/** The note of a tier that an old achievement already paid (D-183): its packs were paid by that achievement, the Shards, title and frame are still paid. */
export const OLD_PAID_NOTE = 'Pack paid by an old achievement';
/** True when tier n of the track is one that an old achievement already paid (achievement_view old_paid; a missing field = 0 = none). */
export const tierOldPaid = (t, n) => n >= 1 && n <= (Number(t?.old_paid) > 0 ? Math.min(5, Math.floor(Number(t.old_paid))) : 0);
/** The reward of tier n for a track (titles = the track's 3 titles): Platinum a title, Diamond a title and a frame, Obsidian a title and a frame.  oldPaid = true: no packs (D-183). */
export function tierReward(n, titles = [], rewards = null, oldPaid = false) {
  if (n < 1) return null;
  const ok = goodRewards(rewards);
  const base = ok ? pick(n <= 5 ? rewards.tiers[n - 1] : rewards.step) : { packs: 0, shards: 0 };
  if (oldPaid) base.packs = 0;
  if (n === 3) return { ...base, title: titles[0] };
  if (n === 4) return { ...base, title: titles[1], frame: 'diamond' };
  if (n === 5) return { ...base, title: titles[2], frame: 'mythic' };
  if (n > 5) return { ...base, title: titles[2] ? `${titles[2]} +${n - 5}` : undefined };
  return base;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const frameLabel = (value) => {
  const set = setFrameOf(value);
  if (set && set.name) return `${set.name} Frame`;
  const kind = String(value || '').split(':')[0];
  return { diamond: 'Diamond frame', mythic: 'Obsidian frame', silver: 'Silver frame', gold: 'Gold frame', holo: 'Holo frame' }[kind] || 'Frame';
};
/** "2 packs + 200 Shards + "Collector"" (the track window row). */
export function rewardText(r) {
  if (!r) return '';
  return [r.packs ? plural(r.packs, 'pack') : null, r.shards ? `${r.shards} Shards` : null, r.title ? `"${r.title}"` : null, r.frame ? frameLabel(r.frame) : null].filter(Boolean).join(' + ');
}
/** "Diamond · 3 packs · 400 Shards · title · frame" (the foot of a track tile). */
export function rewardShort(n, titles = [], rewards = null, oldPaid = false) {
  const r = tierReward(n, titles, rewards, oldPaid);
  return [tierName(n), r.packs ? plural(r.packs, 'pack') : null, r.shards ? `${r.shards} Shards` : null, r.title ? 'title' : null, r.frame ? 'frame' : null].filter(Boolean).join(' · ');
}

// ---- Tracks ---------------------------------------------------------------------------------------------------------
/** The need of tier n of a track from achievement_view (null = no such tier). */
export function tierNeed(t, n) {
  if (n >= 1 && n <= 5) return t.tiers?.[n - 1] ?? null;
  return n > 5 && t.step ? t.tiers[4] + (n - 5) * t.step : null;
}
/** The tiers that can be claimed now (reached, not claimed). */
export const readyOf = (t) => Math.max(0, (t?.reached | 0) - (t?.claimed | 0));
/** The number of tiers a track shows in its window: 5, and the next step of a track that goes on. */
export const shownTiers = (t) => Math.max(5, t.step ? (t.reached | 0) + 1 : 5);
/** The state of tier n: 'claimed', 'ready' or 'locked'. */
export function tierState(t, n) {
  if (n <= (t.claimed | 0)) return 'claimed';
  return n <= (t.reached | 0) ? 'ready' : 'locked';
}
/** The tiles of the Tracks list: the tracks with a reward ready first, then the rest in the order of the SQL (a stable sort). */
export function trackOrder(tracks) {
  return tracks.map((t, i) => ({ t, i })).sort((a, b) => ((readyOf(b.t) > 0) - (readyOf(a.t) > 0)) || (a.i - b.i)).map((x) => x.t);
}
/** The goal the bar moves to: the next tier, or the last one reached when no tier is left. */
export function trackGoal(t) {
  const next = t.next ?? null;
  if (next == null) return { need: tierNeed(t, Math.max(1, t.reached | 0)) ?? 0, done: true };
  return { need: next, done: false };
}
/** The fill of a track tile bar (0..1). */
export const trackFill = (t) => { const g = trackGoal(t); return g.done ? 1 : Math.min(1, g.need > 0 ? (t.value || 0) / g.need : 0); };
/** The label on the Claim button of a track: "Claim" for one tier, "Claim 3" for three. */
export const claimLabel = (n) => (n > 1 ? `Claim ${n}` : 'Claim');
/** "43 to claim". */
export const claimLine = (n) => `${Math.max(0, n | 0)} to claim`;
/** One row of the track window. */
export function trackRows(t, rewards = null) {
  const rows = [];
  for (let n = 1; n <= shownTiers(t); n += 1) {
    rows.push({ n, name: tierName(n), key: tierKey(n), need: tierNeed(t, n), oldPaid: tierOldPaid(t, n), reward: rewardText(tierReward(n, t.titles, rewards, tierOldPaid(t, n))), state: tierState(t, n) });
  }
  return rows;
}

// ---- Badges (the tag set badges of the view, the one-time badges of the old list) ---------------------------------------
/** A tag set badge from achievement_view as a row of the Achievements list (the cards it needs come from the catalog). */
export function tagBadge(b, cards = []) {
  const [facet, value] = String(b.tag).split(':');
  const has = (c) => (facet === 'origin' ? [].concat(c.tags?.origin || []).includes(value) : c.tags?.type === value);
  const pool = cards.filter((c) => (c.season || 'Season 1') === b.season && c.rarity !== 'event' && c.in_draw_pool !== false && has(c));
  return { key: b.key, group: 'Sets', icon: '', iconName: badgeIcon(b.key, b.tag), name: b.title, desc: `Own every ${b.label} card in ${b.season} (any version)`,
    have: Math.min(b.have, b.need), need: b.need, done: b.have >= b.need, claimed: !!b.claimed, set: pool, tag: true, reward: { packs: b.packs, title: b.title } };
}
/** The reward line of a badge: "4 packs + "Pokemon Master S1" title". */
export function badgeReward(r) {
  return [r?.packs ? plural(r.packs, 'pack') : null, r?.title ? `"${r.title}" title` : null, r?.frame ? frameLabel(r.frame) : null].filter(Boolean).join(' + ');
}
/** The badge list: the tag set badges, then the one-time achievements that the tracks do not replace. Ready first, then by progress, claimed last. */
export function badgeList(tagRows, oldRows, claimedKeys, retired) {
  const old = oldRows.filter((a) => !retired.has(a.key));
  const rank = (a) => (a.done ? (a.claimed || claimedKeys.has(a.key) ? 2 : 0) : 1);
  return [...tagRows, ...old].map((a, i) => ({ a, i })).sort((x, y) => (rank(x.a) - rank(y.a)) || (rank(x.a) === 1 ? (y.a.have / y.a.need) - (x.a.have / x.a.need) : 0) || (x.i - y.i)).map((x) => x.a);
}

// ---- Titles and frames (the gallery) -----------------------------------------------------------------------------------
const trackByKey = (view) => new Map((view?.tracks || []).map((t) => [t.key, t]));
const badgeByKey = (view) => new Map((view?.badges || []).map((b) => [b.key, b]));
/**
 * The rows of the Titles list (kind 'title') or the Frames list (kind 'frame'): { id, label, desc, source, owners, mine, locked, equipped }.
 * Owned first, then the rest in the order of the gallery (a stable sort). fmt writes a count (the compact number rule 10.5).
 */
export function galleryRows(gallery, view, kind, { equipped = null, fmt = (n) => String(n) } = {}) {
  const tracks = trackByKey(view); const badges = badgeByKey(view);
  const rows = (gallery?.items || []).filter((i) => i.kind === kind).map((i, idx) => {
    const t = i.track ? tracks.get(i.track) : null;
    const b = i.badge && !t ? badges.get(i.badge) : null;
    let desc; let source;
    if (t) {
      const tn = tierName(i.tier); source = tn;
      desc = `${tn} ${t.name}: ${trackDesc(t)} (${fmt(i.need)})`;
    } else if (b) {
      source = 'Badge'; desc = `${b.title}: Own every ${b.label} card in ${b.season}`;
    } else {
      source = 'Badge'; desc = `${i.name || i.value}: ${i.how || ''}${i.retired ? ' (no longer available)' : ''}`.trim();
    }
    const label = kind === 'frame' ? frameLabel(i.value) : (i.plus ? `${i.value} +${i.plus}` : i.value);
    return { id: `${kind}:${i.value}`, value: i.value, label, desc, source, owners: i.owners | 0, mine: !!i.mine, locked: !i.mine, equipped: !!equipped && equipped === i.value, track: i.track || null, idx };
  });
  return rows.sort((a, b) => ((b.mine ? 1 : 0) - (a.mine ? 1 : 0)) || (a.idx - b.idx));
}
/** "28 of 29 members". */
export const membersLine = (owners, members) => `${owners} of ${members} members`;
