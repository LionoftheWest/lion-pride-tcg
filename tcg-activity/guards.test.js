// node --test guards.test.js : the Discord identity cache and the IP limits (guards.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, createLimiter, createWhoAmI } from './guards.js';

function fakeDiscord(good = {}) {
  const calls = [];
  const fetchFn = async (url, { headers }) => {
    const token = headers.authorization.replace('Bearer ', '');
    calls.push(token);
    if (good[token]) return new Response(JSON.stringify(good[token]), { status: 200 });
    return new Response('{"message":"401: Unauthorized"}', { status: 401 });
  };
  return { calls, fetchFn };
}

test('a bad token repeated calls Discord once in 60 s, then again after', async () => {
  let t = 1_000_000;
  const d = fakeDiscord();
  const whoAmI = createWhoAmI({ fetchFn: d.fetchFn, now: () => t });
  for (let i = 0; i < 20; i++) assert.equal(await whoAmI('bad', '1.2.3.4'), null);
  assert.equal(d.calls.length, 1);
  t += 61_000;
  await whoAmI('bad', '1.2.3.4');
  assert.equal(d.calls.length, 2);
});

test('a good token is cached, and is not hurt by the failures of others', async () => {
  const d = fakeDiscord({ good: { id: '42', username: 'n' } });
  const whoAmI = createWhoAmI({ fetchFn: d.fetchFn });
  assert.equal((await whoAmI('good', 'ip')).id, '42');
  for (let i = 0; i < 100; i++) await whoAmI(`bad${i}`, 'ip');
  assert.equal((await whoAmI('good', 'ip')).id, '42');
  assert.equal(d.calls.filter((c) => c === 'good').length, 1);
});

test('new bad tokens from one IP stop reaching Discord after the per-IP budget', async () => {
  const d = fakeDiscord({ good: { id: '42' } });
  const t = 5_000_000;
  const whoAmI = createWhoAmI({ fetchFn: d.fetchFn, now: () => t, perIp: createLimiter({ burst: 5, perSec: 0.5, now: () => t }) });
  for (let i = 0; i < 50; i++) await whoAmI(`bad${i}`, '6.6.6.6');
  assert.equal(d.calls.length, 5);
  // Another IP still gets through.
  assert.equal((await whoAmI('good', '7.7.7.7')).id, '42');
});

test('the total budget caps the failed calls over every IP', async () => {
  const d = fakeDiscord();
  const t = 9_000_000;
  const whoAmI = createWhoAmI({ fetchFn: d.fetchFn, now: () => t, total: createLimiter({ burst: 10, perSec: 5, now: () => t }) });
  for (let i = 0; i < 100; i++) await whoAmI(`bad${i}`, `10.0.0.${i}`);
  assert.equal(d.calls.length, 10);
});

test('a 429 from Discord is not cached as a bad token', async () => {
  let n = 0;
  const fetchFn = async () => (++n === 1 ? new Response('', { status: 429 }) : new Response('{"id":"1"}', { status: 200 }));
  const whoAmI = createWhoAmI({ fetchFn });
  assert.equal(await whoAmI('tok', 'ip'), null);
  assert.equal((await whoAmI('tok', 'ip')).id, '1');
});

test('a network error is a null, not a thrown request', async () => {
  const whoAmI = createWhoAmI({ fetchFn: async () => { throw new Error('down'); } });
  assert.equal(await whoAmI('tok', 'ip'), null);
});

test('clientIp: the last X-Forwarded-For entry behind loopback (Caddy), else the peer', () => {
  const req = (peer, xff) => ({ socket: { remoteAddress: peer }, headers: xff ? { 'x-forwarded-for': xff } : {} });
  assert.equal(clientIp(req('127.0.0.1', '9.9.9.9, 1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('::ffff:127.0.0.1', '1.2.3.4')), '1.2.3.4');
  assert.equal(clientIp(req('5.5.5.5', '1.2.3.4')), '5.5.5.5'); // a direct peer cannot pick its IP
  assert.equal(clientIp(req('127.0.0.1')), '127.0.0.1');
});
