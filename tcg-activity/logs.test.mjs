// The app logs (logs.js): each write is throttled, allow-listed, and never sent with the flag off or in LOADTEST.
// node --test logs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createLogs, platformOf, clientInfo, newTutorialSteps, registerLogRoutes, SESSION_EVERY_MS, VIEW_EVERY_MS } from './logs.js';

// A fake Supabase that records each call.
function fakeDb() {
  const calls = [];
  return {
    calls,
    rpc: (fn, args) => { calls.push({ rpc: fn, args }); return Promise.resolve({ data: 1, error: null }); },
    from: (table) => ({
      insert: (row) => { calls.push({ table, op: 'insert', row }); return Promise.resolve({ error: null }); },
      upsert: (row, opt) => { calls.push({ table, op: 'upsert', row, opt }); return Promise.resolve({ error: null }); },
    }),
  };
}
const clock = (t = 1_000_000) => { const c = { t, now: () => c.t }; return c; };

test('platformOf: the Discord desktop app, a phone, a browser', () => {
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36'), 'desktop');
  assert.equal(platformOf('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36'), 'mobile');
  assert.equal(platformOf('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'), 'mobile');
  assert.equal(platformOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'), 'web');
  assert.equal(platformOf(''), 'unknown');
});

test('clientInfo: the user agent is cut to 200; only allow-listed hints, and only when asked', () => {
  const req = { headers: { 'user-agent': 'x'.repeat(500) }, query: { platform: 'mobile', w: '393', h: '700', evil: '1' } };
  assert.deepEqual(clientInfo(req), { platform: 'web', ua: 'x'.repeat(200) });
  assert.deepEqual(clientInfo(req, { hints: true }), { platform: 'web', ua: 'x'.repeat(200), sdk_platform: 'mobile', w: 393, h: 700 });
  const bad = { headers: {}, query: { platform: '<script>', w: '-1', h: 'abc' } };
  assert.deepEqual(clientInfo(bad, { hints: true }), { platform: 'unknown', ua: '' });
});

test('session: one write per member per 5 minutes; force writes at once; the client is built only when sent', () => {
  const db = fakeDb(), c = clock();
  const logs = createLogs({ supabase: db, on: true, now: c.now });
  let built = 0;
  const client = () => { built += 1; return { platform: 'desktop' }; };
  assert.equal(logs.session('111', client), true);
  assert.equal(logs.session('111', client), false);
  assert.equal(logs.session('222', client), true, 'another member is not throttled by the first');
  c.t += SESSION_EVERY_MS - 1;
  assert.equal(logs.session('111', client), false);
  c.t += 1;
  assert.equal(logs.session('111', client), true);
  assert.equal(logs.session('111', { platform: 'mobile' }, { force: true }), true);
  assert.equal(built, 3, 'a throttled call builds no client info');
  assert.deepEqual(db.calls.map((x) => [x.rpc, x.args.p_player]), [['app_session_touch', '111'], ['app_session_touch', '222'], ['app_session_touch', '111'], ['app_session_touch', '111']]);
  assert.deepEqual(db.calls[0].args.p_client, { platform: 'desktop' });
});

test('flag off, or LOADTEST: nothing is written', () => {
  for (const opt of [{ on: false }, { on: true, loadtest: true }]) {
    const db = fakeDb();
    const logs = createLogs({ supabase: db, ...opt });
    assert.equal(logs.on, false);
    logs.session('1', {}, { force: true }); logs.view('1', 'shop'); logs.tutorialStep('1', 'open');
    assert.equal(db.calls.length, 0, JSON.stringify(opt));
  }
});

test('view: one row per member, view and ref per 10 minutes; a bad view name is refused', () => {
  const db = fakeDb(), c = clock();
  const logs = createLogs({ supabase: db, on: true, now: c.now });
  assert.equal(logs.view('1', 'shop'), true);
  assert.equal(logs.view('1', 'shop'), false);
  assert.equal(logs.view('1', 'hall'), true);
  assert.equal(logs.view('1', 'auction', 5), true);
  assert.equal(logs.view('1', 'auction', 6), true, 'another auction is another row');
  assert.equal(logs.view('2', 'shop'), true);
  assert.equal(logs.view('1', 'Shop; drop'), false);
  c.t += VIEW_EVERY_MS;
  assert.equal(logs.view('1', 'shop'), true);
  assert.deepEqual(db.calls.map((x) => [x.table, x.row.player_id, x.row.view, x.row.ref]), [
    ['page_views', '1', 'shop', null], ['page_views', '1', 'hall', null], ['page_views', '1', 'auction', '5'],
    ['page_views', '1', 'auction', '6'], ['page_views', '2', 'shop', null], ['page_views', '1', 'shop', null]]);
});

test('the throttle maps stay bounded', () => {
  const db = fakeDb(), c = clock();
  const logs = createLogs({ supabase: db, on: true, now: c.now, maxKeys: 50 });
  for (let i = 0; i < 500; i++) logs.view(String(i), 'shop');
  assert.equal(db.calls.length, 500);
  // Bounded: the oldest keys are dropped, so a member past the bound may log again (more rows, never fewer).
  assert.equal(logs.view('499', 'shop'), false, 'the newest key is still throttled');
});

test('tutorialStep: an upsert that keeps the first time (ignoreDuplicates)', () => {
  const db = fakeDb();
  createLogs({ supabase: db, on: true }).tutorialStep('1', 'open');
  assert.deepEqual(db.calls[0], { table: 'tutorial_steps', op: 'upsert', row: { player_id: '1', step: 'open' }, opt: { onConflict: 'player_id,step', ignoreDuplicates: true } });
});

test('newTutorialSteps: only the new steps of one call', () => {
  assert.deepEqual(newTutorialSteps({ done: ['gifts'] }, { done: ['gifts', 'open'] }, 'step'), ['open']);
  assert.deepEqual(newTutorialSteps({ done: ['open'] }, { done: ['open'] }, 'step'), []);
  assert.deepEqual(newTutorialSteps({}, { seen: ['hall'] }, 'seen'), ['seen:hall']);
  assert.deepEqual(newTutorialSteps({}, { skipped: true }, 'skip'), ['skipped']);
  assert.deepEqual(newTutorialSteps({ skipped: true }, { skipped: true }, 'skip'), []);
  assert.deepEqual(newTutorialSteps({ done: ['open'] }, { done: [], skipped: false }, 'replay'), ['replay']);
});

// The routes, on a real Express app with a fake caller.
async function withApp(fn, { on = true } = {}) {
  const db = fakeDb();
  const logs = createLogs({ supabase: db, on });
  const app = express();
  app.use(express.json());
  const caller = async (req) => (req.headers.authorization === 'Bearer good' ? { id: '42' } : null);
  registerLogRoutes(app, { caller, rateLimit: () => true, logs });
  app.get('/api/shop', (req, res) => res.json({ ok: true }));
  app.get('/api/hall', (req, res) => res.status(500).json({ error: 'x' }));
  app.get('/api/profile', (req, res) => res.json({ ok: true }));
  app.get('/api/hunt', (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, auth = 'good') => fetch(base + p, { headers: { authorization: `Bearer ${auth}` } }).then((r) => r.status);
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try { await fn({ db, get, post }); } finally { server.close(); }
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('routes: a 200 answer of a view route writes a row; an error, another route or no member writes none', async () => {
  await withApp(async ({ db, get }) => {
    assert.equal(await get('/api/shop'), 200);
    assert.equal(await get('/api/hall'), 500);
    assert.equal(await get('/api/hunt'), 200);
    assert.equal(await get('/api/shop', 'bad'), 200);
    await get('/api/profile'); await get('/api/profile?id=42'); // the own profile: not a view
    await get('/api/profile?id=777777777777777777');
    await settle();
    assert.deepEqual(db.calls.map((x) => [x.row.view, x.row.ref]), [['shop', null], ['member_profile', '777777777777777777']]);
  });
});

test('routes: POST /api/view takes only the allow-listed screens', async () => {
  await withApp(async ({ db, post }) => {
    assert.deepEqual(await post('/api/view', { view: 'collection' }), { status: 200, body: { ok: true, logged: true } });
    assert.deepEqual(await post('/api/view', { view: 'collection' }), { status: 200, body: { ok: true, logged: false } });
    assert.equal((await post('/api/view', { view: 'admin' })).status, 400);
    assert.equal((await post('/api/view', { view: 'hunt', ref: 'x<y>"z' })).status, 200);
    await settle();
    assert.deepEqual(db.calls.map((x) => [x.row.view, x.row.ref]), [['collection', null], ['hunt', 'xyz']]);
  });
});

test('routes: with the flag off, a view route writes nothing and POST /api/view writes nothing', async () => {
  await withApp(async ({ db, get, post }) => {
    await get('/api/shop');
    assert.equal((await post('/api/view', { view: 'home' })).body.logged, false);
    await settle();
    assert.equal(db.calls.length, 0);
  }, { on: false });
});
