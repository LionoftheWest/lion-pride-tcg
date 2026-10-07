// Card effects (boons, pranks, neutral) — the Activity side. Design:
// docs/boons-and-pranks.md. The database function play_card_effect() does every
// check and every write; these routes only verify the caller and shape the data.
//
// Flags (default OFF, fail closed):
//   FEATURE_CARD_EFFECTS=1       on for every member
//   CARD_EFFECTS_USERS=id,id     on only for these members (the preview)
// Either one also makes the collection/catalog queries read subjects.effect, so the
// card_effects.sql migration MUST be applied before either flag is set.

import { mtDayStartISO, nextMtMidnightISO } from './src/mt-time.js';
import { selectAll } from './src/select-all.js';
const ALL = process.env.FEATURE_CARD_EFFECTS === '1';
const PREVIEW = new Set((process.env.CARD_EFFECTS_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));

/** True if the schema is live (any flag set). Drives the extra columns in selects. */
export const EFFECTS_SCHEMA = ALL || PREVIEW.size > 0;
/** True if this member can see and play effects. */
export const effectsEnabledFor = (id) => ALL || PREVIEW.has(String(id));
// Test mode (Nathan, 2026-09-28): EFFECT_TEST_USERS=id,id may try a card's effect on
// THEMSELVES. No card_plays row (so no Discord post, no ping), no cooldown, no daily
// count. Default empty = off.
const TESTERS = new Set((process.env.EFFECT_TEST_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));
const canTest = (id) => effectsEnabledFor(id) && TESTERS.has(String(id));
const TEST_MAX_S = 600; // a test effect lasts at most 10 minutes

// Effects that show once and are then used up when the target sees them.
const SHOW_ONCE = ['confetti', 'gift_wrap'];
// Effects that decorate a member's NAME wherever it shows (feed, board, pickers).
const BADGE = ['title', 'sticker', 'spotlight', 'swap_showcase', 'mustache'];
// Pranks on the target's NEXT pack reveal (effects_batch3.sql): used up when the reveal plays.
const PACK_ONCE = ['jinx', 'fake_gold', 'photobomb', 'slow_motion'];
// What Discord forbids on the server owner (effects_spread, 2026-10-03): refused on the owner before the play.
export const OWNER_FORBIDDEN = ['nickname', 'title', 'sticker', 'crown', 'body_swap', 'timeout'];

export function registerEffectRoutes(app, { supabase, caller, rateLimit, toProxyImg, getBalance }) {
  const cardArt = async (ids) => {
    const uniq = [...new Set(ids.filter(Boolean).map(Number))];
    if (!uniq.length) return new Map();
    const { data } = await supabase.from('cards').select('id, name, image_url').in('id', uniq);
    return new Map((data || []).map((c) => [c.id, { name: c.name, image_url: toProxyImg(c.image_url) }]));
  };

  const countBy = (rows, key) => { const m = {}; for (const r of rows || []) { const k = String(r[key]); m[k] = (m[k] || 0) + 1; } return m; };
  // The server owner (settings.discord_immune, written by the bot at start) is a target like anyone
  // (Nathan, 2026-10-03). Only what Discord forbids on the owner is refused, BEFORE the play (nothing is
  // spent): a nickname layer, a Name Swap, a timeout. Returns { forbidden: that effect type or null,
  // polls: true when the card is a poll card (it needs a question pick) }.
  async function playCheck(cardId, targetId) {
    const [{ data: im }, { data: card }] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'discord_immune').maybeSingle(),
      supabase.from('cards').select('subject:subjects(effect)').eq('id', cardId).maybeSingle(),
    ]);
    const eff = card?.subject?.effect;
    const owner = Array.isArray(im?.value) && im.value.map(String).includes(String(targetId));
    return { forbidden: owner && OWNER_FORBIDDEN.includes(eff?.primitive) ? eff.primitive : null, polls: Array.isArray(eff?.options?.polls) };
  }
  // The caps, the immune list and the primitives are the same for every member: read once a minute,
  // not 3 queries in every member's 30 s poll. A failed read is not kept. The tier table, the per-star
  // values, the cooldown knob (balance_table.sql) and the caps (card_effect_caps, balance_economy.sql) are balance
  // numbers: the server's one balance cache.
  let staticCache = null; // { at, p }
  const staticReads = () => {
    if (staticCache && Date.now() - staticCache.at < 60000) return staticCache.p;
    const entry = { at: Date.now(), p: null };
    entry.p = Promise.all([
      getBalance(),
      supabase.from('effect_primitives').select('primitive, kind, channel, max_amount, max_duration_s, enabled'),
      supabase.from('settings').select('value').eq('key', 'discord_immune').maybeSingle(),
    ]).then((r) => { if (r.some((x) => x.error) && staticCache === entry) staticCache = null; return r; },
      (e) => { if (staticCache === entry) staticCache = null; throw e; });
    staticCache = entry;
    return entry.p;
  };

  // My state: cooldowns, active effects, unseen plays on me, and the tier table.
  app.get('/api/effects/me', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ enabled: false });
    // The MT day play_card_effect() counts the daily limit in (launch_event_cards.sql). Midnight UTC
    // made Plays today drop to 0 at 6 PM MT (2026-10-02).
    const dayStart = mtDayStartISO();
    // Arm on open (effects_outside.sql): a screen prank that waits for me (googly eyes, upside down,
    // rubber chicken, fog) starts now that I have the game open, so it is in the read below. An error
    // (for example, the function not there yet) must not break my state: the read still runs.
    await supabase.rpc('arm_player_effects', { p_player: String(me.id) }).then(() => {}, () => {});
    const now = new Date().toISOString(); // after the arm: a prank that starts now is in the read
    const [cds, act, inc, [bal, prims, immune], sent, mine, pranks, refunds] = await Promise.all([
      supabase.from('card_effect_cooldowns').select('subject_id, ready_at').eq('player_id', me.id).gt('ready_at', now),
      supabase.from('player_effects').select('id, primitive, amount, duration_s, options, expires_at')
        .eq('player_id', me.id).is('consumed_at', null).lte('starts_at', now).or(`expires_at.is.null,expires_at.gt.${now}`),
      supabase.from('card_plays').select('id, player_id, card_id, primitive, kind, outcome, rarity, amount, duration_s, created_at, sender:players!card_plays_player_id_fkey(username)')
        .eq('target_id', me.id).is('seen_at', null).neq('outcome', 'refunded').order('id', { ascending: false }).limit(10),
      staticReads(),
      supabase.from('card_plays').select('id', { count: 'exact', head: true }).eq('player_id', me.id).gte('created_at', dayStart).neq('outcome', 'refunded'),
      // The limits made visible (Nathan, 2026-10-03): my plays on each member today (pair_per_day
      // counts aimed_at), the pranks each member got today (prank_recv_per_day), the immune members.
      selectAll(() => supabase.from('card_plays').select('id, aimed_at').eq('player_id', me.id).gte('created_at', dayStart).neq('outcome', 'refunded'), ['id']),
      selectAll(() => supabase.from('card_plays').select('id, target_id').eq('kind', 'prank').gte('created_at', dayStart).neq('outcome', 'refunded'), ['id']),
      // My refunded plays I have not seen yet (effects_spread.sql): a popup says why, and that the card is ready.
      supabase.from('card_plays').select('id, card_id, primitive, refund_reason, target:players!card_plays_target_id_fkey(username)')
        .eq('player_id', me.id).eq('outcome', 'refunded').is('refund_seen_at', null).order('id').limit(10),
    ]);
    const err = cds.error || act.error || inc.error || prims.error;
    if (err) return res.status(500).json({ error: err.message });
    const art = await cardArt([...(act.data || []).map((e) => e.options?.card_id), ...(inc.data || []).map((p) => p.card_id), ...(refunds?.data || []).map((p) => p.card_id)]);
    res.json({
      enabled: true,
      cooldowns: Object.fromEntries((cds.data || []).map((c) => [c.subject_id, c.ready_at])),
      active: (act.data || []).map((e) => ({ ...e, card: art.get(Number(e.options?.card_id)) || null })),
      incoming: (inc.data || []).map((p) => ({
        id: p.id, primitive: p.primitive, kind: p.kind, outcome: p.outcome, rarity: p.rarity,
        amount: p.amount, duration_s: p.duration_s, created_at: p.created_at,
        sender: p.sender?.username || 'Someone', card: art.get(Number(p.card_id)) || null,
      })),
      tiers: bal.effect_tiers,
      ascension: bal.effect_ascension,
      cooldownScale: Number(bal.effect_cooldown_scale),
      primitives: Object.fromEntries((prims.data || []).map((p) => [p.primitive, p])),
      // The Community tab's "Plays today" (the same daily limit play_card_effect uses).
      playsToday: sent.count || 0,
      canTest: canTest(me.id),
      sendCap: Number(bal.card_effect_caps?.send_per_day) || null,
      caps: bal.card_effect_caps || {},
      pairs: countBy(mine.data, 'aimed_at'),
      pranked: countBy(pranks.data, 'target_id'),
      immune: Array.isArray(immune.data?.value) ? immune.data.value.map(String) : [],
      refunds: (refunds?.data || []).map((p) => ({ id: p.id, primitive: p.primitive, reason: p.refund_reason, target: p.target?.username || 'that member', card: art.get(Number(p.card_id)) || null })),
      dayEnds: nextMtMidnightISO(),
    });
  });

  // The effects active on a member (the Community tab shows them under the target).
  app.get('/api/effects/on', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ active: [] });
    const id = String(req.query.id || '');
    if (!/^[\w-]{1,40}$/.test(id)) return res.status(400).json({ error: 'bad id' });
    const now = new Date().toISOString();
    const { data, error } = await supabase.from('player_effects').select('primitive, expires_at, options')
      .eq('player_id', id).is('consumed_at', null).lte('starts_at', now).or(`expires_at.is.null,expires_at.gt.${now}`);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ active: data || [] });
  });

  // The recent plays across the server (a live feed on the Community tab).
  let recentCache = null;
  app.get('/api/effects/recent', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ plays: [] });
    if (!recentCache || Date.now() - recentCache.at > 5000) {
      const { data, error } = await supabase.from('card_plays')
        .select('id, player_id, target_id, primitive, kind, outcome, created_at, sender:players!card_plays_player_id_fkey(username), target:players!card_plays_target_id_fkey(username)')
        .order('id', { ascending: false }).limit(20);
      if (error) return res.status(500).json({ error: error.message });
      recentCache = { at: Date.now(), plays: (data || []).map((p) => ({
        id: p.id, from_id: p.player_id, to_id: p.target_id, from: p.sender?.username || 'Someone', to: p.target?.username || 'Someone',
        primitive: p.primitive, kind: p.kind, outcome: p.outcome, at: p.created_at,
      })) };
    }
    res.json({ plays: recentCache.plays });
  });

  // The sender saw the popup of these refunded plays.
  app.post('/api/effects/refunds/seen', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 50);
    if (ids.length) await supabase.from('card_plays').update({ refund_seen_at: new Date().toISOString() }).eq('player_id', me.id).eq('outcome', 'refunded').in('id', ids);
    res.json({ ok: true });
  });

  // The target saw these plays: mark them, and use up the show-once effects.
  app.post('/api/effects/seen', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ ok: false });
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isFinite).slice(0, 50);
    if (ids.length) await supabase.from('card_plays').update({ seen_at: new Date().toISOString() }).eq('target_id', me.id).in('id', ids);
    await supabase.from('player_effects').update({ consumed_at: new Date().toISOString() })
      .eq('player_id', me.id).in('primitive', SHOW_ONCE).is('consumed_at', null);
    res.json({ ok: true });
  });

  // The name color boon: the target picks 1 of the 8 colors (the bot's NAME_COLORS);
  // the bot then gives the role (tcg-bot/src/discord-effects.ts). Only a pending row of mine.
  const NAME_COLORS = ['#F4B73C', '#FF5A5A', '#FF9A3C', '#5BE38A', '#4FD6F0', '#5B8CFF', '#B45AD8', '#FF7AC8'];
  app.post('/api/effects/color', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
    const color = String(req.body?.color || '').toUpperCase();
    const playId = Number(req.body?.playId);
    if (!NAME_COLORS.includes(color) || !playId) return res.status(400).json({ ok: false, error: 'bad request' });
    const { data: row } = await supabase.from('discord_effects').select('id, options').eq('play_id', playId)
      .eq('target_id', String(me.id)).eq('primitive', 'color_role').eq('status', 'pending').maybeSingle();
    if (!row) return res.json({ ok: false, error: 'not_waiting' });
    const { error } = await supabase.from('discord_effects').update({ options: { ...(row.options || {}), color }, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'pending');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, color });
  });

  // A pack prank played: the reveal used it up (one row, the oldest).
  app.post('/api/effects/used', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    const primitive = String(req.body?.primitive || '');
    if (!PACK_ONCE.includes(primitive)) return res.status(400).json({ ok: false, error: 'bad primitive' });
    const now = new Date().toISOString();
    const { data } = await supabase.from('player_effects').select('id').eq('player_id', me.id).eq('primitive', primitive)
      .is('consumed_at', null).lte('starts_at', now).order('id').limit(1).maybeSingle();
    if (data) await supabase.from('player_effects').update({ consumed_at: now }).eq('id', data.id).is('consumed_at', null);
    res.json({ ok: !!data });
  });

  // Play an owned card's effect on another member. The sender is the verified caller.
  app.post('/api/effects/play', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.status(403).json({ ok: false, error: 'effects_disabled' });
    if (!rateLimit(me.id)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const cardId = Math.floor(Number(req.body?.cardId));
    const targetId = String(req.body?.targetId || '');
    if (!Number.isFinite(cardId) || !targetId) return res.status(400).json({ ok: false, error: 'bad_request' });
    // A poll card: the index of the preset question the sender picked (play_card_effect checks it against
    // the card's list too). No index from the client (the current Play screen has no picker): question 0.
    const rawChoice = req.body?.choice;
    let choice = rawChoice == null ? null : Number(rawChoice);
    if (choice != null && !(Number.isInteger(choice) && choice >= 0 && choice < 10)) return res.status(400).json({ ok: false, error: 'bad_choice' });
    const { forbidden, polls } = await playCheck(cardId, targetId);
    if (forbidden) return res.json({ ok: false, error: 'owner_forbidden', primitive: forbidden });
    if (!polls) choice = null; else if (choice == null) choice = 0;
    const { data, error } = choice == null
      ? await supabase.rpc('play_card_effect', { p_player: me.id, p_card: cardId, p_target: targetId })
      : await supabase.rpc('play_card_effect_choice', { p_player: me.id, p_card: cardId, p_target: targetId, p_choice: choice });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json(data);
  });

  // Name decorations for every member with an active title/sticker/spotlight.
  let badgeCache = null; // { at, badges }

  // Try a card's effect on yourself (test mode). Only effects that act in the Activity;
  // a gift pack is refused (it would pay real packs), Discord/voice ones are not built.
  app.post('/api/effects/test', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!canTest(me.id)) return res.status(403).json({ ok: false, error: 'not_a_tester' });
    if (!rateLimit(me.id)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const cardId = Math.floor(Number(req.body?.cardId));
    if (!Number.isFinite(cardId)) return res.status(400).json({ ok: false, error: 'bad_request' });
    const [{ data: own }, { data: card }] = await Promise.all([
      supabase.from('player_cards').select('card_id').eq('player_id', me.id).eq('card_id', cardId).maybeSingle(),
      supabase.from('cards').select('id, subject:subjects(effect)').eq('id', cardId).maybeSingle(),
    ]);
    if (!own) return res.status(400).json({ ok: false, error: 'not_owned' });
    const eff = card?.subject?.effect;
    if (!eff?.primitive) return res.status(400).json({ ok: false, error: 'no_effect' });
    const { data: prim } = await supabase.from('effect_primitives').select('primitive, kind, channel, max_amount, max_duration_s').eq('primitive', eff.primitive).maybeSingle();
    if (!prim) return res.status(400).json({ ok: false, error: 'no_effect' });
    if (prim.channel !== 'app' || prim.primitive === 'gift_pack') return res.status(400).json({ ok: false, error: 'not_testable' });
    // Cleanse acts at once in a real play (play_card_effect removes the pranks); the
    // test does the same on the tester: every prank on them ends.
    if (prim.primitive === 'cleanse') {
      const { data: pranks } = await supabase.from('effect_primitives').select('primitive').eq('kind', 'prank');
      const { data: gone, error: cerr } = await supabase.from('player_effects').update({ consumed_at: new Date().toISOString() })
        .eq('player_id', me.id).is('consumed_at', null).in('primitive', (pranks || []).map((x) => x.primitive)).select('id');
      if (cerr) return res.status(500).json({ ok: false, error: cerr.message });
      badgeCache = null;
      return res.json({ ok: true, primitive: 'cleanse', kind: prim.kind, duration_s: null, removed: (gone || []).length });
    }
    let dur = Number(eff.base?.duration_s) || 0;
    if (prim.max_duration_s != null) dur = Math.min(dur, prim.max_duration_s);
    dur = dur > 0 ? Math.min(dur, TEST_MAX_S) : null;
    let amount = eff.base?.amount != null ? Number(eff.base.amount) : null;
    if (amount != null && prim.max_amount != null) amount = Math.min(amount, Number(prim.max_amount));
    const opts = { ...(eff.options || {}), card_id: cardId, sender_id: String(me.id), test: true };
    const titles = eff.options?.titles;
    if (Array.isArray(titles) && titles.length) opts.title = titles[Math.floor(Math.random() * titles.length)];
    // One test of each effect at a time: a new test replaces the old one.
    await supabase.from('player_effects').update({ consumed_at: new Date().toISOString() })
      .eq('player_id', me.id).eq('primitive', prim.primitive).is('consumed_at', null).eq('options->>test', 'true');
    // Show-once effects (confetti, gift wrap) play in the client at once, so their test
    // row is stored as already shown (it would otherwise wait for a real play record).
    const shownNow = SHOW_ONCE.includes(prim.primitive) ? new Date().toISOString() : null;
    const { error } = await supabase.from('player_effects').insert({
      player_id: String(me.id), primitive: prim.primitive, amount, duration_s: dur, options: opts,
      expires_at: dur ? new Date(Date.now() + dur * 1000).toISOString() : null, consumed_at: shownNow,
    });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    badgeCache = null; // the sticker / title shows at once
    res.json({ ok: true, primitive: prim.primitive, kind: prim.kind, duration_s: dur });
  });

  // End every test effect on yourself.
  app.post('/api/effects/test/clear', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!canTest(me.id)) return res.status(403).json({ ok: false, error: 'not_a_tester' });
    const { error } = await supabase.from('player_effects').update({ consumed_at: new Date().toISOString() })
      .eq('player_id', me.id).is('consumed_at', null).eq('options->>test', 'true');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    badgeCache = null;
    res.json({ ok: true });
  });
  app.get('/api/effects/badges', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ badges: {} });
    if (!badgeCache || Date.now() - badgeCache.at > 15000) {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('player_effects').select('player_id, primitive, options')
        .in('primitive', BADGE).is('consumed_at', null).lte('starts_at', now).or(`expires_at.is.null,expires_at.gt.${now}`);
      if (error) return res.status(500).json({ error: error.message });
      const art = await cardArt((data || []).map((e) => e.options?.card_id));
      const badges = {};
      for (const e of data || []) {
        const b = (badges[e.player_id] ||= {});
        if (e.primitive === 'title') b.title = e.options?.title || null;
        if (e.primitive === 'sticker') b.sticker = art.get(Number(e.options?.card_id))?.image_url || null;
        if (e.primitive === 'spotlight') b.spotlight = true;
        if (e.primitive === 'swap_showcase') b.swapShowcase = true;
        if (e.primitive === 'mustache') b.mustache = true;
      }
      badgeCache = { at: Date.now(), badges };
    }
    res.json({ badges: badgeCache.badges });
  });
}
