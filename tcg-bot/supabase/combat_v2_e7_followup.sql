-- combat_v2_e7_followup.sql (2026-10-21): combat v2, phase 4, the E7 follow-up (docs/combat-redesign-plan.md 20.3). Needs combat_v2_monster_tuning.sql
-- (E7b) first. Nathan approved two changes after PR #463 (2026-10-21):
--   1. THE WEAK TO SIZE: balance v2_enemy.weak_role_x 0.3 -> 0.5 (the Lab table of PR #463: the smallest value where the favored squad's median gain is
--      x1.10 to x1.20; x1.16 at 0.5). A Weak to week: cards of that role deal +50%. The Controller week keeps its own rule (weak_role_rules.controller).
--   2. THE RAGE-QUIT WARLORD keeps the full Ironhide: balance enemy_v2.bosses.warlord.params.ironhide.crit_x = 0 (unless it is Marked, cards have no crit
--      chance against it; the Warlord resists Mark, so in play its cards never crit). The global Ironhide stays v2_enemy.mechanics.ironhide.crit_x 0.7 (the
--      Mythic Netcode and the Mythic Maw keep it). The numbers of a named boss are in balance enemy_v2.bosses.<key> (hunt_bosses_v2 holds the words),
--      so the override is a balance value: balance_log records it, and enemy_v2_spec (replaced: the E7 text + this one leaf) gives it a fixed shape.
-- NO NEW CODE in a fight function: the fight already reads a boss's own params over the base numbers (combat_v2_mech: v2_enemy.mechanics.<m> ||
-- unit.params.<m>; combat_v2_hunt_boss puts enemy_v2.bosses.<key>.params on the unit; hunt_boss_v2_card shows the merged numbers). The simulator does the
-- same (engine.mjs mechParams; config.json v2_bosses.warlord.params and v2_enemy.weak_role_x carry the same two values).
-- NO CHANGE IN PLAY: the flag combat_v2 stays OFF, no v1 function reads v2_enemy or enemy_v2, and no other function changes (only enemy_v2_spec).
-- Idempotent (each value changes only while it has its old value). Server only.
-- Test: card-studio/scripts/test-combat-v2-e7-followup.mjs (rolled back; SQL = the simulator; MUTATE=all must catch every mutation).

-- @balance-begin (test-combat-v2-balance.mjs runs this part after V1 and the E7 tuning part: it needs only V1)
select set_config('balance.by', 'nathan', true);
update public.balance set value = jsonb_set(value, '{weak_role_x}', '0.5'),
  note = note || $n$ The E7 follow-up (2026-10-21, combat_v2_e7_followup.sql; Nathan chose the value from the Lab table of PR #463): weak_role_x 0.3 -> 0.5 (a Weak to week: cards of that role deal +50%).$n$
 where key = 'v2_enemy' and value->'weak_role_x' = '0.3'::jsonb;
-- @balance-end

-- ============================================================ the Warlord's own Ironhide (balance enemy_v2.bosses.warlord.params.ironhide.crit_x)
create or replace function public.enemy_v2_spec() returns jsonb language sql immutable set search_path = public as $fn$
  select '{"rules": {"fade":{"evasion_add":"num 0 1"},"plated":{"def":"num 0 1"},"rollback":{"smite_x":"num 0 1","artillery_basic_x":"num 0 1","artillery_true_strike":"bool"},"bloodrot":{"card_heal_x":"num 0 1"},"brittle":{"card_shield_x":"num 0 1"},"time_lock":{},"mirror_hide":{"extra_x":"num 0 1","splash_x":"num 0 1","strikes_x":"num 0 1"},"tilt":{"x":"num 0 10","dur":"int 1 999"},"siphon":{"x":"num 0 10"},"crush":{"x":"num 0 10"},"rubberband":{},"rollout":{"weaken":"num 0 1"},"swarm":{"x":"num 0 10"},"brood":{"dr":"num 0 1","start":"int 1 10","max":"int 1 10"},"permafrost_heart":{}},
 "bosses": {
   "warlord": {"hp_factor":"num 0.1 5","counter_share":"num 0 1","params":{"ironhide":{"crit_x":"num 0 1"}},"moves":{"tilt":{"x":"num 0 10","dur":"int 1 999"},"alt_f4":{},"rage_spiral":{"per":"num 0 1","max":"int 1 10","dur":"int 1 999"},"flame":{"x":"num 0 10","vs_last_debuffer":"num 0 10"}}},
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

select set_config('balance.by', 'nathan', true);
update public.balance set value = jsonb_set(value, '{bosses,warlord,params}', '{"ironhide":{"crit_x":0}}'),
  note = note || $n$ The E7 follow-up (2026-10-21, combat_v2_e7_followup.sql, Nathan approved): bosses.warlord.params.ironhide.crit_x = 0, the full Ironhide of the Rage-Quit Warlord (unless it is Marked, cards have no crit chance against it; the global v2_enemy.mechanics.ironhide.crit_x stays 0.7).$n$
 where key = 'enemy_v2' and value->'bosses'->'warlord'->'params' = '{}'::jsonb;

-- ============================================================ server only, comments
revoke all on function public.enemy_v2_spec() from public, anon, authenticated;
grant execute on function public.enemy_v2_spec() to service_role;
comment on function public.enemy_v2_spec() is $cm$[combat] The fixed shape with the limits of the balance key enemy_v2 (rules: the numbers of the boss rules; bosses.<key>: hp_factor, counter_share, params, moves.<id>). combat_v2_monsters.sql; the Warlord's params.ironhide.crit_x: combat_v2_e7_followup.sql.$cm$;

notify pgrst, 'reload schema';
