-- combat_v2_convert.sql (2026-11-04): combat v2 step M1e, the conversion of the v1 stat points into the v2 card progress at the switch
-- (SPEC ON v6 section 3.7, docs/combat-redesign-plan.md 11 and 20.11; Nathan N-4 rejected, N-7 = option B, N-7b, N-8, N-9, N-10).
-- Needs combat_v2_progress_tables.sql (M1a), combat_v2_progress_math.sql (M1b), combat_v2_progress_spend.sql (M1c),
-- combat_v2_progress_freeze_v1.sql (M1d) and combat_v2_testers.sql (combat_v2_on with a player).
-- Before: the v1 points (player_cards.stat_points) are the only stat points; card_progress_v2 and its ledger are empty; a v2 fight uses level 0
--   and no points; the Shop stat reset of a player with v2 progress ON routes to the v2 reset (M1d).
-- After this file:
--   combat_v2_switch_log (id, action on/off, at = clock_timestamp(), by): the LAST statement of combat_v2_switch_on.sql and
--     combat_v2_switch_off.sql writes one row. Its "at" is the switch time of the live checks (SPEC ON 6.7 row 7).
--   combat_v2_convert_input (id, ref, player, card, stars, stat_points, at): the conversion input, the audit record and the expected value of
--     every live check. The CURRENT input of a card = its newest row by (at, id). PK (ref, player_id, card_id).
--   balance v2_convert (a note, a fixed shape in balance_v2_spec): ratios, to, round, level_per_star, dead_on_attacker, topup.
--   combat_v2_convert_expect(card, stars, v1 points): the rule for one card (rules 2 to 6): level = level_per_star x stars (capped), XP of the
--     level, each v1 stat x its ratio rounded (up), the top-up of attack and vitality (the smallest count whose v2 value at that level reaches
--     the v1 value, at most the cap), the cap (the part above v2_stats.max_per_stat -> bonus, refund with the stat), the points above the
--     level budget -> bonus (refund with no stat), Support and Recharge on a v1 attacker -> dead_points. Answer: the row and its ledger rows.
--   combat_v2_convert_write(input id): one input row -> one NEW progress row: the row at level 0, then each ledger row FIRST and the progress
--     change only when the ledger insert added a row (rule 7). A card that already has a progress row is skipped (never added to).
--   combat_v2_convert(ref default 'm1'): refuses unless combat_v2_on('progress'). Copies every player_cards row with v1 points whose card has
--     NO input row of any ref into the input, then writes each. A second run, also after an undo, adds 0 rows. The v1 points do not change.
--   combat_v2_convert_undo(ref, cards default null): deletes the progress rows whose ledger rows all carry the ref (rule 8).
--   combat_v2_convert_check(cards default null): reads only. SPEC ON 6.7 rows 2a and 2b for every card whose player_cards row exists:
--     input_missing, progress_mismatch (the row <> combat_v2_convert_expect(the current input), or its ledger sums <> the row), live_differs
--     (the live v1 points <> the current input), log_after_switch (a stat_point_log spend or reset after the last switch "on").
--   combat_v2_convert_fix(cards default null): rule 8b on the cards that the check finds: a row with a spend, reset or xp ledger row is
--     reported; a card that has an m1b input row is reported; else its progress row is deleted, a new input row m1b (the live values) is
--     written and converted into a NEW progress row. A second call adds 0 rows.
--   card_progress_v2_fight(player, card, numbers): the level, the points and the bonus of a card in a v2 fight (rule 5b, N-7b): progress OFF =
--     level 0 and no points; ON = level_per_star x the CURRENT stars (capped at v2_level.max_level; a stored level above it is kept) and the
--     points and bonus of the progress row (none = no points). dungeon_v2_unit (R2-ON) reads it.
--   buy_shop_item(player, 'stat_reset', card): refuses {ok: false, error: 'stat_reset_paused', message} when combat_v2_on('progress', player),
--     BEFORE the player lock and any write (r3 M-1, N-10). shop_today: + stat_reset_paused (the same condition).
-- FLAG OFF = NO CHANGE IN PLAY: the tables stay empty (combat_v2_convert refuses with progress off), no game function reads them, and the Shop
--   answers of a player with progress OFF do not change. The switch files (combat_v2_switch_on.sql, combat_v2_switch_off.sql) are separate.
-- Every number is in balance. Idempotent. Server only (RLS on, no grant to anon or authenticated).
-- GUARD: buy_shop_item and shop_today must be the live text of 2026-11-04 (db/schema at 11b8db77, M1d) or the text this file made.
--   balance_v2_spec without its "-- M1e" line must be the text of main (11b8db77) or of SYN (combat_v2_synergy.sql).
-- Test: card-studio/scripts/test-combat-v2-convert.mjs (rolled back; MUTATE=all must catch every mutation). Dry run: convert-dry-run.mjs.

do $g$
declare m text; f record;
begin
  for f in select * from (values
    ('public.buy_shop_item(text, text, integer, bigint, integer)', 'bfb80045fcb1efa2d6789db4e8b544e8', '8533f2ba1f335adf480056a3209a3de1'),
    ('public.shop_today(text)', '8933bebb433f06b896697f69951696d1', 'b9e70bc35a593b918e310effb19c2a1d')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_convert.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
  -- balance_v2_spec: main (11b8db77) or SYN, each with or without the M1e line
  select md5(regexp_replace(replace(pg_get_functiondef('public.balance_v2_spec(text)'::regprocedure), chr(13), ''), E'\n[^\n]*-- M1e[^\n]*', '', 'g')) into strict m;
  if m not in ('59f02d5aab9be2f8aa9d7d33cecf2c65', '0fc2fa612879bcdfea7277518498302a') then
    raise exception 'combat_v2_convert.sql: the live balance_v2_spec(text) is not the text of main or SYN. Rebuild this file.';
  end if;
end $g$;
-- GUARD-END

-- ============================================================ 1. the switch log and the conversion input
create table if not exists public.combat_v2_switch_log (
  id bigint generated always as identity primary key,
  action text not null check (action in ('on', 'off')),
  at timestamptz not null default clock_timestamp(),
  by text not null default balance_who()
);
alter table public.combat_v2_switch_log enable row level security;
revoke all on public.combat_v2_switch_log from public, anon, authenticated;

create table if not exists public.combat_v2_convert_input (
  id bigint generated always as identity unique,
  ref text not null check (ref ~ '^[a-z0-9_]+$'),
  player_id text not null,
  card_id bigint not null,
  stars integer not null check (stars >= 0),
  stat_points jsonb not null check (jsonb_typeof(stat_points) = 'object'),
  at timestamptz not null default clock_timestamp(),
  primary key (ref, player_id, card_id)
);
create index if not exists combat_v2_convert_input_card on public.combat_v2_convert_input (player_id, card_id, at desc, id desc);
alter table public.combat_v2_convert_input enable row level security;
revoke all on public.combat_v2_convert_input from public, anon, authenticated;

-- ============================================================ 2. the balance key v2_convert (its shape in balance_v2_spec, then the value)
-- balance_v2_spec gets ONE line (the mark "-- M1e") before its final "end": the text of main or of SYN, whichever is live (the guard above
-- checks that the text without the M1e line is one of the two). Done in place, so this file does not copy the other shapes.
do $p$
declare src text; line text := $l$  when 'v2_convert' then '{"ratios": {"attack": "num 0 10", "vitality": "num 0 10", "precision": "num 0 10", "potency": "num 0 10", "haste": "num 0 10"}, "to": {"attack": "enum atk|def|hp|crd|crt|abl|ddg|acc|spd", "vitality": "enum atk|def|hp|crd|crt|abl|ddg|acc|spd", "precision": "enum atk|def|hp|crd|crt|abl|ddg|acc|spd", "potency": "enum atk|def|hp|crd|crt|abl|ddg|acc|spd", "haste": "enum atk|def|hp|crd|crt|abl|ddg|acc|spd"}, "round": "enum up|down|nearest", "level_per_star": "int 1 6", "dead_on_attacker": ["set", "enum attack|vitality|precision|potency|haste", 0, 5], "topup": {"attack": {"v1": "enum cp|hp", "v2": "enum atk|hp"}, "vitality": {"v1": "enum cp|hp", "v2": "enum atk|hp"}}}'::jsonb   -- M1e$l$;
begin
  src := replace(pg_get_functiondef('public.balance_v2_spec(text)'::regprocedure), chr(13), '');
  if position('-- M1e' in src) = 0 then
    if (length(src) - length(replace(src, E'\n  end;\n$function$', ''))) <> length(E'\n  end;\n$function$') then
      raise exception 'combat_v2_convert.sql: balance_v2_spec does not end with exactly one "  end;" line';
    end if;
    execute replace(src, E'\n  end;\n$function$', E'\n' || line || E'\n  end;\n$function$');
  end if;
end $p$;

select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('v2_convert', '{"ratios": {"attack": 1, "vitality": 1, "precision": 1.25, "potency": 2.4, "haste": 3.33},
  "to": {"attack": "atk", "vitality": "hp", "precision": "crt", "potency": "abl", "haste": "spd"},
  "round": "up", "level_per_star": 3, "dead_on_attacker": ["haste", "potency"],
  "topup": {"attack": {"v1": "cp", "v2": "atk"}, "vitality": {"v1": "hp", "v2": "hp"}}}',
 'Combat v2 M1e (plan 11, 20.11; SPEC ON 3.7): the conversion of the v1 stat points at the switch. ratios: v2 points per v1 point (attack -> ATK x1, vitality -> HP x1, precision -> CRT x1.25 = 0.05 / 0.04, potency -> ABL x2.4 = 0.12 / 0.05, haste -> SPD x3.33 = 0.10 / 0.03, the linear value). to: the v2 stat of each v1 stat. round: up (nobody loses part of a point). level_per_star: the level = this x the stars (Nathan N-7 option B and N-7b: the fight level = this x the CURRENT stars). dead_on_attacker: the v1 stats that did nothing on a v1 attacker (ledger reason dead_points). topup: the v1 value (card_combat key) that the v2 value (card_combat_v2 stats key) of the converted stat must reach (the smallest count that reaches the old value, plan 11 step 4). Limits in balance_v2_spec.')
on conflict (key) do nothing;

-- ============================================================ 3. the rule for one card (pure for the card, its stars and its v1 points)
create or replace function public.combat_v2_convert_expect(p_card bigint, p_stars integer, p_pts jsonb) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := combat_v2_numbers(array['v2_convert', 'v2_stats', 'v2_level', 'card_level', 'v2_asc', 'v2_card_hp', 'v2_support', 'v2_speed', 'v2_charge']);
  cv jsonb := b->'v2_convert';
  cap int := (b->'v2_stats'->>'max_per_stat')::int;
  ppl int := (b->'v2_level'->>'points_per_level')::int;
  mx int := (b->'v2_level'->>'max_level')::int;
  lps int := (cv->>'level_per_star')::int;
  c record; v_role text; v_support boolean; lv int; k text; s text; n numeric; x numeric; t int;
  conv jsonb := '{}'; why jsonb := '{}'; top jsonb := '{}'; stored jsonb := '{}'; refund jsonb := '{}';
  pts jsonb := '{}'; v1 jsonb; v2 jsonb; spent int := 0; over int; bonus int := 0; led jsonb := '[]'; budget int;
begin
  if cv is null or cap is null or ppl is null or mx is null or lps is null then raise exception 'combat_v2_convert_expect: no balance value for v2_convert, v2_stats or v2_level'; end if;
  if p_stars is null or p_stars < 0 then raise exception 'combat_v2_convert_expect: the stars must be 0 or more'; end if;
  if p_pts is null or jsonb_typeof(p_pts) <> 'object' then raise exception 'combat_v2_convert_expect: the v1 points must be an object {stat: count}'; end if;
  for k in select x2 from jsonb_object_keys(p_pts) x2 loop
    if not cv->'ratios' ? k then raise exception 'combat_v2_convert_expect: % is not a v1 stat of v2_convert.ratios', k; end if;
    if jsonb_typeof(p_pts->k) <> 'number' or (p_pts->>k)::numeric < 0 or (p_pts->>k)::numeric % 1 <> 0 then
      raise exception 'combat_v2_convert_expect: the v1 points of % must be a whole number of 0 or more', k; end if;
  end loop;
  select c2.rarity::text as rarity, s2.cp_mod, s2.ability->>'kind' as kind, s2.ability_v2->>'role' as role into c
    from public.cards c2 left join public.subjects s2 on s2.id = c2.subject_id where c2.id = p_card;
  if not found then raise exception 'combat_v2_convert_expect: no card %', p_card; end if;
  -- the v1 class: a v1 support has the v1 ability kind support (the v1 Support and Recharge points work only there)
  v_support := c.kind is not distinct from 'support';
  -- the role only changes the speed and the power of card_combat_v2, never atk or hp: a card with no v2 role is measured with the first role
  select key into v_role from public.roles where key = c.role;
  if v_role is null then select key into v_role from public.roles order by ord limit 1; end if;
  -- rule 5 (N-7 option B): the stored level
  lv := least(mx, lps * p_stars);
  -- rule 2 and 6: each v1 stat -> its v2 stat, x the ratio, rounded (up)
  for k in select x2 from jsonb_object_keys(cv->'ratios') x2 order by 1 loop
    n := coalesce((p_pts->>k)::numeric, 0);
    if n = 0 then continue; end if;
    s := cv->'to'->>k;
    x := n * (cv->'ratios'->>k)::numeric;
    t := case cv->>'round' when 'up' then ceil(x) when 'down' then floor(x) else round(x) end;
    if t <= 0 then continue; end if;
    if conv ? s then raise exception 'combat_v2_convert_expect: two v1 stats convert to %', s; end if;
    conv := conv || jsonb_build_object(s, t);
    why := why || jsonb_build_object(s, case when not v_support and cv->'dead_on_attacker' ? k then 'dead_points' else 'convert' end);
    stored := stored || jsonb_build_object(s, least(cap, t));
  end loop;
  if conv = '{}'::jsonb then return jsonb_build_object('row', false, 'level', lv, 'xp', card_level_xp_at(lv, b)); end if;
  -- rule 3: the top-up (the smallest count whose v2 value reaches the v1 value, never above the cap: above it a point adds nothing)
  v1 := card_combat(c.rarity, p_stars, c.cp_mod, p_pts);
  for k in select x2 from jsonb_object_keys(cv->'topup') x2 order by 1 loop
    s := cv->'to'->>k;
    if not stored ? s then continue; end if;
    t := (stored->>s)::int;
    loop
      select coalesce(sum(value::int), 0) into budget from jsonb_each_text(stored || jsonb_build_object(s, t));
      v2 := card_combat_v2(c.rarity, p_stars, c.cp_mod, lv, stored || jsonb_build_object(s, t), v_role, b, budget);
      exit when (v2->'stats'->>(cv->'topup'->k->>'v2'))::numeric >= (v1->>(cv->'topup'->k->>'v1'))::numeric or t >= cap;
      t := t + 1;
    end loop;
    if t > (stored->>s)::int then top := top || jsonb_build_object(s, t - (stored->>s)::int); stored := stored || jsonb_build_object(s, t); end if;
  end loop;
  -- rule 4: the cap (the part above v2_stats.max_per_stat -> bonus points, refund with the stat)
  for s in select x2 from jsonb_object_keys(conv) x2 order by 1 loop
    if (conv->>s)::int + coalesce((top->>s)::int, 0) > (stored->>s)::int then
      refund := refund || jsonb_build_object(s, (conv->>s)::int + coalesce((top->>s)::int, 0) - (stored->>s)::int);
    end if;
    spent := spent + (stored->>s)::int;
  end loop;
  -- rule 5: the points above the level budget -> bonus points (refund with no stat)
  over := greatest(0, spent - lv * ppl);
  select coalesce(sum(value::int), 0) + over into bonus from jsonb_each_text(refund);
  -- the ledger in the write order: the level, the bonus (so that the budget holds after each step), then the points
  if lv > 0 then led := led || jsonb_build_object('reason', 'grant_level', 'stat', '', 'd_level', lv, 'd_xp', card_level_xp_at(lv, b), 'd_points', 0, 'd_bonus', 0); end if;
  for s in select x2 from jsonb_object_keys(refund) x2 order by 1 loop
    led := led || jsonb_build_object('reason', 'refund', 'stat', s, 'd_level', 0, 'd_xp', 0, 'd_points', 0, 'd_bonus', (refund->>s)::int);
  end loop;
  if over > 0 then led := led || jsonb_build_object('reason', 'refund', 'stat', '', 'd_level', 0, 'd_xp', 0, 'd_points', 0, 'd_bonus', over); end if;
  for s in select x2 from jsonb_object_keys(conv) x2 order by 1 loop
    led := led || jsonb_build_object('reason', why->>s, 'stat', s, 'd_level', 0, 'd_xp', 0, 'd_points', least(cap, (conv->>s)::int), 'd_bonus', 0);
    if (stored->>s)::int > least(cap, (conv->>s)::int) then
      led := led || jsonb_build_object('reason', 'topup', 'stat', s, 'd_level', 0, 'd_xp', 0, 'd_points', (stored->>s)::int - least(cap, (conv->>s)::int), 'd_bonus', 0);
    end if;
  end loop;
  for s in select x2 from jsonb_object_keys(b->'v2_stats') x2 where x2 <> 'max_per_stat' loop
    pts := pts || jsonb_build_object(s, coalesce((stored->>s)::int, 0));
  end loop;
  v2 := card_combat_v2(c.rarity, p_stars, c.cp_mod, lv, pts, v_role, b, bonus);
  return jsonb_build_object('row', true, 'level', lv, 'xp', card_level_xp_at(lv, b), 'points', pts, 'bonus', bonus, 'ledger', led,
    'topup', top, 'refund', refund, 'over', over,
    'v1', jsonb_build_object('cp', v1->'cp', 'hp', v1->'hp'), 'v2', jsonb_build_object('atk', v2->'stats'->'atk', 'hp', v2->'stats'->'hp'));
end $fn$;

-- ============================================================ 4. one input row -> one progress row (the ledger row FIRST, rule 7)
create or replace function public.combat_v2_convert_write(p_input bigint) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  i public.combat_v2_convert_input%rowtype; e jsonb; pid bigint; l jsonb; lid bigint; n int := 0;
begin
  select * into strict i from public.combat_v2_convert_input where id = p_input;
  e := combat_v2_convert_expect(i.card_id, i.stars, i.stat_points);
  if not (e->>'row')::boolean then return jsonb_build_object('row', false); end if;
  -- rule 1: one progress row if none (an existing row is never added to: the fix path handles it)
  if exists (select 1 from public.card_progress_v2 where player_id = i.player_id and card_id = i.card_id) then
    return jsonb_build_object('row', false, 'skipped', true); end if;
  insert into public.card_progress_v2 (player_id, card_id) values (i.player_id, i.card_id) returning id into pid;
  for l in select x from jsonb_array_elements(e->'ledger') x loop
    lid := null;
    insert into public.card_progress_v2_log (progress_id, player_id, card_id, reason, stat, ref, d_level, d_xp, d_points, d_bonus, note)
      values (pid, i.player_id, i.card_id, l->>'reason', l->>'stat', i.ref, (l->>'d_level')::int, (l->>'d_xp')::int, (l->>'d_points')::int,
              (l->>'d_bonus')::int, 'combat_v2_convert input ' || i.id)
      on conflict (progress_id, reason, stat, ref) do nothing returning id into lid;
    if lid is null then continue; end if;
    n := n + 1;
    if l->>'stat' <> '' and (l->>'d_points')::int <> 0 then
      execute format('update public.card_progress_v2 set %I = %I + $1 where id = $2', (l->>'stat') || '_pts', (l->>'stat') || '_pts')
        using (l->>'d_points')::int, pid;
    else
      update public.card_progress_v2 set level = level + (l->>'d_level')::int, xp = xp + (l->>'d_xp')::int, bonus_points = bonus_points + (l->>'d_bonus')::int
       where id = pid;
    end if;
  end loop;
  return jsonb_build_object('row', true, 'progress_id', pid, 'ledger', n);
end $fn$;

-- ============================================================ 5. the conversion run (rule 0: the input, then rules 1 to 7)
create or replace function public.combat_v2_convert(p_ref text default 'm1') returns jsonb
language plpgsql set search_path = public as $fn$
declare
  t0 timestamptz := clock_timestamp(); i record; w jsonb; n_in int := 0; n_row int := 0; n_led int := 0; n_skip int := 0;
begin
  if p_ref is null or p_ref !~ '^[a-z0-9_]+$' then raise exception 'combat_v2_convert: the ref must be lower-case letters, digits or _'; end if;
  -- rule 0: only inside the switch (progress ON for everyone): a v1 spend after the input would not be in it
  if not combat_v2_on('progress') then raise exception 'combat_v2_convert: combat_v2.progress is off (the conversion runs in the switch file, after the flags)'; end if;
  perform pg_advisory_xact_lock(hashtext('combat_v2_convert'));
  -- the input: every player_cards row with v1 points whose card has NO input row of any ref (a second run, also after an undo, adds 0)
  for i in
    insert into public.combat_v2_convert_input (ref, player_id, card_id, stars, stat_points)
    select p_ref, pc.player_id, pc.card_id, coalesce(pc.ascension, 0), pc.stat_points
      from public.player_cards pc
     where pc.stat_points is not null and pc.stat_points <> '{}'::jsonb
       and not exists (select 1 from public.combat_v2_convert_input x where x.player_id = pc.player_id and x.card_id = pc.card_id)
     order by pc.player_id, pc.card_id
    returning id
  loop
    n_in := n_in + 1;
    w := combat_v2_convert_write(i.id);
    if (w->>'row')::boolean then n_row := n_row + 1; n_led := n_led + (w->>'ledger')::int; end if;
    if coalesce((w->>'skipped')::boolean, false) then n_skip := n_skip + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'ref', p_ref, 'input_rows', n_in, 'progress_rows', n_row, 'ledger_rows', n_led, 'skipped_existing', n_skip,
    'seconds', extract(epoch from clock_timestamp() - t0));
end $fn$;

-- ============================================================ 6. the undo (rule 8; not used by the rollback)
create or replace function public.combat_v2_convert_undo(p_ref text, p_cards bigint[] default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtext('combat_v2_convert'));
  -- the progress rows whose ledger rows ALL carry p_ref (a later spend, reset or XP row keeps the row); the ledger and input rows stay
  with d as (
    delete from public.card_progress_v2 p
     where (p_cards is null or p.card_id = any(p_cards))
       and exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref = p_ref)
       and not exists (select 1 from public.card_progress_v2_log l where l.progress_id = p.id and l.ref <> p_ref)
    returning 1)
  select count(*) into n from d;
  return jsonb_build_object('ok', true, 'ref', p_ref, 'deleted', n);
end $fn$;

-- ============================================================ 7. the live check (SPEC ON 6.7 rows 2a and 2b; reads only)
create or replace function public.combat_v2_convert_check(p_cards bigint[] default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  v_on timestamptz := (select max(at) from public.combat_v2_switch_log where action = 'on');
  r record; e jsonb; p public.card_progress_v2%rowtype; why text[]; items jsonb := '[]';
  n_miss int := 0; n_bad int := 0; n_live int := 0; n_log int := 0; n_checked int := 0; s text; led record;
begin
  for r in
    with k as (
      select player_id, card_id from public.combat_v2_convert_input
      union select player_id, card_id from public.card_progress_v2
      union select player_id, card_id from public.player_cards where stat_points is not null and stat_points <> '{}'::jsonb)
    select k.player_id, k.card_id, pc.stat_points as live,
           (select row_to_json(x)::jsonb from (select i.id, i.ref, i.stars, i.stat_points from public.combat_v2_convert_input i
             where i.player_id = k.player_id and i.card_id = k.card_id order by i.at desc, i.id desc limit 1) x) as cur
      from k join public.player_cards pc on pc.player_id = k.player_id and pc.card_id = k.card_id   -- only cards whose player_cards row exists (r3 L-4)
     where p_cards is null or k.card_id = any(p_cards)
     order by k.player_id, k.card_id
  loop
    n_checked := n_checked + 1; why := '{}';
    -- 2a: each card with v1 points has an input row
    if r.cur is null and coalesce(r.live, '{}'::jsonb) <> '{}'::jsonb then why := why || 'input_missing'::text; n_miss := n_miss + 1; end if;
    -- 2a: the progress row = combat_v2_convert_expect(the current input row), and its ledger rows sum to it (T6 of M1a). A card with no input
    -- row has no M1e row to check (a row that M1e did not make is never changed by the fix)
    select * into p from public.card_progress_v2 where player_id = r.player_id and card_id = r.card_id;
    e := case when r.cur is not null then combat_v2_convert_expect(r.card_id, (r.cur->>'stars')::int, r.cur->'stat_points') end;
    if r.cur is null then
      null;
    elsif (e->>'row')::boolean is distinct from (p.id is not null)
       or (p.id is not null and (p.level <> (e->>'level')::int or p.xp <> (e->>'xp')::int or p.bonus_points <> (e->>'bonus')::int
            or p.atk_pts <> (e->'points'->>'atk')::int or p.def_pts <> (e->'points'->>'def')::int or p.hp_pts <> (e->'points'->>'hp')::int
            or p.crd_pts <> (e->'points'->>'crd')::int or p.crt_pts <> (e->'points'->>'crt')::int or p.abl_pts <> (e->'points'->>'abl')::int
            or p.ddg_pts <> (e->'points'->>'ddg')::int or p.acc_pts <> (e->'points'->>'acc')::int or p.spd_pts <> (e->'points'->>'spd')::int)) then
      why := why || 'progress_mismatch'::text; n_bad := n_bad + 1;
    elsif p.id is not null then
      select coalesce(sum(d_level), 0) as lv, coalesce(sum(d_xp), 0) as xp, coalesce(sum(d_bonus), 0) as bo, coalesce(sum(d_points), 0) as pt into led
        from public.card_progress_v2_log where progress_id = p.id;
      if led.lv <> p.level or led.xp <> p.xp or led.bo <> p.bonus_points
         or led.pt <> p.atk_pts + p.def_pts + p.hp_pts + p.crd_pts + p.crt_pts + p.abl_pts + p.ddg_pts + p.acc_pts + p.spd_pts then
        why := why || 'progress_mismatch'::text; n_bad := n_bad + 1;
      end if;
    end if;
    -- 2b: the live v1 points = the current input row
    if r.cur is not null and coalesce(r.live, '{}'::jsonb) is distinct from r.cur->'stat_points' then why := why || 'live_differs'::text; n_live := n_live + 1; end if;
    -- 2b: no v1 spend or reset after the switch (a dust, sale or trade delete is not counted: only rows whose card still exists)
    if v_on is not null and exists (select 1 from public.stat_point_log l where l.player_id = r.player_id and l.card_id = r.card_id
                                      and l.reason in ('spend', 'reset') and l.changed_at > v_on) then
      why := why || 'log_after_switch'::text; n_log := n_log + 1;
    end if;
    if cardinality(why) > 0 then
      items := items || jsonb_build_object('player_id', r.player_id, 'card_id', r.card_id, 'why', to_jsonb(why));
    end if;
  end loop;
  return jsonb_build_object('ok', jsonb_array_length(items) = 0, 'switch_at', v_on, 'checked', n_checked, 'input_missing', n_miss,
    'progress_mismatch', n_bad, 'live_differs', n_live, 'log_after_switch', n_log, 'items', items);
end $fn$;

-- ============================================================ 8. the fix path (rule 8b): per card, undo + a new input row m1b + one clean conversion
create or replace function public.combat_v2_convert_fix(p_cards bigint[] default null) returns jsonb
language plpgsql set search_path = public as $fn$
declare
  it jsonb; pid bigint; inp bigint; w jsonb; n_fix int := 0; n_spent int := 0; n_second int := 0; n_log int := 0; n_led int := 0;
  v_p text; v_c bigint;
begin
  perform pg_advisory_xact_lock(hashtext('combat_v2_convert'));
  for it in select x from jsonb_array_elements(combat_v2_convert_check(p_cards)->'items') x loop
    v_p := it->>'player_id'; v_c := (it->>'card_id')::bigint;
    -- a card that only has a v1 log row (no difference): reported, no change
    if not (it->'why' ?| array['input_missing', 'progress_mismatch', 'live_differs']) then n_log := n_log + 1; continue; end if;
    select id into pid from public.card_progress_v2 where player_id = v_p and card_id = v_c;
    -- (1) a row with a v2 spend, reset or XP row: reported, no change
    if pid is not null and exists (select 1 from public.card_progress_v2_log where progress_id = pid and reason in ('spend', 'reset', 'xp')) then
      n_spent := n_spent + 1; continue; end if;
    -- at most ONE m1b input row per card (r4 L-2): a card that needs a second one is reported
    if exists (select 1 from public.combat_v2_convert_input where ref = 'm1b' and player_id = v_p and card_id = v_c) then
      n_second := n_second + 1; continue; end if;
    -- (2) the undo of this card (its old ledger rows stay: the history of a dead progress_id)
    if pid is not null then delete from public.card_progress_v2 where id = pid; end if;
    -- (3) the new input row = the live values; (4) one clean conversion into a NEW progress row
    insert into public.combat_v2_convert_input (ref, player_id, card_id, stars, stat_points)
      select 'm1b', pc.player_id, pc.card_id, coalesce(pc.ascension, 0), coalesce(pc.stat_points, '{}'::jsonb)
        from public.player_cards pc where pc.player_id = v_p and pc.card_id = v_c
      returning id into inp;
    w := combat_v2_convert_write(inp);
    n_fix := n_fix + 1;
    if (w->>'row')::boolean then n_led := n_led + (w->>'ledger')::int; end if;
  end loop;
  return jsonb_build_object('ok', true, 'fixed', n_fix, 'ledger_rows', n_led, 'reported_spent', n_spent, 'reported_second_fix', n_second,
    'reported_log_only', n_log);
end $fn$;

-- ============================================================ 9. the level and the points of a card in a v2 fight (rule 5b, N-7b; read by dungeon_v2_unit, R2-ON)
create or replace function public.card_progress_v2_fight(p_player text, p_card bigint, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, '{}'::jsonb); v_stars int; r public.card_progress_v2%rowtype; lv int;
begin
  if not combat_v2_on('progress') then return jsonb_build_object('level', 0, 'points', '{}'::jsonb, 'bonus', 0); end if;
  if not (b ? 'v2_level' and b ? 'v2_convert') then b := b || combat_v2_numbers(array['v2_level', 'v2_convert']); end if;
  select coalesce(ascension, 0) into v_stars from public.player_cards where player_id = p_player and card_id = p_card;
  -- N-7b: the level = v2_convert.level_per_star x the CURRENT stars (capped at v2_level.max_level), for every card, with or without a row
  lv := least((b->'v2_level'->>'max_level')::int, (b->'v2_convert'->>'level_per_star')::int * coalesce(v_stars, 0));
  select * into r from public.card_progress_v2 where player_id = p_player and card_id = p_card;
  if not found then return jsonb_build_object('level', lv, 'points', '{}'::jsonb, 'bonus', 0); end if;
  -- a stored level above the star level (a row that M1e did not make) is kept, so its spent points stay inside the budget
  return jsonb_build_object('level', greatest(lv, r.level), 'bonus', r.bonus_points,
    'points', jsonb_build_object('atk', r.atk_pts, 'def', r.def_pts, 'hp', r.hp_pts, 'crd', r.crd_pts, 'crt', r.crt_pts, 'abl', r.abl_pts,
                                 'ddg', r.ddg_pts, 'acc', r.acc_pts, 'spd', r.spd_pts));
end $fn$;

-- ============================================================ 10. the Shop: the stat reset is paused (N-10; the live text + the M1e lines)
CREATE OR REPLACE FUNCTION public.buy_shop_item(p_player text, p_kind text, p_slot integer DEFAULT NULL::integer, p_card bigint DEFAULT NULL::bigint, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day(); v_bal int; v_price int; s shop_stock;
  v_pts jsonb; v_asc int; v_rar text; v_mod numeric; v_new int; v_used text; v_purchase bigint;
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  v_v2 jsonb;   -- M1d: the answer of the v2 reset (card_progress_v2_reset)
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  -- M1e (SPEC ON 3.7 rule 5b, r3 M-1, N-10): with v2 progress ON for this player the Shop stat reset is paused until the v2 stats screen
  -- M1e: (no v2 spend route exists). The refusal is BEFORE the player lock, any write and any Shard charge; the free week and the gifts stay.
  if p_kind = 'stat_reset' and combat_v2_on('progress', p_player) then   -- M1e
    return jsonb_build_object('ok', false, 'error', 'stat_reset_paused', 'message', 'Stat reset returns with the v2 stats screen.');   -- M1e
  end if;   -- M1e
  select shard_balance, stat_reset_week into v_bal, v_used from players where id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_player'); end if;

  if p_kind = 'pack' then
    if p_qty is null or p_qty < 1 or p_qty > coalesce((cfg->>'max_packs_per_buy')::int, 10) then
      return jsonb_build_object('ok', false, 'error', 'bad_qty'); end if;
    v_price := game_shop_price((cfg->>'pack_price')::int) * p_qty;
    if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    insert into shop_purchases (player_id, day, kind, qty, price) values (p_player, v_day, 'pack', p_qty, v_price) returning id into v_purchase;
    v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text);
    perform grant_packs(p_player, p_qty, 'shop', null, 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'pack', 'qty', p_qty, 'balance', v_new,
      'packs', (select pack_balance from players where id = p_player));

  elsif p_kind = 'card' then
    perform shop_pick_stock(v_day);
    select * into s from shop_stock where day = v_day and slot = p_slot;
    if not found then return jsonb_build_object('ok', false, 'error', 'no_slot'); end if;
    s.price := game_shop_price(s.price);   -- the stock price x the live shop_price_mult (game_vars_all.sql)
    if exists (select 1 from shop_purchases where player_id = p_player and day = v_day and kind = 'card' and slot = p_slot) then
      return jsonb_build_object('ok', false, 'error', 'bought'); end if;
    if v_bal < s.price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', s.price); end if;
    -- The card first (add_card_to_player finds the slot that is not bought yet), then the purchase row, then its Shards.
    perform add_card_to_player(p_player, s.card_id, 'shop');
    insert into shop_purchases (player_id, day, kind, slot, card_id, price) values (p_player, v_day, 'card', p_slot, s.card_id, s.price) returning id into v_purchase;
    v_new := grant_shards(p_player, -s.price, 'shop', 'shop_purchase', v_purchase::text);
    return jsonb_build_object('ok', true, 'kind', 'card', 'card_id', s.card_id, 'balance', v_new,
      'quantity', (select quantity from player_cards where player_id = p_player and card_id = s.card_id));

  elsif p_kind = 'stat_reset' then
    -- M1d (plan 20.11 trap a, 20.17; Nathan 2026-10-23 "Yes A"): v2 progress ON for this player (everyone or a tester) = the Shop
    -- M1d: reset is the v2 reset (card_progress_v2_reset, one function for the Shop and the v2 reset): the free Mountain week first, then one
    -- M1d: open v2_ gift, else this price (not_enough before any write). Then the purchase row, then the Shards only when the price > 0.
    -- M1d: The v1 points (player_cards.stat_points) do not change. Before the stat_points flag: the v2 reset does not read that v1 flag.
    if combat_v2_on('progress', p_player) then   -- M1d
      v_price := game_shop_price((cfg->>'stat_reset_price')::int);   -- M1d
      v_v2 := card_progress_v2_reset(p_player, p_card, v_price);   -- M1d
      if not (v_v2->>'ok')::boolean then return v_v2; end if;   -- M1d
      if v_v2->>'used' <> 'paid' then v_price := 0; end if;   -- M1d
      insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;   -- M1d
      v_new := v_bal;   -- M1d
      if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;   -- M1d
      return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', v_price = 0, 'price', v_price, 'balance', v_new) || (v_v2 - 'ok');   -- M1d
    end if;   -- M1d
    if not coalesce((stat_cfg()->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'stats_disabled'); end if;
    select pc.stat_points, pc.ascension, c.rarity::text, s2.cp_mod into v_pts, v_asc, v_rar, v_mod
      from player_cards pc join cards c on c.id = pc.card_id left join subjects s2 on s2.id = c.subject_id
     where pc.player_id = p_player and pc.card_id = p_card and pc.quantity > 0 for update of pc;
    if not found then return jsonb_build_object('ok', false, 'error', 'not_owned'); end if;
    if coalesce(v_pts, '{}'::jsonb) = '{}'::jsonb then return jsonb_build_object('ok', false, 'error', 'nothing_spent'); end if;
    if v_used is distinct from v_week then
      -- The free weekly reset: no Shards, the week is marked used (the same rule as reset_stat_points).
      update players set stat_reset_week = v_week where id = p_player;
      v_price := 0; v_new := v_bal;
    elsif stat_reset_gift_use(p_player, p_card) then
      -- The weekly one is used: the one-time gift reset (stat_reset_gifts, stat_reset_gift.sql) is the next free one.
      v_price := 0; v_new := v_bal;
    else
      v_price := game_shop_price((cfg->>'stat_reset_price')::int);
      if v_bal < v_price then return jsonb_build_object('ok', false, 'error', 'not_enough', 'balance', v_bal, 'price', v_price); end if;
    end if;
    update player_cards set stat_points = '{}'::jsonb where player_id = p_player and card_id = p_card;
    insert into shop_purchases (player_id, day, kind, card_id, price) values (p_player, v_day, 'stat_reset', p_card, v_price) returning id into v_purchase;
    if v_price > 0 then v_new := grant_shards(p_player, -v_price, 'shop', 'shop_purchase', v_purchase::text); end if;
    return jsonb_build_object('ok', true, 'kind', 'stat_reset', 'free', v_price = 0, 'price', v_price, 'balance', v_new, 'points', '{}'::jsonb,
      'stats', card_combat(v_rar, v_asc, v_mod, '{}'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $function$;

CREATE OR REPLACE FUNCTION public.shop_today(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg jsonb := shard_cfg(); v_day date := shop_day();
  v_week text := to_char(now() at time zone 'America/Denver', 'IYYY-IW');
  v_v2 boolean := combat_v2_on('progress', p_player);   -- M1d: the Shop reset of this player is the v2 reset (buy_shop_item)
begin
  if not coalesce((cfg->>'enabled')::boolean, false) then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  perform shop_pick_stock(v_day);
  return jsonb_build_object('ok', true,
    'day', v_day,
    'next_at', ((v_day + 1)::timestamp at time zone 'America/Denver'),
    'balance', coalesce((select shard_balance from players where id = p_player), 0),
    'pack_price', game_shop_price((cfg->>'pack_price')::int),
    'stat_reset_price', game_shop_price((cfg->>'stat_reset_price')::int),
    -- The free weekly reset (stat_points.sql): a Shop reset uses it first, at 0 Shards.
    -- A free reset is the weekly one OR a gift that is not used and not expired (stat_reset_gifts). gift_reset says that a gift is
    -- left, gift_reset_until is its deadline.
    'free_reset', (select stat_reset_week from players where id = p_player) is distinct from v_week
      or exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    'gift_reset', exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    'gift_reset_until', (select min(g.expires_at) from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now()),
    -- M1d (plan 20.17, REVIEW-r1 F1): the free reset that this answer shows is the one that buy_shop_item(stat_reset) then takes. v2 progress
    -- M1d: ON = the v2 reset takes only a v2_ gift; OFF = the v1 gift use skips every v2_ gift. The 3 keys below come again after the 3 keys
    -- M1d: above: in jsonb the LAST value of a key is kept, so these 3 values are the answer (and the lines above stay the live text).
    'free_reset', (select stat_reset_week from players where id = p_player) is distinct from v_week   -- M1d
      or exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'gift_reset', exists (select 1 from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'gift_reset_until', (select min(g.expires_at) from stat_reset_gifts g where g.player_id = p_player and g.used_at is null and g.expires_at > now() and starts_with(g.gift, 'v2_') = v_v2),   -- M1d
    'stat_reset_paused', v_v2,   -- M1e: the Shop stat reset refuses stat_reset_paused (buy_shop_item) while v2 progress is ON for this player
    'free_reset_next', ((date_trunc('week', now() at time zone 'America/Denver') + interval '7 days') at time zone 'America/Denver'),
    'max_packs_per_buy', coalesce((cfg->>'max_packs_per_buy')::int, 10),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('slot', s.slot, 'card_id', s.card_id, 'rarity', s.rarity, 'price', game_shop_price(s.price),
                 'bought', exists (select 1 from shop_purchases p where p.player_id = p_player and p.day = v_day and p.kind = 'card' and p.slot = s.slot))
                 order by s.slot) from shop_stock s where s.day = v_day), '[]'::jsonb));
end $function$;

-- ============================================================ 11. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['combat_v2_convert_expect(bigint, integer, jsonb)', 'combat_v2_convert_write(bigint)', 'combat_v2_convert(text)',
                           'combat_v2_convert_undo(text, bigint[])', 'combat_v2_convert_check(bigint[])', 'combat_v2_convert_fix(bigint[])',
                           'card_progress_v2_fight(text, bigint, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on table public.combat_v2_switch_log is $cm$Combat v2 switch (SPEC ON 3.6, combat_v2_convert.sql, step M1e): one row for each run of combat_v2_switch_on.sql (action on) and combat_v2_switch_off.sql (action off), written as the LAST statement of the file with clock_timestamp(). The "at" of the newest on row is the switch time of the live checks. Service role only.$cm$;
comment on column public.combat_v2_switch_log.id is $cm$The row id.$cm$;
comment on column public.combat_v2_switch_log.action is $cm$on (the 4 flags true and the M1e conversion) or off (the 3 mode flags false, progress stays true).$cm$;
comment on column public.combat_v2_switch_log.at is $cm$clock_timestamp() of the last statement of the switch file (about the commit time; balance_log.changed_at is the transaction start).$cm$;
comment on column public.combat_v2_switch_log.by is $cm$Who ran it: balance_who().$cm$;
comment on table public.combat_v2_convert_input is $cm$Combat v2 M1e (SPEC ON 3.7 rule 0, combat_v2_convert.sql): the input of the stat conversion: one row for each player_cards row with v1 points at the switch (ref m1), and one row for each card that combat_v2_convert_fix converted again (ref m1b, at most one for a card). The CURRENT input of a card is its newest row by (at, id). The audit record and the expected value of the live checks (combat_v2_convert_check). Rows are never changed or deleted. Service role only.$cm$;
comment on column public.combat_v2_convert_input.id is $cm$The row id (with at: the order of the rows of one card).$cm$;
comment on column public.combat_v2_convert_input.ref is $cm$The run: m1 (the switch) or m1b (the fix path). Also the ref of the ledger rows of the conversion.$cm$;
comment on column public.combat_v2_convert_input.player_id is $cm$The owner (players.id).$cm$;
comment on column public.combat_v2_convert_input.card_id is $cm$The card (cards.id).$cm$;
comment on column public.combat_v2_convert_input.stars is $cm$player_cards.ascension at the time of the row (the stored level = v2_convert.level_per_star x this).$cm$;
comment on column public.combat_v2_convert_input.stat_points is $cm$player_cards.stat_points (the v1 points) at the time of the row.$cm$;
comment on column public.combat_v2_convert_input.at is $cm$clock_timestamp() of the insert.$cm$;

comment on function public.combat_v2_convert_expect(bigint, integer, jsonb) is $cm$[combat] Combat v2 M1e (SPEC ON 3.7 rules 2 to 6, N-7 option B): the v2 progress row and its ledger rows for one card with these stars and v1 points. Level = v2_convert.level_per_star x stars (at most v2_level.max_level), XP = card_level_xp_at(level); each v1 stat x v2_convert.ratios, rounded by v2_convert.round, to the stat of v2_convert.to; the top-up of the stats of v2_convert.topup (the smallest count whose card_combat_v2 value at the level reaches the card_combat value, at most the cap); the part above v2_stats.max_per_stat and the points above the level budget become bonus points (refund); a stat of v2_convert.dead_on_attacker on a card whose v1 ability is not support is logged dead_points. Answer {row, level, xp, points, bonus, ledger, topup, refund, over, v1, v2}; row false = no v1 point, no row. Reads only. combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert_write(bigint) is $cm$[combat] Combat v2 M1e (SPEC ON 3.7 rules 1 and 7): writes one NEW card_progress_v2 row from one combat_v2_convert_input row: the row at level 0, then each ledger row of combat_v2_convert_expect FIRST (ref = the input ref) and the row change only when the insert added a row. A card that already has a progress row is skipped. Called by combat_v2_convert and combat_v2_convert_fix. combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert(text) is $cm$[combat] Combat v2 M1e (SPEC ON 3.7 rule 0): the stat conversion of the switch (combat_v2_switch_on.sql). Refuses unless combat_v2_on('progress'). Copies every player_cards row with v1 points whose card has no input row of any ref into combat_v2_convert_input, then converts each (combat_v2_convert_write). A second run, also after an undo, adds 0 rows. The v1 points do not change. Answer: counts and seconds only. combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert_undo(text, bigint[]) is $cm$[combat] Combat v2 M1e (SPEC ON 3.7 rule 8): deletes the card_progress_v2 rows (all, or of the named cards) whose ledger rows all carry the ref; a row with a later spend, reset or XP row stays; the ledger and input rows stay as history. For a full undo before members play; not used by the rollback. combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert_check(bigint[]) is $cm$[combat] Combat v2 M1e live check (SPEC ON 6.7 rows 2a and 2b). Reads only. For each card whose player_cards row exists: input_missing (v1 points and no input row), progress_mismatch (the progress row is not combat_v2_convert_expect of the current input row, or its ledger rows do not sum to it), live_differs (the live v1 points are not the current input), log_after_switch (a stat_point_log spend or reset after the newest combat_v2_switch_log on row). Answer: the counts and the items (ok = no item). combat_v2_convert.sql.$cm$;
comment on function public.combat_v2_convert_fix(bigint[]) is $cm$[combat] Combat v2 M1e fix path (SPEC ON 3.7 rule 8b): for each card that combat_v2_convert_check finds with a difference: a progress row with a spend, reset or xp ledger row is reported; a card with an m1b input row is reported; else its progress row is deleted, a new input row m1b with the live values is written and converted into a NEW progress row. A card with only a log row is reported. A second call adds 0 rows. combat_v2_convert.sql.$cm$;
comment on function public.card_progress_v2_fight(text, bigint, jsonb) is $cm$[combat] Combat v2 (SPEC ON 3.7 rule 5b, N-7b): the level, points and bonus of a card in a v2 fight. combat_v2_on('progress') off: level 0, no points, bonus 0. On: level = v2_convert.level_per_star x the CURRENT player_cards.ascension, at most v2_level.max_level (a stored level above it is kept), and the points and bonus_points of the card_progress_v2 row (no row: no points). The numbers come from p_b when it has v2_level and v2_convert. Reads only. combat_v2_convert.sql.$cm$;

notify pgrst, 'reload schema';
