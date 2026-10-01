/**
 * Acceptance test for tcg-bot/supabase/dailies_hunt_any.sql on the LIVE database, NO lasting
 * change: node scripts/test-dailies-hunt.mjs   (one DO block, the exception rolls it back)
 * The Hunt daily is done after ONE fight with the boss (was 8 distinct cards).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv.includes('--old') ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dailies_hunt_any.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; h bigint; cid bigint; d date := (now() at time zone 'America/Denver')::date; x jsonb;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  insert into players (id, username) values ('tst_dly_1', 'tst daily');
  select id into cid from cards limit 1;
  select id into h from hunts where status = 'active' order by id desc limit 1;
  if h is null then h := spawn_hunt(3); end if;
  select e into x from jsonb_array_elements(dailies_tasks('tst_dly_1')) e where e->>'task' = 'hunt';
  if (x->>'done')::boolean then bad := bad || 'done with 0 fights; '; end if;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, 'tst_dly_1', cid, d, 0);
  select e into x from jsonb_array_elements(dailies_tasks('tst_dly_1')) e where e->>'task' = 'hunt';
  if not (x->>'done')::boolean then bad := bad || 'not done after 1 fight (' || (x->>'have') || '/' || (x->>'need') || '); '; end if;
  if (x->>'need')::int <> 1 then bad := bad || 'need ' || (x->>'need') || '; '; end if;
  raise exception 'RESULTS [%]', bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 800)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: the Hunt daily is done after one fight (0 fights: not done)');
