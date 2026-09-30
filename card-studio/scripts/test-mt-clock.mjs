/**
 * Acceptance test for tcg-bot/supabase/mt_clock.sql against the LIVE database with NO
 * lasting change:  node scripts/test-mt-clock.mjs
 * The day must start at midnight Mountain Time everywhere. The test puts events at 23:59
 * MT yesterday (the same UTC day as now for most of the day), which a UTC day counts as
 * today and an MT day does not. It RAISEs the results, so everything rolls back.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/mt_clock.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const P = '999999999999999931', Q = '999999999999999932';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; v jsonb; left_utc text; mt date; mt0 timestamptz; late timestamptz; c1 bigint; c2 bigint; h bigint; used int;
begin
  execute $m$${mig}$m$;
  mt := (now() at time zone 'America/Denver')::date;
  mt0 := mt::timestamp at time zone 'America/Denver';          -- midnight MT today
  late := mt0 - interval '1 minute';                            -- 23:59 MT yesterday
  select string_agg(p.proname, ', ') into left_utc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~* 'time zone ''utc''';
  res := res || jsonb_build_object('case', 'no game function uses a UTC day any more', 'ok', left_utc is null, 'left', left_utc);

  update settings set value = '1'::jsonb where key = 'pack_earn_multiplier';
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}', 'tst mt'), ('${Q}', 'tst mt2');
  select id into c1 from cards order by id limit 1;
  select id into c2 from cards where id <> c1 order by id limit 1;

  -- A chat pack at 23:59 MT yesterday is not "today"; one now is.
  insert into pack_ledger (player_id, amount, reason, created_at) values ('${P}', 1, 'earned_daily', late), ('${P}', 1, 'earned_daily', now());
  res := res || jsonb_build_object('case', 'earned today counts from midnight MT (a pack at 23:59 MT yesterday is not today)', 'ok', earned_today('${P}') = 1, 'got', earned_today('${P}'));

  -- A trade at 23:59 MT yesterday does not do today's social daily.
  insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status, resolved_at) values ('${P}', '${Q}', c1, c2, 'accepted', late);
  v := dailies_view('${P}');
  res := res || jsonb_build_object('case', 'a trade at 23:59 MT yesterday is not today''s trade daily', 'ok',
    not (select (x->>'done')::boolean from jsonb_array_elements(v->'tasks') x where x->>'task' = 'social'));
  res := res || jsonb_build_object('case', 'the Dailies day is the MT date and resets at the next midnight MT', 'ok',
    (v->>'day')::date = mt and (v->>'resets_at')::timestamptz = (mt + 1)::timestamp at time zone 'America/Denver', 'day', v->'day', 'resets_at', v->'resets_at');

  r := claim_daily('${P}', 'checkin');
  res := res || jsonb_build_object('case', 'a check-in is stored on the MT date', 'ok',
    (r->>'ok')::boolean and (select day from daily_claims where player_id = '${P}' and task = 'checkin') = mt, 'r', r);
  perform add_voice_minutes(array['${P}']);
  res := res || jsonb_build_object('case', 'voice minutes are stored on the MT date', 'ok', (select day from voice_minutes where player_id = '${P}') = mt);

  -- The hunt: a hit is stored on the MT date (the 8-cards-a-day limit uses it).
  insert into player_cards (player_id, card_id, quantity) values ('${P}', c1, 1);
  h := spawn_hunt(3);
  r := hunt_attack('${P}', h, c1);
  res := res || jsonb_build_object('case', 'a hunt hit is stored on the MT date', 'ok',
    (select hit_date from hunt_hits where player_id = '${P}' limit 1) = mt, 'r', r - 'feed');

  res := res || jsonb_build_object('case', 'the stat-point week is the MT ISO week', 'ok',
    (card_stats_for('${P}')->>'week') = to_char(now() at time zone 'America/Denver', 'IYYY-IW'), 'week', card_stats_for('${P}')->'week');
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 600)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '99999999999999993%') test_players, (select value from settings where key='pack_earn_multiplier') dial, (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ~* 'time zone ''utc''') live_utc_functions")));
process.exitCode = fail ? 1 : 0;
