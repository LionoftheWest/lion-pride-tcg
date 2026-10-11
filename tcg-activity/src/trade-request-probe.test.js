// node --test src/trade-request-probe.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeRequestProbe } from './trade-request-probe.js';

const sf = (_k, fn) => Promise.resolve().then(fn);
const mk = (over = {}) => {
  const calls = []; let t = 1000;
  const supabase = { rpc: async (name, args) => { calls.push({ name, args }); return over.error ? { error: { message: over.error } } : { data: null }; } };
  const warns = [];
  const probe = createTradeRequestProbe({ supabase, flag: over.flag ?? true, singleFlight: sf, now: () => t, warn: (m) => warns.push(m) });
  return { probe, calls, warns, tick: (ms) => { t += ms; } };
};

test('flag off: off, and the database is not called', async () => {
  const m = mk({ flag: false });
  assert.equal(await m.probe(), false);
  assert.equal(m.calls.length, 0);
});
test('flag on and the function exists: on; the probe writes nothing (same member twice)', async () => {
  const m = mk();
  assert.equal(await m.probe(), true);
  assert.deepEqual(m.calls, [{ name: 'create_trade_request', args: { p_from: '0', p_to: '0', p_request: 0 } }]);
});
test('flag on and the function is missing: off, one warning', async () => {
  const m = mk({ error: 'Could not find the function' });
  assert.equal(await m.probe(), false);
  assert.equal(m.warns.length, 1);
});
test('the answer is kept for a minute, then read again', async () => {
  const m = mk();
  await m.probe(); await m.probe();
  assert.equal(m.calls.length, 1);
  m.tick(60001);
  await m.probe();
  assert.equal(m.calls.length, 2);
});
