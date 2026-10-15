/**
 * The SQL of the Combat Lab and of the Dungeon / Gauntlet golden test (scripts/combat-lab.mjs, scripts/dungeon-golden.mjs).
 * These are TEST helpers: temporary functions (pg_temp), created inside one DO block of one request and undone with it.
 * They are not a migration, they do not change the game, and they never calculate combat: every number comes from the
 * real fight functions (hunt_attack, hunt_support, dungeon_start, dungeon_attack, dungeon_support, dungeon_pass_turn,
 * dungeon_choose, dungeon_auto_rounds, gauntlet_start, card_combat ...). The helpers only set up a member and a fight,
 * choose the next action, and read what the fight wrote.
 *
 * installHelpers() gives the SQL text that creates them. Use it inside a DO block: ${installHelpers()}
 */

// One read plan: a Slam / Cataclysm reads the card rows with no ORDER BY, so a sequential scan returned them in
// physical order, which moved between runs (combat-golden.mjs, 2026-10-03). The primary-key index scan reads by card id.
export const PLAN = 'set local enable_seqscan = off; set local enable_bitmapscan = off;';

const defs = [];
const def = (sql) => defs.push(sql.trim());

// ---------------------------------------------------------------------------------------------------------------------
// A member and the cards of a squad. p_builds = {"<card id>": {"asc": 2, "pts": {"attack": 3}}}. p_gate: the 8 attackers that
// the adventure gate wants (the Dungeon and the Gauntlet start refuse a member below the gate).
def(String.raw`
create function pg_temp.lab_member(p text, p_cards bigint[], p_builds jsonb, p_gate boolean) returns void language plpgsql as $g$
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values (p, 'lab ' || p);
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select p, u.c, 1, coalesce((p_builds->(u.c::text)->>'asc')::int, 0), coalesce(p_builds->(u.c::text)->'pts', '{}'::jsonb)
    from (select distinct c from unnest(p_cards) c) u;
  if p_gate then
    insert into player_cards (player_id, card_id, quantity)
      select p, c.id, 1 from cards c join subjects s on s.id = c.subject_id
      where s.type in ('Character', 'Creature') and c.rarity = 'normal' and not (c.id = any(p_cards)) order by c.id limit 8
    on conflict do nothing;
  end if;
end $g$;`);

// ---------------------------------------------------------------------------------------------------------------------
// The state of a card or a foe must stay in its limits (the Lab invariants): HP between 0 and the maximum, no negative
// shield, no missing number, no NaN. Returns the list of broken rules (empty = fine).
def(String.raw`
create function pg_temp.lab_viol_state(st jsonb) returns text[] language plpgsql as $g$
declare v text[] := '{}'; e record; n int := 0;
begin
  if st::text ~ '(NaN|Infinity)' then v := v || 'NaN or Infinity in the state'; end if;
  for e in select key k, value c from jsonb_each(coalesce(st->'cards', '{}'::jsonb)) loop
    if e.c->>'hp' is null or e.c->>'max' is null or e.c->>'shield' is null or e.c->>'buff' is null or e.c->>'debuff' is null or e.c->>'cd' is null or e.c->>'down' is null then
      v := v || ('card ' || e.k || ': a missing number'); continue; end if;
    if (e.c->>'hp')::numeric < 0 then v := v || ('card ' || e.k || ': HP below 0 (' || (e.c->>'hp') || ')'); end if;
    if (e.c->>'hp')::numeric > (e.c->>'max')::numeric then v := v || ('card ' || e.k || ': HP above the maximum (' || (e.c->>'hp') || '/' || (e.c->>'max') || ')'); end if;
    if (e.c->>'shield')::numeric < 0 then v := v || ('card ' || e.k || ': shield below 0'); end if;
    if (e.c->>'buff')::numeric <= 0 or (e.c->>'debuff')::numeric <= 0 then v := v || ('card ' || e.k || ': a damage multiplier of 0 or less'); end if;
    if (e.c->>'cd')::numeric < 0 then v := v || ('card ' || e.k || ': cooldown below 0'); end if;
    if (e.c->>'down')::boolean and (e.c->>'hp')::numeric > 0 then v := v || ('card ' || e.k || ': down with HP left'); end if;
    if not (e.c->>'down')::boolean and (e.c->>'hp')::numeric <= 0 then v := v || ('card ' || e.k || ': HP 0 and not down'); end if;
  end loop;
  for e in select ord, f from jsonb_array_elements(coalesce(st->'foes', '[]'::jsonb)) with ordinality t(f, ord) loop
    if e.f->>'hp' is null or e.f->>'max' is null or e.f->>'atk' is null then v := v || ('foe ' || e.ord || ': a missing number'); continue; end if;
    if (e.f->>'hp')::numeric < 0 then v := v || ('foe ' || e.ord || ': HP below 0'); end if;
    if (e.f->>'hp')::numeric > (e.f->>'max')::numeric then v := v || ('foe ' || e.ord || ': HP above the maximum'); end if;
    if (e.f->>'atk')::numeric <= 0 then v := v || ('foe ' || e.ord || ': attack of 0 or less'); end if;
    if coalesce((e.f->>'sh')::numeric, 0) < 0 then v := v || ('foe ' || e.ord || ': guard below 0'); end if;
  end loop;
  return v;
end $g$;`);

// A short text of a run state (one line): the cards, the foes, the round, the loot. Used in the golden transcript.
def(String.raw`
create function pg_temp.lab_digest(st jsonb) returns text language sql as $g$
  select 'ph=' || coalesce(st->>'phase', '-') || ' rd=' || coalesce(st->>'round', '-') || ' sr=' || coalesce(st->>'sup_round', '-') || ' rt=' || coalesce(st->>'room_type', '-')
    || ' bf=' || coalesce(st->>'buff', '-') || ' wd=' || coalesce(st->>'ward', '-')
    || ' bank=' || coalesce(st->'bank'->>'shards', '-') || '/' || coalesce(st->'bank'->>'cards', '-') || ' pend=' || coalesce(st->'pend'->>'shards', '-') || '/' || coalesce(st->'pend'->>'cards', '-')
    || ' C[' || coalesce((select string_agg(e.key || ':' || coalesce(e.value->>'hp', '?') || '/' || coalesce(e.value->>'max', '?') || case when (e.value->>'down')::boolean then 'D' else '' end
        || ' s' || coalesce(e.value->>'shield', '?') || ' b' || coalesce(e.value->>'buff', '?') || ' d' || coalesce(e.value->>'debuff', '?') || ' c' || coalesce(e.value->>'cd', '?')
        || ' p' || coalesce(e.value->>'psn', '0') || '/' || coalesce(e.value->>'psnu', '-'), ', ' order by e.key) from jsonb_each(coalesce(st->'cards', '{}'::jsonb)) e), '') || ']'
    || ' F[' || coalesce((select string_agg(coalesce(f.value->>'name', '?') || '{' || coalesce(f.value->>'kind', '?') || ',' || coalesce(f.value->>'key', '?') || ',' || coalesce(f.value->>'element', '?') || ',' || coalesce(f.value->>'passives', '') || '}' || ':' || coalesce(f.value->>'hp', '?') || '/' || coalesce(f.value->>'max', '?')
        || ' sh' || coalesce(f.value->>'sh', '?') || ' e' || coalesce(f.value->>'enr', '?') || '/' || coalesce(f.value->>'enru', '?') || ' w' || coalesce(f.value->>'wk', '?') || '/' || coalesce(f.value->>'wku', '?')
        || ' x' || coalesce(f.value->>'ex', '?') || '/' || coalesce(f.value->>'exu', '?') || ' st' || coalesce(f.value->>'st', '?'), '; ' order by f.ordinality) from jsonb_array_elements(coalesce(st->'foes', '[]'::jsonb)) with ordinality f), '') || ']';
$g$;`);

// A result with the big "state" removed (the digest of the state is added by the caller).
def(String.raw`
create function pg_temp.lab_strip(j jsonb) returns jsonb language sql as $g$
  select case when j ? 'rounds' then jsonb_set(j - 'state', '{rounds}', coalesce((select jsonb_agg(
      (e - 'sup' - 'atk' - 'pass')
      || case when e ? 'sup' then jsonb_build_object('sup', (e->'sup') - 'state') else '{}'::jsonb end
      || case when e ? 'atk' then jsonb_build_object('atk', (e->'atk') - 'state') else '{}'::jsonb end
      || case when e ? 'pass' then jsonb_build_object('pass', (e->'pass') - 'state') else '{}'::jsonb end) from jsonb_array_elements(j->'rounds') e), '[]'::jsonb))
    else j - 'state' end;
$g$;`);

// ---------------------------------------------------------------------------------------------------------------------
// Play a Dungeon or Gauntlet run that is already started (dungeon_start / gauntlet_start made it) until it ends.
// p_policy: 'script' (one call for each action: dungeon_support, dungeon_attack, dungeon_pass_turn, dungeon_choose) or
// 'auto' (dungeon_auto_rounds, the call that the Auto button makes), 'finish' (dungeon_finish_room, the Finish room button: a whole fight in one call). p_opts: log (true = a transcript), max_calls,
// retreat_floor (retreat on this floor when the floor is done; 0 = never).
// Returns {log, calls, stop, viol, err, ...metrics}. Every rule that the Lab reports is read from the real log table
// (combat_actions) and the real run row, never calculated here.
def(String.raw`
create function pg_temp.lab_play(p_player text, p_mode text, p_policy text, p_opts jsonb) returns jsonb language plpgsql as $g$
declare
  v_log boolean := coalesce((p_opts->>'log')::boolean, false); v_max int := coalesce((p_opts->>'max_calls')::int, 250); v_ret int := coalesce((p_opts->>'retreat_floor')::int, 0); v_fo boolean := coalesce((p_opts->>'fight_only')::boolean, false);
  v_out text := ''; v_calls int := 0; r dungeon_runs; st jsonb; res jsonb; v_round int; x bigint; ab jsonb; eff text; tg text; v_t bigint; v_stop text := 'ended';
  v_viol text[] := '{}'; v_err jsonb := '{}'::jsonb; v_pass int := 0; v_passrun int := 0; v_passmax int := 0; v_rr int := 0; v_try int; v_n int; v_ok boolean; v_code text;
  v_att int := 0; v_sup int := 0; v_dmg bigint := 0; v_kills int := 0; v_rmax int := 0; v_mode text := case when p_mode = 'gauntlet' then 'gauntlet' else 'dungeon' end;
  v_atks bigint[]; v_runid bigint; v_pick int; v_fst int := 0; v_fstmax int := 0; v_fcmax int := 0; v_flim int := 0; v_frooms int := 0;
begin
  loop
    select * into r from dungeon_runs where player_id = p_player and mode = p_mode and status = 'active' order by id desc limit 1;
    exit when not found;
    v_runid := r.id;
    if v_calls >= v_max then v_stop := 'max_calls'; exit; end if;
    st := r.state;
    v_viol := v_viol || pg_temp.lab_viol_state(st);
    v_rmax := greatest(v_rmax, coalesce((st->>'round')::int, 0));
    if st->>'phase' = 'fight' then
      if p_policy in ('auto', 'finish') then
        v_calls := v_calls + 1;
        begin res := case when p_policy = 'finish' then dungeon_finish_room(p_player, p_mode) else dungeon_auto_rounds(p_player, p_mode, 10) end;
        exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if v_log then v_out := v_out || case when p_policy = 'finish' then 'FINISH ' else 'AUTO ' end || pg_temp.lab_strip(res)::text || E'\n'; end if;
        v_ok := coalesce((res->>'ok')::boolean, false);
        if p_policy = 'finish' and v_ok then v_frooms := v_frooms + 1; v_fcmax := greatest(v_fcmax, coalesce((res->>'calls')::int, 0)); if res->>'outcome' = 'limit' then v_flim := v_flim + 1; end if; end if;
        if not v_ok then v_err := jsonb_set(v_err, array[coalesce(res->>'error', '?')], to_jsonb(coalesce((v_err->>coalesce(res->>'error', '?'))::int, 0) + 1)); v_stop := 'error:' || coalesce(res->>'error', '?'); exit; end if;
        v_att := v_att + coalesce((res->>'played')::int, 0);
        if p_policy = 'finish' then v_kills := v_kills + (select count(*) from jsonb_array_elements(res->'rounds') e where (e->'atk'->>'kill')::boolean)::int; elsif res->>'stopped' = 'kill' then v_kills := v_kills + 1; end if;
      else
        v_round := (st->>'round')::int;
        -- the support of this round: each support card in squad order, until one works
        if coalesce((st->>'sup_round')::int, -1) <> v_round then
          foreach x in array r.squad loop
            ab := dungeon_run_card(r, x)->'ability';
            continue when ab is null or ab->>'kind' <> 'support';
            eff := ab->>'effect'; tg := coalesce(ab->>'target', 'boss'); v_t := null;
            if tg in ('ally', 'self') then
              select e.key::bigint into v_t from jsonb_each(st->'cards') e
                where not (e.value->>'down')::boolean and not coalesce((e.value->>'sup')::boolean, false)
                order by case when eff = 'empower' then 0 else (e.value->>'hp')::numeric / greatest(1, (e.value->>'max')::numeric) end, e.key::bigint limit 1;
              if v_t is null then continue; end if;
            end if;
            v_calls := v_calls + 1;
            begin res := dungeon_support(p_player, x, v_t, null, p_mode);
            exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
            if v_log then v_out := v_out || 'S' || x || ' ' || pg_temp.lab_strip(res)::text || ' | ' || coalesce(pg_temp.lab_digest(res->'state'), '') || E'\n'; end if;
            if coalesce((res->>'ok')::boolean, false) then v_sup := v_sup + 1; if coalesce((res->>'kill')::boolean, false) then v_kills := v_kills + 1; end if; exit;
            else v_err := jsonb_set(v_err, array[coalesce(res->>'error', '?')], to_jsonb(coalesce((v_err->>coalesce(res->>'error', '?'))::int, 0) + 1)); end if;
          end loop;
          select * into r from dungeon_runs where id = v_runid; st := r.state;
          continue when r.status <> 'active' or st->>'phase' <> 'fight';
        end if;
        -- the attack: the attackers in turn (a stunned or downed card is refused and the next one tries)
        select coalesce(array_agg(u.x order by u.o), '{}') into v_atks from unnest(r.squad) with ordinality u(x, o)
          where dungeon_run_card(r, u.x)->>'type' in ('Character', 'Creature');
        v_n := coalesce(array_length(v_atks, 1), 0); v_ok := false;
        for v_try in 0..v_n - 1 loop
          x := v_atks[((v_rr + v_try) % v_n) + 1];
          v_calls := v_calls + 1;
          begin res := dungeon_attack(p_player, x, v_calls % 3, p_mode);
          exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
          if v_log then v_out := v_out || 'A' || x || ' ' || pg_temp.lab_strip(res)::text || ' | ' || coalesce(pg_temp.lab_digest(res->'state'), '') || E'\n'; end if;
          if coalesce((res->>'ok')::boolean, false) then
            v_ok := true; v_att := v_att + 1; v_dmg := v_dmg + coalesce((res->>'damage')::int, 0);
            if jsonb_array_length(coalesce(res->'enemy', '[]'::jsonb)) > 0 and not exists (select 1 from jsonb_array_elements(res->'enemy') q where q->>'action' <> 'stunned') then v_fst := v_fst + 1; v_fstmax := greatest(v_fstmax, v_fst); else v_fst := 0; end if; if coalesce((res->>'kill')::boolean, false) then v_kills := v_kills + 1; end if;
            v_rr := v_rr + v_try + 1; v_passrun := 0; exit;
          else
            v_err := jsonb_set(v_err, array[coalesce(res->>'error', '?')], to_jsonb(coalesce((v_err->>coalesce(res->>'error', '?'))::int, 0) + 1));
            exit when res->>'error' in ('round_cap', 'disabled', 'no_run', 'not_fighting');
          end if;
        end loop;
        if not v_ok then
          if res->>'error' = 'round_cap' then v_stop := 'round_cap'; exit; end if;
          -- no attacker can act: the turn passes (not forced first, then forced: the Auto button forces)
          v_calls := v_calls + 1;
          begin res := dungeon_pass_turn(p_player, p_mode, false);
          exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
          if v_log then v_out := v_out || 'P0 ' || pg_temp.lab_strip(res)::text || E'\n'; end if;
          if not coalesce((res->>'ok')::boolean, false) and res->>'error' = 'can_act' and res->>'why' = 'support' then
            v_calls := v_calls + 1;
            begin res := dungeon_pass_turn(p_player, p_mode, true);
            exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
            if v_log then v_out := v_out || 'P1 ' || pg_temp.lab_strip(res)::text || E'\n'; end if;
          end if;
          if coalesce((res->>'ok')::boolean, false) then v_pass := v_pass + 1; v_passrun := v_passrun + 1; v_passmax := greatest(v_passmax, v_passrun);
          else
            v_err := jsonb_set(v_err, array['pass:' || coalesce(res->>'error', '?')], to_jsonb(coalesce((v_err->>('pass:' || coalesce(res->>'error', '?')))::int, 0) + 1));
            v_stop := 'stuck:' || coalesce(res->>'error', '?'); exit;
          end if;
        end if;
      end if;
    elsif v_fo and st->>'phase' in ('choose', 'rest', 'chest', 'path', 'floor_done') then
      v_stop := 'room_done'; exit;
    elsif st->>'phase' in ('choose', 'rest', 'chest', 'path', 'floor_done') then
      v_calls := v_calls + 1;
      if st->>'phase' = 'floor_done' and v_ret > 0 and r.floor >= v_ret then
        begin res := dungeon_retreat(p_player, p_mode);
        exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if v_log then v_out := v_out || 'RETREAT ' || res::text || E'\n'; end if;
      else
        -- the first offer, or the one after it on every third choice (the offers come from random(): the doors, the chests)
        v_pick := case when jsonb_array_length(coalesce(st->'offers', '[]'::jsonb)) > 1 and v_calls % 3 = 0 then 1 else 0 end;
        begin res := dungeon_choose(p_player, v_pick, p_mode);
        exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if v_log then v_out := v_out || 'CHOOSE' || v_pick || ' ' || pg_temp.lab_strip(res)::text || ' | ' || coalesce(pg_temp.lab_digest(res->'state'), '') || E'\n'; end if;
      end if;
      if not coalesce((res->>'ok')::boolean, false) then
        v_err := jsonb_set(v_err, array[coalesce(res->>'error', '?')], to_jsonb(coalesce((v_err->>coalesce(res->>'error', '?'))::int, 0) + 1)); v_stop := 'error:' || coalesce(res->>'error', '?'); exit;
      end if;
    else
      v_stop := 'phase:' || coalesce(st->>'phase', '?'); exit;
    end if;
  end loop;
  select * into r from dungeon_runs where id = v_runid;
  if found then v_viol := v_viol || pg_temp.lab_viol_state(r.state); end if;
  return jsonb_build_object('log', v_out, 'calls', v_calls, 'stop', v_stop, 'viol', (select coalesce(jsonb_agg(distinct q), '[]'::jsonb) from unnest(v_viol) q), 'err', v_err,
    'attacks', v_att, 'supports', v_sup, 'dmg', v_dmg, 'kills', v_kills, 'rounds_max', v_rmax, 'passes', v_pass, 'pass_run_max', v_passmax, 'foe_stun_run_max', v_fstmax,
    'run', v_runid, 'status', r.status, 'ended_by', r.ended_by, 'floor', r.floor, 'room', r.room, 'turns', r.turns, 'shards', r.shards, 'cards', to_jsonb(r.cards), 'phase', r.state->>'phase',
    'hp_end', (select coalesce(sum((e.value->>'hp')::numeric), 0) from jsonb_each(r.state->'cards') e), 'hp_max', (select coalesce(sum((e.value->>'max')::numeric), 0) from jsonb_each(r.state->'cards') e),
    'downs', (select count(*) from jsonb_each(r.state->'cards') e where (e.value->>'down')::boolean), 'mode', v_mode,
    'finish_rooms', v_frooms, 'finish_calls_max', v_fcmax, 'finish_limits', v_flim);
end $g$;`);

// What the run paid and what the fight wrote, read from the real tables. Used by the Lab (the reward and loop checks) and
// by the golden transcript. p_run: the run id. Each reward pays once: one Shard row for the run, one card row for each card.
def(String.raw`
create function pg_temp.lab_run_facts(p_player text, p_run bigint, p_mode text) returns jsonb language plpgsql as $g$
declare r dungeon_runs; v_label text := case when p_mode = 'gauntlet' then 'gauntlet' else 'dungeon' end; v_sh_rows int; v_sh_sum int; v_cd_rows int; v_dup int;
  v_sh_rows2 int; v_cd_rows2 int; v_dmg numeric; v_heal numeric; v_fheal numeric; v_cd0 int; v_sup_rows int; v_cdmg numeric;
begin
  select * into r from dungeon_runs where id = p_run;
  select count(*), coalesce(sum(amount), 0) into v_sh_rows, v_sh_sum from shard_ledger where player_id = p_player and ref_kind = 'run' and ref_id = p_run::text;
  select count(*) into v_cd_rows from card_ledger where player_id = p_player and ref_kind = 'dungeon_run' and ref_id = p_run::text and reason = 'dungeon_loot';
  -- a second settle must pay nothing more (the run is over: dungeon_settle returns what it paid before)
  if r.status = 'over' then
    begin perform dungeon_settle(p_run, 'cleared', true); exception when others then null; end;
  end if;
  select count(*) into v_sh_rows2 from shard_ledger where player_id = p_player and ref_kind = 'run' and ref_id = p_run::text;
  select count(*) into v_cd_rows2 from card_ledger where player_id = p_player and ref_kind = 'dungeon_run' and ref_id = p_run::text and reason = 'dungeon_loot';
  select coalesce(sum((result->>'value')::numeric) filter (where result->>'side' = 'foe' and result->>'dir' = 'dmg'), 0),
         coalesce(sum((result->>'value')::numeric) filter (where result->>'side' = 'card' and result->>'dir' = 'heal'), 0),
         coalesce(sum((result->>'value')::numeric) filter (where result->>'side' = 'foe' and result->>'dir' = 'heal'), 0),
         coalesce(sum((result->>'value')::numeric) filter (where result->>'side' = 'card' and result->>'dir' = 'dmg'), 0),
         count(*) filter (where kind = 'support' and (result->>'cooldown')::numeric < 1),
         count(*) filter (where kind = 'support')
    into v_dmg, v_heal, v_fheal, v_cdmg, v_cd0, v_sup_rows from combat_actions where mode = v_label and ref_id = p_run;
  return jsonb_build_object('sh_rows', v_sh_rows, 'sh_sum', v_sh_sum, 'run_shards', r.shards, 'cd_rows', v_cd_rows, 'run_cards', coalesce(cardinality(r.cards), 0),
    'resettle_sh_rows', v_sh_rows2, 'resettle_cd_rows', v_cd_rows2, 'foe_dmg', v_dmg, 'card_heal', v_heal, 'foe_heal', v_fheal, 'card_dmg', v_cdmg, 'cd0', v_cd0, 'support_rows', v_sup_rows);
end $g$;`);

// ---------------------------------------------------------------------------------------------------------------------
// One Dungeon or Gauntlet run from the start. p_floors / p_squad: a fixed layout (the golden test and the foe sweep) or null
// for the real day or week. p_builds: the stars and stat points of the member's copies. Everything is undone at the end.
// Returns the result of lab_play with the facts of the run.
def(String.raw`
create function pg_temp.lab_dungeon_run(p_seed float, p_mode text, p_squad bigint[], p_builds jsonb, p_floors jsonb, p_policy text, p_opts jsonb) returns jsonb language plpgsql as $g$
declare v_p text := 'tst_lab'; v_day date := dungeon_day(); res jsonb; v_play jsonb; v_out jsonb; v_pre text := ''; v_facts jsonb; v_floors jsonb := p_floors; v_squad bigint[] := p_squad; v_builds jsonb := p_builds;
begin
  begin
    -- A door room is made from the run id (dungeon_choose: rk = 'door|' || run id), so the same seed gave other foes after other runs. The id
    -- restarts at the same number for every fight (an ALTER SEQUENCE is undone with the rest, unlike nextval).
    execute 'alter sequence ' || pg_get_serial_sequence('dungeon_runs', 'id') || ' restart with 5000001';
    -- The real week of the Gauntlet: its squad is known after gauntlet_generate. opts.rich: the member owns that squad at 5 stars with stat points
    -- (the Gauntlet must play the same fight as for a member with no stars: the 0-star rule).
    if p_mode = 'gauntlet' and p_floors is null then
      perform gauntlet_generate(gauntlet_week(v_day));
      select squad into v_squad from gauntlet_weeks where week = gauntlet_week(v_day);
      if coalesce((p_opts->>'rich')::boolean, false) then
        v_builds := (select jsonb_object_agg(c::text, '{"asc": 5, "pts": {"attack": 3, "vitality": 3, "precision": 3, "potency": 3, "haste": 3}}'::jsonb) from unnest(v_squad) c);
      end if;
    end if;
    perform pg_temp.lab_member(v_p, v_squad, v_builds, true);
    update settings set value = value || '{"enabled": true}'::jsonb where key in ('dungeon', 'gauntlet');
    if p_mode = 'gauntlet' then
      if p_floors is not null then
        insert into gauntlet_weeks (week, name, squad, theme, floors) values (gauntlet_week(v_day), 'Lab', p_squad, null, p_floors)
          on conflict (week) do update set squad = excluded.squad, floors = excluded.floors;
      end if;
    else
      if p_floors is not null then
        insert into dungeon_days (day, name, rule, floors) values (v_day, 'Lab', '{"budget": 99}'::jsonb, p_floors)
          on conflict (day) do update set rule = excluded.rule, floors = excluded.floors;
      else
        perform dungeon_generate(v_day);
        update dungeon_days set rule = '{"budget": 99}'::jsonb where day = v_day;   -- no day rule: the Lab picks the squad
      end if;
    end if;
    perform setseed(p_seed);
    res := case when p_mode = 'gauntlet' then gauntlet_start(v_p) else dungeon_start(v_p, p_squad) end;
    if not coalesce((res->>'ok')::boolean, false) then
      v_out := jsonb_build_object('start_error', res - 'state');
    else
      if coalesce((p_opts->>'log')::boolean, false) then v_pre := 'START ' || pg_temp.lab_digest(res->'state') || E'\n'; end if;
      v_play := pg_temp.lab_play(v_p, p_mode, p_policy, p_opts);
      v_facts := pg_temp.lab_run_facts(v_p, (v_play->>'run')::bigint, p_mode);
      v_out := v_play || jsonb_build_object('log', v_pre || (v_play->>'log') || 'RUN ' || (v_play->>'status') || ' ' || coalesce(v_play->>'ended_by', '-') || ' floor=' || (v_play->>'floor') || ' room=' || (v_play->>'room')
        || ' turns=' || (v_play->>'turns') || ' shards=' || (v_play->>'shards') || ' cards=' || (v_play->>'cards') || ' stop=' || (v_play->>'stop')
        || ' ledger=' || (select coalesce(string_agg(reason || ':' || amount, ',' order by reason, amount), '') from shard_ledger where player_id = v_p)
        || '/' || (select count(*) from card_ledger where player_id = v_p and reason = 'dungeon_loot') || E'\n', 'facts', v_facts);
    end if;
    raise exception using errcode = 'U0001', message = 'undo';
  exception when sqlstate 'U0001' then null;
  end;
  return v_out;
end $g$;`);

// The transcript text of one run (the golden test): the log, the broken limits, the refused calls. A fight that did not start has a line of its own.
def(String.raw`
create function pg_temp.lab_text(x jsonb) returns text language sql as $g$
  select case when x ? 'start_error' then 'START_ERROR ' || (x->'start_error')::text || chr(10)
    else (x->>'log') || 'VIOL ' || (x->'viol')::text || ' ERR ' || (x->'err')::text || chr(10) end;
$g$;`);

// ---------------------------------------------------------------------------------------------------------------------
// A foe of a wanted element, kind, monster and passive, from dungeon_make_foe. The key of the foe is searched (its random
// numbers come from a hash of the key), so the foe is the real thing, with the real stats, moves, passives and weaknesses.
def(String.raw`
create function pg_temp.lab_foe(p_kind text, p_floor int, p_room int, p_el text, p_mon text, p_pass text, p_tag text) returns jsonb language plpgsql as $g$
declare i int; f jsonb;
begin
  for i in 1..30000 loop
    f := dungeon_make_foe('lab|' || p_tag || '|' || i, p_floor, p_room, p_kind);
    if (p_el is null or f->>'element' = p_el) and (p_mon is null or f->>'key' = p_mon) and (p_pass is null or f->'passives' ? p_pass) then return f; end if;
  end loop;
  raise exception 'lab_foe: no foe found for % % % %', p_kind, p_el, p_mon, p_pass;
end $g$;`);

// ---------------------------------------------------------------------------------------------------------------------
// The Hunt. A boss, a squad lock and a fight, with the real functions hunt_attack and hunt_support.
// p_boss = {name, tier, hp, hp_frac, hp_share, atk, passive: [kinds], weak: [], resist: []}
def(String.raw`
create function pg_temp.lab_hunt_new(p text, p_squad bigint[], p_boss jsonb) returns bigint language plpgsql as $g$
declare v_h bigint; v_day date := (now() at time zone 'America/Denver')::date; v_hp bigint := coalesce((p_boss->>'hp')::bigint, 1000000000);
  v_tier text := coalesce(p_boss->>'tier', 'Normal');
begin
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive, stats)
    values (coalesce(p_boss->>'name', 'Lab Boss'), v_tier, coalesce(p_boss->'weak', '[]'::jsonb), coalesce(p_boss->'resist', '[]'::jsonb), v_hp,
      greatest(1, round(v_hp * coalesce((p_boss->>'hp_frac')::numeric, 1)))::bigint,
      coalesce((p_boss->>'hp_share')::bigint, (balance_get('boss_hp')->>'heal_share')::bigint, v_hp), now() - interval '1 hour', now() + interval '1 day', 'active',
      jsonb_build_object('kind', p_boss->'passive'->>0, 'list', coalesce((select jsonb_agg(jsonb_build_object('kind', k)) from jsonb_array_elements_text(coalesce(p_boss->'passive', '[]'::jsonb)) k), '[]'::jsonb)),
      jsonb_build_object('atk', coalesce((p_boss->>'atk')::numeric, balance_num('boss_atk', v_tier))))
    returning id into v_h;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids, locked_at) values (v_h, p, v_day, p_squad, now());
  return v_h;
end $g$;`);

// The limits of a Hunt (the Lab invariants): the boss HP and every card of the squad.
def(String.raw`
create function pg_temp.lab_viol_hunt(p_hunt bigint) returns text[] language plpgsql as $g$
declare v text[] := '{}'; h hunts; e record;
begin
  select * into h from hunts where id = p_hunt;
  if h.hp_remaining < 0 then v := v || 'boss HP below 0'; end if;
  if h.hp_remaining > h.hp_max then v := v || 'boss HP above the maximum'; end if;
  if h.hp_remaining is null or h.hp_max is null then v := v || 'boss HP is NULL'; end if;
  for e in select * from hunt_card_hp where hunt_id = p_hunt loop
    if e.hp_remaining < 0 then v := v || ('card ' || e.card_id || ': HP below 0'); end if;
    if e.hp_remaining > e.max_hp then v := v || ('card ' || e.card_id || ': HP above the maximum'); end if;
    if e.shield < 0 then v := v || ('card ' || e.card_id || ': shield below 0'); end if;
    if e.dmg_buff is null or e.dmg_buff <= 0 or e.dmg_debuff is null or e.dmg_debuff <= 0 then v := v || ('card ' || e.card_id || ': a damage multiplier of 0 or less'); end if;
    if coalesce(e.cd_until_round, 0) < 0 then v := v || ('card ' || e.card_id || ': cooldown below 0'); end if;
    if e.downed and e.hp_remaining > 0 then v := v || ('card ' || e.card_id || ': down with HP left'); end if;
  end loop;
  return v;
end $g$;`);

// A Hunt fight with a squad: each round the ready supports play (at the best target), then the next living attacker attacks.
// One attack = one round (the boss acts after each attack). p_rounds = the number of attacks at most.
// Returns the totals that the Lab reports; the facts are read from the real tables (hunts, hunt_card_hp, combat_actions).
def(String.raw`
create function pg_temp.lab_hunt_fight(p_seed float, p_squad bigint[], p_builds jsonb, p_boss jsonb, p_rounds int, p_opts jsonb) returns jsonb language plpgsql as $g$
declare v_p text := 'tst_lab'; v_h bigint; v_out jsonb; v_atk bigint[]; v_sup bigint[]; x bigint; v_t bigint; res jsonb; ab jsonb; eff text; tg text; i int; v_n int; v_ok boolean;
  v_att int := 0; v_dmg bigint := 0; v_supok int := 0; v_err jsonb := '{}'::jsonb; v_viol text[] := '{}'; v_stop text := 'rounds'; v_rr int := 0; v_try int; v_code text;
  v_bheal bigint := 0; v_lheal bigint := 0; v_stun int := 0; v_stunmax int := 0; v_def boolean := false; v_log text := ''; v_logon boolean := coalesce((p_opts->>'log')::boolean, false); v_crit int := 0; v_miss int := 0; v_hpmax bigint; v_rcap int;
begin
  begin
    perform pg_temp.lab_member(v_p, p_squad, p_builds, false);
    v_h := pg_temp.lab_hunt_new(v_p, p_squad, p_boss);
    perform setseed(p_seed);
    select coalesce(array_agg(u.c order by u.o) filter (where s.type in ('Character', 'Creature')), '{}'), coalesce(array_agg(u.c order by u.o) filter (where s.type not in ('Character', 'Creature')), '{}')
      into v_atk, v_sup from unnest(p_squad) with ordinality u(c, o) join cards c on c.id = u.c join subjects s on s.id = c.subject_id;
    v_n := coalesce(array_length(v_atk, 1), 0);
    for i in 1..p_rounds loop
      -- the supports: each one that is ready, at the best target
      foreach x in array v_sup loop
        select s.ability into ab from cards c join subjects s on s.id = c.subject_id where c.id = x;
        continue when ab is null or ab->>'kind' <> 'support';
        eff := ab->>'effect'; tg := coalesce(ab->>'target', 'boss'); v_t := null;
        if tg = 'self' then v_t := x;
        elsif tg = 'ally' then
          select a into v_t from unnest(v_atk) with ordinality u(a, o)
            where not exists (select 1 from hunt_card_hp h where h.hunt_id = v_h and h.card_id = a and h.downed)
            order by case when eff = 'empower' then 0 else coalesce((select h.hp_remaining::numeric / greatest(1, h.max_hp) from hunt_card_hp h where h.hunt_id = v_h and h.card_id = a), 1) end, o limit 1;
          continue when v_t is null;
        end if;
        begin res := hunt_support(v_p, v_h, x, v_t);
        exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if v_logon then v_log := v_log || 'S' || x || ' ' || res::text || E'\n'; end if;
        if coalesce((res->>'ok')::boolean, false) then v_supok := v_supok + 1;
        else v_code := coalesce(res->>'error', '?'); v_err := jsonb_set(v_err, array[v_code], to_jsonb(coalesce((v_err->>v_code)::int, 0) + 1)); end if;
        if coalesce((res->>'defeated')::boolean, false) then v_def := true; end if;
      end loop;
      exit when v_def;
      -- the attack: the attackers in turn
      v_ok := false;
      for v_try in 0..v_n - 1 loop
        x := v_atk[((v_rr + v_try) % v_n) + 1];
        begin res := hunt_attack(v_p, v_h, x);
        exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if v_logon then v_log := v_log || 'A' || x || ' ' || res::text || E'\n'; end if;
        if coalesce((res->>'ok')::boolean, false) then
          v_ok := true; v_att := v_att + 1; v_dmg := v_dmg + coalesce((res->>'damage')::int, 0); v_bheal := v_bheal + coalesce((res->>'boss_heal')::int, 0); v_lheal := v_lheal + coalesce((res->>'heal')::int, 0);
          if res->'boss_action'->>'kind' = 'stunned' then v_stun := v_stun + 1; v_stunmax := greatest(v_stunmax, v_stun); else v_stun := 0; end if;
          if (res->>'outcome') = 'crit' then v_crit := v_crit + 1; end if; if (res->>'outcome') = 'miss' then v_miss := v_miss + 1; end if;
          v_rr := v_rr + v_try + 1;
          if coalesce((res->>'defeated')::boolean, false) then v_def := true; end if;
          exit;
        else
          v_code := coalesce(res->>'error', '?'); v_err := jsonb_set(v_err, array[v_code], to_jsonb(coalesce((v_err->>v_code)::int, 0) + 1));
          exit when v_code in ('round_cap', 'hunt_over', 'day_limit');
        end if;
      end loop;
      v_viol := v_viol || pg_temp.lab_viol_hunt(v_h);
      if v_def then v_stop := 'defeated'; exit; end if;
      if not v_ok then v_stop := 'no_attack:' || coalesce(res->>'error', '?'); exit; end if;
    end loop;
    select hp_max into v_hpmax from hunts where id = v_h;
    v_out := jsonb_build_object('attacks', v_att, 'dmg_gross', v_dmg, 'boss_net', (select hp_max - hp_remaining from hunts where id = v_h), 'boss_max', v_hpmax,
      'boss_heal', v_bheal, 'lifesteal_heal', v_lheal, 'boss_stun_run_max', v_stunmax, 'supports', v_supok, 'err', v_err, 'stop', v_stop, 'crit', v_crit, 'miss', v_miss, 'defeated', v_def,
      'viol', (select coalesce(jsonb_agg(distinct q), '[]'::jsonb) from unnest(v_viol) q),
      'squad_hp_lost', (select coalesce(sum(max_hp - hp_remaining), 0) from hunt_card_hp where hunt_id = v_h),
      'squad_hp_max', (select coalesce(sum(max_hp), 0) from hunt_card_hp where hunt_id = v_h),
      'downs', (select count(*) from hunt_card_hp where hunt_id = v_h and downed),
      'cards_in', (select count(*) from hunt_card_hp where hunt_id = v_h),
      'heal_gained', (select coalesce(sum((result->>'gained')::numeric), 0) from combat_actions where mode = 'hunt' and ref_id = v_h and kind = 'support' and effect = 'heal'),
      'shield_value', (select coalesce(sum((result->>'value')::numeric), 0) from combat_actions where mode = 'hunt' and ref_id = v_h and kind = 'support' and effect = 'shield'),
      'sup_rows', (select count(*) from combat_actions where mode = 'hunt' and ref_id = v_h and kind = 'support'),
      'cd0', (select count(*) from combat_actions where mode = 'hunt' and ref_id = v_h and kind = 'support' and (result->>'cooldown')::numeric < 1),
      'settled', (select settled_at is not null from hunts where id = v_h),
      'pack_rows', (select count(*) from pack_ledger where ref_kind = 'hunt' and ref_id = v_h::text),
      'pack_players', (select count(distinct player_id) from pack_ledger where ref_kind = 'hunt' and ref_id = v_h::text),
      'log', v_log);
    if v_def then
      -- a second settle must pay nothing: each reward pays once
      begin perform settle_hunt(v_h); exception when others then null; end;
      v_out := v_out || jsonb_build_object('pack_rows_after', (select count(*) from pack_ledger where ref_kind = 'hunt' and ref_id = v_h::text));
    end if;
    raise exception using errcode = 'U0001', message = 'undo';
  exception when sqlstate 'U0001' then null;
  end;
  return v_out;
end $g$;`);


// The duel: one card attacks a boss once for each seed (each attack in its own undone block). Returns the sums that give the damage of one
// attack and the HP that the boss counter takes from the card in that round. (The Lab turns them into the expected damage before it falls.)
def(String.raw`
create function pg_temp.lab_hunt_duel(p_card bigint, p_builds jsonb, p_boss jsonb, p_seeds float[]) returns jsonb language plpgsql as $g$
declare v_p text := 'tst_lab'; v_out jsonb; v_h bigint; res jsonb; sd float; n int := 0; v_dmg numeric := 0; v_loss numeric := 0; v_crit int := 0; v_miss int := 0; v_cp int; v_hp int;
  v_viol text[] := '{}'; v_err int := 0; v_last text; v_sq bigint[] := array[p_card]; v_dsq numeric := 0;
begin
  begin
    perform pg_temp.lab_member(v_p, v_sq, p_builds, false);
    foreach sd in array p_seeds loop
      begin
        v_h := pg_temp.lab_hunt_new(v_p, v_sq, p_boss);
        perform setseed(sd);
        begin res := hunt_attack(v_p, v_h, p_card); exception when others then res := jsonb_build_object('ok', false, 'error', 'SQL ' || sqlstate || ' ' || sqlerrm); end;
        if coalesce((res->>'ok')::boolean, false) then
          n := n + 1; v_dmg := v_dmg + (res->>'damage')::numeric; v_dsq := v_dsq + power((res->>'damage')::numeric, 2);
          v_loss := v_loss + ((res->>'card_max_hp')::numeric - (res->>'card_hp')::numeric);
          v_cp := (res->>'cp')::int; v_hp := (res->>'card_max_hp')::int;
          if res->>'outcome' = 'crit' then v_crit := v_crit + 1; end if;
          if res->>'outcome' = 'miss' then v_miss := v_miss + 1; end if;
          v_viol := v_viol || pg_temp.lab_viol_hunt(v_h);
        else v_err := v_err + 1; v_last := coalesce(res->>'error', '?'); end if;
        raise exception using errcode = 'U0001', message = 'undo';
      exception when sqlstate 'U0001' then null;
      end;
    end loop;
    v_out := jsonb_build_object('n', n, 'dmg_sum', v_dmg, 'dmg_sq', v_dsq, 'loss_sum', v_loss, 'cp', v_cp, 'hp', v_hp, 'crit', v_crit, 'miss', v_miss, 'err', v_err, 'last_error', v_last,
      'viol', (select coalesce(jsonb_agg(distinct q), '[]'::jsonb) from unnest(v_viol) q));
    raise exception using errcode = 'U0001', message = 'undo';
  exception when sqlstate 'U0001' then null;
  end;
  return v_out;
end $g$;`);

/** The SQL that creates every helper. Put it inside a DO block. Each function is one execute, so a $ inside it does not matter. */
export function installHelpers() {
  return defs.map((d, i) => `execute $h${i}$\n${d}\n$h${i}$;`).join('\n');
}
export const HELPER_COUNT = defs.length;
