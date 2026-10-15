-- f3_ability_kinds.sql (2026-10-15): F-3 PR 4a, the table `ability_kinds` and the check of `subjects.ability` (docs/f3-effect-engine.md 2.3 to 2.5).
-- Before: the ability kinds were typed in four places that could not disagree only by luck (push-abilities.mjs ATTACK / SUPPORT lists, the branches of
-- hunt_attack, hunt_support, dungeon_attack, dungeon_support), and the database accepted ANY jsonb in subjects.ability: a typo (an unknown effect, an
-- amount of 5 instead of 0.5, a heal that targets the boss) reached the fights.
-- After: ONE row per kind in `ability_kinds`: its slot, its fields with their limits, its steps (the effect as data: trigger, primitive, target,
-- condition, value), its latent upgrade fields, its power cost (reported only), the counter mark name, the Auto rule (data only), and a switch.
-- A trigger on ability_kinds refuses a row whose steps use a name that is not in the lists of 2.1 to 2.3 (primitives, triggers, conditions, targets,
-- value refs), a RESERVED name (repeat, summon, reflect, burn, mark, round_start, on_crit, on_kill, on_damage_taken, ally_down, low_hp, buff stats
-- crit and cooldown) and a balance ref that does not exist. A trigger on subjects refuses an ability that does not fit its kind (NULL is allowed).
-- NO CHANGE IN PLAY: nothing reads the steps, the power, the latent or the auto columns yet (the engine comes in PR 4b). The fights are the same.
-- The 13 rows hold the 127 live abilities (the migration stops at the first one that fails). The limits are about 2 x the largest live value
-- (Nathan approves them: docs/f3-effect-engine.md decision 8). Idempotent: the seed runs only into an empty table.
-- Test: card-studio/scripts/test-ability-kinds.mjs (rolled back; MUTATE=<name> must FAIL). Goldens: CANDIDATE=this file = the same fights.

-- ============================================================ 1. the table
create table if not exists public.ability_kinds (
  key         text primary key check (key ~ '^[a-z_]+$'),
  label       text not null check (label <> '' and label = trim(label)),
  slot        text not null check (slot in ('attack', 'support', 'squad')),
  steps       jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 8),
  fields      jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  latent      jsonb not null default '[]'::jsonb check (jsonb_typeof(latent) = 'array'),
  power       jsonb not null default '{}'::jsonb check (jsonb_typeof(power) = 'object'),
  counter_key text check (counter_key ~ '^[a-z_]+$'),
  auto        jsonb check (jsonb_typeof(auto) = 'object'),
  enabled     boolean not null default true,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.ability_kinds enable row level security;
revoke all on public.ability_kinds from public, anon, authenticated;
grant all on public.ability_kinds to service_role;

-- ============================================================ 2. the checks of one value, one condition, one step
-- Each function returns NULL when the input is good, or the reason text. Reserved names are refused with their own words.

-- A value ref: field:<name> (the kind has that field), balance:<key>.<leaf> (the number exists), or one of the fixed names.
create or replace function public.ability_ref_check(p_ref text, p_fields jsonb)
returns text language plpgsql stable set search_path = public as $$
declare v_path text[]; v jsonb;
begin
  if p_ref is null then return 'a value ref must be text'; end if;
  if p_ref in ('potency', 'counter', 'matched_x', 'scale', 'dealt', 'count_tag') then return null; end if;
  if p_ref like 'field:%' then
    if p_fields ? substr(p_ref, 7) then return null; end if;
    return format('value ref "%s": the kind has no field "%s"', p_ref, substr(p_ref, 7));
  end if;
  if p_ref like 'balance:%' then
    v_path := string_to_array(substr(p_ref, 9), '.');
    if cardinality(v_path) < 2 or '' = any(v_path) then return format('balance ref "%s" must be balance:<key>.<leaf>', p_ref); end if;
    select value into v from public.balance where key = v_path[1];
    if v is null or (v #> v_path[2:cardinality(v_path)]) is null then return format('balance ref "%s": the balance table has no value there', p_ref); end if;
    return null;
  end if;
  return format('unknown value ref "%s"', p_ref);
end $$;

-- A value: {"refs": [ref, ...], "add1": true|false}. The value is the product of the refs (plus 1 when add1: 1 + the product).
create or replace function public.ability_value_check(p_val jsonb, p_fields jsonb)
returns text language plpgsql stable set search_path = public as $$
declare k text; e jsonb; r text;
begin
  if jsonb_typeof(p_val) is distinct from 'object' then return 'a value must be an object {refs, add1}'; end if;
  for k in select jsonb_object_keys(p_val) loop
    if k not in ('refs', 'add1') then return format('value: unknown key "%s"', k); end if;
  end loop;
  if jsonb_typeof(p_val->'refs') is distinct from 'array' or jsonb_array_length(p_val->'refs') = 0 then return 'value.refs must be a list with at least one ref'; end if;
  if p_val ? 'add1' and jsonb_typeof(p_val->'add1') is distinct from 'boolean' then return 'value.add1 must be true or false'; end if;
  for e in select x from jsonb_array_elements(p_val->'refs') x loop
    if jsonb_typeof(e) is distinct from 'string' then return 'value.refs must hold text refs'; end if;
    r := public.ability_ref_check(e #>> '{}', p_fields);
    if r is not null then return r; end if;
  end loop;
  return null;
end $$;

-- One condition: {"kind": ..., params}. The kinds of 2.3: target_hp_below, target_down, target_alive, matched, count_tag, holds_subject, mode_in, flag.
create or replace function public.ability_cond_check(p_c jsonb, p_fields jsonb)
returns text language plpgsql stable set search_path = public as $$
declare v_kind text; k text; allowed text[]; r text; m jsonb; e jsonb; n int;
begin
  if jsonb_typeof(p_c) is distinct from 'object' then return 'a condition must be an object'; end if;
  v_kind := p_c->>'kind';
  allowed := case v_kind
    when 'target_hp_below' then array['kind', 'value'] when 'target_down' then array['kind'] when 'target_alive' then array['kind'] when 'matched' then array['kind']
    when 'count_tag' then array['kind', 'tag', 'scope', 'distinct', 'min', 'max'] when 'holds_subject' then array['kind', 'key', 'scope']
    when 'mode_in' then array['kind', 'modes'] when 'flag' then array['kind', 'balance'] end;
  if allowed is null then return format('unknown condition "%s"', coalesce(v_kind, '(none)')); end if;
  for k in select jsonb_object_keys(p_c) loop
    if not k = any(allowed) then return format('condition %s: unknown key "%s"', v_kind, k); end if;
  end loop;
  if v_kind = 'target_hp_below' then
    if jsonb_typeof(p_c->'value') is distinct from 'string' then return 'condition target_hp_below needs value: a ref text'; end if;
    return public.ability_ref_check(p_c->>'value', p_fields);
  elsif v_kind = 'count_tag' then
    if coalesce(p_c->>'tag', '') !~ '^[a-z_]+:[a-z0-9_-]+$' then return 'condition count_tag needs tag like trait:forbidden-pride'; end if;
    if coalesce(p_c->>'scope', '') <> 'squad' then return 'condition count_tag: scope must be squad'; end if;
    if p_c ? 'distinct' and (p_c->>'distinct') not in ('subject', 'card') then return 'condition count_tag: distinct must be subject or card'; end if;
    if not (p_c ? 'min' or p_c ? 'max') then return 'condition count_tag needs min or max'; end if;
    foreach k in array array['min', 'max'] loop
      if p_c ? k then
        if jsonb_typeof(p_c->k) = 'number' then null;
        elsif jsonb_typeof(p_c->k) = 'string' and (p_c->>k) like 'balance:%' then
          r := public.ability_ref_check(p_c->>k, p_fields); if r is not null then return r; end if;
        else return format('condition count_tag: %s must be a number or a balance ref', k); end if;
      end if;
    end loop;
  elsif v_kind = 'holds_subject' then
    if coalesce(p_c->>'key', '') !~ '^[a-z0-9_-]+$' then return 'condition holds_subject needs the subject key'; end if;
    if coalesce(p_c->>'scope', '') <> 'squad' then return 'condition holds_subject: scope must be squad'; end if;
  elsif v_kind = 'mode_in' then
    if jsonb_typeof(p_c->'modes') is distinct from 'array' or jsonb_array_length(p_c->'modes') = 0 then return 'condition mode_in needs a list of modes'; end if;
    for e in select x from jsonb_array_elements(p_c->'modes') x loop
      if (e #>> '{}') not in ('hunt', 'dungeon', 'gauntlet') then return format('condition mode_in: unknown mode %s', e); end if;
    end loop;
  elsif v_kind = 'flag' then
    if coalesce(p_c->>'balance', '') not like 'balance:%' then return 'condition flag needs balance: a balance ref'; end if;
    return public.ability_ref_check(p_c->>'balance', p_fields);
  end if;
  return null;
end $$;

-- One step: {"on": trigger, "do": primitive, ...}. slot decides the triggers that are allowed (attack and squad: before_hit, on_hit, after_attack; support: use).
create or replace function public.ability_step_check(p_slot text, p_fields jsonb, p_step jsonb)
returns text language plpgsql stable set search_path = public as $$
declare v_on text; v_do text; v_stat text; k text; allowed text[]; r text; e jsonb; c jsonb; v_target text; v_tgt_ok text[];
begin
  if jsonb_typeof(p_step) is distinct from 'object' then return 'a step must be an object'; end if;
  v_on := p_step->>'on'; v_do := p_step->>'do';
  -- triggers
  if v_on in ('round_start', 'on_crit', 'on_kill', 'on_damage_taken', 'ally_down', 'low_hp') then return format('trigger "%s" is reserved (not built yet)', v_on); end if;
  if v_on is null or v_on not in ('use', 'before_hit', 'on_hit', 'after_attack') then return format('unknown trigger "%s"', coalesce(v_on, '(none)')); end if;
  if p_slot = 'support' and v_on <> 'use' then return format('a support kind runs on "use", not "%s"', v_on); end if;
  if p_slot <> 'support' and v_on = 'use' then return format('an %s kind cannot run on "use"', p_slot); end if;
  -- primitives
  if v_do in ('repeat', 'summon', 'reflect') then return format('primitive "%s" is reserved (not built yet)', v_do); end if;
  allowed := case v_do
    when 'damage' then array['target', 'value', 'cap'] when 'heal' then array['target', 'basis', 'value', 'cap'] when 'shield' then array['target', 'basis', 'value', 'cap']
    when 'buff' then array['stat', 'target', 'value', 'cap', 'rounds', 'until'] when 'apply_status' then array['status', 'target', 'rounds']
    when 'remove_status' then array['statuses', 'target'] when 'hit_mod' then array['mod', 'value'] end;
  if allowed is null then return format('unknown primitive "%s"', coalesce(v_do, '(none)')); end if;
  for k in select jsonb_object_keys(p_step) loop
    if k not in ('on', 'do', 'when') and not k = any(allowed) then return format('step %s: unknown key "%s"', v_do, k); end if;
  end loop;
  -- conditions
  if p_step ? 'when' then
    if jsonb_typeof(p_step->'when') is distinct from 'array' then return 'step.when must be a list of conditions'; end if;
    for c in select x from jsonb_array_elements(p_step->'when') x loop
      r := public.ability_cond_check(c, p_fields); if r is not null then return r; end if;
    end loop;
  end if;
  -- targets (one set for each primitive, and the buff stat decides its own)
  v_target := p_step->>'target';
  if v_target is not null and v_target not in ('self', 'ally_target', 'enemy_target', 'all_allies') then return format('unknown target "%s"', v_target); end if;
  if v_do = 'damage' then v_tgt_ok := array['enemy_target'];
  elsif v_do in ('heal', 'shield') then v_tgt_ok := array['self', 'ally_target'];
  elsif v_do = 'apply_status' then v_tgt_ok := array['enemy_target'];
  elsif v_do = 'remove_status' then v_tgt_ok := array['all_allies'];
  elsif v_do = 'buff' then
    v_stat := p_step->>'stat';
    if v_stat in ('crit', 'cooldown') then return format('buff stat "%s" is reserved (not built yet)', v_stat); end if;
    if v_stat is null or v_stat not in ('attack', 'enemy_damage', 'damage_taken') then return format('unknown buff stat "%s"', coalesce(v_stat, '(none)')); end if;
    v_tgt_ok := case when v_stat = 'attack' then array['ally_target'] else array['enemy_target'] end;
  end if;
  if v_do <> 'hit_mod' then
    if v_target is null then return format('step %s needs a target', v_do); end if;
    if not v_target = any(v_tgt_ok) then return format('step %s: target "%s" is not allowed (allowed: %s)', v_do, v_target, array_to_string(v_tgt_ok, ', ')); end if;
  elsif v_target is not null then return 'step hit_mod has no target'; end if;
  -- the value, the cap, the rounds
  if v_do in ('damage', 'heal', 'shield', 'buff') then
    if not p_step ? 'value' then return format('step %s needs a value', v_do); end if;
    r := public.ability_value_check(p_step->'value', p_fields); if r is not null then return r; end if;
  end if;
  if p_step ? 'cap' then
    if jsonb_typeof(p_step->'cap') is distinct from 'string' or (p_step->>'cap') not like 'balance:%' then return 'step.cap must be a balance ref'; end if;
    r := public.ability_ref_check(p_step->>'cap', p_fields); if r is not null then return r; end if;
  end if;
  if p_step ? 'rounds' then
    r := public.ability_value_check(p_step->'rounds', p_fields); if r is not null then return r; end if;
  end if;
  -- the rest of each primitive
  if v_do in ('heal', 'shield') then
    if coalesce(p_step->>'basis', '') not in ('dealt', 'target_max') then return format('step %s: basis must be dealt or target_max', v_do); end if;
    if p_step->>'basis' = 'dealt' and v_on not in ('on_hit', 'after_attack') then return 'basis dealt needs the trigger on_hit or after_attack'; end if;
  elsif v_do = 'buff' then
    if (p_step ? 'rounds') = (p_step ? 'until') then return 'step buff needs exactly one of rounds and until'; end if;
    if p_step ? 'until' and (p_step->>'until') is distinct from 'next_attack' then return 'step.until must be next_attack'; end if;
  elsif v_do = 'apply_status' then
    if p_step->>'status' in ('burn', 'mark') then return format('status "%s" is reserved (not built yet)', p_step->>'status'); end if;
    if p_step->>'status' is distinct from 'stun' then return format('unknown status "%s"', coalesce(p_step->>'status', '(none)')); end if;
    if not p_step ? 'rounds' then return 'step apply_status needs rounds'; end if;
  elsif v_do = 'remove_status' then
    if jsonb_typeof(p_step->'statuses') is distinct from 'array' or jsonb_array_length(p_step->'statuses') = 0 then return 'step remove_status needs a list of statuses'; end if;
    for e in select x from jsonb_array_elements(p_step->'statuses') x loop
      if (e #>> '{}') in ('burn', 'mark') then return format('status "%s" is reserved (not built yet)', e #>> '{}'); end if;
      if (e #>> '{}') not in ('curse', 'poison') then return format('unknown status %s', e); end if;
    end loop;
  elsif v_do = 'hit_mod' then
    if v_on <> 'before_hit' then return 'step hit_mod runs on before_hit only'; end if;
    if coalesce(p_step->>'mod', '') not in ('crit_add', 'no_block', 'dmg_mult', 'extra_strike') then return format('unknown hit_mod "%s"', coalesce(p_step->>'mod', '(none)')); end if;
    if p_step->>'mod' = 'no_block' then
      if p_step ? 'value' then return 'hit_mod no_block has no value'; end if;
    else
      if not p_step ? 'value' then return format('hit_mod %s needs a value', p_step->>'mod'); end if;
      r := public.ability_value_check(p_step->'value', p_fields); if r is not null then return r; end if;
    end if;
  end if;
  return null;
end $$;

-- The fields of a kind: {"<name>": {"type": number|integer|text, "required": bool, "min", "max", "enum": [..], "pattern": text, "default": value}}.
create or replace function public.ability_fields_check(p_fields jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare f text; s jsonb; k text; v_type text;
begin
  for f, s in select key, value from jsonb_each(p_fields) loop
    if f !~ '^[a-z_]+$' then return format('field name "%s" must be lower case letters', f); end if;
    if f in ('name', 'desc', 'kind', 'effect') then return format('field name "%s" is reserved (every ability has it)', f); end if;
    if jsonb_typeof(s) is distinct from 'object' then return format('field %s: the spec must be an object', f); end if;
    for k in select jsonb_object_keys(s) loop
      if k not in ('type', 'required', 'min', 'max', 'enum', 'pattern', 'default') then return format('field %s: unknown key "%s"', f, k); end if;
    end loop;
    v_type := s->>'type';
    if v_type is null or v_type not in ('number', 'integer', 'text') then return format('field %s: type must be number, integer or text', f); end if;
    if s ? 'required' and jsonb_typeof(s->'required') is distinct from 'boolean' then return format('field %s: required must be true or false', f); end if;
    if v_type = 'text' and (s ? 'min' or s ? 'max') then return format('field %s: a text field has no min or max', f); end if;
    if v_type <> 'text' and (s ? 'enum' or s ? 'pattern') then return format('field %s: a number field has no enum or pattern', f); end if;
    foreach k in array array['min', 'max'] loop
      if s ? k and jsonb_typeof(s->k) is distinct from 'number' then return format('field %s: %s must be a number', f, k); end if;
    end loop;
    if s ? 'min' and s ? 'max' and (s->>'min')::numeric > (s->>'max')::numeric then return format('field %s: min is above max', f); end if;
    if s ? 'enum' and (jsonb_typeof(s->'enum') is distinct from 'array' or jsonb_array_length(s->'enum') = 0) then return format('field %s: enum must be a list', f); end if;
    if s ? 'pattern' and jsonb_typeof(s->'pattern') is distinct from 'string' then return format('field %s: pattern must be text', f); end if;
    if s ? 'default' then
      if coalesce((s->>'required')::boolean, false) then return format('field %s: a required field has no default', f); end if;
      if v_type = 'text' and jsonb_typeof(s->'default') is distinct from 'string' then return format('field %s: the default must be text', f); end if;
      if v_type <> 'text' and jsonb_typeof(s->'default') is distinct from 'number' then return format('field %s: the default must be a number', f); end if;
      if s ? 'min' and (s->>'default')::numeric < (s->>'min')::numeric then return format('field %s: the default is below min', f); end if;
      if s ? 'max' and (s->>'default')::numeric > (s->>'max')::numeric then return format('field %s: the default is above max', f); end if;
    end if;
  end loop;
  return null;
end $$;

-- ============================================================ 3. the trigger of ability_kinds
create or replace function public.ability_kinds_check() returns trigger language plpgsql set search_path = public as $$
declare r text; s jsonb; i int := 0; f text; w jsonb;
begin
  -- the shape first (the table checks run after the trigger, and the step loop needs a list)
  if new.slot is null or new.slot not in ('attack', 'support', 'squad') then raise exception 'ability_kinds %: slot must be attack, support or squad', new.key; end if;
  if jsonb_typeof(new.steps) is distinct from 'array' or jsonb_array_length(new.steps) not between 1 and 8 then raise exception 'ability_kinds %: steps must be a list of 1 to 8 steps', new.key; end if;
  r := public.ability_fields_check(new.fields);
  if r is not null then raise exception 'ability_kinds %: %', new.key, r; end if;
  for s in select x from jsonb_array_elements(new.steps) x loop
    i := i + 1;
    r := public.ability_step_check(new.slot, new.fields, s);
    if r is not null then raise exception 'ability_kinds %: step %: %', new.key, i, r; end if;
  end loop;
  -- latent: the fields that a latent upgrade can change (each is a number field of this kind)
  for f in select jsonb_array_elements_text(new.latent) loop
    if not (new.fields ? f) or new.fields->f->>'type' = 'text' then raise exception 'ability_kinds %: latent "%" is not a number field of the kind', new.key, f; end if;
  end loop;
  -- power: {"base": number, "weights": {"<number field>": number}} (reported by ability_power, not used by a fight)
  if new.power <> '{}'::jsonb then
    if jsonb_typeof(new.power->'base') is distinct from 'number' then raise exception 'ability_kinds %: power.base must be a number', new.key; end if;
    w := coalesce(new.power->'weights', '{}'::jsonb);
    if jsonb_typeof(w) is distinct from 'object' then raise exception 'ability_kinds %: power.weights must be an object', new.key; end if;
    for f in select jsonb_object_keys(w) loop
      if not (new.fields ? f) or new.fields->f->>'type' = 'text' or jsonb_typeof(w->f) is distinct from 'number' then
        raise exception 'ability_kinds %: power weight "%" must be a number for a number field of the kind', new.key, f; end if;
    end loop;
    if exists (select 1 from jsonb_object_keys(new.power) k where k not in ('base', 'weights')) then raise exception 'ability_kinds %: power has only base and weights', new.key; end if;
  end if;
  -- squad rows are not abilities: no field, no counter key
  if new.slot = 'squad' and (new.fields <> '{}'::jsonb or new.counter_key is not null) then raise exception 'ability_kinds %: a squad kind has no fields and no counter_key', new.key; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ability_kinds_check on public.ability_kinds;
create trigger ability_kinds_check before insert or update on public.ability_kinds for each row execute function public.ability_kinds_check();

-- ============================================================ 4. the check of one ability
-- ability_check(jsonb): NULL = fine (a NULL ability is fine), else the reason text. ability_ok(jsonb) = ability_check is NULL.
create or replace function public.ability_check(p_ability jsonb)
returns text language plpgsql stable set search_path = public as $$
declare v_kind text; v_eff text; k public.ability_kinds%rowtype; f text; s jsonb; v jsonb; v_type text; n numeric;
begin
  if p_ability is null then return null; end if;
  if jsonb_typeof(p_ability) is distinct from 'object' then return 'an ability must be an object (or NULL)'; end if;
  v_kind := p_ability->>'kind'; v_eff := p_ability->>'effect';
  if v_kind is null or v_kind not in ('attack', 'support') then return format('ability kind must be attack or support, not "%s"', coalesce(v_kind, '(none)')); end if;
  select * into k from public.ability_kinds where key = v_eff;
  if not found then return format('unknown ability effect "%s"', coalesce(v_eff, '(none)')); end if;
  if k.slot = 'squad' then return format('effect "%s" is a squad effect: a card cannot have it as its ability', v_eff); end if;
  if k.slot <> v_kind then return format('effect "%s" is a %s effect, not an %s one', v_eff, k.slot, v_kind); end if;
  if not k.enabled then return format('effect "%s" is switched off', v_eff); end if;
  if jsonb_typeof(p_ability->'name') is distinct from 'string' or btrim(p_ability->>'name') = '' then return 'the ability needs a name'; end if;
  if p_ability ? 'desc' and jsonb_typeof(p_ability->'desc') not in ('string', 'null') then return 'desc must be text'; end if;
  for f in select jsonb_object_keys(p_ability) loop
    if f in ('name', 'desc', 'kind', 'effect') then continue; end if;
    if jsonb_typeof(p_ability->f) = 'null' then continue; end if;   -- the studio sends null for a field that is not set
    if not k.fields ? f then return format('effect "%s" has no field "%s"', v_eff, f); end if;
  end loop;
  for f, s in select key, value from jsonb_each(k.fields) loop
    v := p_ability->f; v_type := s->>'type';
    if v is null or jsonb_typeof(v) = 'null' then
      if coalesce((s->>'required')::boolean, false) then return format('effect "%s" needs the field "%s"', v_eff, f); end if;
      continue;
    end if;
    if v_type = 'text' then
      if jsonb_typeof(v) <> 'string' then return format('field "%s" must be text', f); end if;
      if s ? 'enum' and not s->'enum' @> to_jsonb(v #>> '{}') then return format('field "%s" must be one of %s, not "%s"', f, s->'enum', v #>> '{}'); end if;
      if s ? 'pattern' and (v #>> '{}') !~ (s->>'pattern') then return format('field "%s" has a wrong form: "%s"', f, v #>> '{}'); end if;
    else
      if jsonb_typeof(v) <> 'number' then return format('field "%s" must be a number', f); end if;
      n := (v #>> '{}')::numeric;
      if v_type = 'integer' and n <> trunc(n) then return format('field "%s" must be a whole number, not %s', f, n); end if;
      if s ? 'min' and n < (s->>'min')::numeric then return format('field "%s" is %s: the minimum for %s is %s', f, n, v_eff, s->>'min'); end if;
      if s ? 'max' and n > (s->>'max')::numeric then return format('field "%s" is %s: the maximum for %s is %s', f, n, v_eff, s->>'max'); end if;
    end if;
  end loop;
  return null;
end $$;

create or replace function public.ability_ok(p_ability jsonb)
returns boolean language sql stable set search_path = public as $$ select public.ability_check(p_ability) is null $$;

-- The power cost of an ability: base + sum(weight x value) over the weights of its kind. REPORTED ONLY: no fight reads it. NULL for a NULL or unknown ability.
create or replace function public.ability_power(p_ability jsonb)
returns numeric language sql stable set search_path = public as $$
  select case when p_ability is null or k.key is null or k.power = '{}'::jsonb then null
    else round((k.power->>'base')::numeric + coalesce((
      select sum((w.value #>> '{}')::numeric * coalesce(nullif(p_ability->>w.key, '')::numeric, 0))
        from jsonb_each(coalesce(k.power->'weights', '{}'::jsonb)) w), 0), 4) end
  from (select 1) one left join public.ability_kinds k on k.key = p_ability->>'effect'
$$;

-- ============================================================ 5. the seed: the 13 live kinds
-- Steps are data (the effect as the engine of PR 4b will run it); fields are the ability fields with their LIMITS (about 2 x the largest live value);
-- power is a placeholder cost (not tuned by the Lab yet); auto is today's Auto pick rule (dungeon_auto_action), copied as data; counter_key is the
-- name of the Hunt boss mark family (block_<key>, half_<key>) that weakens a support of this kind.
do $s$
declare
  aff jsonb := '{"type": "text", "pattern": "^[a-z]+:[a-z0-9_-]+$"}';
  dur jsonb := '{"type": "integer", "min": 1, "max": 2, "default": 1}';
  dur4 jsonb := '{"type": "integer", "min": 1, "max": 4, "default": 1}';
  ally_refs jsonb := '["field:amount", "potency", "counter", "matched_x"]';
  foe_refs jsonb := '["field:amount", "potency", "counter", "scale"]';
begin
  if exists (select 1 from public.ability_kinds) then return; end if;
  insert into public.ability_kinds (key, label, slot, steps, fields, latent, power, counter_key, auto, note) values
  ('focus', 'Focus', 'attack',
    '[{"on": "before_hit", "do": "hit_mod", "mod": "crit_add", "value": {"refs": ["field:amount"]}}]',
    '{"amount": {"type": "number", "required": true, "min": 0.01, "max": 0.4}}',
    '["amount"]', '{"base": 0, "weights": {"amount": 10}}', null, null,
    'Adds amount to the crit chance of the hit (combat_crit_chance).'),
  ('pierce', 'Pierce', 'attack',
    '[{"on": "before_hit", "do": "hit_mod", "mod": "no_block"}]',
    '{}', '[]', '{"base": 1}', null, null,
    'The hit cannot be blocked (combat_hit). No field.'),
  ('execute', 'Execute', 'attack',
    jsonb_build_array(jsonb_build_object('on', 'before_hit', 'do', 'hit_mod', 'mod', 'dmg_mult', 'value', jsonb_build_object('refs', jsonb_build_array('field:amount'), 'add1', true),
      'when', jsonb_build_array(jsonb_build_object('kind', 'target_hp_below', 'value', 'field:threshold')))),
    '{"amount": {"type": "number", "required": true, "min": 0.05, "max": 1}, "threshold": {"type": "number", "required": true, "min": 0.05, "max": 0.6}}',
    '["amount", "threshold"]', '{"base": 0, "weights": {"amount": 5, "threshold": 5}}', null, null,
    'Damage x (1 + amount) while the target HP is below threshold (a fraction of its max HP).'),
  ('rampage', 'Rampage', 'attack',
    '[{"on": "before_hit", "do": "hit_mod", "mod": "extra_strike", "value": {"refs": ["field:amount"]}}]',
    '{"amount": {"type": "number", "required": true, "min": 0, "max": 1}}',
    '["amount"]', '{"base": 0, "weights": {"amount": 5}}', null, null,
    'The chance (amount, 0 to 1) of a second strike on a hit. 0 = never and 1 = always (test-effects-cleanup uses both).'),
  ('lifesteal', 'Lifesteal', 'attack',
    '[{"on": "on_hit", "do": "heal", "target": "self", "basis": "dealt", "value": {"refs": ["field:amount"]}, "cap": "balance:combat.lifesteal_cap"}]',
    '{"amount": {"type": "number", "required": true, "min": 0.01, "max": 0.5}, "target": {"type": "text", "enum": ["self"]}}',
    '["amount"]', '{"base": 0, "weights": {"amount": 10}}', null, null,
    'The attacker heals amount x the damage it dealt, at most balance combat.lifesteal_cap of its max HP.'),
  ('empower', 'Empower', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'buff', 'stat', 'attack', 'target', 'ally_target', 'value', jsonb_build_object('refs', ally_refs, 'add1', true), 'until', 'next_attack')),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 0.05, "max": 1}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["ally"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 4}'::jsonb, 'duration', dur, 'affinity', aff),
    '["amount"]', '{"base": 0, "weights": {"amount": 4, "cooldown": -0.25}}', 'empower',
    '{"who": "best_attacker"}', 'The ally attack x (1 + amount) until its next attack.'),
  ('shield', 'Shield', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'shield', 'target', 'ally_target', 'basis', 'target_max', 'value', jsonb_build_object('refs', ally_refs), 'cap', 'balance:support.heal_cap')),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 0.05, "max": 0.8}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["ally"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 4}'::jsonb, 'duration', dur, 'affinity', aff),
    '["amount"]', '{"base": 0, "weights": {"amount": 4, "cooldown": -0.25}}', 'shield',
    '{"who": "hurt_ally", "hp_below": 0.6}', 'A shield of amount x the ally max HP (at most balance support.heal_cap).'),
  ('heal', 'Heal', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'heal', 'target', 'ally_target', 'basis', 'target_max', 'value', jsonb_build_object('refs', ally_refs), 'cap', 'balance:support.heal_cap')),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 0.05, "max": 0.6}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["ally"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 4}'::jsonb, 'duration', dur, 'affinity', aff),
    '["amount"]', '{"base": 0, "weights": {"amount": 5, "cooldown": -0.25}}', 'heal',
    '{"who": "hurt_ally", "hp_below": 0.5}', 'Heals amount x the ally max HP (at most balance support.heal_cap). Never revives a downed card.'),
  ('weaken', 'Weaken', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'buff', 'stat', 'enemy_damage', 'target', 'enemy_target', 'value', jsonb_build_object('refs', foe_refs),
      'cap', 'balance:support.weaken_cap', 'rounds', jsonb_build_object('refs', jsonb_build_array('field:duration')))),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 0.05, "max": 0.6}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["boss"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 6}'::jsonb, 'duration', dur4, 'affinity', aff),
    '["amount", "duration"]', '{"base": 0, "weights": {"amount": 5, "duration": 0.5, "cooldown": -0.25}}', 'weaken',
    '{"who": "enemy"}', 'The enemy damage x (1 - amount x scale, at most balance support.weaken_cap) for duration rounds.'),
  ('expose', 'Expose', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'buff', 'stat', 'damage_taken', 'target', 'enemy_target', 'value', jsonb_build_object('refs', foe_refs),
      'cap', 'balance:support.expose_cap', 'rounds', jsonb_build_object('refs', jsonb_build_array('field:duration')))),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 0.05, "max": 0.6}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["boss"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 6}'::jsonb, 'duration', dur4, 'affinity', aff),
    '["amount", "duration"]', '{"base": 0, "weights": {"amount": 5, "duration": 0.5, "cooldown": -0.25}}', 'expose',
    '{"who": "enemy"}', 'The enemy takes x (1 + amount x scale, at most balance support.expose_cap) damage for duration rounds.'),
  ('stun', 'Stun', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'apply_status', 'status', 'stun', 'target', 'enemy_target', 'rounds', jsonb_build_object('refs', jsonb_build_array('field:duration')))),
    jsonb_build_object('amount', '{"type": "number", "min": 0, "max": 0}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["boss"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 10}'::jsonb, 'duration', dur, 'affinity', aff),
    '["duration"]', '{"base": 2, "weights": {"duration": 2, "cooldown": -0.25}}', 'stun',
    '{"when": "foe_not_stunned"}', 'The enemy loses its turn for duration rounds (stun immunity applies). amount is not used (always 0).'),
  ('smite', 'Smite', 'support',
    jsonb_build_array(jsonb_build_object('on', 'use', 'do', 'damage', 'target', 'enemy_target', 'value', jsonb_build_object('refs', foe_refs))),
    jsonb_build_object('amount', '{"type": "number", "required": true, "min": 10, "max": 400}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["boss"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 8}'::jsonb, 'duration', dur, 'affinity', aff),
    '["amount"]', '{"base": 0, "weights": {"amount": 0.025, "cooldown": -0.25}}', 'smite',
    '{"who": "enemy"}', 'Deals amount x scale damage (at least 1) to the enemy.'),
  ('cleanse', 'Cleanse', 'support',
    '[{"on": "use", "do": "remove_status", "statuses": ["curse", "poison"], "target": "all_allies"}]',
    jsonb_build_object('amount', '{"type": "number", "min": 0, "max": 0}'::jsonb, 'target', '{"type": "text", "required": true, "enum": ["team"]}'::jsonb,
      'cooldown', '{"type": "integer", "required": true, "min": 1, "max": 4}'::jsonb, 'duration', dur, 'affinity', aff),
    '[]', '{"base": 2, "weights": {"cooldown": -0.25}}', 'cleanse',
    '{"when": "debuffed"}', 'Removes the curse and the poison from every ally. amount is not used (always 0).');
end $s$;

-- The Forbidden Pride row and the other squad rows come in PR 4f. The 13 rows above are the live kinds.

-- ============================================================ 6. the check of subjects.ability
-- BEFORE INSERT OR UPDATE OF ability: an invalid ability is refused with the reason (the studio shows it). NULL is allowed. An UPDATE that does not
-- change the ability passes (an old value never blocks a change of another column).
create or replace function public.subjects_ability_check() returns trigger language plpgsql set search_path = public as $$
declare r text;
begin
  if new.ability is null then return new; end if;
  if tg_op = 'UPDATE' and new.ability is not distinct from old.ability then return new; end if;
  r := public.ability_check(new.ability);
  if r is not null then raise exception 'ability refused (%): %', new.key, r using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists subjects_ability_check on public.subjects;
create trigger subjects_ability_check before insert or update of ability on public.subjects for each row execute function public.subjects_ability_check();

-- A change of ability_kinds (a tighter limit, a field removed, a switch off, a row deleted) is refused when a live ability would fail after it.
-- Created AFTER the seed: the seed would fail it (the first kind has no neighbors yet).
create or replace function public.ability_kinds_recheck() returns trigger language plpgsql set search_path = public as $$
declare r record; v text;
begin
  for r in select key, ability from public.subjects where ability is not null loop
    v := public.ability_check(r.ability);
    if v is not null then raise exception 'ability_kinds change refused: the ability of % would fail (%)', r.key, v; end if;
  end loop;
  return null;
end $$;
drop trigger if exists ability_kinds_recheck on public.ability_kinds;
create trigger ability_kinds_recheck after insert or update or delete on public.ability_kinds for each statement execute function public.ability_kinds_recheck();

-- ============================================================ 7. the self-check: every live ability must pass (stops the migration at the first failure)
do $chk$
declare r record; v text; n int := 0;
begin
  for r in select key, ability from public.subjects where ability is not null order by key loop
    v := public.ability_check(r.ability);
    if v is not null then raise exception 'f3_ability_kinds.sql: the live ability of % fails the check (%): fix the data or the limits first', r.key, v; end if;
    n := n + 1;
  end loop;
  raise notice 'f3_ability_kinds.sql: % live abilities pass', n;
end $chk$;

-- ============================================================ 8. the docs
comment on table public.ability_kinds is $doc$[combat] The one list of ability kinds (f3_ability_kinds.sql, F-3 PR 4a): key (the effect name on a card), label, slot (attack, support or squad), steps (the effect as data: trigger, primitive, target, condition, value; 1 to 8), fields (the ability fields with their types and limits), latent (the fields that the Silver upgrade can change), power (a placeholder cost, reported only), counter_key (the boss mark family that weakens it), auto (the Auto pick rule as data) and enabled. A trigger checks each step against the lists of docs/f3-effect-engine.md 2.1 to 2.3 and refuses reserved names and unknown balance refs. A trigger on subjects refuses an ability that does not fit its kind. No fight reads steps, latent, power or auto yet (PR 4b). Server only.$doc$;
comment on column public.ability_kinds.key is 'The effect name that a card ability uses (subjects.ability->>effect), lower case, for example heal.';
comment on column public.ability_kinds.label is 'The name shown to players and to the card studio, for example Heal.';
comment on column public.ability_kinds.slot is 'attack (a Character or Creature, runs on a hit), support (any other card, runs on use) or squad (a set bonus of the whole squad: not an ability, PR 4f).';
comment on column public.ability_kinds.steps is 'The effect as a list of 1 to 8 steps: {on, do, target, value, when, ...}. on is use, before_hit, on_hit or after_attack. do is damage, heal, shield, buff, apply_status, remove_status or hit_mod. Reserved names are refused.';
comment on column public.ability_kinds.fields is '{"<field>": {type: number|integer|text, required, min, max, enum, pattern, default}}: the ability fields of this kind with their LIMITS. A field outside the list, a value outside the limits or a missing required field is refused on subjects.ability.';
comment on column public.ability_kinds.latent is 'The number fields that the latent (Silver) upgrade can change, a list of field names (docs/foundations.md item 10). Nothing reads it yet.';
comment on column public.ability_kinds.power is '{"base": number, "weights": {"<number field>": number}}: the power cost of an ability of this kind (ability_power). A placeholder that the Combat Lab has not tuned. Reported only: no fight reads it.';
comment on column public.ability_kinds.counter_key is 'The boss mark family that weakens this kind in the Hunt: block_<key> and half_<key> (hunt_support). NULL for an attack kind.';
comment on column public.ability_kinds.auto is 'The Auto pick rule of today (dungeon_auto_action) as data, for example {"who": "hurt_ally", "hp_below": 0.5}. Data only: dungeon_auto_action still has its own code.';
comment on column public.ability_kinds.enabled is 'False: a card cannot get this kind (an ability that has it is refused).';
comment on column public.ability_kinds.note is 'What the effect does, in plain words.';
comment on column public.ability_kinds.updated_at is 'The last change of the row.';
comment on function public.ability_ref_check(text, jsonb) is 'F-3 4a: NULL when a value ref (field:<name>, balance:<key>.<leaf>, potency, counter, matched_x, scale, dealt, count_tag) is valid for a kind with these fields, else the reason.';
comment on function public.ability_value_check(jsonb, jsonb) is 'F-3 4a: NULL when a step value {refs, add1} is valid, else the reason.';
comment on function public.ability_cond_check(jsonb, jsonb) is 'F-3 4a: NULL when a step condition is valid (target_hp_below, target_down, target_alive, matched, count_tag, holds_subject, mode_in, flag), else the reason.';
comment on function public.ability_step_check(text, jsonb, jsonb) is 'F-3 4a: NULL when one step of an ability kind is valid for the slot and the fields, else the reason. Refuses reserved triggers, primitives, statuses and buff stats.';
comment on function public.ability_fields_check(jsonb) is 'F-3 4a: NULL when the fields object of an ability kind is well formed (types, limits, default), else the reason.';
comment on function public.ability_kinds_check() is 'F-3 4a: the trigger of ability_kinds: checks the fields, every step, latent, power and the squad rule, and sets updated_at.';
comment on function public.ability_check(jsonb) is 'F-3 4a: NULL when a subjects.ability value fits its kind (a NULL ability is fine), else the reason text that the studio shows.';
comment on function public.ability_ok(jsonb) is 'F-3 4a: true when ability_check finds no problem.';
comment on function public.ability_power(jsonb) is 'F-3 4a: the power cost of an ability (base + weights x values from ability_kinds.power). Reported only; no fight reads it.';
comment on function public.subjects_ability_check() is 'F-3 4a: the trigger of subjects: refuses a changed ability that ability_check refuses.';
comment on function public.ability_kinds_recheck() is 'F-3 4a: the statement trigger of ability_kinds: refuses a change after which a live ability would fail.';

notify pgrst, 'reload schema';
