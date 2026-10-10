// UI-03 Home: the markup that can be checked without a browser. node --test
// The hooks the v2 code and the tutorial use stay (ids, data attributes), "Den" is "Voice" (10.1), the resting hero
// has the Top hunter button (D-48, D-52) and the live canvas, and nothing is written with a window size (F-1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { heroRestHTML, heroLiveHTML, voiceCellHTML, voiceHTML, pullsHTML, featHTML, pullRowHTML } from './home.js';

const fmt = (n) => String(n);
const D = { lastResult: { name: 'Boss', tier: 'Tier 1', status: 'defeated', hp_max: 30000 }, myLast: 5, nextSpawnAt: '2026-10-10T00:00:00Z', lastBoard: [{ username: 'Ann', damage: 9 }] };

test('resting hero: live canvas, countdown hook, result, stats, Top hunter button', () => {
  const html = heroRestHTML(D, { fmt, hasModel: true });
  assert.match(html, /id="restCanvas"/);
  assert.match(html, /data-until="2026-10-10T00:00:00Z"/);
  assert.match(html, /Defeated by the pride/);
  assert.match(html, /data-top-hunter/);
  assert.match(html, /Your damage/);
  assert.doesNotMatch(heroRestHTML(D, { fmt, hasModel: false }), /restCanvas/, 'a boss with no model has no stage');
});

test('live hero: canvas, close countdown, Join button, faces slot', () => {
  const html = heroLiveHTML({ name: 'Boss', closes_at: '2026-10-10T00:00:00Z' }, 40, { rank: '#1 of 3' });
  assert.match(html, /id="heroCanvas"/);
  assert.match(html, /data-closes=/);
  assert.match(html, /data-hjoin/);
  assert.match(html, /id="heroFaces"/);
});

test('voice: the cell keeps data-member, the Watch pill shows only for a watchable member, the count is in the header', () => {
  const cell = voiceCellHTML({ id: '7', status: { kind: 'opening' } }, { st: 'Opening a pack' }, { avatar: '', name: 'Ann', ico: 'x', ago: '2m', self: false, watch: true });
  assert.match(cell, /data-member="7"/);
  assert.match(cell, /u3-hm-watch/);
  assert.doesNotMatch(voiceCellHTML({ id: '7' }, { st: 'Here' }, { avatar: '', name: 'Ann', ico: 'x', ago: '2m', self: false, watch: false }), /u3-hm-watch/);
  assert.match(voiceHTML([cell, cell], 2), /u3-hm-live/);
  assert.doesNotMatch(voiceHTML([cell], 1), /u3-hm-live/, 'the LIVE chip needs more than one member');
});

test('pulls: the tabs are All, Top pulls, Voice (not Den); the rows keep the data-pi hook', () => {
  const html = pullsHTML('all');
  assert.match(html, /Voice/);
  assert.doesNotMatch(html, /Den/);
  assert.match(html, /id="plList"/);
  const h = { thumb: (u) => u, name: (p) => p.player, ago: () => '3h', label: { normal: 'Normal' } };
  const p = { rarity: 'normal', name: 'Card', player: 'Ann', image_url: '/a.png', at: 'x', pi: 4 };
  assert.match(featHTML(p, h), /class="u3-hm-feat [^"]*" data-pi="4"/);
  assert.match(pullRowHTML(p, 5, h), /class="u3-hm-row [^"]*" data-pi="5"/);
});

test('F-1: the Home code reads no window size, orientation or media query', () => {
  const src = readFileSync(new URL('./home.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerWidth|innerHeight|screen\.|matchMedia/);
});
