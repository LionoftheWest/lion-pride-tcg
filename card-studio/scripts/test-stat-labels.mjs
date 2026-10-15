import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/f3_stat_labels.sql (the stat names say what they do, F-3 item 9 + 11), NO lasting change (one DO block; the
 * final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-stat-labels.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                      must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                         runs every mutation, one line each
 * Invariants:
 *   1. The key has the five stats with the names Attack, Health, Crit, Support, Recharge (Nathan, 2026-10-11) and a short of 1 to 4 letters.
 *      The stored stat keys (stat_points: attack, vitality, precision, potency, haste) do not change, and card_combat is the same.
 *   2. stat_labels() has the numbers of balance stat_points in the texts ("Recharge: supports are ready sooner (-4% cooldown for each point)"), and a
 *      change of stat_points moves the text (haste 0.075 gives -7.5%, attack 0.1 gives +10%).
 *   3. The limits refuse: a lost stat, an extra key, a label of 0 or 13 characters, a short of 0 or 5, a text with no {n} or two {n}, a value that is
 *      not an object. A valid rename is accepted.
 *   4. A second run of the file keeps a changed value (idempotent), and the key has a note.
 *   5. The Activity (tcg-activity/src/stat-labels.js, statLabelsFrom) gives the same words and numbers as the SQL function.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_stat_labels.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  oldname: ["'label', 'Health'", "'label', 'Vitality'"],
  oldname2: ["'label', 'Recharge'", "'label', 'Haste'"],
  oldname3: ["'label', 'Support'", "'label', 'Potency'"],
  oldname4: ["'label', 'Crit'", "'label', 'Precision'"],
  nopct: ["round((s.value->>l.key)::numeric * 100, 1)", "round((s.value->>l.key)::numeric * 10, 1)"],
  wrongkey: ["(s.value->>l.key)::numeric * 100", "(s.value->>'attack')::numeric * 100"],
  lim_label: ['not between 1 and 12 or v->>\'label\'', 'not between 0 and 99 or v->>\'label\''],
  lim_short: ['not between 1 and 4 or v->>\'short\'', 'not between 0 and 99 or v->>\'short\''],
  lim_n: ["length(v->>'text') - length(replace(v->>'text', '{n}', '')) <> 3", 'false'],
  lim_five: ['<> 5 then', '<> 5 and false then'],
  overwrite: ['on conflict (key) do nothing', 'on conflict (key) do update set value = excluded.value'],
  notrigger: ['create trigger balance_check_stat_labels before insert or update on public.balance', 'create trigger balance_check_stat_labels before delete on public.balance'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /FAILED/.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(11)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$
declare res jsonb := '[]'; v jsonb; raw jsonb; sp jsonb; cmb jsonb; k text; ok boolean; before jsonb; i int;
  bad text[] := array[]::text[];
  stats text[] := array['attack', 'vitality', 'precision', 'potency', 'haste'];
  names text[] := array['Attack', 'Health', 'Crit', 'Support', 'Recharge'];
begin
  -- The state before the file, also when the file is already applied on this copy: no key (the trigger is off for this step).
  alter table public.balance disable trigger user;
  delete from balance where key = 'stat_labels';
  alter table public.balance enable trigger user;
  execute $m$${mig}$m$;
  select value into raw from balance where key = 'stat_labels';
  -- The per-point values of 2026-09-29 are put back inside this rolled-back block: the test checks the keys and the texts, not the live tuning
  -- (stat_points_r_stars_s1.sql changes them).
  update balance set value = value || '{"attack": 0.05, "vitality": 0.06, "precision": 0.03, "potency": 0.05, "haste": 0.04}'::jsonb where key = 'stat_points';
  select value into sp from balance where key = 'stat_points';

  -- 1. the names, the shorts, the stored keys, card_combat
  ok := true;
  for i in 1..5 loop
    if raw->stats[i]->>'label' is distinct from names[i] or length(raw->stats[i]->>'short') not between 1 and 4 then ok := false; end if;
  end loop;
  res := res || jsonb_build_object('case', 'the five names are Attack, Health, Crit, Support, Recharge (the stored keys stay)', 'ok', ok and (select count(*) from jsonb_object_keys(raw)) = 5, 'raw', raw);
  res := res || jsonb_build_object('case', 'the stat_points keys are unchanged', 'ok', sp ?& stats and (sp->>'haste')::numeric = 0.04 and (sp->>'attack')::numeric = 0.05);
  cmb := card_combat('gold', 3, 1.0, '{"haste":5,"attack":2}');
  res := res || jsonb_build_object('case', 'card_combat is unchanged by the key (haste 5 = 0.8, attack 2 = +10% cp)', 'ok', (cmb->>'haste')::numeric = 0.8 and (cmb->>'cp')::int = round(card_cp_exact('gold', 3, 1.0) * 1.10)::int, 'cmb', cmb);
  res := res || jsonb_build_object('case', 'the key has a note', 'ok', (select length(note) > 100 from balance where key = 'stat_labels'));

  -- 2. the numbers come from stat_points
  v := stat_labels();
  res := res || jsonb_build_object('case', 'stat_labels(): Recharge text with the number of stat_points',
    'ok', v->'haste'->>'label' = 'Recharge' and v->'haste'->>'text' = 'supports are ready sooner (-4% cooldown for each point)'
      and v->'attack'->>'text' like '%+5% attack power%' and v->'vitality'->>'text' like '%+6% HP%' and v->'precision'->>'text' like '%+3% chance%'
      and v->'potency'->>'text' like '%+5% heal%' and (select count(*) from jsonb_object_keys(v)) = 5 and v::text not like '%{n}%', 'v', v);
  update balance set value = value || '{"haste": 0.075, "attack": 0.1}'::jsonb where key = 'stat_points';
  v := stat_labels();
  res := res || jsonb_build_object('case', 'a change of stat_points moves the text (haste 7.5, attack 10)',
    'ok', v->'haste'->>'text' like '%-7.5% cooldown%' and v->'attack'->>'text' like '%+10% attack power%', 'v', v);
  update balance set value = sp where key = 'stat_points';

  -- 3. the limits
  for k, v in select * from (values
    ('lost stat',       raw - 'haste'),
    ('extra key',       raw || '{"speed": {"label": "Speed", "short": "SPD", "text": "x (+{n}%)"}}'::jsonb),
    ('label empty',     jsonb_set(raw, '{attack,label}', '""')),
    ('label 13',        jsonb_set(raw, '{attack,label}', '"abcdefghijklm"')),
    ('short empty',     jsonb_set(raw, '{attack,short}', '""')),
    ('short 5',         jsonb_set(raw, '{attack,short}', '"ABCDE"')),
    ('text no n',       jsonb_set(raw, '{attack,text}', '"hits harder for each point"')),
    ('text two n',      jsonb_set(raw, '{attack,text}', '"hits {n}% harder, {n}% more"')),
    ('not an object',   jsonb_set(raw, '{attack}', '"Attack"')),
    ('label a number',  jsonb_set(raw, '{attack,label}', '5'))
  ) x(k, v) loop
    begin update balance set value = v where key = 'stat_labels'; bad := bad || k;
    exception when others then null; end;
  end loop;
  res := res || jsonb_build_object('case', 'the limits refuse ten wrong values', 'ok', cardinality(bad) = 0, 'accepted', bad);
  ok := false;
  begin update balance set value = jsonb_set(raw, '{haste,label}', '"Cooldown"') where key = 'stat_labels'; ok := true; exception when others then ok := false; end;
  res := res || jsonb_build_object('case', 'a valid rename is accepted', 'ok', ok and (select value->'haste'->>'label' from balance where key = 'stat_labels') = 'Cooldown');

  -- 4. idempotent: the second run keeps the changed value
  execute $m$${mig}$m$;
  res := res || jsonb_build_object('case', 'a second run keeps a changed value', 'ok', (select value->'haste'->>'label' from balance where key = 'stat_labels') = 'Cooldown');

  -- 5. the same answer for the Activity: the raw rows and the SQL answer
  alter table public.balance disable trigger user;
  update balance set value = raw where key = 'stat_labels';
  alter table public.balance enable trigger user;
  res := res || jsonb_build_object('case', 'PARITY', 'ok', true, 'raw', raw, 'sp', sp, 'sql', stat_labels());
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (name === 'PARITY') {
    const { statLabelsFrom } = await import('../../tcg-activity/src/stat-labels.js');
    const js = statLabelsFrom({ stat_labels: rest.raw, stat_points: rest.sp });
    const keys = (o) => Object.keys(o).sort();
    const same = JSON.stringify(keys(js)) === JSON.stringify(keys(rest.sql)) && keys(js).length === 5 && keys(js).every((k) => JSON.stringify(js[k], ['label', 'short', 'text']) === JSON.stringify(rest.sql[k], ['label', 'short', 'text']));
    if (!same) fail++;
    console.log(`${same ? 'PASS' : 'FAIL'} the Activity (statLabelsFrom) gives the same words and numbers as stat_labels()${same ? '' : ' ' + JSON.stringify({ js, sql: rest.sql }).slice(0, 600)}`);
    continue;
  }
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
