// HUNT-HEADER-V2 (Nathan, 2026-11-06): "Yes everything needs to be accurate to the damage people ACTUALLY do now in combat v2", and "Yes"
// to hiding the v1 boss facts in the boss window (UI-20) while the v2 Hunt is on.
// The ONE factor comes from SQL (hunt_fight_scale.sql); the server multiplies every shared HP and damage number by it (hunt-v2-scale.js).
// This test runs the real module, checks that every server answer that shows Hunt HP or damage goes through it, and runs the real
// UI-17 header lines and the real UI-20 window lines of main.js with stub helpers.
//   node --test src/hunt-v2-scale.test.js            a mutation: MUTATE=<name> node --test src/hunt-v2-scale.test.js
//   MUTATE=all node src/hunt-v2-scale.test.js        the baseline and every mutation in one run (each must fail)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
// [file (relative to src/), the text, its replacement]: each mutation breaks one rule; the tests below must fail on each.
export const MUTATIONS = {
  num_not_scaled: ['hunt-v2-scale.js', 'export const scaleNum = (n, f) => (f ? Math.round(Number(n || 0) * f) : n);', 'export const scaleNum = (n, f) => n;'],
  hunt_no_clamp: ['hunt-v2-scale.js', 'Math.max(0, Math.min(max, scaleNum(h.hp_remaining, f)))', 'scaleNum(h.hp_remaining, f)'],
  hunt_no_marker: ['hunt-v2-scale.js', ", scale: 'v2' };", ' };'],
  off_not_identity: ['hunt-v2-scale.js', '  if (!h || !f) return h;', "  if (!h) return h; if (!f) return { ...h };"],
  sum_ignores_scale: ['hunt-v2-scale.js', 't += f ? Number(r[key] || 0) * f : Number(r[key] || 0);', 't += Number(r[key] || 0);'],
  api_hunt_v1: ['../server.js', '  res.json({ hunt: scaleHunt(hunt, hf), roster, myDamage: scaleNum(myDamage, hf), usedToday:', '  res.json({ hunt, roster, myDamage, usedToday:'],
  api_light_v1: ['../server.js', 'return res.json({ hunt: scaleHunt(hunt, await huntScales.one(hunt.id)) });', 'return res.json({ hunt });'],
  api_last_v1: ['../server.js', 'lastResult: scaleHunt(last, lf), lastBoard: scaleRows(lastBoard, lf), myLast: scaleNum(myLast, lf)', 'lastResult: last, lastBoard, myLast'],
  feed_v1: ['../server.js', 'res.json({ feed: scaleRows(fd.feed, ff), fighters: fd.fighters, hp_remaining: scaleNum(hunt.hp_remaining, ff), hp_max: scaleNum(hunt.hp_max, ff),', 'res.json({ feed: fd.feed, fighters: fd.fighters, hp_remaining: hunt.hp_remaining, hp_max: hunt.hp_max,'],
  top3_v1: ['../server.js', 'res.json({ leaders: scaleRows((await huntLeaders(hunt.id)).slice(0, 20), await huntScales.one(hunt.id)), me: me.id });', 'res.json({ leaders: (await huntLeaders(hunt.id)).slice(0, 20), me: me.id });'],
  board_v1: ['../server.js', 'huntDamage: scaledSum(x.hits, scales),', 'huntDamage: stats.totalDamage,'],
  profile_v1: ['../server.js', 'damage: scaleNum(damage, pf), attacks: rows.length,', 'damage, attacks: rows.length,'],
  routes_credit_v1: ['hunt-v2-routes.js', 'const d = asRun({ ...scaleAnswer(data, f), label: LABEL });', 'const d = asRun({ ...data, label: LABEL });'],
  header_keeps_atk: ['main.js', 'const atk = !v2 && Number(h.stats?.atk) > 0', 'const atk = Number(h.stats?.atk) > 0'],
  header_keeps_weak: ['main.js', "const weak = v2 ? '' : (h.weak_points", 'const weak = (h.weak_points'],
  header_row_collapses: ['main.js', "<div class=\"u3-hs-facts${v2 ? ' is-v2' : ''}\">", '<div class="u3-hs-facts">'],
  window_keeps_facts: ['main.js', "    ${v2 ? '' : `<dl class=\"u3-bw__facts\">", "    ${false ? '' : `<dl class=\"u3-bw__facts\">"],
  window_keeps_moves: ['main.js', 'const moves = v2 ? [] : [', 'const moves = false ? [] : ['],
};

const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
  console.log(`mutations: baseline ${base.status === 0 ? 'PASS' : 'FAIL'}, ${ok ? 'all caught' : 'NOT all caught'}`);
  process.exit(ok ? 0 : 1);
}
const source = (file) => {
  const s = readFileSync(join(here, file), 'utf8').replace(/\r\n/g, '\n');
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== file) return s;
  const n = s.split(m[1]).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  return s.replace(m[1], m[2]);
};
async function load(file) {
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== file) return import(`./${file}`);
  const tmp = join(here, `.mut-${name}-${file}`);
  writeFileSync(tmp, source(file));
  try { return await import(pathToFileURL(tmp).href); } finally { rmSync(tmp, { force: true }); }
}
const S = await load('hunt-v2-scale.js');
const R = await load('hunt-v2-routes.js');
const SERVER = source('../server.js');
const MAIN = source('main.js');

// Live Hunt 148564 (2026-11-06, read-only): hp 56,066 / 80,000, every hit on the v2 day credits; the private max 36,244.
const F = 36244 / 80000;
const H = { id: 148564, name: 'The Rage-Quit Warlord', tier: 'Heroic', status: 'active', hp_remaining: 56066, hp_max: 80000, closes_at: null,
  stats: { atk: 73 }, weak_points: [{ value: 'trait:monster' }], resist_points: [{ value: 'trait:water' }], passive: { kind: 'enrage', label: 'Enrage' } };
const HITS = [7738, 7699, 5665, 2832];   // the live hunt_hits per member (their sum = the shared drop 23,934)

test('the module: HP and damage on the v2 scale with ONE factor; no factor = the same objects (flag OFF byte-identical)', () => {
  const h = S.scaleHunt(H, F);
  assert.deepEqual([h.hp_remaining, h.hp_max, h.scale], [25401, 36244, 'v2']);
  assert.equal(S.scaleNum(7738, F), 3506);
  assert.equal(S.scaleHunt(H, null), H, 'no factor: the same object');
  assert.equal(S.scaleNum(7738, null), 7738);
  const rows = [{ player_id: 'a', damage: 7738 }];
  assert.equal(S.scaleRows(rows, null), rows);
  assert.equal(JSON.stringify(S.scaleRows(rows, null)), JSON.stringify(rows));
  assert.deepEqual(S.scaleRows(rows, F), [{ player_id: 'a', damage: 3506 }]);
});
test('M3: the shown HP loss and the shown damages agree (the sum of the rounded damages is within the rounding of the drop)', () => {
  const h = S.scaleHunt(H, F);
  const drop = h.hp_max - h.hp_remaining;   // 10,843
  const shown = HITS.map((d) => S.scaleNum(d, F));
  const sum = shown.reduce((t, d) => t + d, 0);
  assert.ok(Math.abs(sum - drop) <= HITS.length / 2 + 1, `sum ${sum} vs drop ${drop}`);
  const top3 = shown.slice(0, 3).reduce((t, d) => t + d, 0);
  assert.ok(top3 <= drop, `the Top 3 (${top3}) never shows more damage than the boss lost (${drop})`);
});
test('a v2-native Hunt row (stats.unit v2, PR #533): the SQL factor is exactly 1: the same numbers, still marked v2', () => {
  const n = { ...H, hp_max: 36244, hp_remaining: 25401, stats: { unit: 'v2', atk: 73 } };
  const h = S.scaleHunt(n, 1);
  assert.deepEqual([h.hp_remaining, h.hp_max, h.scale], [25401, 36244, 'v2']);
  assert.equal(S.scaleNum(3506, 1), 3506);
  assert.doesNotMatch(header(h), /ATK|Weak to/);
  assert.ok(header(h).includes('<span>25,401 / 36,244 HP</span>'));
});
test('L4: the shown HP stays in [0, max]', () => {
  assert.equal(S.scaleHunt({ ...H, hp_remaining: 90000 }, F).hp_remaining, 36244);
  assert.equal(S.scaleHunt({ ...H, hp_remaining: -5 }, F).hp_remaining, 0);
});
test('the lifetime board: each Hunt on its own factor (a past v1 Hunt stays v1)', () => {
  const scales = new Map([[148564, F]]);
  assert.equal(S.scaledSum([{ hunt_id: 148564, damage: 7738 }, { hunt_id: 140000, damage: 1000 }], scales), 3506 + 1000);
  assert.equal(S.scaledSum([{ hunt_id: 1, damage: 5 }, { hunt_id: 2, damage: 7 }], new Map()), 12);
});
test('the factor reader: one RPC per new id, cached; a failed read keeps the last factor (none if never read)', async () => {
  let calls = 0; let fail = false; let t = 0;
  const rpc = async (fn, args) => { calls += 1; assert.equal(fn, 'hunt_fight_scales'); return fail ? { error: { message: 'x' } } : { data: Object.fromEntries(args.p_hunts.filter((i) => i === 148564).map((i) => [String(i), F])) }; };
  const r = S.createHuntScales({ rpc, ttl: 1000, now: () => t });
  assert.equal(await r.one(148564), F);
  assert.equal(await r.one(148564), F); assert.equal(calls, 1, 'cached');
  assert.equal(await r.one(7), null);
  t = 5000; fail = true;
  assert.equal(await r.one(148564), F, 'a failed read after the ttl keeps the last factor (no flip to v1 numbers)');
  assert.equal(await r.one(99), null, 'never read: no factor');
  const before = calls; fail = false; await r.one(148564); assert.equal(calls, before + 1, 'the failed read did not refresh the time: the next call reads again');
});
test('every server answer that shows Hunt HP or damage goes through the factor (server.js)', () => {
  const must = [
    ['/api/hunt main', 'res.json({ hunt: scaleHunt(hunt, hf), roster, myDamage: scaleNum(myDamage, hf), usedToday:'],
    ['/api/hunt light', 'return res.json({ hunt: scaleHunt(hunt, await huntScales.one(hunt.id)) });'],
    ['/api/hunt fight', 'return res.json({ hunt: scaleHunt(hunt, await huntScales.one(hunt.id)), fight: true'],
    ['/api/hunt cooldown', 'lastResult: scaleHunt(last, lf), lastBoard: scaleRows(lastBoard, lf), myLast: scaleNum(myLast, lf), lastFeed: scaleRows(lastFeed, lf)'],
    ['/api/hunt/feed', 'feed: scaleRows(fd.feed, ff), fighters: fd.fighters, hp_remaining: scaleNum(hunt.hp_remaining, ff), hp_max: scaleNum(hunt.hp_max, ff)'],
    ['/api/hunt/leaderboard live', 'leaders: scaleRows((await huntLeaders(hunt.id)).slice(0, 20), await huntScales.one(hunt.id))'],
    ['/api/hunt/leaderboard last', 'leaders: scaleRows((await huntLeaders(last.id)).slice(0, 20), await huntScales.one(last.id))'],
    ['/api/leaderboard/v2 lifetime', 'huntDamage: scaledSum(x.hits, scales),'],
    ['/api/leaderboard/v2 live', 'const leaders = scaleRows(await huntLeaders(hunt.id).catch(() => []), await huntScales.one(hunt.id));'],
    ['/api/profile hunt box', 'damage: scaleNum(damage, pf), attacks: rows.length,'],
    ['/api/profile by day', 'damage: scaleNum(dmg, pf)'],
    ['/api/profile top card', 'damage: scaleNum(top[1], pf)'],
    ['v2 routes', 'huntScales });'],
  ];
  for (const [what, text] of must) assert.ok(SERVER.includes(text), `${what}: ${text}`);
  // the achievements keep the raw shared numbers (SQL claims read hunt_hits): the stats are not scaled
  assert.match(SERVER, /totalDamage: x\.hits\.reduce\(\(t, h\) => t \+ \(h\.damage \|\| 0\), 0\),/);
});
test('the v2 routes: "your damage" (day.credited) and the credit of a call on the v2 scale; no factor = unchanged', () => {
  const v = { ok: true, hunt: { id: 148564, live_frac: 0.7 }, day: { credited: 7738, live: true }, credit: { total: 120 } };
  const s = R.scaleAnswer(v, F);
  assert.equal(s.day.credited, 3506); assert.equal(s.credit.total, 54);
  assert.equal(v.day.credited, 7738, 'the input is not changed');
  assert.equal(R.scaleAnswer(v, null), v);
  const ROUTES = source('hunt-v2-routes.js');
  assert.ok(ROUTES.includes('const d = asRun({ ...scaleAnswer(data, f), label: LABEL });'), 'show() converts every answer');
});

// The real header lines of huntSelectV3HTML (UI-17), from "const pct" to the end of the stage template.
const header = (h) => {
  const m = MAIN.match(/function huntSelectV3HTML\(d\) \{\n[\s\S]*?\n( {2}const pct = [\s\S]*?<\/section>`;\n)/);
  assert.ok(m, 'the header lines are in main.js');
  return new Function('d', 'esc', 'tagLabel', 'ui3Icon', 'HUNT_TIER_NUM', 'huntNameRow', 'huntNum', 'cdSpan', 'huntTopHTML', 'huntExtraHTML',
    `const h = d.hunt;\n${m[1]}return stage;`)({ hunt: h }, String, (v) => String(v).split(':').pop(), () => '', { Normal: 1, Heroic: 2, Mythic: 3 },
    (n) => n, (n) => Number(n).toLocaleString('en-US'), (iso, p) => p, () => '', () => '');
};
// The real lines of openBossWindowV3 (UI-20) up to the window HTML.
const bossWindow = (h) => {
  const m = MAIN.match(/function openBossWindowV3\(\) \{\n([\s\S]*?)\n {2}document\.body\.appendChild\(host\);/);
  assert.ok(m, 'the boss window lines are in main.js');
  return new Function('huntState', 'closeBossWindowV3', 'HUNT_TIER_NUM', 'esc', 'tagLabel', 'ui3Icon', 'ui3IconButton', 'huntNum', 'BOSS_MOVES', 'document',
    `${m[1]}\nreturn host.innerHTML;`)({ hunt: h, bossMoves: [{ name: 'Rage', text: 'Hits hard' }] }, () => {}, { Normal: 1, Heroic: 2, Mythic: 3 }, String,
    (v) => String(v).split(':').pop(), () => '', () => '[x]', (n) => Number(n).toLocaleString('en-US'), [['Strike', 'One card']], { createElement: () => ({}) });
};

test('UI-17 header, v2 ON (the server answer): the fight scale, no v1 ATK, no Weak to; the bar fraction unchanged', () => {
  const on = header(S.scaleHunt(H, F));
  assert.match(on, /<span>25,401 \/ 36,244 HP<\/span>/);
  assert.doesNotMatch(on, /80,000|ATK|Weak to/);
  assert.ok(on.includes('<div class="u3-hs-facts is-v2"></div>'), 'the empty facts row keeps one chip height (90-ui-17-v2.css)');
  const css = readFileSync(join(here, '../public/ui3/90-ui-17-v2.css'), 'utf8');
  assert.ok(css.includes('.u3-hs-facts.is-v2::before { content: "\\200b"; display: inline-flex;'), 'the row rule');
  const off = header(H);
  const pct = (s) => s.match(/--hp:(\d+)%/)[1];
  assert.equal(pct(on), pct(off));
});
test('UI-17 header, flag OFF: today\'s header (v1 numbers, ATK 73, Weak to)', () => {
  const off = header(H);
  assert.match(off, /<span>56,066 \/ 80,000 HP<\/span>/);
  assert.match(off, /ATK 73/); assert.match(off, /Weak to/);
  assert.match(off, /<div class="u3-hs-facts"><span class="u3-hs-atk">/);
});
test('UI-20 boss window, v2 ON (Nathan "Yes"): the fight scale, no Attack, Weakness, Resistance, Passive or Move pool', () => {
  const on = bossWindow(S.scaleHunt(H, F));
  assert.match(on, /<span>25,401 \/ 36,244 HP<\/span>/);
  assert.doesNotMatch(on, /<dt>|Attack|Weakness|Resistance|Passive|Move pool|<b>Strike<\/b>|<b>Rage<\/b>|ATK/);
  assert.match(on, /<ul class="u3-bw__moves" hidden><\/ul>/);
});
test('UI-20 boss window, flag OFF: today\'s window (v1 numbers, every fact, the move pool)', () => {
  const off = bossWindow(H);
  assert.match(off, /<span>56,066 \/ 80,000 HP<\/span>/);
  for (const t of ['<dt>Attack</dt>', 'ATK 73', '<dt>Weakness</dt>', '<dt>Resistance</dt>', '<dt>Passive</dt>', 'Move pool', '<b>Rage</b>', '<b>Strike</b>']) assert.ok(off.includes(t), t);
  assert.doesNotMatch(off, /hidden/);
});
