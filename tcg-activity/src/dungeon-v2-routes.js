// The Dungeon v2 routes for testers (R2b; R2 SPEC v3 3.4, plan 20.19; Nathan 2026-11-03: "built to test behind a flag on my account").
// Every rule and every roll lives in SQL (the R2a functions dungeon_v2_view / _start / _act / _auto / _choose / _retreat,
// combat_v2_dungeon_run.sql). These routes only check the member, call one function, and add display data (the catalog name and art
// of the squad cards, the status / role / mechanic texts of the R1e fight view). No combat number is in this file (C3).
// The member always comes from the verified token (caller), never from the body or the query.
// The gate: dungeon_v2_view(member).tester (combat_v2_on('dungeon', member) in SQL), else D4: the member's active v2 run of today
// finishes in v2. A non-tester gets 403 not_tester after ONE dungeon_v2_view call and no other call (R2 G6).
// No v1 route changes: this module registers only paths under /api/dungeon/v2 and changes no shared object. The v2 run lives in its
// own table (dungeon_v2_runs), so no v1 route, board or "is playing" post sees it (R2 INV-3); these routes do not call onRun.

import { AUTO_MAX } from './dungeon-routes.js';
import { choiceOf, FINISH_MAX } from './gauntlet-v2-routes.js';

export const ERR = {
  disabled: 'The Dungeon is closed.', locked: 'Finish the steps to unlock the Dungeon.', not_tester: 'Combat v2 is for testers only.',
  already: 'You used today\'s v2 test run.', squad_size: 'Pick 5 cards.', not_owned: 'You do not own that card.',
  rule: 'That card breaks today\'s rule.', no_attacker: 'Your squad needs an attacker.', budget: 'Your squad is over the budget.',
  no_v2: 'A card in your squad has no v2 active yet.', no_run: 'You have no run in progress.', not_fighting: 'There is no fight in this room.',
  bad_state: 'This fight cannot go on. Tell an admin.', bad_choice: 'That move is not possible now.', bad_max: 'Auto failed.',
  not_choosing: 'There is nothing to choose.', bad_pick: 'Pick one of the rewards.',
  not_between_floors: 'You can leave only between floors, after the guardian.',
};
// A refused answer: HTTP 400 with the message; every key of the answer (detail, cards, need, cost, budget) stays.
const fail = (res, data) => res.status(400).json({ ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' });
const posId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// The idx rule of dungeon-routes.js (a list position 0..9).
const idx = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 10 ? n : null; };
// The Auto clamp of dungeon-routes.js (/api/dungeon/auto): 1..AUTO_MAX, a missing or bad number gives AUTO_MAX.
const autoMax = (v) => Math.min(AUTO_MAX, Math.max(1, Math.floor(Number(v)) || AUTO_MAX));
// The squad of the start: the card ids of the body, the v1 rule of POST /api/dungeon/start (at most 5 positive integers; the SQL checks the size).
export const cardsOf = (body) => (Array.isArray(body?.cards) ? body.cards : []).map(posId).filter(Boolean).slice(0, 5);

// A small time cache with the get(key, load) shape of ttl-cache.js, for a server with no sharedCache.
const timeCache = (ttl) => {
  const m = new Map();
  return { async get(k, load) { const e = m.get(k); if (e && Date.now() - e.at < ttl) return e.v; const v = await load(); m.set(k, { at: Date.now(), v }); return v; } };
};
const pick = (rows, keys) => (rows || []).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));

export function registerDungeonV2Routes(app, { supabase, caller, rateLimit, getCatalogBase, dungeonOn, sharedCache }) {
  // The tester bit of each member, 60 s (only a true bit is kept: a non-tester always gets exactly one view call). A removal from the
  // list takes effect in at most 60 s; dungeon_v2_start reads the list again, and D4 covers a running run.
  const testers = new Map();
  const isTester = (p) => { const t = testers.get(p); return !!t && Date.now() - t < 60000; };
  // The texts of the fight screen: the same for everyone, 5 minutes.
  const refs = sharedCache ? sharedCache('dungeonV2Ref', { ttl: 300000 }) : timeCache(300000);

  // In order: 401, 403 off, 429 (a write), the tester bit, else dungeon_v2_view: tester -> go on; an active v2 run (D4, not for the start)
  // -> go on; else 403 not_tester. Answer { player, view } (view: the dungeon_v2_view answer, kept for the GET) or null (the answer is sent).
  const gate = async (req, res, { write = false, start = false } = {}) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!dungeonOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    const player = String(me.id);
    if (isTester(player)) return { player, view: null };
    const { data, error } = await supabase.rpc('dungeon_v2_view', { p_player: player });
    if (error) { res.status(500).json({ error: error.message }); return null; }
    if (!data?.ok) { fail(res, data); return null; }
    if (data.tester === true) { testers.set(player, Date.now()); return { player, view: data }; }
    if (data.live === true) return { player, view: data };   // ON-UI: combat v2 for everyone (the view flag live; ON SPEC 3.5)
    if (!start && data.run?.status === 'active') return { player, view: data };
    res.status(403).json({ ok: false, error: 'not_tester', message: ERR.not_tester });
    return null;
  };

  // The catalog name and art of each squad card (the withCards pattern of dungeon-routes.js). Display only.
  // Also each loot card of the run state (banked, at risk, this floor, lost, the chest card), so the chest and the
  // floor screens can show the card face (a member report 2026-11-07: the chest loot never showed).
  const withCards = async (data) => {
    const st = data?.state?.squad ? data.state : data?.run?.state;
    const squad = st?.squad;
    if (!Array.isArray(squad)) return data;
    const loot = [...(st.bank?.cards || []), ...(st.pend?.cards || []), ...(st.floor_loot?.cards || []), ...(st.lost?.cards || []), st.chest?.card]
      .filter((x) => x != null && !squad.some((s) => Number(s) === Number(x)));
    const cat = new Map((await getCatalogBase()).map((c) => [Number(c.id), c]));
    data.cards = Object.fromEntries([...squad, ...new Set(loot.map(Number))].map((x) => {
      const c = cat.get(Number(x));
      return [x, c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, type: c.type } : { id: x }];
    }));
    return data;
  };
  // The texts (R1c 3.1 item 5): the status rule templates ({leaf} is filled by the screen with status_lines[].amounts), the roles, the mechanics.
  const loadRef = async () => {
    const read = async (table, keys) => {
      const { data, error } = await supabase.from(table).select(keys.join(',')).order('ord');
      if (error) throw new Error(error.message);
      return pick(data, keys);
    };
    const [statuses, roles, mechanics] = await Promise.all([
      read('statuses', ['key', 'label', 'icon', 'family', 'negative', 'rule']),
      read('roles', ['key', 'class', 'label']),
      read('enemy_mechanics', ['key', 'label']),
    ]);
    return { statuses, roles, mechanics };
  };

  const rpc = async (res, fn, args, after) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    res.json(after ? await after(data) : data);
  };

  app.get('/api/dungeon/v2/view', async (req, res) => {
    const g = await gate(req, res); if (!g) return;
    let data = g.view;
    if (!data) {
      const r = await supabase.rpc('dungeon_v2_view', { p_player: g.player });
      if (r.error) return res.status(500).json({ error: r.error.message });
      data = r.data;
    }
    if (!data?.ok) return fail(res, data);
    try { data.ref = await refs.get('ref', loadRef); } catch (e) { return res.status(500).json({ error: e.message }); }
    res.json(await withCards(data));
  });
  app.post('/api/dungeon/v2/start', async (req, res) => {
    const g = await gate(req, res, { write: true, start: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_start', { p_player: g.player, p_cards: cardsOf(req.body) }, withCards);
  });
  app.post('/api/dungeon/v2/act', async (req, res) => {
    const g = await gate(req, res, { write: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_act', { p_player: g.player, p_choice: choiceOf(req.body) }, withCards);
  });
  app.post('/api/dungeon/v2/auto', async (req, res) => {
    const g = await gate(req, res, { write: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_auto', { p_player: g.player, p_max: autoMax(req.body?.max) }, withCards);
  });
  // Finish Room of the R1e view (H.base + '/finish'): Auto to the end of the fight (the SQL stops at the end or at the round cap;
  // FINISH_MAX is only the request bound of R1c).
  app.post('/api/dungeon/v2/finish', async (req, res) => {
    const g = await gate(req, res, { write: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_auto', { p_player: g.player, p_max: FINISH_MAX }, withCards);
  });
  app.post('/api/dungeon/v2/choose', async (req, res) => {
    const g = await gate(req, res, { write: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_choose', { p_player: g.player, p_pick: idx(req.body?.pick) }, withCards);
  });
  app.post('/api/dungeon/v2/retreat', async (req, res) => {
    const g = await gate(req, res, { write: true }); if (!g) return;
    await rpc(res, 'dungeon_v2_retreat', { p_player: g.player });
  });
}
