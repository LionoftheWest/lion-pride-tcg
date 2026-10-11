// UI-05 Home carousel: the pure logic and the markup that can be checked without a browser. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slideOrder, slideNews, slideStep, hms, dhm, dayLabel, weekLabel, themeName, topRows, dungeonSlideHTML, gauntletSlideHTML, controlHTML, carouselHTML } from './home-slides.js';

test('order: the Hunt first when it is live, else the next active mode first (D-14, D-45)', () => {
  assert.deepEqual(slideOrder({ huntLive: true, dungeon: true, gauntlet: true }), ['hunt', 'dungeon', 'gauntlet']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: true, gauntlet: true }), ['dungeon', 'hunt', 'gauntlet']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: true, gauntlet: false }), ['dungeon', 'hunt']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: false, gauntlet: true }), ['hunt', 'gauntlet']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: false, gauntlet: false }), ['hunt'], 'no mode open: the Hunt alone, no control');
});

test('news Dot: the Dungeon while today\'s run is not used; never a closed mode', () => {
  assert.equal(slideNews('dungeon', { runs_today: 0, run: null }), true);
  assert.equal(slideNews('dungeon', { runs_today: 1, run: null }), false);
  assert.equal(slideNews('dungeon', { runs_today: 0, run: { status: 'active' } }), false);
  assert.equal(slideNews('dungeon', null), false);
  assert.equal(slideNews('gauntlet', { runs_today: 0 }), false);
  assert.equal(slideNews('hunt', { runs_today: 0 }), false);
});

test('step wraps in both directions', () => {
  const o = ['dungeon', 'hunt', 'gauntlet'];
  assert.equal(slideStep(o, 'dungeon', 1), 'hunt');
  assert.equal(slideStep(o, 'gauntlet', 1), 'dungeon');
  assert.equal(slideStep(o, 'dungeon', -1), 'gauntlet');
});

test('timers and labels', () => {
  const now = Date.parse('2026-10-04T22:01:25Z');
  assert.equal(hms('2026-10-05T06:00:00Z', now), '07:58:35');
  assert.equal(hms('2026-10-04T00:00:00Z', now), '00:00:00', 'past = zero');
  assert.equal(dhm('2026-10-11T06:00:00Z', now), '6d 7h 58m');
  assert.equal(dayLabel('2026-10-04'), 'SUN, OCT 4');
  assert.equal(weekLabel('2026-10-04'), 'OCT 4');
  assert.equal(themeName('trait:robot'), 'Robot');
  assert.equal(themeName('origin:dark_forest'), 'Dark Forest');
});

test('Top 3 rows: only real entries, at most three', () => {
  assert.deepEqual(topRows([]), []);
  assert.deepEqual(topRows(null), []);
  assert.deepEqual(topRows([{ rank: 1, username: 'Ann', floor: 6, room: 3 }, { rank: 2 }, { rank: 3, username: 'Bo', floor: 2, room: 1 }]),
    [{ rank: 1, name: 'Ann', at: '6F Room 3' }, { rank: 3, name: 'Bo', at: '2F Room 1' }]);
  assert.equal(topRows([1, 2, 3, 4].map((r) => ({ rank: r, username: `M${r}`, floor: 1, room: 1 }))).length, 3);
});

const D = { name: 'Shadowmere Keep', day: '2026-10-04', next_at: '2026-10-05T06:00:00Z', rule: { name: 'Creatures and Items only' }, top: [], runs_today: 0 };
test('Dungeon slide: the lobby header, timer hook, rule, empty board and the one line', () => {
  const h = dungeonSlideHTML(D);
  assert.match(h, /Shadowmere Keep/);
  assert.match(h, /SUN, OCT 4/);
  assert.match(h, /New dungeon in/);
  assert.match(h, /data-hms="2026-10-05T06:00:00Z"/);
  assert.match(h, /Today's rule/);
  assert.match(h, /Creatures and Items only/);
  assert.match(h, /Today.{1,6}s top 3/);
  assert.match(h, /0 runs/);
  assert.match(h, /No runs yet today\. Be the first\./);
  assert.match(h, /u3-hm-simg/);
  assert.match(h, /data-slide-open="dungeon"/);
  assert.doesNotMatch(h, /Start run/, 'no button the frame does not draw');
});
test('Dungeon slide: a name is escaped, one run is singular, entries show', () => {
  const h = dungeonSlideHTML({ ...D, name: '<b>x</b>', runs_today: 1, top: [{ rank: 1, username: 'Ann', floor: 6, room: 3 }] });
  assert.doesNotMatch(h, /<b>x<\/b>/);
  assert.match(h, /1 run</);
  assert.match(h, /6F Room 3/);
});
test('Gauntlet slide: week label, week timer hook, theme, members', () => {
  const h = gauntletSlideHTML({ name: "The Lion's Gauntlet", week: '2026-10-04', ends_at: '2026-10-11T06:00:00Z', theme: 'trait:robot', top: [], players_week: 0 });
  assert.match(h, /WEEK OF OCT 4/);
  assert.match(h, /Week ends in/);
  assert.match(h, /data-dhm="2026-10-11T06:00:00Z"/);
  assert.match(h, /This week's theme/);
  assert.match(h, />Robot</);
  assert.match(h, /Top 3 this week/);
  assert.match(h, /0 members/);
});

test('control: arrows, dots and labels, the active one marked, the news Dot on the Dungeon only, hits via the library classes', () => {
  const h = controlHTML(['dungeon', 'hunt', 'gauntlet'], 'dungeon', { dungeon: true });
  assert.match(h, /data-slidedir="prev"/);
  assert.match(h, /data-slidedir="next"/);
  assert.equal((h.match(/data-slide-go=/g) || []).length, 6, 'three dots and three labels');
  assert.match(h, /u3-hm-pip is-on/);
  assert.match(h, /u3-seg__item is-active/);
  assert.equal((h.match(/u3-dot/g) || []).length, 2, 'one Dot on the dot and one on the label');
  assert.match(h, /aria-label="Dungeon" data-slide-go="dungeon"><span class="u3-dot" role="img" aria-label="New">/, 'the dot is named by the slide name alone (so the Dungeon key matches the label on the larger classes)');
});
test('carousel: no control for one slide', () => {
  assert.doesNotMatch(carouselHTML(['hunt'], 'hunt', '', {}), /u3-hm-ctl/);
  assert.match(carouselHTML(['hunt', 'dungeon'], 'hunt', '', {}), /u3-hm-ctl/);
});

test('no window size is read, no literal px or color in the slide file (F-1, G4)', () => {
  const src = readFileSync(new URL('./home-slides.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerWidth|innerHeight|matchMedia|screen\./);
  assert.doesNotMatch(src, /\d\s*px\b|#[0-9a-fA-F]{3,8}\b/);
});
