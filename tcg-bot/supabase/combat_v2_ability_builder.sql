-- combat_v2_ability_builder.sql (2026-10-20): combat v2, phase 3, PR T1: the new ability blocks of 2026-10-20 and the storage of a v2 ability
-- (docs/combat-redesign-plan.md sections 5, 9.1, 12.1 and 14; Nathan's decisions of 2026-10-20 in section 19.3).
-- Needs combat_v2_abilities.sql (E6) first, and so E5 to E1 and V1.
-- Before: the validator (E6) refuses the reserved parts (on_kill, self_has, enemy_charging, foes_alive, self_shield), and about 30 of the approved Set 1
-- actives run as approximations (the most hurt ally, "twice as much below an HP line", support payoffs, "for each" scalers, one random status, a status list).
-- After this file (the reference is the simulator card-studio/v2sim: cards.mjs blockPP, engine.mjs doActive; the shares: v2sim/shares.mjs):
--   BALANCE ability_v2: + share (on_kill, enemy_charging, foes_alive, self_shield, self_has: measured by the simulator, run.mjs shares) and ref.per_ally
--     (the mean number of other standing attackers at an attacker active). Added only while the key has no share (a second run keeps a changed value).
--   THE BLOCK LIBRARY ability_blocks: two new columns, attach (gate | amount: the block is an ATTACHMENT, it changes the block right before it, its host)
--     and hosts (the blocks it may follow). The 5 reserved rows are built, 6 new rows, and 11 E6 rows take a new field:
--     * on_kill (decision 1): a trigger like on_crit: after a main hit, when the target is down, a chance to put the status on the next standing enemy.
--       Price = status x chance x share.on_kill / C. It counts as a rider. Attackers only (on_crit is attackers only).
--     * the gates self_has {status}, enemy_charging, foes_alive (2 or more enemies stand), self_shield (decision 2): the host works only while the
--       condition holds. Price = the host x (share - 1), so the pair costs the host x the share (plan 5.2 "raw price x the share where it is true").
--     * random_apply {options, chance} (decision 3): one random status of 2 to 6 options. Price = the mean of the options (x chance). One rider.
--     * the parts of the approximated Set 1 actives (decision 4): the target field "to" (most_hurt = the lowest HP share, strongest = the attacker with
--       the most power) on shield, heal, empower, focus, quicken and lifesteal (same price); target_has {status | statuses, x} (the host x times while
--       the enemy has the status; price = host x (x - 1) x payoff, x frozen_share for a control list); ally_below {line, x} (the host x times while its
--       ally is below the line; price = host x (x - 1) x line); more_per {v, status?} (+v for each stack of the status, or each other harmful status, on
--       the enemy; price = the host at v x ref.stacks (or ref.kinds) x payoff); coin {alt, chance} (the host amount is its own with the chance, else alt;
--       price = the mean); apply per (a value x the count of stacks or statuses on the enemy; price = status x value x (the count this active adds +
--       ref x payoff)); per_ally {v} (+v damage for each other standing attacker; price = att_k / C x v x ref.per_ally); the field statuses (a list,
--       "any of") on payoff_dmg, payoff_crit and vs_status (priced as one status, as the approved batches); payoff_dmg and crit_add on a support (they
--       shape its smite: price = smite x v x payoff, and smite x x x v x (crd.base - 1)).
--   ability_v2_pps(class, blocks, numbers): the PP of each block (an attachment and a support crit_add or apply per read the other blocks).
--     ability_v2_pp = its sum. REPLACED from E6 (each answers the E6 answer for an E6 ability): ability_v2_spec, ability_v2_field_types,
--     ability_v2_field_error, ability_v2_numbers (+ v2_stats, the status immunity group, attach and hosts), ability_v2_block_pp, ability_v2_pp,
--     ability_v2_text, ability_v2_silver_text, ability_v2_check, combat_v2_action_numbers (+ attach) and combat_effect_v2_active.
--   THE CARD TEXT: the patterns of the new rows (the card text style; the 5 differences of E6 are accepted, decision 5).
--   THE STORAGE subjects.ability_v2 (plan 9.1): {role, name, blocks, silver}, NULL = none. A write must pass ability_v2_check (trigger). The role is in
--     the value, not in a tag: a tag role:<key> would change subjects.tag_slugs, which v1 combat reads (the flag OFF must change nothing).
-- NO CHANGE IN PLAY: no v1 function calls a new or replaced function or reads ability_v2, the flag stays OFF, and no v1 function changes (the test
-- compares the md5 of every other public function). Every number is in balance (C1: only 0 and 1 in the bodies of the combat_ functions). Idempotent.
-- Server only. Test: card-studio/scripts/test-combat-v2-t1.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- ============================================================ 1. balance: ability_v2 share and ref
-- @balance-begin
create or replace function public.ability_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"pp": {"att_k": "num 1 200", "sup_cycle": "num 0.5 10", "sup_vs_k": "num 0 20", "line_status": "num 0 5", "quicken_all_x": "num 1 5"},
           "silver": {"stars": "int 1 5", "pp": "num 0 10"},
           "limits": {"blocks": "int 1 8", "riders": "int 0 4", "words_min": "int 1 40", "words_max": "int 1 60"},
           "k1_shield": "num 0 1",
           "share": {"on_kill": "num 0 1", "enemy_charging": "num 0 1", "foes_alive": "num 0 1", "self_shield": "num 0 1", "self_has": "num 0 1"},
           "ref": {"per_ally": "num 0 10"}}'::jsonb;
$fn$;

select set_config('balance.by', 'nathan', true);
update public.balance set value = value || '{"share": {"on_kill": 0.02, "enemy_charging": 0.08, "foes_alive": 0.09, "self_shield": 0.21, "self_has": 0.1}, "ref": {"per_ally": 2.4}}'::jsonb,
  note = note || $n$ share (PR T1, Nathan 2026-10-20 decisions 1 and 2; measured by card-studio/v2sim/run.mjs shares, 2000 runs, seed 1) = the share of the actives where a condition is true: a gate (self_has, enemy_charging, foes_alive, self_shield) costs its host x (share - 1), so the pair costs the host x the share; on_kill = an attacker active downs its target while another enemy stands (the trigger costs like on_crit with this share). ref.per_ally = the mean number of other standing attackers at an attacker active (the scaler per_ally).$n$
 where key = 'ability_v2' and not value ? 'share';
-- @balance-end

-- ============================================================ 2. the field types (new: to_shield, to_ally, status_card, status_options, per_count)
create or replace function public.ability_v2_field_types() returns text[] language sql immutable set search_path = public as $fn$
  select array['num_pos', 'num_x', 'num_nonneg', 'share', 'int_pos', 'int_many', 'int_nonneg', 'flag', 'status_rider', 'status_enemy', 'status_stack',
               'status_decay', 'status_list', 'cure_list', 'to_cured', 'to_shield', 'to_ally', 'status_card', 'status_options', 'per_count'];
$fn$;

create or replace function public.ability_v2_field_error(p_type text, p_v jsonb, p_st jsonb) returns text language plpgsql immutable set search_path = public as $fn$
declare n numeric; s text; e text; o jsonb;
begin
  if p_type in ('num_pos', 'num_x', 'num_nonneg', 'share', 'int_pos', 'int_many', 'int_nonneg') then
    if jsonb_typeof(p_v) is distinct from 'number' then return 'must be a number'; end if;
    n := (p_v #>> '{}')::numeric;
    if p_type in ('int_pos', 'int_many', 'int_nonneg') and n % 1 <> 0 then return 'must be a whole number'; end if;
    return case p_type
      when 'num_pos' then case when n <= 0 then 'must be above 0' end
      when 'num_x' then case when n <= 1 then 'must be above 1' end
      when 'num_nonneg' then case when n < 0 then 'must be 0 or more' end
      when 'share' then case when n <= 0 or n > 1 then 'must be above 0 and at most 1' end
      when 'int_pos' then case when n < 1 then 'must be 1 or more' end
      when 'int_many' then case when n <= 1 then 'must be more than 1' end
      when 'int_nonneg' then case when n < 0 then 'must be 0 or more' end end;
  elsif p_type = 'flag' then
    return case when jsonb_typeof(p_v) is distinct from 'boolean' then 'must be true or false' end;
  elsif p_type = 'to_cured' then
    return case when p_v is distinct from '"cured"'::jsonb then 'must be "cured" (the ally of the cure block)' end;
  elsif p_type = 'to_shield' then
    return case when jsonb_typeof(p_v) is distinct from 'string' or p_v #>> '{}' not in ('cured', 'most_hurt', 'strongest')
                then 'must be "cured" (the ally of the cure block), "most_hurt" or "strongest"' end;
  elsif p_type = 'to_ally' then
    return case when jsonb_typeof(p_v) is distinct from 'string' or p_v #>> '{}' not in ('most_hurt', 'strongest')
                then 'must be "most_hurt" (the lowest HP share) or "strongest" (the attacker with the most power)' end;
  elsif p_type = 'status_card' then
    if jsonb_typeof(p_v) is distinct from 'string' or p_st->(p_v #>> '{}') is null then return 'must be a status'; end if;
    s := p_v #>> '{}';
    if not (p_st->s->>'on_card')::boolean then return format('%s is not a status of a card', s); end if;
    return case when s in ('shielded', 'guarded') then 'a shield: use the block self_shield' end;
  elsif p_type = 'per_count' then
    if p_v = '"kinds"'::jsonb then return null; end if;
    if jsonb_typeof(p_v) is distinct from 'string' or p_st->(p_v #>> '{}') is null then return 'must be "kinds" or a status with stacks'; end if;
    s := p_v #>> '{}';
    return case when p_st->s->>'stacking' not in ('add', 'add_decay') or not (p_st->s->>'on_enemy')::boolean then format('%s has no stacks on an enemy', s) end;
  elsif p_type = 'status_options' then
    if jsonb_typeof(p_v) is distinct from 'array' or jsonb_array_length(p_v) < 2 or jsonb_array_length(p_v) > 6 then return 'must be a list of 2 to 6 options'; end if;
    if (select count(distinct x->>'status') <> count(*) from jsonb_array_elements(p_v) x) then return 'has a status twice'; end if;
    for o in select x from jsonb_array_elements(p_v) x loop
      if jsonb_typeof(o) is distinct from 'object' or exists (select 1 from jsonb_object_keys(o) y where y not in ('status', 'stacks')) then
        return 'each option is {status, stacks?}';
      end if;
      e := ability_v2_field_error('status_rider', o->'status', p_st);
      if e is not null then return 'an option: ' || e; end if;
      s := o->>'status';
      if p_st->s->>'stacking' in ('add_cap', 'higher') then return format('an option: %s needs a value (not in a random option)', s); end if;
      if o ? 'stacks' then
        if p_st->s->>'stacking' not in ('add', 'add_decay') then return format('an option: %s has no stacks', s); end if;
        e := ability_v2_field_error('int_pos', o->'stacks', p_st);
        if e is not null then return 'an option: stacks ' || e; end if;
      end if;
    end loop;
    return null;
  elsif p_type in ('status_rider', 'status_enemy', 'status_stack', 'status_decay') then
    if jsonb_typeof(p_v) is distinct from 'string' or p_st->(p_v #>> '{}') is null then return 'must be a status'; end if;
    s := p_v #>> '{}';
    if not (p_st->s->>'negative')::boolean or not (p_st->s->>'on_enemy')::boolean then return format('%s is not a harmful status of an enemy', s); end if;
    return case p_type
      when 'status_rider' then case when p_st->s->>'verb' is null then format('%s has no verb: no block applies it (Frozen is the end state of Chill: apply Chill)', s) end
      when 'status_stack' then case when p_st->s->>'stacking' not in ('add', 'add_decay') then format('%s has no stacks', s) end
      when 'status_decay' then case when p_st->s->>'stacking' <> 'add_decay' then format('%s does not decay (Detonate takes Burn)', s) end end;
  elsif p_type in ('status_list', 'cure_list') then
    if jsonb_typeof(p_v) is distinct from 'array' or jsonb_array_length(p_v) < 1 then return 'must be a list of one or more statuses'; end if;
    if (select count(distinct x) <> count(*) from jsonb_array_elements(p_v) x) then return 'has a status twice'; end if;
    if p_type = 'cure_list' and p_v = '["all"]'::jsonb then return null; end if;
    for s in select jsonb_array_elements_text(p_v) loop
      if p_st->s is null or not (p_st->s->>'negative')::boolean then return format('%s is not a harmful status', s); end if;
      if p_type = 'status_list' and not (p_st->s->>'on_enemy')::boolean then return format('%s is not a status of an enemy', s); end if;
      if p_type = 'cure_list' and not (p_st->s->>'on_card')::boolean then return format('%s is not a status of a card', s); end if;
    end loop;
    return null;
  end if;
  return format('unknown field type %s', p_type);
end $fn$;

-- ============================================================ 3. the block library: attach, hosts, the built parts
alter table public.ability_blocks add column if not exists attach text check (attach is null or attach in ('gate', 'amount'));
alter table public.ability_blocks add column if not exists hosts text[];
do $q$ begin
  if not exists (select 1 from pg_constraint where conname = 'ability_blocks_attach_hosts') then
    alter table public.ability_blocks add constraint ability_blocks_attach_hosts check ((attach is null) = (hosts is null) and (hosts is null or cardinality(hosts) >= 1));
  end if;
end $q$;
comment on column public.ability_blocks.attach is 'NULL = a normal block. gate = an attachment that turns its host (the block right before it) off while its condition does not hold; amount = an attachment that changes the amount of its host (PR T1, combat_v2_ability_builder.sql).';
comment on column public.ability_blocks.hosts is 'The blocks that this attachment may follow (its host); NULL for a normal block. One attachment for each host (PR T1).';

insert into public.ability_blocks (ord, key, grp, classes, once, fields, amount, scaled, price, text, silver, rule, reserved, note, attach, hosts) values
-- ---- E6 rows with a new field (the E6 text and price, plus the new part)
( 3, 'crit_add', 'modifier', '{attacker,support}', true, '{"v": {"type": "share", "required": true}}', 'v', '{v}',
  'attacker: ability_v2.pp.att_k / C x v; support: v2_pp.support_pp.smite x the smite x x v x (v2_stats.crd.base - one) x ability_v2.pp.sup_cycle / C',
  '{"clause": " with +{v}% crit chance", "support": " with +{v}% crit chance"}', '{"one": "+{d}% crit chance"}',
  'More crit chance on the hits of the active (a support: on its smite, which needs a smite block).', null, 'Support: PR T1 (an approved Artillery).', null, null),
( 8, 'lifesteal', 'modifier', '{attacker}', true, '{"v": {"type": "num_pos", "required": true}, "to": {"type": "to_ally", "required": false}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.heal_value', '{"one": "Heal this card for {v}% of the damage dealt.", "to": "Heal {ally} for {v}% of the damage dealt."}', '{"one": "+{d}% heal"}',
  'After the hits, this card (to: the most hurt ally or the strongest attacker) heals v of the damage dealt.', null, 'to: PR T1 (an approved Survivor).', null, null),
(10, 'payoff_dmg', 'payoff', '{attacker,support}', false,
  '{"status": {"type": "status_enemy", "required": false}, "statuses": {"type": "status_list", "required": false}, "v": {"type": "num_pos", "required": true}}', 'v', '{v}',
  'attacker: ability_v2.pp.att_k / C x v x v2_pp.ref.payoff; support: v2_pp.support_pp.smite x v x v2_pp.ref.payoff x ability_v2.pp.sup_cycle / C (a list costs as one status)',
  '{"one": "Deals +{v}% damage to {A} {targets}.", "with_crit": "Against {A} {targets}, it deals +{v}% damage and has +{c}% crit chance.", "support": "Deals +{v}% damage to a {A} enemy."}',
  '{"one": "+{d}% damage to {A} {targets}"}', 'More damage while the target has the status (or any status of the list). A support: on its smite.', null,
  'statuses and the support smite: PR T1.', null, null),
(11, 'payoff_crit', 'payoff', '{attacker}', false,
  '{"status": {"type": "status_enemy", "required": false}, "statuses": {"type": "status_list", "required": false}, "v": {"type": "share", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x v2_pp.ref.payoff (a list costs as one status)', '{"one": "Has +{v}% crit chance against {A} {targets}."}', '{"one": "+{d}% crit chance against {A} {targets}"}',
  'More crit chance while the target has the status or any status of the list (target_has). The area hits keep it (the simulator rule).', null, 'statuses: PR T1.', null, null),
(12, 'vs_status', 'payoff', '{attacker,support}', true,
  '{"status": {"type": "status_enemy", "required": false}, "statuses": {"type": "status_list", "required": false}, "x": {"type": "num_x", "required": true}}', 'x', '{}',
  '(attacker: ability_v2.pp.att_k / C; support: ability_v2.pp.sup_vs_k x ability_v2.pp.sup_cycle / C) x (x - one) x v2_pp.ref.frozen_share x v2_pp.ref.payoff (a list costs as one status)',
  '{"one": "Deals {x*} damage to {A} {targets}.", "support": "Deals {x*} damage to a {A} enemy."}', '{"one": "+{d}% damage to {A} {targets}"}',
  'x times the damage of the main hit (support: of the smite) while the target has the status or any status of the list.', null, 'statuses: PR T1.', null, null),
(17, 'apply', 'rider', '{attacker,support}', false,
  '{"status": {"type": "status_rider", "required": true}, "chance": {"type": "share", "required": true}, "stacks": {"type": "int_pos", "required": false}, "value": {"type": "num_pos", "required": false}, "all": {"type": "flag", "required": false}, "per": {"type": "per_count", "required": false}}',
  'value', '{value}',
  'v2_pp.status_pp.<status> x (stacks or value or one) x chance x (attacker: strikes / C; support: ability_v2.pp.sup_cycle / C) x (all: one + v2_pp.ref.foes_other); per (a support value status): x (the count this active adds + v2_pp.ref.stacks or kinds x v2_pp.ref.payoff)',
  '{"hit": "This hit has a {chance}% chance to {S}.", "strike": "Each strike has a {chance}% chance to {S}.", "area": "Each hit has a {chance}% chance to {S}.", "sure": "{S}.", "sure_strike": "{S} with each strike.", "support": "This card has a {chance}% chance to {S}.", "per_kinds": " for each status on it", "per_stack": " for each {L} stack on it"}',
  '{"one": "+{d}% {W}"}',
  'Puts a status on the target. On an attacker it is a rider: it draws after each hit that lands (all: also on each area hit). On a support it is a main block. per: the value x the stacks of a status (or the number of other harmful statuses) on the enemy; none = no status.', null,
  'A support apply with a chance below one counts as a rider; every attacker apply counts as a rider (plan 5.1). per: PR T1.', null, null),
(19, 'shield', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "to": {"type": "to_shield", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.shield x v x ability_v2.pp.sup_cycle / C', '{"one": "Shield {ally} for {v}% of its max HP", "cured": "Shield it for {v}% of its max HP."}',
  '{"one": "+{d}% Shield"}', 'A shield of v x the max HP of the ally (to: cured = the ally of the cure block, most_hurt, strongest).', null, 'most_hurt and strongest: PR T1.', null, null),
(21, 'heal', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "to": {"type": "to_ally", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.heal x v x ability_v2.pp.sup_cycle / C', '{"one": "Heal {ally} for {v}% of its max HP", "more": "Heal {ally} for {v}% more"}', '{"one": "+{d}% heal"}',
  'Heals the ally v x its max HP (to: most_hurt, strongest). With a to target right after a heal_all block the text says "more".', null, 'to: PR T1.', null, null),
(25, 'empower', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "to": {"type": "to_ally", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.empower x v x ability_v2.pp.sup_cycle / C', '{"one": "Empower {ally} for +{v}% damage"}', '{"one": "+{d}% Empower"}',
  'The next attack of the ally deals v more (to: most_hurt, strongest).', null, 'to: PR T1.', null, null),
(27, 'focus', 'main', '{support}', false, '{"crit": {"type": "share", "required": true}, "crd": {"type": "num_nonneg", "required": false}, "to": {"type": "to_ally", "required": false}}', 'crit', '{}',
  '(v2_pp.support_pp.focus_crit x crit + v2_pp.support_pp.focus_crd x crd) x ability_v2.pp.sup_cycle / C',
  '{"one": "Focus {ally} for +{crit}% crit chance", "crd": "Focus {ally} for +{crit}% crit chance and +{crd#} crit damage"}', '{"one": "+{d}% Focus"}',
  'Focused: more crit chance and crit damage for the ally (to: most_hurt, strongest). The factor F does not scale it (the simulator rule).', null, 'to: PR T1.', null, null),
(28, 'quicken', 'main', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "all": {"type": "flag", "required": false}, "to": {"type": "to_ally", "required": false}}', 'v', '{v}',
  'v2_pp.support_pp.quicken x v x ability_v2.pp.sup_cycle / C (all: x ability_v2.pp.quicken_all_x)',
  '{"one": "Quicken {ally}", "faster": "Quicken {ally}. It acts {v}% faster.", "all": "Quicken every attacker.", "all_faster": "Quicken every attacker: each one acts {v}% faster."}',
  '{"one": "+{d}% Quicken"}', 'Quickened: the speed of the ally (all: of every standing attacker; to: most_hurt, strongest) grows by the share v.', null, 'to: PR T1.', null, null),
-- ---- the reserved rows of E6, built (decisions 1 and 2)
(32, 'on_kill', 'trigger', '{attacker}', false,
  '{"status": {"type": "status_rider", "required": true}, "chance": {"type": "share", "required": true}, "stacks": {"type": "int_pos", "required": false}, "value": {"type": "num_pos", "required": false}}',
  'value', '{}', 'v2_pp.status_pp.<status> x (stacks or value or one) x chance x ability_v2.share.on_kill / C',
  '{"one": "Kills have a {chance}% chance to {S}.", "sure": "Kills {S}."}', '{"one": "+{d}% {W}"}',
  'The trigger on_kill: when a main hit (with its riders) downs the target, a chance to put the status on the next standing enemy. It counts as a rider.', null,
  'Decision 1 (Nathan 2026-10-20): like on_crit, with the kill share of balance ability_v2.share.on_kill.', null, null),
(33, 'self_has', 'condition', '{attacker,support}', false, '{"status": {"type": "status_card", "required": true}}', null, '{}',
  'the host x (ability_v2.share.self_has - one)', '{"clause": " while this card is {A}"}', '{}',
  'A gate: the block before it works only while this card has the status (a shield: self_shield).', null,
  'Decision 2 (Nathan 2026-10-20): raw price x the share where it is true; one share for the condition.', 'gate',
  '{pierce,true_strike,shield_break,lifesteal,guard_up,payoff_dmg,vs_status,per_stack,per_kind,execute,apply,on_crit,on_kill,random_apply,per_ally,shield,shield_all,heal,heal_all,cleanse,cure,empower,rally,focus,quicken,dispel,consume}'),
(34, 'enemy_charging', 'condition', '{attacker,support}', false, '{}', null, '{}',
  'the host x (ability_v2.share.enemy_charging - one)', '{"clause": " if the target is Charging", "support": " if the enemy is Charging"}', '{}',
  'A gate: the block before it works only while the target enemy is Charging (a Cataclysm comes).', null, 'Decision 2 (Nathan 2026-10-20).', 'gate',
  '{pierce,true_strike,shield_break,lifesteal,guard_up,payoff_dmg,vs_status,per_stack,per_kind,execute,apply,on_crit,on_kill,random_apply,per_ally,shield,shield_all,heal,heal_all,cleanse,cure,empower,rally,focus,quicken,dispel,consume}'),
(35, 'foes_alive', 'condition', '{attacker,support}', false, '{}', null, '{}',
  'the host x (ability_v2.share.foes_alive - one)', '{"clause": " while two or more enemies stand"}', '{}',
  'A gate: the block before it works only while two or more enemies stand.', null, 'Decision 2 (Nathan 2026-10-20).', 'gate',
  '{pierce,true_strike,shield_break,lifesteal,guard_up,payoff_dmg,vs_status,per_stack,per_kind,execute,apply,on_crit,on_kill,random_apply,per_ally,shield,shield_all,heal,heal_all,cleanse,cure,empower,rally,focus,quicken,dispel,consume}'),
(36, 'self_shield', 'condition', '{attacker,support}', false, '{}', null, '{}',
  'the host x (ability_v2.share.self_shield - one)', '{"clause": " while this card has a shield"}', '{}',
  'A gate: the block before it works only while this card has a shield.', null, 'Decision 2 (Nathan 2026-10-20). E6 had it as the value self:shield of a scaler.', 'gate',
  '{pierce,true_strike,shield_break,lifesteal,guard_up,payoff_dmg,vs_status,per_stack,per_kind,execute,apply,on_crit,on_kill,random_apply,per_ally,shield,shield_all,heal,heal_all,cleanse,cure,empower,rally,focus,quicken,dispel,consume}'),
-- ---- new rows
(37, 'per_ally', 'scaler', '{attacker}', true, '{"v": {"type": "num_pos", "required": true}}', 'v', '{}',
  'ability_v2.pp.att_k / C x v x ability_v2.ref.per_ally', '{"one": "Deals +{v}% damage for each ally attacker still standing."}', '{"one": "+{d}% damage for each ally attacker"}',
  'More damage for each other standing attacker of the squad (when the active starts).', null, 'PR T1 (an approved Flurry).', null, null),
(38, 'random_apply', 'rider', '{attacker,support}', true,
  '{"options": {"type": "status_options", "required": true}, "chance": {"type": "share", "required": false}}', null, '{}',
  'the mean of v2_pp.status_pp.<status> x (stacks or one) over the options x chance x (attacker: strikes / C; support: ability_v2.pp.sup_cycle / C)',
  '{"hit": "This hit adds one at random: {list}.", "hit_chance": "This hit has a {chance}% chance to add one at random: {list}.", "strike": "Each strike adds one at random: {list}.", "strike_chance": "Each strike has a {chance}% chance to add one at random: {list}.", "support": "Add one at random: {list}.", "support_chance": "This card has a {chance}% chance to add one at random: {list}."}',
  '{}', 'One random status of the options (one draw picks it). An attacker: after each main hit that lands. It counts as one rider.', null,
  'Decision 3 (Nathan 2026-10-20): costs the mean of its options, counts as one rider. No value status in an option.', null, null),
(39, 'target_has', 'condition', '{support}', false,
  '{"status": {"type": "status_enemy", "required": false}, "statuses": {"type": "status_list", "required": false}, "x": {"type": "num_x", "required": true}}', null, '{}',
  'the host x (x - one) x v2_pp.ref.payoff (x v2_pp.ref.frozen_share when every status is a control)', '{"one": "{V} {xm} as much if the enemy is {A}."}', '{}',
  'The amount of the block before it is x times while the enemy has the status (or any of the list).', null, 'PR T1 (an approved Warden).', 'amount',
  '{shield,shield_all,heal,heal_all,empower,rally,focus,quicken,apply}'),
(40, 'ally_below', 'condition', '{support}', false, '{"line": {"type": "share", "required": true}, "x": {"type": "num_x", "required": true}}', null, '{}',
  'the host x (x - one) x line', '{"one": "{V} {xm} as much if it is below {line}% HP."}', '{}',
  'The amount of the block before it is x times while its ally is below the HP line.', null, 'PR T1 (an approved Warden and Medic).', 'amount', '{shield,heal}'),
(41, 'more_per', 'scaler', '{support}', false, '{"v": {"type": "num_pos", "required": true}, "status": {"type": "status_stack", "required": false}}', null, '{v}',
  'the host at v x (status: v2_pp.ref.stacks; else v2_pp.ref.kinds) x v2_pp.ref.payoff',
  '{"stack": ", +{v}% more for each {L} stack on the enemy", "other": ", +{v}% more for each other status on it", "kinds": ", +{v}% more for each status on the enemy"}', '{}',
  'The block before it gets +v for each stack of the status on the enemy (no status: for each other harmful status on it).', null, 'PR T1 (an approved Spotter and Herald).', 'amount',
  '{shield,shield_all,heal,heal_all,empower,rally,focus,apply}'),
(42, 'coin', 'modifier', '{support}', false, '{"alt": {"type": "num_pos", "required": true}, "chance": {"type": "share", "required": true}}', null, '{alt}',
  '(the host at alt - the host) x (one - chance)', '{"each": ", with a {chance}% chance of each", "first": ", with a {chance}% chance of the first"}', '{}',
  'The amount of the block before it is its own with the chance, else alt (one draw).', null, 'PR T1 (an approved Herald).', 'amount',
  '{shield,shield_all,heal,heal_all,empower,rally,focus,quicken,apply}')
on conflict (key) do update set ord = excluded.ord, grp = excluded.grp, classes = excluded.classes, once = excluded.once, fields = excluded.fields, amount = excluded.amount,
  scaled = excluded.scaled, price = excluded.price, text = excluded.text, silver = excluded.silver, rule = excluded.rule, reserved = excluded.reserved, note = excluded.note,
  attach = excluded.attach, hosts = excluded.hosts;

-- ============================================================ 4. the numbers and the PP
create or replace function public.ability_v2_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_numbers(array['v2_pp', 'v2_charge', 'v2_status', 'ability_v2', 'v2_stats'])
    || jsonb_build_object(
         'statuses', (select coalesce(jsonb_object_agg(s.key, jsonb_build_object('ord', s.ord, 'label', s.label, 'adj', s.adj, 'verb', s.verb, 'negative', s.negative,
              'stacking', s.stacking, 'on_card', s.on_card, 'on_enemy', s.on_enemy, 'immunity', s.immunity)), '{}'::jsonb) from public.statuses s),
         'blocks', (select coalesce(jsonb_object_agg(a.key, jsonb_build_object('ord', a.ord, 'grp', a.grp, 'classes', to_jsonb(a.classes), 'once', a.once,
              'fields', a.fields, 'amount', a.amount, 'scaled', to_jsonb(a.scaled), 'text', a.text, 'silver', a.silver, 'reserved', a.reserved,
              'attach', a.attach, 'hosts', to_jsonb(a.hosts))), '{}'::jsonb)
            from public.ability_blocks a));
$fn$;

-- The PP of ONE block that needs no other block (the simulator cards.mjs blockPP). NULL for an attachment, a support crit_add and an apply per (ability_v2_pps).
create or replace function public.ability_v2_block_pp(p_block jsonb, p_class text, p_strikes numeric, p_b jsonb) returns numeric
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; a jsonb := p_b->'ability_v2'->'pp';
  att boolean := p_class = 'attacker'; c numeric; k numeric; sk numeric; key text := p_block->>'k'; sv numeric; srow jsonb;
  x numeric := (p_block->>'x')::numeric; v numeric := (p_block->>'v')::numeric; ch numeric := (p_block->>'chance')::numeric;
  al boolean := coalesce((p_block->>'all')::boolean, false);
begin
  if p_class is null or p_class not in ('attacker', 'support') then raise exception 'ability_v2_block_pp: the class is attacker or support (%)', p_class; end if;
  c := (p_b->'v2_charge'->>p_class)::numeric + 1;
  k := (a->>'att_k')::numeric / c;
  sk := (a->>'sup_cycle')::numeric / c;
  if key in ('apply', 'on_crit', 'on_kill') then
    srow := p_b->'statuses'->(p_block->>'status');
    sv := (p_b->'v2_pp'->'status_pp'->>(p_block->>'status'))::numeric
          * case when srow->>'stacking' in ('add_cap', 'higher') then (p_block->>'value')::numeric
                 when srow->>'stacking' in ('add', 'add_decay') then coalesce((p_block->>'stacks')::numeric, 1) else 1 end;
  elsif key = 'random_apply' then
    select avg((p_b->'v2_pp'->'status_pp'->>(o->>'status'))::numeric
               * case when p_b->'statuses'->(o->>'status')->>'stacking' in ('add', 'add_decay') then coalesce((o->>'stacks')::numeric, 1) else 1 end)
      into sv from jsonb_array_elements(p_block->'options') o;
  end if;
  return case key
    when 'hit' then k * (x - 1)
    when 'strikes' then k * ((p_block->>'n')::numeric * x - 1)
    when 'crit_add' then case when att then k * v end
    when 'pierce' then k * v * (r->>'enemy_def')::numeric / (1 - (r->>'enemy_def')::numeric)
    when 'true_strike' then k * (r->>'miss')::numeric
    when 'area' then case when att then k * x * (r->>'foes_other')::numeric else (su->>'smite')::numeric * x * (r->>'foes_other')::numeric * sk end
    when 'shield_break' then k * (x - 1) * (r->>'shield_share')::numeric * (r->>'payoff')::numeric
    when 'lifesteal' then k * v * (r->>'heal_value')::numeric
    when 'guard_up' then k * v * (r->>'heal_value')::numeric
    when 'payoff_dmg' then case when att then k * v * (r->>'payoff')::numeric else (su->>'smite')::numeric * v * sk * (r->>'payoff')::numeric end
    when 'payoff_crit' then k * v * (r->>'payoff')::numeric
    when 'vs_status' then case when att then k else sk * (a->>'sup_vs_k')::numeric end * (x - 1) * (r->>'frozen_share')::numeric * (r->>'payoff')::numeric
    when 'per_stack' then k * v * (r->>'stacks')::numeric * (r->>'payoff')::numeric
    when 'per_kind' then k * v * (r->>'kinds')::numeric * (r->>'payoff')::numeric
    when 'per_ally' then k * v * (p_b->'ability_v2'->'ref'->>'per_ally')::numeric
    when 'execute' then k * v * (p_block->>'line')::numeric
    when 'line_status' then (a->>'line_status')::numeric * jsonb_array_length(p_block->'statuses')
    when 'apply' then case when not p_block ? 'per' then sv * ch * case when att then p_strikes / c else sk end * case when al then 1 + (r->>'foes_other')::numeric else 1 end end
    when 'random_apply' then sv * coalesce(ch, 1) * case when att then p_strikes / c else sk end
    when 'on_crit' then sv * ch * (r->>'crit_share')::numeric * case when att then 1 / c else sk end
    when 'on_kill' then sv * ch * (p_b->'ability_v2'->'share'->>'on_kill')::numeric * case when att then 1 / c else sk end
    when 'shield' then (su->>'shield')::numeric * v * sk
    when 'shield_all' then (su->>'shield_all')::numeric * v * sk
    when 'heal' then (su->>'heal')::numeric * v * sk
    when 'heal_all' then (su->>'heal_all')::numeric * v * sk
    when 'cleanse' then (su->>'cleanse')::numeric * sk
    when 'cure' then (su->>'cure')::numeric * sk
    when 'empower' then (su->>'empower')::numeric * v * sk
    when 'rally' then (su->>'rally')::numeric * v * sk
    when 'focus' then ((su->>'focus_crit')::numeric * (p_block->>'crit')::numeric + (su->>'focus_crd')::numeric * coalesce((p_block->>'crd')::numeric, 0)) * sk
    when 'quicken' then (su->>'quicken')::numeric * v * sk * case when al then (a->>'quicken_all_x')::numeric else 1 end
    when 'dispel' then (su->>'dispel')::numeric * sk
    when 'smite' then (su->>'smite')::numeric * x * sk
    when 'consume' then (su->>'consume')::numeric * x * sk
  end;
end $fn$;

-- The PP of each block of an active (the simulator blockPP over the blocks): an attachment reads its host (the block before it), a support crit_add
-- reads the smite, an apply per reads the earlier sure applies of the same active. Answer: a list of numbers, one for each block.
create or replace function public.ability_v2_pps(p_class text, p_blocks jsonb, p_b jsonb) returns jsonb
language plpgsql immutable set search_path = public as $fn$
declare
  r jsonb := p_b->'v2_pp'->'ref'; su jsonb := p_b->'v2_pp'->'support_pp'; av jsonb := p_b->'ability_v2';
  n int := jsonb_array_length(p_blocks); i int; blk jsonb; k text; host jsonb; hp numeric; v numeric; amt text; own numeric; srow jsonb; out numeric[] := '{}';
  strikes numeric := coalesce((select (y->>'n')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'strikes' limit 1), 1);
  sk numeric := (av->'pp'->>'sup_cycle')::numeric / ((p_b->'v2_charge'->>p_class)::numeric + 1);
begin
  for i in 0 .. n - 1 loop
    blk := p_blocks->i; k := blk->>'k';
    host := case when i > 0 then p_blocks->(i - 1) end; hp := case when i > 0 then out[i] end;
    amt := p_b->'blocks'->(host->>'k')->>'amount';
    if p_b->'blocks'->k->>'attach' = 'gate' then
      v := hp * ((av->'share'->>k)::numeric - 1);
    elsif k = 'target_has' then
      v := hp * ((blk->>'x')::numeric - 1) * (r->>'payoff')::numeric
           * case when not exists (select 1 from jsonb_array_elements_text(coalesce(blk->'statuses', jsonb_build_array(blk->'status'))) z
                                    where coalesce(p_b->'statuses'->z->>'immunity', '') <> 'control') then (r->>'frozen_share')::numeric else 1 end;
    elsif k = 'ally_below' then
      v := hp * ((blk->>'x')::numeric - 1) * (blk->>'line')::numeric;
    elsif k = 'more_per' then
      v := ability_v2_block_pp(jsonb_set(host, array[amt], blk->'v'), p_class, strikes, p_b)
           * case when blk ? 'status' then (r->>'stacks')::numeric else (r->>'kinds')::numeric end * (r->>'payoff')::numeric;
    elsif k = 'coin' then
      v := (ability_v2_block_pp(jsonb_set(host, array[amt], blk->'alt'), p_class, strikes, p_b) - hp) * (1 - (blk->>'chance')::numeric);
    elsif k = 'crit_add' and p_class = 'support' then
      v := (su->>'smite')::numeric * (select (y->>'x')::numeric from jsonb_array_elements(p_blocks) y where y->>'k' = 'smite' limit 1)
           * (blk->>'v')::numeric * ((p_b->'v2_stats'->'crd'->>'base')::numeric - 1) * sk;
    elsif k = 'apply' and blk ? 'per' then
      if blk->>'per' = 'kinds' then
        select count(distinct y.v->>'status') into own from jsonb_array_elements(p_blocks) with ordinality y(v, o)
         where y.o - 1 < i and y.v->>'k' = 'apply' and (y.v->>'chance')::numeric >= 1 and y.v->>'status' <> blk->>'status';
      else
        select coalesce(sum(coalesce((y.v->>'stacks')::numeric, 1)), 0) into own from jsonb_array_elements(p_blocks) with ordinality y(v, o)
         where y.o - 1 < i and y.v->>'k' = 'apply' and (y.v->>'chance')::numeric >= 1 and y.v->>'status' = blk->>'per';
      end if;
      v := (p_b->'v2_pp'->'status_pp'->>(blk->>'status'))::numeric * (blk->>'value')::numeric * (blk->>'chance')::numeric * sk
           * (own + case when blk->>'per' = 'kinds' then (r->>'kinds')::numeric else (r->>'stacks')::numeric end * (r->>'payoff')::numeric);
    else
      v := ability_v2_block_pp(blk, p_class, strikes, p_b);
    end if;
    out := out || v;
  end loop;
  return to_jsonb(out);
end $fn$;

create or replace function public.ability_v2_pp(p_class text, p_blocks jsonb, p_b jsonb) returns numeric language sql immutable set search_path = public as $fn$
  select sum(x::numeric) from jsonb_array_elements_text(ability_v2_pps(p_class, p_blocks, p_b)) x;
$fn$;

-- ============================================================ 5. the card text
-- "A", "A or B", "A, B, or C" (the card text style: a list of choices)
create or replace function public.ability_v2_or(p text[]) returns text language sql immutable set search_path = public as $fn$
  select case when cardinality(p) = 1 then p[1] when cardinality(p) = 2 then p[1] || ' or ' || p[2]
              else array_to_string(p[1:cardinality(p) - 1], ', ') || ', or ' || p[cardinality(p)] end;
$fn$;
-- A clause into a sentence: before its full stop (a piece with no full stop: at its end).
create or replace function public.ability_v2_clause(p_s text, p_c text) returns text language sql immutable set search_path = public as $fn$
  select case when p_c is null or p_c = '' then p_s when right(p_s, 1) = '.' then left(p_s, -1) || p_c || '.' else p_s || p_c end;
$fn$;

-- The card text of an active (plan 5.4; the card text style). Answer {text, words, forms}. The E6 rules, plus the T1 parts: a gate is a clause of its host,
-- target_has and ally_below a sentence after it, more_per and coin a clause of it; "to" names the ally; "more" after a heal_all.
create or replace function public.ability_v2_text(p_class text, p_blocks jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses';
  outs text[] := '{}'; blk jsonb; k text; i int; n int := jsonb_array_length(p_blocks); tx jsonb; vals jsonb; s text; t text; ch numeric;
  main jsonb; area jsonb; crit jsonb; many boolean := false; tgts text; o jsonb; lst text[]; j int; skip int[] := '{}';
  last text; last_to text; ally_named boolean := false; pend text; aw text; ew text; ewp text; piece text; srow jsonb; nxt jsonb;
  txt text; maxw int := (b->'ability_v2'->'limits'->>'words_max')::int; forms text[] := '{}'; f text; std boolean;
  att jsonb; ak text; clause text; extra text; this_to text; prevk text; a_word text; sw text; pat text;
begin
  if p_class = 'attacker' then
    select x into main from jsonb_array_elements(p_blocks) x where x->>'k' in ('hit', 'strikes') limit 1;
    select x into area from jsonb_array_elements(p_blocks) x where x->>'k' = 'area' limit 1;
    select x into crit from jsonb_array_elements(p_blocks) x where x->>'k' = 'crit_add' limit 1;
    if main is null then return jsonb_build_object('text', null, 'words', 0, 'forms', '[]'::jsonb); end if;
    many := main->>'k' = 'strikes';
    s := ability_v2_fill(bl->(main->>'k')->'text'->>'main', ability_v2_vals(main));
    if area is not null then s := s || ability_v2_fill(bl->'area'->'text'->>'clause', ability_v2_vals(area)); end if;
    if crit is not null then s := s || ability_v2_fill(bl->'crit_add'->'text'->>'clause', ability_v2_vals(crit)); end if;
    outs := outs || (s || '.');
    tgts := case when area is not null then 'enemies' else 'targets' end;
    for i in 0 .. n - 1 loop
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k in ('hit', 'strikes', 'area', 'crit_add', 'line_status') or bl->k->>'attach' is not null;
      att := case when bl->(p_blocks->(i + 1)->>'k')->>'attach' is not null then p_blocks->(i + 1) end;
      vals := ability_v2_vals(blk) || jsonb_build_object('targets', tgts);
      srow := st->(blk->>'status');
      a_word := case when jsonb_typeof(blk->'statuses') = 'array'
                     then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord))
                     else srow->>'adj' end;
      if a_word is not null then vals := vals || jsonb_build_object('A', a_word); end if;
      if srow is not null then vals := vals || jsonb_build_object('L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      if k = 'true_strike' then s := tx->>case when many then 'many' else 'one' end;
      elsif k = 'pierce' then
        s := tx->>((case when many then 'many' else 'one' end)
                  || case when (blk->>'v')::numeric >= 1 then '_all' when (blk->>'v')::numeric * 2 = 1 then '_half' else '' end);
        s := ability_v2_fill(s, vals);
      elsif k = 'payoff_dmg' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x
         where x->>'k' = 'payoff_crit' and coalesce(x->>'status', (x->'statuses')::text) = coalesce(blk->>'status', (blk->'statuses')::text) limit 1;
        s := case when o is null then ability_v2_fill(tx->>'one', vals)
                  else ability_v2_fill(tx->>'with_crit', vals || jsonb_build_object('c', ability_v2_pct((o->>'v')::numeric))) end;
      elsif k = 'payoff_crit' then
        continue when exists (select 1 from jsonb_array_elements(p_blocks) x
                               where x->>'k' = 'payoff_dmg' and coalesce(x->>'status', (x->'statuses')::text) = coalesce(blk->>'status', (blk->'statuses')::text));
        s := ability_v2_fill(tx->>'one', vals);
      elsif k = 'execute' then
        o := null;
        select x into o from jsonb_array_elements(p_blocks) x where x->>'k' = 'line_status' limit 1;
        if o is null then s := ability_v2_fill(tx->>'one', vals);
        else
          lst := array(select st->q.y->>'adj' from jsonb_array_elements_text(o->'statuses') with ordinality q(y, ord) order by q.ord);
          if cardinality(lst) = 1 then t := ability_v2_fill(bl->'line_status'->'text'->>'one', jsonb_build_object('A', lst[1]));
          else
            t := '';
            for j in 1 .. cardinality(lst) loop
              t := t || ability_v2_fill(bl->'line_status'->'text'->>case when j = cardinality(lst) then 'last' else 'item' end, jsonb_build_object('A', lst[j]));
            end loop;
          end if;
          s := ability_v2_fill(tx->>'list', vals || jsonb_build_object('list', t));
        end if;
      elsif k = 'apply' then
        if area is not null and coalesce((blk->>'all')::boolean, false) then
          s := case when ch < 1 then ability_v2_fill(tx->>'area', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'that enemy', false)))
                    else ability_v2_cap(ability_v2_verb(srow, blk, 'each enemy hit', true)) || '.' end;
        elsif many then
          s := case when ch < 1 then ability_v2_fill(tx->>'strike', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)))
                    else ability_v2_fill(tx->>'sure_strike', jsonb_build_object('S', ability_v2_cap(ability_v2_verb(srow, blk, 'the target', false)))) end;
        else
          s := case when ch < 1 then ability_v2_fill(tx->>'hit', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)))
                    else ability_v2_fill(tx->>'sure', jsonb_build_object('S', ability_v2_cap(ability_v2_verb(srow, blk, 'the target', false)))) end;
        end if;
      elsif k = 'on_crit' then
        s := ability_v2_fill(tx->>case when ch < 1 then 'one' else 'sure' end,
                             jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the target', false)));
      elsif k = 'on_kill' then
        s := ability_v2_fill(tx->>case when ch < 1 then 'one' else 'sure' end,
                             jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, 'the next enemy', true)));
      elsif k = 'random_apply' then
        s := ability_v2_fill(tx->>((case when many then 'strike' else 'hit' end) || case when coalesce(ch, 1) < 1 then '_chance' else '' end),
                             vals || jsonb_build_object('list', ability_v2_options(blk->'options', st)));
      elsif k = 'lifesteal' and blk ? 'to' then
        s := ability_v2_fill(tx->>'to', vals || jsonb_build_object('ally', ability_v2_ally_word(blk->>'to')));
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      if att is not null and bl->(att->>'k')->>'attach' = 'gate' then
        s := ability_v2_clause(s, ability_v2_fill(bl->(att->>'k')->'text'->>'clause', jsonb_build_object('A', st->(att->>'status')->>'adj')));
      end if;
      outs := outs || s;
    end loop;
  else
    -- a support: "the enemy", then "it" (R9); "an ally", then "it"; two single-ally blocks in a row are one sentence ("... and Quicken it.")
    select x into area from jsonb_array_elements(p_blocks) x where x->>'k' = 'area' limit 1;
    select x into crit from jsonb_array_elements(p_blocks) x where x->>'k' = 'crit_add' limit 1;
    for i in 0 .. n - 1 loop
      continue when i = any (skip);
      blk := p_blocks->i; k := blk->>'k'; tx := bl->k->'text';
      continue when k in ('area', 'crit_add') or bl->k->>'attach' is not null;
      att := case when bl->(p_blocks->(i + 1)->>'k')->>'attach' is not null then p_blocks->(i + 1) end;
      ak := att->>'k';
      vals := ability_v2_vals(blk);
      srow := st->(blk->>'status');
      a_word := case when jsonb_typeof(blk->'statuses') = 'array'
                     then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord))
                     else srow->>'adj' end;
      if a_word is not null then vals := vals || jsonb_build_object('A', a_word); end if;
      if srow is not null then vals := vals || jsonb_build_object('L', srow->>'label'); end if;
      ch := (blk->>'chance')::numeric;
      std := k = 'quicken' and (blk->>'v')::numeric + 1 = (b->'v2_status'->'quickened'->>'x')::numeric;
      -- the attachment: a clause into this block's text (gate, more_per, coin) or a sentence after it (target_has, ally_below)
      clause := null; extra := null;
      if ak is not null then
        sw := case when k = 'apply' then split_part(srow->>'verb', ' ', 1) else split_part(tx->>'one', ' ', 1) end;
        if bl->ak->>'attach' = 'gate' then
          clause := ability_v2_fill(coalesce(bl->ak->'text'->>'support', bl->ak->'text'->>'clause'), jsonb_build_object('A', st->(att->>'status')->>'adj'));
        elsif ak = 'more_per' then
          clause := ability_v2_fill(bl->ak->'text'->>case when att ? 'status' then 'stack' when k = 'apply' then 'other' else 'kinds' end,
                                    ability_v2_vals(att) || jsonb_build_object('L', st->(att->>'status')->>'label'));
        elsif ak = 'coin' then
          clause := ability_v2_fill(bl->ak->'text'->>case when (att->>'chance')::numeric * 2 = 1 then 'each' else 'first' end, ability_v2_vals(att));
        elsif ak in ('target_has', 'ally_below') then
          extra := ability_v2_fill(bl->ak->'text'->>'one', ability_v2_vals(att) || jsonb_build_object('V', sw,
                     'xm', case when (att->>'x')::numeric = 2 then 'twice' else trim_scale((att->>'x')::numeric)::text || ' times' end,
                     'A', case when jsonb_typeof(att->'statuses') = 'array'
                               then ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(att->'statuses') with ordinality q(y, ord) order by q.ord))
                               else st->(att->>'status')->>'adj' end));
        end if;
      end if;
      -- a single-ally piece
      if (k in ('shield', 'heal', 'empower', 'focus') and not (k = 'shield' and coalesce(blk->>'to', '') = 'cured'))
         or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false) and std) then
        this_to := coalesce(blk->>'to', 'pick');
        aw := case when last = 'ally' and last_to = this_to then 'it' when this_to <> 'pick' then ability_v2_ally_word(this_to)
                   when ally_named then 'that ally' else 'an ally' end;
        prevk := case when i > 0 then p_blocks->(i - 1)->>'k' end;
        pat := case when k = 'focus' and coalesce((blk->>'crd')::numeric, 0) > 0 then 'crd' when k = 'heal' and prevk = 'heal_all' and blk ? 'to' then 'more' else 'one' end;
        piece := ability_v2_fill(tx->>pat, vals || jsonb_build_object('ally', aw));
        if ak = 'coin' then piece := ability_v2_coin(piece, blk, att, b); end if;
        piece := ability_v2_clause(piece, clause);
        if this_to = 'pick' then ally_named := true; end if;
        last := 'ally'; last_to := this_to;
        if pend is not null then outs := outs || (pend || ' and ' || piece || '.'); pend := null;
        elsif extra is not null then outs := outs || (piece || '.');
        else pend := piece; end if;
        if extra is not null then outs := outs || extra; if ak = 'target_has' then last := null; end if; end if;
        continue;
      end if;
      if pend is not null then outs := outs || (pend || '.'); pend := null; end if;
      ew := case when last = 'enemy' then 'it' else 'the enemy' end;
      ewp := case when last = 'enemy' then 'its' else 'the enemy''s' end;
      if k = 'shield' then s := ability_v2_fill(tx->>'cured', vals); last := 'ally'; last_to := 'pick';
      elsif k in ('shield_all', 'heal_all', 'rally', 'cleanse') then s := ability_v2_fill(tx->>'one', vals); last := null;
      elsif k = 'quicken' then
        if coalesce((blk->>'all')::boolean, false) then s := ability_v2_fill(tx->>case when std then 'all' else 'all_faster' end, vals); last := null;
        else
          this_to := coalesce(blk->>'to', 'pick');
          aw := case when last = 'ally' and last_to = this_to then 'it' when this_to <> 'pick' then ability_v2_ally_word(this_to)
                     when ally_named then 'that ally' else 'an ally' end;
          s := ability_v2_fill(tx->>'faster', vals || jsonb_build_object('ally', aw)); last := 'ally'; last_to := this_to;
          if this_to = 'pick' then ally_named := true; end if;
        end if;
      elsif k = 'cure' then
        if blk->'statuses' = '["all"]'::jsonb then t := tx->>'all';
        else
          lst := array(select case when st->q.y->>'stacking' in ('add', 'add_decay') then st->q.y->>'label' else st->q.y->>'adj' end
                         from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord);
          t := case when cardinality(lst) = 1 then lst[1] when cardinality(lst) = 2 then lst[1] || ' and ' || lst[2]
                    else array_to_string(lst[1:cardinality(lst) - 1], ', ') || ', and ' || lst[cardinality(lst)] end;
        end if;
        vals := vals || jsonb_build_object('list', t);
        -- the Glossary keyword K1 "Cure ... for N steps" stands for the cure, the protection and the shield of k1_shield on the cured ally
        j := null;
        select (x.o - 1)::int into j from jsonb_array_elements(p_blocks) with ordinality x(v, o)
         where x.o - 1 > i and x.v->>'k' = 'shield' and x.v->>'to' = 'cured' order by x.o limit 1;
        if j is not null and (p_blocks->j->>'v')::numeric = (b->'ability_v2'->>'k1_shield')::numeric and att is null
           and bl->(p_blocks->(j + 1)->>'k')->>'attach' is null then
          s := ability_v2_fill(tx->>'keyword', vals); skip := skip || j;
        else
          s := ability_v2_fill(tx->>'one', vals) || ' '
               || ability_v2_fill(tx->>case when blk->'statuses' = '["all"]'::jsonb then 'protect_all' when cardinality(lst) = 1 then 'protect_one' else 'protect_list' end,
                                  vals || jsonb_build_object('A', st->(blk->'statuses'->>0)->>'adj'));
        end if;
        last := 'ally'; last_to := 'pick'; ally_named := true;
      elsif k = 'dispel' then s := ability_v2_fill(tx->>'one', jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'smite' then
        s := ability_v2_fill(tx->>'one', vals || jsonb_build_object('enemy', ew));
        if area is not null then s := s || ability_v2_fill(bl->'area'->'text'->>'support', ability_v2_vals(area)); end if;
        if crit is not null then s := s || ability_v2_fill(bl->'crit_add'->'text'->>'support', ability_v2_vals(crit)); end if;
        s := s || '.'; last := 'enemy';
      elsif k = 'consume' then
        s := ability_v2_fill(tx->>case when (blk->>'x')::numeric = 1 then 'one' else 'x' end, vals || jsonb_build_object('enemy_pos', ewp)); last := 'enemy';
      elsif k = 'vs_status' then s := ability_v2_fill(tx->>'support', vals);
      elsif k = 'payoff_dmg' then s := ability_v2_fill(tx->>'support', vals);
      elsif k = 'random_apply' then
        s := ability_v2_fill(tx->>case when coalesce(ch, 1) < 1 then 'support_chance' else 'support' end,
                             vals || jsonb_build_object('list', ability_v2_options(blk->'options', st)));
        last := 'enemy';
      elsif k = 'apply' then
        if ch < 1 then s := ability_v2_fill(tx->>'support', jsonb_build_object('chance', vals->>'chance', 'S', ability_v2_verb(srow, blk, ew, true)));
        else
          nxt := p_blocks->(i + 1);
          if srow->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' and nxt->>'k' = 'apply' and (nxt->>'chance')::numeric >= 1 and not nxt ? 'per'
             and st->(nxt->>'status')->>'verb' ~ '^[A-Z][a-z]+ \{t\}$' and att is null and bl->(p_blocks->(i + 2)->>'k')->>'attach' is null then
            -- two plain verbs on the enemy: "Confuse and Blind the enemy."
            s := split_part(srow->>'verb', ' ', 1) || ' and ' || split_part(st->(nxt->>'status')->>'verb', ' ', 1) || ' ' || ew || '.';
            skip := skip || (i + 1);
          else
            s := ability_v2_cap(ability_v2_verb(srow, blk, ew, true));
            if blk ? 'per' then s := s || ability_v2_fill(tx->>case when blk->>'per' = 'kinds' then 'per_kinds' else 'per_stack' end,
                                                         jsonb_build_object('L', st->(blk->>'per')->>'label')); end if;
            s := s || '.';
          end if;
        end if;
        last := 'enemy';
      else
        s := ability_v2_fill(tx->>'one', vals);
      end if;
      if ak = 'coin' then s := ability_v2_coin(s, blk, att, b); end if;
      s := ability_v2_clause(s, clause);
      outs := outs || s;
      if extra is not null then outs := outs || extra; last := case when ak = 'ally_below' then 'ally' end; end if;
    end loop;
    if pend is not null then outs := outs || (pend || '.'); end if;
  end if;
  txt := array_to_string(outs, ' ');
  -- the short forms (the card text style 5), in order, only while the text is above the limit
  foreach f in array array['S1', 'S2', 'S3', 'S4', 'S5'] loop
    exit when ability_v2_words(txt) <= maxw;
    t := case f
      when 'S1' then regexp_replace(txt, 'Hit the target for', 'Hit for')
      when 'S2' then regexp_replace(txt, 'Heal this card for ([^ ]+) of the damage dealt\.', 'Heal for \1 of the damage.')
      when 'S3' then regexp_replace(regexp_replace(txt, '( chance to [A-Za-z]+) the target', '\1 it', 'g'), ' that enemy', ' it', 'g')
      when 'S4' then replace(txt, ' of its max HP', ' of max HP')
      when 'S5' then replace(txt, ' and every other enemy for', ', every other enemy for') end;
    if t <> txt then txt := t; forms := forms || f; end if;
  end loop;
  return jsonb_build_object('text', txt, 'words', ability_v2_words(txt), 'forms', to_jsonb(forms));
end $fn$;

-- The words of a "to" target.
create or replace function public.ability_v2_ally_word(p_to text) returns text language sql immutable set search_path = public as $fn$
  select case p_to when 'most_hurt' then 'the most hurt ally' when 'strongest' then 'the strongest attacker' end;
$fn$;
-- The options of a random_apply: "1 Poison, 2 Burn, or Blinded" (a status with stacks: the stacks and the label; else the adjective).
create or replace function public.ability_v2_options(p_options jsonb, p_st jsonb) returns text language sql immutable set search_path = public as $fn$
  select ability_v2_or(array(select case when p_st->(o.v->>'status')->>'stacking' in ('add', 'add_decay')
                                         then coalesce(o.v->>'stacks', '1') || ' ' || (p_st->(o.v->>'status')->>'label') else p_st->(o.v->>'status')->>'adj' end
                               from jsonb_array_elements(p_options) with ordinality o(v, n) order by o.n));
$fn$;
-- coin: the amount of the host shows both numbers ("+70% or +30%", "40% or 20%"), then the clause.
create or replace function public.ability_v2_coin(p_s text, p_blk jsonb, p_att jsonb, p_b jsonb) returns text language sql immutable set search_path = public as $fn$
  select regexp_replace(p_s, '(^|[^0-9])(\+?)' || ability_v2_pct((p_blk->>(p_b->'blocks'->(p_blk->>'k')->>'amount'))::numeric) || '%',
                        '\1\2' || ability_v2_pct((p_blk->>(p_b->'blocks'->(p_blk->>'k')->>'amount'))::numeric) || '% or \2' || ability_v2_pct((p_att->>'alt')::numeric) || '%');
$fn$;

-- The Silver line (the card text style R12): only the bonus. {A} of a list = "Stunned or Asleep".
create or replace function public.ability_v2_silver_text(p_class text, p_blocks jsonb, p_silver jsonb, p_b jsonb default null) returns text
language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, ability_v2_numbers()); blk jsonb; k text; srow jsonb; d numeric; area boolean; vals jsonb; st jsonb := b->'statuses';
begin
  if p_silver is null or jsonb_typeof(p_silver) <> 'object' then return null; end if;
  blk := p_blocks->((p_silver->>'block')::int - 1); k := blk->>'k';
  if blk is null or b->'blocks'->k->'silver' is null then return null; end if;
  d := (p_silver->>'value')::numeric - (blk->>(p_silver->>'field'))::numeric;
  area := exists (select 1 from jsonb_array_elements(p_blocks) x where x->>'k' = 'area');
  srow := st->(blk->>'status');
  vals := jsonb_build_object('d', ability_v2_pct(d), 'targets', case when area then 'enemies' else 'targets' end)
          || case when blk ? 'line' then jsonb_build_object('line', ability_v2_pct((blk->>'line')::numeric)) else '{}'::jsonb end
          || case when srow is not null then jsonb_build_object('A', srow->>'adj', 'L', srow->>'label', 'W', split_part(srow->>'verb', ' ', 1)) else '{}'::jsonb end
          || case when jsonb_typeof(blk->'statuses') = 'array'
                  then jsonb_build_object('A', ability_v2_or(array(select st->q.y->>'adj' from jsonb_array_elements_text(blk->'statuses') with ordinality q(y, ord) order by q.ord)))
                  else '{}'::jsonb end;
  return ability_v2_fill(b->'blocks'->k->'silver'->>case when area and k in ('hit', 'smite') then 'area' else 'one' end, vals);
end $fn$;

-- ============================================================ 6. the validator (plan 5.4): the E6 rules plus the T1 parts
create or replace function public.ability_v2_check(p_role text, p_ability jsonb, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, ability_v2_numbers()); bl jsonb := b->'blocks'; st jsonb := b->'statuses'; pp jsonb := b->'v2_pp'; lim jsonb := b->'ability_v2'->'limits';
  errs text[] := '{}'; cls text; blocks jsonb; blk jsonb; k text; row jsonb; f text; fs jsonb; e text; i int; n int; at text;
  total numeric; spp numeric; sb jsonb; sv jsonb; si int; sf text; txt jsonb; stxt text; riders int := 0; srow jsonb; pps jsonb; hk text; host jsonb;
  budget numeric := (pp->>'budget')::numeric; tol numeric := (pp->>'tolerance')::numeric; sil jsonb := b->'ability_v2'->'silver';
begin
  select r.class into cls from public.roles r where r.key = p_role;
  if cls is null then return jsonb_build_object('ok', false, 'errors', jsonb_build_array(format('unknown role %s', coalesce(p_role, '(none)')))); end if;
  if jsonb_typeof(p_ability) is distinct from 'object' then return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', jsonb_build_array('an ability is an object {name, blocks, silver}')); end if;
  for f in select jsonb_object_keys(p_ability) loop
    if f not in ('name', 'blocks', 'silver') then errs := errs || format('the ability has the unknown key %s', f); end if;
  end loop;
  if jsonb_typeof(p_ability->'name') is distinct from 'string' or btrim(p_ability->>'name') = '' then errs := errs || 'the ability needs a name'::text; end if;
  blocks := p_ability->'blocks';
  if jsonb_typeof(blocks) is distinct from 'array' or jsonb_array_length(blocks) < 1 or jsonb_array_length(blocks) > (lim->>'blocks')::int then
    errs := errs || format('blocks must be a list of 1 to %s blocks', lim->>'blocks');
    return jsonb_build_object('ok', false, 'role', p_role, 'class', cls, 'errors', to_jsonb(errs));
  end if;
  n := jsonb_array_length(blocks);
  -- each block: built, fits the class, its fields
  for i in 0 .. n - 1 loop
    blk := blocks->i; at := format('block %s', i + 1);
    if jsonb_typeof(blk) is distinct from 'object' or jsonb_typeof(blk->'k') is distinct from 'string' then errs := errs || format('%s must be an object with k', at); continue; end if;
    k := blk->>'k'; row := bl->k; at := format('block %s (%s)', i + 1, k);
    if row is null then errs := errs || format('%s: unknown block', at); continue; end if;
    if row->>'reserved' is not null then errs := errs || format('%s: reserved, %s', at, row->>'reserved'); continue; end if;
    if not row->'classes' ? cls then errs := errs || format('%s: not a block of a %s (role %s)', at, cls, p_role); continue; end if;
    for f in select jsonb_object_keys(blk) loop
      if f <> 'k' and not row->'fields' ? f then errs := errs || format('%s: unknown field %s', at, f); end if;
    end loop;
    for f, fs in select key, value from jsonb_each(row->'fields') loop
      if not blk ? f then
        if (fs->>'required')::boolean then errs := errs || format('%s: needs %s', at, f); end if;
        continue;
      end if;
      e := ability_v2_field_error(fs->>'type', blk->f, st);
      if e is not null then errs := errs || format('%s: %s %s', at, f, e); end if;
    end loop;
    -- a block with status or statuses (payoffs, vs_status, target_has): exactly one of the two
    if row->'fields' ? 'statuses' and (blk ? 'status') = (blk ? 'statuses') then errs := errs || format('%s: needs status or statuses (one of the two)', at); end if;
    -- a status block: stacks only for a status with stacks, a value exactly for a status with a value (Exposed, Weakened, Mark)
    if k in ('apply', 'on_crit', 'on_kill') and st->(blk->>'status') is not null then
      srow := st->(blk->>'status');
      if blk ? 'stacks' and srow->>'stacking' not in ('add', 'add_decay') then errs := errs || format('%s: %s has no stacks', at, blk->>'status'); end if;
      if srow->>'stacking' in ('add_cap', 'higher') and not blk ? 'value' then errs := errs || format('%s: %s needs a value', at, blk->>'status'); end if;
      if blk ? 'value' and srow->>'stacking' not in ('add_cap', 'higher') then errs := errs || format('%s: %s has no value', at, blk->>'status'); end if;
      if k = 'apply' and cls = 'attacker' and coalesce((blk->>'all')::boolean, false) and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'area') then
        errs := errs || format('%s: all (each area hit) needs an area block', at);
      end if;
      if k = 'apply' and cls = 'support' and blk ? 'all' then errs := errs || format('%s: all is for an attacker area rider', at); end if;
      if k = 'apply' and blk ? 'per' and (cls <> 'support' or not blk ? 'value') then errs := errs || format('%s: per is for a support status with a value (Expose, Weaken, Mark)', at); end if;
      if cls = 'attacker' or (blk->>'chance')::numeric < 1 then riders := riders + 1; end if;
    end if;
    if k = 'random_apply' then riders := riders + 1; end if;
    -- a support payoff or crit chance shapes its smite
    if cls = 'support' and k in ('payoff_dmg', 'crit_add') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || format('%s: a support %s needs a smite block (it shapes the smite)', at, k);
    end if;
    -- an attachment: after its host, one for each host
    if row->>'attach' is not null then
      host := case when i > 0 then blocks->(i - 1) end; hk := host->>'k';
      if host is null then errs := errs || format('%s: needs a block before it (its host)', at);
      elsif bl->hk->>'attach' is not null then errs := errs || format('%s: one attachment for each block (block %s is one)', at, i);
      elsif not row->'hosts' ? hk then errs := errs || format('%s: cannot follow a %s block (it follows %s)', at, hk, array_to_string(array(select jsonb_array_elements_text(row->'hosts')), ', '));
      elsif k in ('target_has', 'more_per', 'coin') and hk = 'apply' and not host ? 'value' then errs := errs || format('%s: the apply before it needs a value (Expose, Weaken, Mark)', at);
      elsif k in ('more_per', 'coin') and host ? 'per' then errs := errs || format('%s: the apply before it has per already', at);
      elsif row->>'attach' = 'gate' and hk in ('payoff_dmg', 'payoff_crit')
            and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('payoff_dmg', 'payoff_crit') and x->>'k' <> hk
                          and coalesce(x->>'status', (x->'statuses')::text) = coalesce(host->>'status', (host->'statuses')::text)) then
        errs := errs || format('%s: a gate cannot follow a payoff that shares its sentence with another payoff', at);
      end if;
    end if;
    if (row->>'once')::boolean and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' = k) > 1 then
      errs := errs || format('%s: at most one %s block', at, k);
    end if;
  end loop;
  if cardinality(errs) = 0 then
    -- the rules that join blocks
    if (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('apply', 'payoff_dmg', 'payoff_crit', 'per_stack')
          group by x->>'k', coalesce(x->>'status', (x->'statuses')::text) order by 1 desc limit 1) > 1 then
      errs := errs || 'one block of a kind for each status (two blocks of one kind name the same status)'::text;
    end if;
    if cls = 'attacker' and (select count(*) from jsonb_array_elements(blocks) x where x->>'k' in ('hit', 'strikes')) <> 1 then
      errs := errs || 'an attacker active has ONE main hit: one hit or one strikes block'::text;
    end if;
    if cls = 'support' and exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' in ('area', 'vs_status'))
       and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'smite') then
      errs := errs || 'a support area or vs_status block needs a smite block (it shapes the smite)'::text;
    end if;
    if exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'line_status') and not exists (select 1 from jsonb_array_elements(blocks) x where x->>'k' = 'execute') then
      errs := errs || 'a line_status block needs an execute block'::text;
    end if;
    for i in 0 .. n - 1 loop
      if blocks->i->>'k' = 'shield' and blocks->i->>'to' = 'cured'
         and not exists (select 1 from jsonb_array_elements(blocks) with ordinality x(v, o) where x.o - 1 < i and x.v->>'k' = 'cure') then
        errs := errs || format('block %s (shield): to cured needs a cure block before it', i + 1);
      end if;
    end loop;
    if riders > (lim->>'riders')::int then errs := errs || format('%s riders: at most %s (plan 5.3)', riders, lim->>'riders'); end if;
  end if;
  if cardinality(errs) = 0 then
    pps := ability_v2_pps(cls, blocks, b);
    total := (select sum(x::numeric) from jsonb_array_elements_text(pps) x);
    if abs(total - budget) > tol then errs := errs || format('the blocks cost %s PP: the budget is %s +/- %s', round(total, 2), budget, tol); end if;
    txt := ability_v2_text(cls, blocks, b);
    if (txt->>'words')::int < (lim->>'words_min')::int or (txt->>'words')::int > (lim->>'words_max')::int then
      errs := errs || format('the card text has %s words: %s to %s', txt->>'words', lim->>'words_min', lim->>'words_max');
    end if;
    -- the Silver upgrade (plan 5.3): type 1, a stronger number on the amount of ONE block, + silver.pp PP
    sv := p_ability->'silver';
    if sv is not null and jsonb_typeof(sv) <> 'null' then
      if jsonb_typeof(sv) <> 'object' or exists (select 1 from jsonb_object_keys(sv) y where y not in ('block', 'field', 'value')) then
        errs := errs || 'silver is {block, field, value}: a Silver that adds a block (type 3) waits for the guardian price factor (plan 5.3)'::text;
      elsif jsonb_typeof(sv->'block') is distinct from 'number' or (sv->>'block')::numeric % 1 <> 0 or (sv->>'block')::int < 1 or (sv->>'block')::int > n then
        errs := errs || 'silver.block is the number of a block (1 = the first)'::text;
      else
        si := (sv->>'block')::int - 1; sf := sv->>'field'; k := blocks->si->>'k';
        if sf = 'chance' then errs := errs || 'silver: more rider chance (type 2) is cut (plan 5.3)'::text;
        elsif sf = 'stacks' then errs := errs || 'silver: one more stack (type 4) waits for the guardian price factor (plan 5.3)'::text;
        elsif sf is distinct from bl->k->>'amount' then errs := errs || format('silver: only the amount %s of block %s (%s) can grow (type 1, a stronger number)', coalesce(bl->k->>'amount', '(none)'), si + 1, k);
        elsif jsonb_typeof(sv->'value') is distinct from 'number' or (sv->>'value')::numeric <= (blocks->si->>sf)::numeric then
          errs := errs || 'silver.value must be a number above the base value (a stronger number)'::text;
        else
          e := ability_v2_field_error(bl->k->'fields'->sf->>'type', sv->'value', st);
          if e is not null then errs := errs || format('silver.value %s', e); end if;
          sb := jsonb_set(blocks, array[si::text, sf], sv->'value');
          spp := ability_v2_pp(cls, sb, b);
          if abs(spp - budget - (sil->>'pp')::numeric) > tol then
            errs := errs || format('the Silver blocks cost %s PP: the Silver budget is %s +/- %s', round(spp, 2), budget + (sil->>'pp')::numeric, tol);
          end if;
          stxt := ability_v2_silver_text(cls, blocks, sv, b);
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', cardinality(errs) = 0, 'errors', to_jsonb(errs), 'role', p_role, 'class', cls, 'pp', total, 'pps', pps, 'silver_pp', spp,
    'text', txt->'text', 'words', txt->'words', 'forms', txt->'forms', 'silver_text', stxt,
    'enables', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('apply', 'on_crit', 'on_kill') and x ? 'status'
                 union all select o->>'status' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x,
                   jsonb_array_elements(case when jsonb_typeof(x->'options') = 'array' then x->'options' else '[]'::jsonb end) o where x->>'k' = 'random_apply') z where y is not null), '[]'::jsonb),
    'pays', coalesce((select jsonb_agg(distinct y) from (
                 select x->>'status' y from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('payoff_dmg', 'payoff_crit', 'vs_status', 'per_stack', 'target_has', 'more_per') and x ? 'status'
                 union all select x->>'per' from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' = 'apply' and x ? 'per' and x->>'per' <> 'kinds'
                 union all select jsonb_array_elements_text(x->'statuses') from jsonb_array_elements(case when jsonb_typeof(blocks) = 'array' then blocks else '[]'::jsonb end) x
                  where x->>'k' in ('line_status', 'payoff_dmg', 'payoff_crit', 'vs_status', 'target_has') and jsonb_typeof(x->'statuses') = 'array') z where y is not null), '[]'::jsonb));
end $fn$;

-- ============================================================ 7. the card action: the T1 parts (the simulator engine.mjs doActive)
create or replace function public.combat_v2_action_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_status_numbers() || combat_v2_numbers(array['v2_support', 'v2_charge'])
    || jsonb_build_object(
         'stacking', (select coalesce(jsonb_object_agg(s.key, s.stacking), '{}'::jsonb) from public.statuses s),
         'blocks', (select coalesce(jsonb_object_agg(a.key, jsonb_build_object('classes', to_jsonb(a.classes), 'scaled', to_jsonb(a.scaled), 'reserved', a.reserved,
                      'attach', a.attach, 'amount', a.amount)), '{}'::jsonb)
                      from public.ability_blocks a));
$fn$;

-- The unit has the status of the block (status) or any status of its list (statuses).
create or replace function public.combat_effect_v2_has(p_unit jsonb, p_blk jsonb, p_clk int) returns boolean language sql immutable set search_path = public as $fn$
  select case when jsonb_typeof(p_blk->'statuses') = 'array'
              then exists (select 1 from jsonb_array_elements_text(p_blk->'statuses') z where combat_v2_status_on(p_unit, z, p_clk) is not null)
              else combat_v2_status_on(p_unit, p_blk->>'status', p_clk) is not null end;
$fn$;
-- The ally of a "to" target: most_hurt = the lowest HP share (the first in the fixed order on a tie), strongest = the standing attacker with the most
-- power (atk; the first on a tie). NULL = none.
create or replace function public.combat_effect_v2_ally_to(p_state jsonb, p_to text) returns jsonb language sql immutable set search_path = public as $fn$
  select jsonb_build_object('side', 'card', 'id', q.id::numeric)
    from combat_v2_units(p_state) q
   where q.side = 'card' and combat_v2_up(p_state->'cards'->q.id) and (p_to = 'most_hurt' or p_state->'cards'->q.id->>'class' = 'attacker')
   order by case when p_to = 'most_hurt' then (p_state->'cards'->q.id->>'hp')::numeric / (p_state->'cards'->q.id->>'max')::numeric
                 else -(p_state->'cards'->q.id->>'atk')::numeric end, q.n
   limit 1;
$fn$;
-- A gate holds now: self_has (the card has the status), self_shield (it has a shield), enemy_charging (the target charges a Cataclysm), foes_alive
-- (more than one enemy stands).
create or replace function public.combat_effect_v2_gate(p_state jsonb, p_unit jsonb, p_tgt jsonb, p_att jsonb) returns boolean
language plpgsql immutable set search_path = public as $fn$
declare clk int := (p_state->>'clock')::int;
begin
  return case p_att->>'k'
    when 'self_has' then combat_v2_status_on(p_unit, p_att->>'status', clk) is not null
    when 'self_shield' then coalesce((combat_v2_status_on(p_unit, 'shielded', clk)->>'value')::numeric, 0) > 0
    when 'enemy_charging' then coalesce((p_tgt->>'cataclysm')::boolean, false)
    when 'foes_alive' then (select count(*) from combat_v2_units(p_state) q where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int))) > 1
  end;
end $fn$;
-- The count of a "for each": the stacks of the status on the unit, or (no status) its harmful statuses other than p_except.
create or replace function public.combat_effect_v2_count(p_unit jsonb, p_status text, p_except text, p_clk int, p_b jsonb) returns numeric
language sql immutable set search_path = public as $fn$
  select case when p_status is not null then coalesce((combat_v2_status_on(p_unit, p_status, p_clk)->>'stacks')::numeric, 0)
              else (select count(*) from jsonb_object_keys(coalesce(p_unit->'status', '{}'::jsonb)) y
                     where coalesce((p_b->'statuses'->y->>'negative')::boolean, false) and combat_v2_status_on(p_unit, y, p_clk) is not null
                       and y is distinct from p_except) end;
$fn$;
-- The amount of a support block with its attachment (the simulator amount()): coin (one draw), more_per, target_has, ally_below. Answer {v, draws}.
create or replace function public.combat_effect_v2_amount(p_blk jsonb, p_att jsonb, p_tgt jsonb, p_ally jsonb, p_clk int, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare v numeric := (p_blk->>(p_b->'blocks'->(p_blk->>'k')->>'amount'))::numeric; used jsonb := '[]'::jsonb; d numeric; ak text := p_att->>'k';
begin
  if ak = 'coin' then
    d := combat_v2_draw(p_draws, 0); used := used || to_jsonb(d);
    if d >= (p_att->>'chance')::numeric then v := (p_att->>'alt')::numeric; end if;
  end if;
  if ak = 'more_per' then
    v := v + (p_att->>'v')::numeric * combat_effect_v2_count(p_tgt, p_att->>'status', case when p_blk->>'k' = 'apply' then p_blk->>'status' end, p_clk, p_b);
  end if;
  if ak = 'target_has' and combat_effect_v2_has(p_tgt, p_att, p_clk) then v := v * (p_att->>'x')::numeric; end if;
  if ak = 'ally_below' and p_ally is not null and (p_ally->>'hp')::numeric / (p_ally->>'max')::numeric < (p_att->>'line')::numeric then v := v * (p_att->>'x')::numeric; end if;
  return jsonb_build_object('v', v, 'draws', used);
end $fn$;

-- The unique active (the simulator doActive), with the T1 parts. An attacker shapes its hits; a support runs its blocks in order, its smite last.
create or replace function public.combat_effect_v2_active(p_state jsonb, p_actor jsonb, p_target jsonb, p_ally jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  ro jsonb := p_b->'v2_roles'; ss jsonb := p_b->'v2_status'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric; clk int;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb;
  blocks jsonb; blk jsonb; k text; tu jsonb; ch numeric; lst text[]; id text; ref jsonb; t jsonb; cured jsonb; st jsonb;
  x numeric := 1; ns int := 1; crit_add numeric := 0; pierce numeric := 0; ts boolean := false; bonus numeric := 0; crit_bonus numeric := 0; shield_x numeric := 1;
  vs_x numeric; area numeric := 0; steal numeric := 0; steal_to text; guard numeric := 0; riders jsonb := '[]'::jsonb; oncrit jsonb := '[]'::jsonb; onkill jsonb := '[]'::jsonb;
  ctx jsonb; dealt numeric := 0; i int; n int; cr numeric; amt numeric; smite_x numeric := 0; area_x numeric := 0; svs numeric := 1; sbonus numeric := 0; scrit numeric := 0;
  stk numeric; tot numeric; refhp numeric; foes int; keys jsonb; att jsonb; am jsonb; al jsonb; alu jsonb; op jsonb; nx jsonb; apath text[]; tpath text[]; cnt numeric;
begin
  apath := combat_v2_unit_path(s, p_actor); tpath := combat_v2_unit_path(s, p_target);
  u := s #> apath; role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1); clk := (s->>'clock')::int;
  blocks := combat_effect_v2_blocks(u, p_b); n := jsonb_array_length(blocks);
  if n = 0 then raise exception 'combat_v2_card_act: card % has no active (active.blocks)', p_actor->>'id'; end if;
  for blk in select x2 from jsonb_array_elements(blocks) x2 loop
    k := blk->>'k';
    if p_b->'blocks'->k is null or p_b->'blocks'->k->>'reserved' is not null then raise exception 'combat_v2_card_act: the block % is not built', k; end if;
    if not p_b->'blocks'->k->'classes' ? cls then raise exception 'combat_v2_card_act: the block % is not for a %', k, cls; end if;
  end loop;
  tu := s #> tpath;
  if cls = 'attacker' then
    -- Confused: the active may hit a unit of its own side (for x confused.self_x of its power)
    w := combat_v2_confused_target(s, p_actor, d, p_b);
    used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
    if (w->>'wrong')::boolean then
      r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * (w->>'x')::numeric, null, p_b);
      return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
    end if;
    -- the shape of the hits (ABL raises each amount); an attachment is read with its host, a gate that does not hold turns its host off
    for i in 0 .. n - 1 loop
      blk := blocks->i; k := blk->>'k';
      continue when p_b->'blocks'->k->>'attach' is not null;
      att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
      continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
      if k = 'hit' then x := 1 + ((blk->>'x')::numeric - 1) * ab;
      elsif k = 'strikes' then ns := (blk->>'n')::int; x := (1 + (ns * (blk->>'x')::numeric - 1) * ab) / ns;
      elsif k = 'crit_add' then crit_add := crit_add + (blk->>'v')::numeric * ab;
      elsif k = 'pierce' then pierce := greatest(pierce, (blk->>'v')::numeric);
      elsif k = 'true_strike' then ts := true;
      elsif k = 'area' then area := (blk->>'x')::numeric * ab;
      elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then bonus := bonus + (blk->>'v')::numeric * ab; end if;
      elsif k = 'payoff_crit' then if combat_effect_v2_has(tu, blk, clk) then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if;
      elsif k = 'per_stack' then bonus := bonus + (blk->>'v')::numeric * ab * coalesce((combat_v2_status_on(tu, blk->>'status', clk)->>'stacks')::numeric, 0);
      elsif k = 'per_kind' then bonus := bonus + (blk->>'v')::numeric * ab * combat_effect_v2_count(tu, null, null, clk, p_b);
      elsif k = 'per_ally' then
        bonus := bonus + (blk->>'v')::numeric * ab
                 * (select count(*) from combat_v2_units(s) q where q.side = 'card' and q.id <> p_actor->>'id' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker');
      elsif k = 'vs_status' then if combat_effect_v2_has(tu, blk, clk) then vs_x := (blk->>'x')::numeric; end if;
      elsif k = 'execute' then
        if (tu->>'hp')::numeric / (tu->>'max')::numeric < (blk->>'line')::numeric
           or exists (select 1 from jsonb_array_elements(blocks) y, jsonb_array_elements_text(y->'statuses') z
                       where y->>'k' = 'line_status' and combat_v2_status_on(tu, z, clk) is not null) then
          bonus := bonus + (blk->>'v')::numeric * ab;
        end if;
      elsif k = 'lifesteal' then steal := (blk->>'v')::numeric * ab; steal_to := blk->>'to';
      elsif k = 'guard_up' then guard := (blk->>'v')::numeric * ab;
      elsif k = 'shield_break' then shield_x := (blk->>'x')::numeric;
      elsif k in ('apply', 'random_apply') then riders := riders || jsonb_build_array(blk);
      elsif k = 'on_crit' then oncrit := oncrit || jsonb_build_array(blk);
      elsif k = 'on_kill' then onkill := onkill || jsonb_build_array(blk);
      end if;
    end loop;
    -- one enemy left: the area adds its share to the main hit (v2_roles.cleaver.hunt_area_x, the plan rule for an area active)
    select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
    if foes = 1 and area > 0 then bonus := bonus + area * (ro->'cleaver'->>'hunt_area_x')::numeric; area := 0; end if;
    ctx := jsonb_build_object('x', x, 'crit_add', crit_add, 'crit_bonus', crit_bonus, 'bonus', bonus, 'pierce', pierce, 'shield_x', shield_x, 'true_strike', ts)
           || case when vs_x is not null then jsonb_build_object('vs_x', vs_x) else '{}'::jsonb end;
    for i in 1 .. ns loop
      exit when not combat_v2_up(s #> tpath);
      r := combat_effect_v2_hit(s, p_actor, p_target, ctx, d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      dealt := dealt + (h->>'dmg')::numeric;
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      -- the riders draw AFTER the hit (plan 6.2): each one draws its chance (ABL raises a chance below one), then (random_apply) its pick, then its status draws
      if not (h->>'miss')::boolean then
        for blk in select x2 from jsonb_array_elements(riders) x2 loop
          ch := coalesce((blk->>'chance')::numeric, 1);
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
            if blk->>'k' = 'random_apply' then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
              r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            else
              r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            end if;
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
      -- the trigger on_crit: after a crit
      if (h->>'crit')::boolean then
        for blk in select x2 from jsonb_array_elements(oncrit) x2 loop
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          if dv < (blk->>'chance')::numeric then
            r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                        || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
            s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
          end if;
        end loop;
      end if;
      -- the trigger on_kill: the target is down after this hit and its riders: a chance to put the status on the next standing enemy
      if jsonb_array_length(onkill) > 0 and not combat_v2_up(s #> tpath) then
        nx := (select jsonb_build_object('side', 'enemy', 'id', q.id::numeric) from combat_v2_units(s) q
                where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n limit 1);
        if nx is not null then
          for blk in select x2 from jsonb_array_elements(onkill) x2 loop
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < (blk->>'chance')::numeric then
              r := combat_v2_status_apply(s, nx, blk->>'status', (blk - 'k' - 'status' - 'chance') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end if;
    end loop;
    -- the area hits (all_enemies): every other standing enemy, the same shape at x = area (no bonus, no vs_x); the riders with all
    if area > 0 then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
      foreach id in array lst loop
        ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', 0), d, p_b);
        s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
        dealt := dealt + (h->>'dmg')::numeric;
        hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
        if not (h->>'miss')::boolean then
          for blk in select x2 from jsonb_array_elements(riders) x2 where coalesce((x2->>'all')::boolean, false) loop
            ch := (blk->>'chance')::numeric;
            dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
            if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
              r := combat_v2_status_apply(s, ref, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all') || jsonb_build_object('src', p_actor)
                                          || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
              s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
            end if;
          end loop;
        end if;
      end loop;
    end if;
    if steal > 0 and dealt > 0 then
      t := case when steal_to is null then p_actor else combat_effect_v2_ally_to(s, steal_to) end;
      if t is not null then s := combat_v2_heal(s, t, steal * dealt, p_b)->'state'; end if;
    end if;
    if guard > 0 and dealt > 0 then s := combat_v2_status_apply(s, p_actor, 'shielded', jsonb_build_object('value', guard * dealt), p_b)->'state'; end if;
    s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- a support: the blocks in order. An attachment works with its host (a gate turns it off; coin draws first, then the crit roll).
  -- A crit roll (crt -> crd) for each shield, heal, empower and rally block and for an Expose, Weaken or Mark.
  for i in 0 .. n - 1 loop
    blk := blocks->i; k := blk->>'k';
    continue when p_b->'blocks'->k->>'attach' is not null;
    att := case when p_b->'blocks'->(blocks->(i + 1)->>'k')->>'attach' is not null then blocks->(i + 1) end;
    u := s #> apath; tu := s #> tpath;
    continue when att is not null and p_b->'blocks'->(att->>'k')->>'attach' = 'gate' and not combat_effect_v2_gate(s, u, tu, att);
    -- the ally of a single-ally block: its "to" target, else opts.ally (none for strongest = the block does nothing, no draw)
    al := null;
    if k in ('shield', 'heal', 'empower', 'focus', 'cure') or (k = 'quicken' and not coalesce((blk->>'all')::boolean, false)) then
      if blk->>'to' in ('most_hurt', 'strongest') then
        al := combat_effect_v2_ally_to(s, blk->>'to');
        continue when al is null;
      else
        if jsonb_typeof(p_ally) is distinct from 'object' or p_ally->>'side' is distinct from 'card' then
          raise exception 'combat_v2_card_act: the block % needs opts.ally ({side: card, id})', k;
        end if;
        perform combat_v2_unit_path(s, p_ally);
        al := p_ally;
        if k = 'shield' and blk->>'to' = 'cured' and cured is not null and combat_v2_up(s #> combat_v2_unit_path(s, cured)) then al := cured; end if;
      end if;
    end if;
    alu := case when al is not null then s #> combat_v2_unit_path(s, al) end;
    -- the amount with the attachment (coin draws here), then the crit roll
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally', 'focus', 'quicken') then
      am := combat_effect_v2_amount(blk, att, tu, alu, clk, d, p_b);
      used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws')); amt := (am->>'v')::numeric;
    end if;
    if k in ('shield', 'shield_all', 'heal', 'heal_all', 'empower', 'rally') then
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
    end if;
    if k = 'shield' then
      s := combat_v2_status_apply(s, al, 'shielded', jsonb_build_object('value', amt * ab * cr * (alu->>'max')::numeric), p_b)->'state';
    elsif k in ('shield_all', 'heal_all') then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        ref := jsonb_build_object('side', 'card', 'id', id::numeric);
        s := case when k = 'shield_all' then combat_v2_status_apply(s, ref, 'shielded', jsonb_build_object('value', amt * ab * cr * (s->'cards'->id->>'max')::numeric), p_b)->'state'
                  else combat_v2_heal(s, ref, amt * ab * cr * (s->'cards'->id->>'max')::numeric, p_b)->'state' end;
      end loop;
    elsif k = 'heal' then
      s := combat_v2_heal(s, al, amt * ab * cr * (alu->>'max')::numeric, p_b)->'state';
    elsif k = 'cleanse' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
        s := combat_v2_status_cure(s, jsonb_build_object('side', 'card', 'id', id::numeric), null, 0, p_b)->'state';
      end loop;
    elsif k = 'cure' then
      keys := case when blk->'statuses' = '["all"]'::jsonb then null else blk->'statuses' end;
      s := combat_v2_status_cure(s, al, keys, (blk->>'immune')::int, p_b)->'state';
      cured := al;
    elsif k = 'empower' then
      s := combat_v2_status_apply(s, al, 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
    elsif k = 'rally' then
      for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'empowered', jsonb_build_object('value', amt * ab * cr, 'src', p_actor), p_b)->'state';
      end loop;
    elsif k = 'focus' then
      s := combat_v2_status_apply(s, al, 'focused', jsonb_build_object('value', amt * ab, 'src', p_actor)
                                  || case when blk ? 'crd' then jsonb_build_object('crd', (blk->>'crd')::numeric * ab) else '{}'::jsonb end, p_b)->'state';
    elsif k = 'quicken' then
      if coalesce((blk->>'all')::boolean, false) then
        for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) and s->'cards'->q.id->>'class' = 'attacker' order by q.n loop
          s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
        end loop;
      else
        s := combat_v2_status_apply(s, al, 'quickened', jsonb_build_object('value', 1 + amt * ab, 'src', p_actor), p_b)->'state';
      end if;
    elsif k = 'dispel' then s := combat_v2_status_strip(s, p_target, null, p_b)->'state';
    elsif k = 'smite' then smite_x := (blk->>'x')::numeric * ab;
    elsif k = 'area' then area_x := (blk->>'x')::numeric * ab;
    elsif k = 'vs_status' then if combat_effect_v2_has(tu, blk, clk) then svs := (blk->>'x')::numeric; end if;
    elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then sbonus := sbonus + (blk->>'v')::numeric * ab; end if;
    elsif k = 'crit_add' then scrit := scrit + (blk->>'v')::numeric * ab;
    elsif k = 'consume' then
      -- Detonate: every Burn tick left at once, x times (x (1 + Exposed)), a tick that ignores shields; then the Burn ends
      st := combat_v2_status_on(tu, blk->>'status', clk);
      if st is not null and combat_v2_up(tu) then
        refhp := case when s->>'mode' = 'hunt' then (ss->>'hunt_ref_hp')::numeric else (tu->>'max')::numeric end;
        stk := coalesce((st->>'stacks')::numeric, 0); tot := 0;
        while stk > 0 loop
          tot := tot + stk * (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric * refhp;
          stk := stk - (ss->'burn'->>'decay')::numeric;
        end loop;
        s := combat_v2_status_remove(s, p_target, blk->>'status', p_b)->'state';
        s := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true), p_b)->'state';
      end if;
    elsif k = 'apply' then
      ch := (blk->>'chance')::numeric;
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        amt := null; cnt := 1;
        if blk ? 'value' then
          am := combat_effect_v2_amount(blk, att, tu, null, clk, d, p_b);
          used := used || (am->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(am->'draws'));
          if blk ? 'per' then cnt := combat_effect_v2_count(tu, case when blk->>'per' = 'kinds' then null else blk->>'per' end, blk->>'status', clk, p_b); end if;
        end if;
        if cnt > 0 then
          if blk ? 'value' then
            cr := 1;
            if p_b->'stacking'->>(blk->>'status') in ('add_cap', 'higher') then
              dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
              cr := case when dv < coalesce((u->>'crt')::numeric, 0) then coalesce((u->>'crd')::numeric, (p_b->'v2_stats'->'crd'->>'base')::numeric) else 1 end;
            end if;
            amt := (am->>'v')::numeric * cnt * ab * cr;
          end if;
          r := combat_v2_status_apply(s, p_target, blk->>'status', (blk - 'k' - 'status' - 'chance' - 'all' - 'value' - 'per')
                                      || case when amt is not null then jsonb_build_object('value', amt) else '{}'::jsonb end
                                      || jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
          s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
        end if;
      end if;
    elsif k = 'random_apply' then
      ch := coalesce((blk->>'chance')::numeric, 1);
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < least(1, ch * case when ch < 1 then ab else 1 end) then
        dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
        op := blk->'options'->(floor(dv * jsonb_array_length(blk->'options'))::int);
        r := combat_v2_status_apply(s, p_target, op->>'status', (op - 'status') || jsonb_build_object('src', p_actor)
                                    || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end if;
  end loop;
  -- the smite last: on the enemy (a true strike, x vs_status, + a support payoff, + a support crit chance), the area value on every other standing enemy;
  -- one enemy: + area_one_foe_x of the area
  if area_x > 0 and smite_x = 0 then raise exception 'combat_v2_card_act: an area block of a support needs a smite block'; end if;
  lst := case when area_x > 0 then array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n)
              else '{}'::text[] end;
  if area_x > 0 and cardinality(lst) = 0 then smite_x := smite_x + area_x * (p_b->'v2_support'->>'area_one_foe_x')::numeric; end if;
  if smite_x > 0 and combat_v2_up(s #> tpath) then
    r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
    s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
  end if;
  foreach id in array lst loop
    ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
    r := combat_effect_v2_hit(s, p_actor, ref, jsonb_build_object('x', area_x, 'true_strike', true), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
  end loop;
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- ============================================================ 8. the storage: subjects.ability_v2 (plan 9.1)
alter table public.subjects add column if not exists ability_v2 jsonb;
comment on column public.subjects.ability_v2 is $q$Combat v2: the unique active of the subject (plan 9.1): {role, name, blocks, silver}. NULL = none yet (the v1 column ability stays). A write must pass ability_v2_check(role, {name, blocks, silver}) (trigger subjects_ability_v2_check). Written by card-studio/scripts/push-abilities.mjs --v2 from a batch file of the studio ability builder (plan 12.1). No fight reads it while the flag combat_v2 is OFF. combat_v2_ability_builder.sql.$q$;

create or replace function public.subjects_ability_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare r jsonb;
begin
  if new.ability_v2 is null then return new; end if;
  if tg_op = 'UPDATE' and new.ability_v2 is not distinct from old.ability_v2 then return new; end if;
  if jsonb_typeof(new.ability_v2) <> 'object' or jsonb_typeof(new.ability_v2->'role') is distinct from 'string' then
    raise exception 'subjects.ability_v2 of %: the value is {role, name, blocks, silver}', new.key;
  end if;
  r := ability_v2_check(new.ability_v2->>'role', new.ability_v2 - 'role');
  if not (r->>'ok')::boolean then
    raise exception 'subjects.ability_v2 of %: %', new.key, (select string_agg(e, '; ') from jsonb_array_elements_text(r->'errors') e);
  end if;
  return new;
end $fn$;
drop trigger if exists subjects_ability_v2_check on public.subjects;
create trigger subjects_ability_v2_check before insert or update of ability_v2 on public.subjects for each row execute function public.subjects_ability_v2_check();

-- ============================================================ 9. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['ability_v2_spec()', 'ability_v2_field_types()', 'ability_v2_field_error(text, jsonb, jsonb)', 'ability_v2_numbers()',
      'ability_v2_block_pp(jsonb, text, numeric, jsonb)', 'ability_v2_pps(text, jsonb, jsonb)', 'ability_v2_pp(text, jsonb, jsonb)', 'ability_v2_or(text[])',
      'ability_v2_clause(text, text)', 'ability_v2_text(text, jsonb, jsonb)', 'ability_v2_ally_word(text)', 'ability_v2_options(jsonb, jsonb)',
      'ability_v2_coin(text, jsonb, jsonb, jsonb)', 'ability_v2_silver_text(text, jsonb, jsonb, jsonb)', 'ability_v2_check(text, jsonb, jsonb)',
      'combat_v2_action_numbers()', 'combat_effect_v2_has(jsonb, jsonb, integer)', 'combat_effect_v2_ally_to(jsonb, text)',
      'combat_effect_v2_gate(jsonb, jsonb, jsonb, jsonb)', 'combat_effect_v2_count(jsonb, text, text, integer, jsonb)',
      'combat_effect_v2_amount(jsonb, jsonb, jsonb, jsonb, integer, jsonb, jsonb)', 'combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)',
      'subjects_ability_v2_check()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;

comment on function public.ability_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key ability_v2 (pp att_k, sup_cycle, sup_vs_k, line_status, quicken_all_x; silver stars, pp; limits blocks, riders, words_min, words_max; k1_shield; share on_kill, enemy_charging, foes_alive, self_shield, self_has; ref per_ally). combat_v2_abilities.sql, share and ref: combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_field_types() is $cm$[combat] The field types of an ability block (ability_blocks.fields): num_pos, num_x (above 1), num_nonneg, share (above 0, at most 1), int_pos, int_many (above 1), int_nonneg, flag, status_rider (a harmful enemy status with a verb), status_enemy, status_stack, status_decay, status_list, cure_list (["all"] or harmful card statuses), to_cured, to_shield (cured, most_hurt, strongest), to_ally (most_hurt, strongest), status_card (a card status, not a shield), status_options (2 to 6 {status, stacks?}, no value status), per_count ("kinds" or a status with stacks). combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_field_error(text, jsonb, jsonb) is $cm$[combat] The ability validator: one field value against its type (ability_v2_field_types); NULL = fine, else the problem. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_numbers() is $cm$[combat] The numbers of the ability validator and the card text in one read: balance v2_pp, v2_charge, v2_status, ability_v2, v2_stats, plus statuses (label, adj, verb, negative, stacking, sides, immunity) and blocks (the ability_blocks rows as data, with attach and hosts). combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_block_pp(jsonb, text, numeric, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of ONE ability block that needs no other block (the simulator blockPP): attacker blocks att_k / C x the extra basic hits they add, support blocks their v2_pp.support_pp price x sup_cycle / C, riders status_pp x amount x chance (attacker x strikes / C), on_kill x share.on_kill, random_apply the mean of its options, per_ally x ref.per_ally, a support payoff_dmg smite x v x payoff. NULL for an attachment, a support crit_add and an apply per (ability_v2_pps). PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_pps(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.2, PR T1): the PP of each block of an active, in order: a gate = its host x (share - 1), target_has = host x (x - 1) x payoff (x frozen_share for a control list), ally_below = host x (x - 1) x line, more_per = the host at v x ref.stacks or ref.kinds x payoff, coin = (the host at alt - the host) x (1 - chance), a support crit_add = smite x x x v x (crd.base - 1) x sup_cycle / C, an apply per = status x value x chance x sup_cycle / C x (the count this active adds + ref x payoff); every other block ability_v2_block_pp. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_pp(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.2): the PP of an active = the sum of ability_v2_pps. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_or(text[]) is $cm$[combat] Card text: a list of choices: "A", "A or B", "A, B, or C". PURE.$cm$;
comment on function public.ability_v2_clause(text, text) is $cm$[combat] Card text: a clause into a sentence, before its full stop (a piece with no full stop: at its end). PURE.$cm$;
comment on function public.ability_v2_text(text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.4): the card text of an active, generated from its blocks with the patterns of ability_blocks and the words of statuses (the card text style of 2026-10-20). PR T1: a gate is a clause of its host, target_has and ally_below a sentence after it, more_per and coin a clause of it, "to" names the ally ("the most hurt ally", "the strongest attacker"), a heal after a heal_all says "more", a list of statuses reads "A, B, or C". Answer {text, words, forms}. combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_ally_word(text) is $cm$[combat] Card text: the words of a "to" target (most_hurt: the most hurt ally; strongest: the strongest attacker). PURE.$cm$;
comment on function public.ability_v2_options(jsonb, jsonb) is $cm$[combat] Card text: the options of a random_apply ("1 Poison, 2 Burn, or Blinded"). PURE.$cm$;
comment on function public.ability_v2_coin(text, jsonb, jsonb, jsonb) is $cm$[combat] Card text: a coin shows both amounts of its host ("+70% or +30%"). PURE.$cm$;
comment on function public.ability_v2_silver_text(text, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 5.3, the card text style R12): the Silver line = only the bonus: "+", the raise of the amount in % rounded up, and the unit of the block (ability_blocks.silver); a status list reads "A or B". combat_v2_ability_builder.sql.$cm$;
comment on function public.ability_v2_check(text, jsonb, jsonb) is $cm$[combat] Combat v2 THE ABILITY VALIDATOR (plan 5.4): checks an active {name, blocks, silver} for a role: every block built (not reserved) and of the class, fields and statuses (status or statuses, one of the two), once, one main hit for an attacker, smite for a support area / vs_status / payoff_dmg / crit_add, execute for line_status, cure before a shield to the cured ally, an attachment right after a host of its hosts list (one each), apply per on a support value status, at most limits.riders riders (apply, on_crit, on_kill, random_apply), PP = budget +/- tolerance, Silver = type 1 on the amount of one block at budget + silver.pp, the card text words_min to words_max words. Answer {ok, errors, role, class, pp, pps, silver_pp, text, words, forms, silver_text, enables, pays}. Reads only. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_v2_action_numbers() is $cm$[combat] Combat v2: the numbers of a card action in one read: combat_v2_status_numbers, v2_support, v2_charge, stacking (the stacking rule of each status) and blocks (classes, scaled, reserved, attach, amount of each ability block). combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_has(jsonb, jsonb, integer) is $cm$[combat] Combat v2: the unit has the status of a block (status) or any status of its list (statuses) at the clock. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_ally_to(jsonb, text) is $cm$[combat] Combat v2: the ally of a "to" target: most_hurt = the standing card with the lowest HP share, strongest = the standing attacker with the most atk (the first in the fixed order on a tie). NULL = none. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_gate(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: a gate holds now: self_has (the card has the status), self_shield (it has a shield), enemy_charging (the target charges a Cataclysm), foes_alive (more than one enemy stands). PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_count(jsonb, text, text, integer, jsonb) is $cm$[combat] Combat v2: the count of a "for each": the stacks of a status on the unit, or its harmful statuses other than one. PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_amount(jsonb, jsonb, jsonb, jsonb, integer, jsonb, jsonb) is $cm$[combat] Combat v2: the amount of a support block with its attachment: coin (one draw: its own with the chance, else alt), more_per (+v for each stack or other status on the enemy), target_has (x x while the enemy has the status), ally_below (x x while the ally is below the line). Answer {v, draws}. VOLATILE (draws). combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the unique active (the simulator doActive). An attacker: Confused, the shape of its hits (ABL raises the amounts; a gate turns its host off; per_ally; status lists), each hit then its riders (apply, random_apply: their draws AFTER the hit), on_crit and on_kill (the next standing enemy), the area hits, lifesteal (to: an ally), guard_up, then Empowered and the Mark end. A support: its blocks in order with their attachments ("to" allies; coin draws before the crit roll; a crit roll for shield, heal, empower, rally and an Expose / Weaken / Mark; apply per; random_apply), the smite last (vs_status, payoff_dmg, crit_add; area: every other enemy). Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql, T1 parts: combat_v2_ability_builder.sql.$cm$;
comment on function public.subjects_ability_v2_check() is $cm$Trigger (before insert, update of ability_v2 on subjects): a v2 ability {role, name, blocks, silver} must pass ability_v2_check; NULL passes. combat_v2_ability_builder.sql.$cm$;

notify pgrst, 'reload schema';
