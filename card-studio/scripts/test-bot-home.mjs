/**
 * NO-SERVER P0b gate C9: tcg-bot/supabase/bot_home.sql (the settings row bot_home, its trigger, bot_home_state()).
 * Everything runs in ONE transaction that always rolls back (the RESULTS exception), on the LOCAL copy:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-bot-home.mjs [file.sql]    (default: the repo file)
 *   ... scripts/test-bot-home.mjs --mutate     the baseline and each mutant in the same run; every mutant must FAIL
 * The file is applied inside the transaction first (so the test needs no live state), and then applied AGAIN (re-apply = no change).
 * Cases: the row "backup"; re-apply no change; "elsewhere" refused; (N7-5) admin_setting_set, a raw update, a delete and a key
 * rename without the writer setting are refused; the bot-home.mjs statement works; (a) the row made old with the trigger off,
 * then a write -> age_s < 5; (b) after pg_sleep(6) in the same transaction a write -> age_s < 5 (clock_timestamp, not now());
 * another key keeps its own updated_at; bot_home_state() is security definer with a search_path, EXECUTE for service_role only;
 * a missing row -> null.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { writeSql } from './bot-home.mjs';

if (process.env.LOCALDB !== '1') { console.error('test-bot-home: run it on the LOCAL copy (LOCALDB=1 with the preload)'); process.exit(2); }
const REPO_SQL = fileURLToPath(new URL('../../tcg-bot/supabase/bot_home.sql', import.meta.url));

if (process.argv.includes('--mutate')) {
  const src = readFileSync(REPO_SQL, 'utf8').replace(/\r\n/g, '\n');
  const dir = mkdtempSync(join(tmpdir(), 'c9-'));
  const run = (file) => spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...(file ? [file] : [])], { encoding: 'utf8', env: process.env });
  const base = run(null);
  console.log(`baseline: ${base.stdout.trim().split('\n').pop()}`);
  if (base.status !== 0) { console.log(base.stdout); console.log('FAIL the baseline is RED: no mutation result is valid'); process.exit(1); }
  const MUT = [
    ['no updated_at in the trigger', 'a', '    new.updated_at := clock_timestamp();\n', ''],
    ['now() in the trigger', 'b', 'new.updated_at := clock_timestamp();', 'new.updated_at := now();'],
    ['any value allowed', 'elsewhere', `(new.value #>> '{}') not in ('backup', 'office')`, 'false'],
    ['no writer check (N7-5)', 'admin', `    if coalesce(current_setting('lptcg.bot_home_writer', true), '') <> 'bot-home.mjs' then`, '    if false then'],
    ['no search_path on bot_home_state', 'search_path', 'language sql stable security definer set search_path = public, pg_temp as $$', 'language sql stable security definer as $$'],
    ['EXECUTE granted to anon', 'grants', 'grant execute on function public.bot_home_state() to service_role;', 'grant execute on function public.bot_home_state() to service_role, anon;'],
  ];
  let bad = 0;
  for (const [name, want, from, to] of MUT) {
    if (!src.includes(from)) { console.log(`FAIL mutant "${name}": the text does not match bot_home.sql`); bad++; continue; }
    const f = join(dir, `${want}.sql`); writeFileSync(f, src.replace(from, () => to));
    const r = run(f); const failed = [...r.stdout.matchAll(/^FAIL \[([^\]]+)\]/gm)].map((m) => m[1]);
    if (r.status !== 0 && failed.includes(want)) console.log(`PASS mutant "${name}" FAILED-AS-EXPECTED (failed: ${failed.join(', ')})`);
    else { console.log(`FAIL mutant "${name}" SURVIVED (want [${want}] to fail; failed: ${failed.join(', ') || 'none'})`); bad++; }
  }
  console.log(bad ? `NOS-C9 MUTATE FAILS ${bad}` : `NOS-C9 MUTATE PASS (${MUT.length} of ${MUT.length} mutants failed)`);
  process.exit(bad ? 1 : 0);
}

const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})).json();

const mig = readFileSync(process.argv[2] || REPO_SQL, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const W_OFFICE = writeSql('office').replace(/;\s*$/, ''), W_BACKUP = writeSql('backup').replace(/;\s*$/, '');
const body = String.raw`do $t$
declare res jsonb := '[]'; s jsonb; t0 timestamptz; t1 timestamptz; v jsonb; st text; m text; h text; n int;
begin
  perform pg_sleep(6);  -- (b): now() is the transaction start, 6 s before every write below
  execute $m$${mig}$m$;
  select value, updated_at into v, t0 from settings where key = 'bot_home';
  res := res || jsonb_build_object('case', '[row] the row bot_home is "backup"', 'ok', v = '"backup"'::jsonb, 'r', v);
  res := res || jsonb_build_object('case', '[row] the migration leaves no writer setting behind', 'ok',
    coalesce(current_setting('lptcg.bot_home_writer', true), '') = '', 'r', current_setting('lptcg.bot_home_writer', true));
  execute $m$${mig}$m$;
  perform set_config('lptcg.bot_home_writer', '', true);
  select value, updated_at, (select count(*) from settings where key = 'bot_home') into v, t1, n from settings where key = 'bot_home';
  res := res || jsonb_build_object('case', '[reapply] a re-apply changes nothing (value, updated_at, 1 row)', 'ok', v = '"backup"'::jsonb and t1 = t0 and n = 1, 'r', jsonb_build_object('v', v, 't0', t0, 't1', t1, 'n', n));

  -- N7-5: the Admin settings editor, a raw update, a delete and a key rename are refused without the writer setting.
  st := null; m := null;
  begin perform admin_setting_set('tst-c9', 'bot_home', null, '"backup"', '"office"', 'tst c9 admin move'); exception when others then st := sqlstate; m := sqlerrm; end;
  res := res || jsonb_build_object('case', '[admin] admin_setting_set on bot_home -> refused by the trigger (LP403)', 'ok', st = 'LP403' and m like 'bot_home: only%', 'r', jsonb_build_object('st', st, 'm', m));
  st := null; begin update settings set value = '"office"' where key = 'bot_home'; exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', '[admin] a raw update with no writer setting -> refused (LP403)', 'ok', st = 'LP403', 'r', st);
  st := null; begin delete from settings where key = 'bot_home'; exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', '[admin] a delete with no writer setting -> refused (LP403)', 'ok', st = 'LP403', 'r', st);
  st := null; begin update settings set key = 'bot_home_x' where key = 'bot_home'; exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', '[admin] a key rename with no writer setting -> refused (LP403)', 'ok', st = 'LP403', 'r', st);
  select value into v from settings where key = 'bot_home';
  res := res || jsonb_build_object('case', '[admin] the row is still "backup" after the refused writes', 'ok', v = '"backup"'::jsonb, 'r', v);

  -- the value check (with the writer setting)
  st := null;
  begin perform set_config('lptcg.bot_home_writer', 'bot-home.mjs', true); update settings set value = '"elsewhere"' where key = 'bot_home';
  exception when others then st := sqlstate; end;
  perform set_config('lptcg.bot_home_writer', '', true);
  res := res || jsonb_build_object('case', '[elsewhere] "elsewhere" -> refused (LP400)', 'ok', st = 'LP400', 'r', st);
  st := null;
  begin perform set_config('lptcg.bot_home_writer', 'bot-home.mjs', true); update settings set value = '{"home":"office"}' where key = 'bot_home';
  exception when others then st := sqlstate; end;
  perform set_config('lptcg.bot_home_writer', '', true);
  res := res || jsonb_build_object('case', '[elsewhere] an object value -> refused (LP400)', 'ok', st = 'LP400', 'r', st);

  -- (a) the row made old with the trigger off, then the bot-home.mjs statement -> age_s < 5
  alter table settings disable trigger settings_bot_home_check;
  update settings set updated_at = now() - interval '1 hour' where key = 'bot_home';
  alter table settings enable trigger settings_bot_home_check;
  s := bot_home_state();
  res := res || jsonb_build_object('case', '[a] the row made old with the trigger off -> age_s >= 3500', 'ok', (s->>'age_s')::int >= 3500, 'r', s);
  execute $w$${W_OFFICE}$w$ into h;
  s := bot_home_state();
  res := res || jsonb_build_object('case', '[a] the bot-home.mjs statement (writer set in its WHERE) moves the row to office', 'ok', h = 'office' and s->>'home' = 'office', 'r', jsonb_build_object('h', h, 's', s));
  res := res || jsonb_build_object('case', '[a] then age_s < 5 (the trigger sets updated_at)', 'ok', (s->>'age_s')::int < 5, 'r', s);
  -- (b) a write 6 s after the transaction start: clock_timestamp(), not now()
  perform set_config('lptcg.bot_home_writer', '', true);
  execute $w$${W_BACKUP}$w$ into h;
  s := bot_home_state();
  res := res || jsonb_build_object('case', '[b] a write 6 s into the transaction -> age_s < 5', 'ok', h = 'backup' and (s->>'age_s')::int < 5, 'r', s);

  -- another key keeps its own updated_at rule (the trigger touches only bot_home)
  insert into settings (key, value, updated_at) values ('tst_c9_other', '1', '2020-01-01T00:00:00Z');
  update settings set value = '2' where key = 'tst_c9_other';
  select updated_at into t1 from settings where key = 'tst_c9_other';
  res := res || jsonb_build_object('case', '[other] another key: an update keeps its updated_at (no trigger change)', 'ok', t1 = '2020-01-01T00:00:00Z'::timestamptz, 'r', t1);

  -- the function: security definer, search_path, EXECUTE for service_role only
  res := res || jsonb_build_object('case', '[search_path] bot_home_state and the trigger function have a search_path; bot_home_state is security definer', 'ok',
    (select bool_and(coalesce(array_to_string(proconfig, ','), '') like '%search_path=%') from pg_proc where oid in ('public.bot_home_state()'::regprocedure, 'public.settings_bot_home_check()'::regprocedure))
    and (select prosecdef from pg_proc where oid = 'public.bot_home_state()'::regprocedure), 'r', null);
  res := res || jsonb_build_object('case', '[grants] bot_home_state EXECUTE: service_role yes; anon, authenticated, public no', 'ok',
    has_function_privilege('service_role', 'public.bot_home_state()', 'execute')
    and not has_function_privilege('anon', 'public.bot_home_state()', 'execute')
    and not has_function_privilege('authenticated', 'public.bot_home_state()', 'execute')
    and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.bot_home_state()'::regprocedure and a.grantee = 0), 'r', null);
  st := null; begin execute 'set local role anon'; perform bot_home_state(); exception when others then st := sqlstate; end;
  execute 'reset role';
  res := res || jsonb_build_object('case', '[grants] anon calling bot_home_state() -> permission denied (42501)', 'ok', st = '42501', 'r', st);

  -- a missing row -> null (the deploy reads null as "unreadable")
  perform set_config('lptcg.bot_home_writer', 'bot-home.mjs', true);
  delete from settings where key = 'bot_home';
  perform set_config('lptcg.bot_home_writer', '', true);
  res := res || jsonb_build_object('case', '[missing] no row -> bot_home_state() is null', 'ok', bot_home_state() is null, 'r', bot_home_state());
  raise exception 'RESULTS %', res;
end $t$;`;

const ans = await q(body);
const mm = String(ans?.message || '').match(/RESULTS (\[.*\])/);
if (!mm) { console.log('FAIL [run] NO RESULTS:', JSON.stringify(ans).slice(0, 1500)); process.exit(1); }
const results = JSON.parse(mm[1]);
let fail = 0;
for (const x of results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ` ${JSON.stringify(x.r)}`}`); }
console.log(fail ? `NOS-C9 FAILS ${fail} of ${results.length}` : `NOS-C9 PASS cases=${results.length}`);
process.exitCode = fail ? 1 : 0;
