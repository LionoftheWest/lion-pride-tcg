/**
 * "A set for each tier" (src/tier-set.js, 2026-10-16): a past card of S1 gets a tier that belongs to S2 only.
 * No real database, no network: the Supabase client talks to a mock fetch, cards.json is a temp file (CARDS_FILE).
 *   node scripts/test-studio-tier-set.mjs
 * Invariants:
 *   T1 a tier with no set of its own follows the home set: every card without tier sets behaves as before
 *      (the same plan, the same row payload for insert and update, the same refusals)
 *   T2 a tier with its own set is planned, and inserted, with that set
 *   T3 a live tier is never moved to another set by a push, and a home set move does not move a tier with its own set
 *   T4 every insert / update error stops the push
 *   T5 pushCard (the real one): every set of the card exists before any upload; a live tier in another set stops it
 *      before any write
 *   T6 POST /api/details/:id/:slot stores the tier set in cards.json (and clears it for the home set), refuses an unknown
 *      set (400), a tier that is live in another set (409), an unreachable database (502); a save with no set keeps it
 *   T7 GET /api/cards reports the set of each slot; the home-set move counts the home tiers only
 */
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'tier-set-'));
const file = join(dir, 'cards.json');
const seed = () => ({
  id: 'old-card', name: 'Old Card', genre: 'Pokemon Unite', type: 'Character', set: 'S1', season: 'Season 1',
  finishes: ['normal', 'illustrated_rare'], tags: { class: 'attacker', type: 'character' },
});
const writeCards = (c) => writeFileSync(file, JSON.stringify([c], null, 2));
const readCard = () => JSON.parse(readFileSync(file, 'utf8'))[0];
writeCards(seed());
Object.assign(process.env, { CARDS_FILE: file, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-key', STUDIO_USER: '', STUDIO_PASS: '', LOCALDB: '' });

// ---- the mock PostgREST / storage (the fetch of supabase-js) -----------------------------------------------------------
const world = { sets: ['S1', 'S2'], subjects: { 'old-card': 7 }, cards: [], dbDown: false, log: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== '127.0.0.1' || u.port !== '9') return realFetch(url, init);
  const method = (init.method || 'GET').toUpperCase();
  const accept = new Headers(init.headers).get('accept') || '';
  const asObject = accept.includes('vnd.pgrst.object');
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const one = (rows) => (asObject ? (rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows', details: '', hint: '' }, 406)) : json(rows));
  const q = (name) => (u.searchParams.get(name) || '').replace(/^eq\./, '');
  world.log.push({ method, path: u.pathname, search: u.search, body: init.body ? String(init.body) : null });
  if (u.pathname.startsWith('/storage/')) return json({ message: 'ok', Key: 'x' });
  const table = u.pathname.replace('/rest/v1/', '');
  if (world.dbDown && table === 'card_sets') return json({ message: 'database down', code: 'XX000' }, 500);
  if (table === 'card_sets') return one(world.sets.filter((id) => !q('id') || id === q('id')).map((id) => ({ id, season: 1 })));
  if (table === 'subjects') {
    if (method === 'POST') return one([{ id: 7 }]);
    const id = world.subjects[q('key')];
    return one(id ? [{ id }] : []);
  }
  if (table === 'cards') {
    if (method !== 'GET') return json([], 200);
    let rows = world.cards;
    if (q('rarity')) rows = rows.filter((r) => r.rarity === q('rarity'));
    return json(rows);
  }
  return json([]);
};
const writesTo = (re) => world.log.filter((l) => l.method !== 'GET' && re.test(l.path));

process.env.ADMIN_VIEW = '0';
const { setMoveProblem, tierSetId, planTierSets, planSets, writeTierRow, checkTierSetChange, homeLiveSet } = await import('../src/tier-set.js');
const { pushCard } = await import('../src/push.js');
const { slotDetails, setSlotDetails } = await import('../src/cardstore.js');
const { app } = await import('../src/server.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  [${JSON.stringify(detail)}]`}`); };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
const live = (...pairs) => new Map(pairs.map(([rarity, set_id], i) => [rarity, { id: 100 + i, rarity, set_id }]));
const ir = (extra = {}) => ({ ...seed(), tierDetails: { illustrated_rare: { set: 'S2' } }, ...extra });

// ---- T1 no tier sets: as before ---------------------------------------------------------------------------------------
{
  const c = seed();
  check('T1 tierSetId: no own set = the home set', tierSetId(c, 'normal') === 'S1' && tierSetId(c, 'illustrated_rare') === 'S1');
  check('T1 tierSetId: a card with no set and no tier set still throws (no default)', /has no set/.test(throws(() => tierSetId({ id: 'x', name: 'X' }, 'normal')) || ''));
  const plan = planTierSets(c, c.finishes, live(['normal', 'S1'], ['illustrated_rare', 'S1']));
  check('T1 the plan: every tier in the home set, none own', plan.every((p) => p.setId === 'S1' && !p.own) && plan.length === 2, plan);
  check('T1 a live row in another set stops the push (the F-2 message)', /does not move a card between sets/.test(throws(() => planTierSets(c, c.finishes, live(['normal', 'S3']))) || ''));
  check('T1 the recorded home set move (setMoveFrom) passes for tiers that follow the home set', throws(() => planTierSets({ ...c, set: 'S2', setMoveFrom: 'S1' }, c.finishes, live(['normal', 'S1']))) === null);
  check('T1 a live row of a tier that the card no longer lists is checked too (as before)', /does not move/.test(throws(() => planTierSets(c, ['normal'], live(['gold', 'S3']))) || ''));
  check('T1 setMoveProblem keeps its old results', setMoveProblem({ name: 'P' }, 'S1', 'S2') && setMoveProblem({ name: 'P' }, 'S1', 'S1') === null && setMoveProblem({ name: 'P' }, null, 'S2') === null);
  check('T1 planSets: only the home set', JSON.stringify(planSets(plan, 'S1')) === '["S1"]', planSets(plan, 'S1'));
}

// ---- T2 a tier with its own set -----------------------------------------------------------------------------------------
{
  const c = ir();
  check('T2 tierSetId: the own set wins, the other tier follows the home set', tierSetId(c, 'illustrated_rare') === 'S2' && tierSetId(c, 'normal') === 'S1');
  check('T2 a bad own set id throws', /bad set id/.test(throws(() => tierSetId({ ...c, tierDetails: { illustrated_rare: { set: 's2' } } }, 'illustrated_rare')) || ''));
  const plan = planTierSets(c, c.finishes, live(['normal', 'S1']));
  const p = Object.fromEntries(plan.map((x) => [x.rarity, x]));
  check('T2 the plan: normal in S1, the NEW illustrated_rare in S2 (own)', p.normal.setId === 'S1' && p.illustrated_rare.setId === 'S2' && p.illustrated_rare.own === true, plan);
  check('T2 planSets lists both sets (each must exist)', JSON.stringify(planSets(plan, 'S1')) === '["S1","S2"]', planSets(plan, 'S1'));
  check('T2 a tier set equal to the home set is not "own"', planTierSets({ ...c, tierDetails: { illustrated_rare: { set: 'S1' } } }, c.finishes, live())[1].own === false);
  check('T2 slotDetails reports the tier set as tierSet (and no `set` key that could replace the home set)', slotDetails(c, 'illustrated_rare').tierSet === 'S2' && slotDetails(c, 'normal').tierSet === null && !('set' in slotDetails(c, 'illustrated_rare')));
}

// ---- T3 a live tier is never moved --------------------------------------------------------------------------------------
{
  const c = ir();
  check('T3 live in S2 and the tier says S2: passes', throws(() => planTierSets(c, c.finishes, live(['normal', 'S1'], ['illustrated_rare', 'S2']))) === null);
  const why = throws(() => planTierSets(c, c.finishes, live(['normal', 'S1'], ['illustrated_rare', 'S1'])));
  check('T3 a tier live in S1 is not moved to S2 by a push (the message names the tier)', /illustrated_rare tier of "Old Card" is in set S1.*says S2.*does not move a tier/.test(why || ''), why);
  const c2 = { ...c, set: 'S3', setMoveFrom: 'S1' };
  check('T3 a recorded home set move does NOT unlock a tier with its own set', /does not move a tier/.test(throws(() => planTierSets(c2, c2.finishes, live(['illustrated_rare', 'S1']))) || ''));
  check('T3 the same home move still passes for the home tiers', throws(() => planTierSets(c2, ['normal'], live(['normal', 'S1']))) === null);
  check('T3 homeLiveSet: the live set of the HOME tiers only', homeLiveSet(c, [{ rarity: 'illustrated_rare', set_id: 'S2' }, { rarity: 'normal', set_id: 'S1' }]) === 'S1' && homeLiveSet(c, [{ rarity: 'illustrated_rare', set_id: 'S2' }]) === null);
}

// ---- T1/T2/T4 the row writes ---------------------------------------------------------------------------------------------
function mockCards({ insertErr = null, updateErr = null } = {}) {
  const calls = [];
  return { calls, db: { from: (t) => ({
    insert: async (row) => { calls.push(['insert', t, row]); return { error: insertErr }; },
    update: (row) => ({ eq: async (col, val) => { calls.push(['update', t, row, col, val]); return { error: updateErr }; } }),
  }) } };
}
{
  // the payload of the code before this change, for a card with no tier sets
  const fields = { name: 'Old Card', lore: 'l', artist_credit: null, set_id: 'S1', event: null, image_url: 'u', in_draw_pool: true, tradeable: true, source: 'draw' };
  let m = mockCards();
  await writeTierRow({ db: m.db, existing: null, subjectId: 7, rarity: 'normal', fields });
  check('T1 snapshot: a new home tier is inserted with the old payload', JSON.stringify(m.calls) === JSON.stringify([['insert', 'cards', { subject_id: 7, rarity: 'normal', ...fields }]]), m.calls);
  m = mockCards();
  await writeTierRow({ db: m.db, existing: { id: 101 }, subjectId: 7, rarity: 'normal', fields });
  check('T1 snapshot: an existing tier is updated by its row id with the old payload', JSON.stringify(m.calls) === JSON.stringify([['update', 'cards', fields, 'id', 101]]), m.calls);
  m = mockCards();
  await writeTierRow({ db: m.db, existing: null, subjectId: 7, rarity: 'illustrated_rare', fields: { ...fields, set_id: 'S2' } });
  check('T2 a NEW tier in another set is inserted with that set and the subject', m.calls.length === 1 && m.calls[0][0] === 'insert' && m.calls[0][2].set_id === 'S2' && m.calls[0][2].subject_id === 7 && m.calls[0][2].rarity === 'illustrated_rare', m.calls);
  m = mockCards({ insertErr: { message: 'duplicate key' } });
  const e1 = await writeTierRow({ db: m.db, existing: null, subjectId: 7, rarity: 'illustrated_rare', fields }).then(() => null, (e) => e.message);
  check('T4 an insert error stops the push, with the tier named', e1 === 'card illustrated_rare: duplicate key', e1);
  m = mockCards({ updateErr: { message: 'rls' } });
  const e2 = await writeTierRow({ db: m.db, existing: { id: 5 }, subjectId: 7, rarity: 'normal', fields }).then(() => null, (e) => e.message);
  check('T4 an update error stops the push, with the tier named', e2 === 'card normal: rls', e2);
}

// ---- T5 the real pushCard ---------------------------------------------------------------------------------------------------
{
  const run = (card) => pushCard(card, () => null, dir, null).then(() => null, (e) => e.message);
  world.log.length = 0; world.sets = ['S1', 'S2']; world.cards = [{ id: 1, rarity: 'normal', set_id: 'S1' }, { id: 2, rarity: 'illustrated_rare', set_id: 'S1' }];
  let msg = await run({ ...ir(), finishes: ['normal', 'illustrated_rare'] });
  check('T5 a tier live in S1 whose tier says S2: the push stops, no write to cards, no upload', /illustrated_rare tier of "Old Card" is in set S1/.test(msg || '') && writesTo(/\/rest\/v1\/cards/).length === 0 && writesTo(/\/storage\/v1\/object/).length === 0, { msg, log: world.log.map((l) => `${l.method} ${l.path}`) });
  world.log.length = 0; world.sets = ['S1'];
  msg = await run({ ...ir(), finishes: ['normal', 'illustrated_rare'] });
  check('T5 the tier set does not exist in card_sets: the push stops before any upload', /set S2 does not exist/.test(msg || '') && writesTo(/\/storage\//).length === 0 && writesTo(/\/rest\/v1\/(cards|subjects)/).length === 0, { msg, log: world.log.map((l) => `${l.method} ${l.path}`) });
  world.log.length = 0; world.sets = ['S1', 'S2'];
  msg = await run({ ...seed(), finishes: ['normal'], tierDetails: { normal: { set: 'S9' } } });
  check('T5 a tier set with no row in card_sets (S9) names that set', /set S9 does not exist/.test(msg || ''), msg);
  world.log.length = 0; world.cards = [{ id: 1, rarity: 'normal', set_id: 'S3' }];
  msg = await run({ ...seed(), finishes: ['normal'] });
  check('T5/T1 a card with no tier set: a live row in another set still stops the push before any write', /does not move a card between sets/.test(msg || '') && writesTo(/\/rest\/v1\/cards/).length === 0, msg);
}

// ---- T6 / T7 the studio routes ------------------------------------------------------------------------------------------------
const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}`;
const call = (method, path, body) => new Promise((res, rej) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request(base + path, { method, headers: { 'content-type': 'application/json' } }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, json: b ? JSON.parse(b) : null })); });
  req.on('error', rej); if (data) req.write(data); req.end();
});
const post = (set, extra = {}) => call('POST', '/api/details/old-card/illustrated_rare', { ...(set === undefined ? {} : { set }), ...extra });
{
  world.sets = ['S1', 'S2']; world.cards = []; world.dbDown = false; writeCards(seed());
  let r = await post('S2');
  check('T6 the save route stores the tier set in cards.json', r.status === 200 && r.json.ok && r.json.details.tierSet === 'S2' && readCard().tierDetails?.illustrated_rare?.set === 'S2', { r, c: readCard() });
  r = await post(undefined, { lore: 'a new text' });
  check('T6 a save with no set keeps the tier set, and saves the text', readCard().tierDetails.illustrated_rare.set === 'S2' && readCard().tierDetails.illustrated_rare.lore === 'a new text', readCard());
  r = await call('GET', '/api/cards');
  const c = r.json && r.json[0];
  check('T7 GET /api/cards: each slot reports its set (the own set, else the home set)', c && c.slots.find((s) => s.slot === 'illustrated_rare').set === 'S2' && c.slots.find((s) => s.slot === 'normal').set === 'S1' && c.set === 'S1', c && c.slots.map((s) => [s.slot, s.set]));
  r = await post('S1');
  check('T6 the home set clears the tier set (the key is removed from cards.json)', r.json.ok && r.json.details.tierSet === null && !('set' in readCard().tierDetails.illustrated_rare) && readCard().tierDetails.illustrated_rare.lore === 'a new text', readCard());
  await post('S2');
  r = await post('');
  check('T6 an empty set clears the tier set too', r.json.ok && !('set' in readCard().tierDetails.illustrated_rare), readCard());
  const before = JSON.stringify(readCard());
  r = await post('S9');
  check('T6 an unknown set is refused (400), nothing is saved', r.status === 400 && /No set S9/.test(r.json.error) && JSON.stringify(readCard()) === before, r);
  r = await post('s2');
  check('T6 a bad set id is refused (400)', r.status === 400 && JSON.stringify(readCard()) === before, r);
  world.cards = [{ id: 2, rarity: 'illustrated_rare', set_id: 'S1' }];
  r = await post('S2');
  check('T6 a tier that is live in S1 is not set to S2 (409), nothing is saved', r.status === 409 && /live in set S1/.test(r.json.error) && JSON.stringify(readCard()) === before, r);
  world.cards = []; world.dbDown = true;
  r = await post('S2');
  check('T6 the game database does not answer: 502, nothing is saved', r.status === 502 && JSON.stringify(readCard()) === before, r);
  world.dbDown = false;
  // the home set move: the tier with its own set does not count as the live home set
  writeCards(ir({ finishes: ['normal', 'illustrated_rare'] }));
  world.cards = [{ id: 2, rarity: 'illustrated_rare', set_id: 'S2' }];
  world.log.length = 0;
  r = await call('PUT', '/api/cards/old-card/set', { set: 'S3' });
  world.sets = ['S1', 'S2', 'S3'];
  r = await call('PUT', '/api/cards/old-card/set', { set: 'S3' });
  check('T7 "Change home set": a live tier of another set is not the live home set (no setMoveFrom)', r.json.ok && r.json.liveSet === null && !readCard().setMoveFrom, r);
  world.cards = [{ id: 1, rarity: 'normal', set_id: 'S1' }, { id: 2, rarity: 'illustrated_rare', set_id: 'S2' }];
  r = await call('PUT', '/api/cards/old-card/set', { set: 'S2' });
  check('T7 "Change home set": the live home tier decides (S1), not the tier in S2', r.json.ok && r.json.liveSet === 'S1' && readCard().setMoveFrom === 'S1', r);
}
srv.close();

// the module level: setSlotDetails with undefined removes the key from the file
{
  writeCards(ir());
  setSlotDetails('old-card', 'illustrated_rare', { set: undefined });
  check('T6 setSlotDetails with set undefined removes the key from the file', !('set' in readCard().tierDetails.illustrated_rare), readCard());
}

globalThis.fetch = realFetch;
console.log(`\n${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${pass}/${pass + fail} pass, FAILS ${fail}`);
process.exit(fail ? 1 : 0);
