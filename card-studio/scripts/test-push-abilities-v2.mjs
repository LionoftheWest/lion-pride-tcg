import './localdb-guard.mjs';
/**
 * Test of scripts/push-abilities.mjs --v2 (combat v2 PR T1, plan 12.1: "push-abilities.mjs pushes them later with a --dry diff of 0 after the push") on the
 * LOCAL copy, with SYNTHETIC abilities on two subjects (their old ability_v2 is put back at the end):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-push-abilities-v2.mjs
 * Needs combat_v2_ability_builder.sql applied on the local copy (else SKIP: the column subjects.ability_v2 is not there).
 * Invariants:
 *   P1 --dry shows each change and writes nothing
 *   P2 the push writes {role, name, blocks, silver} to subjects.ability_v2, and a --dry right after shows 0 changes
 *   P3 a batch with ONE row that ability_v2_check refuses writes nothing (exit 1, "Refused (nothing written)")
 *   P4 the trigger subjects_ability_v2_check refuses a bad ability written directly
 *   P5 a batch with a key twice or a row with no role is refused before any write
 *   P6 --factors <file> writes pick_factor with the active of a support row (plan 20.10); --dry with the file shows 0 changes
 *   P7 a factors file of a changed active or with an attacker row is refused before any write
 *   P8 the trigger refuses a pick_factor outside 0.5 to 2 written directly
 *   P9 a push without --factors removes the factor (it belongs to the active)
 *   (P6 to P9 SKIP while combat_v2_autopick_active.sql is not on the copy)
 * Safety: the test refuses to start while a subject holds a "Tst ..." ability (left from an earlier run). The restore at the end checks each
 * write, tries again with a short wait, and prints FAIL with the error and the SQL that puts the old value back.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal } from './lab-lib.mjs';
import { supabase } from '../src/supabase.js';
import { activeHash } from '../v2sim/factors.mjs';
assertLocal('test-push-abilities-v2.mjs');

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 600)}`); };
const probe = await supabase.from('subjects').select('id, key, ability_v2').order('id').limit(2);
if (probe.error && /ability_v2/.test(probe.error.message)) { console.log('SKIP the column subjects.ability_v2 is not on the local copy: apply combat_v2_ability_builder.sql first'); process.exit(0); }
if (probe.error || probe.data.length < 2) { console.log(`FAIL the local copy has no two subjects (${probe.error?.message})`); process.exit(1); }
// A test ability ("Tst ...") that an earlier run left (2026-10-21: a restore failed under load and left "Tst Guard" on subject 25, so the next
// run failed P1/P2). The test REFUSES to start and does not clean it: it cannot know the value from before that run, and a guess would
// overwrite a real ability. The restore below prints the exact old value when it fails.
const left = await supabase.from('subjects').select('id, key, ability_v2').like('ability_v2->>name', 'Tst %');
if (left.error) { console.log(`FAIL cannot check for test abilities left from an earlier run: ${left.error.message}`); process.exit(1); }
if (left.data.length) {
  console.log(`FAIL ${left.data.length} subject(s) hold a test ability from an earlier run: ${left.data.map((x) => `id ${x.id} (${x.key}) "${x.ability_v2.name}"`).join(', ')}`);
  console.log('  Clean the copy first: run the SQL that the failed run printed ("restore FAILED ... run: update public.subjects ..."),');
  console.log('  or refresh the copy (localdb/refresh.sh, docs/foundations.md), which takes the real values again. Then run this test again.');
  process.exit(1);
}
const [s1, s2] = probe.data;
const dir = mkdtempSync(join(tmpdir(), 'push-v2-'));
const script = fileURLToPath(new URL('./push-abilities.mjs', import.meta.url));
const push = (file, dry) => spawnSync(process.execPath, [...process.execArgv, script, '--v2', file, ...(dry ? ['--dry'] : [])], { env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1' }, encoding: 'utf8' });
const pushF = (file, factors, dry) => spawnSync(process.execPath, [...process.execArgv, script, '--v2', file, '--factors', factors, ...(dry ? ['--dry'] : [])], { env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1' }, encoding: 'utf8' });
const read = async () => { const { data } = await supabase.from('subjects').select('key, ability_v2').in('id', [s1.id, s2.id]); return Object.fromEntries(data.map((x) => [x.key, x.ability_v2])); };
const A1 = { name: 'Tst Guard', blocks: [{ k: 'shield', v: 0.3, to: 'most_hurt' }, { k: 'ally_below', line: 0.3, x: 2 }], silver: { block: 1, field: 'v', value: 0.4 } };
const A2 = { name: 'Tst Hit', blocks: [{ k: 'hit', x: 1.75 }, { k: 'on_kill', status: 'slowed', chance: 1 }] };
// one restore: up to RESTORE_TRIES writes with a short wait between them; then a read checks the value. Answers null (done) or the last error.
const RESTORE_TRIES = 4;
async function restore(s) {
  let last = null;
  for (let t = 1; t <= RESTORE_TRIES; t++) {
    try {
      const { error } = await supabase.from('subjects').update({ ability_v2: s.ability_v2 }).eq('id', s.id);
      if (error) throw new Error(error.message);
      const { data, error: e2 } = await supabase.from('subjects').select('ability_v2').eq('id', s.id).single();
      if (e2) throw new Error(`read after the write: ${e2.message}`);
      if (JSON.stringify(data.ability_v2 ?? null) === JSON.stringify(s.ability_v2 ?? null)) return null;
      throw new Error(`the value after the write is ${JSON.stringify(data.ability_v2).slice(0, 200)}`);
    } catch (e) { last = e.message || String(e); }
    if (t < RESTORE_TRIES) await new Promise((r) => setTimeout(r, 500 * t));
  }
  return last;
}
const batch = (rows, name) => { const f = join(dir, `${name}.json`); writeFileSync(f, JSON.stringify({ rows })); return f; };
try {
  const good = batch([{ key: s1.key, role: 'warden', ability: A1 }, { key: s2.key, role: 'striker', ability: A2 }], 'good');
  // P1
  const before = await read();
  let r = push(good, true);
  const after1 = await read();
  check('P1 --dry lists each change and writes nothing', r.status === 0 && /2 subject\(s\) would change/.test(r.stdout) && JSON.stringify(after1) === JSON.stringify(before), [r.status, r.stdout, r.stderr]);
  // P2
  r = push(good, false);
  const after2 = await read();
  const r2 = push(good, true);
  check('P2 the push writes {role, name, blocks, silver}; --dry right after shows 0 changes', r.status === 0 && /2 subject\(s\) changed/.test(r.stdout)
    && after2[s1.key]?.role === 'warden' && after2[s1.key]?.silver?.value === 0.4 && after2[s2.key]?.blocks?.[1]?.k === 'on_kill'
    && r2.status === 0 && /0 subject\(s\) would change/.test(r2.stdout), [r.stdout, r.stderr, r2.stdout, after2]);
  // P3
  const badf = batch([{ key: s1.key, role: 'warden', ability: { ...A1, name: 'Tst Other' } }, { key: s2.key, role: 'striker', ability: { name: 'Tst Big', blocks: [{ k: 'hit', x: 2.5 }] } }], 'bad');
  r = push(badf, false);
  const after3 = await read();
  check('P3 one refused row: exit 1, "Refused (nothing written)", the other row is not written either', r.status === 1 && /Refused \(nothing written\)/.test(r.stderr) && /the blocks cost/.test(r.stderr)
    && after3[s1.key]?.name === 'Tst Guard', [r.status, r.stderr, after3[s1.key]?.name]);
  // P4
  const { error } = await supabase.from('subjects').update({ ability_v2: { role: 'warden', name: 'Tst', blocks: [{ k: 'shield', v: 0.9 }] } }).eq('id', s1.id);
  check('P4 the trigger refuses a bad ability written directly', !!error && /subjects\.ability_v2 of/.test(error.message), error?.message);
  // P5
  const twice = batch([{ key: s1.key, role: 'warden', ability: A1 }, { key: s1.key, role: 'warden', ability: A1 }], 'twice');
  const norole = batch([{ key: s1.key, ability: A1 }], 'norole');
  const a = push(twice, false), b = push(norole, false);
  check('P5 a key twice and a row with no role are refused before any write', a.status === 1 && /twice/.test(a.stderr) && b.status === 1 && /needs key, role and ability/.test(b.stderr), [a.stderr, b.stderr]);
  // P6 to P9 (plan 20.10): the measured active factor of the Hunt auto-pick, when combat_v2_autopick_active.sql is on the copy (else SKIP)
  const probe2 = await supabase.from('subjects').update({ ability_v2: { role: 'warden', ...A1, pick_factor: 1.05 } }).eq('id', s1.id);
  if (probe2.error && /unknown key pick_factor/.test(probe2.error.message)) console.log('SKIP P6 to P9: the trigger does not take pick_factor yet (apply combat_v2_autopick_active.sql)');
  else {
    if (probe2.error) check('P6 a valid active with pick_factor 1.05 is accepted by the trigger', false, probe2.error.message);
    const ffile = (rows, name) => { const f = join(dir, `${name}.factors.json`); writeFileSync(f, JSON.stringify({ rows })); return f; };
    const fgood = ffile([{ key: s1.key, role: 'warden', active: activeHash('warden', A1.blocks), pick_factor: 1.08 }], 'good');
    r = pushF(good, fgood, false);
    const after6 = await read();
    const d6 = pushF(good, fgood, true), d6n = push(good, true);
    check('P6 --factors writes pick_factor with the active of the support row only; --dry with the file shows 0 changes, without it 1 (the factor would go)',
      r.status === 0 && after6[s1.key]?.pick_factor === 1.08 && after6[s1.key]?.name === 'Tst Guard' && !('pick_factor' in (after6[s2.key] || {}))
      && /1 of 1 support row\(s\) have a pick_factor/.test(r.stdout) && /0 subject\(s\) would change/.test(d6.stdout) && /1 subject\(s\) would change/.test(d6n.stdout), [r.status, r.stdout, r.stderr, d6.stdout, d6n.stdout, after6]);
    const fstale = ffile([{ key: s1.key, role: 'warden', active: activeHash('warden', [{ k: 'shield', v: 0.25, to: 'most_hurt' }]), pick_factor: 1.2 }], 'stale');
    const fatt = ffile([{ key: s2.key, role: 'striker', active: activeHash('striker', A2.blocks), pick_factor: 1.2 }], 'att');
    const r7 = pushF(good, fstale, false), r7b = pushF(good, fatt, false);
    const after7 = await read();
    check('P7 a factors file of a changed active or with an attacker row is refused: exit 1, nothing written',
      r7.status === 1 && /the factors file does not match the batch/.test(r7.stderr) && /the active changed/.test(r7.stderr) && r7b.status === 1 && /attacker/.test(r7b.stderr)
      && after7[s1.key]?.pick_factor === 1.08, [r7.stderr, r7b.stderr, after7[s1.key]]);
    const { error: e8 } = await supabase.from('subjects').update({ ability_v2: { ...after7[s1.key], pick_factor: 3 } }).eq('id', s1.id);
    check('P8 the trigger refuses pick_factor 3 written directly', !!e8 && /pick_factor must be a number from 0.5 to 2/.test(e8.message), e8?.message);
    r = push(good, false);
    const after9 = await read();
    check('P9 the factor belongs to the active: a push without --factors removes it', r.status === 0 && after9[s1.key]?.name === 'Tst Guard' && !('pick_factor' in after9[s1.key]), [r.stdout, after9[s1.key]]);
  }
} finally {
  // Put back the old ability_v2 and CHECK each write: under load an update can fail, and an ignored error left a test ability on the copy.
  for (const s of [s1, s2]) {
    const err = await restore(s);
    if (err) {
      fails++; n++;
      console.log(`FAIL restore FAILED for subject id ${s.id} (${s.key}) after ${RESTORE_TRIES} tries: ${err}`);
      console.log(`  The copy keeps a test ability. Run: update public.subjects set ability_v2 = ${s.ability_v2 == null ? 'null' : `'${JSON.stringify(s.ability_v2).replace(/'/g, "''")}'::jsonb`} where id = ${s.id};`);
    }
  }
  rmSync(dir, { recursive: true, force: true });
}
const restored = await read();
check('the two subjects have their old ability_v2 again', JSON.stringify(restored[s1.key] ?? null) === JSON.stringify(s1.ability_v2 ?? null) && JSON.stringify(restored[s2.key] ?? null) === JSON.stringify(s2.ability_v2 ?? null), restored);
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
