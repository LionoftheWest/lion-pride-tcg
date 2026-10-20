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
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal } from './lab-lib.mjs';
import { supabase } from '../src/supabase.js';
assertLocal('test-push-abilities-v2.mjs');

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 600)}`); };
const probe = await supabase.from('subjects').select('id, key, ability_v2').order('id').limit(2);
if (probe.error && /ability_v2/.test(probe.error.message)) { console.log('SKIP the column subjects.ability_v2 is not on the local copy: apply combat_v2_ability_builder.sql first'); process.exit(0); }
if (probe.error || probe.data.length < 2) { console.log(`FAIL the local copy has no two subjects (${probe.error?.message})`); process.exit(1); }
const [s1, s2] = probe.data;
const dir = mkdtempSync(join(tmpdir(), 'push-v2-'));
const script = fileURLToPath(new URL('./push-abilities.mjs', import.meta.url));
const push = (file, dry) => spawnSync(process.execPath, [...process.execArgv, script, '--v2', file, ...(dry ? ['--dry'] : [])], { env: { ...process.env, LOCALDB: '1', LOCALDB_QUIET: '1' }, encoding: 'utf8' });
const read = async () => { const { data } = await supabase.from('subjects').select('key, ability_v2').in('id', [s1.id, s2.id]); return Object.fromEntries(data.map((x) => [x.key, x.ability_v2])); };
const A1 = { name: 'Tst Guard', blocks: [{ k: 'shield', v: 0.3, to: 'most_hurt' }, { k: 'ally_below', line: 0.3, x: 2 }], silver: { block: 1, field: 'v', value: 0.4 } };
const A2 = { name: 'Tst Hit', blocks: [{ k: 'hit', x: 1.75 }, { k: 'on_kill', status: 'slowed', chance: 1 }] };
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
} finally {
  for (const s of [s1, s2]) await supabase.from('subjects').update({ ability_v2: s.ability_v2 }).eq('id', s.id);
  rmSync(dir, { recursive: true, force: true });
}
const restored = await read();
check('the two subjects have their old ability_v2 again', JSON.stringify(restored[s1.key] ?? null) === JSON.stringify(s1.ability_v2 ?? null) && JSON.stringify(restored[s2.key] ?? null) === JSON.stringify(s2.ability_v2 ?? null), restored);
console.log(fails ? `${fails} of ${n} FAILED` : `PASS all ${n}`);
process.exitCode = fails ? 1 : 0;
