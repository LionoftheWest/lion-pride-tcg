-- combat_v2_statuses_roles.sql (2026-10-18): combat v2, phase 1, PR E1 (docs/combat-redesign-plan.md sections 4, 6, 9.1 and 14).
-- Needs combat_v2_flags_balance.sql first (the v2_status, v2_roles and v2_speed numbers that the rows point to).
-- Before: the fight statuses are ad-hoc keys of the v1 fight state (cards: shield, buff, debuff, psn/psnu; enemies: wk/wku, ex/exu, st, enr/enru, sh).
-- No table names a status or a role.
-- After this file:
--   statuses: the 16 statuses of plan 6.1 (kind 'status') and the 2 enemy states that are also shown with an icon (kind 'enemy_state': enraged,
--     guarded). One row = key, label, family, negative, stacking rule, the balance leaf of its max stacks, the duration rule, the control immunity
--     group, the end state (Chill ends in Frozen), the icon key, where it applies (enemy, card), the balance object of its numbers and its one-line
--     rule. The rule text has NO number: each number is a {leaf} of its balance object (the statuses_check trigger refuses a digit or an unknown leaf).
--   roles: the 12 roles of plan 4 (6 attacker, 6 support). key, class, label, purpose, the passive text ({leaf} of balance v2_roles.<key>), the
--     balance object of the passive numbers, the balance leaf of the base speed (v2_speed.role_base.<key>), the icon key, the stat priority (3 of the
--     9 stats), the enemy problems it answers and the Auto hints. No number in the table either.
--   fight_state_check_v2(state): the shape check of a fight state v = 2 (plan 9.1): the v1 shape plus clock, and meter, charge and status{} on each
--     card and enemy; each status is a statuses row that applies to that side, with stacks / value / until only; the old v1 status keys are refused
--     in a v2 state (one home for each fact). An enemy may have cataclysm (a boolean: the v1 foe key charge, which v2 uses for the charge count).
--   fight_state_v2_from_v1(state): a PURE read-only view of a v1 state as v = 2: the old keys become statuses (enemy wk -> weakened, ex -> exposed,
--     st -> stunned, enr -> enraged, sh -> guarded; card shield -> shielded, buff -> empowered, debuff -> weakened, psn -> poison; the foe boolean
--     charge -> cataclysm), clock = round, meter 0, charge 0. Used by the tests now and by v2 later. No fight calls it.
-- NO CHANGE IN PLAY: no v1 function reads the new tables or calls the new functions; fight_state_check (v1) is not changed. The goldens, the shadow
-- test and fight-timing.mjs prove it (the PR text).
-- RLS on, no policy: the service role only (the Activity and the bot read through the server). Idempotent.
-- Test: card-studio/scripts/test-combat-v2-statuses.mjs (rolled back; MUTATE=all must catch every mutation).

-- ============================================================ 1. helpers: a balance path, and the {leaf} check of a text
-- balance_path('v2_status.poison.tick') = the JSON at that path of the balance key (NULL when the key or the path does not exist).
create or replace function public.balance_path(p_path text) returns jsonb language sql stable set search_path = public as $fn$
  select b.value #> coalesce((string_to_array(p_path, '.'))[2:], '{}'::text[]) from public.balance b where b.key = split_part(p_path, '.', 1);
$fn$;

-- The problems of a display text whose numbers come from balance: every {leaf} must be a number or a boolean leaf of the balance object p_numbers,
-- and the text must have no digit of its own (a number typed in a text goes wrong when balance changes). Empty = fine.
create or replace function public.balance_text_errors(p_text text, p_numbers text) returns text[] language plpgsql stable set search_path = public as $fn$
declare e text[] := '{}'; m text; obj jsonb;
begin
  if p_text is null or btrim(p_text) = '' then return array['the text is empty']; end if;
  if regexp_replace(p_text, '\{[a-z_]+\}', '', 'g') ~ '[0-9{}]' then e := e || 'the text has a digit or a brace outside a {leaf}'::text; end if;
  obj := case when p_numbers is null then null else balance_path(p_numbers) end;
  for m in select (regexp_matches(p_text, '\{([a-z_]+)\}', 'g'))[1] loop
    if obj is null or coalesce(jsonb_typeof(obj->m), 'missing') not in ('number', 'boolean') then
      e := e || format('{%s} is not a number of %s', m, coalesce(p_numbers, '(no numbers)'));
    end if;
  end loop;
  return e;
end $fn$;

-- ============================================================ 2. the statuses table
create table if not exists public.statuses (
  key text primary key check (key ~ '^[a-z_]+$'),
  ord smallint not null unique check (ord >= 1),
  kind text not null check (kind in ('status', 'enemy_state')),
  label text not null check (label <> '' and label = btrim(label)),
  family text not null check (family in ('dot', 'control', 'accuracy', 'tempo', 'vuln', 'boon')),
  negative boolean not null,
  stacking text not null check (stacking in ('none', 'add', 'add_cap', 'add_decay', 'higher')),
  max_stacks text check (max_stacks ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  duration text not null check (duration in ('steps', 'next_action', 'until_damaged', 'until_zero', 'until_used', 'next_attack', 'steps_or_attack')),
  immunity text check (immunity in ('control')),
  end_state text check (end_state ~ '^[a-z_]+$'),
  icon text not null check (icon ~ '^[a-z_]+$'),
  on_enemy boolean not null,
  on_card boolean not null,
  numbers text check (numbers ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  rule text not null,
  note text,
  updated_at timestamptz not null default now(),
  check (on_enemy or on_card),
  check ((stacking in ('add', 'add_decay')) = (max_stacks is not null) or kind = 'enemy_state'),
  check ((immunity is not null) = (family = 'control')),
  check (end_state is null or stacking = 'add')
);

create or replace function public.statuses_check() returns trigger language plpgsql set search_path = public as $fn$
declare e text[];
begin
  if new.numbers is not null and jsonb_typeof(balance_path(new.numbers)) is distinct from 'object' then
    raise exception 'statuses %: numbers % is not an object in balance', new.key, new.numbers;
  end if;
  if new.max_stacks is not null and (jsonb_typeof(balance_path(new.max_stacks)) is distinct from 'number' or (balance_path(new.max_stacks) #>> '{}')::numeric % 1 <> 0) then
    raise exception 'statuses %: max_stacks % is not a whole number in balance', new.key, new.max_stacks;
  end if;
  if new.duration in ('steps', 'until_damaged', 'steps_or_attack') and not coalesce(balance_path(new.numbers) ? 'dur' or balance_path(new.numbers) ? 'dur_card', false) then
    raise exception 'statuses %: a % duration needs dur or dur_card in %', new.key, new.duration, coalesce(new.numbers, '(no numbers)');
  end if;
  e := balance_text_errors(new.rule, new.numbers);
  if cardinality(e) > 0 then raise exception 'statuses %: rule: %', new.key, array_to_string(e, '; '); end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists statuses_check on public.statuses;
create trigger statuses_check before insert or update on public.statuses for each row execute function public.statuses_check();

alter table public.statuses enable row level security;
revoke all on public.statuses from public, anon, authenticated;
grant all on public.statuses to service_role;

insert into public.statuses (ord, key, kind, label, family, negative, stacking, max_stacks, duration, immunity, end_state, icon, on_enemy, on_card, numbers, rule, note) values
( 1, 'poison',    'status', 'Poison',         'dot',      true,  'add',       'v2_status.poison.burst_at', 'steps',           null,      null,     'skull_drop',  true,  true,  'v2_status.poison',
  'Each stack ticks {tick} of ref HP at step end. Stack {burst_at} bursts for {burst} of ref HP, then Poison resets. Ignores shields.', 'Toxic. Ref HP = the foe max HP in the Dungeon, v2_status.hunt_ref_hp in the Hunt.'),
( 2, 'burn',      'status', 'Burn',           'dot',      true,  'add_decay', 'v2_status.burn.max',        'until_zero',      null,      null,     'flame',       true,  true,  'v2_status.burn',
  'Each stack ticks {tick_x} x the Poison tick, then loses {decay} stack. A Burning unit heals x{heal_x}. x{vs_healer_x} vs a healer. Ignores shields.', 'Wildfire. The anti-heal counter.'),
( 3, 'stunned',   'status', 'Stunned',        'control',  true,  'none',      null,                        'next_action',     'control', null,     'spiral',      true,  true,  'v2_status.stunned',
  'Skips its next action.', 'max_life / max_life_card = the safety limit in steps. Shares the one control immunity (v2_control).'),
( 4, 'chill',     'status', 'Chill / Frozen', 'control',  true,  'add',       'v2_status.chill.freeze_at', 'steps',           'control', 'frozen', 'snowflake',   true,  true,  'v2_status.chill',
  'Each stack: -{dmg} damage and -{spd} speed. At {freeze_at} stacks: Frozen (skips its next action), then Chill clears.', 'Chill and Frozen count as one status (plan 6.1); Frozen is its end state (numbers v2_status.frozen) and shares the control immunity. config.json gives Chill the family tempo and Frozen the family control: the row follows the plan (Control).'),
( 5, 'sleep',     'status', 'Sleep',          'control',  true,  'none',      null,                        'until_damaged',   'control', null,     'moon',        true,  true,  'v2_status.sleep',
  'Skips actions until it takes damage.', 'dur / dur_card = the most steps it can last.'),
( 6, 'paralyzed', 'status', 'Paralyzed',      'control',  true,  'none',      null,                        'steps',           'control', null,     'bolt',        true,  true,  'v2_status.paralyzed',
  'Each action fails with chance {fail}.', 'Electric sources.'),
( 7, 'blinded',   'status', 'Blinded',        'accuracy', true,  'none',      null,                        'steps',           null,      null,     'closed_eye',  true,  true,  'v2_status.blinded',
  '+{miss} miss chance.', null),
( 8, 'confused',  'status', 'Confused',       'accuracy', true,  'none',      null,                        'steps',           null,      null,     'swirl',       true,  true,  'v2_status.confused',
  'A share of {chance} of its single attacks hit a wrong target.', null),
( 9, 'slowed',    'status', 'Slowed',         'tempo',    true,  'none',      null,                        'steps',           null,      null,     'snail',       true,  true,  'v2_status.slowed',
  'Speed x{x}.', 'Counters Speed.'),
(10, 'quickened', 'status', 'Quickened',      'tempo',    false, 'none',      null,                        'steps',           null,      null,     'wing',        true,  true,  'v2_status.quickened',
  'Speed x{x}.', null),
(11, 'exposed',   'status', 'Exposed',        'vuln',     true,  'add_cap',   null,                        'steps',           null,      null,     'cracked_eye', true,  true,  'v2_status.exposed',
  'Takes more damage from every source, ticks included, up to +{cap}.', null),
(12, 'weakened',  'status', 'Weakened',       'vuln',     true,  'add_cap',   null,                        'steps',           null,      null,     'down_arrow',  true,  true,  'v2_status.weakened',
  'Deals less damage, up to -{cap}. Replaces the card Curse.', 'The enemy weaken and the card curse of v1 are this one status.'),
(13, 'mark',      'status', 'Mark',           'vuln',     true,  'higher',    null,                        'steps_or_attack', null,      null,     'target',      true,  false, 'v2_status.mark',
  'The next attack on it deals more, cannot miss and can crit an Ironhide enemy. Then it ends.', 'The higher value stays.'),
(14, 'shielded',  'status', 'Shielded',       'boon',     false, 'add_cap',   null,                        'until_used',      null,      null,     'shield',      false, true,  'v2_status.shielded',
  'Absorbs damage before HP, up to {cap_maxhp} x max HP.', 'A foe shield is the enemy state guarded.'),
(15, 'empowered', 'status', 'Empowered',      'boon',     false, 'higher',    null,                        'next_attack',     null,      null,     'up_arrow',    false, true,  'v2_status.empowered',
  'The next attack deals more, up to +{cap}.', 'The higher value stays (a proposal).'),
(16, 'focused',   'status', 'Focused',        'boon',     false, 'none',      null,                        'steps',           null,      null,     'crosshair',   false, true,  'v2_status.focused',
  'More crit chance for {dur} steps.', null),
(17, 'enraged',   'enemy_state', 'Enraged',   'boon',     false, 'none',      null,                        'steps',           null,      null,     'enraged',     true,  false, 'v2_status.enraged',
  'Deals x{x} damage for {dur} steps.', 'An enemy state shown with an icon (plan 6.1), not one of the 16 statuses. Volatile shows as a permanent Enraged mark.'),
(18, 'guarded',   'enemy_state', 'Guarded',   'boon',     false, 'add',       null,                        'until_used',      null,      null,     'guarded',     true,  false, null,
  'A foe shield: absorbs damage before HP.', 'An enemy state shown with an icon (plan 6.1), not one of the 16 statuses. Its amount comes from the foe Guard move (balance pool_moves.guard).')
on conflict (key) do nothing;

-- ============================================================ 3. the roles table
create table if not exists public.roles (
  key text primary key check (key ~ '^[a-z_]+$'),
  ord smallint not null unique check (ord >= 1),
  class text not null check (class in ('attacker', 'support')),
  label text not null check (label <> '' and label = btrim(label)),
  purpose text not null check (purpose <> '' and purpose !~ '[0-9]'),
  passive text not null,
  numbers text not null check (numbers ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  speed text not null check (speed ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  icon text not null check (icon ~ '^[a-z_]+$'),
  stat_priority text[] not null check (cardinality(stat_priority) = 3),
  answers text[] not null check (cardinality(answers) between 1 and 8),
  auto jsonb not null check (jsonb_typeof(auto) = 'object'),
  note text,
  updated_at timestamptz not null default now()
);

create or replace function public.roles_check() returns trigger language plpgsql set search_path = public as $fn$
declare e text[]; s text;
begin
  if jsonb_typeof(balance_path(new.numbers)) is distinct from 'object' then raise exception 'roles %: numbers % is not an object in balance', new.key, new.numbers; end if;
  if jsonb_typeof(balance_path(new.speed)) is distinct from 'number' then raise exception 'roles %: speed % is not a number in balance', new.key, new.speed; end if;
  foreach s in array new.stat_priority loop
    if not coalesce(balance_path('v2_stats') ? s, false) or s = 'max_per_stat' then raise exception 'roles %: % is not one of the 9 stats (balance v2_stats)', new.key, s; end if;
  end loop;
  if (select count(distinct x) from unnest(new.stat_priority) x) <> cardinality(new.stat_priority) then raise exception 'roles %: a stat is twice in stat_priority', new.key; end if;
  if exists (select 1 from unnest(new.answers) x where x !~ '^[a-z0-9_]+$') then raise exception 'roles %: each answer is a lower case word (a-z, 0-9, _)', new.key; end if;
  if exists (select 1 from jsonb_object_keys(new.auto) k where k not in ('target', 'hold_for'))
     or coalesce(new.auto->>'target', '') not in ('enemy', 'ally')
     or (new.auto ? 'hold_for' and new.auto->>'hold_for' is distinct from 'charging') then
    raise exception 'roles %: auto must be {target: enemy|ally, hold_for?: charging}', new.key;
  end if;
  e := balance_text_errors(new.passive, new.numbers);
  if cardinality(e) > 0 then raise exception 'roles %: passive: %', new.key, array_to_string(e, '; '); end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists roles_check on public.roles;
create trigger roles_check before insert or update on public.roles for each row execute function public.roles_check();

alter table public.roles enable row level security;
revoke all on public.roles from public, anon, authenticated;
grant all on public.roles to service_role;

insert into public.roles (ord, key, class, label, purpose, passive, numbers, speed, icon, stat_priority, answers, auto) values
( 1, 'breaker',    'attacker', 'Breaker',    'Hit through defenses.',
  'Hits ignore {pierce} of Defense and deal x{shield_x} to shields.', 'v2_roles.breaker', 'v2_speed.role_base.breaker', 'breaker',
  '{atk,crt,hp}', '{defense,guard,armored,bulwark,shields}', '{"target": "enemy"}'),
( 2, 'striker',    'attacker', 'Striker',    'Turn a weak point into a big hit.',
  '+{crit_add} crit chance and +{critx_add} crit damage.', 'v2_roles.striker', 'v2_speed.role_base.striker', 'striker',
  '{atk,hp,crt}', '{weak_points,big_hp,dispeller}', '{"target": "enemy"}'),
( 3, 'flurry',     'attacker', 'Flurry',     'Steady damage that outruns heals.',
  'Each basic attack has a {extra_chance} chance of a second strike at {extra_x}.', 'v2_roles.flurry', 'v2_speed.role_base.flurry', 'flurry',
  '{hp,atk,spd}', '{boss_heals,regrowth,drain,regenerate,guard}', '{"target": "enemy"}'),
( 4, 'finisher',   'attacker', 'Finisher',   'End a fight before the enemy grows.',
  '+{bonus} damage to a target below {line} HP.', 'v2_roles.finisher', 'v2_speed.role_base.finisher', 'finisher',
  '{atk,hp,crt}', '{frenzied,rage,phase_two,late_heals}', '{"target": "enemy"}'),
( 5, 'survivor',   'attacker', 'Survivor',   'Stay up against enemies that hurt attackers.',
  'Heals {lifesteal} of the damage it deals (max {cap_maxhp} of its max HP a hit).', 'v2_roles.survivor', 'v2_speed.role_base.survivor', 'survivor',
  '{atk,spd,crt}', '{thorns,flaming,plague,support_counters}', '{"target": "enemy"}'),
( 6, 'cleaver',    'attacker', 'Cleaver',    'Hit many foes.',
  'Basic attacks also hit every other foe for {splash}. Hunt: +{hunt_bonus} damage, and an area active adds {hunt_area_x} of its area value.', 'v2_roles.cleaver', 'v2_speed.role_base.cleaver', 'cleaver',
  '{atk,hp,spd}', '{horde,swarm,brood}', '{"target": "enemy"}'),
( 7, 'warden',     'support',  'Warden',     'Absorb the big hits.',
  'Allies take {ally_dr} less damage while it stands. Enemies pick it x{taunt_w} as often.', 'v2_roles.warden', 'v2_speed.role_base.warden', 'warden',
  '{hp,spd,abl}', '{cataclysm,volatile,enraged,heavy_hits,hits_on_supports}', '{"target": "ally"}'),
( 8, 'medic',      'support',  'Medic',      'Undo damage and clear statuses.',
  'After each of its actions, heals the most hurt ally for {heal_after} of its max HP.', 'v2_roles.medic', 'v2_speed.role_base.medic', 'medic',
  '{spd,ddg,atk}', '{weakened,poison,burn,venom,thorns}', '{"target": "ally"}'),
( 9, 'controller', 'support',  'Controller', 'Make the enemy weaker or slower.',
  'Its debuffs ignore {resolve_ignore} of enemy resolve and last {dur_add} step longer.', 'v2_roles.controller', 'v2_speed.role_base.controller', 'controller',
  '{spd,hp,def}', '{enraged,rage,volatile,cataclysm,fast_foes}', '{"target": "enemy", "hold_for": "charging"}'),
(10, 'spotter',    'support',  'Spotter',    'Make the enemy take more from everyone.',
  'Its basic attack Exposes the target {basic_expose} for {basic_expose_dur} steps.', 'v2_roles.spotter', 'v2_speed.role_base.spotter', 'spotter',
  '{spd,abl,crt}', '{resist,big_hp,heals,shrouded}', '{"target": "enemy"}'),
(11, 'herald',     'support',  'Herald',     'Make the right attacker hit much harder.',
  'Its basic attack also Empowers the strongest attacker +{basic_empower}.', 'v2_roles.herald', 'v2_speed.role_base.herald', 'herald',
  '{abl,spd,hp}', '{weak_points,armored,resist,few_support_plays}', '{"target": "ally"}'),
(12, 'artillery',  'support',  'Artillery',  'Damage with no attack roll.',
  'Its basic attack deals {basic_x} x CP and cannot miss.', 'v2_roles.artillery', 'v2_speed.role_base.artillery', 'artillery',
  '{abl,hp,spd}', '{shrouded,dodge,thorns,hordes}', '{"target": "enemy"}')
on conflict (key) do nothing;

-- ============================================================ 4. the fight state v = 2: the checker and the read-only view of a v1 state
-- The shape check of a fight state v = 2 (plan 9.1): the problems (empty = fine). The v1 rules (fight_state_check) on the same state seen as v1, plus
-- clock (a whole number of 0 or more), and on each card and enemy: meter (a number of 0 or more), charge (a whole number of 0 or more), status (an
-- object: each key a statuses row that applies to that side; each value an object with only stacks (a whole number of 1 or more), value (a number of 0
-- or more) and until (a whole number of 0 or more)); cataclysm, when there, is a boolean of an enemy. The v1 status keys (cards: shield, buff, debuff, psn, psnu; enemies: wk, wku, ex, exu, st, enr,
-- enru, sh) are refused in a v2 state: a status has one home, status{}.
create or replace function public.fight_state_check_v2(p jsonb) returns text[] language plpgsql stable set search_path = public as $fn$
declare v text[] := '{}'; e record; s record; side text; k text; unit jsonb; at text;
  old_card text[] := array['shield', 'buff', 'debuff', 'psn', 'psnu'];
  old_enemy text[] := array['wk', 'wku', 'ex', 'exu', 'st', 'enr', 'enru', 'sh'];
begin
  if jsonb_typeof(p) is distinct from 'object' then return array['the fight state must be an object']; end if;
  if jsonb_typeof(p->'v') is distinct from 'number' or p->>'v' <> '2' then v := v || 'v must be 2'::text; end if;   -- the shape version (a string test: not a combat number)
  if jsonb_typeof(p->'clock') is distinct from 'number' or (p->>'clock')::numeric < 0 or (p->>'clock')::numeric % 1 <> 0 then
    v := v || 'clock must be a whole number of 0 or more'::text;
  end if;
  -- the v1 rules (keys, mode, round, squad, marks, ext, facts, HP of cards and enemies) on the state seen as v1
  v := v || fight_state_check((p - 'clock') || jsonb_build_object('v', 1));
  for side, unit, at in
      select 'card', c.value, 'card ' || c.key from jsonb_each(case when jsonb_typeof(p->'cards') = 'object' then p->'cards' else '{}'::jsonb end) c
      union all
      select 'enemy', x.value, 'enemy ' || (x.o - 1) from jsonb_array_elements(case when jsonb_typeof(p->'enemies') = 'array' then p->'enemies' else '[]'::jsonb end) with ordinality x(value, o) loop
    if jsonb_typeof(unit) is distinct from 'object' then continue; end if;
    if jsonb_typeof(unit->'meter') is distinct from 'number' or (unit->>'meter')::numeric < 0 then v := v || format('%s: meter must be a number of 0 or more', at); end if;
    if jsonb_typeof(unit->'charge') is distinct from 'number' or (unit->>'charge')::numeric < 0 or (unit->>'charge')::numeric % 1 <> 0 then
      v := v || format('%s: charge must be a whole number of 0 or more', at);
    end if;
    if unit ? 'cataclysm' and (side <> 'enemy' or jsonb_typeof(unit->'cataclysm') is distinct from 'boolean') then
      v := v || format('%s: cataclysm (the foe charges a Cataclysm) must be true or false, on an enemy only', at);
    end if;
    foreach k in array case when side = 'card' then old_card else old_enemy end loop
      if unit ? k then v := v || format('%s: the v1 key %s is a status in v2 (status{})', at, k); end if;
    end loop;
    if jsonb_typeof(unit->'status') is distinct from 'object' then v := v || format('%s: status must be an object', at); continue; end if;
    for s in select x.key, x.value, t.key is not null as known, case when side = 'card' then t.on_card else t.on_enemy end as fits
               from jsonb_each(unit->'status') x left join public.statuses t on t.key = x.key loop
      if not s.known then v := v || format('%s: unknown status %s', at, s.key); continue; end if;
      if not s.fits then v := v || format('%s: the status %s does not apply to a %s', at, s.key, side); end if;
      if jsonb_typeof(s.value) is distinct from 'object' or exists (select 1 from jsonb_object_keys(s.value) y where y not in ('stacks', 'value', 'until')) then
        v := v || format('%s: status %s must be an object with stacks, value or until', at, s.key); continue;
      end if;
      if s.value ? 'stacks' and (jsonb_typeof(s.value->'stacks') is distinct from 'number' or (s.value->>'stacks')::numeric < 1 or (s.value->>'stacks')::numeric % 1 <> 0) then
        v := v || format('%s: status %s stacks must be a whole number of 1 or more', at, s.key);
      end if;
      if s.value ? 'value' and (jsonb_typeof(s.value->'value') is distinct from 'number' or (s.value->>'value')::numeric < 0) then
        v := v || format('%s: status %s value must be a number of 0 or more', at, s.key);
      end if;
      if s.value ? 'until' and (jsonb_typeof(s.value->'until') is distinct from 'number' or (s.value->>'until')::numeric < 0 or (s.value->>'until')::numeric % 1 <> 0) then
        v := v || format('%s: status %s until must be a whole number of 0 or more', at, s.key);
      end if;
    end loop;
  end loop;
  return v;
end $fn$;

-- The read-only view of a v1 fight state (hunt_fight_state / dungeon_fight_state) as v = 2. PURE: it reads no table and changes nothing.
-- A timed v1 key is a status while its value is active (as v1 reads it: a weaken or an expose above 0, an enrage above 0 and not 1, a stun round above
-- 0, poison damage above 0) and its "until" round is not below the state round; "until" is kept as the v1 round. cd (the v1 cooldown) stays a card key:
-- v2 replaces it by charge. The v1 foe key charge (a boolean: the foe charges a Cataclysm) becomes cataclysm, because charge in v2 is the active
-- charge count of every unit (one word, one meaning). clock = round; meter and charge start at 0. The other keys stay as they are.
create or replace function public.fight_state_v2_from_v1(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $fn$
declare r int := coalesce((p->>'round')::int, 0); cards jsonb := '{}'::jsonb; foes jsonb := '[]'::jsonb; k text; u jsonb; s jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->'v' is distinct from '1'::jsonb then
    raise exception 'fight_state_v2_from_v1: the state must be a v 1 fight state';
  end if;
  for k, u in select c.key, c.value from jsonb_each(coalesce(p->'cards', '{}'::jsonb)) c loop
    s := '{}'::jsonb;
    if coalesce((u->>'shield')::numeric, 0) > 0 then s := s || jsonb_build_object('shielded', jsonb_build_object('value', u->'shield')); end if;
    if coalesce((u->>'buff')::numeric, 1) > 1 then s := s || jsonb_build_object('empowered', jsonb_build_object('value', (u->>'buff')::numeric - 1)); end if;
    if coalesce((u->>'debuff')::numeric, 1) < 1 then s := s || jsonb_build_object('weakened', jsonb_build_object('value', 1 - (u->>'debuff')::numeric)); end if;
    if coalesce((u->>'psn')::numeric, 0) > 0 and coalesce((u->>'psnu')::int, -1) >= r then
      s := s || jsonb_build_object('poison', jsonb_build_object('value', u->'psn', 'until', u->'psnu'));
    end if;
    cards := cards || jsonb_build_object(k, (u - array['shield', 'buff', 'debuff', 'psn', 'psnu']) || jsonb_build_object('meter', 0, 'charge', 0, 'status', s));
  end loop;
  for u in select x from jsonb_array_elements(coalesce(p->'enemies', '[]'::jsonb)) x loop
    s := '{}'::jsonb;
    if coalesce((u->>'wk')::numeric, 0) > 0 and coalesce((u->>'wku')::int, -1) >= r then
      s := s || jsonb_build_object('weakened', jsonb_build_object('value', u->'wk', 'until', u->'wku'));
    end if;
    if coalesce((u->>'ex')::numeric, 0) > 0 and coalesce((u->>'exu')::int, -1) >= r then
      s := s || jsonb_build_object('exposed', jsonb_build_object('value', u->'ex', 'until', u->'exu'));
    end if;
    if coalesce((u->>'st')::int, 0) > 0 and (u->>'st')::int >= r then s := s || jsonb_build_object('stunned', jsonb_build_object('until', u->'st')); end if;
    if coalesce((u->>'enr')::numeric, 0) > 0 and (u->>'enr')::numeric <> 1 and coalesce((u->>'enru')::int, -1) >= r then
      s := s || jsonb_build_object('enraged', jsonb_build_object('value', u->'enr', 'until', u->'enru'));
    end if;
    if coalesce((u->>'sh')::numeric, 0) > 0 then s := s || jsonb_build_object('guarded', jsonb_build_object('value', u->'sh')); end if;
    -- the v1 foe key charge (true = the foe charges a Cataclysm) is cataclysm in v2: charge is the active charge count of every unit (plan 9.1)
    foes := foes || jsonb_build_array((u - array['wk', 'wku', 'ex', 'exu', 'st', 'enr', 'enru', 'sh', 'charge'])
      || case when u ? 'charge' then jsonb_build_object('cataclysm', u->'charge') else '{}'::jsonb end
      || jsonb_build_object('meter', 0, 'charge', 0, 'status', s));
  end loop;
  return p || jsonb_build_object('v', '2'::jsonb, 'clock', r, 'cards', cards, 'enemies', foes);
end $fn$;

-- ============================================================ 5. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['balance_path(text)', 'balance_text_errors(text, text)', 'statuses_check()', 'roles_check()', 'fight_state_check_v2(jsonb)',
                           'fight_state_v2_from_v1(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on table public.statuses is $cm$[combat] Combat v2: the 16 statuses of plan 6.1 (kind status) and the 2 enemy states shown with an icon (kind enemy_state: enraged, guarded), one row each (combat_v2_statuses_roles.sql). The numbers are in balance (numbers, max_stacks), never in the row: the rule text names them as {leaf}. The trigger statuses_check refuses a balance path that does not exist and a digit in the rule. No v1 fight reads it; fight_state_check_v2 reads the keys and where each applies. Server only.$cm$;
comment on column public.statuses.key is 'The status key in a v2 fight state (status{} of a card or an enemy), lower case, for example poison.';
comment on column public.statuses.ord is 'The fixed display order (the icon slots never move on a status change, plan 6.2).';
comment on column public.statuses.kind is 'status (one of the 16 statuses of plan 6.1) or enemy_state (Enraged and Guarded: enemy states also shown with an icon).';
comment on column public.statuses.label is 'The name shown to players, for example Poison. Chill and Frozen are one status: Chill / Frozen.';
comment on column public.statuses.family is 'The family (plan 6.1): dot (damage over time), control, accuracy, tempo, vuln (vulnerability) or boon.';
comment on column public.statuses.negative is 'True for a harmful status (Medic cleanse and Purify remove these; v2_status.negative of the simulator).';
comment on column public.statuses.stacking is 'none (no stacks), add (stacks add), add_cap (values add up to a cap in balance), add_decay (stacks add and fall each step), higher (the higher value stays).';
comment on column public.statuses.max_stacks is 'The balance leaf that limits the stacks of an add / add_decay status, for example v2_status.burn.max (Poison bursts and Chill freezes at that count). NULL with no stack limit.';
comment on column public.statuses.duration is 'How it ends: steps (dur / dur_card clock steps), next_action, until_damaged, until_zero (stacks fall to 0), until_used (a shield), next_attack, steps_or_attack.';
comment on column public.statuses.immunity is 'control: Stunned, Chill / Frozen, Sleep and Paralyzed share ONE control immunity after they end (balance v2_control). NULL for the others.';
comment on column public.statuses.end_state is 'The state a status turns into at its max stacks: frozen for Chill (numbers in balance v2_status.frozen). NULL for the others.';
comment on column public.statuses.icon is 'The icon key of the visual language set (plan 13.1; the icons are designed later).';
comment on column public.statuses.on_enemy is 'True when an enemy can have it.';
comment on column public.statuses.on_card is 'True when a card can have it.';
comment on column public.statuses.numbers is 'The balance object with its numbers, for example v2_status.poison (dur = steps on an enemy, dur_card = on a card). NULL for guarded (the foe Guard move of v1).';
comment on column public.statuses.rule is 'The one-line rule shown on tap. No digit: each number is a {leaf} of the numbers object (statuses_check).';
comment on column public.statuses.note is 'A note for the designers (sources, links to other rules).';
comment on column public.statuses.updated_at is 'The last change of the row.';
comment on table public.roles is $cm$[combat] Combat v2: the 12 roles of plan 4 (6 attacker, 6 support), one row each (combat_v2_statuses_roles.sql). A card holds its role as the tag role:<key> (a designer-set tag, plan 2.1). The passive numbers (v2_roles.<key>) and the base speed (v2_speed.role_base.<key>) are in balance; the passive text names them as {leaf}. The trigger roles_check refuses a balance path that does not exist, a stat that is not one of the 9 stats and a digit in the passive. No v1 fight reads it. Server only.$cm$;
comment on column public.roles.key is 'The role key (the card tag role:<key>), lower case, for example breaker.';
comment on column public.roles.ord is 'The fixed display order: the 6 attacker roles, then the 6 support roles.';
comment on column public.roles.class is 'attacker or support. The card type decides the class: only Character and Creature attack (plan 2.1).';
comment on column public.roles.label is 'The name shown to players, for example Breaker.';
comment on column public.roles.purpose is 'The job of the role in one line (plan 4). No digit.';
comment on column public.roles.passive is 'The role passive in one line, the same for every card of the role. Each number is a {leaf} of the numbers object (roles_check).';
comment on column public.roles.numbers is 'The balance object with the passive numbers: v2_roles.<key>.';
comment on column public.roles.speed is 'The balance leaf of the base speed of the role: v2_speed.role_base.<key>.';
comment on column public.roles.icon is 'The icon key of the visual language set (plan 13.1; the icons are designed later).';
comment on column public.roles.stat_priority is 'The 3 stats with the best measured value for this role, best first (plan 4; keys of balance v2_stats: atk, def, hp, crd, crt, abl, ddg, acc, spd).';
comment on column public.roles.answers is 'The enemy problems this role answers (plan 4, "Enemy problems it answers"), as lower case words. A hint for Auto and the squad picker.';
comment on column public.roles.auto is 'Auto hints: {target: enemy|ally (whom the active usually targets), hold_for?: charging (hold the active for a Charging enemy)}. Read by Auto v2 (PR E8).';
comment on column public.roles.note is 'A note for the designers.';
comment on column public.roles.updated_at is 'The last change of the row.';
comment on function public.balance_path(text) is $cm$[combat] The JSON at a balance path ('<key>.<leaf>.<leaf>'), NULL when the key or the path does not exist. combat_v2_statuses_roles.sql.$cm$;
comment on function public.balance_text_errors(text, text) is $cm$[combat] The problems of a display text whose numbers come from balance: each {leaf} must be a number or a boolean of the balance object p_numbers, and the text has no digit of its own. Empty = fine.$cm$;
comment on function public.statuses_check() is $cm$Trigger (before insert, update on statuses): numbers is a balance object, max_stacks a whole number in balance, a timed status has dur or dur_card, the rule passes balance_text_errors; sets updated_at.$cm$;
comment on function public.roles_check() is $cm$Trigger (before insert, update on roles): numbers is a balance object, speed a balance number, stat_priority has 3 different stats of v2_stats, answers are words, auto is {target, hold_for?}, the passive passes balance_text_errors; sets updated_at.$cm$;
comment on function public.fight_state_check_v2(jsonb) is $cm$[combat] The shape check of a fight state v = 2 (plan 9.1): the v1 rules plus clock, and meter, charge and status{} on each card and enemy (known statuses that apply to that side; stacks, value, until only). The v1 status keys are refused in a v2 state. The list of problems (empty = fine). Used by the tests; v2 later.$cm$;
comment on function public.fight_state_v2_from_v1(jsonb) is $cm$[combat] A pure read-only view of a v1 fight state as v = 2: enemy wk, ex, st, enr, sh and card shield, buff, debuff, psn become statuses (weakened, exposed, stunned, enraged, guarded, shielded, empowered, weakened, poison) while active; the foe boolean charge becomes cataclysm (charge is the v2 charge count); clock = round; meter and charge 0. No fight calls it.$cm$;

notify pgrst, 'reload schema';
