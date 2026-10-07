/**
 * Acceptance test for tcg-bot/supabase/drop_dead_code.sql. Rolled back (the result comes back in the
 * exception). Run it on the LOCAL copy:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-drop-dead-code.mjs          the file, executed inside the block
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-drop-dead-code.mjs --old    the database as it is (before the file: FAILS)
 *   MUTATE=<name> ...                                                                             one broken part of the file: must FAIL
 * Invariants:
 *   - grant_packs_all, weekly_hunt_rollover, notify_all, dungeon_end and dungeon_days.checked are gone;
 *   - a second run of the file is safe (no error, nothing changes);
 *   - the guards refuse the drop when a function body still calls a function, when a row of
 *     dungeon_days.checked holds a value, or when a function body reads "checked";
 *   - the Dungeon day still builds (dungeon_generate) and its row has no "checked" key;
 *   - pack_ledger_reconcile, card_ledger_reconcile and shard_ledger_reconcile are still ok.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
let mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/drop_dead_code.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '').replace(/\r/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');

// Mutations of the migration text: each one breaks one part of the file.
const MUTATIONS = {
  keepdungeonend: ['drop function if exists public.dungeon_end(bigint, text);', ''],
  keepnotifyall: ['drop function if exists public.notify_all(text, text);', ''],
  keepcolumn: ['alter table if exists public.dungeon_days drop column if exists checked;', ''],
  nofnguard: ["raise exception 'drop_dead_code.sql: % still has a caller (%). Do not drop it.', n, callers;", 'null;'],
  novalueguard: ["raise exception 'drop_dead_code.sql: dungeon_days.checked holds a value. Do not drop it.';", 'null;'],
  noreadguard: ["raise exception 'drop_dead_code.sql: dungeon_days.checked may still be read (%). Do not drop it.', callers;", 'null;'],
};
if (process.env.MUTATE) {
  const m = MUTATIONS[process.env.MUTATE];
  if (!m) throw new Error(`unknown mutation ${process.env.MUTATE}; known: ${Object.keys(MUTATIONS).join(' ')}`);
  if (!mig.includes(m[0])) throw new Error(`MUTATION ${process.env.MUTATE} does not match`);
  mig = mig.replace(m[0], m[1]);
  console.log(`MUTATE=${process.env.MUTATE}`);
}
// The file as one dynamic statement (an empty file in --old mode).
const RUN = mig ? `execute $m$${mig}$m$;` : 'null;';

const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', false, 'r', sqlerrm);
  end;`;
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
// A case that expects the file to REFUSE: the error text must name the reason. The setup rolls back with the case.
const refuses = (name, setup, want) => kase(name, `
    begin
      ${setup}
      ${RUN}
      raise exception 'NOT REFUSED';
    exception when others then
      if sqlerrm = 'NOT REFUSED' or position(${`$c$${want}$c$`} in sqlerrm) = 0 then
        res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', false, 'r', sqlerrm);
      else
        res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', ${OLD ? 'false' : 'true'});
      end if;
    end;`);

const GONE = `to_regprocedure('public.grant_packs_all(integer,text,text)') is null and to_regprocedure('public.weekly_hunt_rollover(integer)') is null
      and to_regprocedure('public.notify_all(text,text)') is null and to_regprocedure('public.dungeon_end(bigint,text)') is null`;
const COLGONE = `not exists (select 1 from pg_attribute where attrelid = 'public.dungeon_days'::regclass and attname = 'checked' and not attisdropped)`;

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; ok boolean; n int;
begin
  ${RUN}
${kase('the four functions are gone (grant_packs_all, weekly_hunt_rollover, notify_all, dungeon_end)', `
    ${done('the four functions are gone (grant_packs_all, weekly_hunt_rollover, notify_all, dungeon_end)', GONE)}`)}
${kase('dungeon_days.checked is gone', `
    ${done('dungeon_days.checked is gone', COLGONE)}`)}
${kase('a second run of the file is safe (no error, the objects stay gone)', `
    ${RUN}
    ${done('a second run of the file is safe (no error, the objects stay gone)', `${GONE} and ${COLGONE}`)}`)}
${refuses('the guard refuses when a function body still calls a dropped function',
    `create function public.tst_ddc_caller() returns int language plpgsql as $f$ begin return notify_all('x', 'y'); end $f$;`,
    'notify_all still has a caller (function tst_ddc_caller()')}
${refuses('the guard refuses when a row of dungeon_days.checked holds a value',
    `alter table public.dungeon_days add column if not exists checked jsonb;
      insert into dungeon_days (day, name, rule, floors) values ('2099-03-01', 'tst', '{}', '[]') on conflict (day) do nothing;
      update dungeon_days set checked = '{}' where day = '2099-03-01';`,
    'dungeon_days.checked holds a value')}
${refuses('the guard refuses when a function body reads checked',
    `alter table public.dungeon_days add column if not exists checked jsonb;
      update dungeon_days set checked = null;
      create function public.tst_ddc_reader() returns jsonb language sql as $f$ select checked from dungeon_days limit 1 $f$;`,
    'dungeon_days.checked may still be read (function tst_ddc_reader()')}
${kase('the Dungeon day still builds, and its row has no checked key', `
    r := dungeon_generate('2099-02-01');
    ${done('the Dungeon day still builds, and its row has no checked key', `r ? 'floors' and not r ? 'checked' and jsonb_array_length(r->'floors') > 0`, ", 'keys', (select jsonb_agg(k) from jsonb_object_keys(r) k)")}`)}
${kase('pack_ledger_reconcile, card_ledger_reconcile and shard_ledger_reconcile are ok', `
    ${done('pack_ledger_reconcile, card_ledger_reconcile and shard_ledger_reconcile are ok', `(pack_ledger_reconcile()->>'ok')::boolean and (card_ledger_reconcile()->>'ok')::boolean and (shard_ledger_reconcile()->>'ok')::boolean`)}`)}
  raise exception 'RESULT:%', res::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = msg.match(/RESULT:(\[.*\])/);
if (!m) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const res = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let fails = 0;
  for (const r of res) { if (!r.ok) fails += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 400)}`); }
  console.log(`\n${OLD ? 'BASELINE (--old) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select (select count(*) from pg_proc where proname like 'tst_ddc_%') as fns, (select count(*) from dungeon_days where day >= '2099-01-01') as days`);
console.log('after (nothing stays):', JSON.stringify(left));
