// node --test src/route-timing.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteTiming } from './route-timing.js';

const fire = (rt, clock, { method = 'GET', route, status = 200, ms }) => {
  const fin = []; const req = { method, route: route === undefined ? undefined : { path: route }, url: '/api/profile?id=777' };
  rt.middleware(req, { statusCode: status, on: (e, f) => fin.push(f) }, () => {});
  clock.t += ms; fin.forEach((f) => f());
};

test('p50, p95 and max per route pattern; the busiest route first', () => {
  const clock = { t: 0 }; const rt = createRouteTiming({ now: () => clock.t });
  for (let i = 1; i <= 100; i++) fire(rt, clock, { route: '/api/hunt', ms: i });
  fire(rt, clock, { route: '/api/flags', ms: 7, status: 500 });
  const r = rt.report();
  assert.equal(r[0].route, 'GET /api/hunt'); assert.equal(r[0].n, 100);
  assert.equal(r[0].p50, 51); assert.equal(r[0].p95, 96); assert.equal(r[0].max, 100);
  assert.equal(r[1].errors, 1);
  assert.deepEqual(rt.report(), [], 'a report starts a new window');
});
test('no member data: the key is the route pattern, a static file is not counted', () => {
  const clock = { t: 0 }; const lines = []; const rt = createRouteTiming({ now: () => clock.t, log: (l) => lines.push(l) });
  fire(rt, clock, { route: '/api/profile', ms: 5 }); fire(rt, clock, { route: undefined, ms: 5 }); fire(rt, clock, { route: /^\/api\/img\/(.+)/, ms: 3 });
  rt.flush();
  const text = lines.join('\n');
  assert.ok(!/777|Bearer|lt:/.test(text), text); assert.match(text, /GET \/api\/profile n=1/); assert.equal(lines.filter((l) => l.includes(' n=')).length, 2);
});
test('flush prints nothing in an empty window; the extra line is appended', () => {
  const lines = []; const rt = createRouteTiming({ log: (l) => lines.push(l), extra: () => 'caches boards hit=3' });
  rt.flush(); assert.equal(lines.length, 0);
  rt.record('GET /x', 1, 200); rt.flush(); assert.ok(lines.some((l) => l.endsWith('caches boards hit=3')));
});
test('memory stays bounded: only `cap` durations are kept per route', () => {
  const rt = createRouteTiming({ cap: 10 }); for (let i = 0; i < 1000; i++) rt.record('GET /x', i, 200);
  const r = rt.report()[0]; assert.equal(r.n, 1000);
});
