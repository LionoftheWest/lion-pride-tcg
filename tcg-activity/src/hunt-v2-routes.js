// The Hunt v2 practice routes for testers (R3b; plan 20.20 R3, pipeline item R3 SPEC v3 section 3.4; Nathan QH1-QH5, 2026-11-03).
// A tester fights a PRIVATE v2 copy of the live boss (hunt_v2_days). Every rule and every roll lives in SQL (combat_v2_hunt_practice.sql:
// hunt_v2_view / _start / _act / _auto). These routes only check the member, call one function, and add display data (the catalog name and
// art of the squad cards, the status / role / mechanic texts) and the run shape of the R1e fight view (UI-52). No combat number is in this
// file (C3). The member always comes from the verified token (caller), never from the body or the query.
// No boss lock: the practice never locks the hunts row, so these routes do not use huntRpcGate (R3 SPEC 3.4).
// The gate: ONE hunt_v2_view call; its tester bit, else D4 (an active practice day of today plays on). A non-tester gets 403 not_tester and
// no other RPC call (G6). No v1 route changes: this module registers only paths under /api/hunt/v2 and changes no shared object.

// A request bound, not a combat number: the SQL ends the call at the fight end or at v2_hunt.round_cap first.
export const AUTO_MAX = 1000;

export const ERR = {
  off: 'The Hunt is closed.', not_tester: 'Combat v2 is for testers only.', no_hunt: 'There is no Hunt now.',
  no_v2_boss: 'This boss has no v2 practice yet.', already: 'You practiced today. Come back tomorrow.',
  squad_size: 'Pick 1 to the card limit, each card once.', not_owned: 'You do not own that card.', no_v2: 'A card has no v2 ability yet.',
  no_day: 'You have no practice today.', not_fighting: 'Your practice of today ended.', hunt_over: 'The Hunt ended.',
  v1_today: 'You already played in the old fight today.',
  bad_state: 'This fight cannot go on. Tell an admin.', bad_choice: 'That move is not possible now.', bad_max: 'Auto failed.',
  busy: 'The Hunt is busy. Try again.',
};
// The retry rule (ON SPEC v6 3.4, r5 L-2): a start, act or auto that Postgres aborted in a lock cycle (40P01 deadlock, 40001 serialization:
// only around the one defeat call of a Hunt) runs once more; a second abort answers busy (409). The call was one transaction: nothing was kept.
export const RETRY_CODES = new Set(['40P01', '40001']);
// The label of the practice (R3 SPEC 3.4 "New fields"): no reward, no board.
export const LABEL = 'Practice (v2 test): no rewards';

// HUNT-V2-POSTS: not_fighting on a LIVE day (hunt_v2_view day.live, the row mark) is not a practice. The round limit (ended_by cap) names
// the cap of the SQL (balance v2_hunt.round_cap, the value combat_v2_advance reads; null when the balance is not loaded: no number).
// A practice day keeps ERR.not_fighting.
export function notFightingText(day, endedBy, cap) {
  if (day?.live !== true) return ERR.not_fighting;
  if ((endedBy ?? day?.ended_by) !== 'cap') return 'Your Hunt for today is over.';
  const n = Number(cap);
  return Number.isInteger(n) && n > 0 ? `Round limit reached (${n}). Your Hunt for today is over.` : 'Round limit reached. Your Hunt for today is over.';
}
// A refused answer: HTTP 400 with the message; every key of the answer (detail, cards, card) stays.
const fail = (res, data, msg) => res.status(400).json({ ...data, ok: false, message: msg || ERR[data?.error] || data?.error || 'failed' });
const posId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const idx = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < 10 ? n : null; };
const autoMax = (v) => Math.min(AUTO_MAX, Math.max(1, Math.floor(Number(v)) || 1));
const USE = { active: true, basic: false };

// The choice of a card turn: ONLY use, target and ally (D6: the clock picks the card). The engine shapes: target {side: enemy, id},
// ally {side: card, id}. The SQL checks every value again.
export function choiceOf(body) {
  const b = body && typeof body === 'object' ? body : {};
  const c = { use: Object.hasOwn(USE, b.use) ? USE[b.use] : null };
  const t = idx(b.target); if (t !== null) c.target = { side: 'enemy', id: t };
  const a = posId(b.ally); if (a !== null) c.ally = { side: 'card', id: a };
  return c;
}
// The own pick: a list of card ids (the SQL checks the size, duplicates and ownership); no list = the auto-pick (null). A bad entry stays
// as null, so the SQL answers squad_size (R3 SPEC 3.2 item 3) and never plays a shorter squad (review r1 L-3).
export function cardsOf(body) {
  const c = body && typeof body === 'object' ? body.cards : undefined;
  if (!Array.isArray(c)) return null;
  return c.slice(0, 50).map((x) => posId(x));
}

const timeCache = (ttl) => {
  const m = new Map();
  return { async get(k, load) { const e = m.get(k); if (e && Date.now() - e.at < ttl) return e.v; const v = await load(); m.set(k, { at: Date.now(), v }); return v; } };
};
const pick = (rows, keys) => (rows || []).map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));

/** The run shape of the R1e view (UI-52 reads run.state.fight / info / squad): built from the practice answer; no number changes. */
export function asRun(data) {
  if (!data || !data.fight) return data;
  const squad = data.day?.squad || data.fight?.squad || [];
  return { ...data, label: LABEL, mode: 'hunt_v2',
    run: { status: data.status ?? data.day?.status ?? null, ended_by: data.ended_by ?? data.day?.ended_by ?? null,
      state: { engine: 2, squad, fight: data.fight, info: data.info, units: data.units, phase: (data.status ?? data.day?.status) === 'active' ? 'fight' : 'over' } } };
}

export function registerHuntV2Routes(app, { supabase, caller, rateLimit, getCatalogBase, huntOn, sharedCache, roundCap = () => null }) {
  const refs = sharedCache ? sharedCache('huntV2Ref', { ttl: 300000 }) : timeCache(300000);

  // In order: 401, 403 off, 429 (a write), then ONE hunt_v2_view call: a tester, or D4 (an active practice day). Else 403 not_tester.
  // Answer { player, view } or null (the answer is sent).
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!huntOn()) { res.status(403).json({ ok: false, error: 'off', message: ERR.off }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    const player = String(me.id);
    const { data, error } = await supabase.rpc('hunt_v2_view', { p_player: player });
    if (error) { res.status(500).json({ error: error.message }); return null; }
    if (data?.ok && (data.tester === true || data.day?.status === 'active')) return { player, view: data };
    if (data?.ok && data.live === true) return { player, view: data };   // ON-UI: the flag ON = everyone (hunt_v2_view.live, R3-ON)
    res.status(403).json({ ok: false, error: 'not_tester', message: ERR.not_tester });
    return null;
  };

  const withCards = async (data) => {
    const squad = data?.run?.state?.squad || data?.day?.squad;
    if (!Array.isArray(squad)) return data;
    const cat = new Map((await getCatalogBase()).map((c) => [Number(c.id), c]));
    data.cards = Object.fromEntries(squad.map((x) => {
      const c = cat.get(Number(x));
      return [x, c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, type: c.type } : { id: x }];
    }));
    return data;
  };
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
  const show = async (data) => {
    const d = asRun({ ...data, label: LABEL });
    d.ref = await refs.get('ref', loadRef);
    return withCards(d);
  };
  const rpc = async (res, fn, args, view) => {
    let r = await supabase.rpc(fn, args);
    if (r.error && RETRY_CODES.has(r.error.code)) r = await supabase.rpc(fn, args);
    const { data, error } = r;
    if (error && RETRY_CODES.has(error.code)) return res.status(409).json({ ok: false, error: 'busy', message: ERR.busy });
    if (error) return res.status(500).json({ error: error.message });
    if (data?.ok === false && data.error === 'v1_today') return res.status(409).json({ ...data, message: ERR.v1_today });
    if (!data?.ok) return fail(res, data, data?.error === 'not_fighting' ? notFightingText(view?.day, data.ended_by, roundCap()) : null);
    try { res.json(await show(data)); } catch (e) { res.status(500).json({ error: e.message }); }
  };

  app.get('/api/hunt/v2/view', async (req, res) => {
    const g = await gate(req, res); if (!g) return;
    try { res.json(await show(g.view)); } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/api/hunt/v2/start', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'hunt_v2_start', { p_player: g.player, p_cards: cardsOf(req.body) });
  });
  app.post('/api/hunt/v2/act', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'hunt_v2_act', { p_player: g.player, p_choice: choiceOf(req.body) }, g.view);
  });
  app.post('/api/hunt/v2/auto', async (req, res) => {
    const g = await gate(req, res, true); if (!g) return;
    await rpc(res, 'hunt_v2_auto', { p_player: g.player, p_max: autoMax(req.body?.max) }, g.view);
  });
}
