// The Gauntlet v2 routes for testers (R1c; plan 20.15 R1, Nathan 2026-11-03: Combat v2 testable on his tester account).
// Every rule and every roll lives in SQL (the R1b functions gauntlet_v2_view / _act / _auto / _choose / _retreat on the
// R1a engine). These routes only check the member, call one function, and add display data (the catalog name and art
// of the squad cards, the status / role / mechanic texts). No combat number is in this file (C3).
// The member always comes from the verified token (caller), never from the body or the query.
// The gate: combat_v2_on('gauntlet', member) (the tester list in SQL), else D4: a run that started in v2 finishes in v2.
// The start stays POST /api/gauntlet/start (dungeon-routes.js): gauntlet_start builds a v2 run only for a tester.
// No v1 route changes: this module registers only paths under /api/gauntlet/v2 and changes no shared object.

import { AUTO_MAX } from './dungeon-routes.js';

// A request bound, not a combat number: the SQL ends the call at the fight end or at v2_dungeon.round_cap first (R1a).
// It only stops a broken state from looping for ever inside one HTTP call.
export const FINISH_MAX = 1000;

export const ERR = {
  disabled: 'The Gauntlet is closed.', no_run: 'You have no run in progress.', not_fighting: 'There is no fight in this room.',
  bad_state: 'This fight cannot go on. Tell an admin.', bad_choice: 'That move is not possible now.', bad_max: 'Auto failed.',
  not_choosing: 'There is nothing to choose.', bad_pick: 'Pick one of the rewards.',
  not_between_floors: 'You can leave only between floors, after the guardian.', not_tester: 'Combat v2 is for testers only.',
};
// A refused answer: HTTP 400 with the message; every key of the answer (detail) stays.
const fail = (res, data) => res.status(400).json({ ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' });
const posId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// The idx rule of dungeon-routes.js (a list position 0..9).
const idx = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 10 ? n : null; };
// The Auto clamp of dungeon-routes.js (/api/dungeon/auto): 1..AUTO_MAX, a missing or bad number gives AUTO_MAX.
const autoMax = (v) => Math.min(AUTO_MAX, Math.max(1, Math.floor(Number(v)) || AUTO_MAX));
// The body word for the action -> the engine choice.use (combat_v2_step, combat_v2_gauntlet_builders.sql:102: a boolean;
// combat_v2_card_act, combat_v2_abilities.sql:1533-1552: true = the active, false = the basic attack).
const USE = { active: true, basic: false };

// The choice of a card turn: ONLY use, target and ally (D6: the clock picks the card, so no actor). The engine shapes:
// target {side: enemy, id} (combat_v2_abilities.sql:1545), ally {side: card, id} (:44-45). The SQL checks every value again.
export function choiceOf(body) {
  const b = body && typeof body === 'object' ? body : {};
  const c = { use: Object.hasOwn(USE, b.use) ? USE[b.use] : null };
  const t = idx(b.target); if (t !== null) c.target = { side: 'enemy', id: t };
  const a = posId(b.ally); if (a !== null) c.ally = { side: 'card', id: a };
  return c;
}

// A small time cache with the get(key, load) shape of ttl-cache.js, for a server with no sharedCache.
const timeCache = (ttl) => {
  const m = new Map();
  return { async get(k, load) { const e = m.get(k); if (e && Date.now() - e.at < ttl) return e.v; const v = await load(); m.set(k, { at: Date.now(), v }); return v; } };
};
const pick = (rows, keys) => (rows || []).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));

export function registerGauntletV2Routes(app, { supabase, caller, rateLimit, getCatalogBase, dungeonOn, sharedCache }) {
  // The tester bit of each member, 60 s: a removal from the list takes effect in at most 60 s (D4 covers a running run).
  const testers = sharedCache ? sharedCache('gauntletV2Tester', { ttl: 60000 }) : timeCache(60000);
  // The texts of the fight screen: the same for everyone, 5 minutes.
  const refs = sharedCache ? sharedCache('gauntletV2Ref', { ttl: 300000 }) : timeCache(300000);

  // In order: 401, 403 off, 429 (a write), the tester list, else D4 (the member's active run is a v2 run), else 403 not_tester.
  // Answer { player, view } (view: the gauntlet_v2_view answer of the D4 check, kept for a GET) or null (the answer is sent).
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!dungeonOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    const player = String(me.id);
    let on;
    try {
      on = await testers.get(player, async () => {
        const { data, error } = await supabase.rpc('combat_v2_on', { p_mode: 'gauntlet', p_player: player });
        if (error) throw new Error(error.message);
        return data === true;
      });
    } catch (e) { res.status(500).json({ error: e.message }); return null; }
    if (on) return { player, view: null };
    const { data, error } = await supabase.rpc('gauntlet_v2_view', { p_player: player });
    if (error) { res.status(500).json({ error: error.message }); return null; }
    if (data?.ok && data.active_mode === 'gauntlet_v2') return { player, view: data };
    res.status(403).json({ ok: false, error: 'not_tester', message: ERR.not_tester });
    return null;
  };

  // The catalog name and art of each squad card (the withCards pattern of dungeon-routes.js). Display only.
  const withCards = async (data) => {
    const squad = data?.state?.squad || data?.run?.state?.squad;
    if (!Array.isArray(squad)) return data;
    const cat = new Map((await getCatalogBase()).map((c) => [Number(c.id), c]));
    data.cards = Object.fromEntries(squad.map((x) => {
      const c = cat.get(Number(x));
      return [x, c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, type: c.type } : { id: x }];
    }));
    return data;
  };
  // The texts: the status rule templates ({leaf} is filled by the screen with status_lines[].amounts), the roles, the mechanics.
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

  app.get('/api/gauntlet/v2', async (req, res) => {
    const g = await gate(req, res); if (!g) return;
    let data = g.view;
    if (!data) {
      const r = await supabase.rpc('gauntlet_v2_view', { p_player: g.player });
      if (r.error) return res.status(500).json({ error: r.error.message });
      data = r.data;
    }
    if (!data?.ok) return fail(res, data);
    try { data.ref = await refs.get('ref', loadRef); } catch (e) { return res.status(500).json({ error: e.message }); }
    res.json(await withCards(data));
  });
  app.post('/api/gauntlet/v2/act', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'gauntlet_v2_act', { p_player: g.player, p_choice: choiceOf(req.body) }, withCards);
  });
  app.post('/api/gauntlet/v2/auto', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'gauntlet_v2_auto', { p_player: g.player, p_max: autoMax(req.body?.max) }, withCards);
  });
  // Finish Room: Auto to the end of the fight (the SQL stops at the end or at the round cap; FINISH_MAX is only the request bound).
  app.post('/api/gauntlet/v2/finish', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'gauntlet_v2_auto', { p_player: g.player, p_max: FINISH_MAX }, withCards);
  });
  app.post('/api/gauntlet/v2/choose', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'gauntlet_v2_choose', { p_player: g.player, p_pick: idx(req.body?.pick) }, withCards);
  });
  app.post('/api/gauntlet/v2/retreat', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'gauntlet_v2_retreat', { p_player: g.player });
  });
}
