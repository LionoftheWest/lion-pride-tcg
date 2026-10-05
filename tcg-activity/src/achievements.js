// The 50 Season 1 achievements (Nathan, 2026-09-27: "more achievable and more unique").
// Each rule reads the merged catalog (cards with owned/quantity/ascension) and the
// profile stats from /api/profile. A rule returns { have, need, set }: `set` is the
// cards the achievement is about (the detail view shows them), or null for a stat.
// Rewards come later with the claim system; this module only measures progress.
// Pure data + functions (no DOM), so tools/check-achievements.mjs can test it.

import { cardElement } from './elements.js';

const T = (c) => c.tags || {};
const list = (v) => [].concat(v || []);
const owned = (set) => set.filter((c) => c.owned).length;

// "Own n of these cards": the set is every matching card, the goal is n of them.
const ownN = (pick, n) => (cards) => { const set = cards.filter(pick); return { have: Math.min(owned(set), n), need: n, set }; };
const stat = (key, n) => (cards, st) => ({ have: Math.min(Number(st?.[key]) || 0, n), need: n, set: null });
const el = (e) => (c) => cardElement(c.tags) === e;

function versions(cards) {
  const by = new Map();
  for (const c of cards) { const k = c.subject || c.name; if (!by.has(k)) by.set(k, []); by.get(k).push(c); }
  return [...by.values()];
}

// The pack_ledger reasons that the pack stats count (one row each, on the player's own row).
// gift_packs writes 'gift_sent' on the sender when the gift is sent (gift_claims.sql). Until
// 2026-10-03 the server counted reason 'gift', which no code writes: nobody could finish gift1.
// card-studio/scripts/test-gift-packs.mjs checks gift_packs against this table.
export const LEDGER = { opened: 'opened', giftSent: 'gift_sent' };

export const ACHIEVEMENTS = [
  // Collection size
  { key: 'first', group: 'Collection', icon: '🎴', name: 'First Pull', desc: 'Own your first card', rule: ownN(() => true, 1) },
  { key: 'own10', group: 'Collection', icon: '📦', name: 'Getting Started', desc: 'Own 10 different cards', rule: ownN(() => true, 10) },
  { key: 'own25', group: 'Collection', icon: '📚', name: 'Growing Pride', desc: 'Own 25 different cards', rule: ownN(() => true, 25) },
  { key: 'own50', group: 'Collection', icon: '🗃', name: 'Collector', desc: 'Own 50 different cards', rule: ownN(() => true, 50) },
  { key: 'own100', group: 'Collection', icon: '🏛', name: 'Archivist', desc: 'Own 100 different cards', rule: ownN(() => true, 100) },
  { key: 's1', group: 'Collection', icon: '🏆', name: 'Season 1 Complete', desc: 'Own every Season 1 base card',
    // Base (normal) cards only (Nathan, 2026-10-03): no IR, SR, Full Art, Gold or Event card.
    rule: (cards) => { const set = cards.filter((c) => (c.season || 'Season 1') === 'Season 1' && c.rarity === 'normal'); return { have: owned(set), need: set.length, set }; } },

  // Rarity
  { key: 'ir1', group: 'Rarity', icon: '🔷', name: 'First Shine', desc: 'Own an Illustrated Rare', rule: ownN((c) => c.rarity === 'illustrated_rare', 1) },
  { key: 'sr1', group: 'Rarity', icon: '🔮', name: 'Secret Found', desc: 'Own a Secret Rare', rule: ownN((c) => c.rarity === 'secret_rare', 1) },
  { key: 'fa1', group: 'Rarity', icon: '🖼', name: 'Full Frame', desc: 'Own a Full Art', rule: ownN((c) => c.rarity === 'full_art', 1) },
  { key: 'g1', group: 'Rarity', icon: '🥇', name: 'Struck Gold', desc: 'Own a Gold card', rule: ownN((c) => c.rarity === 'gold', 1) },
  { key: 'ir10', group: 'Rarity', icon: '💎', name: 'Rare Hunter', desc: 'Own 10 Illustrated Rares', rule: ownN((c) => c.rarity === 'illustrated_rare', 10) },
  { key: 'sr5', group: 'Rarity', icon: '🗝', name: 'Secret Keeper', desc: 'Own 5 Secret Rares', rule: ownN((c) => c.rarity === 'secret_rare', 5) },
  { key: 'fa5', group: 'Rarity', icon: '🌟', name: 'Full House', desc: 'Own 5 Full Arts', rule: ownN((c) => c.rarity === 'full_art', 5) },
  { key: 'g5', group: 'Rarity', icon: '👑', name: 'Golden Touch', desc: 'Own 5 Gold cards', rule: ownN((c) => c.rarity === 'gold', 5) },

  // Elements
  { key: 'fire5', group: 'Elements', icon: '🔥', name: 'Flame Keepers', desc: 'Own 5 Fire cards', rule: ownN(el('fire'), 5) },
  { key: 'light5', group: 'Elements', icon: '✨', name: 'Dawn Bringers', desc: 'Own 5 Light cards', rule: ownN(el('light'), 5) },
  { key: 'lightning5', group: 'Elements', icon: '⚡', name: 'Storm Chasers', desc: 'Own 5 Lightning cards', rule: ownN(el('lightning'), 5) },
  { key: 'nature5', group: 'Elements', icon: '🌿', name: 'Wild Growth', desc: 'Own 5 Nature cards', rule: ownN(el('nature'), 5) },
  { key: 'shadow5', group: 'Elements', icon: '🌑', name: 'Night Walkers', desc: 'Own 5 Shadow cards', rule: ownN(el('shadow'), 5) },
  { key: 'psychic5', group: 'Elements', icon: '🌀', name: 'Mind Readers', desc: 'Own 5 Psychic cards', rule: ownN(el('psychic'), 5) },
  { key: 'water5', group: 'Elements', icon: '💧', name: 'Tide Callers', desc: 'Own 5 Water cards', rule: ownN(el('water'), 5) },
  { key: 'rainbow', group: 'Elements', icon: '🌈', name: 'Rainbow Pride', desc: 'Own cards of 8 different elements',
    rule: (cards) => ({ have: Math.min(new Set(cards.filter((c) => c.owned).map((c) => cardElement(c.tags)).filter(Boolean)).size, 8), need: 8, set: null }) },

  // Games
  { key: 'smash20', group: 'Games', icon: '🥊', name: 'Smash Fan', desc: 'Own 20 Super Smash Bros cards', rule: ownN((c) => list(T(c).origin).includes('smash'), 20) },
  { key: 'poke10', group: 'Games', icon: '⚪', name: 'Pokemon Trainer', desc: 'Own 10 Pokemon cards', rule: ownN((c) => list(T(c).origin).includes('pokemon'), 10) },
  { key: 'party5', group: 'Games', icon: '🎉', name: 'Party Starter', desc: 'Own 5 Party Games cards', rule: ownN((c) => list(T(c).origin).includes('party'), 5) },
  { key: 'mc5', group: 'Games', icon: '⛏', name: 'Blockhead', desc: 'Own 5 Minecraft cards', rule: ownN((c) => list(T(c).origin).includes('minecraft'), 5) },

  // Card types + kinds
  { key: 'place3', group: 'Types', icon: '🗺', name: 'Scenic Route', desc: 'Own 3 Place cards', rule: ownN((c) => T(c).type === 'place', 3) },
  { key: 'moment10', group: 'Types', icon: '⏳', name: 'Moments in Time', desc: 'Own 10 Moment cards', rule: ownN((c) => T(c).type === 'moment', 10) },
  { key: 'item5', group: 'Types', icon: '🎒', name: 'Loot Goblin', desc: 'Own 5 Item cards', rule: ownN((c) => T(c).type === 'item', 5) },
  { key: 'support10', group: 'Types', icon: '🛡', name: 'Support Crew', desc: 'Own 10 support cards', rule: ownN((c) => T(c).class === 'support', 10) },
  { key: 'royal10', group: 'Types', icon: '🤴', name: 'Royal Court', desc: 'Own 10 Royal cards', rule: ownN((c) => list(T(c).traits).includes('royal'), 10) },
  { key: 'beast10', group: 'Types', icon: '🐾', name: 'Beast Master', desc: 'Own 10 Beast cards', rule: ownN((c) => list(T(c).traits).includes('beast'), 10) },

  // Characters (a character comes in several rarity versions)
  { key: 'fullset', group: 'Characters', icon: '🧩', name: 'Full Set', desc: 'Own every version of one character',
    rule: (cards) => {
      const multi = versions(cards).filter((v) => v.length >= 2);
      const best = multi.sort((a, b) => (owned(b) / b.length) - (owned(a) / a.length) || b.length - a.length)[0] || [];
      return { have: owned(best), need: best.length || 1, set: best };
    } },
  { key: 'double5', group: 'Characters', icon: '👯', name: 'Double Take', desc: 'Own 2 versions of 5 characters',
    rule: (cards) => ({ have: Math.min(versions(cards).filter((v) => owned(v) >= 2).length, 5), need: 5, set: null }) },

  // Copies + ascension
  { key: 'dup2', group: 'Ascension', icon: '✌', name: 'Seeing Double', desc: 'Own 2 copies of a card',
    rule: (cards) => ({ have: Math.min(Math.max(0, ...cards.map((c) => c.quantity || 0)), 2), need: 2, set: null }) },
  { key: 'dup5', group: 'Ascension', icon: '🗂', name: 'Stacked', desc: 'Own 5 copies of a card',
    rule: (cards) => ({ have: Math.min(Math.max(0, ...cards.map((c) => c.quantity || 0)), 5), need: 5, set: null }) },
  { key: 'asc1', group: 'Ascension', icon: '⭐', name: 'First Ascent', desc: 'Ascend a card to ★1',
    rule: (cards) => ({ have: Math.min(Math.max(0, ...cards.map((c) => c.ascension || 0)), 1), need: 1, set: null }) },
  { key: 'asc3', group: 'Ascension', icon: '🌠', name: 'Rising Star', desc: 'Ascend a card to ★3',
    rule: (cards) => ({ have: Math.min(Math.max(0, ...cards.map((c) => c.ascension || 0)), 3), need: 3, set: null }) },
  { key: 'asc5', group: 'Ascension', icon: '💫', name: 'Maxed Out', desc: 'Ascend a card to ★5',
    rule: (cards) => ({ have: Math.min(Math.max(0, ...cards.map((c) => c.ascension || 0)), 5), need: 5, set: null }) },

  // Packs
  { key: 'packs10', group: 'Packs', icon: '🎁', name: 'Pack Rat', desc: 'Open 10 packs', rule: stat('packsOpened', 10) },
  { key: 'gift1', group: 'Packs', icon: '💝', name: 'Generous', desc: 'Gift a pack to a member', rule: stat('packsGifted', 1) },

  // The Pride Hunt
  { key: 'hunt1', group: 'Hunt', icon: '⚔', name: 'First Blood', desc: 'Join a hunt', rule: stat('huntsJoined', 1) },
  { key: 'hunt4', group: 'Hunt', icon: '🗡', name: 'Hunt Regular', desc: 'Join 4 hunts', rule: stat('huntsJoined', 4) },
  { key: 'dmg1k', group: 'Hunt', icon: '💥', name: 'Heavy Hitter', desc: 'Deal 1,000 damage in hunts', rule: stat('totalDamage', 1000) },
  { key: 'hit500', group: 'Hunt', icon: '🎯', name: 'Big Hit', desc: 'Land a 500 damage hit', rule: stat('bestHit', 500) },
  { key: 'slay1', group: 'Hunt', icon: '🐉', name: 'Titan Slayer', desc: 'Help defeat a boss', rule: stat('bossesDefeated', 1) },
  { key: 'slay3', group: 'Hunt', icon: '💀', name: 'Boss Breaker', desc: 'Help defeat 3 bosses', rule: stat('bossesDefeated', 3) },

  // Social
  { key: 'boon1', group: 'Social', icon: '🎁', name: 'Good Vibes', desc: 'Play a boon on a member', rule: stat('boonsPlayed', 1) },
  { key: 'prank5', group: 'Social', icon: '😈', name: 'Prankster', desc: 'Play 5 pranks', rule: stat('pranksPlayed', 5) },
  { key: 'trade1', group: 'Social', icon: '🤝', name: 'Trader', desc: 'Complete a trade', rule: stat('tradesDone', 1) },
];

/** Every achievement with its progress. Nearest to done first, finished ones last. */
export function measure(cards, stats) {
  return ACHIEVEMENTS.map((a) => {
    const r = a.rule(cards, stats || {});
    return { ...a, have: r.have, need: Math.max(1, r.need), set: r.set, done: r.have >= Math.max(1, r.need) };
  }).sort((a, b) => (a.done - b.done) || (b.have / b.need - a.have / a.need));
}

// ---- Rewards (redeemed once each; the server checks completion before it pays) ----
// packs = unopened packs; title = a name tag for the profile; frame = an avatar ring.
// Easy goals give 1 pack, medium 2, hard 3-5; the hardest also unlock a title or frame.
export const FRAMES = { silver: 'Silver frame', gold: 'Gold frame', holo: 'Holo frame' };
export const REWARDS = {
  first: { packs: 1 }, own10: { packs: 1 }, own25: { packs: 2 }, own50: { packs: 2, frame: 'silver' },
  own100: { packs: 3, title: 'Archivist', frame: 'gold' }, s1: { packs: 5, title: 'Season 1 Champion', frame: 'holo' },
  ir1: { packs: 1 }, sr1: { packs: 1 }, fa1: { packs: 1 }, g1: { packs: 1 },
  ir10: { packs: 2, title: 'Rare Hunter' }, sr5: { packs: 3, title: 'Secret Keeper' }, fa5: { packs: 3, title: 'Full House' },
  g5: { packs: 3, title: 'Golden Touch', frame: 'gold' },
  fire5: { packs: 1, title: 'Flame Keeper' }, light5: { packs: 1, title: 'Dawn Bringer' }, lightning5: { packs: 1, title: 'Storm Chaser' },
  nature5: { packs: 1, title: 'Wild Child' }, shadow5: { packs: 1, title: 'Night Walker' }, psychic5: { packs: 1, title: 'Mind Reader' },
  water5: { packs: 1, title: 'Tide Caller' }, rainbow: { packs: 3, title: 'Rainbow Pride', frame: 'holo' },
  smash20: { packs: 2, title: 'Smash Fan' }, poke10: { packs: 2, title: 'Trainer' }, party5: { packs: 1, title: 'Party Starter' },
  mc5: { packs: 1, title: 'Blockhead' },
  place3: { packs: 1 }, moment10: { packs: 2, title: 'Timekeeper' }, item5: { packs: 1, title: 'Loot Goblin' },
  support10: { packs: 2, title: 'Support Crew' }, royal10: { packs: 2, title: 'Royalty' }, beast10: { packs: 2, title: 'Beast Master' },
  fullset: { packs: 3, title: 'Completionist' }, double5: { packs: 2 },
  dup2: { packs: 1 }, dup5: { packs: 2 }, asc1: { packs: 1 }, asc3: { packs: 2, frame: 'silver' }, asc5: { packs: 3, title: 'Maxed Out', frame: 'gold' },
  packs10: { packs: 1 }, gift1: { packs: 1, title: 'Generous' },
  hunt1: { packs: 1 }, hunt4: { packs: 2, title: 'Hunt Regular' }, dmg1k: { packs: 1, title: 'Heavy Hitter' }, hit500: { packs: 2, title: 'Big Hitter' },
  slay1: { packs: 2 }, slay3: { packs: 3, title: 'Boss Breaker', frame: 'silver' },
  boon1: { packs: 1 }, prank5: { packs: 2, title: 'Prankster' }, trade1: { packs: 1, title: 'Trader' },
};
export const rewardOf = (key) => REWARDS[key] || { packs: 1 };
export function rewardLabel(r) {
  return [r.packs ? `${r.packs} pack${r.packs === 1 ? '' : 's'}` : null, r.title ? `"${r.title}" title` : null, r.frame ? FRAMES[r.frame] : null].filter(Boolean).join(' + ');
}
// ---- The tiered tracks (tcg-bot/supabase/achievement_tracks.sql; Nathan, 2026-10-03) ----
// The SQL holds the rules (the tiers, the titles) and measures each track (achievement_view), so the
// server never pays a tier that is not reached. This module holds the look of each track and the
// reward table for the labels. src/achievements.test.js checks both against the SQL file.
export const TRACK_LOOK = {
  collector: { icon: '🎴', desc: 'Own different cards' },
  shine: { icon: '💎', desc: 'Own different rare cards (IR, SR, Full Art, Gold)' },
  elementalist: { icon: '🌈', desc: 'Own different cards with an element' },
  fullsets: { icon: '🧩', desc: 'Own every version of a character' },
  ascension: { icon: '⭐', desc: 'Earn ascension stars on your cards' },
  trainer: { icon: '🏋', desc: 'Assign stat points' },
  packs: { icon: '🎁', desc: 'Open packs' },
  generous: { icon: '💝', desc: 'Gift packs and cards to members' },
  trader: { icon: '🤝', desc: 'Complete trades' },
  market: { icon: '🏛', desc: 'Close a Trade Hall deal or an auction' },
  wish: { icon: '🌠', desc: 'Give a card that is on the receiver\'s wishlist' },
  shards: { icon: '🔷', desc: 'Earn Shards' },
  shopper: { icon: '🛒', desc: 'Buy in the Shop' },
  recycler: { icon: '♻', desc: 'Convert duplicate copies to Shards' },
  grind: { icon: '📅', desc: 'Redeem daily tasks' },
  streak: { icon: '🔥', desc: 'Check in on days in a row (best streak)' },
  raider: { icon: '⚔', desc: 'Join Hunts' },
  heavy: { icon: '💥', desc: 'Deal Hunt damage in total' },
  bighit: { icon: '🎯', desc: 'Land one big Hunt hit' },
  slayer: { icon: '🐉', desc: 'Defeat a boss in a Hunt you joined' },
  podium: { icon: '🏆', desc: 'Finish a Hunt in the top 3' },
  prankster: { icon: '😈', desc: 'Play pranks' },
  vibes: { icon: '🌞', desc: 'Play boons' },
  voice: { icon: '🎙', desc: 'Days with the voice daily or the 25-message chat daily' },
};
export const TIERS = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Mythic'];
/** Tier n (1 Bronze .. 5 Mythic, 6 = Mythic +1). */
export const tierName = (n) => (n <= 5 ? TIERS[n - 1] : `Mythic +${n - 5}`);
export const tierClass = (n) => (n >= 1 ? `t-${TIERS[Math.min(n, 5) - 1].toLowerCase()}` : 't-none');
/** The reward of tier n (the same for every track; = ach_tier_reward in the SQL). */
export function tierReward(n, titles = []) {
  if (n === 1) return { packs: 1, shards: 50 };
  if (n === 2) return { packs: 1, shards: 150 };
  if (n === 3) return { packs: 2, shards: 200, title: titles[0] };
  if (n === 4) return { packs: 3, shards: 400, title: titles[1], frame: 'diamond' };
  if (n === 5) return { packs: 5, shards: 800, title: titles[2], frame: 'mythic' };
  return { packs: 5, shards: 200, title: titles[2] ? `${titles[2]} +${n - 5}` : undefined };
}
/** The need of tier n for a track from achievement_view (null = no such tier). */
export function tierNeed(t, n) {
  if (n >= 1 && n <= 5) return t.tiers[n - 1];
  return n > 5 && t.step ? t.tiers[4] + (n - 5) * t.step : null;
}
/** The reward in full, no title name (a track card): "Gold · 2 packs · 200 Shards · title". */
export function tierRewardShort(n, titles = []) {
  const r = tierReward(n, titles);
  return [tierName(n), `${r.packs} pack${r.packs === 1 ? '' : 's'}`, `${r.shards} Shards`, r.title ? 'title' : null, r.frame ? 'frame' : null].filter(Boolean).join(' · ');
}
export function tierRewardLabel(r) {
  return [r.packs ? `${r.packs} pack${r.packs === 1 ? '' : 's'}` : null, r.shards ? `${r.shards} Shards` : null,
    r.title ? `"${r.title}"` : null, r.frame ? `${r.frame === 'diamond' ? 'Diamond' : 'Mythic'} frame` : null].filter(Boolean).join(' + ');
}
// The old keys that the tracks replace (= achievement_switch_map). While the tracks are on, they do
// not show and the SQL refuses them ('retired'). The other 13 stay as one-time badges.
export const RETIRED = new Set(['first', 'own10', 'own25', 'own50', 'own100', 'ir1', 'sr1', 'fa1', 'g1', 'ir10', 'sr5', 'fa5', 'g5',
  'fire5', 'light5', 'lightning5', 'nature5', 'shadow5', 'psychic5', 'water5', 'rainbow', 'fullset', 'double5', 'asc1', 'asc3', 'asc5',
  'packs10', 'gift1', 'trade1', 'hunt1', 'hunt4', 'dmg1k', 'hit500', 'slay1', 'slay3', 'boon1', 'prank5']);
// The tag set badges (ach_tag_badges): one per season and origin or type tag, made from the cards.
const TAG_ICON = { 'origin:smash': '🥊', 'origin:pokemon': '⚪', 'origin:party': '🎉', 'origin:minecraft': '⛏', 'origin:meme': '😂',
  'origin:community': '🦁', 'type:character': '🧑', 'type:creature': '🐾', 'type:moment': '⏳', 'type:item': '🎒', 'type:place': '🗺' };
export const tagIcon = (slug) => TAG_ICON[slug] || '🏷';
/** A tag badge from achievement_view as an achievement row (the cards it needs come from the catalog). */
export function tagBadge(b, cards) {
  const [facet, value] = b.tag.split(':');
  const has = (c) => (facet === 'origin' ? [].concat(c.tags?.origin || []).includes(value) : c.tags?.type === value);
  const pool = cards.filter((c) => (c.season || 'Season 1') === b.season && c.rarity !== 'event' && c.in_draw_pool !== false && has(c));
  return { key: b.key, group: 'Sets', icon: tagIcon(b.tag), name: b.title, desc: `Own every ${b.label} card in ${b.season} (any version)`,
    have: Math.min(b.have, b.need), need: b.need, done: b.have >= b.need, claimed: !!b.claimed, set: pool, tag: true, reward: { packs: b.packs, title: b.title } };
}
/** A frame value -> its look: the old 'silver' / 'gold' / 'holo', or 'diamond:<track>' / 'mythic:<track>'. */
export function frameInfo(f) {
  if (!f) return null;
  if (FRAMES[f]) return { cls: `frame-${f}`, icon: '', label: FRAMES[f] };
  const [kind, track] = String(f).split(':');
  if ((kind === 'diamond' || kind === 'mythic') && TRACK_LOOK[track]) {
    return { cls: `frame-${kind}`, icon: TRACK_LOOK[track].icon, label: `${kind === 'diamond' ? 'Diamond' : 'Mythic'} frame` };
  }
  return null;
}
