// R1e gate G-E7: the pure mappers of the v2 fight view (ui-v2-gauntlet2.js), from the R1b 3.4 answer fixture (ci/ui-check/fixtures/g2-fight.json).
// Each test fails when the view computes a server field itself (C3): the strip, the ready pip, the tap line, the allies, the targets, Squad HP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripOf, actorOf, fightModel, tapLine, badgesOf, placesOf, logLines, mergeAnswer, v1RunOf, v2Owns, choiceOf, cardStatusHTML, squadOf, foesOf, portraitKey, fmtPower, STRIP_N } from './ui-v2-gauntlet2.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, '..', '..', 'ci', 'ui-check', 'fixtures', 'g2-fight.json'), 'utf8')).body;
const fresh = () => JSON.parse(JSON.stringify(FIX));

test('strip: 10 chips in the order of the server `order` (D-203, D6)', () => {
  const v = fresh();
  const s = stripOf(v);
  assert.equal(s.length, STRIP_N);
  assert.deepEqual(s.map((c) => `${c.side}:${c.id}`), v.order.map((o) => `${o.side}:${o.id}`));
  assert.equal(s[0].next, true);
  assert.ok(s.slice(1).every((c) => !c.next));
  // a server order that a meter sort would not give: the strip follows the server
  v.order = [...v.order].reverse();
  assert.deepEqual(stripOf(v).map((c) => `${c.side}:${c.id}`), v.order.map((o) => `${o.side}:${o.id}`));
  // more than 10 entries: only the first 10
  v.order = [...v.order, ...v.order];
  assert.equal(stripOf(v).length, STRIP_N);
});

test('strip: the ready pip is order[].ready (null and false give no pip, even when charge >= need)', () => {
  const v = fresh();
  const card = v.order.findIndex((o) => o.side === 'card' && o.id === 318);
  assert.equal(stripOf(v)[card].ready, true);
  v.order[card].ready = null;   // the charge depends on the player's choice: no pip (R1b 3.2 item 3)
  assert.equal(stripOf(v)[card].ready, false);
  const i124 = v.order.findIndex((o) => o.side === 'card' && o.id === 124);
  v.run.state.fight.cards[124].charge = 1;   // need 2: charge + 1 would reach it, the server says false
  assert.equal(stripOf(v)[i124].ready, false);
  v.order[i124].ready = true;
  v.run.state.fight.cards[124].charge = 0;
  assert.equal(stripOf(v)[i124].ready, true);
});

test('the actor is order[0] (the clock picks the card)', () => {
  const v = fresh();
  assert.equal(actorOf(v), 318);
  v.order[0] = { side: 'card', id: 43, clock: 6, ready: false };
  assert.equal(actorOf(v), 43);
  const m = fightModel(v);
  assert.deepEqual(m.squad.filter((c) => c.actor).map((c) => c.id), [43]);
});

test('the card ready (pill, gold border) is charge >= need with the live need', () => {
  const v = fresh();
  const by = (id) => fightModel(v).squad.find((c) => c.id === id);
  assert.equal(by(318).ready, true);
  assert.equal(by(43).ready, false);
  v.need[318] = 3;
  assert.equal(by(318).ready, false);
});

test('the tap line for Chill 2 with the fixture amounts', () => {
  const v = fresh();
  const tl = tapLine(v, 'enemy', 0, 'chill');
  assert.equal(tl.line, 'Chill 2: -16% damage and speed.');
  assert.equal(tl.left, 3);
  // the numbers come from status_lines amounts, not from stacks x a leaf in JS
  v.status_lines['enemy:0'].find((l) => l.key === 'chill').amounts = [0.3, 0.3, 3];
  assert.equal(tapLine(v, 'enemy', 0, 'chill').line, 'Chill 2: -30% damage and speed.');
  // the leaf order is read from the server rule
  const st = v.ref.statuses.find((s) => s.key === 'chill');
  st.rule = 'Each stack: -{spd} speed and -{dmg} damage.';
  v.status_lines['enemy:0'].find((l) => l.key === 'chill').amounts = [0.5, 0.2, 3];
  assert.equal(tapLine(v, 'enemy', 0, 'chill').line, 'Chill 2: -20% damage and speed.');
});

test('the tap line of a status with a value takes the unit value (the last amount)', () => {
  const v = fresh();
  assert.equal(tapLine(v, 'card', 124, 'shielded').line, 'Shielded: Absorbs 14 damage before HP.');
  assert.equal(tapLine(v, 'enemy', 0, 'exposed').line, 'Exposed 2: Takes +15% damage.');
});

test('the lit allies are the server `allies`; the valid foes are `targets`', () => {
  const v = fresh();
  assert.deepEqual(fightModel(v).allies, [124, 318, 43, 312, 145]);
  v.allies = [318, 312];
  assert.deepEqual(fightModel(v).allies, [318, 312]);
  assert.deepEqual(fightModel(v).targets, [0, 2, 3, 4]);
  v.targets = [3];
  assert.deepEqual(fightModel(v).targets, [3]);
});

test('Squad HP is squad_hp', () => {
  const v = fresh();
  assert.deepEqual(fightModel(v).squadHp, { hp: 320, max: 392 });
  v.squad_hp = { hp: 1, max: 2 };
  assert.deepEqual(fightModel(v).squadHp, { hp: 1, max: 2 });
});

test('status badges come from status_lines; 3 foe places then +N', () => {
  const v = fresh();
  assert.deepEqual(badgesOf(v, 'enemy', 4).map((b) => b.key), ['stunned', 'weakened', 'chill', 'blinded', 'mark']);
  const p = placesOf(badgesOf(v, 'enemy', 4), 3);
  assert.equal(p.shown.length, 2); assert.equal(p.more, 3);
  assert.equal(placesOf(badgesOf(v, 'enemy', 0), 3).more, 0);
  v.status_lines['enemy:0'][0].left = -1;   // ended
  assert.deepEqual(badgesOf(v, 'enemy', 0).map((b) => b.key), ['chill']);
});

test('the room log: hits, an enemy move with no target (N4), a tick, a down card, a shield end', () => {
  const v = fresh();
  const log = [
    { k: 'act', actor: { side: 'card', id: 43 }, action: 'basic', target: { side: 'enemy', id: 2 }, hits: [{ target: { side: 'enemy', id: 2 }, dmg: 42.4, crit: false, miss: false }], hp: [{ side: 'enemy', id: 2, before: 85, after: 42.6, down: false, shield_before: 0, shield_after: 0 }] },
    { k: 'act', actor: { side: 'enemy', id: 0 }, move: 'strike' },
    { k: 'act', actor: { side: 'enemy', id: 2 }, move: 'strike', hp: [{ side: 'card', id: 318, before: 9, after: 0, down: true, shield_before: 0, shield_after: 0 }] },
    { k: 'clock', clock: 7, event: 'act', ticks: [{ side: 'enemy', id: 2, status: 'poison', dmg: 3 }], ended: [{ side: 'card', id: 312, status: 'shielded' }], hp: [{ side: 'card', id: 312, before: 51, after: 51, down: false, shield_before: 12, shield_after: 0 }] },
  ];
  assert.deepEqual(logLines(v, log).map((l) => `${l.who}|${l.to}|${l.txt}`), [
    "Ottozone's Rob|Water Golem|-42",
    'Water Skeleton · Strike||',
    'Water Golem · Strike|Kroc Bot|-9',
    'Kroc Bot|down|',
    'Poison|Water Golem|-3',
    "I'll get it back, don't worry|Shield ends|",
  ]);
});

test('a write answer replaces the run state and the screen fields', () => {
  const v = fresh();
  const r = { ok: true, status: 'active', floor: 2, room: 4, state: { ...v.run.state, phase: 'choose' }, order: [], targets: [], allies: [], squad_hp: { hp: 1, max: 2 } };
  const m = mergeAnswer(v, r);
  assert.equal(m.run.state.phase, 'choose');
  assert.deepEqual(m.order, []);
  assert.deepEqual(m.squad_hp, { hp: 1, max: 2 });
  assert.equal(mergeAnswer(v, { ok: false }), v);
});

test('the reused v1 screens get a v1-shaped run with no loot (Q-E1)', () => {
  const v = fresh();
  const R = v1RunOf(v);
  assert.equal(R.floor, 2); assert.equal(R.room, 4);
  assert.deepEqual(R.state.pend, { shards: 0, cards: [] });
  assert.deepEqual(R.state.bank, { shards: 0, cards: [] });
  assert.deepEqual(R.squad, [124, 318, 43, 312, 145]);
});

test('the v2 view owns the screen only for a tester with a v2 run (INV-E1)', () => {
  assert.equal(v2Owns(fresh()), true);
  assert.equal(v2Owns({ ok: false, error: 'not_tester' }), false);
  assert.equal(v2Owns({ ok: true, tester: true, run: null, active_mode: null }), false);
  assert.equal(v2Owns({ ok: true, tester: true, run: { status: 'active' }, active_mode: 'gauntlet' }), false);   // a D2 v1 run of a tester
});

test('the act body has only use, target and ally (R1c INV-C4)', () => {
  assert.deepEqual(choiceOf({ use: 'basic', target: 2, actor: 9 }), { use: 'basic', target: 2 });
  assert.deepEqual(choiceOf({ use: 'active', target: -1, ally: 5 }), { use: 'active', ally: 5 });
});

test('the Shielded place stays when a card has no shield (nothing moves, INV-E3)', () => {
  const v = fresh();
  const places = (id) => [...cardStatusHTML(squadOf(v).find((c) => c.id === id)).matchAll(/class="g2-b[ "]/g)].length;
  const first = (id) => /^<span class="g2-b ([^"]*)"/.exec(cardStatusHTML(squadOf(v).find((c) => c.id === id)))?.[1] || '';
  assert.equal(places(124), 2);
  assert.match(first(124), /f-boon/);
  v.status_lines['card:124'] = v.status_lines['card:124'].filter((l) => l.key !== 'shielded');   // the shield is gone
  assert.equal(places(124), 2);   // the empty place + Empowered: Empowered does not move left
  assert.equal(first(124), 'is-empty');
});

// R1e round 2 (Nathan 2026-11-03: the built frames had no monsters and no card art): the pictures of the fight come from the server fields.
const MODELS = join(here, '..', 'public', 'dungeon', 'monsters');
test('every foe has its 3D model (show.model) and the model file exists', () => {
  const v = fresh();
  const foes = foesOf(v);
  assert.equal(foes.length, 5);
  for (const f of foes) {
    assert.ok(f.model, `foe ${f.i} has no model`);
    assert.equal(f.model, v.run.state.fight.enemies[f.i].show.model);
    assert.ok(existsSync(join(MODELS, `${f.model}.glb`)), `no file public/dungeon/monsters/${f.model}.glb`);
  }
  v.run.state.fight.enemies[2].show.model = 'yeti';
  assert.equal(foesOf(v)[2].model, 'yeti');
});

test('the foe chips of the strip carry the model of their foe (the portrait)', () => {
  const v = fresh();
  const chips = stripOf(v).filter((c) => c.side === 'enemy');
  assert.ok(chips.length > 0);
  for (const c of chips) {
    assert.ok(c.model, `enemy chip ${c.id} has no model`);
    assert.equal(c.model, v.run.state.fight.enemies[c.id].show.model);
  }
  assert.equal(portraitKey('skeleton', 'water'), 'skeleton|water');
});

test('every squad card and every card chip has its art URL (cards[id].image_url)', () => {
  const v = fresh();
  for (const c of squadOf(v)) {
    assert.ok(c.image_url, `card ${c.id} has no art`);
    assert.equal(c.image_url, v.cards[c.id].image_url);
    assert.match(c.image_url, /\/card-art\/cards\//);
  }
  for (const c of stripOf(v).filter((x) => x.side === 'card')) assert.equal(c.image, v.cards[c.id].image_url);
});

// R1e round 4 (CI G3 run 41756233905: a 9-digit power was clipped on the card chip in the long variant)
test('the power chip: the full form, the compact form from 10,000 (a 9-digit power fits)', () => {
  assert.equal(fmtPower(148), '148');
  assert.equal(fmtPower(9999), '9,999');
  assert.equal(fmtPower(123456789), '123.5M');
  assert.ok(fmtPower(123456789).length <= 6);
});
