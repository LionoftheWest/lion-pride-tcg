// node --test src/dungeon-preload.test.js
// Invariants of the Dungeon preload: (1) a step loads at most its budget of models, each model once; (2) the room that starts now loads
// ALL its models at once; (3) a step runs once for one screen (a repaint loads nothing more); (4) a data-saver link loads nothing in idle
// time; (5) a failed model is tried again later (it is not kept as an empty slot). The stage module is the real one; fetch is a counter
// that answers 404 (the loader then fails, which is what the test needs to count the requests).
import test from 'node:test';
import assert from 'node:assert/strict';

const asked = [];
globalThis.Request = class { constructor(url) { this.url = String(url); } };   // node cannot build a Request from the relative path the browser loader uses
globalThis.fetch = async (req) => { asked.push(String(req?.url ?? req).split('/').pop()); return new Response('no', { status: 404 }); };
const stage = await import('./dungeon-stage.js');
const pre = await import('./dungeon-preload.js');
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const reset = () => { asked.length = 0; pre.resetWarm(); };

test('preloadModels: at most max models, each model once, in the order of the roster', async () => {
  reset();
  const n = await stage.preloadModels(stage.STAGE_MODELS, 3);
  assert.equal(n, 3);
  assert.deepEqual(asked.slice(0, 3), ['skeleton.glb', 'zombie.glb', 'giant.glb']);
});

test('a failed model is tried again (not kept as an empty slot)', async () => {
  asked.length = 0;
  await stage.preloadModels(['skeleton'], 1);
  assert.ok(asked.includes('skeleton.glb'), 'the failed model was asked again');
});

test('warmFoes loads every model of the room that starts now, without a budget', async () => {
  reset();
  await pre.warmFoes([{ model: 'yeti' }, { model: 'yeti' }, { model: 'dino' }, { model: 'squidle' }, {}]);
  assert.deepEqual([...new Set(asked)].sort(), ['dino.glb', 'squidle.glb', 'yeti.glb']);
});

test('warmRoster: one run for one screen key, a new key runs again, the budget of the kind is kept', async () => {
  reset();
  assert.equal(pre.warmRoster('lobby', 'a'), true);
  assert.equal(pre.warmRoster('lobby', 'a'), false, 'a repaint of the same screen does nothing');
  await wait(500);
  assert.ok(new Set(asked).size <= pre.BUDGET.lobby, `lobby asked ${new Set(asked).size} models, budget ${pre.BUDGET.lobby}`);
  assert.equal(pre.warmRoster('lobby', 'b'), true);
  await wait(500);   // let its idle step end before the next test counts requests
});

test('warmRoster loads nothing on a data-saver link', async () => {
  reset();
  Object.defineProperty(globalThis.navigator, 'connection', { value: { saveData: true }, configurable: true });
  assert.equal(pre.slowLink(), true);
  assert.equal(pre.warmRoster('lobby', 'saver'), false);
  await wait(400);
  assert.equal(asked.length, 0);
  Object.defineProperty(globalThis.navigator, 'connection', { value: { effectiveType: '2g' }, configurable: true });
  assert.equal(pre.slowLink(), true);
  Object.defineProperty(globalThis.navigator, 'connection', { value: { effectiveType: '4g' }, configurable: true });
  assert.equal(pre.slowLink(), false);
});
