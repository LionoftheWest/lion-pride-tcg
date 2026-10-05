/**
 * Acceptance test for hunt_damage_trace.sql (Hunt damage is traceable). Rolled back, on a PRIVATE
 * test boss row (never the live boss):
 *   node scripts/test-hunt-damage-trace.mjs          the migration file, executed inside the block
 *   node scripts/test-hunt-damage-trace.mjs --old    the database as it is (the baseline: before the
 *                                                    migration it has no reconcile, so it FAILS)
 * Invariant: hunt_hits = hunt_combat_log + hunt_adjustments + Smite + Raid Crasher, per player.
 * Any other change to hunt_hits shows as "unexplained".
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const mig = old ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_damage_trace.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const P = 'tst_trace_a', S = 'tst_trace_s';
const body = String.raw`do $t$
declare res jsonb := '[]'; h bigint; atk bigint[]; sm bigint; cr bigint; c bigint; r jsonb; i int; n int;
  rec record; v_day date := (now() at time zone 'America/Denver')::date; ok boolean;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  -- A private boss (rolled back). The live boss is never read or written here.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Trace Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into h;
  select array_agg(id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character','Creature') and s.ability->>'kind' = 'attack' and c.rarity = 'normal' order by c.id limit 8) x;  -- 8 owned attackers: the adventure gate
  select c.id into sm from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and s.ability->>'effect' = 'smite' order by c.id limit 1;
  select c.id into cr from cards c join subjects s on s.id = c.subject_id where s.effect->>'primitive' = 'raid_crasher' order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst trace'), ('${S}', 'tst trace sender');
  insert into player_cards (player_id, card_id, quantity) select '${P}', x, 1 from unnest(atk || sm) x;
  r := lock_hunt_squad('${P}', h, atk[1:3] || sm);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'squad lock refused: %', r; end if;

  -- 1. Attacks only: everything is logged, unexplained 0.
  foreach c in array atk[1:3] loop
    for i in 1..3 loop r := hunt_attack('${P}', h, c); end loop;
  end loop;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'attacks only: hits = logged > 0, unexplained 0', 'ok',
    coalesce(rec.hits > 0 and rec.hits = rec.logged and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 2. A Smite (support card, no log row): counted as smite, unexplained still 0.
  r := hunt_support('${P}', h, sm);
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'a Smite is counted as smite, unexplained 0', 'ok',
    coalesce((r->>'ok')::boolean and rec.smite > 0 and rec.unexplained = 0, false), 'r', r, 'row', to_jsonb(rec));

  -- 3. A Raid Crasher credit (the row hunt_attack writes for the prankster on the Raider card).
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, '${S}', cr, v_day, 40);
  select * into rec from hunt_damage_reconcile(h) where player_id = '${S}';
  res := res || jsonb_build_object('case', 'a Raid Crasher credit row is counted as crasher, unexplained 0', 'ok',
    coalesce(rec.crasher = 40 and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 4. A manual change of hunt_hits (+100) with no record: unexplained 100.
  update hunt_hits set damage = damage + 100 where hunt_id = h and player_id = '${P}' and card_id = atk[1] and hit_date = v_day;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'a manual +100 on hunt_hits shows unexplained 100', 'ok',
    coalesce(rec.unexplained = 100, false), 'row', to_jsonb(rec));

  -- 5. An adjustment row of +100 explains it: unexplained 0 again.
  insert into hunt_adjustments (hunt_id, player_id, hit_date, damage, reason) values (h, '${P}', v_day, 100, 'oct1_squad_bug');
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'an adjustment row of +100 brings unexplained back to 0', 'ok',
    coalesce(rec.adjusted = 100 and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 6. A reason that is not on the list is refused.
  begin
    insert into hunt_adjustments (hunt_id, player_id, hit_date, damage, reason) values (h, '${P}', v_day, 5, 'made_up_reason');
    ok := false;
  exception when check_violation then ok := true;
  end;
  res := res || jsonb_build_object('case', 'a bad reason is refused (check constraint)', 'ok', ok);

  -- 7. The defeated first Hunt (101698, if present): the cut row exists once and nothing is unexplained.
  if exists (select 1 from hunts where id = 101698) then
    select count(*) into n from hunt_adjustments where hunt_id = 101698 and reason = 'oct2_heal_loop_cut' and damage = -10926;
    select count(*) filter (where unexplained <> 0) into i from hunt_damage_reconcile(101698);
    res := res || jsonb_build_object('case', 'hunt 101698: one oct2_heal_loop_cut row, 0 players with unexplained damage', 'ok',
      n = 1 and i = 0, 'cut_rows', n, 'players_unexplained', i);
  end if;
  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;
const out = await q(body);
let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
const m = msg.match(/RESULTS (\[.*\])/);
if (!m) { console.log('FAIL NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const results = JSON.parse(m[1]);
let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r)}`); }
console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
process.exitCode = fail ? 1 : 0;
