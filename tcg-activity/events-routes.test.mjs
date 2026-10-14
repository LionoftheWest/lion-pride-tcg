// GET /api/events: the flag gate, the login, and ONLY public fields of scheduled and live events.
// node --test events-routes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEventsRoutes, changeText, PUBLIC_COLUMNS } from './src/events-routes.js';

const DEFS = [
  { key: 'pull_rare_mult', label: 'Rare pull odds', combine: 'multiply', max_value: 5 },
  { key: 'shop_price_mult', label: 'Shop prices', combine: 'multiply', max_value: 2 },
  { key: 'dungeon_runs_per_day', label: 'Dungeon runs a day', combine: 'max', max_value: 10 },
  { key: 'dungeon_loot_chance', label: 'Dungeon card drop chance', combine: 'max', max_value: 1 },
];
const T0 = Date.parse('2026-10-14T12:00:00Z');
const row = (o) => ({ id: 1, kind: 'modifier', title: 'Rare Week', description: 'Better odds.', starts_at: '2026-10-14T00:00:00Z', ends_at: '2026-10-16T00:00:00Z', status: 'live', theme: { name: 'Gold Rush', color: '#ffcc00' }, vars: { pull_rare_mult: 2 }, ...o });

// A fake Supabase that records the select string and applies the status filter like PostgREST would.
function setup({ rows, me = { id: '111' }, on = true } = {}) {
  const routes = {}; const app = { get: (p, h) => { routes[p] = h; } };
  const selects = []; let eventQueries = 0;
  const supabase = {
    from: (t) => ({
      select: (cols) => {
        selects.push([t, cols]);
        if (t === 'event_vars') return Promise.resolve({ data: DEFS });
        const q = { in: (col, list) => { eventQueries += 1; q.rows = rows.filter((r) => list.includes(r[col])); return q; }, order: () => q, limit: () => Promise.resolve({ data: q.rows }) };
        return q;
      },
    }),
  };
  registerEventsRoutes(app, { supabase, caller: async () => me, eventsOn: () => on, now: () => T0, artUrl: (u) => (u.startsWith('https://store.test/') ? u.replace('https://store.test/', '/api/img/') : null) });
  const get = async () => { let status = 200, json; await routes['/api/events']({}, { status(s) { status = s; return this; }, json(j) { json = j; return this; } }); return { status, json }; };
  return { get, selects, queries: () => eventQueries };
}

test('the text of a multiply variable and a max variable', () => {
  assert.equal(changeText(DEFS[0], 2), '2x rare pull odds');
  assert.equal(changeText(DEFS[1], 0.5), '0.5x shop prices');
  assert.equal(changeText(DEFS[2], 3), 'Dungeon runs a day: up to 3');
  assert.equal(changeText(DEFS[3], 0.3), 'Dungeon card drop chance: up to 30%');
});

test('flag OFF: 403 and no database call. No login: 401', async () => {
  const off = setup({ rows: [row()], on: false });
  assert.equal((await off.get()).status, 403);
  assert.equal(off.selects.length, 0);
  assert.equal((await setup({ rows: [row()], me: null }).get()).status, 401);
});

test('drafts, ended and cancelled events never appear; a past end is hidden', async () => {
  const s = setup({ rows: [row({ id: 1 }), row({ id: 2, status: 'draft' }), row({ id: 3, status: 'ended' }), row({ id: 4, status: 'cancelled' }),
    row({ id: 5, status: 'scheduled', starts_at: '2026-10-20T00:00:00Z', ends_at: '2026-10-21T00:00:00Z' }), row({ id: 6, ends_at: '2026-10-14T11:59:00Z' })] });
  const r = await s.get();
  assert.deepEqual(r.json.events.map((e) => e.id), [1, 5]);
});

test('only the public fields leave: the select names them, and admin fields in a row are dropped', async () => {
  const dirty = row({ audience: { members: ['999'] }, rewards: { per_member: { packs: 5 } }, rules: {}, created_by: 'admin1', key: 'secret_key', vars: { pull_rare_mult: 2, not_registered: 9 },
    theme: { name: 'Gold Rush', color: '#ffcc00', secret: 'x' } });
  const s = setup({ rows: [dirty] });
  const r = await s.get();
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json.events[0]).sort(), ['changes', 'description', 'ends_at', 'id', 'kind', 'starts_at', 'status', 'theme', 'title']);
  assert.deepEqual(r.json.events[0].theme, { name: 'Gold Rush', color: '#ffcc00' });
  assert.deepEqual(r.json.events[0].changes, [{ key: 'pull_rare_mult', label: 'Rare pull odds', text: '2x rare pull odds' }]);
  const cols = s.selects.find((x) => x[0] === 'events')[1];
  assert.equal(cols, PUBLIC_COLUMNS);
  for (const bad of ['audience', 'rewards', 'rules', 'created_by', 'key', '*']) assert.ok(!cols.split(/,\s*/).includes(bad), bad);
});

test('theme art: a storage URL is proxied, another host is dropped (the CSP allows only self)', async () => {
  const mk = (art) => row({ theme: { name: 'A', art } });
  const a = await setup({ rows: [mk('https://store.test/x/art.webp')] }).get();
  assert.equal(a.json.events[0].theme.art, '/api/img/x/art.webp');
  const b = await setup({ rows: [mk('https://evil.example/a.png')] }).get();
  assert.equal(b.json.events[0].theme.art, undefined);
});
