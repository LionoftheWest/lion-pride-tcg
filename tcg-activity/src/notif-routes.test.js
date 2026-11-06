// DB-MEM A3: the bell count cache. node --test src/notif-routes.test.js
// Fails if: the cache does not cut the DB reads, one member reads another's count, or the count is stale after the
// member's own write (mark read, a gift claim / bustUser, a new note), also when the write lands during a read in flight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerNotifRoutes, NOTIF_COUNT_TTL } from './notif-routes.js';

// A fake database: notes[player] = [{ read }], gifts[player] = unclaimed count. Each PostgREST read is counted.
function harness() {
  const db = { notes: {}, gifts: {} }; const calls = { notifications: 0, gift_claims: 0 }; const clock = { t: 1_000_000 };
  let gate = null; // when set, the notifications read waits for it (a read in flight)
  const q = (table) => {
    const st = { table, eq: {}, update: null };
    const chain = {
      select: () => chain, order: () => chain, is: () => chain,
      eq: (k, v) => { st.eq[k] = v; return chain; },
      update: (u) => { st.update = u; return chain; },
      limit: () => chain,
      then: (ok, bad) => run().then(ok, bad),
    };
    const run = async () => {
      const id = String(st.eq.player_id);
      if (st.update) { for (const n of db.notes[id] || []) n.read = true; return { error: null }; }
      calls[table] += 1;
      if (table === 'notifications') {
        const snap = (db.notes[id] || []).map((n) => ({ read: n.read })); // the value the read sees NOW
        if (gate) await gate;
        return { data: snap, error: null };
      }
      return { count: db.gifts[id] || 0, error: null };
    };
    return chain;
  };
  const supabase = { from: q };
  const routes = {};
  const app = { get: (p, h) => { routes[`GET ${p}`] = h; }, post: (p, h) => { routes[`POST ${p}`] = h; } };
  let who = { id: '1' };
  const api = registerNotifRoutes(app, { supabase, caller: async () => who, rateLimit: () => true, now: () => clock.t });
  const bustUser = (id) => api.bustCount(id); // server.js bustUser calls notifRoutes.bustCount
  const run = async (key) => {
    let status = 200, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
    await routes[key]({ body: {}, query: {} }, res);
    return { status, json };
  };
  const count = async () => (await run('GET /api/notifications/count')).json.unread;
  return { db, calls, clock, api, run, count, bustUser, setWho: (m) => { who = m; }, hold: () => { let open; gate = new Promise((r) => { open = r; }); return () => { gate = null; open(); }; } };
}
const reads = (h) => h.calls.notifications + h.calls.gift_claims;

test('the TTL is 5-15 s (spec A3)', () => { assert.ok(NOTIF_COUNT_TTL >= 5000 && NOTIF_COUNT_TTL <= 15000); });

test('N polls inside the TTL make 2 DB reads, not 2N (measured)', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }, { read: true }]; h.db.gifts['1'] = 1;
  const N = 20;
  for (let i = 0; i < N; i += 1) { assert.equal(await h.count(), 2); h.clock.t += 400; } // 20 polls in 8 s
  console.log(`# notif count: ${N} polls -> ${reads(h)} DB reads (uncached: ${2 * N})`);
  assert.equal(reads(h), 2);
  h.clock.t += NOTIF_COUNT_TTL; await h.count();
  assert.equal(reads(h), 4, 'after the TTL it reads again');
});

test('one member never reads the count of another', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }]; h.db.notes['2'] = [{ read: false }, { read: false }, { read: false }];
  assert.equal(await h.count(), 1); h.setWho({ id: '2' }); assert.equal(await h.count(), 3);
});

test('mark all read: the next poll shows 0 at once (not the cached value)', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }, { read: false }];
  assert.equal(await h.count(), 2);
  await h.run('POST /api/notifications/read');
  assert.equal(await h.count(), 0);
});

test('a gift claim (bustCount) and bustUser drop the count at once', async () => {
  const h = harness(); h.db.gifts['1'] = 2;
  assert.equal(await h.count(), 2);
  h.db.gifts['1'] = 1; h.api.bustCount('1'); assert.equal(await h.count(), 1, 'bustCount');
  h.db.gifts['1'] = 0; h.bustUser('1'); assert.equal(await h.count(), 0, 'bustUser');
});

test('a write during a read in flight: the old answer is not kept', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }, { read: false }];
  const release = h.hold();
  const first = h.count();                    // reads the old notes (2 unread), then waits
  await new Promise((r) => setImmediate(r));
  await h.run('POST /api/notifications/read'); // the write lands while the read is in flight
  release();
  assert.equal(await first, 2, 'the in-flight request answers what it read');
  assert.equal(await h.count(), 0, 'the next poll must not serve the old 2');
});

test('a poll after the write but before the old read ends does not join the old read', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }, { read: false }];
  const release = h.hold();
  const first = h.count();
  await new Promise((r) => setImmediate(r));
  await h.run('POST /api/notifications/read');
  const second = h.count();                    // asked while the old read still runs
  await new Promise((r) => setImmediate(r));
  release();
  assert.equal(await first, 2);
  assert.equal(await second, 0, 'the second poll reads again after the write');
});

test('single flight: parallel polls of one member share one read', async () => {
  const h = harness(); h.db.notes['1'] = [{ read: false }];
  const release = h.hold();
  const all = Array.from({ length: 5 }, () => h.count());
  await new Promise((r) => setImmediate(r));
  release();
  assert.deepEqual(await Promise.all(all), [1, 1, 1, 1, 1]);
  assert.equal(h.calls.notifications, 1);
});

test('a failed read is not kept', async () => {
  let fail = true;
  const routes = {}; const app = { get: (p, f) => { routes[p] = f; }, post: () => {} };
  const supabase = { from: () => { const c = { select: () => c, eq: () => c, order: () => c, is: () => c, limit: () => c,
    then: (ok) => Promise.resolve(fail ? { error: { message: 'down' } } : { data: [{ read: false }], count: 0, error: null }).then(ok) }; return c; } };
  registerNotifRoutes(app, { supabase, caller: async () => ({ id: '1' }), rateLimit: () => true });
  const call = async () => { let s = 200, j; await routes['/api/notifications/count']({}, { status(x) { s = x; return this; }, json(x) { j = x; return this; } }); return { s, j }; };
  assert.equal((await call()).s, 500);
  fail = false; assert.deepEqual((await call()).j, { unread: 1 });
});
