/**
 * The time check of the fight functions (F-3 PR 4, docs/f3-effect-engine.md section 3: "Time check in every PR").
 *
 * For each of 10 calls it measures 300 calls on the BASE text (the functions as they are installed on the local copy) and 300 calls on the
 * CANDIDATE text (CANDIDATE=<file.sql>; with no candidate the BASE text is installed again, so the two columns show the noise of the measure).
 * BASE and CANDIDATE take turns in the SAME request: each request installs one text, makes 30 calls (a 31st call, the first, is a warm-up and is
 * dropped), installs the other text, makes 30 calls, and the order flips from one request to the next. 10 requests = 300 calls for each text.
 * Every call runs in a sub-block that is undone at its end (like the golden tests), after setseed(0.42), so each call starts from the same
 * state and does the same work. Only the call itself is timed (clock_timestamp). Everything is rolled back; nothing is kept.
 *
 * The result is the mean and the p95 in milliseconds. The script FAILS (exit 1) when, for any call, the CANDIDATE mean is more than 1.10 times
 * the BASE mean, or when a measured call returned an error (the time of an error path says nothing).
 *
 *   LAB_LOCK_OWNER=<name> LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/fight-timing.mjs
 *   CANDIDATE=../tcg-bot/supabase/x.sql LAB_LOCK_OWNER=<name> LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/fight-timing.mjs [call ...]
 *   ... fight-timing.mjs combat_effect combat_effect_hit hunt_fight_state dungeon_fight_state    the effect engine alone (opt-in, F-3 PR 4b: after the file is applied)
 *   TIMING_BATCH=30 TIMING_REQUESTS=10    the size of a batch and the number of requests (default 30 and 10 = 300 calls)
 * LOCAL copy only (docs/foundations.md "Performance and cost budget" rule 2). Each request takes the shared lock when LAB_LOCK_OWNER is set (lab-lib.mjs).
 */
import { runBlock, assertLocal } from './lab-lib.mjs';
import { installHelpers, PLAN } from './lab-sql.mjs';
import { readFileSync } from 'node:fs';
assertLocal('fight-timing.mjs');

const BATCH = Number(process.env.TIMING_BATCH || 30), REQUESTS = Number(process.env.TIMING_REQUESTS || 10), LIMIT = 1.10;
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const cand = process.env.CANDIDATE ? strip(readFileSync(process.env.CANDIDATE, 'utf8')) : '';
if (cand.includes('$c$') || cand.includes('$d$')) throw new Error('the candidate must not contain $c$ or $d$');
// The functions that the candidate re-creates: their BASE text is read from the database at the start of each request.
const names = [...new Set([...cand.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-z0-9_]+)"?\s*\(/gi)].map((m) => m[1].toLowerCase()))];
// Without a candidate: the functions of the calls (their own text again).
const CALL_FNS = ['hunt_attack', 'hunt_support', 'dungeon_attack', 'dungeon_support', 'dungeon_enemy_turn', 'dungeon_auto_rounds', 'dungeon_finish_room', 'dungeon_pass_turn', 'hunt_card_crits', 'hunt_autopick'];
const swap = cand ? names : CALL_FNS;

// The fixtures. hunt: a member with 5 attackers and 4 supports, a boss with 1 billion HP, and one attack so that the card rows exist.
// autopick: a member with every normal card. dungeon: a member and a started Dungeon run (one fight room, two foes of floor 1).
const SQUAD = [24, 29, 44, 34, 49, 82, 79, 64];
const HUNT = `perform pg_temp.lab_member(v_p, array[${SQUAD}]::bigint[], '{}'::jsonb, false);
  v_h := pg_temp.lab_hunt_new(v_p, array[${SQUAD}]::bigint[], '{"name": "Timing Boss", "tier": "Heroic", "hp": 1000000000}'::jsonb);
  perform setseed(0.42);
  perform hunt_attack(v_p, v_h, 24);
  -- the boss may have downed, stunned or marked a card in this first attack: every card is whole again, so that the measured calls do not meet an error
  update hunt_card_hp set hp_remaining = max_hp, downed = false, shield = 0, cd_until_round = 0, dmg_buff = 1, dmg_debuff = 1 where hunt_id = v_h;
  update hunt_combat_state set marks = '{}'::jsonb, stunned_until = 0, boss_enrage = 1, enrage_until = 0, boss_weaken = 0, weaken_until = 0, boss_expose = 0, expose_until = 0 where hunt_id = v_h;`;
const AUTOPICK = `perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values (v_p, 'timing');
  insert into player_cards (player_id, card_id, quantity) select v_p, c.id, 1 from cards c where c.rarity = 'normal';
  v_h := pg_temp.lab_hunt_new(v_p, array[24, 29, 44, 34, 49, 82]::bigint[], '{"name": "Timing Boss", "tier": "Heroic", "hp": 1000000000}'::jsonb);`;
const DUNGEON = `v_day := dungeon_day();
  perform pg_temp.lab_member(v_p, array[24, 44, 34, 82, 79]::bigint[], '{}'::jsonb, true);
  update settings set value = value || '{"enabled": true}'::jsonb where key = 'dungeon';
  insert into dungeon_days (day, name, rule, floors) values (v_day, 'Timing', '{"budget": 99}'::jsonb,
    jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'fight', 'foes', jsonb_build_array(pg_temp.lab_foe('fight', 1, 1, null, null, null, 'ta'), pg_temp.lab_foe('fight', 1, 1, null, null, null, 'tb'))))))
    on conflict (day) do update set rule = excluded.rule, floors = excluded.floors;
  perform setseed(0.42);
  r := dungeon_start(v_p, array[24, 44, 34, 82, 79]::bigint[]);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'the Dungeon did not start: %', r - 'state'; end if;
  st := r->'state';`;
// dungeon_pass_turn is allowed only when no attacker can act: every attacker waits (cd 99); the call is forced for the supports.
const DUNGEON_STUNNED = `${DUNGEON}
  update dungeon_runs set state = jsonb_set(state, '{cards}', (select jsonb_object_agg(e.k, case when not coalesce((e.v->>'sup')::boolean, false) then jsonb_set(e.v, '{cd}', '99'::jsonb) else e.v end) from jsonb_each(state->'cards') e(k, v))) where player_id = v_p and status = 'active';`;
const CALLS = {
  hunt_attack: [HUNT, 'hunt_attack(v_p, v_h, 29)'],
  hunt_support: [HUNT, 'hunt_support(v_p, v_h, 82, 24)'],
  hunt_card_crits: [HUNT, 'hunt_card_crits(v_p, v_h)'],
  hunt_autopick: [AUTOPICK, 'hunt_autopick(v_p, v_h)'],
  dungeon_attack: [DUNGEON, "dungeon_attack(v_p, 24, 0, 'daily')"],
  dungeon_support: [DUNGEON, "dungeon_support(v_p, 82, 24, null, 'daily')"],
  dungeon_enemy_turn: [DUNGEON, 'dungeon_enemy_turn(st, 24, 0, 50)'],
  dungeon_auto_rounds: [DUNGEON, "dungeon_auto_rounds(v_p, 'daily', 10)"],
  dungeon_finish_room: [DUNGEON, "dungeon_finish_room(v_p, 'daily')"],
  dungeon_pass_turn: [DUNGEON_STUNNED, "dungeon_pass_turn(v_p, 'daily', true)"],
};
// The effect engine alone (F-3 PR 4b, f3_effect_engine.sql). OPT-IN: name them on the command line; they exist only after the file is applied
// (the BASE turn of a request reads the installed text). The fight state of a combat_effect call is built in the fixture, so the call is timed alone.
const ENGINE_CALLS = {
  combat_effect: [`${HUNT}
  st := hunt_fight_state(v_h, v_p, (now() at time zone 'America/Denver')::date, 82, 24);`, `combat_effect(st, 82, 'use', '{"target_card": 24}'::jsonb)`],
  combat_effect_hit: [`${DUNGEON}
  st := dungeon_fight_state((select x from dungeon_runs x where x.player_id = v_p and x.status = 'active'), 24, null);`, `combat_effect(st, 24, 'before_hit', '{"target_foe": 0}'::jsonb)`],
  hunt_fight_state: [HUNT, "hunt_fight_state(v_h, v_p, (now() at time zone 'America/Denver')::date, 82, 24)"],
  dungeon_fight_state: [DUNGEON, "dungeon_fight_state((select x from dungeon_runs x where x.player_id = v_p and x.status = 'active'), 24, null)"],
};
const DEFAULT_CALLS = Object.keys(CALLS);
Object.assign(CALLS, ENGINE_CALLS);

const request = (call, parity) => {
  const [fixture, expr] = CALLS[call];
  const measure = `
    for i in 0..${BATCH} loop
      begin
        perform setseed(0.42);
        t0 := clock_timestamp();
        r := to_jsonb(${expr});
        v_ms := extract(epoch from clock_timestamp() - t0) * 1000;
        if r is not null and jsonb_typeof(r) = 'object' and r->>'ok' = 'false' then v_bad := v_bad || (r->>'error'); end if;
        raise exception using errcode = 'U0001', message = 'undo';
      exception when sqlstate 'U0001' then null;
      end;
      if i > 0 then v_arr := v_arr || v_ms; end if;
    end loop;`;
  return `${PLAN}
do $t$
declare v_base text[]; v_p text := 'tst_timing'; v_h bigint; v_day date; r jsonb; st jsonb; t0 timestamptz; i int; s int; d text; v_ms float8;
  v_arr float8[] := '{}'; v_b float8[] := '{}'; v_c float8[] := '{}'; v_bad text[] := '{}';
begin
  ${installHelpers()}
  select array_agg(pg_get_functiondef(p.oid)) into v_base from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[${[...new Set([...swap, ...CALL_FNS])].map((n) => `'${n}'`).join(', ')}]);
  ${fixture}
  for s in 1..2 loop
    v_arr := '{}';
    if (s + ${parity}) % 2 = 0 then
      foreach d in array v_base loop execute d; end loop;
      ${measure}
      v_b := v_b || v_arr;
    else
      ${cand ? 'execute $c$' + cand + '$c$;' : 'foreach d in array v_base loop execute d; end loop;'}
      ${measure}
      v_c := v_c || v_arr;
    end if;
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('base', v_b, 'cand', v_c, 'bad', v_bad)::text;
end $t$;`;
};

const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / s.length, p95: s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] }; };
const which = process.argv.slice(2).filter((a) => CALLS[a]);
const run = which.length ? which : DEFAULT_CALLS;
const rows = []; let fails = 0;
for (const call of run) {
  const b = [], c = [], bad = [];
  for (let k = 0; k < REQUESTS; k++) {
    const o = JSON.parse(await runBlock(request(call, k % 2)));
    b.push(...o.base); c.push(...o.cand); bad.push(...o.bad);
  }
  const sb = stats(b), sc = stats(c);
  const ratio = sc.mean / sb.mean;
  const err = bad.length ? ` ERROR RESULTS ${bad.length} (${[...new Set(bad)].join(',')})` : '';
  const over = cand && ratio > LIMIT;
  if (over || bad.length) fails++;
  rows.push({ call, base_n: sb.n, base_mean: sb.mean.toFixed(2), base_p95: sb.p95.toFixed(2), cand_n: sc.n, cand_mean: sc.mean.toFixed(2), cand_p95: sc.p95.toFixed(2), ratio: ratio.toFixed(3) });
  console.log(`${over ? 'FAIL' : bad.length ? 'FAIL' : 'ok  '} ${call.padEnd(20)} BASE mean ${sb.mean.toFixed(2)} ms p95 ${sb.p95.toFixed(2)} (n ${sb.n}) | ${cand ? 'CANDIDATE' : 'BASE again'} mean ${sc.mean.toFixed(2)} ms p95 ${sc.p95.toFixed(2)} (n ${sc.n}) | ratio ${ratio.toFixed(3)}${err}`);
}
console.log(fails ? `FAIL ${fails} of ${run.length} calls` : `PASS ${run.length} calls${cand ? `, no candidate mean above ${LIMIT} x the BASE mean` : ' (baseline only, no candidate)'}`);
process.exitCode = fails ? 1 : 0;
