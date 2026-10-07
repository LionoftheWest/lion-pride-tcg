/**
 * Acceptance test for damage_log.sql (ONE DAMAGE LOG: every point of hunt_hits has one log row). Rolled back, on a
 * PRIVATE test boss row (never the live boss):
 *   node scripts/test-damage-log.mjs              the migration file, executed inside the block
 *   node scripts/test-damage-log.mjs --old        the database as it is (the baseline: it must FAIL before the migration)
 *   node scripts/test-damage-log.mjs --mutations  each mutation of the migration must make at least one case FAIL
 * Invariants:
 *   I1 a Smite play writes a combat_actions row whose result.value = the damage it added to hunt_hits
 *   I2 a Hunt Crasher hit writes a combat_actions row for the prankster (kind effect) = the prankster's hunt_hits share
 *   I3 a Crasher charge with no owner still writes hunt_hits (the attacker, fallback) for the boss damage it did
 *   I4 hunt_damage_reconcile: hits = logged + smite + crasher + adjusted; unexplained = 0 with no special case
 *   I5 a mirrored Smite (no boss damage) counts 0
 *   I6 a hunt_hits change with no log row shows as unexplained
 *   I7 the backfill writes a proven row for old Smite / Crasher damage, once
 *   I8 a re-run of the file leaves hunt_attack identical
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const src = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/damage_log.sql', import.meta.url)), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');

// One mutation per invariant (the guard also accepts the mutated text, so the file can run).
const MUTATIONS = {
  'I2 no Crasher log row': ['  if v_dmg > 0 and v_crash_dmg > 0 then\n    insert into combat_actions', '  if false then\n    insert into combat_actions'],
  'I3 no fallback': ['v_crash_to := p_player; v_crash_card := p_card; v_crash_fb := true;', 'v_crash_fb := true;'],
  'I4 reconcile ignores the Crasher log': ["filter (where ca.effect = 'raid_crasher')", 'filter (where false)'],
  'I5 reconcile counts a mirrored Smite': ["\n       and not coalesce((ca.result->>'mirrored')::boolean, false)\n     group by 1", '\n     group by 1'],
  'I6 unexplained hides a hits change': ['(coalesce(h.d, 0) - coalesce(l.d, 0) - coalesce(a.d, 0) - coalesce(x.smite, 0) - coalesce(x.crasher, 0))::bigint', '0::bigint'],
  'I7 no backfill': ['      from r2 where rest > 0', '      from r2 where false'],
};
const guardOpen = (s) => s.replace("'5cfa1a4779226661d56ceda56045b58c')", "'5cfa1a4779226661d56ceda56045b58c', md5(replace(pg_get_functiondef('public.hunt_attack'::regproc), chr(13), '')))");

const P = 'tst_dlog_a', S = 'tst_dlog_s';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; h bigint; h2 bigint; atk bigint[]; sm bigint; sm2 bigint; cr bigint; c bigint; r jsonb; i int; n int; k int;
  rec record; v_day date := (now() at time zone 'America/Denver')::date; ok boolean; v_before bigint; v_after bigint; v_md5 text;
  v_ca combat_actions; v_hits bigint; v_hp0 bigint; v_hp1 bigint; v_heal bigint;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  -- The two real Hunts of the copy (if present): after the file, nothing is unexplained.
  for rec in select hu.id, (select count(*) filter (where x.unexplained <> 0) from hunt_damage_reconcile(hu.id) x) as bad,
                    (select coalesce(sum(x.smite), 0) from hunt_damage_reconcile(hu.id) x) as smite,
                    (select coalesce(sum(x.crasher), 0) from hunt_damage_reconcile(hu.id) x) as crasher
               from hunts hu where hu.id in (101698, 118624) order by hu.id loop
    res := res || jsonb_build_object('case', 'I4 real Hunt ' || rec.id || ': 0 members with unexplained damage', 'ok', rec.bad = 0,
      'smite', rec.smite, 'crasher', rec.crasher, 'members_unexplained', rec.bad);
  end loop;

  -- A private boss (rolled back). The live boss is never read or written here.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Damage Log Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into h;
  select array_agg(id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character','Creature') and s.ability->>'kind' = 'attack' and c.rarity = 'normal' order by c.id limit 8) x;
  select min(c.id), max(c.id) into sm, sm2 from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and s.ability->>'effect' = 'smite' order by c.id limit 2) c;
  select c.id into cr from cards c join subjects s on s.id = c.subject_id where s.effect->>'primitive' = 'raid_crasher' order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst dlog'), ('${S}', 'tst dlog sender');
  insert into player_cards (player_id, card_id, quantity) select '${P}', x, 1 from unnest(atk || sm || sm2) x;
  r := lock_hunt_squad('${P}', h, atk[1:4] || sm || sm2);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'squad lock refused: %', r; end if;

  -- 1. Attacks only: everything is logged, unexplained 0.
  foreach c in array atk[1:2] loop r := hunt_attack('${P}', h, c); end loop;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'I4 attacks only: hits = logged > 0, unexplained 0', 'ok',
    coalesce(rec.hits > 0 and rec.hits = rec.logged and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 2. A Smite: one support row, value = the hunt_hits damage it added; reconcile smite = value, unexplained 0.
  select coalesce(sum(damage), 0) into v_before from hunt_hits where hunt_id = h and player_id = '${P}' and card_id = sm;
  r := hunt_support('${P}', h, sm);
  select coalesce(sum(damage), 0) into v_after from hunt_hits where hunt_id = h and player_id = '${P}' and card_id = sm;
  select * into v_ca from combat_actions where mode = 'hunt' and ref_id = h and card_id = sm order by id desc limit 1;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'I1 a Smite writes a support/smite row with value = its hunt_hits damage', 'ok',
    coalesce((r->>'ok')::boolean and v_ca.kind = 'support' and v_ca.effect = 'smite' and (v_ca.result->>'value')::bigint = v_after - v_before
             and v_after - v_before > 0, false), 'r', r, 'delta', v_after - v_before, 'row', to_jsonb(v_ca));
  res := res || jsonb_build_object('case', 'I4 after a Smite: smite = its damage, unexplained 0', 'ok',
    coalesce(rec.smite = v_after - v_before and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 3. A mirrored Smite: no boss damage, the row says mirrored, the reconcile counts 0.
  perform hunt_marks_patch(h, '${P}', v_day, jsonb_build_object('mirror', true));
  r := hunt_support('${P}', h, sm2);
  select * into v_ca from combat_actions where mode = 'hunt' and ref_id = h and card_id = sm2 order by id desc limit 1;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'I5 a mirrored Smite counts 0, unexplained 0', 'ok',
    coalesce((r->>'ok')::boolean and (v_ca.result->>'mirrored')::boolean and rec.smite = v_after - v_before and rec.unexplained = 0, false),
    'r', r, 'row', to_jsonb(rec));

  -- 4. A Hunt Crasher charge from S (the prankster) on P: the next hits of P add a share for S on the Raider card.
  insert into player_effects (player_id, primitive, amount, options)
    values ('${P}', 'raid_crasher', 25, jsonb_build_object('uses', 1, 'card_id', cr, 'sender_id', '${S}', 'credit_to', '${S}'));
  k := 0;
  for i in 1..12 loop
    select coalesce(sum(damage), 0) into v_before from hunt_hits where hunt_id = h;
    r := hunt_attack('${P}', h, atk[1 + (i % 4)]);
    if (r->>'crashed') is not null then
      select coalesce(sum(damage), 0) into v_after from hunt_hits where hunt_id = h;
      k := (r->>'crashed')::int; exit;
    end if;
  end loop;
  select * into v_ca from combat_actions where mode = 'hunt' and ref_id = h and effect = 'raid_crasher' and player_id = '${S}' order by id desc limit 1;
  select coalesce(sum(damage), 0) into v_hits from hunt_hits where hunt_id = h and player_id = '${S}' and card_id = cr;
  res := res || jsonb_build_object('case', 'I2 a Crasher hit writes an effect/raid_crasher row for the prankster = the prankster''s hunt_hits', 'ok',
    coalesce(k > 0 and v_ca.kind = 'effect' and v_ca.card_id = cr and (v_ca.result->>'value')::int = k and v_hits = k
             and (v_ca.result->>'attacker') = '${P}' and not (v_ca.result->>'fallback')::boolean
             and exists (select 1 from hunt_combat_log l where l.id = (v_ca.result->>'combat_log_id')::bigint and l.player_id = '${P}' and l.hunt_id = h), false),
    'crashed', k, 'hits', v_hits, 'row', to_jsonb(v_ca));
  res := res || jsonb_build_object('case', 'I3 the Crasher hit: all its boss damage is in hunt_hits (damage + crashed)', 'ok',
    coalesce(k > 0 and v_after - v_before = (r->>'damage')::int + k, false), 'delta', v_after - v_before, 'r_damage', r->'damage');
  select * into rec from hunt_damage_reconcile(h) where player_id = '${S}';
  res := res || jsonb_build_object('case', 'I4 the prankster: crasher = hits, unexplained 0', 'ok',
    coalesce(rec.crasher = k and rec.hits = k and rec.unexplained = 0, false), 'row', to_jsonb(rec));

  -- 5. A charge with no owner and no card (not made by play_card_effect): the attacker gets the credit (fallback).
  insert into player_effects (player_id, primitive, amount, options) values ('${P}', 'raid_crasher', 25, '{"uses": 1}');
  k := 0;
  for i in 1..12 loop
    select coalesce(sum(damage), 0) into v_before from hunt_hits where hunt_id = h;
    r := hunt_attack('${P}', h, atk[1 + (i % 4)]);
    if (r->>'crashed') is not null then
      select coalesce(sum(damage), 0) into v_after from hunt_hits where hunt_id = h;
      k := (r->>'crashed')::int; c := atk[1 + (i % 4)]; exit;
    end if;
  end loop;
  select * into v_ca from combat_actions where mode = 'hunt' and ref_id = h and effect = 'raid_crasher' and player_id = '${P}' order by id desc limit 1;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'I3 a charge with no owner: the boss damage is in hunt_hits (the attacker, fallback), unexplained 0', 'ok',
    coalesce(k > 0 and v_after - v_before = (r->>'damage')::int + k and (v_ca.result->>'fallback')::boolean and v_ca.card_id = c
             and (v_ca.result->>'value')::int = k and rec.unexplained = 0, false), 'crashed', k, 'delta', v_after - v_before, 'row', to_jsonb(v_ca), 'rec', to_jsonb(rec));

  -- 6. A manual change of hunt_hits (+100), and a Crasher-style row with no log row (+40): both unexplained.
  update hunt_hits set damage = damage + 100 where hunt_id = h and player_id = '${P}' and card_id = atk[1] and hit_date = v_day;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${P}';
  res := res || jsonb_build_object('case', 'I6 a manual +100 on hunt_hits shows unexplained 100', 'ok', coalesce(rec.unexplained = 100, false), 'row', to_jsonb(rec));
  update hunt_hits set damage = damage + 40 where hunt_id = h and player_id = '${S}' and card_id = cr and hit_date = v_day;
  select * into rec from hunt_damage_reconcile(h) where player_id = '${S}';
  res := res || jsonb_build_object('case', 'I6 a Raider-card credit with no log row shows unexplained 40 (no special case)', 'ok', coalesce(rec.unexplained = 40, false), 'row', to_jsonb(rec));

  -- 7. The backfill: an ended Hunt with old Smite and Crasher damage and no log rows. Running the file adds one proven
  --    row each, the reconcile is 0, and a second run adds nothing. hunt_attack stays identical (md5).
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, status)
    values ('Test Damage Log Old Boss', 'Normal', '[]', '[]', 500000, 499000, now() - interval '1 day', 'escaped') returning id into h2;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h2, '${P}', sm, v_day - 3, 250), (h2, '${S}', cr, v_day - 3, 70);
  ${mig ? `v_md5 := md5(replace(pg_get_functiondef('public.hunt_attack'::regproc), chr(13), ''));
  execute $m$${mig}$m$;
  select count(*) into n from combat_actions where ref_id = h2 and (result->>'backfilled')::boolean
    and ((player_id = '${P}' and card_id = sm and effect = 'smite' and kind = 'support' and (result->>'value')::int = 250)
      or (player_id = '${S}' and card_id = cr and effect = 'raid_crasher' and kind = 'effect' and (result->>'value')::int = 70));
  execute $m$${mig}$m$;
  select count(*) into i from combat_actions where ref_id = h2;
  ok := v_md5 = md5(replace(pg_get_functiondef('public.hunt_attack'::regproc), chr(13), ''));` : 'n := 0; i := 0; ok := false;'}
  select count(*) filter (where unexplained <> 0) into k from hunt_damage_reconcile(h2);
  res := res || jsonb_build_object('case', 'I7 the backfill writes the 2 proven rows once (2 runs), reconcile 0', 'ok', n = 2 and i = 2 and k = 0,
    'rows', n, 'rows_after_2nd_run', i, 'members_unexplained', k);
  res := res || jsonb_build_object('case', 'I8 a re-run leaves hunt_attack identical', 'ok', ok);
  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(guardOpen(src.replace(a, b)));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0]}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(old ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 600)}`); }
  for (const r of results) if (r.case.startsWith('I4 real Hunt')) console.log(`  ${r.case.slice(3, r.case.indexOf(':'))} smite ${r.smite}, crasher ${r.crasher}, members unexplained ${r.members_unexplained}`);
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
