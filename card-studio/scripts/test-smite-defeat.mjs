/**
 * A Smite support play that kills the boss must write exactly ONE 'defeat' row to hunt_events
 * (the bot posts the defeat/prize message from it, hunt-notify.ts), with the same payload as
 * hunt_attack (name, tier, settle, top). A Smite that does not kill writes none, and a later
 * attack or support play on the dead boss writes no second one (audit_fixes_2026_10_03.sql).
 * Rolled back:  node scripts/test-smite-defeat.mjs [path/to/sql]
 * Without an argument it tests the LIVE function (the baseline).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { GATE, mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv[2] ? readFileSync(process.argv[2], 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
const P = '999999999999999971';
// MUTATE=nodefeat|noguard node scripts/test-smite-defeat.mjs   must FAIL.
const SUP = 'public.hunt_support(text,bigint,bigint,bigint)';
const MUT = mutation({
  nodefeat: [SUP, "    if v_status = 'defeated' then\n      v_settle := settle_hunt(p_hunt);", '    if false then\n      v_settle := settle_hunt(p_hunt);'],
  noguard: [SUP, "  if v_status <> 'active' or now() >= v_closes then return", '  if false then return'],
});
const body = String.raw`do $t$
declare res jsonb := '[]'; h bigint; h2 bigint; sm bigint; r jsonb; r2 jsonb; r3 jsonb; ev jsonb; n int;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the live function'}
  ${MUT}
  perform set_config('tcg.skip_welcome', 'on', true);
  select c.id into sm from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and s.ability->>'effect' = 'smite' order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst smite');
  insert into player_cards (player_id, card_id, quantity) values ('${P}', sm, 1);
  ${GATE(P)}

  -- A Smite that does NOT kill (a 1,000,000-HP boss): no 'defeat' row.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Big Boss', 'Normal', '[]', '[]', 1000000, 1000000, now() + interval '1 day') returning id into h2;
  r := hunt_support('${P}', h2, sm);
  res := res || jsonb_build_object('case', 'a Smite that does not kill writes no ''defeat'' row', 'ok',
    (r->>'ok')::boolean and not (r->>'defeated')::boolean
    and not exists (select 1 from hunt_events where hunt_id = h2 and kind = 'defeat'), 'r', r);

  -- A Smite that kills (a 10-HP boss; a Smite does at least 200).
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Smite Boss', 'Normal', '[]', '[]', 10, 10, now() + interval '1 day') returning id into h;
  r := hunt_support('${P}', h, sm);
  res := res || jsonb_build_object('case', 'the killing Smite defeats the boss and settles it', 'ok',
    (r->>'ok')::boolean and (r->>'defeated')::boolean
    and (select status = 'defeated' and settled_at is not null from hunts where id = h), 'r', r);
  select count(*) into n from hunt_events where hunt_id = h and kind = 'defeat';
  res := res || jsonb_build_object('case', 'the killing Smite writes exactly one ''defeat'' hunt_events row', 'ok', n = 1, 'n', n);
  select payload into ev from hunt_events where hunt_id = h and kind = 'defeat' order by id limit 1;
  res := res || jsonb_build_object('case', 'the payload has the hunt_attack shape (name, tier, settle, top) and the smiter on top', 'ok',
    coalesce(ev->>'name' = 'Test Smite Boss' and ev->>'tier' = 'Normal' and (ev->'settle'->>'ok')::boolean
      and ev->'top'->0->>'player_id' = '${P}', false), 'payload', ev);

  -- After the kill: a later attack and a later support play are refused, still one row.
  r2 := hunt_attack('${P}', h, sm);
  r3 := hunt_support('${P}', h, sm);
  select count(*) into n from hunt_events where hunt_id = h and kind = 'defeat';
  res := res || jsonb_build_object('case', 'a later attack / support play is ''hunt_over'' and writes no second ''defeat'' row', 'ok',
    r2->>'error' = 'hunt_over' and r3->>'error' = 'hunt_over' and n = 1, 'n', n, 'r2', r2, 'r3', r3);
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
