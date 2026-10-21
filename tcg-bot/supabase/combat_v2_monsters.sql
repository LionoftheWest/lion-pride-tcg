-- combat_v2_monsters.sql (2026-10-21): combat v2, phase 4, PR E7: the monsters (docs/combat-redesign-plan.md sections 8, 9.1, 14).
-- Needs combat_v2_min_share.sql (T1c) first, and so T1b, T1, E6, E5, E4, E3, E2, E1 and V1.
-- Before: a v2 card can act (E6, T1), but an enemy cannot: no boss move table, no Cataclysm, no foe moves, no counter moves, and only some enemy
-- mechanics work in SQL (Ironhide, True Strike, Sunder, Shatter, Thick Hide, Dispeller, Unstoppable, the *-born immunities). The simulator
-- (card-studio/v2sim engine.mjs) runs all of them.
-- After this file (the reference is the simulator: engine.mjs Battle.act, enemyAct, bossMove, bossTarget, enemyHit, pickCard, apply, blocked,
-- damage, fall, heal, addShield, endStep, cardHit, smite, doActive; modes.mjs makeBoss, makeFoe, ownPassives, foeMoves):
--   BALANCE enemy_v2 (a new key with its own fixed shape enemy_v2_spec and trigger balance_check_enemy_v2; NOT named v2_*, so V1's spec function stays):
--     rules = the numbers of the boss rules (config.json v2_boss_rules: fade, plated, rollback, bloodrot, brittle, time_lock, mirror_hide, tilt, siphon,
--     crush, rubberband, rollout, swarm, brood, permafrost_heart; undying has its one home in v2_dungeon.passive_params.undying), bosses.<key> = the
--     numbers of each named Hunt boss (config.json v2_bosses: hp_factor, counter_share, params = its own mechanic numbers, moves.<id> = the numbers of
--     each counter move). The words of the bosses are rows (below); one number, one home.
--   THE MECHANICS enemy_mechanics (plan 8.2, 9.1: "new rows in passives with params"; NOT rows of passives, whose v1 readers passives_for and
--     dungeon_make_foe would draw them): one row for each enemy mechanic of the simulator (38): key, ord, kind (passive | rule), label, numbers (the
--     balance object of its numbers), on_boss / on_foe (where it can appear), text (the one-line text, the card text style: "this enemy", "a card",
--     harmful status, steps; each number is a {leaf} of numbers, no digit), counters / favors (the archetypes of plan 7.4 that it counters or favors;
--     only where the plan settles it), note.
--   THE MONSTERS dungeon_monsters_v2 (plan 8.3): one row for each monster of dungeon_monsters (v1 stays as it is): its own copy of hp and atk (V1 rule:
--     v2 has its own copy of a number that equals live v1 today), moves (the v1 moves with the v2 status moves of moves_v2.rename: [{k, w, name, text}]),
--     passive (its own passive at the room kinds passive_kinds, else v2_dungeon.monster_passives.kinds) and aura (the raptor Pack in hordes).
--   THE BOSSES hunt_bosses_v2 (plan 8.4): the 16 named Hunt bosses of config.json v2_bosses: name, resists (immune statuses), sig (the signature
--     mechanics), mythic and mythic_resists (the Mythic adds), moves (the words of each counter move: id, k, tgt, status, key, role, cls, apply.status,
--     flags; the numbers are in balance enemy_v2.bosses.<key>.moves.<id>), weak_to (the "Weak to" rule tags: Nathan's choice, empty), note.
--   THE ENGINE (VOLATILE where it draws): combat_v2_enemy_act(state, actor, opts, numbers) = one action of an enemy: the Hunt boss (the move table of
--     v2_enemy.boss_moves, the Charging turn and the Cataclysm every cycle-th turn, the counter moves with counter_share), a Dungeon foe (the Cataclysm of
--     the kinds that charge, Bulwark, the weighted moves and the v2 status moves). combat_v2_boss_move (the 21 counter move kinds), combat_v2_boss_target,
--     combat_v2_pick_card (Warden taunt), combat_v2_enemy_hit (a hit on a card with Crush, Frost Aura, Venom, Burning, Slowing, Swarm, Pack),
--     combat_v2_enemy_mult, combat_v2_drop (Undying, Volatile Core), combat_v2_volatile, combat_v2_mech (the numbers of a mechanic with the unit's own
--     params), combat_v2_timed (the timed enemy states: evade, emp_x, heal_cut, desync_control, desync_smite, mirror_smite, rubberband, steadfast_kinds,
--     card_shield_x, heal_mirror, rot), combat_v2_enemy_numbers.
--   REPLACED (each gives its old answer on a state with no E7 key and no E7 mechanic; the test proves it on random fights): fight_state_check_v2 (a status
--     may hold locked and extra), combat_v2_advance (Time Lock), combat_v2_hit (Mirror Hide, evade, emp_x, the unit's own params, the Weak-to week, Steadfast,
--     Brood, Pack, Swarm, ignore_shield, the shield lost), combat_v2_status_apply (Permafrost Heart, resists, Desync, Tilt, Rubberband, the Controller week
--     control_add, locked, Brittle and Calcify on card shields, last_debuffer), combat_v2_status_cure (a locked status stays), combat_v2_damage (Steadfast,
--     Brood, Undying, Volatile Core with draws), combat_v2_hit_apply (Brood, Undying, the Volatile flag), combat_v2_heal (Bloodrot, heal_cut, the step heal
--     count, heal_mirror), combat_v2_step_end (Plaguebearer, Regrowth heals, Siphon, a 3-argument form with draws), combat_v2_turn_start (the enemy turn
--     count, Purify every Nth action, Elusive, the extra skip of the Controller week, a skip ends Charging = the Cataclysm cancel, banned cards),
--     combat_v2_next (the draws of the step end), combat_effect_v2_gate (enemy_charging reads charging, as the simulator; it read cataclysm),
--     combat_effect_v2_hit (Volatile Core), combat_effect_v2_basic (Rollback on Artillery, the second strike and the splash are kinds),
--     combat_effect_v2_active (Mirror Hide on strikes and area hits, Rollback, Desync and Mirror on smites, last_smite, Rot on a cure, Detonate draws),
--     combat_v2_card_act (last_support).
--   BUILDERS: combat_v2_hunt_boss(tier, key, opts, numbers) (makeBoss: HP = tier HP x asc3_hp_x x hp_factor, the tier stats, sig + Mythic, resists, moves,
--     Plated, Fade, Brood), combat_v2_dungeon_foe(monster, floor, room, kind, mechanics, numbers) (makeFoe: growth, kind, own passive, aura, moves), and
--     THE TEMPLATE hunt_boss_v2_card(key, tier) (plan 8.4: Weak to, Resists, Signature with its texts, Counters, Bring).
--   NEW UNIT KEYS of a v2 state: an enemy: turn, charging, cataclysm (a foe kind that charges), mechanics, resists, params, moves (a foe: [{k, w}]),
--     moves2 and counter_share (a named boss), weak_role, healer, brood, blocked, cleared, last_smite, last_debuffer, undying_used, rubber_step, timed
--     ({key: {v, until}}: active while until is NULL or above the clock); a card: banned, healed ({step, v}), timed (heal_cut); a status: locked, extra;
--     state ext: healed ({step, v}: the card heals of the step), last_support.
--   DRAW SLOTS (the simulator's rng calls in order): enemy act: boss [counter] [counter pick] or [move], foe [move] [Confused...], then the moves (pick card
--     [pick], a hit [Blinded] [dodge] roll, statuses [resolve] [unstoppable]); step end: Plaguebearer [pick] and its Poison; Volatile Core: one hit on each card.
-- NO CHANGE IN PLAY: no v1 function calls a new or replaced function or reads the new tables or enemy_v2, the flag stays OFF, and no v1 function changes
-- (the test compares the md5 of every other public function). Every number is in balance (C1: only 0 and 1 in the bodies of the combat_ functions).
-- Idempotent. Server only. Test: card-studio/scripts/test-combat-v2-monsters.mjs (rolled back; SQL = the simulator on random fights with enemy actions;
-- MUTATE=all must catch every mutation).

-- ============================================================ 1. balance: the key enemy_v2
create or replace function public.enemy_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"rules": {"fade":{"evasion_add":"num 0 1"},"plated":{"def":"num 0 1"},"rollback":{"smite_x":"num 0 1","artillery_basic_x":"num 0 1","artillery_true_strike":"bool"},"bloodrot":{"card_heal_x":"num 0 1"},"brittle":{"card_shield_x":"num 0 1"},"time_lock":{},"mirror_hide":{"extra_x":"num 0 1","splash_x":"num 0 1","strikes_x":"num 0 1"},"tilt":{"x":"num 0 10","dur":"int 1 999"},"siphon":{"x":"num 0 10"},"crush":{"x":"num 0 10"},"rubberband":{},"rollout":{"weaken":"num 0 1"},"swarm":{"x":"num 0 10"},"brood":{"dr":"num 0 1","start":"int 1 10","max":"int 1 10"},"permafrost_heart":{}},
 "bosses": {
   "warlord": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"tilt":{"x":"num 0 10","dur":"int 1 999"},"alt_f4":{},"rage_spiral":{"per":"num 0 1","max":"int 1 10","dur":"int 1 999"},"flame":{"x":"num 0 10","vs_last_debuffer":"num 0 10"}}},
   "nightshade": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"fade":{"v":"num 0 10","dur":"int 1 999"},"veil":{},"demotion":{"x":"num 0 10","apply":{"value":"num 0 10"}},"nightshade":{"x":"num 0 10","apply":{"stacks":"int 1 10"}}}},
   "netcode": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"lag_hit":{"x":"num 0 10"},"packet_storm":{"x":"num 0 10"},"lag_spike":{"x":"num 0 10"}}},
   "vampire": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"bloodrot":{"x":"num 0 10","heal_cut":{"x":"num 0 10","dur":"int 1 999"}},"siphon":{},"feast":{"x":"num 0 10"},"anemia":{"x":"num 0 10","vs_role":{"medic":"num 0 10"}}}},
   "warzombie": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"decay":{"x":"num 0 10"},"infect":{"x":"num 0 10","apply":{"stacks":"int 1 10"},"heal_cut":{"x":"num 0 10","dur":"int 1 999"}},"groan":{"n":"int 1 10"},"undying":{"v":"num 0 10","dur":"int 1 999"}}},
   "maw": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"dispeller":{"x":"num 0 10"}},"moves":{"nerf":{},"patch_notes":{"v":"num 0 10","dur":"int 1 999"},"tier_list":{"x":"num 0 10"},"counter_pick":{"value":"num 0 10"}}},
   "smurf": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"shatter":{},"crush":{"crush":"num 0 10"},"bully":{"x":"num 0 10"},"fake_rank":{"x":"num 0 10","vs_shielded":"num 0 10"}}},
   "skeleton": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"bone_pierce":{"x":"num 0 10"},"rattle":{"v":"num 0 10"},"calcify":{"v":"num 0 10","dur":"int 1 999"},"stuck":{"x":"num 0 10"}}},
   "pumpkin": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"purify":{"every":"int 1 10"}},"moves":{"hotfix":{"value":"num 0 10"},"rollout":{"value":"num 0 10"},"rot":{"v":"num 0 10","dur":"int 1 999"},"patch":{"n":"int 1 10"}}},
   "lagspike": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"desync":{"v":"num 0 10","dur":"int 1 999"},"rubberband":{"v":"num 0 10","dur":"int 1 999"},"lag_spike":{"n":"int 1 10"},"packet_loss":{}}},
   "banwave": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"ban":{"n":"int 1 10"},"wave":{"n":"int 1 10"},"appeal_denied":{"x":"num 0 10"},"shadow_ban":{}}},
   "zerg": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{},"moves":{"swarm":{"x":"num 0 10","vs_cls":{"support":"num 0 10"}},"brood":{"n":"int 1 10"},"rush":{"x":"num 0 10","n":"int 1 10"},"overrun":{"x":"num 0 10"}}},
   "salt_miner": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"purify":{"every":"int 1 10"}},"moves":{"salt_spray":{},"grind":{"x":"num 0 10"},"dig_in":{"v":"num 0 10"},"cash_out":{"per":"num 0 1","max":"num 0 10"}}},
   "frost_lich": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"frost_aura":{"chill":"int 1 10"}},"moves":{"frost_nova":{"stacks":"int 1 10"},"ice_wall":{"v":"num 0 10"},"glacial":{"n":"int 1 10"},"shatter_bones":{"x":"num 0 10","vs_frozen":"num 0 10"}}},
   "camper_colossus": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"steadfast":{"dr":"num 0 1"}},"moves":{"hold":{"v":"num 0 10"},"bash":{"x":"num 0 10","vs_shielded":"num 0 10"},"stand_firm":{"v":"num 0 10","dur":"int 1 999"},"push":{"x":"num 0 10"}}},
   "hydra": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"regrowth":{"boss_heal":"num 0 10"}},"moves":{"regrow":{"v":"num 0 10"},"new_head":{},"bite":{"x":"num 0 10","apply":{"stacks":"int 1 10"}}}}
 }}'::jsonb;
$fn$;

create or replace function public.balance_check_enemy_v2() returns trigger language plpgsql set search_path = public as $fn$
declare errs text[];
begin
  if new.key is distinct from 'enemy_v2' then return new; end if;
  errs := balance_shape_errors(new.value, enemy_v2_spec(), '');
  if cardinality(errs) = 0 and (new.value->'rules'->'brood'->>'start')::int > (new.value->'rules'->'brood'->>'max')::int then
    errs := errs || 'rules.brood.start is above rules.brood.max'::text;
  end if;
  if cardinality(errs) > 0 then raise exception 'balance %: %', new.key, array_to_string(errs, '; '); end if;
  return new;
end $fn$;
drop trigger if exists balance_check_enemy_v2 on public.balance;
create trigger balance_check_enemy_v2 before insert or update on public.balance
  for each row execute function public.balance_check_enemy_v2();

select set_config('balance.by', 'nathan', true);
insert into public.balance (key, value, note) values
('enemy_v2', '{"rules":{"fade":{"evasion_add":0.3},"plated":{"def":0.5},"rollback":{"smite_x":0.5,"artillery_basic_x":0.18,"artillery_true_strike":false},"bloodrot":{"card_heal_x":0.6},"brittle":{"card_shield_x":0.4},"time_lock":{},"mirror_hide":{"extra_x":0,"splash_x":0,"strikes_x":0.7},"tilt":{"x":1.4,"dur":2},"siphon":{"x":1},"crush":{"x":0.5},"rubberband":{},"rollout":{"weaken":0.3},"swarm":{"x":2},"brood":{"dr":0.06,"start":5,"max":5},"permafrost_heart":{}},"bosses":{"warlord":{"hp_factor":0.71,"counter_share":0.4,"params":{},"moves":{"tilt":{"x":1.4,"dur":2},"alt_f4":{},"rage_spiral":{"per":0.2,"max":3,"dur":2},"flame":{"x":0.35,"vs_last_debuffer":2}}},"nightshade":{"hp_factor":0.73,"counter_share":0.4,"params":{},"moves":{"fade":{"v":0.1,"dur":4},"veil":{},"demotion":{"x":1,"apply":{"value":0.2}},"nightshade":{"x":1,"apply":{"stacks":1}}}},"netcode":{"hp_factor":0.87,"counter_share":0.4,"params":{},"moves":{"lag_hit":{"x":1},"packet_storm":{"x":0.35},"lag_spike":{"x":1.5}}},"vampire":{"hp_factor":0.92,"counter_share":0.55,"params":{},"moves":{"bloodrot":{"x":1,"heal_cut":{"x":0.4,"dur":4}},"siphon":{},"feast":{"x":1},"anemia":{"x":0.35,"vs_role":{"medic":2}}}},"warzombie":{"hp_factor":1.08,"counter_share":0.4,"params":{},"moves":{"decay":{"x":1},"infect":{"x":0.35,"apply":{"stacks":2},"heal_cut":{"x":0,"dur":4}},"groan":{"n":1},"undying":{"v":0.1,"dur":8}}},"maw":{"hp_factor":1.1,"counter_share":0.4,"params":{"dispeller":{"x":0}},"moves":{"nerf":{},"patch_notes":{"v":0.5,"dur":999},"tier_list":{"x":2},"counter_pick":{"value":0.2}}},"smurf":{"hp_factor":1.26,"counter_share":0.55,"params":{},"moves":{"shatter":{},"crush":{"crush":0.5},"bully":{"x":1},"fake_rank":{"x":1,"vs_shielded":2}}},"skeleton":{"hp_factor":0.79,"counter_share":0.55,"params":{},"moves":{"bone_pierce":{"x":1},"rattle":{"v":0.1},"calcify":{"v":0.5,"dur":8},"stuck":{"x":1}}},"pumpkin":{"hp_factor":0.95,"counter_share":0.4,"params":{"purify":{"every":2}},"moves":{"hotfix":{"value":0.3},"rollout":{"value":0.3},"rot":{"v":1,"dur":999},"patch":{"n":1}}},"lagspike":{"hp_factor":0.88,"counter_share":0.4,"params":{},"moves":{"desync":{"v":1,"dur":999},"rubberband":{"v":1,"dur":8},"lag_spike":{"n":1},"packet_loss":{}}},"banwave":{"hp_factor":1.02,"counter_share":0.4,"params":{},"moves":{"ban":{"n":2},"wave":{"n":1},"appeal_denied":{"x":2},"shadow_ban":{}}},"zerg":{"hp_factor":0.64,"counter_share":0.55,"params":{},"moves":{"swarm":{"x":0.35,"vs_cls":{"support":3}},"brood":{"n":1},"rush":{"x":1,"n":2},"overrun":{"x":1}}},"salt_miner":{"hp_factor":1.03,"counter_share":0.4,"params":{"purify":{"every":2}},"moves":{"salt_spray":{},"grind":{"x":0.35},"dig_in":{"v":0.1},"cash_out":{"per":0.02,"max":0.06}}},"frost_lich":{"hp_factor":0.93,"counter_share":0.4,"params":{"frost_aura":{"chill":2}},"moves":{"frost_nova":{"stacks":1},"ice_wall":{"v":0.1},"glacial":{"n":2},"shatter_bones":{"x":1,"vs_frozen":2}}},"camper_colossus":{"hp_factor":0.57,"counter_share":0.4,"params":{"steadfast":{"dr":0.5}},"moves":{"hold":{"v":0.1},"bash":{"x":1,"vs_shielded":2},"stand_firm":{"v":4,"dur":4},"push":{"x":0.35}}},"hydra":{"hp_factor":0.9,"counter_share":0.4,"params":{"regrowth":{"boss_heal":0.004}},"moves":{"regrow":{"v":0.015},"new_head":{},"bite":{"x":1,"apply":{"stacks":1}}}}}}',
 $n$Combat v2: the monsters (plan 8; combat_v2_monsters.sql). rules.<name> = the numbers of the boss rules (fade evasion_add; plated def = the Defense it has at least; rollback smite_x on smites and artillery_basic_x on Artillery basics, which then can miss unless artillery_true_strike; bloodrot card_heal_x on card heals while it stands; brittle card_shield_x on card shields while it stands; time_lock: Quickened does nothing on cards while it stands; mirror_hide extra_x on second strikes, splash_x on splash and area hits, strikes_x on multi-strike actives; tilt: a blocked harmful status Enrages it x for dur steps; siphon x times the card heals of the step; crush x of the shield a hit removed; rubberband: after a blocked control it acts again, once a step; rollout Weakened weaken on every card at each Cataclysm; swarm x on support cards from area hits; brood dr less damage for each stack, start stacks, at most max; permafrost_heart: a Chill on it comes back to the card). Undying has its one home in v2_dungeon.passive_params.undying. bosses.<key> = the numbers of each named Hunt boss (the words are rows of hunt_bosses_v2): hp_factor (Hunt boss HP = v2_enemy.hunt.<tier>.hp x v2_enemy.asc3_hp_x x hp_factor), counter_share (the share of its normal turns that use a counter move), params.<mechanic> (its own numbers of a mechanic, over the base numbers), moves.<id> (the numbers of each counter move). The texts are in enemy_mechanics. Read by the v2 enemy functions and the simulator (config.json v2_boss_rules and v2_bosses); nothing reads it until combat_v2 hunt, dungeon or gauntlet is on. Shape: enemy_v2_spec (trigger balance_check_enemy_v2).$n$)
on conflict (key) do nothing;

-- ============================================================ 2. the mechanics, the monsters and the bosses as data
create table if not exists public.enemy_mechanics (
  key text primary key check (key ~ '^[a-z_]+$'),
  ord smallint not null unique check (ord >= 1),
  kind text not null check (kind in ('passive', 'rule')),
  label text not null check (label <> '' and label = btrim(label)),
  numbers text not null check (numbers ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  on_boss boolean not null,
  on_foe boolean not null,
  text text not null,
  counters text[] not null default '{}' check (counters <@ array['toxic', 'wildfire', 'shatter', 'mark_hunt', 'wall', 'crit_chain', 'cleave', 'lockdown', 'pile_on', 'heralds_court']),
  favors text[] not null default '{}' check (favors <@ array['toxic', 'wildfire', 'shatter', 'mark_hunt', 'wall', 'crit_chain', 'cleave', 'lockdown', 'pile_on', 'heralds_court']),
  note text,
  updated_at timestamptz not null default now(),
  check (on_boss or on_foe)
);
alter table public.enemy_mechanics enable row level security;
comment on table public.enemy_mechanics is 'Combat v2 enemy mechanics (plan 8.2, 9.1; combat_v2_monsters.sql): one row for each mechanic of the simulator. kind passive (v2_enemy.mechanics, v2_dungeon.passive_params) or rule (a boss rule, enemy_v2.rules); numbers = the balance object of its numbers; on_boss / on_foe = where it can appear; text = the one-line text (each number a {leaf} of numbers, no digit); counters / favors = the archetypes of plan 7.4 that it counters or favors (the boss template: Signature and Bring). Beside the v1 table passives, which v1 combat reads. Service role only.';

create or replace function public.enemy_mechanics_check() returns trigger language plpgsql set search_path = public as $fn$
declare e text[];
begin
  if jsonb_typeof(balance_path(new.numbers)) is distinct from 'object' then
    raise exception 'enemy_mechanics %: numbers % is not a balance object', new.key, new.numbers;
  end if;
  e := balance_text_errors(new.text, new.numbers);
  if cardinality(e) > 0 then raise exception 'enemy_mechanics %: %', new.key, array_to_string(e, '; '); end if;
  if new.text ~* '\m(foe|debuff|negative|you|your)\M' or new.text like '%;%' or new.text like '%(%' then
    raise exception 'enemy_mechanics %: the card text style (no foe, debuff, negative, you, semicolon or parenthesis)', new.key;
  end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists enemy_mechanics_check on public.enemy_mechanics;
create trigger enemy_mechanics_check before insert or update on public.enemy_mechanics for each row execute function public.enemy_mechanics_check();

insert into public.enemy_mechanics (ord, key, kind, label, numbers, on_boss, on_foe, text, counters, favors) values
( 1, 'purify',       'passive', 'Purify',       'v2_enemy.mechanics.purify',       true,  true,  'Every {every} actions, this enemy removes all of its harmful statuses.', '{toxic,wildfire,lockdown,pile_on}', '{}'),
( 2, 'ironhide',     'passive', 'Ironhide',     'v2_enemy.mechanics.ironhide',     true,  true,  'Cards have no crit chance against this enemy unless it is Marked.', '{crit_chain}', '{mark_hunt}'),
( 3, 'true_strike',  'passive', 'True Strike',  'v2_enemy.mechanics.true_strike',  true,  true,  'Cards cannot dodge the hits of this enemy.', '{}', '{}'),
( 4, 'shatter',      'passive', 'Shatter',      'v2_enemy.mechanics.shatter',      true,  true,  'The hits of this enemy deal {shield_x} times the damage to shields.', '{wall}', '{}'),
( 5, 'regrowth',     'passive', 'Regrowth',     'v2_enemy.mechanics.regrowth',     true,  true,  'Each step, this enemy heals {heal} of its max HP. A Hunt boss heals {boss_heal} of its heal base.', '{}', '{wildfire}'),
( 6, 'frost_aura',   'passive', 'Frost Aura',   'v2_enemy.mechanics.frost_aura',   true,  true,  'Each single hit of this enemy applies {chill} Chill to the card it hits.', '{}', '{}'),
( 7, 'thick_hide',   'passive', 'Thick Hide',   'v2_enemy.mechanics.thick_hide',   true,  true,  'Exposed on this enemy is at most +{expose_cap} damage.', '{pile_on}', '{}'),
( 8, 'unstoppable',  'passive', 'Unstoppable',  'v2_enemy.mechanics.unstoppable',  true,  true,  'Each Stunned, Frozen, Asleep or Paralyzed status on this enemy fails {control_fail} of the time.', '{shatter,lockdown}', '{}'),
( 9, 'venom',        'passive', 'Venom',        'v2_enemy.mechanics.venom',        true,  true,  'Each single hit of this enemy applies {poison} Poison to the card it hits.', '{wall}', '{}'),
(10, 'burning',      'passive', 'Burning',      'v2_enemy.mechanics.burning',      false, true,  'Each single hit of this enemy applies {burn} Burn to the card it hits.', '{}', '{wall}'),
(11, 'sunder',       'passive', 'Sunder',       'v2_enemy.mechanics.sunder',       true,  true,  'The hits of this enemy ignore {pierce} of card Defense.', '{}', '{wall}'),
(12, 'slowing',      'passive', 'Slowing',      'v2_enemy.mechanics.slowing',      true,  false, 'Each area hit of this enemy Slows the card it hits.', '{}', '{}'),
(13, 'elusive',      'passive', 'Elusive',      'v2_enemy.mechanics.elusive',      true,  true,  'A Mark on this enemy ends when it acts.', '{mark_hunt}', '{}'),
(14, 'toxic_born',   'passive', 'Toxic-born',   'v2_enemy.mechanics.toxic_born',   false, true,  'This enemy is immune to Poison.', '{toxic}', '{}'),
(15, 'fireborn',     'passive', 'Fireborn',     'v2_enemy.mechanics.fireborn',     false, true,  'This enemy is immune to Burn.', '{wildfire}', '{}'),
(16, 'frostborn',    'passive', 'Frostborn',    'v2_enemy.mechanics.frostborn',    false, true,  'This enemy is immune to Chill and Frozen.', '{shatter}', '{}'),
(17, 'steadfast',    'passive', 'Steadfast',    'v2_enemy.mechanics.steadfast',    true,  false, 'This enemy takes {dr} less damage until it has {kinds} different harmful statuses.', '{}', '{pile_on}'),
(18, 'dispeller',    'passive', 'Dispeller',    'v2_enemy.mechanics.dispeller',    true,  false, 'Empowered and Exposed work at {x} against this enemy.', '{heralds_court}', '{crit_chain}'),
(19, 'bulwark',      'passive', 'Bulwark',      'v2_dungeon.passive_params.bulwark',      false, true, 'Every {every} actions, this enemy Guards for {guard} of its max HP.', '{}', '{toxic}'),
(20, 'plaguebearer', 'passive', 'Plaguebearer', 'v2_dungeon.passive_params.plaguebearer', false, true, 'Each Poison tick on this enemy applies {poison} Poison to a random card.', '{}', '{}'),
(21, 'undying',      'passive', 'Undying',      'v2_dungeon.passive_params.undying',      true,  true, 'Once a fight, this enemy comes back with {hp} of its max HP, unless it is Burning or Poisoned.', '{}', '{}'),
(22, 'volatile_core','passive', 'Volatile Core','v2_dungeon.passive_params.volatile_core',false, true, 'When this enemy falls, it hits every card for {x} of its attack, unless it is Stunned or Frozen.', '{}', '{shatter,lockdown,wall}'),
(23, 'pack',         'passive', 'Pack',         'v2_dungeon.passive_params.pack',         false, true, 'This enemy has +{atk_per_foe} attack for each standing enemy.', '{}', '{}'),
(24, 'fade',         'rule',    'Fade',         'enemy_v2.rules.fade',         true, false, 'This enemy has +{evasion_add} evasion.', '{}', '{}'),
(25, 'plated',       'rule',    'Plated',       'enemy_v2.rules.plated',       true, false, 'This enemy has at least {def} Defense.', '{}', '{}'),
(26, 'rollback',     'rule',    'Rollback',     'enemy_v2.rules.rollback',     true, false, 'Smites on this enemy deal {smite_x} of their damage. Artillery basic attacks on it deal {artillery_basic_x} and can miss.', '{}', '{}'),
(27, 'bloodrot',     'rule',    'Bloodrot',     'enemy_v2.rules.bloodrot',     true, false, 'While this enemy stands, card heals work at {card_heal_x}.', '{}', '{}'),
(28, 'brittle',      'rule',    'Brittle',      'enemy_v2.rules.brittle',      true, false, 'While this enemy stands, card shields work at {card_shield_x}.', '{}', '{}'),
(29, 'time_lock',    'rule',    'Time Lock',    'enemy_v2.rules.time_lock',    true, false, 'While this enemy stands, Quickened does nothing on cards.', '{}', '{}'),
(30, 'mirror_hide',  'rule',    'Mirror Hide',  'enemy_v2.rules.mirror_hide',  true, false, 'Second strikes on this enemy deal {extra_x} and splash or area hits deal {splash_x} of their damage. Strikes of a multi-strike active deal {strikes_x}.', '{}', '{}'),
(31, 'tilt',         'rule',    'Tilt',         'enemy_v2.rules.tilt',         true, false, 'When this enemy blocks a harmful status, it deals {x} times the damage for {dur} steps.', '{}', '{}'),
(32, 'siphon',       'rule',    'Siphon',       'enemy_v2.rules.siphon',       true, false, 'At the end of each step, this enemy heals {x} times the HP that the cards healed in that step.', '{}', '{}'),
(33, 'crush',        'rule',    'Crush',        'enemy_v2.rules.crush',        true, false, 'A card whose shield this enemy breaks also takes {x} of that shield as damage.', '{}', '{}'),
(34, 'rubberband',   'rule',    'Rubberband',   'enemy_v2.rules.rubberband',   true, false, 'After this enemy blocks Stunned, Frozen, Asleep or Paralyzed, it acts again, once a step.', '{}', '{}'),
(35, 'rollout',      'rule',    'Rollout',      'enemy_v2.rules.rollout',      true, false, 'At each Cataclysm, this enemy Weakens every card by {weaken}.', '{}', '{}'),
(36, 'swarm',        'rule',    'Swarm',        'enemy_v2.rules.swarm',        true, false, 'The area hits of this enemy deal {x} times the damage to support cards.', '{}', '{}'),
(37, 'brood',        'rule',    'Brood',        'enemy_v2.rules.brood',        true, false, 'This enemy starts with {start} Brood stacks, at most {max}. It takes {dr} less damage for each stack. A Cleaver hit or a Burn tick removes one.', '{}', '{}'),
(38, 'permafrost_heart', 'rule', 'Permafrost Heart', 'enemy_v2.rules.permafrost_heart', true, false, 'A Chill that a card applies to this enemy also applies to that card.', '{}', '{}')
on conflict (key) do nothing;

create table if not exists public.dungeon_monsters_v2 (
  key text primary key references public.dungeon_monsters (key),
  hp integer not null check (hp > 0),
  atk integer not null check (atk > 0),
  moves jsonb not null check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) >= 1),
  passive text references public.enemy_mechanics (key),
  passive_kinds text[] check (passive_kinds <@ array['fight', 'horde', 'elite', 'miniboss', 'guardian']),
  aura text references public.enemy_mechanics (key),
  note text,
  updated_at timestamptz not null default now()
);
alter table public.dungeon_monsters_v2 enable row level security;
comment on table public.dungeon_monsters_v2 is 'Combat v2 Dungeon and Gauntlet monsters (plan 8.3; combat_v2_monsters.sql): its own copy of hp and atk, moves [{k, w, name, text}] (the v1 moves with the v2 status moves; w = the weight of the move; a status move has its text with the {leaf} numbers of v2_dungeon.moves_v2.<k>), passive (its own passive at the room kinds passive_kinds, NULL = v2_dungeon.monster_passives.kinds), aura (an aura at v2_dungeon.monster_passives.<aura>.kinds: the raptor Pack in hordes). Beside the v1 table dungeon_monsters. Service role only.';

create or replace function public.dungeon_monsters_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare m jsonb; e text[];
begin
  for m in select x from jsonb_array_elements(new.moves) x loop
    if coalesce(m->>'k', '') not in ('strike', 'heavy', 'flurry', 'slam', 'drain', 'stun', 'poison', 'regenerate', 'guard', 'enrage', 'curse',
                                      'hellfire', 'frost_punch', 'squeeze', 'rattle', 'infect', 'idle') then
      raise exception 'dungeon_monsters_v2 %: unknown move %', new.key, m->>'k';
    end if;
    if jsonb_typeof(m->'w') is distinct from 'number' or (m->>'w')::numeric <= 0 or (m->>'w')::numeric % 1 <> 0 then
      raise exception 'dungeon_monsters_v2 %: the weight of % must be a whole number above 0', new.key, m->>'k';
    end if;
    if m ? 'text' then
      e := balance_text_errors(m->>'text', 'v2_dungeon.moves_v2.' || (m->>'k'));
      if cardinality(e) > 0 then raise exception 'dungeon_monsters_v2 % %: %', new.key, m->>'k', array_to_string(e, '; '); end if;
    end if;
  end loop;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists dungeon_monsters_v2_check on public.dungeon_monsters_v2;
create trigger dungeon_monsters_v2_check before insert or update on public.dungeon_monsters_v2 for each row execute function public.dungeon_monsters_v2_check();

insert into public.dungeon_monsters_v2 (key, hp, atk, moves, passive, passive_kinds, aura) values
('demon',    55, 14, '[{"k":"strike","w":3,"name":"Claw"},{"k":"curse","w":3,"name":"Hex"},{"k":"hellfire","w":2,"name":"Hellfire","text":"A heavy hit for {x} of its attack. Apply {burn} Burn to the card."},{"k":"regenerate","w":1,"name":"Dark Pact"}]', 'burning', null, null),
('giant',    75, 15, '[{"k":"strike","w":3,"name":"Punch"},{"k":"heavy","w":3,"name":"Smash"},{"k":"slam","w":3,"name":"Stomp"},{"k":"enrage","w":1,"name":"Roar"}]', 'volatile_core', null, null),
('golem',    85, 12, '[{"k":"strike","w":2,"name":"Slam"},{"k":"heavy","w":3,"name":"Rock Fist"},{"k":"slam","w":3,"name":"Quake"},{"k":"guard","w":2,"name":"Stone Skin"}]', 'bulwark', '{guardian}', null),
('ooze',     45, 10, '[{"k":"poison","w":4,"name":"Acid Spit"},{"k":"strike","w":3,"name":"Bounce"},{"k":"slam","w":2,"name":"Splash"},{"k":"guard","w":1,"name":"Ooze Shield"}]', 'plaguebearer', null, null),
('raptor',   50, 14, '[{"k":"strike","w":3,"name":"Bite"},{"k":"flurry","w":4,"name":"Claw Flurry"},{"k":"heavy","w":2,"name":"Pounce"},{"k":"enrage","w":1,"name":"Howl"}]', 'shatter', null, 'pack'),
('skeleton', 50, 13, '[{"k":"strike","w":4,"name":"Bone Slash"},{"k":"heavy","w":2,"name":"Bone Throw"},{"k":"rattle","w":2,"name":"Rattle","text":"Expose a card to +{exposed} damage."},{"k":"guard","w":1,"name":"Shield Up"}]', 'sunder', null, null),
('slime',    40, 10, '[{"k":"strike","w":4,"name":"Bounce"},{"k":"slam","w":3,"name":"Splash"},{"k":"drain","w":3,"name":"Engulf"}]', 'regrowth', null, null),
('squid',    45, 12, '[{"k":"strike","w":2,"name":"Lash"},{"k":"flurry","w":4,"name":"Tentacles"},{"k":"squeeze","w":2,"name":"Squeeze","text":"Hit a card for {x} of its attack. Blind it."},{"k":"curse","w":2,"name":"Ink Blast"}]', 'elusive', null, null),
('yeti',     70, 13, '[{"k":"strike","w":4,"name":"Maul"},{"k":"slam","w":3,"name":"Avalanche"},{"k":"frost_punch","w":2,"name":"Frost Punch","text":"Hit a card for {x} of its attack. Apply {chill} Chill to it."},{"k":"enrage","w":1,"name":"Rage"}]', 'frost_aura', null, null),
('zombie',   60, 11, '[{"k":"strike","w":4,"name":"Claw"},{"k":"drain","w":3,"name":"Bite"},{"k":"infect","w":2,"name":"Infect","text":"Hit a card for {x} of its attack. Apply {poison} Poison to it. It cannot heal for {no_heal} steps."},{"k":"enrage","w":1,"name":"Groan"}]', 'undying', '{miniboss,guardian}', null)
on conflict (key) do nothing;

create table if not exists public.hunt_bosses_v2 (
  key text primary key check (key ~ '^[a-z_]+$'),
  ord smallint not null unique check (ord >= 1),
  name text not null check (name <> '' and name = btrim(name)),
  resists text[] not null default '{}',
  sig text[] not null check (cardinality(sig) >= 1),
  mythic text[] not null default '{}',
  mythic_resists text[] not null default '{}',
  moves jsonb not null check (jsonb_typeof(moves) = 'array'),
  weak_to text[] not null default '{}' check (cardinality(weak_to) <= 3),
  note text,
  updated_at timestamptz not null default now()
);
alter table public.hunt_bosses_v2 enable row level security;
comment on table public.hunt_bosses_v2 is 'Combat v2 named Hunt bosses (plan 8.4; combat_v2_monsters.sql; config.json v2_bosses): name, resists (immune statuses), sig (signature mechanics of enemy_mechanics), mythic and mythic_resists (the Mythic adds), moves (the words of each counter move: id, k, tgt, status, statuses, key, role, cls, apply.status, ignore_shield, decay, locked, enrage_on_kill; the numbers are in balance enemy_v2.bosses.<key>.moves.<id>), weak_to (1 to 3 rule tags: Nathan''s choice), note (what the simulator runs instead of the design). Service role only.';

create or replace function public.hunt_bosses_v2_check() returns trigger language plpgsql set search_path = public as $fn$
declare m jsonb; k text; ids text[] := '{}'; nb jsonb;
begin
  foreach k in array new.sig || new.mythic loop
    if not exists (select 1 from public.enemy_mechanics x where x.key = k and x.on_boss) then raise exception 'hunt_bosses_v2 %: % is not a boss mechanic of enemy_mechanics', new.key, k; end if;
  end loop;
  foreach k in array new.resists || new.mythic_resists loop
    if not exists (select 1 from public.statuses x where x.key = k and x.negative and x.on_enemy) then raise exception 'hunt_bosses_v2 %: % is not a harmful enemy status', new.key, k; end if;
  end loop;
  foreach k in array new.weak_to loop
    if k !~ '^[a-z]+:[a-z0-9-]+$' then raise exception 'hunt_bosses_v2 %: weak_to % is not a rule tag', new.key, k; end if;
  end loop;
  nb := balance_path('enemy_v2.bosses.' || new.key);
  if jsonb_typeof(nb) is distinct from 'object' then raise exception 'hunt_bosses_v2 %: no numbers in balance enemy_v2.bosses.%', new.key, new.key; end if;
  for m in select x from jsonb_array_elements(new.moves) x loop
    if coalesce(m->>'id', '') !~ '^[a-z0-9_]+$' or m->>'id' = any(ids) then raise exception 'hunt_bosses_v2 %: a move needs a new id (%)', new.key, m->>'id'; end if;
    ids := ids || (m->>'id');
    if coalesce(m->>'k', '') not in ('hit', 'area', 'apply', 'guard', 'heal', 'cleanse_self', 'cash_out', 'enrage', 'spiral', 'evade', 'charge', 'strip',
                                      'strip_shields', 'skip', 'extra_action', 'brood', 'state', 'undo_smite', 'desync_smite', 'mirror_smite', 'siphon') then
      raise exception 'hunt_bosses_v2 % %: unknown move kind %', new.key, m->>'id', m->>'k';
    end if;
    if jsonb_typeof(nb->'moves'->(m->>'id')) is distinct from 'object' then raise exception 'hunt_bosses_v2 % %: no numbers in balance enemy_v2.bosses.%.moves', new.key, m->>'id', new.key; end if;
    if exists (select 1 from jsonb_each(m) y where jsonb_typeof(y.value) = 'number') then raise exception 'hunt_bosses_v2 % %: a number goes in balance, not in the row', new.key, m->>'id'; end if;
  end loop;
  if (select count(*) from jsonb_object_keys(nb->'moves')) <> cardinality(ids) then raise exception 'hunt_bosses_v2 %: the moves of the row and of balance differ', new.key; end if;
  new.updated_at := now();
  return new;
end $fn$;
drop trigger if exists hunt_bosses_v2_check on public.hunt_bosses_v2;
create trigger hunt_bosses_v2_check before insert or update on public.hunt_bosses_v2 for each row execute function public.hunt_bosses_v2_check();

insert into public.hunt_bosses_v2 (ord, key, name, resists, sig, mythic, mythic_resists, moves, note) values
( 1, 'warlord', 'Rage-Quit Warlord', '{exposed,weakened,mark}', '{ironhide}', '{tilt}', '{}', '[{"id":"tilt","k":"enrage"},{"id":"alt_f4","k":"cleanse_self"},{"id":"rage_spiral","k":"spiral"},{"id":"flame","k":"area"}]', null),
( 2, 'nightshade', 'Ranked Nightshade', '{mark}', '{fade}', '{elusive}', '{}', '[{"id":"fade","k":"evade"},{"id":"veil","k":"cleanse_self","statuses":["mark","exposed"]},{"id":"demotion","k":"hit","tgt":"random","apply":{"status":"exposed"}},{"id":"nightshade","k":"hit","tgt":"random","apply":{"status":"poison"}}]', null),
( 3, 'netcode', 'Netcode Mutant', '{paralyzed}', '{rollback}', '{ironhide}', '{mark}', '[{"id":"lag_hit","k":"hit","tgt":"random"},{"id":"packet_storm","k":"area"},{"id":"lag_spike","k":"hit","tgt":"random"}]',
  'Nathan 2026-10-19: its rule alone counters Artillery. The counter moves are generic (a hit, an area hit, a heavy hit).'),
( 4, 'vampire', 'Grind Vampire', '{}', '{bloodrot,regrowth}', '{siphon}', '{}', '[{"id":"bloodrot","k":"hit","tgt":"random"},{"id":"siphon","k":"siphon"},{"id":"feast","k":"hit","tgt":"lowest"},{"id":"anemia","k":"area"}]', null),
( 5, 'warzombie', 'AFK Warzombie', '{poison}', '{regrowth}', '{undying}', '{}', '[{"id":"decay","k":"hit","tgt":"random","decay":true},{"id":"infect","k":"hit","tgt":"random","apply":{"status":"poison"}},{"id":"groan","k":"charge","role":"medic"},{"id":"undying","k":"state","key":"heal_mirror"}]',
  'Undying (Mythic) never fires in a Hunt day (the boss does not fall). Its counter move Undying runs as: for some steps, each card heal also heals it a share of that heal.'),
( 6, 'maw', 'Maw of the Meta', '{}', '{dispeller}', '{ironhide}', '{}', '[{"id":"nerf","k":"strip","status":"empowered"},{"id":"patch_notes","k":"state","key":"emp_x"},{"id":"tier_list","k":"hit","tgt":"empowered"},{"id":"counter_pick","k":"apply","status":"weakened","tgt":"strongest_attacker"}]', null),
( 7, 'smurf', 'Smurf Brute', '{slowed}', '{shatter,brittle}', '{crush}', '{}', '[{"id":"shatter","k":"strip_shields"},{"id":"crush","k":"strip_shields"},{"id":"bully","k":"hit","tgt":"biggest_shield","ignore_shield":true},{"id":"fake_rank","k":"hit","tgt":"shielded"}]', null),
( 8, 'skeleton', 'Hardstuck Skeleton', '{}', '{plated}', '{mirror_hide}', '{}', '[{"id":"bone_pierce","k":"hit","tgt":"random","ignore_shield":true},{"id":"rattle","k":"guard"},{"id":"calcify","k":"state","key":"card_shield_x"},{"id":"stuck","k":"hit","tgt":"random","apply":{"status":"slowed"}}]', null),
( 9, 'pumpkin', 'Patch-Day Pumpkin', '{blinded,confused}', '{purify}', '{rollout}', '{}', '[{"id":"hotfix","k":"apply","status":"weakened","locked":true},{"id":"rollout","k":"apply","status":"weakened","tgt":"all"},{"id":"rot","k":"state","key":"rot"},{"id":"patch","k":"charge","role":"medic"}]',
  'Rollout (Mythic add) runs as Weakened on every card at each Cataclysm. Hotfix: a cure cannot remove that Weakened.'),
(10, 'lagspike', 'Lagspike Parasite', '{stunned,frozen,sleep,paralyzed,chill}', '{steadfast}', '{rubberband}', '{}', '[{"id":"desync","k":"state","key":"desync_control"},{"id":"rubberband","k":"state","key":"rubberband"},{"id":"lag_spike","k":"charge","role":"controller"},{"id":"packet_loss","k":"apply","status":"confused","tgt":"support"}]',
  'It resists every control, so Desync and Rubberband rarely matter.'),
(11, 'banwave', 'Ban-Wave Demon', '{}', '{time_lock}', '{mirror_hide}', '{}', '[{"id":"ban","k":"skip"},{"id":"wave","k":"charge","cls":"support"},{"id":"appeal_denied","k":"hit","tgt":"last_support"},{"id":"shadow_ban","k":"strip","status":"quickened"}]', null),
(12, 'zerg', 'Zerg-Rush Queen', '{}', '{brood}', '{swarm}', '{}', '[{"id":"swarm","k":"area"},{"id":"brood","k":"brood"},{"id":"rush","k":"hit","tgt":"weakest_support"},{"id":"overrun","k":"hit","tgt":"weakest_support","enrage_on_kill":true}]',
  'Brood starts at its start stacks a day (also the cap). A hit by a Cleaver card or a Burn tick removes one. The Brood move adds stacks.'),
(13, 'salt_miner', 'The Salt Miner', '{poison,burn}', '{purify}', '{thick_hide}', '{}', '[{"id":"salt_spray","k":"cleanse_self","statuses":["poison","burn"]},{"id":"grind","k":"area"},{"id":"dig_in","k":"guard"},{"id":"cash_out","k":"cash_out"}]', null),
(14, 'frost_lich', 'The Frame-Freeze Lich', '{chill,frozen}', '{frost_aura,permafrost_heart}', '{thick_hide}', '{}', '[{"id":"frost_nova","k":"apply","status":"chill","tgt":"all"},{"id":"ice_wall","k":"guard"},{"id":"glacial","k":"apply","status":"slowed","tgt":"n"},{"id":"shatter_bones","k":"hit","tgt":"frozen"}]', null),
(15, 'camper_colossus', 'The Camper Colossus', '{}', '{steadfast}', '{shatter,brittle}', '{}', '[{"id":"hold","k":"guard"},{"id":"bash","k":"hit","tgt":"shielded"},{"id":"stand_firm","k":"state","key":"steadfast_kinds"},{"id":"push","k":"area"}]', null),
(16, 'hydra', 'The Patch-Note Hydra', '{}', '{regrowth}', '{thick_hide}', '{}', '[{"id":"regrow","k":"heal"},{"id":"new_head","k":"extra_action"},{"id":"bite","k":"hit","tgt":"random","apply":{"status":"poison"}}]',
  'Cauterize risk is a display rule (Burn halves its heal, as for every heal), so the Hydra has 3 counter moves.')
on conflict (key) do nothing;

-- the column comments (the generated docs)
comment on column public.enemy_mechanics.key is 'The mechanic key (the simulator mech name).';
comment on column public.enemy_mechanics.ord is 'The order in lists.';
comment on column public.enemy_mechanics.kind is 'passive (v2_enemy.mechanics, v2_dungeon.passive_params) or rule (a boss rule of enemy_v2.rules).';
comment on column public.enemy_mechanics.label is 'The name on the boss card and the enemy tooltip.';
comment on column public.enemy_mechanics.numbers is 'The balance object that holds its numbers (each {leaf} of text is a number of it).';
comment on column public.enemy_mechanics.on_boss is 'It can be a signature or rule of a Hunt boss.';
comment on column public.enemy_mechanics.on_foe is 'It can be a passive of a Dungeon or Gauntlet foe (the pool, a monster''s own passive or aura).';
comment on column public.enemy_mechanics.text is 'The one-line text (the card text style; each number a {leaf} of numbers; no digit).';
comment on column public.enemy_mechanics.counters is 'The archetypes of plan 7.4 that it counters (only where the plan settles it).';
comment on column public.enemy_mechanics.favors is 'The archetypes of plan 7.4 that it favors: the Bring chip (only where the plan settles it).';
comment on column public.enemy_mechanics.note is 'A free note.';
comment on column public.enemy_mechanics.updated_at is 'Set by the trigger on each write.';
comment on column public.dungeon_monsters_v2.key is 'The monster (dungeon_monsters.key).';
comment on column public.dungeon_monsters_v2.hp is 'The v2 copy of its base HP (V1 rule: v2 has its own copy of a number that equals live v1 today).';
comment on column public.dungeon_monsters_v2.atk is 'The v2 copy of its base attack.';
comment on column public.dungeon_monsters_v2.moves is 'Its moves [{k, w, name, text}]: k = the move, w = its weight, name = the move name, text = the text of a v2 status move ({leaf} of v2_dungeon.moves_v2.<k>).';
comment on column public.dungeon_monsters_v2.passive is 'Its own passive (an enemy_mechanics key): the first passive slot at the room kinds passive_kinds.';
comment on column public.dungeon_monsters_v2.passive_kinds is 'The room kinds of its own passive; NULL = v2_dungeon.monster_passives.kinds.';
comment on column public.dungeon_monsters_v2.aura is 'Its aura (an enemy_mechanics key) at v2_dungeon.monster_passives.<aura>.kinds (the raptor Pack in hordes).';
comment on column public.dungeon_monsters_v2.note is 'A free note.';
comment on column public.dungeon_monsters_v2.updated_at is 'Set by the trigger on each write.';
comment on column public.hunt_bosses_v2.key is 'The boss key (config.json v2_bosses; balance enemy_v2.bosses.<key>).';
comment on column public.hunt_bosses_v2.ord is 'The order in lists.';
comment on column public.hunt_bosses_v2.name is 'The boss name (Nathan''s choice).';
comment on column public.hunt_bosses_v2.resists is 'The harmful statuses that it is immune to.';
comment on column public.hunt_bosses_v2.sig is 'Its signature mechanics (enemy_mechanics keys).';
comment on column public.hunt_bosses_v2.mythic is 'The mechanics that it adds at Mythic.';
comment on column public.hunt_bosses_v2.mythic_resists is 'The resists that it adds at Mythic.';
comment on column public.hunt_bosses_v2.moves is 'The words of its counter moves [{id, k, tgt, status, statuses, key, role, cls, apply {status}, flags}]; the numbers are in balance enemy_v2.bosses.<key>.moves.<id>.';
comment on column public.hunt_bosses_v2.weak_to is 'The Weak to line: 1 to 3 rule tags (Nathan''s choice; empty until he picks them).';
comment on column public.hunt_bosses_v2.note is 'What the simulator runs instead of the design.';
comment on column public.hunt_bosses_v2.updated_at is 'Set by the trigger on each write.';

-- ============================================================ 3. the numbers and the helpers
-- The numbers of an enemy action: the card action numbers (E6, T1) and balance enemy_v2. The p_b of the E7 functions.
create or replace function public.combat_v2_enemy_numbers() returns jsonb language sql stable set search_path = public as $fn$
  select combat_v2_action_numbers() || combat_v2_numbers(array['enemy_v2']);
$fn$;

-- The numbers of one mechanic of a unit (the simulator mechParams): v2_enemy.mechanics, else v2_dungeon.passive_params, else enemy_v2.rules, with the
-- unit's own params of that mechanic over them. An unknown mechanic raises.
create or replace function public.combat_v2_mech(p_b jsonb, p_unit jsonb, p_name text) returns jsonb language plpgsql immutable set search_path = public as $fn$
declare base jsonb;
begin
  base := coalesce(p_b->'v2_enemy'->'mechanics'->p_name, p_b->'v2_dungeon'->'passive_params'->p_name, p_b->'enemy_v2'->'rules'->p_name);
  if base is null then
    raise exception 'combat v2: % is not an enemy mechanic (v2_enemy.mechanics, v2_dungeon.passive_params, enemy_v2.rules)', p_name;
  end if;
  return base || coalesce(p_unit->'params'->p_name, '{}'::jsonb);
end $fn$;

-- A timed state of a unit (timed.<key> = {v, until}): its value while until is NULL (no end) or above the clock, else NULL (the simulator ext).
create or replace function public.combat_v2_timed(p_unit jsonb, p_key text, p_clock int) returns jsonb language sql immutable set search_path = public as $fn$
  select case when p_unit->'timed'->p_key is not null
                   and (jsonb_typeof(p_unit->'timed'->p_key->'until') is distinct from 'number' or (p_unit->'timed'->p_key->>'until')::int > p_clock)
              then p_unit->'timed'->p_key->'v' end;
$fn$;

-- A timed state of the first standing enemy that has it: {id, v}, else NULL (the simulator extAny).
create or replace function public.combat_v2_timed_any(p_state jsonb, p_key text) returns jsonb language sql immutable set search_path = public as $fn$
  select jsonb_build_object('id', q.id::numeric, 'v', combat_v2_timed(p_state->'enemies'->(q.id::int), p_key, (p_state->>'clock')::int))
    from combat_v2_units(p_state) q
   where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int)) and combat_v2_timed(p_state->'enemies'->(q.id::int), p_key, (p_state->>'clock')::int) is not null
   order by q.n limit 1;
$fn$;

-- The numbers of a rule of the first standing enemy that has it (Bloodrot, Brittle, Time Lock), else NULL (the simulator standing).
create or replace function public.combat_v2_standing_rule(p_state jsonb, p_name text, p_b jsonb) returns jsonb language sql immutable set search_path = public as $fn$
  select combat_v2_mech(p_b, p_state->'enemies'->(q.id::int), p_name)
    from combat_v2_units(p_state) q
   where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int)) and coalesce(p_state->'enemies'->(q.id::int)->'mechanics' ? p_name, false)
   order by q.n limit 1;
$fn$;

-- The number of different harmful statuses on a unit (the simulator negKinds).
create or replace function public.combat_v2_neg_kinds(p_unit jsonb, p_clock int, p_b jsonb) returns int language sql immutable set search_path = public as $fn$
  select count(*)::int from jsonb_object_keys(coalesce(p_unit->'status', '{}'::jsonb)) y
   where coalesce((p_b->'statuses'->y->>'negative')::boolean, false) and combat_v2_status_on(p_unit, y, p_clock) is not null;
$fn$;

-- The HP that the cards healed in the step of the clock (state ext.healed), or that one card healed (its healed).
create or replace function public.combat_v2_healed(p_obj jsonb, p_clock int) returns numeric language sql immutable set search_path = public as $fn$
  select case when (p_obj->'healed'->>'step')::int = p_clock then coalesce((p_obj->'healed'->>'v')::numeric, 0) else 0 end;
$fn$;

-- ============================================================ 4. replaced: the fight state, the speed, the hit
-- E1/E6: a status may also hold locked (true: a cure cannot remove it, the boss move Hotfix) and extra (the Controller week: Stunned or Frozen skip
-- extra more actions). Everything else as E6.
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
      if jsonb_typeof(s.value) is distinct from 'object'
         or exists (select 1 from jsonb_object_keys(s.value) y where y not in ('stacks', 'value', 'until', 'crd', 'locked', 'extra')
                                                                    or (y = 'crd' and s.key <> 'focused') or (y = 'extra' and s.key not in ('stunned', 'frozen'))) then
        v := v || format('%s: status %s must be an object with stacks, value, until or locked (Focused: also crd; Stunned and Frozen: also extra)', at, s.key); continue;
      end if;
      if s.value ? 'stacks' and (jsonb_typeof(s.value->'stacks') is distinct from 'number' or (s.value->>'stacks')::numeric < 1 or (s.value->>'stacks')::numeric % 1 <> 0) then
        v := v || format('%s: status %s stacks must be a whole number of 1 or more', at, s.key);
      end if;
      if s.value ? 'value' and (jsonb_typeof(s.value->'value') is distinct from 'number' or (s.value->>'value')::numeric < 0) then
        v := v || format('%s: status %s value must be a number of 0 or more', at, s.key);
      end if;
      if s.value ? 'crd' and (jsonb_typeof(s.value->'crd') is distinct from 'number' or (s.value->>'crd')::numeric < 0) then
        v := v || format('%s: status %s crd must be a number of 0 or more', at, s.key);
      end if;
      if s.value ? 'until' and (jsonb_typeof(s.value->'until') is distinct from 'number' or (s.value->>'until')::numeric < 0 or (s.value->>'until')::numeric % 1 <> 0) then
        v := v || format('%s: status %s until must be a whole number of 0 or more', at, s.key);
      end if;
      if s.value ? 'locked' and jsonb_typeof(s.value->'locked') is distinct from 'boolean' then
        v := v || format('%s: status %s locked must be true or false', at, s.key);
      end if;
      if s.value ? 'extra' and (jsonb_typeof(s.value->'extra') is distinct from 'number' or (s.value->>'extra')::numeric < 0 or (s.value->>'extra')::numeric % 1 <> 0) then
        v := v || format('%s: status %s extra must be a whole number of 0 or more', at, s.key);
      end if;
    end loop;
  end loop;
  return v;
end $fn$;

-- E2: Time Lock. While a standing enemy has the rule time_lock, Quickened does nothing on a card (the simulator speedOf). Everything else as E2.
create or replace function public.combat_v2_advance(p jsonb, p_b jsonb) returns jsonb language plpgsql immutable set search_path = public as $fn$
declare
  act_at numeric := (p_b->'v2_speed'->>'act_at')::numeric;
  max_a int := (p_b->'v2_speed'->>'max_actions_per_step')::int;
  cap int; clk int; steps int := 0; n int := 0; i int; best int; ev text; tl boolean := false;
  u_side text[] := '{}'; u_key text[] := '{}'; u_json jsonb[] := '{}'; u_meter numeric[] := '{}'; u_acts int[] := '{}'; u_up boolean[] := '{}';
  r record; cards jsonb; foes jsonb; u jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' or p->>'v' is distinct from '2' then raise exception 'combat_v2_advance: the state must be a fight state v 2'; end if;
  if jsonb_typeof(p->'clock') is distinct from 'number' or (p->>'clock')::numeric < 0 or (p->>'clock')::numeric % 1 <> 0 then
    raise exception 'combat_v2_advance: clock must be a whole number of 0 or more';
  end if;
  if act_at is null or max_a is null then raise exception 'combat_v2_advance: no balance value for v2_speed'; end if;
  cap := case when p->>'mode' = 'hunt' then (p_b->'v2_hunt'->>'round_cap')::int
              when p->>'mode' in ('dungeon', 'gauntlet') then (p_b->'v2_dungeon'->>'round_cap')::int end;
  if cap is null then raise exception 'combat_v2_advance: no step cap for the mode %', p->>'mode'; end if;
  clk := (p->>'clock')::int;
  -- the units in the fixed order: the squad cards in squad order, then the other cards by id, then the enemies by index
  for r in
      select 'card' as side, c.key as k, c.value as v
        from jsonb_each(coalesce(p->'cards', '{}'::jsonb)) c
        left join jsonb_array_elements_text(coalesce(p->'squad', '[]'::jsonb)) with ordinality q(id, o) on q.id = c.key
       group by c.key, c.value
       order by min(q.o) nulls last, c.key::numeric
  loop
    n := n + 1; u_side[n] := r.side; u_key[n] := r.k; u_json[n] := r.v;
  end loop;
  for r in select 'enemy' as side, (x.o - 1)::text as k, x.v from jsonb_array_elements(coalesce(p->'enemies', '[]'::jsonb)) with ordinality x(v, o) order by x.o loop
    n := n + 1; u_side[n] := r.side; u_key[n] := r.k; u_json[n] := r.v;
  end loop;
  for i in 1 .. n loop
    if jsonb_typeof(u_json[i]->'meter') is distinct from 'number' or (u_json[i]->>'meter')::numeric < 0 then
      raise exception 'combat_v2_advance: % %: meter must be a number of 0 or more', u_side[i], u_key[i];
    end if;
    u_meter[i] := (u_json[i]->>'meter')::numeric;
    u_acts[i] := coalesce((u_json[i]->>'acts')::int, 0);
    u_up[i] := not coalesce((u_json[i]->>'down')::boolean, false) and coalesce((u_json[i]->>'hp')::numeric, 0) > 0;
    if u_up[i] and u_side[i] = 'enemy' and coalesce(u_json[i]->'mechanics' ? 'time_lock', false) then tl := true; end if;
  end loop;

  loop
    best := null;
    for i in 1 .. n loop
      if u_up[i] and u_meter[i] >= act_at and u_acts[i] < max_a and (best is null or u_meter[i] > u_meter[best]) then best := i; end if;
    end loop;
    if best is not null then
      u_meter[best] := u_meter[best] - act_at; u_acts[best] := u_acts[best] + 1; ev := 'act'; exit;
    end if;
    if n = 0 or not (true = any(u_up)) then ev := 'none'; exit; end if;
    if clk >= cap then ev := 'cap'; exit; end if;
    -- a new step: every standing unit fills its meter by its speed in this step; the action counts start again
    clk := clk + 1; steps := steps + 1;
    for i in 1 .. n loop
      u_acts[i] := 0;
      if u_up[i] then
        u_meter[i] := u_meter[i] + combat_v2_speed(case when tl and u_side[i] = 'card'
                                                         then u_json[i] || jsonb_build_object('status', coalesce(u_json[i]->'status', '{}'::jsonb) - 'quickened')
                                                         else u_json[i] end, clk, p_b);
      end if;
    end loop;
  end loop;

  cards := coalesce(p->'cards', '{}'::jsonb); foes := coalesce(p->'enemies', '[]'::jsonb);
  for i in 1 .. n loop
    u := (u_json[i] - 'acts') || jsonb_build_object('meter', u_meter[i]) || case when u_acts[i] > 0 then jsonb_build_object('acts', u_acts[i]) else '{}'::jsonb end;
    if u_side[i] = 'card' then cards := jsonb_set(cards, array[u_key[i]], u);
    else foes := jsonb_set(foes, array[u_key[i]], u);
    end if;
  end loop;
  return jsonb_build_object(
    'state', p || jsonb_build_object('clock', clk, 'cards', cards, 'enemies', foes),
    'event', ev,
    'actor', case when ev = 'act' then jsonb_build_object('side', u_side[best], 'id', u_key[best]::numeric) end,
    'steps', steps);
end $fn$;

-- E4/E6: the enemy mechanics of the simulator (cardHit, enemyHit, enemyMult, damage). A card hit: ctx.kind (extra = a Flurry second strike, splash = a
-- Cleaver splash, area = an area hit) on a Mirror Hide target is x mirror_hide.extra_x / splash_x (0 = no hit and no draw); the target's timed evade adds
-- to its evasion; Empowered x Dispeller x (the unit's own params) x the target's timed emp_x; the "Weak to: role" week (target weak_role: the cards of that
-- role deal + weak_role_rules.<role>.damage_x, else + weak_role_x). An enemy hit: Swarm (an area hit on a support card x swarm.x), Pack (x 1 + atk_per_foe
-- x the standing enemies), ctx.ignore_shield. The damage: Steadfast (x 1 - dr while the target has fewer than kinds (or its timed steadfast_kinds)
-- different harmful statuses) and Brood (x 1 - dr x stacks; a Cleaver hit removes one: brood_after) after the Warden and before min_dmg. The numbers of a
-- mechanic come from combat_v2_mech (the unit's own params count). The answer adds lost (the shield the hit removed), brood_after and mirrored.
create or replace function public.combat_v2_hit(p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  h jsonb := p_b->'v2_hit'; st jsonb := p_b->'v2_stats'; ss jsonb := p_b->'v2_status'; ro jsonb := p_b->'v2_roles'; en jsonb := p_b->'v2_enemy';
  bm jsonb := p_b->'v2_enemy'->'boss_moves';
  ctx jsonb := coalesce(p_ctx, '{}'::jsonb);
  side text := ctx->>'side'; clk int; draws jsonb := ctx->'draws'; used jsonb := '[]'::jsonb; d numeric;
  role text := p_att->>'role'; rn jsonb; tmech jsonb := coalesce(p_tgt->'mechanics', '[]'::jsonb); amech jsonb := coalesce(p_att->'mechanics', '[]'::jsonb);
  ab numeric; x numeric; mult numeric; roll numeric; chance numeric := 0; critc numeric := 0; foc numeric := 0; bonus numeric;
  ts boolean; marked boolean := false; can_crit boolean; crit boolean := false; s jsonb; k text; mp jsonb; mx numeric;
  raw numeric := 0; pierce numeric := 0; sx numeric := 1; a numeric; shield numeric; absorbed numeric := 0; hp_loss numeric := 0;
  thp numeric; tmax numeric; heal numeric := 0; shield_key text; brood int; brood_after int; lim numeric;
begin
  if h is null or st is null or ss is null or ro is null or en is null or bm is null or p_b->'v2_support' is null then
    raise exception 'combat_v2_hit: no balance value for v2_hit, v2_stats, v2_status, v2_roles, v2_enemy or v2_support';
  end if;
  if side is null or side not in ('card', 'enemy') then raise exception 'combat_v2_hit: ctx.side must be card (a card hits an enemy) or enemy (%)', side; end if;
  if jsonb_typeof(p_att) is distinct from 'object' or jsonb_typeof(p_tgt) is distinct from 'object' then raise exception 'combat_v2_hit: the attacker and the target must be units'; end if;
  if jsonb_typeof(p_att->'atk') is distinct from 'number' or (p_att->>'atk')::numeric < 0 then raise exception 'combat_v2_hit: the attacker needs atk (a number of 0 or more)'; end if;
  if jsonb_typeof(p_tgt->'hp') is distinct from 'number' or jsonb_typeof(p_tgt->'max') is distinct from 'number' or (p_tgt->>'max')::numeric <= 0 then
    raise exception 'combat_v2_hit: the target needs hp and max (max above 0)';
  end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_hit: ctx.draws must be a list of numbers'; end if;
  if ctx ? 'clock' then clk := (ctx->>'clock')::int; end if;
  if side = 'card' then
    rn := ro->role;
    if rn is null or role like '\_%' then raise exception 'combat_v2_hit: the attacking card needs a role of v2_roles (%)', role; end if;
    if coalesce(p_att->>'class', '') not in ('attacker', 'support') then
      raise exception 'combat_v2_hit: the attacking card needs its class, attacker or support (card_combat_v2 class; %)', p_att->>'class';
    end if;
  end if;
  for k in select jsonb_array_elements_text(tmech) union all select jsonb_array_elements_text(amech) loop
    perform combat_v2_mech(p_b, null, k);
  end loop;
  thp := (p_tgt->>'hp')::numeric; tmax := (p_tgt->>'max')::numeric;
  shield_key := case when side = 'card' then 'guarded' else 'shielded' end;
  -- a target that is down takes nothing and costs no draw
  if coalesce((p_tgt->>'down')::boolean, false) or thp <= 0 then
    return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false,
      'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', greatest(thp, 0), 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
      'down', true, 'heal', 0, 'lost', 0, 'draws', used);
  end if;

  if side = 'card' then
    -- ---------------------------------------------------------------- a card hits an enemy (simulator Battle.cardHit)
    ab := coalesce((p_att->>'abl')::numeric, 1);
    x := coalesce((ctx->>'x')::numeric,
                  case when coalesce((ctx->>'basic')::boolean, false) then
                    case when role = 'artillery' then (ro->'artillery'->>'basic_x')::numeric
                         when p_att->>'class' = 'support' then (p_b->'v2_support'->>'basic_x')::numeric end end, 1);
    -- Mirror Hide: a second strike, a splash or an area hit
    if ctx->>'kind' is not null and tmech ? 'mirror_hide' then
      mp := combat_v2_mech(p_b, p_tgt, 'mirror_hide');
      mx := case when ctx->>'kind' = 'extra' then (mp->>'extra_x')::numeric else (mp->>'splash_x')::numeric end;
      if mx = 0 then
        return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', false, 'crit', false, 'true_strike', false, 'marked', false, 'mirrored', true,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
      x := x * mx;
    end if;
    ts := coalesce((ctx->>'true_strike')::boolean, false)
          or (coalesce((ctx->>'basic')::boolean, false) and role = 'artillery' and coalesce((ro->'artillery'->>'true_strike')::boolean, false));
    s := combat_v2_status_on(p_tgt, 'mark', clk); marked := s is not null;
    -- 1. miss (the target's evasion + its timed evade)
    if not ts and not marked then
      chance := greatest(0, (h->>'miss')::numeric + coalesce((p_tgt->>'evasion')::numeric, 0) + coalesce((combat_v2_timed(p_tgt, 'evade', clk))::text::numeric, 0)
                + case when combat_v2_status_on(p_att, 'blinded', clk) is not null then (ss->'blinded'->>'miss')::numeric else 0 end
                - coalesce((p_att->>'acc')::numeric, 0));
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
    end if;
    -- 2. the roll
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    -- 3. crit (Ironhide: no crit unless Marked)
    can_crit := not (tmech ? 'ironhide' and not marked);
    foc := coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'value')::numeric, 0);
    critc := coalesce((p_att->>'crt')::numeric, 0) + coalesce((ctx->>'crit_add')::numeric, 0) + coalesce((ctx->>'crit_bonus')::numeric, 0) + foc
             + case when role = 'striker' then (ro->'striker'->>'crit_add')::numeric * ab else 0 end;
    critc := least((st->'crt'->>'cap')::numeric + foc, critc);
    if can_crit then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      crit := d < critc;
    end if;
    if crit then
      mult := mult * (coalesce((p_att->>'crd')::numeric, (st->'crd'->>'base')::numeric) + case when role = 'striker' then (ro->'striker'->>'critx_add')::numeric * ab else 0 end
                         + coalesce((combat_v2_status_on(p_att, 'focused', clk)->>'crd')::numeric, 0));
    end if;
    -- 4. the multipliers (Empowered x Dispeller x the timed emp_x of the target)
    s := combat_v2_status_on(p_att, 'empowered', clk);
    if s is not null then
      mult := mult * (1 + (s->>'value')::numeric * case when tmech ? 'dispeller' then (combat_v2_mech(p_b, p_tgt, 'dispeller')->>'x')::numeric else 1 end
                          * coalesce((combat_v2_timed(p_tgt, 'emp_x', clk))::text::numeric, 1));
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    if marked then mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'mark', clk)->>'value')::numeric, 0)); end if;
    bonus := coalesce((ctx->>'bonus')::numeric, 0);
    if role = 'finisher' and thp / tmax < (ro->'finisher'->>'line')::numeric then bonus := bonus + (ro->'finisher'->>'bonus')::numeric * ab; end if;
    if role = 'cleaver' and (ctx->>'foes_alive')::int = 1 then bonus := bonus + (ro->'cleaver'->>'hunt_bonus')::numeric * ab; end if;
    -- the "Weak to: role" week of the target
    if p_tgt->>'weak_role' is not null and p_tgt->>'weak_role' = role then
      bonus := bonus + coalesce((en->'weak_role_rules'->role->>'damage_x')::numeric, (en->>'weak_role_x')::numeric);
    end if;
    mult := mult * (1 + bonus);
    if coalesce((ctx->>'vs_x')::numeric, 0) <> 0 then mult := mult * (ctx->>'vs_x')::numeric; end if;
    -- 5. Pierce and shield break (the Breaker passive)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when role = 'breaker' then (ro->'breaker'->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when role = 'breaker' then (ro->'breaker'->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  else
    -- ---------------------------------------------------------------- an enemy hits a card (simulator Battle.enemyHit)
    x := coalesce((ctx->>'x')::numeric, 1);
    ts := coalesce((ctx->>'true_strike')::boolean, false) or amech ? 'true_strike';
    -- 1. Blinded
    if combat_v2_status_on(p_att, 'blinded', clk) is not null then
      chance := (ss->'blinded'->>'miss')::numeric;
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < chance then
        return jsonb_build_object('side', side, 'hit', false, 'miss', true, 'dodged', false, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
          'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
          'down', false, 'heal', 0, 'lost', 0, 'draws', used);
      end if;
    end if;
    -- 2. Dodge (single hits; area hits x area_x)
    if not ts then
      chance := greatest(0, coalesce((p_tgt->>'ddg')::numeric, 0) * (1 - coalesce((p_att->>'keen')::numeric, 0))
                * case when coalesce((ctx->>'area')::boolean, false) then (st->'ddg'->>'area_x')::numeric else 1 end);
      if chance > 0 then
        d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
        if d < chance then
          return jsonb_build_object('side', side, 'hit', false, 'miss', false, 'dodged', true, 'crit', false, 'true_strike', ts, 'marked', false, 'chance', chance,
            'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'hp_after', thp, 'shield_after', coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0),
            'down', false, 'heal', 0, 'lost', 0, 'draws', used);
        end if;
      end if;
    end if;
    -- Swarm: an area hit on a support card
    if coalesce((ctx->>'area')::boolean, false) and amech ? 'swarm' and p_tgt->>'class' = 'support' then x := x * (combat_v2_mech(p_b, p_att, 'swarm')->>'x')::numeric; end if;
    -- 3. the roll and the enemy multipliers
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    roll := (h->>'roll_min')::numeric + d * (h->>'roll_span')::numeric;
    mult := x * roll;
    s := combat_v2_status_on(p_att, 'enraged', clk);
    if s is not null then mult := mult * (s->>'value')::numeric; end if;
    if ctx->>'mode' = 'hunt' and coalesce((p_att->>'hp')::numeric / nullif((p_att->>'max')::numeric, 0) < (bm->>'rage_at')::numeric, false) then
      mult := mult * (bm->>'rage_x')::numeric;
    end if;
    s := combat_v2_status_on(p_att, 'weakened', clk);
    if s is not null then mult := mult * (1 - (s->>'value')::numeric); end if;
    s := combat_v2_status_on(p_att, 'chill', clk);
    if s is not null then mult := mult * (1 - (ss->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
    -- Pack: + atk_per_foe for each standing enemy
    if amech ? 'pack' then mult := mult * (1 + (combat_v2_mech(p_b, p_att, 'pack')->>'atk_per_foe')::numeric * coalesce((ctx->>'foes_alive')::numeric, 0)); end if;
    mult := mult * (1 + coalesce((combat_v2_status_on(p_tgt, 'exposed', clk)->>'value')::numeric, 0));
    -- 4. Sunder and Shatter (the unit's own params count)
    pierce := greatest(coalesce((ctx->>'pierce')::numeric, 0), case when amech ? 'sunder' then (combat_v2_mech(p_b, p_att, 'sunder')->>'pierce')::numeric else 0 end);
    sx := greatest(coalesce((ctx->>'shield_x')::numeric, 1), case when amech ? 'shatter' then (combat_v2_mech(p_b, p_att, 'shatter')->>'shield_x')::numeric else 1 end);
    raw := (p_att->>'atk')::numeric * mult;
  end if;

  -- ---------------------------------------------------------------- the damage (simulator Battle.damage)
  shield := coalesce((combat_v2_status_on(p_tgt, shield_key, clk)->>'value')::numeric, 0);
  brood := coalesce((p_tgt->>'brood')::int, 0); brood_after := brood;
  if raw > 0 then
    a := raw * (1 - coalesce((p_tgt->>'def')::numeric, 0) * (1 - least(1, pierce)));
    if side = 'enemy' and coalesce((ctx->>'warden')::boolean, false) then a := a * (1 - (ro->'warden'->>'ally_dr')::numeric); end if;
    -- Steadfast and Brood (an enemy target)
    if tmech ? 'steadfast' then
      mp := combat_v2_mech(p_b, p_tgt, 'steadfast');
      lim := coalesce((combat_v2_timed(p_tgt, 'steadfast_kinds', clk))::text::numeric, (mp->>'kinds')::numeric);
      if combat_v2_neg_kinds(p_tgt, clk, p_b) < lim then a := a * (1 - (mp->>'dr')::numeric); end if;
    end if;
    if brood > 0 then
      a := a * (1 - (combat_v2_mech(p_b, p_tgt, 'brood')->>'dr')::numeric * brood);
      if side = 'card' and role = 'cleaver' then brood_after := brood - 1; end if;
    end if;
    a := greatest((h->>'min_dmg')::numeric, a);
    if shield > 0 and not coalesce((ctx->>'ignore_shield')::boolean, false) then
      absorbed := least(a, shield / sx);
      shield := greatest(0, shield - absorbed * sx);
      a := a - absorbed;
    end if;
    hp_loss := least(thp, a);
  end if;
  if side = 'card' and role = 'survivor' and absorbed + hp_loss > 0 then
    heal := least((ro->'survivor'->>'lifesteal')::numeric * ab * (absorbed + hp_loss),
                  (ro->'survivor'->>'cap_maxhp')::numeric * ab * coalesce((p_att->>'max')::numeric, 0));
  end if;
  return jsonb_build_object('side', side, 'hit', true, 'miss', false, 'dodged', false, 'crit', crit, 'true_strike', ts, 'marked', marked,
    'chance', chance, 'crit_chance', case when side = 'card' and can_crit then critc else 0 end, 'roll', roll, 'raw', raw, 'pierce', pierce, 'shield_x', sx,
    'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'shield_after', shield, 'hp_loss', hp_loss, 'hp_after', greatest(0, thp - hp_loss),
    'down', thp - hp_loss <= 0, 'heal', heal, 'lost', absorbed * sx, 'draws', used)
    || case when brood > 0 then jsonb_build_object('brood_after', brood_after) else '{}'::jsonb end;
end $fn$;

-- ============================================================ 5. replaced: statuses, damage, heals; the fall (Undying, Volatile Core)
-- A harmful status that an enemy blocked (immune, resisted, control immune) from a card: blocked + 1 (Rage Spiral), Tilt (Enraged x tilt.x for tilt.dur
-- steps), Rubberband (a blocked control: the enemy acts again, once a step: its meter + act_at). The simulator Battle.blocked.
create or replace function public.combat_v2_blocked(p_state jsonb, p_target jsonb, p_key text, p_src jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare s jsonb := p_state; path text[]; u jsonb; clk int := (p_state->>'clock')::int; mp jsonb;
begin
  if p_target->>'side' <> 'enemy' or p_src is null or jsonb_typeof(p_src) <> 'object' or p_src->>'side' <> 'card' then return s; end if;
  path := combat_v2_unit_path(s, p_target); u := s #> path;
  u := u || jsonb_build_object('blocked', coalesce((u->>'blocked')::int, 0) + 1);
  s := jsonb_set(s, path, u);
  if coalesce(u->'mechanics' ? 'tilt', false) then
    mp := combat_v2_mech(p_b, u, 'tilt');
    s := combat_v2_status_apply(s, p_target, 'enraged', jsonb_build_object('value', (mp->>'x')::numeric, 'dur', (mp->>'dur')::int, 'src', p_target), p_b)->'state';
    u := s #> path;
  end if;
  if p_b->'statuses'->p_key->>'immunity' = 'control'
     and (coalesce(u->'mechanics' ? 'rubberband', false) or combat_v2_timed(u, 'rubberband', clk) is not null)
     and (u->>'rubber_step')::int is distinct from clk then
    u := u || jsonb_build_object('rubber_step', clk, 'meter', (u->>'meter')::numeric + (p_b->'v2_speed'->>'act_at')::numeric);
    s := jsonb_set(s, path, u);
  end if;
  return s;
end $fn$;

-- E5/E6 with the enemy mechanics of the simulator Battle.apply: Permafrost Heart (a Chill from a standing card on it also lands on that card), resists (the
-- unit's immune statuses), the immune list of a mechanic with the unit's own params, Desync (timed desync_control: the next control from a card fails and
-- the state ends), the blocked hook (combat_v2_blocked: Tilt, Rubberband, Rage Spiral), the Controller week (a Controller's control on a target of
-- weak_role controller lasts weak_role_rules.controller.control_add more actions: extra on Stunned and Frozen, + until on Sleep and Paralyzed), Unstoppable,
-- Thick Hide and Dispeller with the unit's own params, a card shield x Brittle (a standing enemy) x the timed card_shield_x of a standing enemy, opts.locked
-- (a cure cannot remove the status), last_debuffer (the card that last put a harmful status on an enemy). Everything else as E6.
create or replace function public.combat_v2_status_apply(p_state jsonb, p_target jsonb, p_key text, p_opts jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers());
  ss jsonb := b->'v2_status'; ctl jsonb := b->'v2_control'; srow jsonb := b->'statuses'->p_key;
  o jsonb := coalesce(p_opts, '{}'::jsonb); draws jsonb := o->'draws'; used jsonb := '[]'::jsonb; d numeric;
  s jsonb := p_state; path text[]; u jsonb; side text := p_target->>'side'; clk int; boss boolean; neg boolean; ctrl boolean;
  src jsonb; sref jsonb; sside text; srole text; res numeric; m text; k text; cur numeric; n int; v numeric; dur int; stacks int; cap numeric;
  r jsonb; rest jsonb; why text; add int := 0; sb jsonb; tv jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_apply');
  if srow is null then raise exception 'combat_v2_status_apply: unknown status %', p_key; end if;
  path := combat_v2_unit_path(p_state, p_target);
  if not coalesce((srow->>case when side = 'card' then 'on_card' else 'on_enemy' end)::boolean, false) then
    raise exception 'combat_v2_status_apply: the status % does not apply to a %', p_key, side;
  end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'combat_v2_status_apply: opts must be an object'; end if;
  if draws is not null and jsonb_typeof(draws) <> 'array' then raise exception 'combat_v2_status_apply: opts.draws must be a list of numbers'; end if;
  if o ? 'stacks' and (jsonb_typeof(o->'stacks') is distinct from 'number' or (o->>'stacks')::numeric < 1 or (o->>'stacks')::numeric % 1 <> 0) then
    raise exception 'combat_v2_status_apply: stacks must be a whole number of 1 or more';
  end if;
  if o ? 'value' and (jsonb_typeof(o->'value') is distinct from 'number' or (o->>'value')::numeric < 0) then
    raise exception 'combat_v2_status_apply: value must be a number of 0 or more';
  end if;
  if o ? 'dur' and (jsonb_typeof(o->'dur') is distinct from 'number' or (o->>'dur')::numeric < 1 or (o->>'dur')::numeric % 1 <> 0) then
    raise exception 'combat_v2_status_apply: dur must be a whole number of 1 or more';
  end if;
  if o ? 'dur' and p_key not in ('blinded', 'confused', 'enraged', 'focused') then
    raise exception 'combat_v2_status_apply: % takes its duration from balance (only Blinded, Confused, Enraged and Focused take a dur)', p_key;
  end if;
  if o ? 'value' and p_key = 'slowed' then
    raise exception 'combat_v2_status_apply: % has no value (combat_v2_speed reads v2_status.%.x)', p_key, p_key;
  end if;
  if o ? 'crd' and (p_key <> 'focused' or jsonb_typeof(o->'crd') is distinct from 'number' or (o->>'crd')::numeric < 0) then
    raise exception 'combat_v2_status_apply: crd (the crit damage of a Focus) is a number of 0 or more, on Focused only';
  end if;
  if o ? 'locked' and jsonb_typeof(o->'locked') is distinct from 'boolean' then raise exception 'combat_v2_status_apply: locked must be true or false'; end if;
  if not o ? 'value' and p_key in ('exposed', 'weakened', 'mark', 'empowered', 'focused', 'shielded', 'guarded') then
    raise exception 'combat_v2_status_apply: % needs a value', p_key;
  end if;
  stacks := coalesce((o->>'stacks')::int, 1); v := (o->>'value')::numeric;
  clk := (p_state->>'clock')::int; u := p_state #> path;
  boss := side = 'enemy' and p_state->>'mode' = 'hunt';
  neg := (srow->>'negative')::boolean; ctrl := srow->>'immunity' = 'control';
  if o->'src' is not null and jsonb_typeof(o->'src') <> 'null' then
    sref := o->'src'; src := p_state #> combat_v2_unit_path(p_state, sref); sside := sref->>'side'; srole := src->>'role';
  end if;
  -- 1. a down unit
  if not combat_v2_up(u) then return jsonb_build_object('state', p_state, 'applied', false, 'reason', 'down', 'draws', used); end if;
  -- Permafrost Heart: a Chill from a standing card also lands on that card (the same stacks; no source)
  if p_key = 'chill' and coalesce(u->'mechanics' ? 'permafrost_heart', false) and sside = 'card' and combat_v2_up(src) then
    r := combat_v2_status_apply(s, sref, 'chill', jsonb_build_object('stacks', stacks) || case when draws is null then '{}'::jsonb else jsonb_build_object('draws', draws) end, b);
    s := r->'state'; used := used || (r->'draws'); draws := combat_v2_draws_rest(draws, jsonb_array_length(r->'draws'));
    u := s #> path;
  end if;
  -- 2. resists and the immune list of a mechanic (Toxic-born, Fireborn, Frostborn)
  if coalesce(u->'resists' ? p_key, false) then why := 'immune'; end if;
  if why is null then
    for m in select jsonb_array_elements_text(coalesce(u->'mechanics', '[]'::jsonb)) loop
      if coalesce(combat_v2_mech(b, u, m)->'immune' ? p_key, false) then why := 'immune'; exit; end if;
    end loop;
  end if;
  -- 3. the cure immunity of a card (not a block of an enemy)
  if why is null and neg and side = 'card' and coalesce((u->'immune'->>p_key)::int >= clk, false) then
    return jsonb_build_object('state', s, 'applied', false, 'reason', 'cure_immune', 'draws', used);
  end if;
  -- 4. resolve
  if why is null and neg and src is not null and sside <> side then
    res := coalesce((u->>'resolve')::numeric, 0);
    if sside = 'card' then
      res := greatest(0, res * case when srole = 'controller' then 1 - (b->'v2_roles'->'controller'->>'resolve_ignore')::numeric else 1 end
                         - coalesce((src->>'acc')::numeric, 0) * (b->'v2_hit'->>'resolve_acc')::numeric / (b->'v2_stats'->'acc'->>'pct')::numeric);
    end if;
    if res > 0 then
      d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
      if d < res then why := 'resisted'; end if;
    end if;
  end if;
  -- 5. Unstoppable
  if why is null and ctrl and coalesce(u->'mechanics' ? 'unstoppable', false) then
    d := combat_v2_draw(draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    if d < (combat_v2_mech(b, u, 'unstoppable')->>'control_fail')::numeric then why := 'resisted'; end if;
  end if;
  -- Desync: the next control from a card fails, and the state ends
  if why is null and ctrl and sside = 'card' and combat_v2_timed(u, 'desync_control', clk) is not null then
    u := jsonb_set(u, '{timed}', (u->'timed') - 'desync_control'); s := jsonb_set(s, path, u); why := 'resisted';
  end if;
  -- the duration of a "steps" status (dur, dur_card on a card, the Controller dur_add on the other side, the Hunt boss limit for a control)
  dur := case when side = 'card' then coalesce((ss->p_key->>'dur_card')::int, (ss->p_key->>'dur')::int) else (ss->p_key->>'dur')::int end
         + case when srole = 'controller' and sside <> side then (b->'v2_roles'->'controller'->>'dur_add')::int else 0 end;
  if ctrl and boss then dur := least(dur, (ctl->>'boss_max_dur')::int); end if;
  -- 6. control: the one immunity, then the duration
  if why is null and ctrl then
    if clk <= coalesce((u->'immune'->>'control')::int, clk - 1)
       or exists (select 1 from jsonb_each(b->'statuses') x where x.value->>'immunity' = 'control' and combat_v2_status_on(u, x.key, clk) is not null) then
      why := 'control_immune';
    end if;
  end if;
  if why is not null then
    s := combat_v2_blocked(s, p_target, p_key, sref, b);
    return jsonb_build_object('state', s, 'applied', false, 'reason', why, 'draws', used);
  end if;
  if ctrl then
    if srow->>'duration' = 'next_action' then
      dur := case when boss then (ss->p_key->>'max_life')::int when side = 'card' then (ss->p_key->>'max_life_card')::int else (ss->p_key->>'max_life')::int end;
    end if;
    -- the "Weak to: Controllers" week: the control lasts control_add more actions of the target
    if sside = 'card' and u->>'weak_role' is not null and srole = u->>'weak_role' then
      add := coalesce((b->'v2_enemy'->'weak_role_rules'->srole->>'control_add')::int, 0);
    end if;
    tv := jsonb_build_object('until', clk + dur + case when srow->>'duration' = 'next_action' then 0 else add end)
          || case when add > 0 and srow->>'duration' = 'next_action' then jsonb_build_object('extra', add) else '{}'::jsonb end
          || case when coalesce((o->>'locked')::boolean, false) then jsonb_build_object('locked', true) else '{}'::jsonb end;
    u := jsonb_set(u, array['status', p_key], tv);
    -- a status that ends in this one (Chill ends in Frozen) clears
    for k in select x.key from jsonb_each(b->'statuses') x where x.value->>'end_state' = p_key loop
      u := jsonb_set(u, '{status}', (u->'status') - k);
    end loop;
    if neg and sside = 'card' and side = 'enemy' then u := u || jsonb_build_object('last_debuffer', (sref->>'id')::numeric); end if;
    return jsonb_build_object('state', jsonb_set(s, path, u), 'applied', true, 'draws', used);
  end if;
  -- 7. the stacking rule of each status
  if p_key = 'poison' then
    n := coalesce((u->'status'->'poison'->>'stacks')::int, 0) + stacks;
    if n >= (ss->'poison'->>'burst_at')::int then
      u := jsonb_set(u, '{status}', (u->'status') - 'poison');
      if sside = 'card' and side = 'enemy' then u := u || jsonb_build_object('last_debuffer', (sref->>'id')::numeric); end if;
      s := jsonb_set(s, path, u);
      r := combat_v2_damage(s, p_target,
             (ss->'poison'->>'burst')::numeric * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0)),
             jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'->>'ignore_shield')::boolean)
             || case when draws is null then '{}'::jsonb else jsonb_build_object('draws', combat_v2_draws_rest(draws, jsonb_array_length(used))) end, b);
      used := used || coalesce(r->'draws', '[]'::jsonb);
      return jsonb_build_object('state', r->'state', 'applied', true, 'burst', r->'dmg', 'draws', used);
    end if;
    u := jsonb_set(u, '{status,poison}', jsonb_build_object('stacks', n, 'until', clk + dur));
  elsif p_key = 'burn' then
    u := jsonb_set(u, '{status,burn}', jsonb_build_object('stacks', least((ss->'burn'->>'max')::int, coalesce((u->'status'->'burn'->>'stacks')::int, 0) + stacks)));
  elsif p_key = 'chill' then
    n := coalesce((u->'status'->'chill'->>'stacks')::int, 0) + stacks;
    if n >= (ss->'chill'->>'freeze_at')::int then
      -- the end state lands with no source (no resolve); its draws come after these
      rest := case when draws is null then null
                   else coalesce((select jsonb_agg(x.dv order by x.dord) from jsonb_array_elements(draws) with ordinality x(dv, dord) where x.dord > jsonb_array_length(used)), '[]'::jsonb) end;
      r := combat_v2_status_apply(s, p_target, srow->>'end_state', case when rest is null then '{}'::jsonb else jsonb_build_object('draws', rest) end, b);
      used := used || (r->'draws');
      if (r->>'applied')::boolean then
        return jsonb_build_object('state', r->'state', 'applied', true, 'frozen', true, 'draws', used);
      end if;
      s := r->'state'; u := s #> path;
      n := (ss->'chill'->>'freeze_at')::int - 1;
    end if;
    u := jsonb_set(u, '{status,chill}', jsonb_build_object('stacks', n, 'until', clk + dur));
  elsif p_key = 'exposed' then
    cap := case when coalesce(u->'mechanics' ? 'thick_hide', false) then (combat_v2_mech(b, u, 'thick_hide')->>'expose_cap')::numeric else (ss->'exposed'->>'cap')::numeric end;
    cur := coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,exposed}', jsonb_build_object('value',
           least(cap, cur + v * case when coalesce(u->'mechanics' ? 'dispeller', false) then (combat_v2_mech(b, u, 'dispeller')->>'x')::numeric else 1 end), 'until', clk + dur));
  elsif p_key = 'weakened' then
    cur := coalesce((combat_v2_status_on(u, 'weakened', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,weakened}', jsonb_build_object('value', least((ss->'weakened'->>'cap')::numeric, cur + v), 'until', clk + dur));
  elsif p_key = 'mark' then
    cur := coalesce((combat_v2_status_on(u, 'mark', clk)->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,mark}', jsonb_build_object('value', greatest(cur, v), 'until', clk + (ss->'mark'->>'dur')::int));
  elsif p_key in ('slowed', 'quickened', 'blinded', 'confused') then
    -- a Quickened value is its speed multiplier (a quicken block: 1 + v x ABL); none = v2_status.quickened.x
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('until', clk + coalesce((o->>'dur')::int, dur)) || case when v is not null then jsonb_build_object('value', v) else '{}'::jsonb end);
  elsif p_key in ('enraged', 'focused') then
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('value', coalesce(v, (ss->p_key->>'x')::numeric), 'until', clk + coalesce((o->>'dur')::int, dur))
           || case when o ? 'crd' then jsonb_build_object('crd', (o->>'crd')::numeric) else '{}'::jsonb end);
  elsif p_key = 'empowered' then
    cur := coalesce((u->'status'->'empowered'->>'value')::numeric, 0);
    u := jsonb_set(u, '{status,empowered}', jsonb_build_object('value',
           case when (ss->'empowered'->>'stack')::boolean then least((ss->'empowered'->>'stack_cap')::numeric, cur + v)
                else least((ss->'empowered'->>'cap')::numeric, greatest(cur, v)) end));
  elsif p_key in ('shielded', 'guarded') then
    -- a card shield: x Brittle (a standing enemy with the rule) x the timed card_shield_x (Calcify) of a standing enemy
    if p_key = 'shielded' and side = 'card' then
      sb := combat_v2_standing_rule(s, 'brittle', b);
      if sb is not null then v := v * (sb->>'card_shield_x')::numeric; end if;
      sb := combat_v2_timed_any(s, 'card_shield_x');
      if sb is not null then v := v * (sb->>'v')::numeric; end if;
    end if;
    cur := coalesce((u->'status'->p_key->>'value')::numeric, 0);
    u := jsonb_set(u, array['status', p_key], jsonb_build_object('value', least((u->>'max')::numeric * (ss->'shielded'->>'cap_maxhp')::numeric, cur + v)));
  else
    raise exception 'combat_v2_status_apply: no rule for %', p_key;
  end if;
  if coalesce((o->>'locked')::boolean, false) and u->'status' ? p_key then u := jsonb_set(u, array['status', p_key, 'locked'], 'true'::jsonb); end if;
  if neg and sside = 'card' and side = 'enemy' then u := u || jsonb_build_object('last_debuffer', (sref->>'id')::numeric); end if;
  return jsonb_build_object('state', jsonb_set(s, path, u), 'applied', true, 'draws', used);
end $fn$;

-- E5: a locked status stays (the simulator cure and cleanseNeg skip it). Everything else as E5.
create or replace function public.combat_v2_status_cure(p_state jsonb, p_target jsonb, p_keys jsonb default null, p_immune int default 0, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_status_numbers()); path text[]; u jsonb; side text := p_target->>'side'; clk int; boss boolean;
  keys text[]; k text; removed jsonb := '[]'::jsonb; im jsonb; kin jsonb := case when jsonb_typeof(p_keys) = 'null' then null else p_keys end;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_status_cure');
  path := combat_v2_unit_path(p_state, p_target);
  if p_immune is null or p_immune < 0 then raise exception 'combat_v2_status_cure: immune must be a whole number of 0 or more'; end if;
  if kin is not null and jsonb_typeof(kin) <> 'array' then raise exception 'combat_v2_status_cure: keys must be a list of statuses (or NULL: every negative status)'; end if;
  if kin is null then
    select array_agg(x.key order by (x.value->>'ord')::int) into keys from jsonb_each(b->'statuses') x where (x.value->>'negative')::boolean;
  else
    select array_agg(x.v order by (b->'statuses'->x.v->>'ord')::int) into keys from (select distinct jsonb_array_elements_text(kin) v) x;
    foreach k in array coalesce(keys, '{}') loop
      if not coalesce((b->'statuses'->k->>'negative')::boolean, false) then raise exception 'combat_v2_status_cure: % is not a negative status', k; end if;
    end loop;
  end if;
  u := p_state #> path; clk := (p_state->>'clock')::int; boss := side = 'enemy' and p_state->>'mode' = 'hunt';
  foreach k in array coalesce(keys, '{}') loop
    if coalesce(u->'status' ? k, false) and not coalesce((u->'status'->k->>'locked')::boolean, false) then
      u := combat_v2_status_drop(u, k, side, boss, clk, b); removed := removed || to_jsonb(k);
    end if;
  end loop;
  if p_immune > 0 then
    im := coalesce(u->'immune', '{}'::jsonb);
    foreach k in array coalesce(keys, '{}') loop
      im := im || jsonb_build_object(k, greatest(coalesce((im->>k)::int, clk + p_immune - 1), clk + p_immune - 1));
    end loop;
    u := jsonb_set(u, '{immune}', im);
  end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'cured', jsonb_array_length(removed), 'removed', removed);
end $fn$;

-- A unit at 0 HP or less (not yet down): Undying (an enemy with the mechanic, once, not while Burning or Poisoned) comes back with undying.hp x its max
-- HP; else it falls (combat_v2_fall), and volatile is true when it has Volatile Core and is not Stunned or Frozen (the simulator Battle.fall).
-- Answer {state, down, volatile, revived}.
create or replace function public.combat_v2_drop(p_state jsonb, p_target jsonb, p_b jsonb) returns jsonb language plpgsql stable set search_path = public as $fn$
declare path text[] := combat_v2_unit_path(p_state, p_target); u jsonb := p_state #> path; clk int := (p_state->>'clock')::int; vol boolean;
begin
  if coalesce(u->'mechanics' ? 'undying', false) and not coalesce((u->>'undying_used')::boolean, false)
     and combat_v2_status_on(u, 'burn', clk) is null and combat_v2_status_on(u, 'poison', clk) is null then
    u := u || jsonb_build_object('hp', (combat_v2_mech(p_b, u, 'undying')->>'hp')::numeric * (u->>'max')::numeric, 'undying_used', true);
    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'down', false, 'volatile', false, 'revived', true);
  end if;
  vol := coalesce(u->'mechanics' ? 'volatile_core', false) and combat_v2_status_on(u, 'stunned', clk) is null and combat_v2_status_on(u, 'frozen', clk) is null;
  return jsonb_build_object('state', jsonb_set(p_state, path, combat_v2_fall(u)), 'down', true, 'volatile', vol, 'revived', false);
end $fn$;

-- Volatile Core: the fallen enemy hits every standing card (an area hit of volatile_core.x of its attack). Answer {state, draws}.
create or replace function public.combat_v2_volatile(p_state jsonb, p_dead jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare s jsonb := p_state; d jsonb := p_draws; used jsonb := '[]'::jsonb; x numeric; lst text[]; id text; r jsonb;
begin
  x := (combat_v2_mech(p_b, s #> combat_v2_unit_path(s, p_dead), 'volatile_core')->>'x')::numeric;
  lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
  foreach id in array lst loop
    r := combat_v2_enemy_hit(s, p_dead, jsonb_build_object('side', 'card', 'id', id::numeric), x, true, '{}'::jsonb, d, p_b);
    s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
  end loop;
  return jsonb_build_object('state', s, 'draws', used);
end $fn$;

-- E5 with Steadfast and Brood (a Burn tick, opts.kind burn, or a non-tick hit of a Cleaver, opts.src_role cleaver, removes one stack), then the fall
-- (combat_v2_drop: Undying; Volatile Core hits every card with opts.draws). VOLATILE (Volatile Core draws). The answer adds draws and revived.
create or replace function public.combat_v2_damage(p_state jsonb, p_target jsonb, p_amount numeric, p_opts jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb);
  path text[]; u jsonb; side text := p_target->>'side'; clk int; skey text; tick boolean; a numeric; sh numeric; sx numeric;
  absorbed numeric := 0; hp_loss numeric := 0; hp numeric; woke boolean := false; st jsonb; mp jsonb; lim numeric; brood int; r jsonb;
  s jsonb; used jsonb := '[]'::jsonb; revived boolean := false;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_damage');
  path := combat_v2_unit_path(p_state, p_target);
  u := p_state #> path; clk := (p_state->>'clock')::int; tick := coalesce((o->>'tick')::boolean, false);
  if p_amount is null then raise exception 'combat_v2_damage: the amount must be a number'; end if;
  if not combat_v2_up(u) or p_amount <= 0 then
    return jsonb_build_object('state', p_state, 'dmg', 0, 'absorbed', 0, 'hp_loss', 0, 'down', not combat_v2_up(u), 'woke', false, 'draws', used);
  end if;
  a := p_amount * (1 - coalesce((u->>'def')::numeric, 0) * (1 - least(1, coalesce((o->>'pierce')::numeric, 0))));
  if side = 'card' and exists (select 1 from combat_v2_units(p_state) x
                                where x.side = 'card' and x.id <> p_target->>'id' and p_state->'cards'->x.id->>'role' = 'warden' and combat_v2_up(p_state->'cards'->x.id)) then
    a := a * (1 - (b->'v2_roles'->'warden'->>'ally_dr')::numeric);
  end if;
  if coalesce(u->'mechanics' ? 'steadfast', false) then
    mp := combat_v2_mech(b, u, 'steadfast');
    lim := coalesce((combat_v2_timed(u, 'steadfast_kinds', clk))::text::numeric, (mp->>'kinds')::numeric);
    if combat_v2_neg_kinds(u, clk, b) < lim then a := a * (1 - (mp->>'dr')::numeric); end if;
  end if;
  brood := coalesce((u->>'brood')::int, 0);
  if brood > 0 then
    a := a * (1 - (combat_v2_mech(b, u, 'brood')->>'dr')::numeric * brood);
    if o->>'kind' = 'burn' or (o->>'src_role' = 'cleaver' and not tick) then u := u || jsonb_build_object('brood', brood - 1); end if;
  end if;
  if not tick then a := greatest((b->'v2_hit'->>'min_dmg')::numeric, a); end if;
  skey := case when side = 'card' then 'shielded' else 'guarded' end;
  sh := coalesce((u->'status'->skey->>'value')::numeric, 0);
  if sh > 0 and not coalesce((o->>'ignore_shield')::boolean, false) then
    sx := coalesce((o->>'shield_x')::numeric, 1);
    -- a shield that takes all it can is used up exactly (no rounding rest of sh / sx)
    if a >= sh / sx then absorbed := sh / sx; sh := 0; else absorbed := a; sh := sh - a * sx; end if;
    a := a - absorbed;
    u := case when sh > 0 then jsonb_set(u, array['status', skey], jsonb_build_object('value', sh)) else jsonb_set(u, '{status}', (u->'status') - skey) end;
  end if;
  hp := (u->>'hp')::numeric;
  hp_loss := least(hp, a);
  u := u || jsonb_build_object('hp', greatest(0, hp - a));
  st := combat_v2_status_on(u, 'sleep', clk);
  if st is not null and not tick then
    u := combat_v2_status_drop(u, 'sleep', side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b); woke := true;
  end if;
  s := jsonb_set(p_state, path, u);
  if hp - a <= 0 then
    r := combat_v2_drop(s, p_target, b); s := r->'state'; revived := (r->>'revived')::boolean;
    if (r->>'volatile')::boolean then
      r := combat_v2_volatile(s, p_target, o->'draws', b); s := r->'state'; used := used || (r->'draws');
    end if;
  end if;
  return jsonb_build_object('state', s, 'dmg', absorbed + hp_loss, 'absorbed', absorbed, 'hp_loss', hp_loss,
    'down', hp - a <= 0 and not revived, 'woke', woke, 'revived', revived, 'draws', used);
end $fn$;

-- E5 with Brood (brood_after of the hit) and the fall (combat_v2_drop: Undying). The answer adds down and volatile (the caller makes the Volatile Core
-- hits with its draws: combat_v2_volatile).
create or replace function public.combat_v2_hit_apply(p_state jsonb, p_target jsonb, p_hit jsonb, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); path text[]; u jsonb; side text := p_target->>'side'; skey text; clk int; woke boolean := false;
  s jsonb; r jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_hit_apply');
  path := combat_v2_unit_path(p_state, p_target);
  if jsonb_typeof(p_hit) is distinct from 'object' or p_hit->>'side' is null then raise exception 'combat_v2_hit_apply: the hit must be an answer of combat_v2_hit'; end if;
  if (p_hit->>'side' = 'card') <> (side = 'enemy') then raise exception 'combat_v2_hit_apply: a hit of side % lands on the other side (target %)', p_hit->>'side', side; end if;
  u := p_state #> path; clk := (p_state->>'clock')::int;
  if not coalesce((p_hit->>'hit')::boolean, false) or not combat_v2_up(u) then return jsonb_build_object('state', p_state, 'woke', false, 'down', false, 'volatile', false); end if;
  skey := case when side = 'card' then 'shielded' else 'guarded' end;
  u := u || jsonb_build_object('hp', (p_hit->>'hp_after')::numeric);
  if p_hit ? 'brood_after' then u := u || jsonb_build_object('brood', (p_hit->>'brood_after')::int); end if;
  u := case when (p_hit->>'shield_after')::numeric > 0 then jsonb_set(u, array['status', skey], jsonb_build_object('value', (p_hit->>'shield_after')::numeric))
            else jsonb_set(u, '{status}', coalesce(u->'status', '{}'::jsonb) - skey) end;
  if (p_hit->>'raw')::numeric > 0 and combat_v2_status_on(u, 'sleep', clk) is not null then
    u := combat_v2_status_drop(u, 'sleep', side, side = 'enemy' and p_state->>'mode' = 'hunt', clk, b); woke := true;
  end if;
  s := jsonb_set(p_state, path, u);
  if coalesce((p_hit->>'down')::boolean, false) then
    r := combat_v2_drop(s, p_target, b);
    return jsonb_build_object('state', r->'state', 'woke', woke, 'down', (r->>'down')::boolean, 'volatile', (r->>'volatile')::boolean);
  end if;
  return jsonb_build_object('state', s, 'woke', woke, 'down', false, 'volatile', false);
end $fn$;

-- E5 with the enemy rules of the simulator Battle.heal: a card heal x Bloodrot (a standing enemy with the rule) x its timed heal_cut; a card heal above 0 counts
-- for the step (state ext.healed and the card's healed: Siphon and Decay read them) and a standing enemy with the timed heal_mirror heals v x that heal.
create or replace function public.combat_v2_heal(p_state jsonb, p_target jsonb, p_amount numeric, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); path text[]; u jsonb; h numeric; amt numeric := p_amount; clk int; r jsonb; s jsonb; mi jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_heal');
  path := combat_v2_unit_path(p_state, p_target);
  u := p_state #> path; clk := (p_state->>'clock')::int;
  if p_amount is null then raise exception 'combat_v2_heal: the amount must be a number'; end if;
  if not combat_v2_up(u) or p_amount <= 0 then return jsonb_build_object('state', p_state, 'healed', 0); end if;
  if p_target->>'side' = 'card' then
    r := combat_v2_standing_rule(p_state, 'bloodrot', b);
    if r is not null then amt := amt * (r->>'card_heal_x')::numeric; end if;
    if combat_v2_timed(u, 'heal_cut', clk) is not null then amt := amt * (combat_v2_timed(u, 'heal_cut', clk))::text::numeric; end if;
  end if;
  h := least((u->>'max')::numeric - (u->>'hp')::numeric,
             amt * case when combat_v2_status_on(u, 'burn', clk) is not null then (b->'v2_status'->'burn'->>'heal_x')::numeric else 1 end);
  h := greatest(0, h);
  u := u || jsonb_build_object('hp', (u->>'hp')::numeric + h);
  if p_target->>'side' = 'card' and h > 0 then
    u := u || jsonb_build_object('healed', jsonb_build_object('step', clk, 'v', combat_v2_healed(u, clk) + h));
    s := jsonb_set(p_state, path, u);
    s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('healed', jsonb_build_object('step', clk, 'v', combat_v2_healed(s->'ext', clk) + h)));
    mi := combat_v2_timed_any(s, 'heal_mirror');
    if mi is not null then s := combat_v2_heal(s, jsonb_build_object('side', 'enemy', 'id', mi->'id'), h * (mi->>'v')::numeric, b)->'state'; end if;
    return jsonb_build_object('state', s, 'healed', h);
  end if;
  return jsonb_build_object('state', jsonb_set(p_state, path, u), 'healed', h);
end $fn$;

-- ============================================================ 6. replaced: the step end, the turn start, the clock
-- E5 with the draws of E7: Plaguebearer (after its Poison tick, a standing card gets plaguebearer.poison Poison: one pick draw), Regrowth (an enemy heals
-- heal x its max HP each step, the Hunt boss boss_heal x boss_heal_ref; x below_half_x below v2_enemy.boss_moves.rage_at of its HP), Siphon (x the card
-- heals of the step), Brood (a Burn tick removes one), Undying and Volatile Core (a tick that downs a unit). Each standing unit in the fixed order: Poison,
-- Plaguebearer, Burn, Regrowth, Siphon, then the statuses that end (the simulator Battle.endStep). Answer {state, ticks, ended, draws}.
create or replace function public.combat_v2_step_end(p_state jsonb, p_b jsonb, p_draws jsonb) returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); ss jsonb := b->'v2_status';
  s jsonb := p_state; clk int; x record; path text[]; u jsonb; ref jsonb; r jsonb; amt numeric; k text; boss boolean; mp jsonb; lst text[]; dv numeric;
  ticks jsonb := '[]'::jsonb; ended jsonb := '[]'::jsonb; d jsonb := p_draws; used jsonb := '[]'::jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_step_end');
  clk := (p_state->>'clock')::int;
  if coalesce((p_state->'ext'->>'step_end')::int >= clk, false) then
    return jsonb_build_object('state', p_state, 'ticks', ticks, 'ended', ended, 'done', true, 'draws', used);
  end if;
  for x in select * from combat_v2_units(p_state) order by n loop
    path := case when x.side = 'card' then array['cards', x.id] else array['enemies', x.id] end;
    ref := jsonb_build_object('side', x.side, 'id', x.id::numeric);
    boss := x.side = 'enemy' and s->>'mode' = 'hunt';
    u := s #> path;
    continue when not combat_v2_up(u);
    -- Poison, then Plaguebearer
    if combat_v2_status_on(u, 'poison', clk) is not null then
      amt := (u->'status'->'poison'->>'stacks')::numeric * (ss->'poison'->>'tick')::numeric
             * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0));
      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'poison'->>'ignore_shield')::boolean, 'kind', 'poison')
                                         || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
      s := r->'state'; u := s #> path; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      ticks := ticks || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', 'poison', 'dmg', r->'dmg');
      if combat_v2_up(u) and coalesce(u->'mechanics' ? 'plaguebearer', false) then
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
        if cardinality(lst) > 0 then
          dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
          r := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', lst[floor(dv * cardinality(lst))::int + 1]::numeric), 'poison',
                 jsonb_build_object('stacks', (combat_v2_mech(b, u, 'plaguebearer')->>'poison')::int, 'src', ref) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
          s := r->'state'; u := s #> path; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
        end if;
      end if;
    end if;
    -- Burn (x vs_healer_x vs a healer), then it decays
    if combat_v2_up(u) and combat_v2_status_on(u, 'burn', clk) is not null then
      amt := (u->'status'->'burn'->>'stacks')::numeric * (ss->'poison'->>'tick')::numeric * (ss->'burn'->>'tick_x')::numeric
             * case when boss then (ss->>'hunt_ref_hp')::numeric else (u->>'max')::numeric end
             * (1 + coalesce((combat_v2_status_on(u, 'exposed', clk)->>'value')::numeric, 0))
             * case when coalesce((u->>'healer')::boolean, false) or coalesce(u->'mechanics' ? 'regrowth', false) then (ss->'burn'->>'vs_healer_x')::numeric else 1 end;
      r := combat_v2_damage(s, ref, amt, jsonb_build_object('tick', true, 'ignore_shield', (ss->'burn'->>'ignore_shield')::boolean, 'kind', 'burn')
                                         || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
      s := r->'state'; u := s #> path; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      ticks := ticks || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', 'burn', 'dmg', r->'dmg');
      if coalesce(u->'status' ? 'burn', false) then
        u := case when (u->'status'->'burn'->>'stacks')::int - (ss->'burn'->>'decay')::int <= 0 then jsonb_set(u, '{status}', (u->'status') - 'burn')
                  else jsonb_set(u, '{status,burn,stacks}', to_jsonb((u->'status'->'burn'->>'stacks')::int - (ss->'burn'->>'decay')::int)) end;
        s := jsonb_set(s, path, u);
      end if;
    end if;
    -- Regrowth
    if combat_v2_up(u) and coalesce(u->'mechanics' ? 'regrowth', false) then
      mp := combat_v2_mech(b, u, 'regrowth');
      amt := case when boss then (b->'v2_enemy'->>'boss_heal_ref')::numeric * coalesce((mp->>'boss_heal')::numeric, (mp->>'heal')::numeric)
                  else (u->>'max')::numeric * (mp->>'heal')::numeric end
             * case when (u->>'hp')::numeric / (u->>'max')::numeric < (b->'v2_enemy'->'boss_moves'->>'rage_at')::numeric then (mp->>'below_half_x')::numeric else 1 end;
      s := combat_v2_heal(s, ref, amt, b)->'state'; u := s #> path;
    end if;
    -- Siphon: the card heals of the step
    if combat_v2_up(u) and coalesce(u->'mechanics' ? 'siphon', false) and combat_v2_healed(s->'ext', clk) > 0 then
      s := combat_v2_heal(s, ref, combat_v2_healed(s->'ext', clk) * (combat_v2_mech(b, u, 'siphon')->>'x')::numeric, b)->'state'; u := s #> path;
    end if;
    -- the statuses that end in this step
    if combat_v2_up(u) then
      for k in select y.key from jsonb_each(u->'status') y where jsonb_typeof(y.value->'until') = 'number' and (y.value->>'until')::int <= clk
                order by (b->'statuses'->y.key->>'ord')::int loop
        u := combat_v2_status_drop(u, k, x.side, boss, clk, b);
        ended := ended || jsonb_build_object('side', x.side, 'id', x.id::numeric, 'status', k);
      end loop;
      s := jsonb_set(s, path, u);
    end if;
  end loop;
  s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('step_end', clk));
  return jsonb_build_object('state', s, 'ticks', ticks, 'ended', ended, 'draws', used);
end $fn$;

-- E5's two-argument form: the same step end, its draws from random().
create or replace function public.combat_v2_step_end(p_state jsonb, p_b jsonb default null) returns jsonb language sql volatile set search_path = public as $fn$
  select combat_v2_step_end(p_state, p_b, null::jsonb);
$fn$;

-- E5 with the enemy turn of the simulator Battle.act: an enemy counts its turn (turn + 1, also a skipped one), Purify (every purify.every-th turn it
-- removes its harmful statuses that are not locked), Elusive (its Mark ends); Stunned or Frozen with extra (the Controller week) skip and keep the status
-- (extra - 1); a skipped enemy turn ends Charging (charging false: the Cataclysm cancel by a skip); a banned card (the boss move Ban) skips its turn
-- (banned - 1, reason banned).
create or replace function public.combat_v2_turn_start(p_state jsonb, p_actor jsonb, p_draws jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); path text[]; u jsonb; side text := p_actor->>'side'; clk int; k text; d numeric; used jsonb := '[]'::jsonb;
  boss boolean; why text; s jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_turn_start');
  if p_draws is not null and jsonb_typeof(p_draws) <> 'array' then raise exception 'combat_v2_turn_start: draws must be a list of numbers'; end if;
  path := combat_v2_unit_path(p_state, p_actor);
  u := p_state #> path; clk := (p_state->>'clock')::int; boss := side = 'enemy' and p_state->>'mode' = 'hunt';
  if side = 'enemy' then
    u := u || jsonb_build_object('turn', coalesce((u->>'turn')::int, 0) + 1);
    if coalesce(u->'mechanics' ? 'purify', false) and (u->>'turn')::int % (combat_v2_mech(b, u, 'purify')->>'every')::int = 0 then
      for k in select x.key from jsonb_each(b->'statuses') x where (x.value->>'negative')::boolean order by (x.value->>'ord')::int loop
        if coalesce(u->'status' ? k, false) and not coalesce((u->'status'->k->>'locked')::boolean, false) then u := combat_v2_status_drop(u, k, side, boss, clk, b); end if;
      end loop;
    end if;
    if coalesce(u->'mechanics' ? 'elusive', false) then u := jsonb_set(u, '{status}', coalesce(u->'status', '{}'::jsonb) - 'mark'); end if;
  end if;
  k := case when combat_v2_status_on(u, 'stunned', clk) is not null then 'stunned' when combat_v2_status_on(u, 'frozen', clk) is not null then 'frozen' end;
  if k is not null then
    if coalesce((u->'status'->k->>'extra')::int, 0) > 0 then u := jsonb_set(u, array['status', k, 'extra'], to_jsonb((u->'status'->k->>'extra')::int - 1));
    else u := combat_v2_status_drop(u, k, side, boss, clk, b);
    end if;
    why := k;
  elsif combat_v2_status_on(u, 'sleep', clk) is not null then
    why := 'sleep';
  elsif combat_v2_status_on(u, 'paralyzed', clk) is not null then
    d := combat_v2_draw(p_draws, jsonb_array_length(used)); used := used || to_jsonb(d);
    if d < (b->'v2_status'->'paralyzed'->>'fail')::numeric then why := 'paralyzed'; end if;
  end if;
  if why is not null then
    if side = 'enemy' then u := u || jsonb_build_object('charging', false); end if;
    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'skip', true, 'reason', why, 'draws', used);
  end if;
  if side = 'card' and coalesce((u->>'banned')::int, 0) > 0 then
    u := u || jsonb_build_object('banned', (u->>'banned')::int - 1);
    return jsonb_build_object('state', jsonb_set(p_state, path, u), 'skip', true, 'reason', 'banned', 'draws', used);
  end if;
  s := case when side = 'enemy' then jsonb_set(p_state, path, u) else p_state end;
  return jsonb_build_object('state', s, 'skip', false, 'draws', used);
end $fn$;

-- E5 with the draws of the step end (combat_v2_step_end with draws: Plaguebearer, Volatile Core), then the turn start. Everything else as E5.
create or replace function public.combat_v2_next(p_state jsonb, p_draws jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); s jsonb := p_state; a jsonb; e jsonb; t jsonb; cap int; ckey text;
  steps int := 0; ticks jsonb := '[]'::jsonb; ended jsonb := '[]'::jsonb; d jsonb := p_draws; used jsonb := '[]'::jsonb;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_next');
  if b->'v2_speed' is null or b->'v2_hunt' is null or b->'v2_dungeon' is null then raise exception 'combat_v2_next: no value for v2_speed, v2_hunt or v2_dungeon'; end if;
  ckey := case when p_state->>'mode' = 'hunt' then 'v2_hunt' else 'v2_dungeon' end;
  cap := (b->ckey->>'round_cap')::int;
  loop
    -- the fight is over when one side has no standing unit (the caller says won or lost)
    if not exists (select 1 from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id))
       or not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int)) then
      a := jsonb_build_object('state', s, 'event', 'end'); exit;
    end if;
    -- an action in the current step (no new step may start: the cap is the clock)
    a := combat_v2_advance(s, jsonb_set(b, array[ckey, 'round_cap'], to_jsonb((s->>'clock')::int)));
    exit when a->>'event' in ('act', 'none');
    -- the step is over: its end, then one new step
    if (s->>'clock')::int > 0 then
      e := combat_v2_step_end(s, b, d); s := e->'state'; ticks := ticks || (e->'ticks'); ended := ended || (e->'ended');
      used := used || (e->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(e->'draws'));
      if not exists (select 1 from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id))
         or not exists (select 1 from combat_v2_units(s) x where x.side = 'enemy' and combat_v2_up(s->'enemies'->x.id::int)) then
        a := jsonb_build_object('state', s, 'event', 'end'); exit;
      end if;
    end if;
    if (s->>'clock')::int >= cap then
      a := jsonb_build_object('state', s, 'event', 'cap'); exit;
    end if;
    a := combat_v2_advance(s, jsonb_set(b, array[ckey, 'round_cap'], to_jsonb((s->>'clock')::int + 1)));
    steps := steps + (a->>'steps')::int;
    s := a->'state';
    exit when a->>'event' in ('act', 'none');
  end loop;
  if a->>'event' <> 'act' then
    return jsonb_build_object('state', a->'state', 'event', a->'event', 'steps', steps, 'ticks', ticks, 'ended', ended, 'skip', false, 'draws', used);
  end if;
  t := combat_v2_turn_start(a->'state', a->'actor', d, b);
  return jsonb_build_object('state', t->'state', 'event', 'act', 'actor', a->'actor', 'steps', steps, 'ticks', ticks, 'ended', ended,
    'skip', t->'skip', 'reason', t->'reason', 'draws', used || (t->'draws'));
end $fn$;

-- ============================================================ 7. replaced: the card action (the gate, the hit, the basic attack, the active, the act)
-- T1: the gate enemy_charging holds while the target is Charging (charging: the turn before its Cataclysm), as the simulator gateOn. T1 read cataclysm
-- (the foe kind charges at all). Everything else as T1.
create or replace function public.combat_effect_v2_gate(p_state jsonb, p_unit jsonb, p_tgt jsonb, p_att jsonb) returns boolean
language plpgsql immutable set search_path = public as $fn$
declare clk int := (p_state->>'clock')::int;
begin
  return case p_att->>'k'
    when 'self_has' then combat_v2_status_on(p_unit, p_att->>'status', clk) is not null
    when 'self_shield' then coalesce((combat_v2_status_on(p_unit, 'shielded', clk)->>'value')::numeric, 0) > 0
    when 'enemy_charging' then coalesce((p_tgt->>'charging')::boolean, false)
    when 'foes_alive' then (select count(*) from combat_v2_units(p_state) q where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int))) > 1
  end;
end $fn$;

-- E6 with Volatile Core: a card hit that downs a Volatile Core enemy makes its hits on every card (their draws after the hit, added to hit.draws), before
-- the Survivor heal (the simulator damage, fall, then cardHit's heal). Everything else as E6.
create or replace function public.combat_effect_v2_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_ctx jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare a jsonb; t jsonb; h jsonb; s jsonb; foes int; r jsonb; v jsonb;
begin
  a := p_state #> combat_v2_unit_path(p_state, p_att); t := p_state #> combat_v2_unit_path(p_state, p_tgt);
  select count(*) into foes from combat_v2_units(p_state) x where x.side = 'enemy' and combat_v2_up(p_state->'enemies'->(x.id::int));
  h := combat_v2_hit(a, t, coalesce(p_ctx, '{}'::jsonb) || jsonb_build_object('side', 'card', 'clock', p_state->'clock', 'mode', p_state->'mode', 'foes_alive', foes)
                         || case when p_draws is null then '{}'::jsonb else jsonb_build_object('draws', p_draws) end, p_b);
  r := combat_v2_hit_apply(p_state, p_tgt, h, p_b); s := r->'state';
  if coalesce((r->>'volatile')::boolean, false) then
    v := combat_v2_volatile(s, p_tgt, combat_v2_draws_rest(p_draws, jsonb_array_length(h->'draws')), p_b);
    s := v->'state'; h := h || jsonb_build_object('draws', (h->'draws') || (v->'draws'));
  end if;
  if (h->>'heal')::numeric > 0 then s := combat_v2_heal(s, p_att, (h->>'heal')::numeric, p_b)->'state'; end if;
  return jsonb_build_object('state', s, 'hit', h);
end $fn$;
-- E6 with Rollback (an Artillery basic on it) and the kinds of the Flurry second strike (extra) and the Cleaver splash (splash) for Mirror Hide.
-- Everything else as E6.
create or replace function public.combat_effect_v2_basic(p_state jsonb, p_actor jsonb, p_target jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  ro jsonb := p_b->'v2_roles'; s jsonb := p_state; u jsonb; role text; cls text; ab numeric; rb jsonb;
  d jsonb := p_draws; used jsonb := '[]'::jsonb; dv numeric; r jsonb; w jsonb; h jsonb; hits jsonb := '[]'::jsonb; best text; lst text[]; id text;
begin
  u := s #> combat_v2_unit_path(s, p_actor); role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1);
  -- Confused: the attack may hit a unit of its own side
  w := combat_v2_confused_target(s, p_actor, d, p_b);
  used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
  if (w->>'wrong')::boolean then
    r := combat_v2_damage(s, w->'target', (u->>'atk')::numeric * case when cls = 'support' then (p_b->'v2_support'->>'basic_x')::numeric else 1 end * (w->>'x')::numeric, null, p_b);
    return jsonb_build_object('state', r->'state', 'hits', jsonb_build_array(jsonb_build_object('target', w->'target', 'confused', true, 'dmg', r->'dmg')), 'draws', used);
  end if;
  if cls = 'support' then
    -- Rollback: an Artillery basic on it deals rollback.artillery_basic_x and is a true strike only with artillery_true_strike
    rb := case when role = 'artillery' and coalesce((s #> combat_v2_unit_path(s, p_target))->'mechanics' ? 'rollback', false)
               then combat_v2_mech(p_b, s #> combat_v2_unit_path(s, p_target), 'rollback') end;
    r := combat_effect_v2_hit(s, p_actor, p_target, case when rb is null then '{"basic": true}'::jsonb
                                                        else jsonb_build_object('x', (rb->>'artillery_basic_x')::numeric, 'true_strike', (rb->>'artillery_true_strike')::boolean) end, d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
    if (h->>'dmg')::numeric > 0 then s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state'; end if;
    -- Spotter: a basic attack that deals damage Exposes the target
    if role = 'spotter' and (h->>'dmg')::numeric > 0 then
      r := combat_v2_status_apply(s, p_target, 'exposed', jsonb_build_object('value', (ro->'spotter'->>'basic_expose')::numeric * ab, 'src', p_actor)
                                  || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    -- Herald: a basic attack Empowers the strongest standing attacker (the highest power, the first in the fixed order)
    if role = 'herald' then
      best := null;
      for id in select x.id from combat_v2_units(s) x where x.side = 'card' and combat_v2_up(s->'cards'->x.id) and s->'cards'->x.id->>'class' = 'attacker' order by x.n loop
        if best is null or (s->'cards'->id->>'atk')::numeric > (s->'cards'->best->>'atk')::numeric then best := id; end if;
      end loop;
      if best is not null then
        s := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', best::numeric), 'empowered',
                                    jsonb_build_object('value', (ro->'herald'->>'basic_empower')::numeric * ab, 'src', p_actor), p_b)->'state';
      end if;
    end if;
    return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
  end if;
  -- an attacker: the hit, the Flurry second strike (its draw comes after the hit), the Cleaver splash
  r := combat_effect_v2_hit(s, p_actor, p_target, '{"x": 1}'::jsonb, d, p_b);
  s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
  hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
  if role = 'flurry' then
    dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
    if dv < (ro->'flurry'->>'extra_chance')::numeric * ab and combat_v2_up(s #> combat_v2_unit_path(s, p_target)) then
      r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', (ro->'flurry'->>'extra_x')::numeric, 'kind', 'extra'), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'extra', true));
    end if;
  end if;
  if role = 'cleaver' then
    lst := array(select x.id from combat_v2_units(s) x where x.side = 'enemy' and x.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(x.id::int)) order by x.n);
    foreach id in array lst loop
      r := combat_effect_v2_hit(s, p_actor, jsonb_build_object('side', 'enemy', 'id', id::numeric), jsonb_build_object('x', (ro->'cleaver'->>'splash')::numeric * ab, 'kind', 'splash'), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', jsonb_build_object('side', 'enemy', 'id', id::numeric), 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'splash', true));
    end loop;
  end if;
  s := combat_v2_status_remove(s, p_actor, 'empowered', p_b)->'state';
  s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- T1b with the enemy rules of the simulator doActive and smite: Mirror Hide (each strike of a multi-strike active x strikes_x; the area hits are kind area),
-- Rot on a cure, Rollback, Desync and Mirror on a smite, last_smite, the draws of Detonate (Volatile Core). Everything else as T1b.
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
  pays jsonb := '[]'::jsonb; abonus numeric; acrit numeric; au jsonb; mp jsonb;
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
      elsif k = 'payoff_dmg' then if combat_effect_v2_has(tu, blk, clk) then bonus := bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
      elsif k = 'payoff_crit' then if combat_effect_v2_has(tu, blk, clk) then crit_bonus := crit_bonus + (blk->>'v')::numeric * ab; end if; pays := pays || jsonb_build_array(blk);
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
    -- Mirror Hide: each strike of a multi-strike active x mirror_hide.strikes_x
    if ns > 1 and coalesce(tu->'mechanics' ? 'mirror_hide', false) then x := x * (combat_v2_mech(p_b, tu, 'mirror_hide')->>'strikes_x')::numeric; end if;
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
    -- the area hits (all_enemies): every other standing enemy, the same shape at x = area (no vs_x); the riders with all. T1b (recommendation 5): the
    -- payoffs count on each area hit against THAT enemy's statuses (before its hit): payoff_dmg is its bonus, payoff_crit its crit bonus
    if area > 0 then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'enemy' and q.id <> p_target->>'id' and combat_v2_up(s->'enemies'->(q.id::int)) order by q.n);
      foreach id in array lst loop
        ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
        au := s->'enemies'->(id::int); abonus := 0; acrit := 0;
        for blk in select x2 from jsonb_array_elements(pays) x2 loop
          if combat_effect_v2_has(au, blk, clk) then
            if blk->>'k' = 'payoff_dmg' then abonus := abonus + (blk->>'v')::numeric * ab; else acrit := acrit + (blk->>'v')::numeric * ab; end if;
          end if;
        end loop;
        r := combat_effect_v2_hit(s, p_actor, ref, (ctx - 'vs_x') || jsonb_build_object('x', area, 'bonus', abonus, 'crit_bonus', acrit, 'kind', 'area'), d, p_b);
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
      r := combat_v2_status_cure(s, al, keys, (blk->>'immune')::int, p_b); s := r->'state';
      cured := al;
      -- Rot (a timed state of a standing enemy): a cure that removed a status also removes the boosts and the shield of the cured ally
      if (r->>'cured')::int > 0 and combat_v2_timed_any(s, 'rot') is not null then s := combat_v2_status_strip(s, al, null, p_b)->'state'; end if;
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
        r := combat_v2_damage(s, p_target, tot * (blk->>'x')::numeric * (1 + coalesce((combat_v2_status_on(tu, 'exposed', clk)->>'value')::numeric, 0)),
                              jsonb_build_object('tick', true, 'ignore_shield', true) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
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
    -- the enemy rules of a smite (the simulator smite): Rollback (x rollback.smite_x), Desync (timed desync_smite: the smite misses and the state ends),
    -- Mirror (timed mirror_smite: the smite hits its caster for its atk x the smite x vs_status, and the state ends); else the hit, the Mark ends, last_smite
    tu := s #> tpath;
    if coalesce(tu->'mechanics' ? 'rollback', false) then smite_x := smite_x * (combat_v2_mech(p_b, tu, 'rollback')->>'smite_x')::numeric; end if;
    if combat_v2_timed(tu, 'desync_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'desync_smite'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', 0, 'crit', false, 'miss', true, 'desync', true));
    elsif combat_v2_timed(tu, 'mirror_smite', clk) is not null then
      s := jsonb_set(s, tpath, jsonb_set(tu, '{timed}', (tu->'timed') - 'mirror_smite'));
      r := combat_v2_damage(s, p_actor, (u->>'atk')::numeric * smite_x * svs, case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || coalesce(r->'draws', '[]'::jsonb); d := combat_v2_draws_rest(d, jsonb_array_length(coalesce(r->'draws', '[]'::jsonb)));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_actor, 'dmg', r->'dmg', 'crit', false, 'miss', false, 'mirrored', true));
    else
      r := combat_effect_v2_hit(s, p_actor, p_target, jsonb_build_object('x', smite_x, 'true_strike', true, 'vs_x', svs, 'bonus', sbonus, 'crit_add', scrit), d, p_b);
      s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
      hits := hits || jsonb_build_array(jsonb_build_object('target', p_target, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss'));
      s := combat_v2_status_remove(s, p_target, 'mark', p_b)->'state';
      s := jsonb_set(s, tpath || '{last_smite}'::text[], to_jsonb((h->>'dmg')::numeric));
    end if;
  end if;
  foreach id in array lst loop
    ref := jsonb_build_object('side', 'enemy', 'id', id::numeric);
    r := combat_effect_v2_hit(s, p_actor, ref, jsonb_build_object('x', area_x, 'true_strike', true, 'kind', 'area'), d, p_b);
    s := r->'state'; h := r->'hit'; used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
    hits := hits || jsonb_build_array(jsonb_build_object('target', ref, 'dmg', h->'dmg', 'crit', h->'crit', 'miss', h->'miss', 'area', true));
  end loop;
  return jsonb_build_object('state', s, 'hits', hits, 'draws', used);
end $fn$;

-- E6 with last_support (state ext: the last support card that acted). Everything else as E6.
create or replace function public.combat_v2_card_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb);
  s jsonb := p_state; apath text[]; u jsonb; role text; cls text; ab numeric; tgt jsonb := o->'target'; d jsonb := o->'draws';
  use boolean; ready boolean; need int; r jsonb; mh text; id text;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_card_act');
  if b->'v2_support' is null or b->'v2_charge' is null or b->'blocks' is null or b->'stacking' is null then
    raise exception 'combat_v2_card_act: no value for v2_support, v2_charge, stacking or blocks (combat_v2_action_numbers)';
  end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'combat_v2_card_act: opts must be an object'; end if;
  if d is not null and jsonb_typeof(d) <> 'array' then raise exception 'combat_v2_card_act: opts.draws must be a list of numbers'; end if;
  if o ? 'use' and jsonb_typeof(o->'use') <> 'boolean' then raise exception 'combat_v2_card_act: opts.use must be true or false'; end if;
  use := coalesce((o->>'use')::boolean, false);
  if p_actor->>'side' is distinct from 'card' then raise exception 'combat_v2_card_act: the actor must be a card ({side: card, id})'; end if;
  apath := combat_v2_unit_path(s, p_actor); u := s #> apath;
  if not combat_v2_up(u) then raise exception 'combat_v2_card_act: card % is down', p_actor->>'id'; end if;
  role := u->>'role'; cls := u->>'class'; ab := coalesce((u->>'abl')::numeric, 1);
  if b->'v2_roles'->role is null or role like '\_%' or cls is null or cls not in ('attacker', 'support') then
    raise exception 'combat_v2_card_act: card % needs a role of v2_roles and its class (attacker or support)', p_actor->>'id';
  end if;
  -- no standing enemy: nothing happens (the simulator cardAct)
  if not exists (select 1 from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int))) then
    return jsonb_build_object('state', s, 'action', 'none', 'hits', '[]'::jsonb, 'draws', '[]'::jsonb);
  end if;
  if jsonb_typeof(tgt) is distinct from 'object' or tgt->>'side' is distinct from 'enemy' then raise exception 'combat_v2_card_act: opts.target must be an enemy ({side: enemy, id})'; end if;
  if not combat_v2_up(s #> combat_v2_unit_path(s, tgt)) then raise exception 'combat_v2_card_act: the target enemy % is down', tgt->>'id'; end if;
  -- the charge (plan 2.1): the active is ready after v2_charge.<class> own turns that did not use it
  need := (b->'v2_charge'->>cls)::int;
  ready := coalesce((u->>'charge')::int, 0) >= need;
  if use and not ready then raise exception 'combat_v2_card_act: the active of card % is not charged (% of % turns)', p_actor->>'id', coalesce((u->>'charge')::int, 0), need; end if;
  r := case when use then combat_effect_v2_active(s, p_actor, tgt, o->'ally', d, b) else combat_effect_v2_basic(s, p_actor, tgt, d, b) end;
  s := r->'state'; u := s #> apath;
  u := u || case when use then jsonb_build_object('charge', 0, 'held', 0)
                 when ready then jsonb_build_object('held', coalesce((u->>'held')::int, 0) + 1)
                 else jsonb_build_object('charge', coalesce((u->>'charge')::int, 0) + 1) end;
  s := jsonb_set(s, apath, u);
  -- the Medic passive: after each of its actions, heal the most hurt standing ally (the lowest HP share below its max, the first in the fixed order)
  if role = 'medic' then
    mh := null;
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      if (s->'cards'->id->>'hp')::numeric < (s->'cards'->id->>'max')::numeric
         and (mh is null or (s->'cards'->id->>'hp')::numeric / (s->'cards'->id->>'max')::numeric < (s->'cards'->mh->>'hp')::numeric / (s->'cards'->mh->>'max')::numeric) then
        mh := id;
      end if;
    end loop;
    if mh is not null then
      s := combat_v2_heal(s, jsonb_build_object('side', 'card', 'id', mh::numeric),
                          (b->'v2_roles'->'medic'->>'heal_after')::numeric * ab * (s->'cards'->mh->>'max')::numeric, b)->'state';
    end if;
  end if;
  -- the last support card that acted (the boss move target last_support)
  if cls = 'support' then s := jsonb_set(s, '{ext}', coalesce(s->'ext', '{}'::jsonb) || jsonb_build_object('last_support', (p_actor->>'id')::numeric)); end if;
  return jsonb_build_object('state', s, 'action', case when use then 'active' else 'basic' end, 'hits', r->'hits', 'draws', r->'draws');
end $fn$;


-- ============================================================ 8. the enemy action
-- A random standing card for an enemy move: a Warden weighs v2_roles.warden.taunt_w, every other card 1 (the simulator pickCard). One draw. {ref, draws}.
create or replace function public.combat_v2_pick_card(p_state jsonb, p_draws jsonb, p_b jsonb) returns jsonb language plpgsql volatile set search_path = public as $fn$
declare ids text[]; w numeric[] := '{}'; tot numeric := 0; i int; d numeric; r numeric; tw numeric := (p_b->'v2_roles'->'warden'->>'taunt_w')::numeric;
begin
  ids := array(select q.id from combat_v2_units(p_state) q where q.side = 'card' and combat_v2_up(p_state->'cards'->q.id) order by q.n);
  if cardinality(ids) = 0 then return jsonb_build_object('ref', null, 'draws', '[]'::jsonb); end if;
  for i in 1 .. cardinality(ids) loop
    w[i] := case when p_state->'cards'->ids[i]->>'role' = 'warden' then tw else 1 end; tot := tot + w[i];
  end loop;
  d := combat_v2_draw(p_draws, 0); r := d * tot;
  for i in 1 .. cardinality(ids) loop
    r := r - w[i];
    if r < 0 then return jsonb_build_object('ref', jsonb_build_object('side', 'card', 'id', ids[i]::numeric), 'draws', jsonb_build_array(d)); end if;
  end loop;
  return jsonb_build_object('ref', jsonb_build_object('side', 'card', 'id', ids[cardinality(ids)]::numeric), 'draws', jsonb_build_array(d));
end $fn$;

-- The damage multiplier of an enemy (the simulator enemyMult): Enraged, the Hunt boss rage below rage_at, Weakened, Chill, Pack.
create or replace function public.combat_v2_enemy_mult(p_state jsonb, p_unit jsonb, p_b jsonb) returns numeric language plpgsql immutable set search_path = public as $fn$
declare m numeric := 1; clk int := (p_state->>'clock')::int; s jsonb; bm jsonb := p_b->'v2_enemy'->'boss_moves';
begin
  s := combat_v2_status_on(p_unit, 'enraged', clk); if s is not null then m := m * (s->>'value')::numeric; end if;
  if p_state->>'mode' = 'hunt' and (p_unit->>'hp')::numeric / (p_unit->>'max')::numeric < (bm->>'rage_at')::numeric then m := m * (bm->>'rage_x')::numeric; end if;
  s := combat_v2_status_on(p_unit, 'weakened', clk); if s is not null then m := m * (1 - (s->>'value')::numeric); end if;
  s := combat_v2_status_on(p_unit, 'chill', clk); if s is not null then m := m * (1 - (p_b->'v2_status'->'chill'->>'dmg')::numeric * coalesce((s->>'stacks')::numeric, 1)); end if;
  if coalesce(p_unit->'mechanics' ? 'pack', false) then
    m := m * (1 + (combat_v2_mech(p_b, p_unit, 'pack')->>'atk_per_foe')::numeric
                  * (select count(*) from combat_v2_units(p_state) q where q.side = 'enemy' and combat_v2_up(p_state->'enemies'->(q.id::int))));
  end if;
  return m;
end $fn$;

-- ONE enemy hit on a card (the simulator enemyHit): combat_v2_hit (ctx side enemy: x, area, the Warden of the squad, the standing enemies for Pack,
-- opts.ignore_shield) written by combat_v2_hit_apply; then Crush (the shield the hit removed x crush.x, a tick with pierce 1 that ignores shields), the
-- single-hit riders Frost Aura (Chill), Venom (Poison), Burning (Burn) and, on an area hit, Slowing. A down card takes nothing. {state, dealt, hit, draws}.
create or replace function public.combat_v2_enemy_hit(p_state jsonb, p_att jsonb, p_tgt jsonb, p_x numeric, p_area boolean, p_opts jsonb, p_draws jsonb, p_b jsonb)
returns jsonb language plpgsql volatile set search_path = public as $fn$
declare s jsonb := p_state; a jsonb; t jsonb; tpath text[]; h jsonb; r jsonb; d jsonb := p_draws; used jsonb := '[]'::jsonb; w boolean; foes int; lost numeric;
  m text; st text; n int; o jsonb := coalesce(p_opts, '{}'::jsonb);
begin
  tpath := combat_v2_unit_path(s, p_tgt); t := s #> tpath;
  if not combat_v2_up(t) then return jsonb_build_object('state', s, 'dealt', 0, 'hit', false, 'draws', used); end if;
  a := s #> combat_v2_unit_path(s, p_att);
  w := exists (select 1 from combat_v2_units(s) q where q.side = 'card' and q.id <> p_tgt->>'id' and s->'cards'->q.id->>'role' = 'warden' and combat_v2_up(s->'cards'->q.id));
  select count(*) into foes from combat_v2_units(s) q where q.side = 'enemy' and combat_v2_up(s->'enemies'->(q.id::int));
  h := combat_v2_hit(a, t, jsonb_build_object('side', 'enemy', 'x', p_x, 'area', p_area, 'warden', w, 'clock', s->'clock', 'mode', s->'mode', 'foes_alive', foes,
                                              'ignore_shield', coalesce((o->>'ignore_shield')::boolean, false))
                           || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
  used := used || (h->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(h->'draws'));
  s := combat_v2_hit_apply(s, p_tgt, h, p_b)->'state';
  if (h->>'hit')::boolean then
    lost := (h->>'lost')::numeric;
    if coalesce(a->'mechanics' ? 'crush', false) and lost > 0 and combat_v2_up(s #> tpath) then
      r := combat_v2_damage(s, p_tgt, lost * (combat_v2_mech(p_b, a, 'crush')->>'x')::numeric,
                            jsonb_build_object('tick', true, 'ignore_shield', true, 'pierce', 1) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    if not p_area and combat_v2_up(s #> tpath) then
      foreach m in array array['frost_aura', 'venom', 'burning'] loop
        continue when not coalesce(a->'mechanics' ? m, false);
        st := case m when 'frost_aura' then 'chill' when 'venom' then 'poison' else 'burn' end;
        n := (combat_v2_mech(p_b, a, m)->>case m when 'frost_aura' then 'chill' when 'venom' then 'poison' else 'burn' end)::int;
        r := combat_v2_status_apply(s, p_tgt, st, jsonb_build_object('stacks', n, 'src', p_att) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end loop;
    end if;
    if p_area and coalesce(a->'mechanics' ? 'slowing', false) and combat_v2_up(s #> tpath) then
      r := combat_v2_status_apply(s, p_tgt, 'slowed', jsonb_build_object('src', p_att) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
  end if;
  return jsonb_build_object('state', s, 'dealt', h->'dmg', 'hit', h->'hit', 'draws', used);
end $fn$;

-- The card a counter move aims at (the simulator bossTarget; move.tgt): random (pickCard), lowest (the lowest HP share), support (a random support card),
-- weakest_support, strongest_attacker (the most power), empowered (the Empowered card with the most power), shielded / biggest_shield (the biggest shield),
-- frozen (the first Frozen card), last_support (the last support card that acted); when none fits, pickCard. The first in the fixed order on a tie.
-- {ref, draws}.
create or replace function public.combat_v2_boss_target(p_state jsonb, p_move jsonb, p_draws jsonb, p_b jsonb) returns jsonb language plpgsql volatile set search_path = public as $fn$
declare tg text := coalesce(p_move->>'tgt', 'random'); ids text[]; sup text[]; best text; id text; d numeric; clk int := (p_state->>'clock')::int; c jsonb; bc jsonb;
begin
  ids := array(select q.id from combat_v2_units(p_state) q where q.side = 'card' and combat_v2_up(p_state->'cards'->q.id) order by q.n);
  if cardinality(ids) = 0 then return jsonb_build_object('ref', null, 'draws', '[]'::jsonb); end if;
  sup := array(select x from unnest(ids) with ordinality u(x, o) where p_state->'cards'->x->>'class' = 'support' order by o);
  if tg = 'random' then return combat_v2_pick_card(p_state, p_draws, p_b);
  elsif tg = 'support' then
    if cardinality(sup) = 0 then return combat_v2_pick_card(p_state, p_draws, p_b); end if;
    d := combat_v2_draw(p_draws, 0);
    return jsonb_build_object('ref', jsonb_build_object('side', 'card', 'id', sup[floor(d * cardinality(sup))::int + 1]::numeric), 'draws', jsonb_build_array(d));
  end if;
  foreach id in array case when tg = 'weakest_support' then sup else ids end loop
    c := p_state->'cards'->id; bc := case when best is not null then p_state->'cards'->best end;
    if tg in ('lowest', 'weakest_support') then
      if best is null or (c->>'hp')::numeric / (c->>'max')::numeric < (bc->>'hp')::numeric / (bc->>'max')::numeric then best := id; end if;
    elsif tg = 'strongest_attacker' then
      if c->>'class' = 'attacker' and (best is null or (c->>'atk')::numeric > (bc->>'atk')::numeric) then best := id; end if;
    elsif tg = 'empowered' then
      if combat_v2_status_on(c, 'empowered', clk) is not null and (best is null or (c->>'atk')::numeric > (bc->>'atk')::numeric) then best := id; end if;
    elsif tg in ('shielded', 'biggest_shield') then
      if coalesce((combat_v2_status_on(c, 'shielded', clk)->>'value')::numeric, 0) > 0
         and (best is null or (combat_v2_status_on(c, 'shielded', clk)->>'value')::numeric > (combat_v2_status_on(bc, 'shielded', clk)->>'value')::numeric) then best := id; end if;
    elsif tg = 'frozen' then
      if best is null and combat_v2_status_on(c, 'frozen', clk) is not null then best := id; end if;
    elsif tg = 'last_support' then
      if p_state->'ext'->>'last_support' = id then best := id; end if;
    else raise exception 'combat_v2_boss_target: unknown target %', tg;
    end if;
  end loop;
  if best is null then return combat_v2_pick_card(p_state, p_draws, p_b); end if;
  return jsonb_build_object('ref', jsonb_build_object('side', 'card', 'id', best::numeric), 'draws', '[]'::jsonb);
end $fn$;

-- ONE counter move of a named Hunt boss (the simulator bossMove; the move as the unit holds it: the words of hunt_bosses_v2 with the numbers of
-- enemy_v2.bosses.<key>.moves.<id>). {state, draws}.
create or replace function public.combat_v2_boss_move(p_state jsonb, p_actor jsonb, p_move jsonb, p_draws jsonb, p_b jsonb) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  s jsonb := p_state; m jsonb := p_move; k text := p_move->>'k'; epath text[]; e jsonb; d jsonb := p_draws; used jsonb := '[]'::jsonb; r jsonb; w jsonb;
  t jsonb; tpath text[]; tu jsonb; x numeric; i int; lst text[]; pool text[]; id text; dv numeric; ref numeric := (p_b->'v2_enemy'->>'boss_heal_ref')::numeric;
  clk int := (p_state->>'clock')::int; bm jsonb := p_b->'v2_enemy'->'boss_moves'; o jsonb; n int; tgts jsonb := '[]'::jsonb; c jsonb; lost numeric; hs numeric;
begin
  epath := combat_v2_unit_path(s, p_actor); e := s #> epath;
  if k = 'hit' then
    w := combat_v2_confused_target(s, p_actor, d, p_b); used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
    if (w->>'wrong')::boolean then
      r := combat_v2_damage(s, w->'target', (e->>'atk')::numeric * (w->>'x')::numeric * combat_v2_enemy_mult(s, e, p_b), case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      return jsonb_build_object('state', r->'state', 'draws', used || (r->'draws'));
    end if;
    r := combat_v2_boss_target(s, m, d, p_b); used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    t := r->'ref';
    if t is null or jsonb_typeof(t) = 'null' then return jsonb_build_object('state', s, 'draws', used); end if;
    tpath := combat_v2_unit_path(s, t); tu := s #> tpath;
    x := (m->>'x')::numeric
         * case when m ? 'vs_shielded' and coalesce((combat_v2_status_on(tu, 'shielded', clk)->>'value')::numeric, 0) > 0 then (m->>'vs_shielded')::numeric else 1 end
         * case when m ? 'vs_frozen' and combat_v2_status_on(tu, 'frozen', clk) is not null then (m->>'vs_frozen')::numeric else 1 end;
    for i in 1 .. coalesce((m->>'n')::int, 1) loop
      exit when not combat_v2_up(s #> tpath);
      r := combat_v2_enemy_hit(s, p_actor, t, x, false, jsonb_build_object('ignore_shield', coalesce((m->>'ignore_shield')::boolean, false)), d, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end loop;
    if not combat_v2_up(s #> tpath) then
      if coalesce((m->>'enrage_on_kill')::boolean, false) then
        s := combat_v2_status_apply(s, p_actor, 'enraged', jsonb_build_object('value', (bm->>'enrage_x')::numeric, 'dur', (bm->>'enrage_dur')::int, 'src', p_actor), p_b)->'state';
      end if;
      return jsonb_build_object('state', s, 'draws', used);
    end if;
    if m ? 'apply' then
      r := combat_v2_status_apply(s, t, m->'apply'->>'status', ((m->'apply') - 'status') || jsonb_build_object('src', p_actor)
                                  || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    if m ? 'heal_cut' then
      tu := s #> tpath;
      s := jsonb_set(s, tpath, tu || jsonb_build_object('timed', coalesce(tu->'timed', '{}'::jsonb)
             || jsonb_build_object('heal_cut', jsonb_build_object('v', (m->'heal_cut'->>'x')::numeric, 'until', clk + (m->'heal_cut'->>'dur')::int))));
    end if;
    if coalesce((m->>'decay')::boolean, false) then
      hs := combat_v2_healed(s #> tpath, clk);
      if hs > 0 then
        r := combat_v2_damage(s, t, hs, jsonb_build_object('tick', true, 'ignore_shield', true, 'pierce', 1) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end if;
  elsif k = 'area' then
    lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
    foreach id in array lst loop
      c := s->'cards'->id;
      x := (m->>'x')::numeric * coalesce((m->'vs_role'->>(c->>'role'))::numeric, 1) * coalesce((m->'vs_cls'->>(c->>'class'))::numeric, 1)
           * case when m ? 'vs_last_debuffer' and e->>'last_debuffer' = id then (m->>'vs_last_debuffer')::numeric else 1 end;
      r := combat_v2_enemy_hit(s, p_actor, jsonb_build_object('side', 'card', 'id', id::numeric), x, true, '{}'::jsonb, d, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end loop;
  elsif k = 'apply' then
    -- the targets: all (every standing card), n (n random cards), else one card of combat_v2_boss_target
    if m->>'tgt' = 'all' then
      tgts := coalesce((select jsonb_agg(jsonb_build_object('side', 'card', 'id', q.id::numeric) order by q.n) from combat_v2_units(s) q
                         where q.side = 'card' and combat_v2_up(s->'cards'->q.id)), '[]'::jsonb);
    elsif m->>'tgt' = 'n' then
      pool := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
      for i in 1 .. (m->>'n')::int loop
        exit when cardinality(pool) = 0;
        dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
        n := floor(dv * cardinality(pool))::int + 1;
        tgts := tgts || jsonb_build_object('side', 'card', 'id', pool[n]::numeric);
        pool := pool[1:n - 1] || pool[n + 1:cardinality(pool)];
      end loop;
    else
      r := combat_v2_boss_target(s, m, d, p_b); used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      if r->'ref' is not null and jsonb_typeof(r->'ref') <> 'null' then tgts := jsonb_build_array(r->'ref'); end if;
    end if;
    o := jsonb_strip_nulls(jsonb_build_object('value', m->'value', 'stacks', m->'stacks', 'locked', m->'locked'));
    for t in select x2 from jsonb_array_elements(tgts) x2 loop
      r := combat_v2_status_apply(s, t, m->>'status', o || jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end loop;
  elsif k = 'guard' then
    s := combat_v2_status_apply(s, p_actor, 'guarded', jsonb_build_object('value', (m->>'v')::numeric * ref), p_b)->'state';
  elsif k = 'heal' then
    s := combat_v2_heal(s, p_actor, (m->>'v')::numeric * ref, p_b)->'state';
  elsif k = 'cleanse_self' then
    -- its listed harmful statuses (all of them without a list); each removed one counts for Cash Out
    for id in select y from jsonb_array_elements_text(coalesce(m->'statuses', (select jsonb_agg(x.key order by (x.value->>'ord')::int) from jsonb_each(p_b->'statuses') x
                                                                                  where (x.value->>'negative')::boolean))) y loop
      e := s #> epath;
      if coalesce(e->'status' ? id, false) then
        e := combat_v2_status_drop(e, id, 'enemy', s->>'mode' = 'hunt', clk, p_b);
        e := e || jsonb_build_object('cleared', coalesce((e->>'cleared')::int, 0) + 1);
        s := jsonb_set(s, epath, e);
      end if;
    end loop;
  elsif k = 'cash_out' then
    s := combat_v2_heal(s, p_actor, ref * least((m->>'max')::numeric, (m->>'per')::numeric * coalesce((e->>'cleared')::numeric, 0)), p_b)->'state';
    s := jsonb_set(s, epath || '{cleared}'::text[], '0'::jsonb);
  elsif k = 'enrage' then
    s := combat_v2_status_apply(s, p_actor, 'enraged', jsonb_build_object('value', (m->>'x')::numeric, 'dur', (m->>'dur')::int, 'src', p_actor), p_b)->'state';
  elsif k = 'spiral' then
    n := least((m->>'max')::int, coalesce((e->>'blocked')::int, 0));
    if n > 0 then
      s := combat_v2_status_apply(s, p_actor, 'enraged', jsonb_build_object('value', 1 + (m->>'per')::numeric * n, 'dur', (m->>'dur')::int, 'src', p_actor), p_b)->'state';
    end if;
  elsif k = 'evade' then
    s := jsonb_set(s, epath, e || jsonb_build_object('timed', coalesce(e->'timed', '{}'::jsonb) || jsonb_build_object('evade', jsonb_build_object('v', (m->>'v')::numeric, 'until', clk + (m->>'dur')::int))));
  elsif k = 'charge' then
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      c := s->'cards'->id;
      continue when (m ? 'role' and c->>'role' is distinct from m->>'role') or (m ? 'cls' and c->>'class' is distinct from m->>'cls');
      s := jsonb_set(s, array['cards', id, 'charge'], to_jsonb(greatest(0, coalesce((c->>'charge')::int, 0) - (m->>'n')::int)));
    end loop;
  elsif k = 'strip' then
    for id in select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n loop
      s := jsonb_set(s, array['cards', id, 'status'], coalesce(s->'cards'->id->'status', '{}'::jsonb) - (m->>'status'));
    end loop;
  elsif k = 'strip_shields' then
    lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
    foreach id in array lst loop
      lost := coalesce((combat_v2_status_on(s->'cards'->id, 'shielded', clk)->>'value')::numeric, 0);
      s := jsonb_set(s, array['cards', id, 'status'], coalesce(s->'cards'->id->'status', '{}'::jsonb) - 'shielded');
      if m ? 'crush' and lost > 0 then
        r := combat_v2_damage(s, jsonb_build_object('side', 'card', 'id', id::numeric), lost * (m->>'crush')::numeric,
                              jsonb_build_object('tick', true, 'ignore_shield', true, 'pierce', 1) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, p_b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    end loop;
  elsif k = 'skip' then
    pool := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
    for i in 1 .. (m->>'n')::int loop
      exit when cardinality(pool) = 0;
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      n := floor(dv * cardinality(pool))::int + 1; id := pool[n];
      s := jsonb_set(s, array['cards', id, 'banned'], to_jsonb(coalesce((s->'cards'->id->>'banned')::int, 0) + 1));
      pool := pool[1:n - 1] || pool[n + 1:cardinality(pool)];
    end loop;
  elsif k = 'extra_action' then
    s := jsonb_set(s, epath || '{meter}'::text[], to_jsonb((e->>'meter')::numeric + (p_b->'v2_speed'->>'act_at')::numeric));
  elsif k = 'brood' then
    s := jsonb_set(s, epath || '{brood}'::text[], to_jsonb(least((combat_v2_mech(p_b, e, 'brood')->>'max')::int, coalesce((e->>'brood')::int, 0) + (m->>'n')::int)));
  elsif k = 'state' then
    s := jsonb_set(s, epath, e || jsonb_build_object('timed', coalesce(e->'timed', '{}'::jsonb) || jsonb_build_object(m->>'key', jsonb_build_object('v', (m->>'v')::numeric, 'until', clk + (m->>'dur')::int))));
  elsif k = 'undo_smite' then
    if coalesce((e->>'last_smite')::numeric, 0) > 0 then
      s := combat_v2_heal(s, p_actor, (e->>'last_smite')::numeric, p_b)->'state';
      s := jsonb_set(s, epath || '{last_smite}'::text[], '0'::jsonb);
    end if;
  elsif k in ('desync_smite', 'mirror_smite') then
    s := jsonb_set(s, epath, e || jsonb_build_object('timed', coalesce(e->'timed', '{}'::jsonb) || jsonb_build_object(k, jsonb_build_object('v', 1, 'until', null))));
  elsif k = 'siphon' then
    if combat_v2_healed(s->'ext', clk) > 0 then s := combat_v2_heal(s, p_actor, combat_v2_healed(s->'ext', clk), p_b)->'state'; end if;
  else
    raise exception 'combat_v2_boss_move: unknown move kind %', k;
  end if;
  return jsonb_build_object('state', s, 'draws', used);
end $fn$;

-- ONE action of a standing enemy of a v2 state (plan 3.3, 8; the simulator enemyAct). The caller runs combat_v2_next first (the turn count, Purify, Elusive,
-- the skips). The Hunt boss (mode hunt): turn mod v2_enemy.boss_moves.cycle = cycle - 1: Charging; = 0: the Cataclysm (an area hit of cataclysm_x on every
-- card; Rollout: Weakened on every card); else a named boss uses a counter move with counter_share (a draw, then a draw for the move), else the move table
-- (one draw: strike, slam, drain, stun, enrage, curse, else regenerate; a single move of a Confused boss may hit an enemy). A Dungeon or Gauntlet foe: the
-- Cataclysm of a kind that charges (cataclysm, v2_dungeon.pool_moves.cycle), Bulwark (every bulwark.every-th turn a Guard), else its weighted moves (one
-- draw x the total weight; Confused draws for every move, a single move may hit an enemy). Answer {state, move, draws}.
create or replace function public.combat_v2_enemy_act(p_state jsonb, p_actor jsonb, p_opts jsonb default null, p_b jsonb default null) returns jsonb
language plpgsql volatile set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb); s jsonb := p_state; d jsonb := o->'draws'; used jsonb := '[]'::jsonb;
  epath text[]; e jsonb; boss boolean; bm jsonb; pm jsonb; vm jsonb; turn int; kk int; cyc int; lst text[]; id text; r jsonb; w jsonb; dv numeric; rr numeric; tot numeric;
  mv text; mvk jsonb; c jsonb; cref jsonb; single boolean; clk int; lim numeric; ref numeric;
begin
  perform combat_v2_status_check(p_state, b, 'combat_v2_enemy_act');
  if b->'enemy_v2' is null then raise exception 'combat_v2_enemy_act: no value for enemy_v2 (combat_v2_enemy_numbers)'; end if;
  if jsonb_typeof(o) <> 'object' then raise exception 'combat_v2_enemy_act: opts must be an object'; end if;
  if d is not null and jsonb_typeof(d) <> 'array' then raise exception 'combat_v2_enemy_act: opts.draws must be a list of numbers'; end if;
  if p_actor->>'side' is distinct from 'enemy' then raise exception 'combat_v2_enemy_act: the actor must be an enemy ({side: enemy, id})'; end if;
  epath := combat_v2_unit_path(s, p_actor); e := s #> epath;
  if not combat_v2_up(e) then raise exception 'combat_v2_enemy_act: enemy % is down', p_actor->>'id'; end if;
  boss := s->>'mode' = 'hunt'; bm := b->'v2_enemy'->'boss_moves'; pm := b->'v2_dungeon'->'pool_moves'; vm := b->'v2_dungeon'->'moves_v2';
  turn := coalesce((e->>'turn')::int, 0); clk := (s->>'clock')::int; ref := (b->'v2_enemy'->>'boss_heal_ref')::numeric;
  -- the Charging turn and the Cataclysm
  if boss or coalesce((e->>'cataclysm')::boolean, false) then
    cyc := case when boss then (bm->>'cycle')::int else (pm->>'cycle')::int end;
    kk := turn % cyc;
    if kk = cyc - 1 then
      return jsonb_build_object('state', jsonb_set(s, epath, e || jsonb_build_object('charging', true)), 'move', 'charging', 'draws', used);
    end if;
    if kk = 0 then
      s := jsonb_set(s, epath, e || jsonb_build_object('charging', false));
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
      foreach id in array lst loop
        r := combat_v2_enemy_hit(s, p_actor, jsonb_build_object('side', 'card', 'id', id::numeric), case when boss then (bm->>'cataclysm_x')::numeric else (pm->>'cataclysm_x')::numeric end,
                                 true, '{}'::jsonb, d, b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end loop;
      if boss and coalesce(e->'mechanics' ? 'rollout', false) then
        lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
        foreach id in array lst loop
          r := combat_v2_status_apply(s, jsonb_build_object('side', 'card', 'id', id::numeric), 'weakened',
                 jsonb_build_object('value', (combat_v2_mech(b, e, 'rollout')->>'weaken')::numeric, 'src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
          s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
        end loop;
      end if;
      return jsonb_build_object('state', s, 'move', 'cataclysm', 'draws', used);
    end if;
  end if;
  if boss then
    -- a counter move of a named boss
    if jsonb_typeof(e->'moves2') = 'array' and jsonb_array_length(e->'moves2') > 0 then
      dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
      if dv < coalesce((e->>'counter_share')::numeric, 0) then
        dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
        mvk := e->'moves2'->(floor(dv * jsonb_array_length(e->'moves2'))::int);
        r := combat_v2_boss_move(s, p_actor, mvk, d, b);
        return jsonb_build_object('state', r->'state', 'move', mvk->>'id', 'draws', used || (r->'draws'));
      end if;
    end if;
    rr := combat_v2_draw(d, 0); used := used || to_jsonb(rr); d := combat_v2_draws_rest(d, 1);
    single := rr < (bm->>'strike')::numeric + (bm->>'slam')::numeric + (bm->>'drain')::numeric + (bm->>'stun')::numeric
              and not (rr >= (bm->>'strike')::numeric and rr < (bm->>'strike')::numeric + (bm->>'slam')::numeric);
    if single then
      w := combat_v2_confused_target(s, p_actor, d, b); used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
      if (w->>'wrong')::boolean then
        r := combat_v2_damage(s, w->'target', (e->>'atk')::numeric * (w->>'x')::numeric * combat_v2_enemy_mult(s, e, b), case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
        return jsonb_build_object('state', r->'state', 'move', 'confused', 'draws', used || (r->'draws'));
      end if;
    end if;
    lim := 0;
    foreach mv in array array['strike', 'slam', 'drain', 'stun', 'enrage', 'curse'] loop
      lim := lim + (bm->>mv)::numeric;
      exit when rr < lim;
      mv := null;
    end loop;
    mv := coalesce(mv, 'regenerate');
    if mv in ('strike', 'drain', 'stun', 'curse') then
      r := combat_v2_pick_card(s, d, b); used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws')); cref := r->'ref';
    end if;
    if mv in ('strike', 'drain', 'stun') then
      r := combat_v2_enemy_hit(s, p_actor, cref, (bm->>(mv || '_x'))::numeric, false, '{}'::jsonb, d, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      if mv = 'drain' then s := combat_v2_heal(s, p_actor, ref * (bm->>'drain_heal')::numeric, b)->'state'; end if;
      if mv = 'stun' and combat_v2_up(s #> combat_v2_unit_path(s, cref)) then
        r := combat_v2_status_apply(s, cref, 'stunned', jsonb_build_object('src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end if;
    elsif mv = 'slam' then
      lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
      foreach id in array lst loop
        r := combat_v2_enemy_hit(s, p_actor, jsonb_build_object('side', 'card', 'id', id::numeric), (bm->>'slam_x')::numeric, true, '{}'::jsonb, d, b);
        s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      end loop;
    elsif mv = 'enrage' then
      s := combat_v2_status_apply(s, p_actor, 'enraged', jsonb_build_object('value', (bm->>'enrage_x')::numeric, 'dur', (bm->>'enrage_dur')::int, 'src', p_actor), b)->'state';
    elsif mv = 'curse' then
      r := combat_v2_status_apply(s, cref, 'weakened', jsonb_build_object('value', (bm->>'curse_weaken')::numeric, 'src', p_actor) || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    else
      s := combat_v2_heal(s, p_actor, ref * case when (e->>'hp')::numeric / (e->>'max')::numeric < (bm->>'rage_at')::numeric
                                                 then (bm->>'regenerate_heal_rage')::numeric else (bm->>'regenerate_heal')::numeric end, b)->'state';
    end if;
    return jsonb_build_object('state', s, 'move', mv, 'draws', used);
  end if;
  -- a Dungeon or Gauntlet foe: Bulwark, then its weighted moves
  if coalesce(e->'mechanics' ? 'bulwark', false) and turn % (combat_v2_mech(b, e, 'bulwark')->>'every')::int = 0 then
    s := combat_v2_status_apply(s, p_actor, 'guarded', jsonb_build_object('value', (e->>'max')::numeric * (combat_v2_mech(b, e, 'bulwark')->>'guard')::numeric), b)->'state';
    return jsonb_build_object('state', s, 'move', 'bulwark', 'draws', used);
  end if;
  if jsonb_typeof(e->'moves') is distinct from 'array' or jsonb_array_length(e->'moves') = 0 then raise exception 'combat_v2_enemy_act: foe % has no moves', p_actor->>'id'; end if;
  select sum((x->>'w')::numeric) into tot from jsonb_array_elements(e->'moves') x;
  dv := combat_v2_draw(d, 0); used := used || to_jsonb(dv); d := combat_v2_draws_rest(d, 1);
  rr := dv * tot; mv := e->'moves'->0->>'k';
  for mvk in select x from jsonb_array_elements(e->'moves') x loop
    rr := rr - (mvk->>'w')::numeric;
    if rr < 0 then mv := mvk->>'k'; exit; end if;
  end loop;
  w := combat_v2_confused_target(s, p_actor, d, b); used := used || (w->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(w->'draws'));
  if (w->>'wrong')::boolean and mv in ('strike', 'heavy', 'flurry', 'drain', 'stun', 'poison', 'hellfire', 'frost_punch', 'squeeze', 'infect') then
    r := combat_v2_damage(s, w->'target', (e->>'atk')::numeric * (w->>'x')::numeric * combat_v2_enemy_mult(s, e, b), case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
    return jsonb_build_object('state', r->'state', 'move', 'confused', 'draws', used || (r->'draws'));
  end if;
  if mv in ('strike', 'heavy', 'flurry', 'drain', 'stun', 'poison', 'curse', 'hellfire', 'frost_punch', 'squeeze', 'rattle', 'infect') then
    r := combat_v2_pick_card(s, d, b); used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws')); cref := r->'ref';
  end if;
  if mv in ('strike', 'heavy', 'flurry', 'drain', 'stun', 'poison', 'hellfire', 'frost_punch', 'squeeze', 'infect') then
    r := combat_v2_enemy_hit(s, p_actor, cref, case mv when 'strike' then 1 when 'heavy' then (pm->>'heavy_x')::numeric when 'flurry' then (pm->>'flurry_x')::numeric
                                                     when 'drain' then (pm->>'drain_x')::numeric when 'stun' then (pm->>'stun_x')::numeric when 'poison' then (pm->>'poison_x')::numeric
                                                     else (vm->mv->>'x')::numeric end, false, '{}'::jsonb, d, b);
    s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    -- a Flurry is two hits on the same card
    if mv = 'flurry' then
      r := combat_v2_enemy_hit(s, p_actor, cref, (pm->>'flurry_x')::numeric, false, '{}'::jsonb, d, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
    if mv = 'drain' then s := combat_v2_heal(s, p_actor, (e->>'max')::numeric * (pm->>'drain_heal')::numeric, b)->'state'; end if;
    if mv in ('stun', 'poison', 'hellfire', 'frost_punch', 'squeeze', 'infect') and combat_v2_up(s #> combat_v2_unit_path(s, cref)) then
      r := combat_v2_status_apply(s, cref, case mv when 'stun' then 'stunned' when 'poison' then 'poison' when 'hellfire' then 'burn' when 'frost_punch' then 'chill'
                                                  when 'squeeze' then vm->'squeeze'->>'status' else 'poison' end,
             jsonb_strip_nulls(jsonb_build_object('stacks', case mv when 'hellfire' then vm->'hellfire'->'burn' when 'frost_punch' then vm->'frost_punch'->'chill'
                                                                    when 'infect' then vm->'infect'->'poison' end, 'src', p_actor))
             || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
      if mv = 'infect' then
        c := s #> combat_v2_unit_path(s, cref);
        s := jsonb_set(s, combat_v2_unit_path(s, cref), c || jsonb_build_object('timed', coalesce(c->'timed', '{}'::jsonb)
               || jsonb_build_object('heal_cut', jsonb_build_object('v', 0, 'until', clk + (vm->'infect'->>'no_heal')::int))));
      end if;
    end if;
  elsif mv = 'slam' then
    lst := array(select q.id from combat_v2_units(s) q where q.side = 'card' and combat_v2_up(s->'cards'->q.id) order by q.n);
    foreach id in array lst loop
      r := combat_v2_enemy_hit(s, p_actor, jsonb_build_object('side', 'card', 'id', id::numeric), (pm->>'slam_x')::numeric, true, '{}'::jsonb, d, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end loop;
  elsif mv = 'regenerate' then
    s := combat_v2_heal(s, p_actor, (e->>'max')::numeric * case when (e->>'hp')::numeric / (e->>'max')::numeric < (bm->>'rage_at')::numeric
                                                                 then (pm->>'regenerate_heal_rage')::numeric else (pm->>'regenerate_heal')::numeric end, b)->'state';
  elsif mv = 'guard' then
    s := combat_v2_status_apply(s, p_actor, 'guarded', jsonb_build_object('value', (e->>'max')::numeric * (pm->>'guard')::numeric), b)->'state';
  elsif mv = 'enrage' then
    s := combat_v2_status_apply(s, p_actor, 'enraged', jsonb_build_object('src', p_actor), b)->'state';
  elsif mv in ('curse', 'rattle') then
    if cref is not null and jsonb_typeof(cref) <> 'null' then
      r := combat_v2_status_apply(s, cref, case when mv = 'curse' then 'weakened' else 'exposed' end,
             jsonb_build_object('value', case when mv = 'curse' then (pm->>'curse_weaken')::numeric else (vm->'rattle'->>'exposed')::numeric end, 'src', p_actor)
             || case when d is null then '{}'::jsonb else jsonb_build_object('draws', d) end, b);
      s := r->'state'; used := used || (r->'draws'); d := combat_v2_draws_rest(d, jsonb_array_length(r->'draws'));
    end if;
  elsif mv = 'idle' then
    null;
  else
    raise exception 'combat_v2_enemy_act: unknown move %', mv;
  end if;
  return jsonb_build_object('state', s, 'move', mv, 'draws', used);
end $fn$;

-- ============================================================ 9. the builders and the Hunt boss template
-- The Hunt boss of a tier as a unit of a v2 state (the simulator makeBoss and Battle.unit). p_key = a key of hunt_bosses_v2 (its sig, + mythic at Mythic,
-- resists, + mythic_resists at Mythic, params, counter moves, counter_share, hp_factor), or NULL = the tier boss with opts.sigs (a list of mechanics).
-- HP = v2_enemy.hunt.<tier>.hp x asc3_hp_x x hp_factor (Nathan 2026-10-19), hp = HP x opts.start_frac (default all of it); atk = atk x atk_x; def, evasion,
-- resolve, keen and speed of the tier; Plated (def at least plated.def), Fade (+ evasion_add), Brood (start stacks); opts.weak_role = the "Weak to: role"
-- week; healer = Regrowth. PURE (reads the numbers and the rows).
create or replace function public.combat_v2_hunt_boss(p_tier text, p_key text, p_opts jsonb default null, p_b jsonb default null) returns jsonb
language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); o jsonb := coalesce(p_opts, '{}'::jsonb); t jsonb := b->'v2_enemy'->'hunt'->p_tier;
  rw public.hunt_bosses_v2; nb jsonb; mech jsonb; res jsonb := '[]'::jsonb; moves jsonb := '[]'::jsonb; m jsonb; mn jsonb; hp numeric; u jsonb;
begin
  if t is null then raise exception 'combat_v2_hunt_boss: unknown tier % (v2_enemy.hunt)', p_tier; end if;
  if p_key is not null then
    select * into rw from public.hunt_bosses_v2 x where x.key = p_key;
    if not found then raise exception 'combat_v2_hunt_boss: unknown boss % (hunt_bosses_v2)', p_key; end if;
    nb := b->'enemy_v2'->'bosses'->p_key;
    mech := to_jsonb(rw.sig || case when p_tier = 'Mythic' then rw.mythic else '{}'::text[] end);
    res := to_jsonb(rw.resists || case when p_tier = 'Mythic' then rw.mythic_resists else '{}'::text[] end);
    for m in select x from jsonb_array_elements(rw.moves) x loop
      mn := coalesce(nb->'moves'->(m->>'id'), '{}'::jsonb);
      moves := moves || jsonb_build_array(m || (mn - 'apply') || case when m ? 'apply' or mn ? 'apply' then jsonb_build_object('apply', coalesce(m->'apply', '{}'::jsonb) || coalesce(mn->'apply', '{}'::jsonb)) else '{}'::jsonb end);
    end loop;
  else
    mech := coalesce(o->'sigs', '[]'::jsonb);
  end if;
  hp := (t->>'hp')::numeric * (b->'v2_enemy'->>'asc3_hp_x')::numeric * coalesce((nb->>'hp_factor')::numeric, 1);
  u := jsonb_build_object('hp', hp * coalesce((o->>'start_frac')::numeric, 1), 'max', hp, 'down', false, 'atk', (t->>'atk')::numeric * (t->>'atk_x')::numeric,
         'def', (t->>'def')::numeric, 'evasion', (t->>'evasion')::numeric, 'resolve', (t->>'resolve')::numeric, 'keen', (t->>'keen')::numeric,
         'speed', (t->>'speed')::numeric, 'meter', coalesce((o->>'meter')::numeric, 0), 'charge', 0, 'status', '{}'::jsonb, 'turn', 0,
         'mechanics', mech, 'resists', res, 'params', coalesce(nb->'params', '{}'::jsonb), 'healer', mech ? 'regrowth')
       || case when p_key is not null then jsonb_build_object('boss', p_key, 'moves2', moves, 'counter_share', (nb->>'counter_share')::numeric) else '{}'::jsonb end
       || case when o->>'weak_role' is not null then jsonb_build_object('weak_role', o->>'weak_role') else '{}'::jsonb end;
  if mech ? 'plated' then u := u || jsonb_build_object('def', greatest((u->>'def')::numeric, (combat_v2_mech(b, u, 'plated')->>'def')::numeric)); end if;
  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;
  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;
  return u;
end $fn$;

-- A Dungeon or Gauntlet foe as a unit of a v2 state (the simulator makeFoe): monster = a key of dungeon_monsters_v2, kind = a room kind of
-- v2_dungeon.kinds. HP = hp x growth.hp ^ (floor - 1) x (1 + growth.room x (room - 1)) x kinds.<kind>.hp x hp_x; atk = atk x growth.atk ^ (floor - 1) x
-- kinds.<kind>.atk x atk_x (at least 1); floors up to early_floors x early_hp / early_atk. Mechanics = its own passive (at passive_kinds, else
-- monster_passives.kinds) + p_mechs (the passives that the caller drew from the pool) + its aura (at monster_passives.<aura>.kinds). def, speed, cataclysm
-- (the kind charges) of the kind, resolve = foe_resolve.<kind>, evasion = min(foe_evasion_max, foe_evasion_per_floor x (floor - 1)); Plated, Fade, Brood;
-- healer = Regrowth or a regenerate or drain move. PURE.
create or replace function public.combat_v2_dungeon_foe(p_monster text, p_floor int, p_room int, p_kind text, p_mechs jsonb default null, p_b jsonb default null)
returns jsonb language plpgsql stable set search_path = public as $fn$
declare
  b jsonb := coalesce(p_b, combat_v2_enemy_numbers()); dd jsonb := b->'v2_dungeon'; g jsonb := b->'v2_dungeon'->'growth'; k jsonb := b->'v2_dungeon'->'kinds'->p_kind;
  rw public.dungeon_monsters_v2; hp numeric; atk numeric; mech jsonb := '[]'::jsonb; u jsonb; m text;
begin
  if k is null then raise exception 'combat_v2_dungeon_foe: unknown room kind % (v2_dungeon.kinds)', p_kind; end if;
  if p_floor is null or p_floor < 1 or p_room is null or p_room < 1 then raise exception 'combat_v2_dungeon_foe: floor and room start at 1'; end if;
  select * into rw from public.dungeon_monsters_v2 x where x.key = p_monster;
  if not found then raise exception 'combat_v2_dungeon_foe: unknown monster % (dungeon_monsters_v2)', p_monster; end if;
  hp := rw.hp * power((g->>'hp')::numeric, p_floor - 1) * (1 + (g->>'room')::numeric * (p_room - 1)) * (k->>'hp')::numeric * (dd->>'hp_x')::numeric;
  atk := rw.atk * power((g->>'atk')::numeric, p_floor - 1) * (k->>'atk')::numeric * (dd->>'atk_x')::numeric;
  if p_floor <= (g->>'early_floors')::int then hp := hp * (g->>'early_hp')::numeric; atk := atk * (g->>'early_atk')::numeric; end if;
  if rw.passive is not null and p_kind = any(coalesce(rw.passive_kinds, array(select jsonb_array_elements_text(dd->'monster_passives'->'kinds')))) then
    mech := mech || to_jsonb(rw.passive);
  end if;
  for m in select jsonb_array_elements_text(coalesce(p_mechs, '[]'::jsonb)) loop
    perform combat_v2_mech(b, null, m);
    if not mech ? m then mech := mech || to_jsonb(m); end if;
  end loop;
  if rw.aura is not null and coalesce(dd->'monster_passives'->rw.aura->'kinds' ? p_kind, false) then mech := mech || to_jsonb(rw.aura); end if;
  u := jsonb_build_object('hp', hp, 'max', hp, 'down', false, 'atk', greatest(1, atk), 'def', (k->>'def')::numeric,
         'evasion', least((dd->>'foe_evasion_max')::numeric, (dd->>'foe_evasion_per_floor')::numeric * (p_floor - 1)),
         'resolve', coalesce((dd->'foe_resolve'->>p_kind)::numeric, 0), 'keen', 0, 'speed', (k->>'speed')::numeric, 'meter', 0, 'charge', 0, 'status', '{}'::jsonb,
         'turn', 0, 'mechanics', mech, 'moves', (select jsonb_agg(jsonb_build_object('k', x->>'k', 'w', (x->>'w')::numeric)) from jsonb_array_elements(rw.moves) x),
         'cataclysm', (k->>'charge')::boolean, 'monster', p_monster,
         'healer', mech ? 'regrowth' or exists (select 1 from jsonb_array_elements(rw.moves) x where x->>'k' in ('regenerate', 'drain')));
  if mech ? 'plated' then u := u || jsonb_build_object('def', greatest((u->>'def')::numeric, (combat_v2_mech(b, u, 'plated')->>'def')::numeric)); end if;
  if mech ? 'fade' then u := u || jsonb_build_object('evasion', (u->>'evasion')::numeric + (combat_v2_mech(b, u, 'fade')->>'evasion_add')::numeric); end if;
  if mech ? 'brood' then u := u || jsonb_build_object('brood', (combat_v2_mech(b, u, 'brood')->>'start')::int); end if;
  return u;
end $fn$;

-- THE HUNT BOSS TEMPLATE (plan 8.4): the three lines of the boss card. weak_to = the "Weak to" rule tags (hunt_bosses_v2.weak_to: Nathan's choice);
-- resists = the immune statuses with their labels (+ the Mythic resists); signature = each signature mechanic (+ the Mythic rules) with its label, text
-- and numbers (enemy_mechanics: the UI fills each {leaf} from the balance object numbers with the boss's own params over it); counters = the archetypes
-- that the signature counters; bring = the archetypes that it favors (the "Bring" chip). Reads only.
create or replace function public.hunt_boss_v2_card(p_key text, p_tier text) returns jsonb language plpgsql stable set search_path = public as $fn$
declare rw public.hunt_bosses_v2; mechs text[]; nb jsonb;
begin
  select * into rw from public.hunt_bosses_v2 x where x.key = p_key;
  if not found then raise exception 'hunt_boss_v2_card: unknown boss %', p_key; end if;
  if p_tier is null or p_tier not in ('Normal', 'Heroic', 'Mythic') then raise exception 'hunt_boss_v2_card: the tier is Normal, Heroic or Mythic (%)', p_tier; end if;
  mechs := rw.sig || case when p_tier = 'Mythic' then rw.mythic else '{}'::text[] end;
  nb := balance_path('enemy_v2.bosses.' || p_key);
  return jsonb_build_object('key', rw.key, 'name', rw.name, 'tier', p_tier,
    'weak_to', to_jsonb(rw.weak_to),
    'resists', coalesce((select jsonb_agg(jsonb_build_object('status', s.key, 'label', s.label) order by s.ord) from public.statuses s
                          where s.key = any(rw.resists || case when p_tier = 'Mythic' then rw.mythic_resists else '{}'::text[] end)), '[]'::jsonb),
    'signature', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'label', m.label, 'text', m.text,
                                     'numbers', coalesce(balance_path(m.numbers), '{}'::jsonb) || coalesce(nb->'params'->m.key, '{}'::jsonb), 'mythic', not m.key = any(rw.sig))
                                   order by array_position(mechs, m.key)) from public.enemy_mechanics m where m.key = any(mechs)), '[]'::jsonb),
    'counters', coalesce((select jsonb_agg(distinct c) from public.enemy_mechanics m, unnest(m.counters) c where m.key = any(mechs)), '[]'::jsonb),
    'bring', coalesce((select jsonb_agg(distinct f) from public.enemy_mechanics m, unnest(m.favors) f where m.key = any(mechs)), '[]'::jsonb));
end $fn$;

-- ============================================================ 10. server only, and the comments of the generated docs
do $g$
declare f text;
begin
  foreach f in array array['enemy_v2_spec()', 'balance_check_enemy_v2()', 'enemy_mechanics_check()', 'dungeon_monsters_v2_check()', 'hunt_bosses_v2_check()',
      'combat_v2_enemy_numbers()', 'combat_v2_mech(jsonb, jsonb, text)', 'combat_v2_timed(jsonb, text, integer)', 'combat_v2_timed_any(jsonb, text)',
      'combat_v2_standing_rule(jsonb, text, jsonb)', 'combat_v2_neg_kinds(jsonb, integer, jsonb)', 'combat_v2_healed(jsonb, integer)',
      'fight_state_check_v2(jsonb)', 'combat_v2_advance(jsonb, jsonb)', 'combat_v2_hit(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_blocked(jsonb, jsonb, text, jsonb, jsonb)',
      'combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb)', 'combat_v2_status_cure(jsonb, jsonb, jsonb, integer, jsonb)', 'combat_v2_drop(jsonb, jsonb, jsonb)',
      'combat_v2_volatile(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_damage(jsonb, jsonb, numeric, jsonb, jsonb)', 'combat_v2_hit_apply(jsonb, jsonb, jsonb, jsonb)',
      'combat_v2_heal(jsonb, jsonb, numeric, jsonb)', 'combat_v2_step_end(jsonb, jsonb, jsonb)', 'combat_v2_step_end(jsonb, jsonb)',
      'combat_v2_turn_start(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_next(jsonb, jsonb, jsonb)', 'combat_effect_v2_gate(jsonb, jsonb, jsonb, jsonb)',
      'combat_effect_v2_hit(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', 'combat_effect_v2_basic(jsonb, jsonb, jsonb, jsonb, jsonb)',
      'combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)', 'combat_v2_card_act(jsonb, jsonb, jsonb, jsonb)',
      'combat_v2_pick_card(jsonb, jsonb, jsonb)', 'combat_v2_enemy_mult(jsonb, jsonb, jsonb)', 'combat_v2_enemy_hit(jsonb, jsonb, jsonb, numeric, boolean, jsonb, jsonb, jsonb)',
      'combat_v2_boss_target(jsonb, jsonb, jsonb, jsonb)', 'combat_v2_boss_move(jsonb, jsonb, jsonb, jsonb, jsonb)', 'combat_v2_enemy_act(jsonb, jsonb, jsonb, jsonb)',
      'combat_v2_hunt_boss(text, text, jsonb, jsonb)', 'combat_v2_dungeon_foe(text, integer, integer, text, jsonb, jsonb)', 'hunt_boss_v2_card(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $g$;
revoke all on table public.enemy_mechanics, public.dungeon_monsters_v2, public.hunt_bosses_v2 from public, anon, authenticated;
grant select, insert, update, delete on table public.enemy_mechanics, public.dungeon_monsters_v2, public.hunt_bosses_v2 to service_role;

comment on function public.enemy_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key enemy_v2 (rules: the numbers of the boss rules; bosses.<key>: hp_factor, counter_share, params, moves.<id>). combat_v2_monsters.sql.$cm$;
comment on function public.balance_check_enemy_v2() is $cm$Trigger (before insert, update on balance): the key enemy_v2 must match its fixed shape and limits (enemy_v2_spec, walked by balance_shape_errors) and rules.brood.start must not be above rules.brood.max. Every other key passes. combat_v2_monsters.sql.$cm$;
comment on function public.enemy_mechanics_check() is $cm$Trigger (before insert, update on enemy_mechanics): numbers is a balance object, the text names only its {leaf} numbers and has no digit (balance_text_errors), and no foe, debuff, negative, you, semicolon or parenthesis (the card text style). combat_v2_monsters.sql.$cm$;
comment on function public.dungeon_monsters_v2_check() is $cm$Trigger (before insert, update on dungeon_monsters_v2): every move is a known foe move with a whole weight above 0, and a move text names only the {leaf} numbers of v2_dungeon.moves_v2.<k>. combat_v2_monsters.sql.$cm$;
comment on function public.hunt_bosses_v2_check() is $cm$Trigger (before insert, update on hunt_bosses_v2): sig and mythic are boss mechanics of enemy_mechanics, resists are harmful enemy statuses, weak_to are rule tags, every move has a new id, a known kind, no number (numbers go in balance) and its numbers in balance enemy_v2.bosses.<key>.moves (the same moves). combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_enemy_numbers() is $cm$[combat] Combat v2: the numbers of an enemy action in one read: combat_v2_action_numbers and balance enemy_v2. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_mech(jsonb, jsonb, text) is $cm$[combat] Combat v2: the numbers of an enemy mechanic (v2_enemy.mechanics, else v2_dungeon.passive_params, else enemy_v2.rules) with the unit's own params over them (the simulator mechParams); an unknown mechanic raises. PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_timed(jsonb, text, integer) is $cm$[combat] Combat v2: the value of a timed enemy state of a unit (timed.<key> = {v, until}) while until is NULL or above the clock, else NULL (the simulator ext). PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_timed_any(jsonb, text) is $cm$[combat] Combat v2: {id, v} of the first standing enemy with an active timed state (the simulator extAny), else NULL. PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_standing_rule(jsonb, text, jsonb) is $cm$[combat] Combat v2: the numbers of a rule of the first standing enemy that has it (Bloodrot, Brittle; the simulator standing), else NULL. PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_neg_kinds(jsonb, integer, jsonb) is $cm$[combat] Combat v2: the number of different harmful statuses on a unit (the simulator negKinds; Steadfast). PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_healed(jsonb, integer) is $cm$[combat] Combat v2: the HP healed in the step of the clock (healed = {step, v} of the state ext: all cards; of a card: that card; Siphon and Decay). PURE. combat_v2_monsters.sql.$cm$;
comment on function public.fight_state_check_v2(jsonb) is $cm$[combat] The shape check of a fight state v = 2 (plan 9.1): the v1 rules plus clock, and meter, charge and status{} on each card and enemy (known statuses of that side with stacks, value, until and locked; Focused also crd; Stunned and Frozen also extra); the v1 status keys are refused. Answer: the list of problems (empty = fine). combat_v2_statuses_roles.sql, crd: combat_v2_abilities.sql, locked and extra: combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_advance(jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.1): runs the clock of a fight state v 2 to the next actor (meters fill by combat_v2_speed each step, highest meter first, at most max_actions_per_step actions a unit a step, the step cap of the mode); while a standing enemy has Time Lock, Quickened does nothing on cards (combat_v2_monsters.sql). Answer {state, event act|cap|none, actor, steps}. combat_v2_turn_meter.sql.$cm$;
comment on function public.combat_v2_hit(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 hit core (plan 2.2, 4, 6, 8): one hit of a card on an enemy (miss = base + evasion + timed evade + Blinded - acc unless true strike or Marked; roll; crit unless Ironhide and not Marked; Empowered x Dispeller x timed emp_x, Weakened, Chill, Exposed, Mark, Finisher, Cleaver, the Weak-to week, vs_x; Breaker; Mirror Hide on ctx.kind extra, splash, area) or of an enemy on a card (Blinded; Dodge; Swarm; roll; Enraged, boss rage, Weakened, Chill, Pack, Exposed; Sunder, Shatter; ignore_shield). Damage = raw x (1 - def x (1 - pierce)), Warden, Steadfast, Brood, min_dmg, then the shield. The mechanic numbers with the unit's own params (combat_v2_mech). Draw slots card: [miss], roll, [crit]; enemy: [Blinded], [dodge], roll. Answer {hit, miss, dodged, crit, dmg, absorbed, lost, shield_after, hp_after, down, heal, brood_after, mirrored, draws, ...}. Writes nothing. combat_v2_hit.sql, Focused crd: combat_v2_abilities.sql, the enemy mechanics: combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_blocked(jsonb, jsonb, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8): an enemy blocked a harmful status from a card: blocked + 1 (Rage Spiral), Tilt (Enraged), Rubberband (a blocked control: it acts again, once a step). The simulator Battle.blocked. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_status_apply(jsonb, jsonb, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 6, 8): puts one status on one unit of a fight state v 2: down, Permafrost Heart, resists and mechanic immunity, the cure immunity of a card, resolve, Unstoppable, Desync, the ONE control immunity (a block runs combat_v2_blocked), the Hunt boss limit and the Controller week (control_add), then the stacking rule (Poison and the Toxic burst, Burn, Chill to Frozen, Exposed with Thick Hide and Dispeller, Weakened, Mark, Empowered, Quickened value, Focused crd, shields with Brittle and Calcify on cards), locked, last_debuffer. Draw slots [resolve], [unstoppable], then the end state, the burst (Volatile Core). Answer {state, applied, reason, frozen, burst, draws}. VOLATILE. combat_v2_status_rules.sql, combat_v2_abilities.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_status_cure(jsonb, jsonb, jsonb, integer, jsonb) is $cm$[combat] Combat v2: the cure of ONE unit (the Medic rule, Nathan 2026-10-18): removes the listed negative statuses that are not locked (NULL: all) and, with immune above 0, makes the unit immune to them for immune steps (immune.<status>). Purify and cleanse: immune 0. Answer {state, cured, removed}. combat_v2_status_rules.sql, locked: combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_drop(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.2): a unit at 0 HP: Undying (once, not while Burning or Poisoned) comes back with undying.hp x its max HP, else it falls; volatile = Volatile Core and not Stunned or Frozen (the simulator fall). Answer {state, down, volatile, revived}. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_volatile(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.3): Volatile Core: the fallen enemy hits every standing card (an area hit of volatile_core.x). Answer {state, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_damage(jsonb, jsonb, numeric, jsonb, jsonb) is $cm$[combat] Combat v2: damage that is not a hit (ticks, the Toxic burst, a Confused self hit, Crush, Decay) on one unit: x (1 - def x (1 - pierce)), the Warden on a card, Steadfast, Brood (a Burn tick removes one), min_dmg unless a tick, the shield first unless ignore_shield, then HP; damage that is not a tick wakes Sleep; at 0 HP combat_v2_drop (Undying) and Volatile Core with opts.draws. Answer {state, dmg, absorbed, hp_loss, down, woke, revived, draws}. VOLATILE. combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_hit_apply(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: writes an answer of combat_v2_hit on its target (hp_after, shield_after, brood_after, down: combat_v2_drop with Undying); a hit with damage wakes Sleep. Answer {state, woke, down, volatile (the caller makes the Volatile Core hits)}. combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_heal(jsonb, jsonb, numeric, jsonb) is $cm$[combat] Combat v2: heals one unit up to its max; a Burning unit heals x burn.heal_x; a card heal x Bloodrot x its timed heal_cut; a card heal counts for the step (ext.healed, the card's healed) and heal_mirror heals an enemy. Answer {state, healed}. combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_step_end(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.1, 6, 8): the step-end tick of the clock step, once (ext.step_end): each standing unit in the fixed order: Poison (then Plaguebearer: one pick draw), Burn (x vs_healer_x vs a healer; Brood) then decay, Regrowth, Siphon, then every status with until not above the clock ends. Draws from p_draws (Plaguebearer, its Poison, Volatile Core), else random(). Answer {state, ticks, ended, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_step_end(jsonb, jsonb) is $cm$[combat] Combat v2: the step-end tick (combat_v2_step_end with draws from random()). combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_turn_start(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the start of an action: an enemy counts its turn, Purify (every purify.every-th turn), Elusive; Stunned or Frozen skip it (extra: the Controller week skips again) and end (the control immunity starts), Sleep skips it, Paralyzed skips it on a draw below paralyzed.fail; a skipped enemy turn ends Charging (the Cataclysm cancel); a banned card skips. Answer {state, skip, reason, draws}. VOLATILE. combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_next(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.1): runs the clock of a fight state v 2 to the next action with the step-end tick (combat_v2_step_end, its draws first) between the steps, one step at a time (combat_v2_advance), up to the step cap of the mode, then the turn start of the actor (combat_v2_turn_start); end when one side has no standing unit. Answer {state, event act|cap|none|end, actor, steps, skip, reason, ticks, ended, draws}. VOLATILE. No v1 function calls it. combat_v2_status_rules.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_effect_v2_gate(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (T1): a gate attachment holds now: self_has, self_shield, enemy_charging (the target is Charging: charging; combat_v2_monsters.sql), foes_alive (more than one enemy stands). PURE. combat_v2_ability_builder.sql.$cm$;
comment on function public.combat_effect_v2_hit(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: one card hit of a v2 state: combat_v2_hit (with the clock, the mode and the standing enemies) written by combat_v2_hit_apply, Volatile Core (its draws added to hit.draws), then the Survivor heal. Answer {state, hit}. VOLATILE. combat_v2_abilities.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_effect_v2_basic(jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the basic attack (the simulator doBasic): Confused, the hit, the Flurry second strike (kind extra; its draw after the hit), the Cleaver splash (kind splash), the support basic (Artillery, Rollback on it, the Spotter Expose, the Herald Empower of the strongest attacker); then Empowered and the Mark of the target end. Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_effect_v2_active(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the unique active (the simulator doActive). An attacker: Confused, the shape of its hits (Mirror Hide on strikes), each hit then its riders, on_crit and on_kill, the area hits (kind area; the payoffs of that enemy), lifesteal, guard_up, then Empowered and the Mark end. A support: its blocks in order (a cure with Rot), the smite last (Rollback, Desync, Mirror, last_smite; area: every other enemy, kind area). Answer {state, hits, draws}. VOLATILE. combat_v2_abilities.sql, combat_v2_ability_builder.sql, combat_v2_ability_prices.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_card_act(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 2.1, 3.2): ONE action of a standing card of a v2 state: the active (opts.use, charged after v2_charge.<class> own turns) or the basic attack, on opts.target (an enemy) and opts.ally; then the charge, the Medic passive and last_support. Draws from opts.draws in a fixed order (else random()). Answer {state, action, hits, draws}. VOLATILE. No v1 function calls it. combat_v2_abilities.sql, combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_pick_card(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: a random standing card for an enemy move, a Warden x v2_roles.warden.taunt_w (the simulator pickCard). One draw. Answer {ref, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_enemy_mult(jsonb, jsonb, jsonb) is $cm$[combat] Combat v2: the damage multiplier of an enemy (Enraged, the Hunt boss rage, Weakened, Chill, Pack; the simulator enemyMult). PURE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_enemy_hit(jsonb, jsonb, jsonb, numeric, boolean, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8): one enemy hit on a card (the simulator enemyHit): combat_v2_hit written on the card, then Crush, the single-hit riders Frost Aura, Venom, Burning, and Slowing on an area hit. Answer {state, dealt, hit, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_boss_target(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.4): the card that a counter move aims at (move.tgt: random, lowest, support, weakest_support, strongest_attacker, empowered, shielded, biggest_shield, frozen, last_support; else a random card). Answer {ref, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_boss_move(jsonb, jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.4): one counter move of a named Hunt boss (the simulator bossMove): hit, area, apply, guard, heal, cleanse_self, cash_out, enrage, spiral, evade, charge, strip, strip_shields, skip, extra_action, brood, state, undo_smite, desync_smite, mirror_smite, siphon. Answer {state, draws}. VOLATILE. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_enemy_act(jsonb, jsonb, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 3.3, 8): ONE action of a standing enemy of a v2 state (the simulator enemyAct): the Hunt boss (Charging, the Cataclysm every boss_moves.cycle turns with Rollout, a counter move with counter_share, else the move table) or a Dungeon foe (the Cataclysm of a kind that charges, Bulwark, the weighted moves with the v2 status moves). The caller runs combat_v2_next first. Draws from opts.draws in a fixed order (else random()). Answer {state, move, draws}. VOLATILE. No v1 function calls it. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_hunt_boss(text, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.4): the Hunt boss of a tier as a v2 unit (the simulator makeBoss): a named boss of hunt_bosses_v2 (sig, Mythic adds, resists, params, counter moves with the numbers of enemy_v2) or the tier boss with opts.sigs; HP = tier HP x asc3_hp_x x hp_factor x opts.start_frac; Plated, Fade, Brood; opts.weak_role. Reads only. combat_v2_monsters.sql.$cm$;
comment on function public.combat_v2_dungeon_foe(text, integer, integer, text, jsonb, jsonb) is $cm$[combat] Combat v2 (plan 8.3): a Dungeon or Gauntlet foe as a v2 unit (the simulator makeFoe): the growth of the floor and room, the room kind, its own passive and aura, the caller's pool passives, its moves; Plated, Fade, Brood. Reads only. combat_v2_monsters.sql.$cm$;
comment on function public.hunt_boss_v2_card(text, text) is $cm$[combat] Combat v2 THE HUNT BOSS TEMPLATE (plan 8.4): the boss card lines: weak_to (rule tags), resists (immune statuses), signature (each mechanic with its label, text and numbers), counters (archetypes that it counters), bring (archetypes that it favors). Reads only. combat_v2_monsters.sql.$cm$;

notify pgrst, 'reload schema';
