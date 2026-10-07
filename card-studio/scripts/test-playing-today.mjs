/**
 * Acceptance test for tcg-bot/supabase/playing_posts.sql (rolled back, no lasting change):
 *   node scripts/test-playing-today.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/playing_posts.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const body = String.raw`do $t$
declare res jsonb := '[]'; v jsonb; g bigint; n1 bigint; old bigint; h bigint;
begin
  execute $m$${mig}$m$;
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username, avatar) values ('999999999999999921', 'tst play', 'abc');
  select id into g from cards where rarity::text = 'gold' order by id limit 1;
  select id into n1 from cards where rarity::text = 'normal' order by id limit 1;
  select id into old from cards where rarity::text = 'full_art' order by id limit 1;
  v := playing_today('999999999999999921');
  res := res || jsonb_build_object('case', 'nothing today: no best, 0 packs, 0 damage, the setting on', 'ok',
    v->'best' = 'null'::jsonb and (v->>'packs')::int = 0 and (v->>'damage')::int = 0 and v->>'playing_pref' = 'true', 'v', v);
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values
    ('999999999999999921', n1, 1, now()), ('999999999999999921', g, 1, now() - interval '1 minute'),
    ('999999999999999921', old, 1, now() - interval '3 days');
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values ('999999999999999921', -1, 'opened', 'open', 'tst-1'), ('999999999999999921', -1, 'opened', 'open', 'tst-2'), ('999999999999999921', 10, 'welcome', 'test', 'playing-today');
  h := spawn_hunt(3);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, '999999999999999921', g, (now() at time zone 'utc')::date, 1200), (h, '999999999999999921', n1, (now() at time zone 'utc')::date, 80);
  v := playing_today('999999999999999921');
  res := res || jsonb_build_object('case', 'best = the gold card of today (not the older full art, not the newer normal); 2 packs; 1,280 damage', 'ok',
    (v->'best'->>'id')::bigint = g and (v->>'packs')::int = 2 and (v->>'damage')::int = 1280, 'v', v);
  update players set notify_prefs = '{"playing": false}' where id = '999999999999999921';
  res := res || jsonb_build_object('case', 'Show when I play off: the setting says false', 'ok', playing_today('999999999999999921')->>'playing_pref' = 'false');
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2000)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 600)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like '9999999999999999%') test_players, (select count(*) from information_schema.tables where table_name='playing_posts') table_live")));
process.exitCode = fail ? 1 : 0;
