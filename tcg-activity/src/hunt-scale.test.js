// HUNT-HEADER-V2 (member report, Nathan 2026-11-06: the Hunt header showed "60,264 / 80,000 HP", ATK 73 and Weak to, the v1 boss, while the
// member fights a private v2 copy with max 36,244). The real header lines of main.js (huntSelectV3HTML, UI-17) and the HP line of the boss
// window (UI-20) run here with stub helpers and the real hunt-scale.js.
//   node --test src/hunt-scale.test.js            a mutation: MUTATE=<name> node --test src/hunt-scale.test.js
//   MUTATE=all node src/hunt-scale.test.js        the baseline and every mutation in one run (each must fail)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
// [file, the text, its replacement]: each mutation breaks one rule; the tests below must fail on each.
export const MUTATIONS = {
  header_v1_numbers: ['main.js', '<span>${huntNum(hp.hp)} / ${huntNum(hp.max)} HP</span>', '<span>${huntNum(h.hp_remaining)} / ${huntNum(h.hp_max)} HP</span>'],
  header_keeps_atk: ['main.js', 'const atk = !hp.v2 && Number(h.stats?.atk) > 0', 'const atk = Number(h.stats?.atk) > 0'],
  header_keeps_weak: ['main.js', "const weak = hp.v2 ? '' : (h.weak_points", 'const weak = (h.weak_points'],
  window_v1_numbers: ['main.js', '`${huntNum(huntHpShown(h, huntV2).hp)} / ${huntNum(huntHpShown(h, huntV2).max)} HP`', '`${huntNum(h.hp_remaining)} / ${huntNum(h.hp_max)} HP`'],
  scale_ignores_flag: ['hunt-scale.js', 'v2?.ok && v2.live === true && max > 0', 'v2?.ok && max > 0'],
  scale_other_hunt: ['hunt-scale.js', ' && v2.hunt && Number(v2.hunt.id) === Number(h.id)', ''],
  scale_frac_changed: ['hunt-scale.js', 'Math.round((Number(h.hp_remaining) / Number(h.hp_max)) * max)', 'Math.round(Number(h.hp_remaining) * max / 100000)'],
};

const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n) => spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
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
async function scaleModule() {
  const m = name && MUTATIONS[name];
  if (!m || m[0] !== 'hunt-scale.js') return import('./hunt-scale.js');
  const file = join(here, `.mut-${name}-hunt-scale.js`);
  writeFileSync(file, source('hunt-scale.js'));
  try { return await import(pathToFileURL(file).href); } finally { rmSync(file, { force: true }); }
}
const S = await scaleModule();
const M = source('main.js');

// The report: the shared row 148564 (Heroic, 60264 / 80000), the v2 private max 36244 (hunt_v2_view.boss_max, hunt_v2_view_boss_max.sql).
const H = { id: 148564, name: 'The Rage-Quit Warlord', tier: 'Heroic', hp_remaining: 60264, hp_max: 80000, closes_at: null,
  stats: { atk: 73 }, weak_points: [{ value: 'trait:monster' }, { value: 'trait:humanoid' }] };
// The keys of hunt_v2_view (combat_v2_on_hunt.sql + hunt_v2_view_boss_max.sql) with the flag ON and no day row yet.
const VIEW_ON = { ok: true, tester: false, live: true, practice: false, boss_max: 36244, day: null, can_start: true,
  hunt: { id: 148564, name: 'The Rage-Quit Warlord', tier: 'Heroic', closes_at: null, live_frac: 60264 / 80000 }, boss: { key: 'warlord' } };
const V2_HP = Math.round((60264 / 80000) * 36244);   // 27303

// The real lines of huntSelectV3HTML from "const pct" to the end of the stage template, run with stub helpers.
const header = (h, v2) => {
  const m = M.match(/function huntSelectV3HTML\(d\) \{\n[\s\S]*?\n( {2}const pct = [\s\S]*?<\/section>`;\n)/);
  assert.ok(m, 'the header lines are in main.js');
  return new Function('d', 'huntV2', 'huntHpShown', 'esc', 'tagLabel', 'ui3Icon', 'HUNT_TIER_NUM', 'huntNameRow', 'huntNum', 'cdSpan', 'huntTopHTML', 'huntExtraHTML',
    `const h = d.hunt;\n${m[1]}return stage;`)({ hunt: h }, v2, S.huntHpShown, String, (v) => String(v).split(':').pop(), () => '', { Normal: 1, Heroic: 2, Mythic: 3 },
    (n) => n, (n) => Number(n).toLocaleString('en-US'), (iso, p) => p, () => '', () => '');
};
// The real HP line of the boss window (openBossWindowV3, UI-20).
const windowHp = (h, v2) => {
  const m = M.match(/\n( {4}<div class="u3-bw__hp"[^\n]*)\n/);
  assert.ok(m, 'the boss window HP line is in main.js');
  const pct = Math.round((100 * h.hp_remaining) / h.hp_max);
  return new Function('h', 'huntV2', 'huntHpShown', 'huntNum', 'pct', 'defeated', `return \`${m[1]}\`;`)(h, v2, S.huntHpShown, (n) => Number(n).toLocaleString('en-US'), pct, false);
};

test('the v2 Hunt ON: the header shows the fight scale (hp of boss_max), no v1 ATK, no Weak to', () => {
  const html = header(H, VIEW_ON);
  assert.match(html, new RegExp(`<span>${V2_HP.toLocaleString('en-US')} / 36,244 HP</span>`));
  assert.doesNotMatch(html, /80,000/, 'no v1 max');
  assert.doesNotMatch(html, /ATK/, 'the v2 fight shows no boss ATK');
  assert.doesNotMatch(html, /Weak to/, 'the v2 fight shows no Weak to');
});
test('the v2 Hunt ON: the bar fraction does not change (the same --hp and aria percent as the v1 numbers)', () => {
  const on = header(H, VIEW_ON), off = header(H, null);
  const pct = (s) => s.match(/--hp:(\d+)%/)[1];
  assert.equal(pct(on), '75');
  assert.equal(pct(on), pct(off));
  const { hp, max } = S.huntHpShown(H, VIEW_ON);
  assert.ok(Math.abs(hp / max - 60264 / 80000) <= 1 / max, 'the shown hp / max = the shared fraction');
});
test('flag OFF (view 403, null): the header is exactly the v1 header (v1 numbers, ATK 73, Weak to)', () => {
  const html = header(H, null);
  assert.match(html, /<span>60,264 \/ 80,000 HP<\/span>/);
  assert.match(html, /ATK 73/);
  assert.match(html, /Weak to/);
  assert.equal(header(H, { ...VIEW_ON, live: false, tester: true, practice: true }), html, 'a tester practice view (flag OFF): v1 too');
  assert.equal(header(H, { ...VIEW_ON, boss_max: null }), html, 'no boss_max (the SQL not applied yet): v1 too');
  assert.equal(header(H, { ...VIEW_ON, hunt: { ...VIEW_ON.hunt, id: 999 } }), html, 'a view of another Hunt: v1 too');
});
test('the boss window (UI-20) HP line: the fight scale when ON, the v1 numbers when OFF', () => {
  assert.match(windowHp(H, VIEW_ON), new RegExp(`<span>${V2_HP.toLocaleString('en-US')} / 36,244 HP</span>`));
  assert.match(windowHp(H, null), /<span>60,264 \/ 80,000 HP<\/span>/);
});
test('huntHpShown: whole numbers; the max is rounded up as the fight shows it; an empty boss shows 0', () => {
  assert.deepEqual(S.huntHpShown(H, VIEW_ON), { hp: V2_HP, max: 36244, v2: true });
  assert.deepEqual(S.huntHpShown({ ...H, hp_remaining: 0 }, VIEW_ON), { hp: 0, max: 36244, v2: true });
  assert.deepEqual(S.huntHpShown(H, { ...VIEW_ON, boss_max: 36243.5 }), { hp: Math.round((60264 / 80000) * 36243.5), max: 36244, v2: true });
  assert.deepEqual(S.huntHpShown(H, null), { hp: 60264, max: 80000, v2: false });
});
