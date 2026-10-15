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
  one_support: 'One support per turn. Attack to end the turn.', not_between_floors: 'You can leave only between floors, after the guardian.',
  can_act: 'You can still act: the turn does not pass.', already_gauntlet: 'You used today\'s Gauntlet run. Come back tomorrow.',
};
const fail = (res, data) => res.status(400).json({ ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' });
const id = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// The run mode: the daily Dungeon or the weekly Gauntlet (gauntlet.sql). Each action finds the run of its mode.
const mode = (v) => (v === 'gauntlet' ? 'gauntlet' : 'daily');
// The most rounds one Auto call plays (the SQL function clamps to 10 as well).
export const AUTO_MAX = 5;
const idx = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 10 ? n : null; };

// A view that ended its day / week (next_at, ends_at in the past) is never served again, whatever its age.
// An error or refused answer is never served from the cache either.
export const viewValid = (v, now = Date.now()) => v?.status === 200 && !((v?.body?.next_at && Date.parse(v.body.next_at) <= now) || (v?.body?.ends_at && Date.parse(v.body.ends_at) <= now));

export function registerDungeonRoutes(app, { supabase, caller, rateLimit, getCatalogBase, dungeonOn, onRun, userCache, sharedCache }) {
  // The two boards are the same for every member: one read for everyone, 5 s (a rank changes only when a run moves). A new run
  // and a retreat drop them at once. (The member's own rank is in the cached per-member view, which a write also drops.)
  const boards = sharedCache ? sharedCache('dungeonBoards', { ttl: 5000, stale: true }) : null;
  const board = (key, fn, args) => {
    const load = async () => { const { data, error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message); return data || []; };
    return boards ? boards.get(key, load) : load();
  };
  // The two views (dungeon_view 187 ms, gauntlet_view 286 ms live, each reads the whole collection through card_combat) are read
  // on every Home visit and every Dungeon open. One answer per member for 15 s; every write of the member drops it (the answer
  // of the write itself carries the new state), so a member always sees the result of their own action.
  const views = userCache ? userCache({ ttl: 15000, valid: viewValid }) : null;
  const dropViews = (me) => { for (const k of ['d', 'dl', 'g']) views?.bust(`${k}:${me.id}`); };
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!dungeonOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    // A run action: tell the "is playing" post which mode the member is in, so its floor stays current (server.js dungeonPing).
    if (write) {
      onRun?.(me, req.path.startsWith('/api/gauntlet') || req.body?.mode === 'gauntlet' ? 'gauntlet' : 'daily');
      dropViews(me); res.on('finish', () => { dropViews(me); if (req.path.endsWith('/start') || req.path.endsWith('/retreat')) { boards?.bust('d'); boards?.bust('g'); } });
    }
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
    if (Array.isArray(data.squad)) data.squad = data.squad.map((m) => card(m.id, m));   // the Gauntlet's squad of the week
    const loot = data.run?.cards || data.cards;
    if (Array.isArray(loot)) data.loot = loot.map((x) => card(x));
    // The loot in the run state (banked, at risk, this floor, the chest): the card details by id.
    const st = data.run?.state || data.state;
    if (st) {
      const ids = [...(st.bank?.cards || []), ...(st.pend?.cards || []), ...(st.floor_loot?.cards || []), ...(st.lost?.cards || []), st.chest?.card].filter(Boolean).map(Number);
      data.lootCards = Object.fromEntries([...new Set(ids)].map((x) => [x, card(x)]));
    }
    return data;
  };
  const rpc = async (res, fn, args, after) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    res.json(after ? await after(data) : data);
  };

  // One cached view: { status, body } of the answer (an error answer is cached too, for the same 15 s).
  const cachedView = async (res, key, fn, args) => {
    const load = async () => {
      let { data, error } = await supabase.rpc(fn, args);
      // The lite view (perf_dungeon_view.sql) is not live yet (code before the migration): the full view, whose answer has the same keys plus 'mine'.
      if (error?.code === 'PGRST202' && fn === 'dungeon_view_lite') ({ data, error } = await supabase.rpc('dungeon_view', args));
      if (error) return { status: 500, body: { error: error.message } };
      if (!data?.ok) return { status: 400, body: { ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' } };
      return { status: 200, body: await withCards(data) };
    };
    const v = views ? await views.get(key, load) : await load();
    res.status(v.status).json(v.body);
  };
  app.get('/api/dungeon', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    // ?lite=1: the Home slide (no collection, 3 ms instead of 13 ms on the local copy; the lobby and the squad pick read the full view).
    const lite = !!req.query?.lite;
    await cachedView(res, `${lite ? 'dl' : 'd'}:${me.id}`, lite ? 'dungeon_view_lite' : 'dungeon_view', { p_player: String(me.id) });
  });
  app.get('/api/dungeon/board', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    try { res.json({ ok: true, board: await board('d', 'dungeon_board', { p_day: null, p_limit: 50 }), me: String(me.id) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/dungeon/start', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const cards = (Array.isArray(req.body?.cards) ? req.body.cards : []).map(id).filter(Boolean).slice(0, 5);
    await rpc(res, 'dungeon_start', { p_player: String(me.id), p_cards: cards });
  });
  app.post('/api/dungeon/attack', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const card = id(req.body?.cardId); if (!card) return fail(res, { error: 'not_in_squad' });
    await rpc(res, 'dungeon_attack', { p_player: String(me.id), p_card: card, p_target: idx(req.body?.target), p_mode: mode(req.body?.mode) }, withCards);
  });
  app.post('/api/dungeon/support', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const card = id(req.body?.cardId); if (!card) return fail(res, { error: 'not_in_squad' });
    await rpc(res, 'dungeon_support', { p_player: String(me.id), p_card: card, p_target_card: id(req.body?.targetCard), p_target_foe: idx(req.body?.targetFoe), p_mode: mode(req.body?.mode) }, withCards);
  });
  // Auto on the server (dungeon_auto_rounds.sql): up to 5 rounds (a useful support, then the best attack) in one call. Every action is a call of
  // dungeon_support / dungeon_attack, so every rule is the one of a tap. The answer lists the rounds for the client to animate in order.
  app.post('/api/dungeon/auto', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const max = Math.min(AUTO_MAX, Math.max(1, Math.floor(Number(req.body?.max)) || AUTO_MAX));
    const { data, error } = await supabase.rpc('dungeon_auto_rounds', { p_player: String(me.id), p_mode: mode(req.body?.mode), p_max: max });
    // The code before the migration: the client falls back to one request for each action (it reads error auto_unavailable).
    if (error?.code === 'PGRST202') return res.status(404).json({ ok: false, error: 'auto_unavailable', message: 'Auto is not available.' });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    if (data.error) data.error = { ...data.error, message: ERR[data.error.error] || data.error.error };   // a refused action that ended the call after some rounds
    res.json(await withCards(data));
  });
  // Finish room (dungeon_finish_room.sql, D-200 / D-201): the whole fight of the room in ONE call, every round in the answer in order (the client replays them
  // fast, with Skip). The rules are the Auto rules (it calls dungeon_auto_rounds again and again). The member comes from the token, the rate limit is the one of Auto.
  app.post('/api/dungeon/finish', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const { data, error } = await supabase.rpc('dungeon_finish_room', { p_player: String(me.id), p_mode: mode(req.body?.mode) });
    // The code before the migration: the client keeps playing the room action by action (it reads error finish_unavailable).
    if (error?.code === 'PGRST202') return res.status(404).json({ ok: false, error: 'finish_unavailable', message: 'Finish room is not available.' });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    if (data.error) data.error = { ...data.error, message: ERR[data.error.error] || data.error.error };
    res.json(await withCards(data));
  });
  // D-182: no action can be taken (every standing attacker stunned, no support ready): the round advances and the monsters act once (dungeon_pass_turn).
  app.post('/api/dungeon/pass', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'dungeon_pass_turn', { p_player: String(me.id), p_mode: mode(req.body?.mode) }, withCards);
  });
  app.post('/api/dungeon/choose', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'dungeon_choose', { p_player: String(me.id), p_pick: idx(req.body?.pick) ?? 0, p_mode: mode(req.body?.mode) }, withCards);
  });
  app.post('/api/dungeon/retreat', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'dungeon_retreat', { p_player: String(me.id), p_mode: mode(req.body?.mode) }, withCards);
  });

  // The Gauntlet (gauntlet.sql): the week's squad for everyone; the fight, rewards and retreat use the routes
  // above with mode 'gauntlet'. The database flag settings.gauntlet.enabled is the second switch.
  app.get('/api/gauntlet', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    await cachedView(res, `g:${me.id}`, 'gauntlet_view', { p_player: String(me.id) });
  });
  app.get('/api/gauntlet/board', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    try { res.json({ ok: true, board: await board('g', 'gauntlet_board', { p_week: null, p_limit: 50 }), me: String(me.id) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/gauntlet/start', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    await rpc(res, 'gauntlet_start', { p_player: String(me.id) });
  });
}
