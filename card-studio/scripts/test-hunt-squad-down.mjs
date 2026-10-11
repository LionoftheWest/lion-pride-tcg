/**
 * Acceptance test for hunt_squad_down_all_cards.sql (Nathan 2026-10-10, D-173): a Hunt squad is down only when EVERY card of the
 * locked squad (attackers and supports) is down. When every attacker is down and the standing supports are all on cooldown, the
 * member has no action: hunt_pass_turn advances the round and the boss acts.
 * One DO block, rolled back (the final RAISE), a fake member, fixed random seeds:
 *   node scripts/test-hunt-squad-down.mjs              the migration file, executed inside the block (must PASS)
 *   node scripts/test-hunt-squad-down.mjs --old        the migration, then the OLD hunt_squad_done text (git 0ce21af, every
 *                                                      attacker): the baseline, it must FAIL on A1, B1 to B3, C2, C3, D1, D2 (8 of 11)
 *   node scripts/test-hunt-squad-down.mjs --mutations  each mutation of the file must make a case FAIL
 * Run it on the local copy: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-squad-down.mjs
 * The squad: 2 attackers (a1, a2) and 2 supports (kh heal, ks shield).
 *   A1 attackers all down + a support standing => hunt_squad_done is false (the squad is NOT down)
 *   A2 the same state: hunt_attack on a down attacker still answers 'downed' and the squad row is untouched
 *   B1 only a support stands, on cooldown => hunt_pass_turn answers ok + no_action, the round is +1 and boss_action has a kind
 *   B2 the pass turn refuses (can_act) while a standing attacker exists, and while a standing support is ready (cooldown over)
 *   B3 the cooldown ticks: a support with cooldown 2 rounds ahead is ready after 2 pass turns (the third pass refuses can_act)
 *   B4 no_squad (no locked squad) and round_cap (round at the limit) are refused, nothing changes
 *   C1 everything down => hunt_squad_done is true and the pass turn answers squad_down
 *   C2 the boss downs the last support during pass turns => squad_down in the answer, ONE player_done event, no more pass turns
 *   C3 no pass turn is lost: every pass turn advances the round by exactly 1
 *   D1 a pass turn that hits (strike, drain, stun) lowers the HP of a standing support, targets[0] is that card (client mark)
 *   D2 a Slam / Cataclysm pass turn hits every standing support (targets lists them) and never a down card
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_squad_down_all_cards.sql', import.meta.url)), 'utf8'));
const oldText = (() => {
  const s = execFileSync('git', ['show', '0ce21af:db/schema/functions/hunt_squad_done.sql'], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
  const a = s.indexOf('CREATE OR REPLACE FUNCTION'), b = s.indexOf('$function$;', a);
  return s.slice(a, b + '$function$;'.length);
})();
for (const s of [src, oldText]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$f$')) throw new Error('a file contains $m$, $t$ or $f$');

const MUTATIONS = {
  'the squad is done when every attacker is down (the old rule)': ["select 1 from unnest(sq) x\n       where not exists", "select 1 from unnest(sq) x join cards c on c.id = x join subjects s on s.id = c.subject_id\n       where s.type in ('Character', 'Creature') and not exists"],
  'the pass turn does not advance the round': ['update hunt_combat_state set round = round + 1, updated_at = now()\n    where hunt_id = p_hunt and player_id = p_player and hit_date = v_day\n    returning round into v_round;', 'v_round := v_round + 1;'],
  'the pass turn runs while a standing attacker exists': ["          and not exists (select 1 from hunt_card_hp h where h.hunt_id = p_hunt and h.player_id = p_player and h.hit_date = v_day and h.card_id = x and h.downed)) then\n    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'attacker'", "          and false) then\n    return jsonb_build_object('ok', false, 'error', 'can_act', 'why', 'attacker'"],
  'the pass turn runs while a standing support is ready': ["h.card_id = x), 0) <= v_round) then", "h.card_id = x), 0) <= v_round and false) then"],
  'the pass turn runs with no round limit': ["if v_round >= v_rcap then return jsonb_build_object('ok', false, 'error', 'round_cap', 'cap', v_rcap); end if;", ''],
  'the boss hit is not applied': ['v_hit := hunt_counter_hit(p_hunt, p_player, v_day, v_rtgt, v_cdmg, false);', "v_hit := jsonb_build_object('card_id', v_rtgt, 'dmg', v_cdmg, 'hp', 1, 'max_hp', 1, 'downed', false);"],
  'the area hit also hits down cards': ['where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and not x.downed and x.card_id = any(v_squad)) h', 'where x.hunt_id = p_hunt and x.player_id = p_player and x.hit_date = v_day and x.card_id = any(v_squad)) h'],
  'no player_done post at the end of the squad': ['if (v_done or v_round >= v_rcap)\n     and not exists', 'if false\n     and not exists'],
  'the pass turn works with no squad row': ["if v_squad is null then return jsonb_build_object('ok', false, 'error', 'no_squad'); end if;", "v_squad := coalesce(v_squad, '{}'::bigint[]);"],
};

const P = 'tst_hsd';
const body = (mig) => String.raw`do $t$ declare
  res jsonb := '[]'; P text := '${P}'; d date := (now() at time zone 'America/Denver')::date;
  a1 bigint; a2 bigint; kh bigint; ks bigint; h bigint; h2 bigint; r jsonb; k int; i int; r0 int; ev int; bk text; hp0 int; hp1 int; n0 int; n1 int; hitid bigint;
  ok_a1 boolean := false; ok_a2 boolean := false; ok_b1 boolean := false; ok_b2a boolean := false; ok_b2b boolean := false; ok_b3 boolean := false;
  ok_b4a boolean := false; ok_b4b boolean := false; ok_c1 boolean := false; ok_c1b boolean := false;
  c2_down int := 0; c2_events_bad int := 0; c2_after_ok int := 0; c3_bad int := 0; c3_n int := 0;
  d1_n int := 0; d1_bad int := 0; d2_n int := 0; d2_bad int := 0; tg jsonb; e jsonb; seen int;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- 0. the function under test: the file${old ? ', then the OLD hunt_squad_done text (the baseline)' : ''}.
  execute $m$${mig}$m$;
  ${old ? `execute $m$${oldText}$m$;` : ''}
  select min(c.id) into a1 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold';
  select min(c.id) into a2 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold' and c.id > a1;
  select min(c.id) into kh from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'heal' and s.ability->>'target' = 'ally';
  select min(c.id) into ks from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'shield';
  insert into players (id, username) values (P, 'tst hunt squad down');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(array[a1, a2, kh, ks]) x;
  ${GATE(P)}
  update balance set value = '20' where key = 'daily_card_cap';

  -- A: attackers down, a support stands (round 2, its cooldown ends at round 9)
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values ('Test Down Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
  perform hunt_state_round(h, P, d);
  update hunt_combat_state set round = 2 where hunt_id = h and player_id = P and hit_date = d;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, a2, kh]);
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, P, a1, d, 0, 100, true), (h, P, a2, d, 0, 100, true);
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, cd_until_round) values (h, P, kh, d, 60, 60, false, 9);
  ok_a1 := not hunt_squad_done(h, P, d, 20);
  res := res || jsonb_build_object('case', 'A1 attackers all down + a support standing: hunt_squad_done is false', 'ok', ok_a1);
  r := hunt_attack(P, h, a1);
  ok_a2 := r->>'error' = 'downed' and exists (select 1 from hunt_squads where hunt_id = h and player_id = P);
  res := res || jsonb_build_object('case', 'A2 a down attacker still answers downed, the squad row is untouched', 'ok', ok_a2, 'answer', r);

  -- B1: the pass turn (the support is on cooldown until round 9)
  select round into r0 from hunt_combat_state where hunt_id = h and player_id = P and hit_date = d;
  perform setseed(0.42);
  r := hunt_pass_turn(P, h);
  ok_b1 := coalesce((r->>'ok')::boolean, false) and coalesce((r->>'no_action')::boolean, false) and (r->>'round')::int = r0 + 1
    and (select round from hunt_combat_state where hunt_id = h and player_id = P and hit_date = d) = r0 + 1
    and r->'boss_action'->>'kind' is not null and (r->'boss_action'->>'round')::int = r0 + 1;
  res := res || jsonb_build_object('case', 'B1 only a support stands, on cooldown: the pass turn is ok + no_action, round +1, boss_action has a kind', 'ok', ok_b1, 'answer', r);

  -- B2a: a standing attacker => can_act (a2 stands again)
  update hunt_card_hp set hp_remaining = 100, downed = false where hunt_id = h and card_id = a2;
  r := hunt_pass_turn(P, h);
  ok_b2a := r->>'error' = 'can_act' and r->>'why' = 'attacker';
  update hunt_card_hp set hp_remaining = 0, downed = true where hunt_id = h and card_id = a2;
  -- B2b: a standing support that is ready => can_act
  update hunt_card_hp set cd_until_round = 0, hp_remaining = 60, downed = false where hunt_id = h and card_id = kh;
  r := hunt_pass_turn(P, h);
  ok_b2b := r->>'error' = 'can_act' and r->>'why' = 'support';
  res := res || jsonb_build_object('case', 'B2 the pass turn refuses (can_act) with a standing attacker and with a ready support', 'ok', ok_b2a and ok_b2b, 'attacker', ok_b2a, 'support', ok_b2b);

  -- B3: the cooldown ticks. The support is ready at round r+2: pass, pass, then the third pass refuses (a pass at round r+1 still has the cooldown).
  select round into r0 from hunt_combat_state where hunt_id = h and player_id = P and hit_date = d;
  update hunt_card_hp set cd_until_round = r0 + 2, hp_remaining = 10000000, max_hp = 10000000 where hunt_id = h and card_id = kh;
  r := hunt_pass_turn(P, h);
  ok_b3 := coalesce((r->>'ok')::boolean, false);
  r := hunt_pass_turn(P, h);
  ok_b3 := ok_b3 and coalesce((r->>'ok')::boolean, false) and (r->>'round')::int = r0 + 2;
  r := hunt_pass_turn(P, h);
  ok_b3 := ok_b3 and r->>'error' = 'can_act' and r->>'why' = 'support';
  res := res || jsonb_build_object('case', 'B3 the cooldown ticks: ready after 2 pass turns, the third refuses can_act', 'ok', ok_b3, 'answer', r);

  -- B4: no locked squad, and the round limit
  insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
    values ('Test Down Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h2;
  r := hunt_pass_turn(P, h2);
  ok_b4a := r->>'error' = 'no_squad' and not exists (select 1 from hunt_combat_state where hunt_id = h2 and player_id = P and round > 0);
  update hunt_combat_state set round = hunt_round_cap() where hunt_id = h and player_id = P and hit_date = d;
  update hunt_card_hp set cd_until_round = 1000 where hunt_id = h and card_id = kh;
  r := hunt_pass_turn(P, h);
  ok_b4b := r->>'error' = 'round_cap' and (select round from hunt_combat_state where hunt_id = h and player_id = P and hit_date = d) = hunt_round_cap();
  res := res || jsonb_build_object('case', 'B4 no locked squad and the round limit are refused, the round does not move', 'ok', ok_b4a and ok_b4b, 'no_squad', ok_b4a, 'round_cap', ok_b4b);

  -- C1: everything down
  update hunt_card_hp set hp_remaining = 0, downed = true where hunt_id = h and card_id = kh;
  ok_c1 := hunt_squad_done(h, P, d, 20);
  update hunt_combat_state set round = 3 where hunt_id = h and player_id = P and hit_date = d;
  r := hunt_pass_turn(P, h);
  ok_c1b := r->>'error' = 'squad_down';
  res := res || jsonb_build_object('case', 'C1 everything down: hunt_squad_done is true and the pass turn answers squad_down', 'ok', ok_c1 and ok_c1b, 'done', ok_c1, 'pass', r);

  -- C2 / C3: 12 fights, only a support (1 HP, a long cooldown) stands: pass turns until the boss downs it
  perform setseed(0.77);
  for k in 1..12 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Down Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, kh, ks]);
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, P, a1, d, 0, 100, true);
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, cd_until_round) values (h, P, kh, d, 1, 60, false, 1000);
    -- ks never acted: no row, but it is on no cooldown, so give it a row on cooldown too (a standing support that cannot act)
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, cd_until_round) values (h, P, ks, d, 1, 60, false, 1000);
    for i in 1..30 loop
      select round into r0 from hunt_combat_state where hunt_id = h and player_id = P and hit_date = d;
      r := hunt_pass_turn(P, h);
      exit when not coalesce((r->>'ok')::boolean, false);
      c3_n := c3_n + 1;
      if (r->>'round')::int <> r0 + 1 then c3_bad := c3_bad + 1; end if;
      exit when coalesce((r->>'squad_down')::boolean, false);
    end loop;
    if (select count(*) from hunt_card_hp where hunt_id = h and card_id in (kh, ks) and downed) = 2 and hunt_squad_done(h, P, d, 20) then c2_down := c2_down + 1; end if;
    select count(*) into ev from hunt_events where hunt_id = h and kind = 'player_done' and payload->>'player_id' = P;
    if ev <> 1 then c2_events_bad := c2_events_bad + 1; end if;
    r := hunt_pass_turn(P, h);
    if coalesce((r->>'ok')::boolean, false) then c2_after_ok := c2_after_ok + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', 'C2 the boss downs the last supports during pass turns: squad done, ONE player_done event, no pass turn after (12 of 12)', 'ok',
    c2_down = 12 and c2_events_bad = 0 and c2_after_ok = 0, 'squads_down', c2_down, 'event_count_wrong', c2_events_bad, 'pass_after_down', c2_after_ok);
  res := res || jsonb_build_object('case', 'C3 every pass turn advances the round by exactly 1', 'ok', c3_bad = 0 and c3_n >= 12, 'pass_turns', c3_n, 'bad', c3_bad);

  -- D1 / D2: the boss action on the pass turn. 40 fights, 2 supports with 10 million HP on a long cooldown, a1 down.
  perform setseed(0.31);
  for k in 1..40 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Down Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, kh, ks]);
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, P, a1, d, 0, 100, true);
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed, cd_until_round) values (h, P, kh, d, 10000000, 10000000, false, 1000), (h, P, ks, d, 10000000, 10000000, false, 1000);
    for i in 1..8 loop
      select hp_remaining into hp0 from hunt_card_hp where hunt_id = h and card_id = kh;
      select hp_remaining into hp1 from hunt_card_hp where hunt_id = h and card_id = ks;
      r := hunt_pass_turn(P, h);
      exit when not coalesce((r->>'ok')::boolean, false);
      bk := r->'boss_action'->>'kind'; tg := r->'boss_action'->'targets';
      if bk in ('strike', 'drain', 'stun') then
        d1_n := d1_n + 1;
        hitid := (tg->0->>'card_id')::bigint;
        -- targets[0] is the card whose HP went down, and only that one lost HP
        select hp_remaining into n0 from hunt_card_hp where hunt_id = h and card_id = kh;
        select hp_remaining into n1 from hunt_card_hp where hunt_id = h and card_id = ks;
        if hitid is null or hitid not in (kh, ks) or (hitid = kh and (n0 >= hp0 or n1 <> hp1)) or (hitid = ks and (n1 >= hp1 or n0 <> hp0))
        then d1_bad := d1_bad + 1; end if;
      elsif bk in ('slam', 'cataclysm') then
        d2_n := d2_n + 1;
        seen := (select count(distinct e2->>'card_id') from jsonb_array_elements(tg) e2 where (e2->>'card_id')::bigint in (kh, ks) and (e2->>'dmg')::int > 0);
        if seen <> 2 or exists (select 1 from jsonb_array_elements(tg) e2 where (e2->>'card_id')::bigint = a1) then d2_bad := d2_bad + 1; end if;
        if (select hp_remaining from hunt_card_hp where hunt_id = h and card_id = a1) <> 0 then d2_bad := d2_bad + 1; end if;
      end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'D1 a single-hit pass turn lowers the HP of one standing support, targets[0] is that card (samples ' || d1_n || ')', 'ok', d1_n >= 20 and d1_bad = 0, 'single_hits', d1_n, 'bad', d1_bad);
  res := res || jsonb_build_object('case', 'D2 a Slam / Cataclysm pass turn hits every standing support and never a down card (samples ' || d2_n || ')', 'ok', d2_n >= 3 and d2_bad = 0, 'area_hits', d2_n, 'bad', d2_bad);

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  const base = await runOnce(src);
  if (!base.results || base.results.some((r) => !r.ok)) { console.log('FAIL the baseline (the unmutated file) is not green: the mutation result is not valid'); process.exit(1); }
  console.log(`baseline: PASS all ${base.results.length}`);
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(src.replace(a, () => b));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0].slice(0, 90)}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}  ${r.ok ? JSON.stringify(r).slice(0, 300) : ''}`); }
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
