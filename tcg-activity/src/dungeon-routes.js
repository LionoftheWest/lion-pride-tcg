// The Dungeon Run (docs/activities/03-dungeon-run.md; design 30 approved by Nathan 2026-10-03).
// Every rule and every roll lives in SQL (tcg-bot/supabase/dungeon.sql on the shared combat core). These
// routes only call the RPCs and add the card names and art; the member always comes from the verified
// token, never from the request body, and the client never sends a result.
// Flag: dungeonOn(id) (DUNGEON_USERS = Nathan first, FEATURE_DUNGEON=1 = everyone). The database flag
// settings.dungeon.enabled is the second switch: while it is false, every RPC refuses.

const ERR = {
  disabled: 'The Dungeon is closed.', locked: 'Finish the steps to unlock the Dungeon.', already: 'You used today\'s run. A new dungeon opens tomorrow.',
  squad_size: 'Pick 5 cards.', not_owned: 'You do not own that card.', rule: 'That card breaks today\'s rule.', budget: 'Your squad is over the budget.',
  no_attacker: 'Your squad needs an attacker.', no_run: 'You have no run in progress.', not_fighting: 'There is no fight in this room.',
  not_in_squad: 'That card is not in your squad.', not_attacker: 'That card cannot attack.', downed: 'That card is down.',
  stunned: 'That card is stunned for a round.', round_cap: 'The fight ran out of rounds.', not_support: 'That card has no support move.',
  support_downed: 'That card is down.', cooldown: 'That support is not ready yet.', need_target: 'Pick a card to help.',
  bad_target: 'Pick a card in your squad.', target_downed: 'A heal cannot revive a downed card.', boss_stun_immune: 'That monster cannot be stunned again yet.',
  not_choosing: 'There is nothing to choose.', bad_pick: 'Pick one of the rewards.',
};
const fail = (res, data) => res.status(400).json({ ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' });
const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const idx = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 10 ? n : null; };

export function registerDungeonRoutes(app, { supabase, caller, rateLimit, getCatalogBase, dungeonOn }) {
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!dungeonOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    return me;
  };
  // The card details for the screen (the stats come from SQL: dungeon_view.mine, card_combat).
  const withCards = async (data) => {
    const cat = new Map((await getCatalogBase()).map((c) => [Number(c.id), c]));
    const card = (cid, extra = {}) => {
      const c = cat.get(Number(cid));
      return c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, type: c.type, tags: c.tags, ability: c.ability, ...extra } : { id: cid, ...extra };
    };
    if (Array.isArray(data.mine)) data.mine = data.mine.map((m) => card(m.id, m));
    const loot = data.run?.cards || data.cards;
    if (Array.isArray(loot)) data.loot = loot.map((x) => card(x));
    return data;
  };
  const rpc = async (res, fn, args, after) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    res.json(after ? await after(data) : data);
  };

  app.get('/api/dungeon', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    await rpc(res, 'dungeon_view', { p_player: String(me.id) }, withCards);
  });
  app.get('/api/dungeon/board', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const { data, error } = await supabase.rpc('dungeon_board', { p_day: null, p_limit: 50 });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, board: data || [], me: String(me.id) });
  });
  app.post('/api/dungeon/start', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const cards = (Array.isArray(req.body?.cards) ? req.body.cards : []).map(id).filter(Boolean).slice(0, 5);
    await rpc(res, 'dungeon_start', { p_player: String(me.id), p_cards: cards });
  });
  app.post('/api/dungeon/attack', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const card = id(req.body?.cardId); if (!card) return fail(res, { error: 'not_in_squad' });
    await rpc(res, 'dungeon_attack', { p_player: String(me.id), p_card: card, p_target: idx(req.body?.target) }, withCards);
  });
  app.post('/api/dungeon/support', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const card = id(req.body?.cardId); if (!card) return fail(res, { error: 'not_in_squad' });
    await rpc(res, 'dungeon_support', { p_player: String(me.id), p_card: card, p_target_card: id(req.body?.targetCard), p_target_foe: idx(req.body?.targetFoe) }, withCards);
  });
  app.post('/api/dungeon/choose', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'dungeon_choose', { p_player: String(me.id), p_pick: idx(req.body?.pick) ?? 0 }, withCards);
  });
  app.post('/api/dungeon/retreat', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'dungeon_retreat', { p_player: String(me.id) }, withCards);
  });
}
