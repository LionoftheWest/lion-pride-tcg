// Card effects (boons, pranks, neutral) — the Activity side. Design:
// docs/boons-and-pranks.md. The database function play_card_effect() does every
// check and every write; these routes only verify the caller and shape the data.
//
// Flags (default OFF, fail closed):
//   FEATURE_CARD_EFFECTS=1       on for every member
//   CARD_EFFECTS_USERS=id,id     on only for these members (the preview)
// Either one also makes the collection/catalog queries read subjects.effect, so the
// card_effects.sql migration MUST be applied before either flag is set.

const ALL = process.env.FEATURE_CARD_EFFECTS === '1';
const PREVIEW = new Set((process.env.CARD_EFFECTS_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));

/** True if the schema is live (any flag set). Drives the extra columns in selects. */
export const EFFECTS_SCHEMA = ALL || PREVIEW.size > 0;
/** True if this member can see and play effects. */
export const effectsEnabledFor = (id) => ALL || PREVIEW.has(String(id));

// Effects that show once and are then used up when the target sees them.
const SHOW_ONCE = ['confetti', 'gift_wrap'];
// Effects that decorate a member's NAME wherever it shows (feed, board, pickers).
const BADGE = ['title', 'sticker', 'spotlight'];

export function registerEffectRoutes(app, { supabase, caller, rateLimit, toProxyImg }) {
  const cardArt = async (ids) => {
    const uniq = [...new Set(ids.filter(Boolean).map(Number))];
    if (!uniq.length) return new Map();
    const { data } = await supabase.from('cards').select('id, name, image_url').in('id', uniq);
    return new Map((data || []).map((c) => [c.id, { name: c.name, image_url: toProxyImg(c.image_url) }]));
  };

  // My state: cooldowns, active effects, unseen plays on me, and the tier table.
  app.get('/api/effects/me', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ enabled: false });
    const now = new Date().toISOString();
    const dayStart = `${now.slice(0, 10)}T00:00:00Z`;
    const [cds, act, inc, tiers, prims, sent, caps] = await Promise.all([
      supabase.from('card_effect_cooldowns').select('subject_id, ready_at').eq('player_id', me.id).gt('ready_at', now),
      supabase.from('player_effects').select('id, primitive, amount, duration_s, options, expires_at')
        .eq('player_id', me.id).is('consumed_at', null).or(`expires_at.is.null,expires_at.gt.${now}`),
      supabase.from('card_plays').select('id, player_id, card_id, primitive, kind, outcome, rarity, amount, duration_s, created_at, sender:players!card_plays_player_id_fkey(username)')
        .eq('target_id', me.id).is('seen_at', null).order('id', { ascending: false }).limit(10),
      supabase.from('settings').select('key, value').in('key', ['card_effect_tiers', 'card_effect_ascension', 'card_effect_cooldown_scale']),
      supabase.from('effect_primitives').select('primitive, kind, channel, max_amount, max_duration_s, enabled'),
      supabase.from('card_plays').select('id', { count: 'exact', head: true }).eq('player_id', me.id).gte('created_at', dayStart),
      supabase.from('settings').select('value').eq('key', 'card_effect_caps').maybeSingle(),
    ]);
    const err = cds.error || act.error || inc.error || prims.error;
    if (err) return res.status(500).json({ error: err.message });
    const art = await cardArt([...(act.data || []).map((e) => e.options?.card_id), ...(inc.data || []).map((p) => p.card_id)]);
    res.json({
      enabled: true,
      cooldowns: Object.fromEntries((cds.data || []).map((c) => [c.subject_id, c.ready_at])),
      active: (act.data || []).map((e) => ({ ...e, card: art.get(Number(e.options?.card_id)) || null })),
      incoming: (inc.data || []).map((p) => ({
        id: p.id, primitive: p.primitive, kind: p.kind, outcome: p.outcome, rarity: p.rarity,
        amount: p.amount, duration_s: p.duration_s, created_at: p.created_at,
        sender: p.sender?.username || 'Someone', card: art.get(Number(p.card_id)) || null,
      })),
      tiers: (tiers.data || []).find((x) => x.key === 'card_effect_tiers')?.value || null,
      ascension: (tiers.data || []).find((x) => x.key === 'card_effect_ascension')?.value || null,
      cooldownScale: Number((tiers.data || []).find((x) => x.key === 'card_effect_cooldown_scale')?.value ?? 1) || 1,
      primitives: Object.fromEntries((prims.data || []).map((p) => [p.primitive, p])),
      // The Community tab's "Plays today" (the same daily limit play_card_effect uses).
      playsToday: sent.count || 0,
      sendCap: Number(caps.data?.value?.send_per_day) || null,
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
      .eq('player_id', id).is('consumed_at', null).or(`expires_at.is.null,expires_at.gt.${now}`);
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

  // Play an owned card's effect on another member. The sender is the verified caller.
  app.post('/api/effects/play', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.status(403).json({ ok: false, error: 'effects_disabled' });
    if (!rateLimit(me.id)) return res.status(429).json({ ok: false, error: 'slow_down' });
    const cardId = Math.floor(Number(req.body?.cardId));
    const targetId = String(req.body?.targetId || '');
    if (!Number.isFinite(cardId) || !targetId) return res.status(400).json({ ok: false, error: 'bad_request' });
    const { data, error } = await supabase.rpc('play_card_effect', { p_player: me.id, p_card: cardId, p_target: targetId });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json(data);
  });

  // Name decorations for every member with an active title/sticker/spotlight.
  let badgeCache = null; // { at, badges }
  app.get('/api/effects/badges', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!effectsEnabledFor(me.id)) return res.json({ badges: {} });
    if (!badgeCache || Date.now() - badgeCache.at > 15000) {
      const now = new Date().toISOString();
      const { data, error } = await supabase.from('player_effects').select('player_id, primitive, options')
        .in('primitive', BADGE).is('consumed_at', null).or(`expires_at.is.null,expires_at.gt.${now}`);
      if (error) return res.status(500).json({ error: error.message });
      const art = await cardArt((data || []).map((e) => e.options?.card_id));
      const badges = {};
      for (const e of data || []) {
        const b = (badges[e.player_id] ||= {});
        if (e.primitive === 'title') b.title = e.options?.title || null;
        if (e.primitive === 'sticker') b.sticker = art.get(Number(e.options?.card_id))?.image_url || null;
        if (e.primitive === 'spotlight') b.spotlight = true;
      }
      badgeCache = { at: Date.now(), badges };
    }
    res.json({ badges: badgeCache.badges });
  });
}
