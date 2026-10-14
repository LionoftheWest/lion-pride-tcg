// UI-05 Home carousel: the pure logic and the markup that can be checked without a browser. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { slideOrder, slideNews, slideStep, hms, dhm, dayLabel, weekLabel, themeName, topRows, dungeonSlideHTML, gauntletSlideHTML, controlHTML, carouselHTML, liveEvents, liveCount, eventLine, evCountdown, eventSlideHTML, dotWindow } from './home-slides.js';
import { norm } from './events.js';

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

const NOW = Date.parse('2026-10-05T03:35:00Z');
const ev = (id, title, s, e, extra = {}) => ({ id, kind: 'modifier', title, starts_at: s, ends_at: e, status: 'live', theme: {}, changes: [{ key: 'pull_rare_mult', label: 'x', text: '2x rare pull odds' }], ...extra });
const A = ev(1, 'Double Pull Weekend', '2026-10-02T06:00:00Z', '2026-10-05T06:00:00Z');
const B = ev(2, 'Community Week', '2026-10-01T06:00:00Z', '2026-10-08T06:00:00Z', { kind: 'trigger', changes: [] });
const C = ev(3, 'Gauntlet Encore', '2026-10-02T06:00:00Z', '2026-10-05T05:00:00Z', { changes: [{ key: 'gauntlet_runs_per_day', text: 'x' }] });
const F = ev(4, 'Later', '2026-10-09T06:00:00Z', '2026-10-10T06:00:00Z', { status: 'scheduled' });

test('events slides: last (D-188), one for each live event (D-197), only with the flag; the first slide rule stays (D-14)', () => {
  const two = liveEvents([A, B], NOW);
  assert.deepEqual(slideOrder({ huntLive: true, dungeon: true, gauntlet: true, events: two }), ['hunt', 'dungeon', 'gauntlet', 'events:1', 'events:2']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: true, gauntlet: true, events: two }), ['dungeon', 'hunt', 'gauntlet', 'events:1', 'events:2']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: false, gauntlet: false, events: two }), ['hunt', 'events:1', 'events:2']);
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: true, gauntlet: false, events: [] }), ['dungeon', 'hunt'], 'none live: no slide');
  assert.deepEqual(slideOrder({ huntLive: false, dungeon: true, gauntlet: false }), ['dungeon', 'hunt'], 'flag off: no slide');
  const many = Array.from({ length: 12 }, (_, i) => ev(100 + i, `E${i}`, '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z'));
  assert.equal(slideOrder({ huntLive: true, events: liveEvents(many, NOW) }).length, 13, 'no limit: one slide for each');
});
test('liveEvents: only live ones, the one that ends first first (D-187); no slide for a Hunt event, a system kind stays; bad input = none', () => {
  assert.deepEqual(liveEvents([B, F, A, C], NOW).map((e) => e.id), [3, 1, 2]);
  assert.deepEqual(liveEvents([F], NOW), []);
  assert.deepEqual(liveEvents(undefined, NOW), []);
  const hunt = ev(7, 'The Ranked Nightshade', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { kind: 'hunt', changes: [] });
  const sys = ev(8, 'Launch Day event cards', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { kind: 'launch_cards', changes: [], description: 'Internal: cards.set_id S2' });
  assert.deepEqual(liveEvents([hunt, sys, A], NOW).map((e) => e.id), [1, 8], 'the Hunt event has no slide (condition 2), the system event has (condition 1)');
  assert.equal(liveCount([hunt, sys, A, F], NOW), 3, 'the daily Dot counts every live event, a Hunt event too');
});
test('the line (D-195, condition 3): the tagline at most 40 characters, else the first plain-word change, else none; never the description', () => {
  assert.equal(eventLine(norm(ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { theme: { banner: 'Invite a friend, earn more' } }))), 'Invite a friend, earn more');
  const b40 = 'x'.repeat(40);
  assert.equal(eventLine(norm(ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { theme: { banner: b40 } }))), b40, '40 characters are allowed');
  assert.equal(eventLine(norm(ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { theme: { banner: `${b40}y` } }))), '2x rare pull odds', 'over 40: not cut, the change line shows');
  assert.equal(eventLine(norm(ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { theme: { banner: '  ' } }))), '2x rare pull odds');
  assert.equal(eventLine(norm(ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { changes: [], description: 'Long admin text' }))), '', 'no tagline and no change: no line');
});
test('countdown: two units from 24 hours (10.5), the clock below', () => {
  const now = Date.parse('2026-10-05T03:35:00Z');
  assert.equal(evCountdown('2026-10-08T06:00:00Z', now), '3d 2h');
  assert.equal(evCountdown('2026-10-06T03:35:00Z', now), '1d 0h', 'exactly 24 hours');
  assert.equal(evCountdown('2026-10-06T03:34:59Z', now), '23:59:59');
  assert.equal(evCountdown('2026-10-05T06:00:00Z', now), '02:25:00');
});
test('events slide: chip, title, ONE line, countdown, View event; no description, no "What changes", no Also live', () => {
  const [a] = liveEvents([A], NOW);
  const h = eventSlideHTML(a, NOW);
  assert.match(h, /Event · Live now/);
  assert.match(h, /Double Pull Weekend/);
  assert.match(h, /<p class="u3-hm-evline">2x rare pull odds<\/p>/);
  assert.match(h, /data-evend="2026-10-05T06:00:00Z">02:25:00</);
  assert.match(h, /<span class="u3-btn__label">View event<\/span>/);
  assert.match(h, /data-evview="1"/);
  assert.match(h, /data-slide-open="events" data-ev-id="1"/, 'a tap on the slide opens that event');
  assert.doesNotMatch(h, /What changes|Also live|u3-hm-rule|u3-hm-sboard|u3-hm-sline/);
  const sys = eventSlideHTML(liveEvents([ev(8, 'Launch Day event cards', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { kind: 'launch_cards', changes: [], description: 'Internal: cards.set_id S2' })], NOW)[0], NOW);
  assert.doesNotMatch(sys, /Internal|u3-hm-evline/, 'a system event: title and countdown only');
  assert.match(sys, /Launch Day event cards/);
});
test('events slide picture: art with the theme edge, else the kind picture (the Dungeon kind: the room, the others: the icon on a glow)', () => {
  const art = eventSlideHTML(liveEvents([ev(1, 'T', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { theme: { art: '/pack_still.png' } })], NOW)[0], NOW);
  assert.match(art, /u3-hm-eimg has-art/);
  assert.match(art, /<img src="\/pack_still\.png" alt="">/);
  const glow = eventSlideHTML(liveEvents([A], NOW)[0], NOW);
  assert.match(glow, /u3-hm-eimg is-glow/);
  assert.match(glow, /u3-hm-eico/);
  const room = eventSlideHTML(liveEvents([ev(5, 'Rush', '2026-10-01T06:00:00Z', '2026-10-09T06:00:00Z', { changes: [{ key: 'dungeon_runs_per_day', text: 'x' }] })], NOW)[0], NOW);
  assert.match(room, /u3-hm-eimg is-room/);
  assert.doesNotMatch(room, /u3-hm-eico|<img/);
});
test('dots: at most 4 (D-199), the window moves with the current slide, no "n / N" text', () => {
  const o = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.deepEqual(dotWindow(o.slice(0, 4), 'c'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(dotWindow(o, 'a'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(dotWindow(o, 'b'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(dotWindow(o, 'c'), ['b', 'c', 'd', 'e']);
  assert.deepEqual(dotWindow(o, 'g'), ['e', 'f', 'g', 'h']);
  assert.deepEqual(dotWindow(o, 'h'), ['e', 'f', 'g', 'h']);
  const order = ['dungeon', 'hunt', 'gauntlet', 'events:1', 'events:2', 'events:3', 'events:4', 'events:5'];
  const h = controlHTML(order, 'events:3', {}, { titles: { 'events:3': 'Third' } });
  const pips = h.match(/u3-hm-pip/g) || [];
  assert.equal(pips.length, 4);
  assert.match(h, /aria-label="Third" data-slide-go="events:3"/);
  assert.doesNotMatch(h, /\d\s*\/\s*\d/);
});
test('control labels: the modes and ONE Events item that opens the current (or the first) event slide', () => {
  const order = ['hunt', 'dungeon', 'events:1', 'events:2'];
  const first = controlHTML(order, 'hunt');
  assert.equal((first.match(/u3-seg__item/g) || []).length, 3, 'Hunt, Dungeon, Events');
  assert.match(first, /<button[^>]*data-slide-go="events:1"><span>Events<\/span>/);
  const on = controlHTML(order, 'events:2');
  assert.match(on, /u3-seg__item is-active" aria-selected="true" data-slide-go="events:2"><span>Events/);
});
test('daily Dot on the control (D-198): the first event dot shown and the Events label, only when asked', () => {
  const order = ['hunt', 'events:1', 'events:2'];
  const h = controlHTML(order, 'hunt', {}, { eventsDot: true });
  assert.equal((h.match(/u3-dot/g) || []).length, 2, 'one on the first event dot, one on the label');
  assert.match(h, /aria-label="Events" data-slide-go="events:1"><span class="u3-dot"/);
  assert.equal((controlHTML(order, 'hunt', {}, { eventsDot: false }).match(/u3-dot/g) || []).length, 0);
});
