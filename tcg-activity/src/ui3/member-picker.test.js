// UI-65 the Member picker: the rules that can be checked without a browser. node --test
// 6.5b and D-64 item 9 (Frequent, Recent), D-64 item 5 (In voice, All members), UI-29 (the match in gold), D-08 (no "…").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberLists, markMatch, breakName } from './member-picker.js';

const H = (id, at, name = id) => ({ id, name, at: `2026-10-0${at}T12:00:00Z` });
const ids = (l) => l.map((m) => m.id);

test('D-64 item 9: Frequent = 2 or more trades and offers, the most first, then the latest, at most 3', () => {
  const history = [
    H('tst_a_1', 1), H('tst_a_1', 2),                         // 2
    H('tst_b_1', 1), H('tst_b_1', 2), H('tst_b_1', 3),        // 3
    H('tst_c_1', 1), H('tst_c_1', 5),                         // 2, later than a
    H('tst_d_1', 1), H('tst_d_1', 2),                         // 2, earliest of the 2s
    H('tst_e_1', 4),                                          // 1: not frequent
  ];
  const l = memberLists({ history });
  assert.deepEqual(ids(l.frequent), ['tst_b_1', 'tst_c_1', 'tst_a_1'], 'count first, then the latest; the cap holds');
  assert.deepEqual(ids(l.recent), ['tst_e_1', 'tst_d_1'], 'the other partners, the latest first (d drops out of Frequent at the cap)');
});

test('6.5b: a member shows once; never me; the name of the latest entry', () => {
  const history = [H('tst_me_1', 3), { id: 'tst_a_1', name: 'old', at: '2026-10-01T00:00:00Z' }, { id: 'tst_a_1', name: 'new', at: '2026-10-02T00:00:00Z' }, H('tst_b_1', 1)];
  const voice = [{ id: 'tst_b_1', name: 'b' }, { id: 'tst_v_1', name: 'v' }, { id: 'tst_me_1', name: 'me' }, { id: 'tst_v_1', name: 'v' }];
  const all = [{ id: 'tst_z_1', name: 'zed' }, { id: 'tst_v_1', name: 'v' }, { id: 'tst_a_1', name: 'new' }, { id: 'tst_y_1', name: 'alpha' }, { id: 'tst_x_1', name: 'Beta' }, { id: 'tst_me_1', name: 'me' }];
  const l = memberLists({ history, voice, all, me: 'tst_me_1' });
  assert.deepEqual(l.frequent.map((m) => m.name), ['new'], 'tst_a_1 has 2 entries; the latest name wins');
  assert.deepEqual(ids(l.recent), ['tst_b_1']);
  assert.deepEqual(ids(l.voice), ['tst_v_1'], 'In voice: not a partner, not me, once');
  assert.deepEqual(l.all.map((m) => m.name), ['alpha', 'Beta', 'zed'], 'All members: A to Z (any case), without the members above');
  const every = [...l.frequent, ...l.recent, ...l.voice, ...l.all].map((m) => m.id);
  assert.equal(new Set(every).size, every.length, 'no member twice');
  assert.ok(!every.includes('tst_me_1'));
});

test('memberLists: empty input gives empty lists; ids are strings', () => {
  assert.deepEqual(memberLists(), { frequent: [], recent: [], voice: [], all: [] });
  const l = memberLists({ history: [{ id: 42, name: 'n', at: '2026-10-01' }, { id: 42, name: 'n', at: '2026-10-02' }] });
  assert.deepEqual(l.frequent, [{ id: '42', name: 'n' }]);
});

test('UI-29: the typed part in gold (any case), the rest as typed; the name is escaped', () => {
  assert.equal(markMatch('Jelly', 'jel'), '<b>Jel</b>ly');
  assert.equal(markMatch('mr.mobs', 'MOB'), 'mr.<b>mob</b>s');
  assert.equal(markMatch('Jelly', 'qqqq'), 'Jelly');
  assert.equal(markMatch('Jelly', '  '), 'Jelly');
  assert.equal(markMatch('<i>x', 'x'), '&lt;i&gt;<b>x</b>');
});

test('D-08: names break at _ . - , letter/digit and camelCase, never inside a plain word; escaped', () => {
  assert.equal(breakName('Blastninja718'), 'Blastninja<wbr>718');
  assert.equal(breakName('.purple_psycho.'), '.purple_<wbr>psycho.');
  assert.equal(breakName('mr.mobs'), 'mr.<wbr>mobs');
  assert.equal(breakName('justwanttoplaygames'), 'justwanttoplaygames');
  assert.equal(breakName('lionOfTheWest'), 'lion<wbr>Of<wbr>The<wbr>West');
  assert.equal(breakName('a<b'), 'a&lt;b');
});
