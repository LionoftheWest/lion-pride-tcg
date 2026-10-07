import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { utcToday } from './store.js';

// One source for the game day (one_source_rules.sql): the SQL game_day() is the rule. The golden file holds its
// answers at fixed instants (the DST changes and the midnights around them); card-studio/scripts/
// test-one-source-rules.mjs proves the SQL gives them. This test proves the bot's copy gives them too.
const golden = JSON.parse(readFileSync(new URL('../../shared/game-day-golden.json', import.meta.url), 'utf8')) as {
  cases: { at: string; day: string }[];
};

test('utcToday (the bot game day) equals the SQL game_day at every golden instant', () => {
  assert.ok(golden.cases.length >= 100, 'the golden list is there');
  for (const c of golden.cases) assert.equal(utcToday(new Date(c.at)), c.day, c.at);
});

test('utcToday with no argument is the game day of now', () => {
  const before = utcToday(new Date());
  const now = utcToday();
  const after = utcToday(new Date());
  assert.ok(now === before || now === after);
});
