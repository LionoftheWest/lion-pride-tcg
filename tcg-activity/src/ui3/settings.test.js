// UI-61 the Settings window (v3): the approved strings and order, the "Pings on" master switch, the inline save error
// under its own row, and Reduce effects (D-11: stored choice, else reduced motion; never without the v3 flag). node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsHTML, reduceEffects, setReduceEffects, SAVE_ERROR } from './settings.js';

const text = (h) => h.replace(/&amp;/g, '&').replace(/<svg[\s\S]*?<\/svg>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const store = (v = {}) => ({ getItem: (k) => (k in v ? v[k] : null), setItem: (k, x) => { v[k] = String(x); }, v });
const media = (reduce) => (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' });

test('UI-61 strings in the approved order: Effects, then Discord pings, then Discord posts ("Hunt", not "Raid boss")', () => {
  const t = text(settingsHTML({ prefs: {}, reduce: false }));
  assert.equal(t, 'Settings Effects Reduce effects Discord pings Pings on Card plays on me Trades & gifts Hunt Pack reminders Discord posts Show when I play');
  assert.doesNotMatch(settingsHTML({ prefs: {}, reduce: false }), /Raid|DISCORD|…/);
});

test('UI-61 switches: the saved prefs, "Pings on" off greys the 4 kinds, Show when I play stays free', () => {
  const on = (h, k) => new RegExp(`data-k="${k}" checked`).test(h);
  const dis = (h, k) => new RegExp(`data-k="${k}"[^>]*disabled`).test(h);
  const h = settingsHTML({ prefs: { trades: false }, reduce: true });
  assert.ok(on(h, 'reduce')); assert.ok(on(h, 'all')); assert.ok(on(h, 'plays')); assert.ok(!on(h, 'trades')); assert.ok(on(h, 'playing'));
  const off = settingsHTML({ prefs: { all: false, plays: true, playing: false }, reduce: false });
  for (const k of ['plays', 'trades', 'raid', 'packs']) { assert.ok(dis(off, k), `${k} disabled`); assert.ok(!on(off, k), `${k} shows off`); }
  assert.ok(!dis(off, 'all')); assert.ok(!dis(off, 'playing')); assert.ok(!on(off, 'playing')); assert.ok(!dis(off, 'reduce'));
});

test('UI-61 a refused save: "Something went wrong. Try again." directly under its own row, once', () => {
  assert.equal(SAVE_ERROR, 'Something went wrong. Try again.');
  const h = settingsHTML({ prefs: {}, reduce: false, errorKey: 'all' });
  assert.equal(h.split(SAVE_ERROR).length - 1, 1);
  assert.match(text(h), /Pings on Something went wrong\. Try again\. Card plays on me/);
  assert.match(h, /role="alert"/);
  assert.doesNotMatch(settingsHTML({ prefs: {}, reduce: false }), /Something went wrong/);
});

test('UI-61 loading: the title and Reduce effects show at once (a device setting), the pings after the load', () => {
  const t = text(settingsHTML({ prefs: null, reduce: false }));
  assert.equal(t, 'Settings Effects Reduce effects');
});

test('Reduce effects (D-11): the stored choice wins, else reduced motion, and never without the v3 flag', () => {
  assert.equal(reduceEffects({ store: store(), media: media(false), v3: true }), false);
  assert.equal(reduceEffects({ store: store(), media: media(true), v3: true }), true);            // the device default
  assert.equal(reduceEffects({ store: store({ 'lp.reduceEffects': '0' }), media: media(true), v3: true }), false);
  assert.equal(reduceEffects({ store: store({ 'lp.reduceEffects': '1' }), media: media(false), v3: true }), true);
  assert.equal(reduceEffects({ store: store({ 'lp.reduceEffects': '1' }), media: media(true), v3: false }), false);   // flag off: v2 behavior
  const s = store(); setReduceEffects(true, s); assert.equal(s.v['lp.reduceEffects'], '1'); setReduceEffects(false, s); assert.equal(s.v['lp.reduceEffects'], '0');
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(reduceEffects({ store: broken, media: media(true), v3: true }), true);
  assert.doesNotThrow(() => setReduceEffects(true, broken));
});
