/**
 * Acceptance test for tcg-bot/supabase/dungeon_finish_room.sql ("Finish room": a whole fight room in one call, D-200 / D-201).
 * Invariants:
 *   E  EQUALITY: the answer of dungeon_finish_room is the same rounds played one by one with dungeon_auto_rounds(.., 1) with the same seed
 *      (setseed): the same rounds in the same order, the same final state, the same run row (status, ended_by, shards, cards), the same rows in
 *      dungeon_log and combat_actions, the same Shards in the ledger. For a won room (a horde: kills inside the loop, more than one call
 *      of 10 rounds), a lost room (the squad falls: the run ends as today), a room with a no-action pass (every attacker stunned), the Gauntlet,
 *      and a room that hits the round limit.
 *   L  the limit: the EXISTING balance dungeon.round_cap (40) ends a room: outcome limit, the run is over (fell), played = the cap, never a loop
 *      (a few calls only). A smaller cap (3) ends it the same way.
 *   R  the refusals: not in a fight, no run (another player has the run: it is not touched), the wrong mode, the Dungeon closed.
 * One DO block with fake members; the last RAISE rolls everything back:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-finish-room.mjs              the migration file (must PASS)
 *   ... --mutations                                                           each mutation of the file must make a case FAIL
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('test-dungeon-finish-room.mjs runs on the LOCAL copy only (LOCALDB=1 with the preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/dungeon_finish_room.sql', import.meta.url)), 'utf8'));
if (src.includes('$m$') || src.includes('$t$') || src.includes('$f$')) throw new Error('the file contains $m$, $t$ or $f$');

// One mutation per mechanism: [text, replacement]. Each text is in the file exactly once.
const MUTATIONS = {
  'the loop stops after the first call of 10 rounds': ["if r.state->>'phase' <> 'fight' then v_stop := 'phase'; exit; end if;", "v_stop := 'phase'; exit;"],
  'only the rounds of the last call are returned': ["v_rounds := v_rounds || coalesce(v_a->'rounds', '[]'::jsonb);", "v_rounds := coalesce(v_a->'rounds', '[]'::jsonb);"],
  'the played count is not summed': ["v_played := v_played + coalesce((v_a->>'played')::int, 0);", "v_played := coalesce((v_a->>'played')::int, 0);"],
  'the round limit is reported as lost': ["v_outcome := case when v_limit then 'limit'", "v_outcome := case when false then 'limit'"],
  'a lost room is reported as won': ["case when r.ended_by = 'cleared' then 'won' else 'lost' end", "'won'"],
  'the round limit is not recognised (an error, no outcome)': ["if v_a->>'error' = 'round_cap' then v_limit := true; v_stop := 'limit';", "if false then v_limit := true; v_stop := 'limit';"],
  'the guard settles the run at the first call': ['if v_calls >= v_cap + 2 then', 'if v_calls >= 1 then'],
  'ended is always false': ["'ended', r.status <> 'active'", "'ended', false"],
  'the run is looked up in the daily mode only': ["and status = 'active' and mode = v_mode for update;", "and status = 'active' and mode = 'daily' for update;"],
  'the rounds are played in the daily mode only': ['v_a := dungeon_auto_rounds(p_player, v_mode, 10);', "v_a := dungeon_auto_rounds(p_player, 'daily', 10);"],
  'the round limit after a support is not recognised (the error object of the answer)': ["if v_a->'error'->>'error' = 'round_cap' then v_limit := true; v_stop := 'limit'; else", "if false then v_limit := true; v_stop := 'limit'; else"],
  'the Dungeon closed is not checked': ["if not coalesce((dungeon_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;", ''],
};

const P = 'tst_dfr_';
const HORDE_HP = Number(process.env.HORDE_HP || 250);
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; r dungeon_runs; v_day date; ls bigint; atk bigint[]; sups jsonb; ra jsonb; rb jsonb; v_cap int; s_before jsonb; s_after jsonb; zz jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  execute $m$${mig}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  v_cap := balance_num('dungeon', 'round_cap')::int;

  select min(c.id) into ls from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id <> ls order by c.id limit 9) z;
  select jsonb_object_agg(e2, id) into sups from (select s.ability->>'effect' e2, min(c.id) id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by 1) z;
  create function pg_temp.dfr_member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z, 1 from unnest(array[(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal')]
        || (select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 10) w)
        || array(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by s.ability->>'effect')) z
      on conflict do nothing;
  end $f$;
  -- a member who starts a run (mode daily or gauntlet) and the fixture of the fight: n foes of hp each, every card with card_hp, a patch of the state
  create function pg_temp.dfr_fix(p text, p_mode text, p_n int, p_hp numeric, p_card_hp numeric, p_patch jsonb default '{}', p_foe jsonb default '{}', p_cards_patch jsonb default null) returns void language plpgsql as $f$
  declare s jsonb; fb jsonb := '{"atk": 50, "enr": 0, "enru": 0, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0, "sh": 0, "passives": [], "charge": false,
           "moves": [{"w": 1, "kind": "strike", "name": "Hit"}, {"w": 1, "kind": "slam", "name": "Stomp"}]}';
  begin
    select state into s from dungeon_runs where player_id = p and day = dungeon_day() and mode = p_mode and status = 'active';
    s := jsonb_set(s, '{foes}', (select jsonb_agg((s->'foes'->0) || fb || jsonb_build_object('hp', p_hp, 'max', p_hp) || p_foe) from generate_series(1, p_n)));
    s := jsonb_set(s, '{cards}', (select jsonb_object_agg(key, value || jsonb_build_object('hp', p_card_hp, 'max', p_card_hp)
           || case when coalesce((value->>'sup')::boolean, false) then coalesce(p_cards_patch->'sup', '{}') else coalesce(p_cards_patch->'atk', '{}') end) from jsonb_each(s->'cards'))) || p_patch;
    update dungeon_runs set state = s where player_id = p and day = dungeon_day() and mode = p_mode and status = 'active';
  end $f$;
  -- everything that a room leaves behind, for the comparison: the run row, the log rows, the combat_actions rows, the Shards
  create function pg_temp.dfr_dig(p text, p_mode text) returns jsonb language plpgsql as $f$
  declare rr dungeon_runs;
  begin
    select * into rr from dungeon_runs where player_id = p and day = dungeon_day() and mode = p_mode order by id desc limit 1;
    return jsonb_build_object('status', rr.status, 'ended_by', rr.ended_by, 'shards', rr.shards, 'cards', rr.cards, 'floor', rr.floor, 'room', rr.room, 'turns', rr.turns, 'state', rr.state,
      'log', (select md5(coalesce(string_agg(action::text || result::text, '|' order by n), '')) from dungeon_log where run_id = rr.id),
      'log_n', (select count(*) from dungeon_log where run_id = rr.id),
      'actions', (select md5(coalesce(string_agg(concat_ws('~', kind, round, effect, amount, target_card, target_foe, card_id, result::text), '|' order by id), '')) from combat_actions where ref_id = rr.id and mode in ('dungeon', 'gauntlet')),
      'actions_n', (select count(*) from combat_actions where ref_id = rr.id and mode in ('dungeon', 'gauntlet')),
      'ledger', (select coalesce(sum(amount), 0) from shard_ledger where player_id = p));
  end $f$;
  -- the reference (member p_ref: single rounds of dungeon_auto_rounds until the room is done) against the call (member p_got), with the same seed
  create function pg_temp.dfr_cmp(p_ref text, p_got text, p_mode text, p_seed float8) returns jsonb language plpgsql as $f$
  declare a jsonb; rr jsonb := '[]'; g jsonb; n int := 0; d1 jsonb; d2 jsonb;
  begin
    perform setseed(p_seed);
    loop
      n := n + 1; exit when n > 200;
      a := dungeon_auto_rounds(p_ref, p_mode, 1);
      exit when not coalesce((a->>'ok')::boolean, false);
      rr := rr || (a->'rounds');
      exit when a->>'status' <> 'active' or a->'state'->>'phase' <> 'fight' or jsonb_typeof(a->'error') = 'object';
    end loop;
    perform setseed(p_seed);
    g := dungeon_finish_room(p_got, p_mode);
    d1 := pg_temp.dfr_dig(p_ref, p_mode); d2 := pg_temp.dfr_dig(p_got, p_mode);
    return jsonb_build_object('rounds_equal', rr = g->'rounds', 'n_rounds', jsonb_array_length(rr), 'run_equal', d1 = d2, 'a', d1 - 'state', 'b', d2 - 'state',
      'answer', g - 'rounds' - 'state', 'phase', g->'state'->>'phase', 'passes', (select count(*) from jsonb_array_elements(g->'rounds') e where e->'pass' is not null),
      'kills', (select count(*) from jsonb_array_elements(g->'rounds') e where (e->'atk'->>'kill')::boolean));
  end $f$;

  -- ===== E1 a won room: a horde of 4 monsters, more than 10 rounds (kills inside the loop, more than one call) =====
  perform pg_temp.dfr_member('${P}w1'); perform pg_temp.dfr_member('${P}w2');
  ra := dungeon_start('${P}w1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  rb := dungeon_start('${P}w2', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  if not coalesce((ra->>'ok')::boolean, false) or not coalesce((rb->>'ok')::boolean, false) then raise exception 'start: % %', ra, rb; end if;
  perform pg_temp.dfr_fix('${P}w1', 'daily', 4, ${HORDE_HP}, 10000000); perform pg_temp.dfr_fix('${P}w2', 'daily', 4, ${HORDE_HP}, 10000000);
  rb := pg_temp.dfr_cmp('${P}w1', '${P}w2', 'daily', 0.37);
  res := res || jsonb_build_object('case', 'E1 a won room (4 monsters, kills inside the loop): rounds, final state, run row, log rows, combat_actions and Shards equal the rounds played one by one',
    'ok', (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and (rb->'answer'->>'ok')::boolean and rb->'answer'->>'outcome' = 'won' and rb->'answer'->>'stopped' = 'phase'
      and not (rb->'answer'->>'ended')::boolean and rb->>'phase' <> 'fight' and (rb->'answer'->>'calls')::int >= 2 and (rb->>'n_rounds')::int > 10 and (rb->>'kills')::int >= 3
      and (rb->'a'->>'actions_n')::int >= 11 and (rb->'a'->>'log_n')::int >= 11 and (rb->'answer'->>'played')::int = (rb->>'n_rounds')::int, 'cmp', rb);
  -- the room is done: the step is not a fight any more, a second call is refused
  rb := dungeon_finish_room('${P}w2', 'daily');
  res := res || jsonb_build_object('case', 'R1 not in a fight (the room is won, the step is a choice): refused not_fighting, nothing played', 'ok', not (rb->>'ok')::boolean and rb->>'error' = 'not_fighting', 'answer', rb);

  -- ===== E2 a lost room: the squad falls, the run ends as today =====
  perform pg_temp.dfr_member('${P}l1'); perform pg_temp.dfr_member('${P}l2');
  ra := dungeon_start('${P}l1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  rb := dungeon_start('${P}l2', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}l1', 'daily', 2, 2000000000, 1, '{}', '{"atk": 100000}'); perform pg_temp.dfr_fix('${P}l2', 'daily', 2, 2000000000, 1, '{}', '{"atk": 100000}');
  rb := pg_temp.dfr_cmp('${P}l1', '${P}l2', 'daily', 0.53);
  res := res || jsonb_build_object('case', 'E2 a lost room: the same as the rounds one by one; the run is over as today (fell), ended, outcome lost, nothing kept as loot',
    'ok', (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and (rb->'answer'->>'ok')::boolean and rb->'answer'->>'outcome' = 'lost' and (rb->'answer'->>'ended')::boolean
      and rb->'answer'->>'status' = 'over' and rb->'a'->>'ended_by' = 'fell' and rb->'answer'->>'stopped' = 'over' and (rb->>'n_rounds')::int >= 1, 'cmp', rb);

  -- ===== E3 a no-action round inside the loop: every attacker stunned, the supports on cooldown: the turn passes, then the squad wins =====
  perform pg_temp.dfr_member('${P}p1'); perform pg_temp.dfr_member('${P}p2');
  ra := dungeon_start('${P}p1', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  rb := dungeon_start('${P}p2', array[atk[1], atk[2], atk[3], (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}p1', 'daily', 2, 300, 10000000, '{"sup_round": 0}', '{}', '{"atk": {"cd": 1}, "sup": {"cd": 9}}');
  perform pg_temp.dfr_fix('${P}p2', 'daily', 2, 300, 10000000, '{"sup_round": 0}', '{}', '{"atk": {"cd": 1}, "sup": {"cd": 9}}');
  rb := pg_temp.dfr_cmp('${P}p1', '${P}p2', 'daily', -0.37);
  res := res || jsonb_build_object('case', 'E3 a stunned squad: the room starts with a pass (the monsters act), then the cards attack; the same as one by one; the room is won',
    'ok', (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and (rb->>'passes')::int >= 1 and rb->'answer'->>'outcome' = 'won' and (rb->>'n_rounds')::int >= 3, 'cmp', rb);

  -- ===== L1 the round limit of today (balance dungeon.round_cap = 40): 40 rounds, outcome limit, the run falls, a few calls only =====
  perform pg_temp.dfr_member('${P}c1'); perform pg_temp.dfr_member('${P}c2');
  ra := dungeon_start('${P}c1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  rb := dungeon_start('${P}c2', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}c1', 'daily', 1, 2000000000, 1000000000); perform pg_temp.dfr_fix('${P}c2', 'daily', 1, 2000000000, 1000000000);
  rb := pg_temp.dfr_cmp('${P}c1', '${P}c2', 'daily', 0.11);
  res := res || jsonb_build_object('case', 'L1 a room that cannot be won hits the round limit (balance dungeon.round_cap): 40 rounds, outcome limit, the run is over (fell), at most 6 calls; same as one by one',
    'ok', v_cap = 40 and (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and rb->'answer'->>'outcome' = 'limit' and rb->'answer'->>'stopped' = 'limit' and (rb->'answer'->>'ended')::boolean
      and rb->'a'->>'ended_by' = 'fell' and (rb->'answer'->>'played')::int = 40 and (rb->'answer'->>'calls')::int between 2 and 6, 'cap', v_cap, 'cmp', rb);
  -- L2 a smaller cap (3): the same rule, the same end
  update balance set value = jsonb_set(value, '{round_cap}', '3') where key = 'dungeon';
  perform pg_temp.dfr_member('${P}d1');
  ra := dungeon_start('${P}d1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}d1', 'daily', 1, 2000000000, 1000000000);
  rb := dungeon_finish_room('${P}d1', 'daily');
  res := res || jsonb_build_object('case', 'L2 the cap is read from the balance (3 here): 3 rounds, outcome limit, the run falls', 'ok', (rb->>'ok')::boolean and rb->>'outcome' = 'limit' and (rb->>'played')::int = 3
    and rb->>'status' = 'over' and (rb->>'calls')::int <= 2, 'answer', rb - 'rounds' - 'state');
  update balance set value = jsonb_set(value, '{round_cap}', to_jsonb(v_cap)) where key = 'dungeon';

  -- ===== L3 the limit when no support can play (all on cooldown): the 41st action is refused with nothing played (the answer of the single call: round_cap), still outcome limit =====
  perform pg_temp.dfr_member('${P}e1');
  ra := dungeon_start('${P}e1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}e1', 'daily', 1, 2000000000, 1000000000, '{"sup_round": 0}', '{}', '{"sup": {"cd": 999}}');
  rb := dungeon_finish_room('${P}e1', 'daily');
  res := res || jsonb_build_object('case', 'L3 no support plays: the round limit comes as the plain refusal of the next action: outcome limit, played 40, the run falls', 'ok',
    (rb->>'ok')::boolean and rb->>'outcome' = 'limit' and (rb->>'played')::int = 40 and rb->>'status' = 'over' and jsonb_array_length(rb->'rounds') = 40 and rb->>'error' is null, 'answer', rb - 'rounds' - 'state');

  -- ===== E4 the Gauntlet: p_mode reaches the rules =====
  perform pg_temp.dfr_member('${P}g1'); perform pg_temp.dfr_member('${P}g2');
  ra := gauntlet_start('${P}g1'); rb := gauntlet_start('${P}g2');
  if coalesce((ra->>'ok')::boolean, false) and coalesce((rb->>'ok')::boolean, false) then
    perform pg_temp.dfr_fix('${P}g1', 'gauntlet', 3, ${HORDE_HP}, 10000000); perform pg_temp.dfr_fix('${P}g2', 'gauntlet', 3, ${HORDE_HP}, 10000000);
    zz := dungeon_finish_room('${P}g2', 'daily');
    rb := pg_temp.dfr_cmp('${P}g1', '${P}g2', 'gauntlet', 0.77);
    res := res || jsonb_build_object('case', 'E4 the Gauntlet: the same as one by one; the daily mode finds no run for this member (no_run)', 'ok',
      (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and rb->'answer'->>'outcome' = 'won' and zz->>'error' = 'no_run' and not (zz->>'ok')::boolean, 'cmp', rb, 'daily', zz);
  else
    res := res || jsonb_build_object('case', 'E4 the Gauntlet runs start', 'ok', false, 'start', jsonb_build_array(ra, rb));
  end if;

  -- ===== E5 the last room of the last floor (a guardian): the room is won and the run is over (cleared): outcome won, ended, the loot is paid =====
  perform pg_temp.dfr_member('${P}k1'); perform pg_temp.dfr_member('${P}k2');
  ra := dungeon_start('${P}k1', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  rb := dungeon_start('${P}k2', array[atk[1], atk[2], ls, (sups->>'heal')::bigint, (sups->>'smite')::bigint]);
  perform pg_temp.dfr_fix('${P}k1', 'daily', 1, 250, 10000000, '{"room_type": "guardian"}'); perform pg_temp.dfr_fix('${P}k2', 'daily', 1, 250, 10000000, '{"room_type": "guardian"}');
  update dungeon_runs set floor = jsonb_array_length(dungeon_run_floors(dungeon_runs)) where player_id in ('${P}k1', '${P}k2') and day = v_day and mode = 'daily';
  rb := pg_temp.dfr_cmp('${P}k1', '${P}k2', 'daily', 0.91);
  res := res || jsonb_build_object('case', 'E5 the guardian of the last floor falls: the run is cleared (ended, outcome won, status over), the same as one by one', 'ok',
    (rb->>'rounds_equal')::boolean and (rb->>'run_equal')::boolean and rb->'answer'->>'outcome' = 'won' and (rb->'answer'->>'ended')::boolean and rb->'a'->>'ended_by' = 'cleared' and rb->'answer'->>'stopped' = 'over', 'cmp', rb);

  -- ===== R the refusals =====
  -- R2 another player (or nobody) is asked: no_run, and the run of the member is NOT touched
  select state into s_before from dungeon_runs where player_id = '${P}d1' and day = v_day and mode = 'daily';
  perform pg_temp.dfr_member('${P}n');
  zz := dungeon_finish_room('${P}n', 'daily'); rb := dungeon_finish_room('${P}nobody', 'daily');
  select state into s_after from dungeon_runs where player_id = '${P}d1' and day = v_day and mode = 'daily';
  res := res || jsonb_build_object('case', 'R2 a member with no run (or an unknown one): no_run; the run of another member is not touched', 'ok',
    zz->>'error' = 'no_run' and rb->>'error' = 'no_run' and not (zz->>'ok')::boolean and s_before = s_after, 'a', zz, 'b', rb);
  -- R3 the Dungeon closed
  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
  perform pg_temp.dfr_member('${P}x');
  rb := dungeon_finish_room('${P}x', 'daily');
  res := res || jsonb_build_object('case', 'R3 the Dungeon closed: disabled', 'ok', rb->>'error' = 'disabled' and not (rb->>'ok')::boolean, 'answer', rb);

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1800) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  const base = await runOnce(src);
  const bad = base.results ? base.results.filter((r) => !r.ok).length : 1;
  console.log(`baseline: ${base.results ? `${base.results.length - bad} of ${base.results.length} cases pass` : 'NO RESULTS ' + base.raw}`);
  if (bad) { console.log('FAIL the baseline is red: the mutation result is not valid'); process.exit(1); }
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
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 1500)}`); }
  console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
  process.exitCode = fail ? 1 : 0;
}
