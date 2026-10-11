// POST /api/feedback/:id/shot: only a real image of the declared type, never too large, at most 3 per report, only
// on the member's own report, and a rate limit per member. The SQL rules (owner, count, size) are in report_shots.sql
// and its SQL test (card-studio/scripts/test-report-shots.mjs); this fake answers like reserve_report_shot, with the
// player id that the route passes, so a route that trusted the request body would fail here.
// node --test report-shots.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerReportRoutes, sniffImage, makeShotLimiter, pruneShotsOnce } from './reports.js';

const ME = '111111111111111111', OTHER = '222222222222222222';
const MAX_BYTES = 1572864;   // balance report_shots.max_bytes in the fake

const png = (size = 64) => { const b = Buffer.alloc(size); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); return b; };
const jpeg = (size = 64) => { const b = Buffer.alloc(size); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return b; };
const webp = (size = 64) => { const b = Buffer.alloc(size); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); return b; };

function fakeSupabase() {
  const reports = new Map([[10, ME], [20, OTHER]]);   // report id -> the member who sent it
  const shots = [];                                    // { id, report_id, n, path, stored_at }
  const uploads = [], rpcs = [];
  let nextId = 1;
  return {
    shots, uploads, rpcs,
    rpc: async (fn, a) => {
      rpcs.push({ fn, a });
      if (fn !== 'reserve_report_shot') return { data: null, error: { message: 'no' } };
      if (!['image/webp', 'image/png', 'image/jpeg'].includes(a.p_mime)) return { data: { ok: false, error: 'type' } };
      if (a.p_bytes > MAX_BYTES) return { data: { ok: false, error: 'big' } };
      if (reports.get(a.p_report) !== a.p_player) return { data: { ok: false, error: 'report' } };
      const mine = shots.filter((s) => s.report_id === a.p_report);
      if (mine.length >= 3) return { data: { ok: false, error: 'full' } };
      const s = { id: nextId++, report_id: a.p_report, n: mine.length + 1, path: `${a.p_report}/${mine.length + 1}.webp`, stored_at: null };
      shots.push(s);
      return { data: { ok: true, id: s.id, n: s.n, path: s.path } };
    },
    from: () => ({
      update: (v) => ({ eq: async (_c, id) => { Object.assign(shots.find((s) => s.id === id) || {}, v); return {}; } }),
      delete: () => ({ eq: async (_c, id) => { const i = shots.findIndex((s) => s.id === id); if (i >= 0) shots.splice(i, 1); return {}; } }),
    }),
    storage: { from: (bucket) => ({ upload: async (path, buf, o) => { uploads.push({ bucket, path, bytes: buf.length, type: o.contentType }); return { error: null }; } }) },
  };
}

async function serve({ db = fakeSupabase(), limiter = makeShotLimiter({ max: 100 }) } = {}) {
  const app = express();
  app.use(express.json());
  // The verified caller: the x-test-member header stands for the Discord token. The body never names the member.
  registerReportRoutes(app, { supabase: db, caller: async (req) => (req.headers['x-test-member'] ? { id: req.headers['x-test-member'] } : null), rateLimit: () => true, on: true, shotLimit: limiter, token: '', prune: false });
  const srv = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const send = (id, body, type, member = ME, query = '') => fetch(`${base}/api/feedback/${id}/shot${query}`, { method: 'POST', headers: { 'content-type': type, ...(member ? { 'x-test-member': member } : {}) }, body });
  return { db, send, close: () => new Promise((ok) => srv.close(ok)) };
}

test('sniffImage: webp, png and jpeg by their first bytes; anything else is null', () => {
  assert.equal(sniffImage(webp()), 'image/webp');
  assert.equal(sniffImage(png()), 'image/png');
  assert.equal(sniffImage(jpeg()), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImage(Buffer.from('GIF89a......')), null);
  const riffWav = Buffer.alloc(64); riffWav.write('RIFF', 0, 'latin1'); riffWav.write('WAVE', 8, 'latin1');
  assert.equal(sniffImage(riffWav), null, 'RIFF alone is not WebP');
  assert.equal(sniffImage(Buffer.alloc(4)), null);
});

test('an image of the member\'s own report is stored at <report>/<n> in the private bucket, with its sniffed type', async () => {
  const s = await serve();
  try {
    const r = await s.send(10, webp(), 'image/webp');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, n: 1 });
    assert.deepEqual(s.db.uploads, [{ bucket: 'report-shots', path: '10/1.webp', bytes: 64, type: 'image/webp' }]);
    assert.equal(s.db.rpcs[0].a.p_player, ME, 'the member is the verified caller');
    assert.ok(s.db.shots[0].stored_at, 'stored_at is set after the upload');
  } finally { await s.close(); }
});

test('the wrong type is refused (415) and nothing is reserved or uploaded: a header that lies, a GIF, an SVG', async () => {
  const s = await serve();
  try {
    for (const [body, type] of [[png(), 'image/webp'], [Buffer.from('GIF89a' + 'x'.repeat(40)), 'image/gif'], [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'), 'image/png'], [webp(), 'text/plain']]) {
      const r = await s.send(10, body, type);
      assert.equal(r.status, 415, type);
      assert.equal((await r.json()).error, 'type');
    }
    assert.equal(s.db.rpcs.length, 0);
    assert.equal(s.db.uploads.length, 0);
  } finally { await s.close(); }
});

test('too large is refused (413): above max_bytes (SQL) and above the read limit (before SQL)', async () => {
  const s = await serve();
  try {
    const r1 = await s.send(10, webp(MAX_BYTES + 1), 'image/webp');
    assert.equal(r1.status, 413);
    const r2 = await s.send(10, webp(5 * 1024 * 1024 + 1), 'image/webp');   // 5 MB: the read limit (a fixed number here, not the import, so a raised limit fails)
    assert.equal(r2.status, 413);
    assert.equal((await r2.json()).error, 'big');
    assert.equal(s.db.rpcs.length, 1, 'the body above the read limit never reached SQL');
    assert.equal(s.db.uploads.length, 0);
    assert.equal((await s.send(10, webp(MAX_BYTES), 'image/webp')).status, 200, 'exactly max_bytes is accepted');
  } finally { await s.close(); }
});

test('the 4th image of a report is refused (409) and not uploaded', async () => {
  const s = await serve();
  try {
    for (let i = 1; i <= 3; i++) assert.equal((await s.send(10, png(), 'image/png')).status, 200, `image ${i}`);
    const r = await s.send(10, png(), 'image/png');
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'full');
    assert.equal(s.db.uploads.length, 3);
  } finally { await s.close(); }
});

test('another member\'s report is refused (404), and a member id in the body or the query changes nothing', async () => {
  const s = await serve();
  try {
    const r = await s.send(20, jpeg(), 'image/jpeg');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'report');
    assert.equal(s.db.uploads.length, 0);
    assert.equal((await s.send(20, jpeg(), 'image/jpeg', ME, '?player=' + OTHER)).status, 404);
    assert.equal((await s.send('abc', jpeg(), 'image/jpeg')).status, 404, 'a report id is a number');
    assert.equal((await s.send(20, jpeg(), 'image/jpeg', null)).status, 401, 'no token, no upload');
  } finally { await s.close(); }
});

test('a failed upload frees the place (the row is deleted), so the member can try again', async () => {
  const db = fakeSupabase();
  db.storage.from = () => ({ upload: async () => ({ error: { message: 'storage down' } }) });
  const s = await serve({ db });
  try {
    assert.equal((await s.send(10, webp(), 'image/webp')).status, 502);
    assert.equal(db.shots.length, 0);
  } finally { await s.close(); }
});

test('the rate limit per member: the 7th upload in 10 minutes is refused (429), another member is not limited', async () => {
  let t = 0;
  const s = await serve({ limiter: makeShotLimiter({ now: () => t }) });
  try {
    for (let i = 0; i < 6; i++) await s.send(20, webp(), 'image/webp');   // refused uploads count too
    assert.equal((await s.send(10, webp(), 'image/webp')).status, 429);
    assert.equal((await s.send(10, webp(), 'image/webp', OTHER)).status, 404, 'OTHER is not limited (and 10 is not theirs)');
    t = 10 * 60_000;
    assert.equal((await s.send(10, webp(), 'image/webp')).status, 200, 'after the window');
  } finally { await s.close(); }
});

test('pruneShotsOnce removes the files first, then the rows; a failed file removal keeps the rows', async () => {
  const calls = [];
  const mk = (rmErr) => ({
    rpc: async (fn, a) => { calls.push([fn, a]); return { data: [{ id: 1, path: '10/1.webp' }, { id: 2, path: '10/2.webp' }] }; },
    storage: { from: (b) => ({ remove: async (paths) => { calls.push(['remove', b, paths]); return { error: rmErr }; } }) },
    from: (t) => ({ delete: () => ({ in: async (c, ids) => { calls.push(['delete', t, ids]); return {}; } }) }),
  });
  assert.equal(await pruneShotsOnce(mk(null)), 2);
  assert.deepEqual(calls, [['report_shots_expired', { p_limit: 100 }], ['remove', 'report-shots', ['10/1.webp', '10/2.webp']], ['delete', 'player_report_shots', [1, 2]]]);
  calls.length = 0;
  assert.equal(await pruneShotsOnce(mk({ message: 'down' })), 0);
  assert.equal(calls.some((c) => c[0] === 'delete'), false);
});
