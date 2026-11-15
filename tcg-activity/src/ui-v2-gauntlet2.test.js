// R1e gate G-E7: the pure mappers of the v2 fight view (ui-v2-gauntlet2.js), from the R1b 3.4 answer fixture (ci/ui-check/fixtures/g2-fight.json).
// Each test fails when the view computes a server field itself (C3): the strip, the ready pip, the tap line, the allies, the targets, Squad HP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripOf, actorOf, fightModel, tapLine, badgesOf, placesOf, logLines, mergeAnswer, v1RunOf, v2Owns, choiceOf, cardStatusHTML, squadOf, foesOf, portraitKey, fmtPower, wireFight, disposeFight, infoIdOf, v2InfoOf, ROLE_PURPOSE, hpShown, maxShown, shownDrop, dmgText, supStateHTML, calloutOf, gainsOf, newStatusesOf, fightUpdate, squadShownOf, hitText, liteReplay, tickTexts, STRIP_N } from './ui-v2-gauntlet2.js';

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

// R1e round 5 (REVIEW-r4 M-1, L-4): wireFight on a stubbed DOM (no browser). The 3D stage cannot load in node, so the stage part ends in its
// catch; what matters is WHEN the listeners are attached and what happens after the stage await.
// any other element: a stub that takes every property and call (fightUpdate writes text, widths and classes into many parts)
const anyEl = () => new Proxy(function stub() {}, { get: (o, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : anyEl()), set: () => true, apply: () => anyEl() });
function stubFight() {
  const listeners = []; const handlers = [];
  const el = (name) => ({ name, addEventListener: (type, fn) => { listeners.push(`${name}:${type}`); handlers.push({ name, type, fn }); }, classList: { toggle() {}, contains: () => false, add() {}, remove() {} }, setAttribute() {}, dataset: {}, closest: () => null });
  const auto = el('auto'), finish = el('finish');
  const canvas = { ...el('canvas'), replaceWith() {}, closest: () => null, getBoundingClientRect: () => ({ top: 0 }) };
  const F = { ...el('fight'), isConnected: true, style: { setProperty() {} }, querySelectorAll: () => [],
    querySelector: (s) => (s === '.dg-auto' ? auto : s === '.dg-finish' ? finish : s === '.dg-canvas' ? canvas : anyEl()) };
  const main = { querySelector: (s) => (s === '.dg-fight.g2' ? F : null), contains: () => true };
  const calls = { fitFight: 0 };
  const host = { dg: { auto: false, stage: null }, fitFight: () => { calls.fitFight += 1; }, placeArena() {}, currentView: () => 'dungeon', sfx() {}, setAuto() {}, setView() {}, toast() {}, fmt: String, esc: String, thumb: String, elIcon: () => '', hand: '', timer: '', finishButton: () => ({}), autoDisabled: () => false };
  return { listeners, handlers, F, main, host, calls };
}
function withDocument(fightEl, fn) {
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, gcs: globalThis.getComputedStyle, warn: console.warn };
  globalThis.document = { querySelector: (s) => (s === '.dg-fight.g2' ? fightEl() : null), querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} } };
  globalThis.requestAnimationFrame = () => 0;
  globalThis.getComputedStyle = () => ({ gridTemplateAreas: '', gridTemplateRows: '' });
  console.warn = () => {};
  return Promise.resolve().then(fn).finally(() => { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; globalThis.getComputedStyle = saved.gcs; console.warn = saved.warn; });
}

test('M-1: the Finish Room, Auto and fight listeners are attached before wireFight awaits the 3D stage', async () => {
  const s = stubFight();
  await withDocument(() => null, async () => {
    const p = wireFight(s.main, fresh(), s.host);   // not awaited: what is attached before the first await is attached now
    assert.deepEqual([...s.listeners].sort(), ['auto:click', 'fight:click', 'finish:click']);
    await p;
  });
});

test('L-4: when another fight opened while the stage loaded, the old wireFight stops (no layout, no observer of the old fight)', async () => {
  const s = stubFight();
  let open = s.F;
  await withDocument(() => open, async () => {
    const p = wireFight(s.main, fresh(), s.host);
    open = { other: true };   // the member left this fight during the load
    await p;
  });
  assert.equal(s.calls.fitFight, 0);
  const t = stubFight();   // the same fight stays open: the layout runs
  await withDocument(() => t.F, () => wireFight(t.main, fresh(), t.host));
  assert.equal(t.calls.fitFight, 1);
});

// ---- Nathan's live test 2026-11-04 (the shared v2 fight of the Gauntlet, the Dungeon and the Hunt) ----
test('item 1: the attacker magnifier opens its own card (the v1 tile marks its magnifier data-info="1"); the support magnifier its card', () => {
  const card = { dataset: { id: '318' } };
  const attackerMag = { dataset: { info: '1' }, closest: (s) => (s === '.dg-card' ? card : null) };
  const supportMag = { dataset: { info: '312' }, closest: () => null };
  assert.equal(infoIdOf(attackerMag), 318);
  assert.equal(infoIdOf(supportMag), 312);
});

test('item 1, D-212b: the card info of a v2 card: the role (name, what it does) and the v2 active (name, charge)', () => {
  const v = fresh();
  const a = v2InfoOf(v, 124);
  assert.equal(a.roleLabel, 'Finisher');
  assert.equal(a.purpose, 'End a fight before the enemy grows.');
  assert.equal(a.ability.name, 'Doubles Clutch');
  assert.equal(a.ability.effect, 'Charge 1 of 2');
  assert.match(a.ability.kind, /Finisher · Attacker active/);
  assert.match(a.roleIcon, /<svg/);
  assert.equal(v2InfoOf(v, 312).ability.effect, 'Ready');
  assert.equal(v2InfoOf(v, 312).purpose, 'Undo damage and clear statuses.');
  v.run.state.info[124].text = { text: 'Hit the target for 140%.' };   // when the server sends the text (request to R1b, REPORT-fix)
  assert.equal(v2InfoOf(v, 124).ability.desc, 'Hit the target for 140%.');
  for (const r of v.ref.roles) assert.ok(ROLE_PURPOSE[r.key], `a purpose line for ${r.key}`);
});

test('item 1: a tap on the attacker magnifier opens the info and sends no action; a tap on the card body attacks', async () => {
  const s = stubFight();
  const posts = []; const infos = [];
  s.host.apiPost = async (p, b) => { posts.push([p, b]); return { ok: false }; };
  s.host.base = '/api/gauntlet/v2';
  s.host.openInfo = (id, v2) => infos.push([id, v2?.roleLabel]);
  await withDocument(() => null, async () => {
    await wireFight(s.main, fresh(), s.host);
    const tap = s.handlers.find((h) => h.name === 'fight').fn;
    const card = { dataset: { id: '318' } };
    const mag = { dataset: { info: '1' }, closest: (q) => (q === '.card-info' ? mag : q === '.dg-card' ? card : null) };
    tap({ target: mag });
    assert.deepEqual(infos, [[318, 'Striker']]);
    assert.equal(posts.length, 0, 'the magnifier never attacks');
    const unit = { dataset: { card: '318' } };
    const body = { closest: (q) => (q === '.dg-unit, .dg-sup' ? unit : null) };
    await tap({ target: body });
    assert.equal(posts.length, 1);
    assert.equal(posts[0][0], '/api/gauntlet/v2/act');
    assert.equal(posts[0][1].use, 'basic');
  });
});

test('item 2: whole-number HP: a living unit shows its HP rounded up (never 0), a down unit 0, the max rounded up', () => {
  assert.equal(hpShown(243.293), 244);
  assert.equal(hpShown(0.2), 1);
  assert.equal(hpShown(0.2, true), 0);
  assert.equal(hpShown(0), 0);
  assert.equal(hpShown(117.647), 118);
  assert.equal(maxShown(647.5), 648);
  assert.equal(maxShown(200), 200);
});

test('item 9: no "-0": a damage number is the drop of the shown HP; a 0 drop or a 0 tick shows nothing', () => {
  const v = fresh();
  assert.equal(shownDrop({ before: 81.992, after: 81.6 }), 0);
  assert.equal(shownDrop({ before: 12, after: 0, down: true }), 12);
  assert.equal(dmgText(0.3), '');
  assert.equal(dmgText(42.4), '-42');
  const log = [
    { k: 'act', actor: { side: 'enemy', id: 0 }, move: 'strike', hp: [{ side: 'card', id: 312, before: 0, after: 0, down: true, shield_before: 0, shield_after: 0 }] },
    { k: 'clock', clock: 7, ticks: [{ side: 'card', id: 312, status: 'poison', dmg: 0 }], hp: [] },
  ];
  const lines = logLines(v, log);
  assert.ok(lines.every((l) => l.txt !== '-0'), JSON.stringify(lines));
  assert.equal(lines.filter((l) => l.who === 'Poison').length, 0);
});

test('items 7, 8: the support state: Down in the down colour; READY (data-active) when charged; else the charge', () => {
  const H = { fmt: String };
  const down = supStateHTML({ down: true, ready: true, charge: 1, need: 1, id: 312 }, H);
  assert.match(down, /class="g2-down">Down</);
  assert.doesNotMatch(down, /Ready/);
  const ready = supStateHTML({ down: false, ready: true, actor: true, charge: 1, need: 1, id: 312 }, H);
  assert.match(ready, /class="g2-ready is-now" data-active="312"/);
  assert.doesNotMatch(supStateHTML({ down: false, ready: true, actor: false, id: 145 }, H), /is-now/);
  assert.match(supStateHTML({ down: false, ready: false, charge: 0, need: 1, id: 145 }, H), /0 of 1/);
});

test('D-215: an active shows a callout with its name; a basic attack shows none; a foe move shows its name', () => {
  const v = fresh();
  assert.deepEqual(calloutOf(v, { k: 'act', actor: { side: 'card', id: 318 }, action: 'active' }), { side: 'card', id: 318, text: 'Peaches Beam' });
  assert.equal(calloutOf(v, { k: 'act', actor: { side: 'card', id: 318 }, action: 'basic' }), null);
  assert.deepEqual(calloutOf(v, { k: 'act', actor: { side: 'enemy', id: 2 }, move: 'heavy_hit' }), { side: 'enemy', id: 2, text: 'Heavy hit' });
  assert.equal(calloutOf(v, { k: 'clock', clock: 3 }), null);
});

test('item 3: the v1 gain pops (+n heal, +n shield / guard) and the status glyphs come from the step data', () => {
  assert.deepEqual(gainsOf({ hp: [{ side: 'card', id: 124, before: 40.2, after: 52.7, shield_before: 0, shield_after: 12.5 }] }),
    [{ side: 'card', id: 124, text: '+12' }, { side: 'card', id: 124, text: '+13 shield' }]);
  assert.deepEqual(gainsOf({ hp: [{ side: 'enemy', id: 0, before: 50, after: 50, shield_before: 0, shield_after: 10 }] }), [{ side: 'enemy', id: 0, text: '+10 guard' }]);
  const v = fresh(); const w = fresh();
  w.status_lines['card:43'].push({ key: 'stunned', stacks: null, left: 1, amounts: [] });
  assert.deepEqual(newStatusesOf(v, w), [{ side: 'card', id: 43, key: 'stunned', label: 'Stunned' }]);
  assert.deepEqual(newStatusesOf(v, fresh()), []);
});

// ---- PR 503 round 2 (REVIEW-fix-mag): the reviewer's uncaught mutations, M-1, the lows ----
// A recording DOM: every element that the view asks for exists and keeps what the view writes into it.
function recDom(attackers = [124, 318, 43], supports = [312, 145]) {
  const els = new Map(); const pops = []; const classes = [];
  const mk = (key) => {
    if (els.has(key)) return els.get(key);
    const cls = new Set();
    const e = { key, innerHTML: '', textContent: '', style: { setProperty() {} }, dataset: {}, disabled: false, title: '', children: [], isConnected: true, offsetWidth: 1,
      classList: { add: (c) => { cls.add(c); classes.push(`${key} +${c}`); }, remove: (c) => cls.delete(c), toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) || key.startsWith(`.${c}`) || key.includes(` .${c}[`) },
      setAttribute() {}, removeAttribute() {}, addEventListener() {}, insertAdjacentHTML(_, h) { e.innerHTML += h; }, remove() {}, replaceWith() {}, closest: () => null,
      getBoundingClientRect: () => ({ top: 0, left: 0, right: 1, bottom: 1, width: 1, height: 1 }),
      querySelector: (q) => sub(key, q), querySelectorAll: () => [], appendChild: (n) => { pops.push({ in: key, text: n.textContent, cls: n.className }); e.children.push(n); }, firstElementChild: null };
    els.set(key, e); return e;
  };
  const sub = (key, q) => {
    const m = /\.dg-unit\[data-card="(\d+)"\]/.exec(q); if (m && supports.includes(Number(m[1])) && !q.includes('dg-sup')) return null;
    const n = /\.dg-sup\[data-sup="(\d+)"\]/.exec(q); if (n && attackers.includes(Number(n[1])) && !q.includes('dg-unit')) return null;
    return mk(`${key} ${q}`);
  };
  const F = mk('.dg-fight.g2');
  return { F, mk, sub, pops, classes, els };
}
const recHost = (extra = {}) => ({ dg: { auto: false, stage: null }, fmt: (n) => String(n), esc: (x) => String(x), thumb: String, elIcon: () => '', hand: '', timer: '', finishButton: () => ({}), autoDisabled: () => false, ...extra });
const withBody = (fn) => { const saved = globalThis.document; globalThis.document = { body: { dataset: {} } }; try { return fn(); } finally { globalThis.document = saved; } };
const decimalFight = () => {
  const v = fresh(); const F = v.run.state.fight;
  Object.assign(F.cards[124], { hp: 47.3, max: 72.4, status: { shielded: { value: 12.2 } } });
  Object.assign(F.cards[312], { hp: 50.4, max: 60 });
  Object.assign(F.enemies[0], { hp: 8.2, max: 50.5 });
  return v;
};

test('reviewer L-2: the HP texts of fightUpdate are whole numbers (foe plate, card, support, squad = the sum of the shown values)', () => {
  const v = decimalFight(); const d = recDom();
  withBody(() => fightUpdate(d.F, v, { target: 0, log: [] }, recHost()));
  assert.equal(d.els.get('.dg-fight.g2 .dg-plate[data-foe="0"] .hpn').textContent, '9 / 51');
  assert.match(d.els.get('.dg-fight.g2 .dg-unit[data-card="124"] .dg-hpn').innerHTML, /^48\/73 <em>\+13<\/em>$/);
  assert.match(d.els.get('.dg-fight.g2 .dg-sup[data-sup="312"] .g2-shp small').innerHTML, /^51\/60/);
  const sq = squadShownOf(v);
  const F = v.run.state.fight;
  assert.equal(sq.hp, [124, 318, 43, 312, 145].reduce((a, id) => a + hpShown(F.cards[id].hp, F.cards[id].down), 0));
  assert.equal(d.els.get('.dg-fight.g2 .dg-shp .v').innerHTML, `${sq.hp}<small> / ${sq.max}</small>`);
  assert.equal(maxShown(72.4), 73, 'the max rounds up, not to the nearest');
});

test('reviewer L-2: the shield value of the tap line is HP: rounded up', () => {
  const v = fresh();
  v.status_lines['card:124'].find((l) => l.key === 'shielded').amounts = [0.5, 12.2];
  assert.equal(tapLine(v, 'card', 124, 'shielded').line, 'Shielded: Absorbs 13 damage before HP.');
});

test('M-1, D-216: "Your turn" is on the acting card, in one column with the pill and before it (never under it)', () => {
  const v = fresh(); const d = recDom();
  withBody(() => fightUpdate(d.F, v, { target: 0, log: [] }, recHost()));
  const html = d.els.get('.dg-fight.g2 .dg-unit[data-card="318"] .g2-pillbox').innerHTML;
  assert.match(html, /^<span class="g2-pillwrap"><span class="g2-turn">Your turn<\/span><button type="button" class="g2-pill"/);
  assert.equal(d.els.get('.dg-fight.g2 .dg-unit[data-card="43"] .g2-pillbox').innerHTML, '', 'not on another card');
  const c = fresh(); c.order[0] = { side: 'card', id: 43, clock: 6, ready: false }; c.run.state.fight.ext.turn = { side: 'card', id: 43 };
  const e = recDom(); withBody(() => fightUpdate(e.F, c, { target: 0, log: [] }, recHost()));
  assert.match(e.els.get('.dg-fight.g2 .dg-unit[data-card="43"] .g2-pillbox').innerHTML, /^<span class="g2-pillwrap"><span class="g2-turn">Your turn<\/span><span class="g2-pill is-wait">/);
});

test('reviewer L-2: a charged support READY on another card\'s turn sends nothing (the clock picks the card)', async () => {
  const s = stubFight(); const posts = [];
  s.host.apiPost = async (p, b) => { posts.push([p, b]); return { ok: false }; }; s.host.base = '/api/gauntlet/v2';
  await withDocument(() => null, async () => {
    await wireFight(s.main, fresh(), s.host);   // the actor is card 318 (ready)
    const tap = s.handlers.find((h) => h.name === 'fight').fn;
    const ready = { dataset: { active: '312' }, closest: (q) => (q === '[data-active]' ? ready : null) };
    await tap({ target: ready });
    assert.equal(posts.length, 0);
    const own = { dataset: { active: '318' }, closest: (q) => (q === '[data-active]' ? own : null) };
    await tap({ target: own });
    assert.equal(posts.length, 1, 'the actor\'s own active is sent');
  });
});

test('reviewer L-2: the damage number and the log of a hit are the shown HP drop; a guard that took it all is BLOCKED', () => {
  const e = { hp: [{ side: 'enemy', id: 0, before: 50, after: 8.4, down: false, shield_before: 0, shield_after: 0 }] };
  assert.equal(hitText({ target: { side: 'enemy', id: 0 }, dmg: 41.6 }, e), '-41', 'the shown HP goes 50 -> 9');
  assert.equal(hitText({ target: { side: 'enemy', id: 0 }, dmg: 9 }, { hp: [{ side: 'enemy', id: 0, before: 50, after: 50, shield_before: 10, shield_after: 1 }] }), 'BLOCKED');
  assert.equal(hitText({ target: { side: 'enemy', id: 0 }, miss: true }, e), 'MISS');
  const v = fresh();
  const lines = logLines(v, [{ k: 'act', actor: { side: 'enemy', id: 2 }, move: 'strike', hp: [{ side: 'card', id: 124, before: 48.2, after: 48.1, down: false, shield_before: 0, shield_after: 0 }] }]);
  assert.equal(lines[0].txt, '', 'a drop that does not change the shown HP shows no number');
});

test('reviewer L-2, item 3: a card active plays the v1 lunge and impact, the callout, the hit, and the status glyphs', async () => {
  const v = fresh(); const d = recDom();
  const stage = { calls: [], cast(i, el) { this.calls.push(`cast ${i} ${el}`); }, play(i, k) { this.calls.push(`play ${i} ${k}`); }, foeFx(i, m) { this.calls.push(`foeFx ${i} ${m}`); },
    labels: () => [0, 1, 2, 3, 4].map((x) => ({ x, y: 1, foot: 2, w: 1 })), setTarget() {}, dispose() {} };
  const w = fresh(); w.run.state.fight.enemies[0].hp = 8.4;
  w.status_lines['enemy:0'] = [...w.status_lines['enemy:0'], { key: 'mark', stacks: null, left: null, amounts: [] }];
  let replayDone; const replayEnd = new Promise((ok) => { replayDone = ok; });
  const answer = { ok: true, status: 'active', state: w.run.state, order: w.order, targets: w.targets, allies: w.allies, status_lines: w.status_lines, need: w.need, squad_hp: w.squad_hp,
    log: [{ k: 'act', actor: { side: 'card', id: 318 }, action: 'active', target: { side: 'enemy', id: 0 }, hits: [{ target: { side: 'enemy', id: 0 }, dmg: 41.6, crit: false, miss: false }],
      hp: [{ side: 'enemy', id: 0, before: 50, after: 8.4, down: false, shield_before: 0, shield_after: 0 }] }] };
  const host = recHost({ dg: { auto: false, stage }, base: '/api/gauntlet/v2', apiPost: async () => answer, waitMs: () => 0, currentView: () => 'dungeon', sfx() {}, snd() {}, voice() {}, moveSnd: () => null,
    elementOf: () => 'water', setView() { replayDone(); }, setAuto() {}, toast() {}, fitFight() {}, placeArena() {}, openInfo() {} });
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, gcs: globalThis.getComputedStyle };
  globalThis.document = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : d.sub('', q)), querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} },
    createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }) };
  globalThis.requestAnimationFrame = () => 0; globalThis.getComputedStyle = () => ({ gridTemplateAreas: '', gridTemplateRows: '' });
  try {
    const main = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : null), contains: () => true };
    const handlers = []; d.F.addEventListener = (type, fn) => handlers.push(fn);
    await wireFight(main, v, host, { keep: true });
    const pill = { dataset: { active: '318' }, closest: (q) => (q === '[data-active]' ? pill : null) };
    await handlers[0]({ target: pill });
    await Promise.race([replayEnd, new Promise((ok) => setTimeout(ok, 5000))]);   // the end of the replay (setView), not a fixed wait
    await new Promise((ok) => setTimeout(ok, 30));   // settle() runs after it
  } finally { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; globalThis.getComputedStyle = saved.gcs; }
  assert.ok(stage.calls.includes('cast 0 water'), `the element impact: ${stage.calls.join(', ')}`);
  assert.ok(stage.calls.includes('play 0 hit'));
  assert.ok(d.classes.some((c) => c.includes('data-card="318"') && c.endsWith('+striking')), 'the card lunge');
  assert.ok(d.pops.some((p) => p.text === 'Peaches Beam'), 'the callout');
  assert.ok(d.pops.some((p) => p.text === '-41'), `the damage number (the shown HP 50 -> 9): ${d.pops.map((p) => p.text).join(', ')}`);
  assert.ok(d.pops.some((p) => p.text === 'Mark'), 'the status glyph');
});

test('H-1: the Finish Room fast replay plays the light v1 effects (hit, number, lunge) and no WebGL impact, voice or status glyph', async () => {
  const v = fresh(); const d = recDom();
  const stage = { calls: [], cast(i) { this.calls.push(`cast ${i}`); }, play(i, k) { this.calls.push(`play ${i} ${k}`); }, foeFx(i) { this.calls.push(`foeFx ${i}`); },
    labels: () => [0, 1, 2, 3, 4].map((x) => ({ x, y: 1, foot: 2, w: 1 })), setTarget() {}, dispose() {} };
  const w = fresh(); w.run.state.fight.enemies[0].hp = 8.4;
  w.status_lines['enemy:0'] = [...w.status_lines['enemy:0'], { key: 'mark', stacks: null, left: null, amounts: [] }];
  const log = [];
  for (let k = 0; k < 3; k += 1) {
    log.push({ k: 'act', actor: { side: 'card', id: 318 }, action: 'basic', target: { side: 'enemy', id: 0 }, hits: [{ target: { side: 'enemy', id: 0 }, dmg: 10, crit: false, miss: false }],
      hp: [{ side: 'enemy', id: 0, before: 50 - k * 10, after: 40 - k * 10, down: false, shield_before: 0, shield_after: 0 }] });
    log.push({ k: 'act', actor: { side: 'enemy', id: 2 }, move: 'strike', hp: [{ side: 'card', id: 124, before: 48 - k, after: 47 - k, down: false, shield_before: 0, shield_after: 0 }] });
  }
  const answer = { ok: true, status: 'active', state: w.run.state, order: w.order, targets: w.targets, allies: w.allies, status_lines: w.status_lines, need: w.need, squad_hp: w.squad_hp, log };
  const voices = [];
  let replayDone; const replayEnd = new Promise((ok) => { replayDone = ok; });
  const host = recHost({ dg: { auto: false, stage }, base: '/api/gauntlet/v2', apiPost: async () => answer, waitMs: () => 0, currentView: () => 'dungeon', sfx() {}, snd: (k) => voices.push(k), voice: (f, k) => voices.push(k), moveSnd: () => 'boss:strike',
    elementOf: () => 'water', setView() { replayDone(); }, setAuto() {}, toast() {}, fitFight() {}, placeArena() {}, openInfo() {} });
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, gcs: globalThis.getComputedStyle };
  globalThis.document = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : d.sub('', q)), querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} },
    createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }) };
  globalThis.requestAnimationFrame = () => 0; globalThis.getComputedStyle = () => ({ gridTemplateAreas: '', gridTemplateRows: '' });
  let finish = null;
  try {
    const main = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : null), contains: () => true };
    d.F.addEventListener = () => {};
    d.mk('.dg-fight.g2 .dg-finish').addEventListener = (t, fn) => { finish = fn; };
    await wireFight(main, v, host, { keep: true });
    await finish({ stopPropagation() {} });
    await Promise.race([replayEnd, new Promise((ok) => setTimeout(ok, 5000))]);   // the end of the replay (setView), not a fixed wait
    await new Promise((ok) => setTimeout(ok, 30));   // settle() runs after it
  } finally { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; globalThis.getComputedStyle = saved.gcs; }
  assert.equal(stage.calls.filter((c) => c.startsWith('cast')).length, 0, `no WebGL impact in the fast replay: ${stage.calls.join(', ')}`);
  assert.equal(stage.calls.filter((c) => c.startsWith('foeFx')).length, 0, 'no foe move effect');
  assert.equal(stage.calls.filter((c) => c === 'play 0 hit').length, 3, 'the hit flash of each step');
  assert.equal(stage.calls.filter((c) => c === 'play 2 attack').length, 3, 'the monster lunge of each step');
  assert.equal(voices.length, 0, 'no voices or sounds');
  assert.ok(!d.pops.some((p) => p.text === 'Mark'), 'no status glyph pops');
  assert.ok(!d.classes.some((c) => c.endsWith('+striking') || c.endsWith('+hurt')), `no card lunge and no shake in the fast replay (H-1, the CI bisect): ${d.classes.filter((c) => /striking|hurt/.test(c)).join(', ')}`);
  assert.ok(d.pops.some((p) => p.text === '-10'), 'the damage numbers');
  assert.equal(liteReplay({ finishing: true }), true);
  assert.equal(liteReplay({ finishing: false }), false);
});

// ---- PR 503 final review (REVIEW-PR503-final): M-2 the shake on a tap and an Auto hit, L-1 the tick numbers, L-2 the info max HP ----
// One replay on the recording DOM: `trigger` starts it (a tap on the card body, or the Auto button); the answer carries `log`.
async function replayRun(log, trigger) {
  const v = fresh(); const d = recDom();
  const stage = { calls: [], cast(i) { this.calls.push(`cast ${i}`); }, play(i, k) { this.calls.push(`play ${i} ${k}`); }, foeFx(i) { this.calls.push(`foeFx ${i}`); },
    labels: () => [0, 1, 2, 3, 4].map((x) => ({ x, y: 1, foot: 2, w: 1 })), setTarget() {}, dispose() {} };
  const w = fresh();
  const answer = { ok: true, status: 'active', state: w.run.state, order: w.order, targets: w.targets, allies: w.allies, status_lines: w.status_lines, need: w.need, squad_hp: w.squad_hp, log };
  const posts = [];
  let replayDone; const replayEnd = new Promise((ok) => { replayDone = ok; });
  const host = recHost({ dg: { auto: false, stage }, base: '/api/gauntlet/v2', AUTO_ROUNDS: 5, apiPost: async (p) => { posts.push(p); return answer; }, waitMs: () => 0, currentView: () => 'dungeon', sfx() {}, snd() {}, voice() {}, moveSnd: () => null,
    elementOf: () => 'water', setView() { host.dg.auto = false; replayDone(); }, setAuto(on) { host.dg.auto = on; }, toast() {}, fitFight() {}, placeArena() {}, openInfo() {} });
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, gcs: globalThis.getComputedStyle };
  globalThis.document = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : d.sub('', q)), querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} },
    createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }) };
  globalThis.requestAnimationFrame = () => 0; globalThis.getComputedStyle = () => ({ gridTemplateAreas: '', gridTemplateRows: '' });
  try {
    const main = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : null), contains: () => true };
    const handlers = []; d.F.addEventListener = (type, fn) => handlers.push(fn);
    let auto = null; d.mk('.dg-fight.g2 .dg-auto').addEventListener = (t, fn) => { auto = fn; };
    await wireFight(main, v, host, { keep: true });
    if (trigger === 'tap') {
      const unit = { dataset: { card: '318' } };
      await handlers[0]({ target: { closest: (q) => (q === '.dg-unit, .dg-sup' ? unit : null) } });
    } else {
      auto({ stopPropagation() {}, currentTarget: { classList: { toggle() {} }, setAttribute() {} } });
    }
    await Promise.race([replayEnd, new Promise((ok) => setTimeout(ok, 5000))]);   // the end of the replay (setView), not a fixed wait
    await new Promise((ok) => setTimeout(ok, 30));   // settle() runs after it
  } finally { globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; globalThis.getComputedStyle = saved.gcs; }
  return { d, stage, posts };
}
const hurtLog = () => [
  { k: 'act', actor: { side: 'card', id: 318 }, action: 'basic', target: { side: 'enemy', id: 0 }, hits: [{ target: { side: 'enemy', id: 0 }, dmg: 10, crit: false, miss: false }],
    hp: [{ side: 'enemy', id: 0, before: 50, after: 40, down: false, shield_before: 0, shield_after: 0 }] },
  { k: 'act', actor: { side: 'enemy', id: 2 }, move: 'strike', hp: [{ side: 'card', id: 124, before: 48, after: 41, down: false, shield_before: 0, shield_after: 0 },
    { side: 'card', id: 312, before: 50, after: 44, down: false, shield_before: 0, shield_after: 0 }] },
  // L-1: a 1.4 tick takes the shown HP 41 -> 39 (the number is -2, not the rounded damage -1); a 0.4 tick takes a foe 38 -> 37 (-1, not nothing)
  { k: 'clock', clock: 7, ticks: [{ side: 'card', id: 43, status: 'poison', dmg: 1.4 }, { side: 'enemy', id: 1, status: 'burn', dmg: 0.4 }],
    hp: [{ side: 'card', id: 43, before: 40.1, after: 38.7, down: false, shield_before: 0, shield_after: 0 }, { side: 'enemy', id: 1, before: 37.2, after: 36.8, down: false, shield_before: 0, shield_after: 0 }] },
];
for (const trigger of ['tap', 'auto']) {
  test(`M-2 (final review): a ${trigger} hit on a card plays the v1 shake (.hurt) on the hit card and the hit support; the tick pop is the shown HP drop`, async () => {
    const { d, posts } = await replayRun(hurtLog(), trigger);
    assert.equal(posts[0], trigger === 'tap' ? '/api/gauntlet/v2/act' : '/api/gauntlet/v2/auto');
    const hurt = d.classes.filter((c) => c.endsWith('+hurt'));
    assert.ok(hurt.some((c) => c.includes('data-card="124"')), `the hit card shakes: ${hurt.join(', ')}`);
    assert.ok(hurt.some((c) => c.includes('data-sup="312"')), `the hit support shakes: ${hurt.join(', ')}`);
    assert.ok(d.classes.some((c) => c.includes('data-card="318"') && c.endsWith('+striking')), 'the card lunge');
    const tick = d.pops.filter((p) => p.in.includes('data-card="43"'));
    assert.deepEqual(tick.map((p) => p.text), ['-2'], 'the tick number is the drop of the shown HP 41 -> 39');
    assert.ok(d.pops.some((p) => p.in.endsWith('.dg-pops') && p.text === '-1'), `the foe tick 38 -> 37 shows -1: ${d.pops.map((p) => p.text).join(', ')}`);
    assert.ok(!d.pops.some((p) => p.text === '-0'), 'no -0');
  });
}

test('L-1 (final review): a status tick shows the drop of the shown HP; several ticks of one unit add up to its shown drop', () => {
  const e = (ticks, x) => ({ k: 'clock', clock: 3, ticks, hp: [x] });
  assert.deepEqual(tickTexts(e([{ side: 'card', id: 1, dmg: 1.4 }], { side: 'card', id: 1, before: 40.1, after: 38.7 })), ['-2']);
  assert.deepEqual(tickTexts(e([{ side: 'card', id: 1, dmg: 0.4 }], { side: 'card', id: 1, before: 37.2, after: 36.8 })), ['-1'], 'the shown HP 38 -> 37 (the rounded damage is 0)');
  assert.deepEqual(tickTexts(e([{ side: 'card', id: 1, dmg: 0.4 }], { side: 'card', id: 1, before: 37.8, after: 37.4 })), [''], 'the shown HP stays 38');
  assert.deepEqual(tickTexts(e([{ side: 'enemy', id: 0, dmg: 0.6 }, { side: 'enemy', id: 0, dmg: 0.6 }], { side: 'enemy', id: 0, before: 40.1, after: 38.9 })), ['-1', '-1']);
  assert.deepEqual(tickTexts(e([{ side: 'card', id: 1, dmg: 2.2 }], { side: 'card', id: 1, before: 2.2, after: 0.3, down: true })), ['-3'], 'a down unit drops to 0 (its shown HP is 0)');
  assert.deepEqual(tickTexts({ ticks: [{ side: 'enemy', id: 2, dmg: 3 }], hp: [] }), ['-3'], 'no hp entry: the rounded damage');
  const v = fresh();
  const log = [{ k: 'clock', clock: 3, ticks: [{ side: 'card', id: 124, status: 'poison', dmg: 1.4 }, { side: 'card', id: 318, status: 'burn', dmg: 0.4 }, { side: 'card', id: 43, status: 'burn', dmg: 0.4 }],
    hp: [{ side: 'card', id: 124, before: 40.1, after: 38.7 }, { side: 'card', id: 318, before: 37.2, after: 36.8 }, { side: 'card', id: 43, before: 37.8, after: 37.4 }] }];
  const ticks = logLines(v, log).filter((l) => l.who === 'Poison' || l.who === 'Burn');
  assert.deepEqual(ticks.map((l) => [l.who, l.txt]), [['Poison', '-2'], ['Burn', '-1']], 'the log: -2 for 41 -> 39, -1 for 38 -> 37, no line for 38 -> 38');
});

test('L-2 (final review): the info window max HP is the shown max (rounded up)', () => {
  const v = fresh();
  v.run.state.fight.cards[124].max = 647.2;
  assert.equal(v2InfoOf(v, 124).maxHp, 648);
  v.run.state.fight.cards[124].max = 200;
  assert.equal(v2InfoOf(v, 124).maxHp, 200);
// ON-UI (ON SPEC 3.5, G-UI (a) (b) (c)): the member mode of the Dungeon.
});

test('ON-UI screen rule: v1_run keeps the v1 screens; live or a tester may start v2; only a live run shows loot', async () => {
  const g = await import('./ui-v2-gauntlet2.js');
  assert.equal(g.v1RunFirst({ ok: true, live: true, v1_run: { id: 1 } }), true, '(b) an active v1 run of today: the v1 screen');
  assert.equal(g.v1RunFirst({ ok: true, live: true, v1_run: null }), false);
  assert.equal(g.v2CanStart({ ok: true, live: true, tester: false, can_start: true }), true, '(a) a member with the flag ON');
  assert.equal(g.v2CanStart({ ok: true, live: false, tester: false, can_start: true }), false, '(c) flag OFF: not a tester = v1');
  assert.equal(g.v2CanStart({ ok: true, live: false, tester: true, can_start: true }), true, '(c) flag OFF: the tester mode unchanged');
  const st = { phase: 'fight', squad: [1], pend: { shards: 3, cards: [9] }, bank: { shards: 12, cards: [] } };
  const live = g.v1RunOf({ live: true, run: { id: 1, live: true, status: 'active', state: st } });
  assert.deepEqual([live.state.pend.shards, live.state.pend.cards, live.state.bank.shards], [3, [9], 12], 'a live run: its loot chips');
  const testRun = g.v1RunOf({ live: true, run: { id: 1, live: false, status: 'active', state: st } });
  assert.deepEqual([testRun.state.pend.shards, testRun.state.bank.shards], [0, 0], 'a test run (mark false): 0 loot');
  // a member report 2026-11-07: the chest and the floor loot of a live run reach the reused screens; a test run gets neither
  const st2 = { ...st, phase: 'pass', chest: { tier: 4, shards: 68, card: 9 }, floor_loot: { shards: 40, cards: [7] } };
  const live2 = g.v1RunOf({ live: true, run: { id: 1, live: true, status: 'active', state: st2 } });
  assert.deepEqual(live2.state.chest, { tier: 4, shards: 68, card: 9 }, 'a live run: the chest');
  assert.deepEqual(live2.state.floor_loot, { shards: 40, cards: [7] }, 'a live run: the floor loot');
  const test2 = g.v1RunOf({ live: true, run: { id: 1, live: false, status: 'active', state: st2 } });
  assert.deepEqual([test2.state.chest, test2.state.floor_loot], [undefined, undefined], 'a test run: no chest, no floor loot');
});

// ---- A member report (2026-11-09, Blade): "Auto seems a bit buggy when doing boss fights. It does a turn or two then stops until i
// manually deactivate and reactivate." The Hunt answer (hunt-v2-routes.js asRun) has its state in run.state and no top-level state, so
// settle() took every Hunt step for the end of the fight: dispose (the auto timer) + reload, and the same-room repaint never restarted Auto.
async function huntAutoRun(answerOf, steps = 2, waitMs = 1500) {
  const v = fresh(); const d = recDom();
  const stage = { calls: [], cast() {}, play() {}, foeFx() {}, labels: () => [0, 1, 2, 3, 4].map((x) => ({ x, y: 1, foot: 2, w: 1 })), setTarget() {}, dispose() {} };
  const posts = []; let reloads = 0;
  const host = recHost({ dg: { auto: false, stage }, base: '/api/hunt/v2', AUTO_ROUNDS: 5, oneBoss: true,
    apiPost: async (p) => { posts.push(p); return answerOf(posts.length); }, waitMs: () => 0, currentView: () => 'dungeon', sfx() {}, snd() {}, voice() {}, moveSnd: () => null,
    elementOf: () => 'water', setView() {}, setAuto(on) { host.dg.auto = on; }, toast() {}, fitFight() {}, placeArena() {}, openInfo() {},
    reload: async () => { reloads += 1; } });   // huntReload: the same room repaints in place (updateFight), no new wireFight
  const saved = { document: globalThis.document, raf: globalThis.requestAnimationFrame, gcs: globalThis.getComputedStyle };
  globalThis.document = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : d.sub('', q)), querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} },
    createElement: () => ({ className: '', textContent: '', style: {}, remove() {} }) };
  globalThis.requestAnimationFrame = () => 0; globalThis.getComputedStyle = () => ({ gridTemplateAreas: '', gridTemplateRows: '' });
  try {
    const main = { querySelector: (q) => (q === '.dg-fight.g2' ? d.F : null), contains: () => true };
    d.F.addEventListener = () => {};
    let auto = null; d.mk('.dg-fight.g2 .dg-auto').addEventListener = (t, fn) => { auto = fn; };
    await wireFight(main, v, host, { keep: true });
    auto({ stopPropagation() {}, currentTarget: { classList: { toggle() {} }, setAttribute() {} } });
    const t0 = Date.now();
    while (posts.length < steps && Date.now() - t0 < waitMs) await new Promise((ok) => setTimeout(ok, 20));
    await new Promise((ok) => setTimeout(ok, 50));
  } finally { host.dg.auto = false; disposeFight(); globalThis.document = saved.document; globalThis.requestAnimationFrame = saved.raf; globalThis.getComputedStyle = saved.gcs; }
  return { posts, reloads };
}
// The Hunt answer shape: asRun() of hunt_v2_out (status, run.state with phase, the screen fields), no top-level state.
const huntAnswer = (status = 'active') => {
  const w = fresh();
  return { ok: true, status, mode: 'hunt_v2', live: true, day: { status }, hunt: { live_frac: 0.5 },
    run: { status, ended_by: null, state: { ...w.run.state, phase: status === 'active' ? 'fight' : 'over' } },
    order: w.order, targets: w.targets, allies: w.allies, status_lines: w.status_lines, need: w.need, squad_hp: w.squad_hp, log: [] };
};
test('Hunt Auto (member report 2026-11-09): Auto keeps playing after a Hunt step (the answer state is in run.state)', async () => {
  const { posts, reloads } = await huntAutoRun(() => huntAnswer('active'), 3, 4000);
  assert.ok(posts.length >= 3, `Auto posts again after each step: ${posts.length} posts`);
  assert.ok(posts.every((p) => p === '/api/hunt/v2/auto'));
  assert.ok(reloads >= 1, 'the Hunt view is read again (the shared boss bar and the day)');
});
test('Hunt Auto: a Hunt answer that ends the day (status over) stops Auto and reloads once', async () => {
  const { posts, reloads } = await huntAutoRun(() => huntAnswer('over'), 2, 1500);
  assert.equal(posts.length, 1, 'no step after the day is over');
  assert.equal(reloads, 1);
});
