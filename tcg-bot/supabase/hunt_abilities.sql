-- Card abilities, first pass (2026-09-16). Every subject gets one ability built from the
-- fixed effect set (see discord/docs/battle-turn-based.md). Attack effects fire when the
-- card attacks (Character/Creature). Support effects are active + cooldown-gated
-- (Item/Place/Moment). Numbers and flavor are first-pass — tune freely.
--   ability = { name, kind:'attack'|'support', effect, amount, target, cooldown, ... }

alter table subjects add column if not exists ability jsonb;

-- ===== Characters (attack passives) =====
update subjects set ability = '{"name":"Krushing Blow","kind":"attack","effect":"execute","amount":0.4,"threshold":0.3,"desc":"+40% damage when the boss is below 30% HP."}' where id = 39;
update subjects set ability = '{"name":"Lock On","kind":"attack","effect":"focus","amount":0.15,"desc":"+15% critical chance on this attack."}' where id = 40;
update subjects set ability = '{"name":"Warm Up","kind":"attack","effect":"lifesteal","amount":0.2,"target":"self","desc":"Heal for 20% of the damage dealt."}' where id = 41;
update subjects set ability = '{"name":"Rapid Fire","kind":"attack","effect":"rampage","amount":0.25,"desc":"25% chance to strike twice."}' where id = 42;
update subjects set ability = '{"name":"Dad Strength","kind":"attack","effect":"pierce","desc":"Ignores the boss damage reduction."}' where id = 100;
update subjects set ability = '{"name":"Hype Train","kind":"attack","effect":"focus","amount":0.2,"desc":"+20% critical chance on this attack."}' where id = 102;
update subjects set ability = '{"name":"Combo Attack","kind":"attack","effect":"rampage","amount":0.3,"desc":"30% chance to strike twice."}' where id = 105;

-- ===== Creatures (attack passives) =====
update subjects set ability = '{"name":"Final Act","kind":"attack","effect":"execute","amount":0.5,"threshold":0.25,"desc":"+50% damage when the boss is below 25% HP."}' where id = 25;
update subjects set ability = '{"name":"Thunderbolt","kind":"attack","effect":"focus","amount":0.2,"desc":"+20% critical chance on this attack."}' where id = 38;
update subjects set ability = '{"name":"Leech Seed","kind":"attack","effect":"lifesteal","amount":0.25,"target":"self","desc":"Heal for 25% of the damage dealt."}' where id = 43;
update subjects set ability = '{"name":"Hydro Cannon","kind":"attack","effect":"pierce","desc":"Ignores the boss damage reduction."}' where id = 44;
update subjects set ability = '{"name":"Moonlight","kind":"attack","effect":"lifesteal","amount":0.2,"target":"self","desc":"Heal for 20% of the damage dealt."}' where id = 97;
update subjects set ability = '{"name":"Double Slash","kind":"attack","effect":"rampage","amount":0.3,"desc":"30% chance to strike twice."}' where id = 98;
update subjects set ability = '{"name":"Rally Cap","kind":"attack","effect":"execute","amount":0.4,"threshold":0.3,"desc":"+40% damage when the boss is below 30% HP."}' where id = 109;

-- ===== Items (support) =====
update subjects set ability = '{"name":"Overclock","kind":"support","effect":"empower","amount":0.6,"target":"ally","cooldown":3,"desc":"An ally next attack deals +60% damage."}' where id = 104;
update subjects set ability = '{"name":"Exploit Bug","kind":"support","effect":"expose","amount":0.25,"duration":2,"target":"boss","cooldown":3,"desc":"The boss takes +25% damage for 2 rounds."}' where id = 116;
update subjects set ability = '{"name":"Dig Attack","kind":"support","effect":"smite","amount":40,"target":"boss","cooldown":2,"desc":"Deal 40 direct damage to the boss."}' where id = 118;

-- ===== Places (support) =====
update subjects set ability = '{"name":"Safe Haven","kind":"support","effect":"shield","amount":25,"target":"ally","cooldown":3,"desc":"Give an ally a 25-point shield."}' where id = 107;
update subjects set ability = '{"name":"Base Camp","kind":"support","effect":"heal","amount":30,"target":"ally","cooldown":3,"desc":"Restore 30 HP to an ally."}' where id = 121;

-- ===== Moments (support) =====
update subjects set ability = '{"name":"Ambush","kind":"support","effect":"stun","target":"boss","cooldown":4,"desc":"The boss skips its next turn."}' where id = 46;
update subjects set ability = '{"name":"Confusion","kind":"support","effect":"weaken","amount":0.3,"duration":2,"target":"boss","cooldown":3,"desc":"The boss deals -30% damage for 2 rounds."}' where id = 101;
update subjects set ability = '{"name":"Tech Confusion","kind":"support","effect":"expose","amount":0.2,"duration":2,"target":"boss","cooldown":3,"desc":"The boss takes +20% damage for 2 rounds."}' where id = 106;
update subjects set ability = '{"name":"Bracket Buff","kind":"support","effect":"empower","amount":0.5,"target":"ally","cooldown":3,"desc":"An ally next attack deals +50% damage."}' where id = 108;
update subjects set ability = '{"name":"Rider Kick","kind":"support","effect":"smite","amount":45,"target":"boss","cooldown":2,"desc":"Deal 45 direct damage to the boss."}' where id = 110;
update subjects set ability = '{"name":"Jet Lag","kind":"support","effect":"weaken","amount":0.25,"duration":2,"target":"boss","cooldown":3,"desc":"The boss deals -25% damage for 2 rounds."}' where id = 111;
update subjects set ability = '{"name":"Filibuster","kind":"support","effect":"stun","target":"boss","cooldown":4,"desc":"The boss skips its next turn."}' where id = 112;
update subjects set ability = '{"name":"Fortune Cookie","kind":"support","effect":"heal","amount":25,"target":"ally","cooldown":3,"desc":"Restore 25 HP to an ally."}' where id = 113;
update subjects set ability = '{"name":"Formal Complaint","kind":"support","effect":"cleanse","target":"ally","cooldown":3,"desc":"Remove debuffs from your cards."}' where id = 114;
update subjects set ability = '{"name":"Chaos Energy","kind":"support","effect":"empower","amount":0.4,"target":"ally","cooldown":3,"desc":"An ally next attack deals +40% damage."}' where id = 115;
update subjects set ability = '{"name":"Controversy","kind":"support","effect":"expose","amount":0.25,"duration":2,"target":"boss","cooldown":3,"desc":"The boss takes +25% damage for 2 rounds."}' where id = 117;
update subjects set ability = '{"name":"Outburst","kind":"support","effect":"smite","amount":35,"target":"boss","cooldown":2,"desc":"Deal 35 direct damage to the boss."}' where id = 119;
update subjects set ability = '{"name":"Spit Take","kind":"support","effect":"weaken","amount":0.3,"duration":2,"target":"boss","cooldown":3,"desc":"The boss deals -30% damage for 2 rounds."}' where id = 120;

notify pgrst, 'reload schema';
