// UI-04 Home boss: the Top 3 board logic. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardRows, boardHTML, boardLabel, topMode } from './home-boss.js';

const fmt = (n) => String(n);
const av = (id, name) => `<i class="av">${name[0]}</i>`;
const ROWS = [{ player_id: '1', username: 'Ann', damage: 9 }, { player_id: '2', username: 'Bo', damage: 7 }, { player_id: '3', username: 'Cy', damage: 5 }, { player_id: '4', username: 'Di', damage: 1 }];

test('board rows: at most 3, only real entries', () => {
  assert.equal(boardRows(ROWS).length, 3);
  assert.deepEqual(boardRows([{ player_id: '1', username: 'Ann', damage: 9 }, { player_id: '2' }]).map((r) => r.name), ['Ann']);
  assert.deepEqual(boardRows(null), []);
  assert.equal(boardHTML([], { fmt, avatar: av }), '', 'no entries, no board');
});

test('board: rank, avatar, name, score per row; one button that opens the Leaderboard', () => {
  const html = boardHTML(boardRows(ROWS), { fmt, avatar: av });
  assert.match(html, /data-top-hunter/);
  assert.equal((html.match(/class="u3-hm-br"/g) || []).length, 3);
  assert.match(html, /Top 3/);
  assert.match(html, /aria-label="Top hunters: 1, Ann, 9\. 2, Bo, 7\. 3, Cy, 5"/);
  assert.equal(boardLabel(boardRows(ROWS.slice(0, 1)), fmt), 'Top hunters: 1, Ann, 9');
});

test('board name is escaped', () => {
  const html = boardHTML(boardRows([{ player_id: '1', username: '<b>x</b>', damage: 1 }]), { fmt, avatar: av });
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

test('mode: the line on compact-land or when the hero is cut, else the board', () => {
  assert.equal(topMode('compact-land', false), 'line');
  assert.equal(topMode('expanded', true), 'line');
  assert.equal(topMode('compact-port', false), 'board');
});

test('F-1: no window size, orientation or media query', () => {
  const src = readFileSync(new URL('./home-boss.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerWidth|innerHeight|screen\.|matchMedia/);
});
