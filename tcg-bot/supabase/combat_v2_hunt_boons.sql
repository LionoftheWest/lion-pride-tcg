-- combat_v2_hunt_boons.sql (2026-11-05): item HBP, the Combat v2 Hunt reads the Hunt boons and pranks (Nathan 2026-11-05: "boons and pranks
-- effects should affect combat v2"; pipeline item HBP SPEC v2).
-- Needs R3-ON (combat_v2_on_hunt.sql). Chain order on Thursday 2026-11-05: ... R3-ON -> C -> C-low -> this file.
-- Before: only hunt_attack (v1) reads player_effects. A waiting rally, butterfingers, launch_party, raid_crasher or mend does nothing in a v2
--   Hunt day and is not consumed.
-- After this file, on a LIVE v2 day (hunt_v2_days.live, the mark; the flag is not read):
--   One Hunt hit (rule R-HIT) = one 'act' entry of the call log whose actor is a card and whose enemy-0 HP entries decrease the private boss HP.
--   One use of a boon or prank = one such hit. In the v1 order: rally x (1 + a/100), butterfingers x (1 - a/100), launch_party x (1 + a/100),
--   then the raid_crasher extra = greatest(1, round(final x a/100)) to options.credit_to (else sender_id) on options.card_id (the v1 rule; no
--   owner, an owner with no players row, no card or a card with no cards row: the member and the attacking card, fallback true). a is capped
--   by balance combat.effect_cap_pct. The own credit keeps the R3-ON largest remainder rule. The boss loses the own total + every extra.
--   The effect rows are read with FOR UPDATE SKIP LOCKED before the boss lock, and a use is written only when hunt_v2_shared answers written.
--   Mend (rule R-MEND): at the start of an act/auto call, the card that has the turn, up and hurt, heals max x a/100 (capped at max) in the
--   fight that is played; the mend row is locked first and consumed only when the play answers ok and the credit is not over.
-- The practice day (live false), v1 (hunt_attack, hunt_support) and the private fight engine do not change. hunt_v2_days.credited = the own
--   credit (no extra). Exception: a raid_crasher FALLBACK extra goes to the member's own hunt_hits (its combat_actions row says fallback).
-- Idempotent. Server only. GUARD: each replaced function must be its R3-ON text or the text that this file made.
-- Undo: combat_v2_hunt_boons_undo.sql. Test: card-studio/scripts/test-combat-v2-hunt-boons.mjs (rolled back; MUTATE=all must catch every mutation).

do $g$
declare m text; f record;
begin
  if to_regprocedure('public.hunt_v2_shared(bigint, text, date, jsonb)') is null then
    raise exception 'combat_v2_hunt_boons.sql: R3-ON (combat_v2_on_hunt.sql) is not applied.';
  end if;
  for f in select * from (values
    ('public.hunt_v2_turns(text, jsonb, boolean, integer)', '32480034440a93d10fc5b671aba81d65', '4af9093c5b3f8f5c397d5d3b0a737114'),
    ('public.hunt_v2_shared(bigint, text, date, jsonb)', '7633f3120651daf0a9094e43d08df801', '102e1a816c159beae7d13525935c4507'),
    ('public.hunt_v2_live_credit(bigint, text, date, jsonb)', '187f166bf4d3e559924ca105dbaf62b1', '2e2f2b28bf7309ed1053610593128c40')
  ) x(fn, old_md5, new_md5) loop
    select md5(replace(pg_get_functiondef(f.fn::regprocedure), chr(13), '')) into strict m;
    if m not in (f.old_md5, f.new_md5) then
      raise exception 'combat_v2_hunt_boons.sql: the live % changed since this file was built. Rebuild it from the live text.', f.fn;
    end if;
  end loop;
end $g$;
-- GUARD-END

-- ============================================================ 1. the plan of one call (pure)
create or replace function public.hunt_v2_boon_plan(p_log jsonb, p_squad jsonb, p_scale numeric, p_fx jsonb, p_cap numeric) returns jsonb
language plpgsql immutable set search_path = public as $fn$
#variable_conflict use_column
declare
  fx jsonb; lft jsonb := '{}'::jsonb; per jsonb := '{}'::jsonb; ex jsonb := '[]'::jsonb; e jsonb; r jsonb; pr text;
  dec numeric; own numeric; m numeric; a numeric; card text; hit boolean; k int; j int; xp text; xc text; fb boolean;
  cap numeric := coalesce(p_cap, 100); n_rally int := 0; n_bf int := 0; n_party int := 0; n_crash int := 0;
  v_total bigint; v_cards jsonb; v_uses jsonb; v_extras jsonb;
begin
  -- the waiting rows, oldest first (created_at, id); the charges of a row: rally and butterfingers 1 (its first hit uses it),
  -- launch_party and raid_crasher options.uses (at least 1, as use_effect_charge)
  fx := coalesce((select jsonb_agg(z order by (z->>'created_at')::timestamptz, (z->>'id')::bigint) from jsonb_array_elements(coalesce(p_fx, '[]'::jsonb)) z), '[]'::jsonb);
  for k in 0 .. jsonb_array_length(fx) - 1 loop
    r := fx->k;
    lft := lft || jsonb_build_object(r->>'id', case when r->>'primitive' in ('launch_party', 'raid_crasher') then greatest(1, coalesce((r->'options'->>'uses')::int, 1)) else 1 end);
  end loop;
  for e in select z from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) z loop
    -- the decrease of the private boss HP in this entry x the scale (the R3-ON rule: a heal is not credited)
    dec := coalesce((select sum((h->>'before')::numeric - (h->>'after')::numeric) from jsonb_array_elements(coalesce(e->'hp', '[]'::jsonb)) h
                      where h->>'side' = 'enemy' and (h->>'id')::int = 0 and (h->>'after')::numeric < (h->>'before')::numeric), 0) * p_scale;
    card := case when e->>'k' = 'act' and e->'actor'->>'side' = 'card' then e->'actor'->>'id' else p_squad->>0 end;
    own := dec;
    -- one Hunt hit (INV-1): a card act that decreases the boss HP
    hit := e->>'k' = 'act' and e->'actor'->>'side' = 'card' and dec > 0;
    if hit then
      m := 1;
      foreach pr in array array['rally', 'butterfingers', 'launch_party', 'raid_crasher'] loop
        -- the oldest row of the primitive with a charge left
        j := null;
        for k in 0 .. jsonb_array_length(fx) - 1 loop
          if fx->k->>'primitive' = pr and (lft->>(fx->k->>'id'))::int > 0 then j := k; exit; end if;
        end loop;
        continue when j is null;
        r := fx->j;
        a := least(coalesce((r->>'amount')::numeric, 0), cap);
        lft := lft || jsonb_build_object(r->>'id', (lft->>(r->>'id'))::int - 1);
        if pr = 'rally' then m := m * (1 + a / 100); n_rally := n_rally + 1;
        elsif pr = 'butterfingers' then m := m * (1 - a / 100); n_bf := n_bf + 1;
        elsif pr = 'launch_party' then m := m * (1 + a / 100); n_party := n_party + 1;
        else
          -- raid_crasher: the extra from the FINAL own value of the hit (v1 hunt_attack), to the prankster's card
          own := dec * m;
          xp := coalesce(r->'options'->>'credit_to', r->'options'->>'sender_id'); xc := r->'options'->>'card_id'; fb := false;
          if xp is null or xc is null then xp := null; xc := card; fb := true; end if;
          ex := ex || jsonb_build_array(jsonb_build_object('player', xp, 'card', xc::bigint, 'value', greatest(1, round(own * a / 100))::bigint,
                  'fallback', fb, 'amount', coalesce((r->>'amount')::numeric, 0), 'attack_card', card::bigint));
          n_crash := n_crash + 1;
        end if;
      end loop;
      own := dec * m;
    end if;
    if dec > 0 then per := per || jsonb_build_object(card, coalesce((per->>card)::numeric, 0) + own); end if;
  end loop;
  -- the own credit: the R3-ON largest remainder rule (the card credits add up to the rounded total)
  with p as (select key as card, value::numeric as a from jsonb_each_text(per)),
  t as (select coalesce(round(sum(a)), 0)::bigint as total from p),
  fl as (select card, floor(a)::bigint as f, a - floor(a) as r from p),
  rk as (select card, f, row_number() over (order by r desc, card) as n from fl)
  select (select total from t),
         coalesce((select jsonb_object_agg(card, f + case when n <= (select total from t) - (select coalesce(sum(f), 0) from fl) then 1 else 0 end) from rk), '{}'::jsonb)
    into v_total, v_cards;
  -- the extras per (prankster, card, fallback): the sum, the hits
  select coalesce(jsonb_agg(jsonb_build_object('player', g.player, 'card', g.card, 'value', g.value, 'hits', g.hits, 'fallback', g.fallback,
           'amount', g.amount, 'attack_card', g.attack_card) order by g.first), '[]'::jsonb) into v_extras
    from (select z->>'player' as player, (z->>'card')::bigint as card, (z->>'fallback')::boolean as fallback, sum((z->>'value')::bigint) as value,
                 count(*)::int as hits, (array_agg((z->>'amount')::numeric order by o))[1] as amount, (array_agg((z->>'attack_card')::bigint order by o))[1] as attack_card, min(o) as first
            from jsonb_array_elements(ex) with ordinality q(z, o) group by 1, 2, 3) g;
  -- the uses: each row with at least one charge used, and the charges left
  select coalesce(jsonb_agg(jsonb_build_object('id', (z->>'id')::bigint, 'primitive', z->>'primitive',
           'used', (case when z->>'primitive' in ('launch_party', 'raid_crasher') then greatest(1, coalesce((z->'options'->>'uses')::int, 1)) else 1 end) - (lft->>(z->>'id'))::int,
           'left', (lft->>(z->>'id'))::int) order by o), '[]'::jsonb) into v_uses
    from jsonb_array_elements(fx) with ordinality q(z, o)
   where (lft->>(z->>'id'))::int < case when z->>'primitive' in ('launch_party', 'raid_crasher') then greatest(1, coalesce((z->'options'->>'uses')::int, 1)) else 1 end;
  return jsonb_build_object('total', v_total, 'cards', v_cards, 'extras', v_extras, 'uses', v_uses,
    'boons', jsonb_build_object('rally', n_rally, 'butterfingers', n_bf, 'party_hits', n_party, 'crash_hits', n_crash));
end $fn$;

-- ============================================================ 2. the shared write of a live call (R3-ON + the raid_crasher extras)
create or replace function public.hunt_v2_shared(p_hunt bigint, p_player text, p_day date, p_credit jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare v_status text; v_closes timestamptz; v_tier text; v_hp bigint; v_total bigint := coalesce((p_credit->>'total')::bigint, 0); c record; v_settle jsonb;
  v_extra bigint := coalesce((select sum((z->>'value')::bigint) from jsonb_array_elements(coalesce(p_credit->'extras', '[]'::jsonb)) z where (z->>'value')::bigint > 0), 0);
  v_dec bigint;
begin
  if v_total + v_extra <= 0 then return jsonb_build_object('written', false, 'total', 0); end if;
  -- (1) the boss row FOR NO KEY UPDATE: it serializes with a v1 FOR UPDATE and with other shared writes; it does not block a bridge-row
  -- FK check (FOR KEY SHARE)
  select status, closes_at, tier into v_status, v_closes, v_tier from public.hunts where id = p_hunt for no key update;
  -- (2) a closed or defeated Hunt: no shared write; the caller ends the day as hunt_over
  if not found or v_status <> 'active' or now() >= v_closes then return jsonb_build_object('written', false, 'over', true, 'total', 0); end if;
  -- (3) the v1 hit rule per credited card, the boss HP (it stops at 0; hunt_hits gets the full credit: the v1 clamp), the log rows
  for c in select key::bigint as card, value::bigint as dmg from jsonb_each_text(p_credit->'cards') where value::bigint > 0 loop
    insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, p_player, c.card, p_day, c.dmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
  end loop;
  -- (3b) HBP: the raid_crasher extras (v1 hunt_attack): the prankster's own hunt_hits row on the prankster's card
  for c in select z->>'player' as player, (z->>'card')::bigint as card, (z->>'value')::bigint as dmg
             from jsonb_array_elements(coalesce(p_credit->'extras', '[]'::jsonb)) z where (z->>'value')::bigint > 0 loop
    insert into public.hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (p_hunt, c.player, c.card, p_day, c.dmg)
      on conflict (hunt_id, player_id, card_id, hit_date) do update set damage = hunt_hits.damage + excluded.damage;
  end loop;
  -- the boss loses the own total and every extra
  v_dec := v_total + v_extra;
  update public.hunts set hp_remaining = greatest(0, hp_remaining - v_dec),
      status = case when hp_remaining - v_dec <= 0 then 'defeated' else status end,
      defeated_at = case when hp_remaining - v_dec <= 0 then now() else defeated_at end
    where id = p_hunt returning hp_remaining, status into v_hp, v_status;
  for c in select key::bigint as card, value::bigint as dmg from jsonb_each_text(p_credit->'cards') where value::bigint > 0 loop
    insert into public.hunt_combat_log (hunt_id, player_id, card_id, outcome, damage, boss_hp_after) values (p_hunt, p_player, c.card, 'hit', c.dmg, v_hp);
  end loop;
  -- (3c) HBP: one Hunt Crasher log row per (prankster, card) of the call (hunt_damage_reconcile reads result.value)
  for c in select z->>'player' as player, (z->>'card')::bigint as card, (z->>'value')::bigint as dmg, z from jsonb_array_elements(coalesce(p_credit->'extras', '[]'::jsonb)) z where (z->>'value')::bigint > 0 loop
    insert into public.combat_actions (mode, ref_id, player_id, card_id, kind, game_day, round, effect, amount, result)
    values ('hunt', p_hunt, c.player, c.card, 'effect', p_day, null, 'raid_crasher', (c.z->>'amount')::numeric,
      jsonb_build_object('value', c.dmg, 'attacker', p_player, 'attack_card', (c.z->>'attack_card')::bigint, 'hits', (c.z->>'hits')::int,
        'fallback', coalesce((c.z->>'fallback')::boolean, false), 'v2', true));
  end loop;
  update public.hunt_v2_days set credited = credited + v_total where hunt_id = p_hunt and player_id = p_player and day = p_day;
  -- (4) only the call that moved the boss active -> defeated settles it once and writes the defeat event (the v1 text)
  if v_status = 'defeated' then
    v_settle := settle_hunt(p_hunt);
    insert into public.hunt_events (hunt_id, kind, payload)
      values (p_hunt, 'defeat', jsonb_build_object(
        'name', (select name from public.hunts where id = p_hunt), 'tier', v_tier, 'settle', v_settle,
        'top', (select jsonb_agg(jsonb_build_object('player_id', player_id, 'damage', damage))
                from (select player_id, sum(damage) as damage from public.hunt_hits where hunt_id = p_hunt
                      group by player_id order by sum(damage) desc limit 3) t)));
  end if;
  return jsonb_build_object('written', true, 'total', v_total, 'extra', v_extra, 'hp_after', v_hp, 'defeated', v_status = 'defeated');
end $fn$;

-- ============================================================ 3. the credit, the boons and the shared write of one live call
create or replace function public.hunt_v2_live_credit(p_hunt bigint, p_player text, p_day date, p_log jsonb) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; c jsonb; s jsonb; v_max numeric; v_hpmax numeric; fx jsonb; u jsonb;
begin
  select * into r from public.hunt_v2_days where hunt_id = p_hunt and player_id = p_player and day = p_day;
  if not found or not r.live then return jsonb_build_object('total', 0, 'written', false); end if;
  v_max := (r.state->'fight'->'enemies'->0->>'max')::numeric;
  v_hpmax := (select hp_max from public.hunts where id = p_hunt);
  -- HBP: the waiting Hunt boons and pranks of the member, oldest first, locked BEFORE the boss lock with SKIP LOCKED (a call never waits on an
  -- effect row). A prankster with no players row or a card with no cards row is passed as missing, so the plan uses the fallback (review F-6).
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'primitive', e.primitive, 'amount', coalesce(e.amount, 0), 'created_at', e.created_at,
           'options', e.options
             - case when exists (select 1 from public.players p where p.id = coalesce(e.options->>'credit_to', e.options->>'sender_id')) then '{}'::text[] else array['credit_to', 'sender_id'] end
             - case when coalesce(e.options->>'card_id', '') ~ '^[0-9]{1,18}$' and exists (select 1 from public.cards k where k.id = (e.options->>'card_id')::bigint) then '{}'::text[] else array['card_id'] end)
           order by e.created_at, e.id), '[]'::jsonb) into fx
    from (select pe.* from public.player_effects pe
           where pe.player_id = p_player and pe.primitive in ('rally', 'butterfingers', 'launch_party', 'raid_crasher') and pe.consumed_at is null
             and (pe.starts_at is null or pe.starts_at <= now()) and (pe.expires_at is null or pe.expires_at > now())
           order by pe.created_at, pe.id for update skip locked) e;
  c := hunt_v2_boon_plan(p_log, to_jsonb(r.squad), v_hpmax / v_max, fx, coalesce(balance_num('combat', 'effect_cap_pct'), 100));
  -- a fallback extra goes to the member (the plan does not know the member)
  c := jsonb_set(c, '{extras}', (select coalesce(jsonb_agg(case when z->>'player' is null then z || jsonb_build_object('player', p_player) else z end), '[]'::jsonb)
                                   from jsonb_array_elements(c->'extras') z));
  s := hunt_v2_shared(p_hunt, p_player, p_day, c);
  if coalesce((s->>'over')::boolean, false) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = coalesce(ended_at, now())
     where hunt_id = p_hunt and player_id = p_player and day = p_day and (status = 'active' or ended_by is distinct from 'hunt_over');
  end if;
  -- HBP: the uses, only in the transaction that wrote their credit (a closed Hunt, no credit: the boons wait)
  if coalesce((s->>'written')::boolean, false) then
    for u in select z from jsonb_array_elements(c->'uses') z loop
      if (u->>'left')::int <= 0 then
        update public.player_effects set consumed_at = now() where id = (u->>'id')::bigint;
      else
        update public.player_effects set options = options || jsonb_build_object('uses', (u->>'left')::int) where id = (u->>'id')::bigint;
      end if;
    end loop;
  end if;
  return s || jsonb_build_object('cards', c->'cards', 'boons', case when coalesce((s->>'written')::boolean, false) then c->'boons' else null end,
    'extras', case when coalesce((s->>'written')::boolean, false) then c->'extras' else '[]'::jsonb end);
end $fn$;

-- ============================================================ 4. card turns (R3-ON + the mend of the card that has the turn)
create or replace function public.hunt_v2_turns(p_player text, p_choice jsonb, p_auto boolean, p_max int) returns jsonb
language plpgsql set search_path = public as $fn$
declare r public.hunt_v2_days; h public.hunts; x jsonb; sh jsonb; f jsonb; t jsonb; u jsonb; v_mid bigint; v_mamt numeric; v_heal numeric;
begin
  select * into r from public.hunt_v2_days d where d.player_id = p_player and d.day = hunt_v2_today() order by d.started_at desc limit 1 for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_day'); end if;
  if r.status = 'over' then return jsonb_build_object('ok', false, 'error', 'not_fighting', 'ended_by', r.ended_by); end if;
  -- the Hunt of the day, read with NO lock; a closed Hunt ends the day (a practice against an ended Hunt plays on)
  select * into h from public.hunts where id = r.hunt_id;
  if not found or (not coalesce((r.state->>'practice_ended')::boolean, false) and (h.status <> 'active' or now() >= h.closes_at)) then
    update public.hunt_v2_days set status = 'over', ended_by = 'hunt_over', ended_at = now()
     where hunt_id = r.hunt_id and player_id = r.player_id and day = r.day;
    return jsonb_build_object('ok', false, 'error', 'hunt_over');
  end if;
  f := r.state->'fight';
  -- HBP mend (R-MEND): on a LIVE day, the card that has the turn, up and hurt, heals max x amount % (capped at max) before the play. The mend
  -- row is locked here (SKIP LOCKED, no write) and consumed below only when the play answers ok and the credit is not over (review F-1).
  -- "Up" is the engine rule written out (not down and hp > 0), so this function names no engine function (the R1b/R3a reader checks).
  if r.live then
    t := f->'ext'->'turn';
    u := f->'cards'->(t->>'id');
    if t->>'side' = 'card' and u is not null and not coalesce((u->>'down')::boolean, false) and coalesce((u->>'hp')::numeric, 0) > 0
       and (u->>'hp')::numeric < (u->>'max')::numeric then
      select pe.id, coalesce(pe.amount, 0) into v_mid, v_mamt from public.player_effects pe
       where pe.player_id = p_player and pe.primitive = 'mend' and pe.consumed_at is null
         and (pe.starts_at is null or pe.starts_at <= now()) and (pe.expires_at is null or pe.expires_at > now())
       order by pe.created_at, pe.id limit 1 for update skip locked;
      if v_mid is not null then
        v_heal := least((u->>'max')::numeric, (u->>'hp')::numeric + (u->>'max')::numeric * least(v_mamt, coalesce(balance_num('combat', 'effect_cap_pct'), 100)) / 100) - (u->>'hp')::numeric;
        f := jsonb_set(f, array['cards', t->>'id', 'hp'], to_jsonb((u->>'hp')::numeric + v_heal));
      end if;
    end if;
  end if;
  x := dungeon_v2_play(f, case when p_auto then null else coalesce(p_choice, 'null'::jsonb) end, case when p_auto then p_max else 1 end, null);
  if not (x->>'ok')::boolean then return x; end if;
  perform hunt_v2_save(r.hunt_id, r.player_id, r.day, x->'fight', x->>'event',
    jsonb_build_object('kind', case when p_auto then 'auto' else 'act' end, 'event', x->'event', 'won', x->'won', 'log', x->'log'));
  -- the shared write of a LIVE day (the row mark; the flag is not read: a day keeps crediting after a rollback, HO9)
  sh := hunt_v2_live_credit(r.hunt_id, r.player_id, r.day, x->'log');
  if v_mid is not null and not coalesce((sh->>'over')::boolean, false) then
    update public.player_effects set consumed_at = now() where id = v_mid;
  else
    v_heal := null;
  end if;
  return hunt_v2_out(r.hunt_id, r.player_id, r.day, jsonb_build_object('event', x->'event', 'won', x->'won', 'actor', x->'actor', 'steps_left', x->'steps_left',
    'played', x->'played', 'log', x->'log', 'hp_changes', x->'hp_changes', 'credit', sh, 'mend', v_heal) || case when p_auto then jsonb_build_object('auto', x->'auto') else '{}'::jsonb end);
end $fn$;

-- ============================================================ 5. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric)', 'hunt_v2_shared(bigint, text, date, jsonb)',
      'hunt_v2_live_credit(bigint, text, date, jsonb)', 'hunt_v2_turns(text, jsonb, boolean, integer)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.hunt_v2_boon_plan(jsonb, jsonb, numeric, jsonb, numeric) is $cm$[combat] Combat v2 Hunt boons and pranks (HBP): the credit of one call with the member's waiting rally, butterfingers, launch_party and raid_crasher rows (p_fx, oldest first): one use = one card act that decreases the boss HP (R-HIT); the v1 order and cap; the raid_crasher extra from the final own value to the prankster (else the fallback). Returns {total, cards, extras, uses, boons}; with no rows = hunt_v2_credit. Pure. combat_v2_hunt_boons.sql.$cm$;
comment on function public.hunt_v2_shared(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, HBP): the shared write of a live call with a credit: hunts FOR NO KEY UPDATE, the status and the close time again (closed: no write, over), then hunt_hits per card (the v1 rule) and per raid_crasher extra (the prankster's card), the boss HP (own total + extras, stops at 0), one hunt_combat_log row per credited card, one combat_actions raid_crasher row per extra, credited (own only); only the call that defeats the boss settles it (settle_hunt) and writes the defeat event. combat_v2_hunt_boons.sql.$cm$;
comment on function public.hunt_v2_live_credit(bigint, text, date, jsonb) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, HBP): the credit and the shared write of one call of a LIVE day (the row mark, never the flag): the waiting Hunt boons and pranks (FOR UPDATE SKIP LOCKED), hunt_v2_boon_plan, hunt_v2_shared, then the uses (only when written); a closed Hunt ends the day as hunt_over. combat_v2_hunt_boons.sql.$cm$;
comment on function public.hunt_v2_turns(text, jsonb, boolean, integer) is $cm$[combat] Combat v2 Hunt (20.21 R3-ON, HBP): the body of hunt_v2_act and hunt_v2_auto: the day of today (locked), no_day, not_fighting, hunt_over (a practice against an ended Hunt plays on), the mend of the card that has the turn (live day; consumed only after an ok play and a credit that is not over), dungeon_v2_play, the save, then the credit of a LIVE day (the mark). combat_v2_hunt_boons.sql.$cm$;

notify pgrst, 'reload schema';
