// HUNT-HEADER-V2 (Nathan, 2026-11-06: "Yes everything needs to be accurate to the damage people ACTUALLY do now in combat v2"):
// the Discord raid posts show the shared Hunt numbers on the v2 fight scale (the ONE factor of hunt_fight_scale, SQL) and no v1 Weak to.
//   node --import tsx --test src/hunt-scale-posts.test.ts           a mutation: MUTATE=<name> ...
//   MUTATE=all node --import tsx src/hunt-scale-posts.test.ts       the baseline and every mutation in one run (each must fail)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

process.env.DISCORD_TOKEN ||= 'test';   // the launch button module reads the env; no network here

const here = dirname(fileURLToPath(import.meta.url));
const MUTATIONS: Record<string, [string, string]> = {
  no_conversion: ['export const scaleN = (n: unknown, f: number): number => Math.round(Number(n ?? 0) * f);', 'export const scaleN = (n: unknown, f: number): number => Number(n ?? 0);'],
  converts_twice: ["  if (!f || !payload || payload.scale === 'v2') return payload;", '  if (!f || !payload) return payload;'],
  off_not_identity: ["  if (!f || !payload || payload.scale === 'v2') return payload;", "  if (!payload || payload.scale === 'v2') return payload; if (!f) return { ...payload };"],
  top_not_scaled: ["const TOP_KINDS = new Set(['defeat', 'expired', 'leaderboard']);", 'const TOP_KINDS = new Set<string>([]);'],
  spawn_keeps_weak: ["${p.scale === 'v2' ? when.trimStart() : `Weak to **${weakText(p.weak)}**.${when}`}", '`Weak to **${weakText(p.weak)}**.${when}`'],
  done_not_scaled: ["  player_done: ['total', 'top_damage', 'boss_hp', 'boss_hp_max'],", '  player_done: [],'],
  drain_unwired: ['      const ev = { ...raw, payload: scalePayload(raw.kind, raw.payload ?? {}, f) };', '      const ev = { ...raw, payload: raw.payload ?? {} };'],
  picture_unscaled: ['    const top = hit ? { damage: f ? scaleN(hit.damage, f) : hit.damage, card:', '    const top = hit ? { damage: hit.damage, card:'],
};
const name = process.env.MUTATE;
if (name === 'all') {
  const run = (n: string) => spawnSync(process.execPath, ['--import', 'tsx', '--test', fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: n }, encoding: 'utf8' });
  const base = run('');
  console.log(`baseline (no mutation) ${base.status === 0 ? 'PASS' : 'FAIL'}`);
  let ok = base.status === 0;
  for (const n of Object.keys(MUTATIONS)) { const r = run(n); const caught = r.status !== 0; ok = ok && caught; console.log(`mutation ${n.padEnd(18)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}`); }
  console.log(`mutations: baseline ${base.status === 0 ? 'PASS' : 'FAIL'}, ${ok ? 'all caught' : 'NOT all caught'}`);
  process.exit(ok ? 0 : 1);
}
let SRC = readFileSync(join(here, 'hunt-notify.ts'), 'utf8').replace(/\r\n/g, '\n');
if (name && MUTATIONS[name]) {
  const [a, b] = MUTATIONS[name];
  const n = SRC.split(a).length - 1; if (n !== 1) throw new Error(`mutation ${name}: the text matches ${n} times, not once`);
  SRC = SRC.replace(a, b);
}
async function load(): Promise<typeof import('./hunt-notify.js')> {
  if (!name) return import('./hunt-notify.js');
  const tmp = join(here, `.mut-${name}-hunt-notify.ts`);
  writeFileSync(tmp, SRC);
  try { return await import(pathToFileURL(tmp).href); } finally { rmSync(tmp, { force: true }); }
}
const N = await load();

const F = 36244 / 80000;   // live Hunt 148564 (2026-11-06): the private max 36,244, hunts.hp_max 80,000
const text = (kind: string, payload: Record<string, unknown>, f: number | null) => N.huntPost({ kind, payload: N.scalePayload(kind, payload, f) }, { base: 1, ranks: [3, 2, 1] })?.content ?? '';

test('spawn: the v2 boss HP and no v1 Weak to; flag OFF: today\'s post', () => {
  const p = { name: 'The Rage-Quit Warlord', tier: 'Heroic', hp: 80000, weak: [{ value: 'trait:monster' }], closes_at: '2026-11-11T00:00:00Z' };
  const on = text('spawn', p, F);
  assert.match(on, /36,244 HP/); assert.doesNotMatch(on, /80,000|Weak to/);
  const off = text('spawn', p, null);
  assert.match(off, /80,000 HP/); assert.match(off, /Weak to \*\*Monster\*\*/);
});
test('nudge and player_done: HP and damage on the v2 scale', () => {
  assert.match(text('nudge', { name: 'B', hp_remaining: 56066, hp_max: 80000 }, F), /25,401 \/ 36,244 HP left/);
  const done = text('player_done', { player_id: '1', total: 7738, cards_used: 8, top_card: 'X', top_damage: 2000, boss_hp: 56066, boss_hp_max: 80000 }, F);
  assert.match(done, /Daily damage: \*\*3,506\*\*/); assert.match(done, /\(906\)/); assert.match(done, /\*\*25,401\*\* \/ 36,244/);
  assert.match(text('player_done', { player_id: '1', total: 7738, cards_used: 8, boss_hp: 56066, boss_hp_max: 80000 }, null), /Daily damage: \*\*7,738\*\*/);
});
test('defeat, expired and the leaderboard: the Top 3 damage on the v2 scale', () => {
  const top = [{ player_id: '1', damage: 7738 }, { player_id: '2', damage: 7699 }];
  assert.match(text('defeat', { name: 'B', tier: 'Heroic', settle: {}, top }, F), /3,506[\s\S]*3,488/);
  assert.match(text('expired', { name: 'B', settle: {}, top }, F), /3,506/);
  const lb = N.scalePayload('leaderboard', { name: 'B', top: [{ username: 'a', damage: 7738 }], hp_remaining: 56066, hp_max: 80000 }, F);
  assert.deepEqual([(lb.top as Array<{ damage: number }>)[0]!.damage, lb.hp_remaining, lb.hp_max], [3506, 25401, 36244]);
});
test('a v2-native Hunt row (factor exactly 1): the same numbers, marked v2, no Weak to', () => {
  const p = N.scalePayload('nudge', { name: 'B', hp_remaining: 25401, hp_max: 36244 }, 1);
  assert.deepEqual([p.hp_remaining, p.hp_max, p.scale], [25401, 36244, 'v2']);
  assert.doesNotMatch(text('spawn', { name: 'B', tier: 'Heroic', hp: 36244, weak: [{ value: 'trait:monster' }] }, 1), /Weak to/);
});
test('no factor: the same payload object (flag OFF byte-identical); a payload already on the v2 scale is not converted again', () => {
  const p = { hp: 80000 };
  assert.equal(N.scalePayload('spawn', p, null), p);
  const v2 = { scale: 'v2', total: 961, boss_hp: 25401, boss_hp_max: 36244 };
  assert.equal(N.scalePayload('player_done', v2, F), v2);
});
test('the drain and the squad picture use the factor (source wiring)', () => {
  assert.ok(SRC.includes('      const ev = { ...raw, payload: scalePayload(raw.kind, raw.payload ?? {}, f) };'));
  assert.ok(SRC.includes('const png = await huntPicture(ev as never, f)'));
  assert.ok(SRC.includes('    const top = hit ? { damage: f ? scaleN(hit.damage, f) : hit.damage, card:'));
});
