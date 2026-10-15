# F-3 PR 4: the effect engine, implementation plan (2026-10-15)

Status: plan, made from `origin/main` 5571a02 and the live function text in `db/schema/functions/`. Every file:line points
into those snapshot files (the lines include the 5 header lines). v1 keeps play the same: the golden fights, the Lab report
and the time budget prove it in each PR. Parent: `docs/foundations.md` F-3 (items 1, 12, 13, 14; PR order item 4).

## 1. Inventory

### 1.1 Every effect branch today

| Effect | Slot | Hunt | Dungeon and Gauntlet | Shared helper |
|---|---|---|---|---|
| focus | attack | `hunt_attack.sql:129` (crit chance) | `dungeon_attack.sql:43` | `combat_crit_chance.sql:14`; `hunt_card_crits.sql:27` |
| pierce | attack | `hunt_attack.sql:130` | `dungeon_attack.sql:44` | `combat_hit.sql:15` (no block) |
| execute | attack | `hunt_attack.sql:130` (boss HP at :40) | `dungeon_attack.sql:44-48` | `combat_hit.sql:24` |
| rampage | attack | `hunt_attack.sql:130` | `dungeon_attack.sql:44` | `combat_hit.sql:30-33` (its own `random()`) |
| lifesteal | attack | `hunt_attack.sql:184-187` | `dungeon_attack.sql:67-72` | `combat_lifesteal` |
| empower | support, ally | `hunt_support.sql:120-122` | `dungeon_support.sql:46` | `combat_support_value.sql:12-19` |
| shield | support, ally | `hunt_support.sql:123-126` | `dungeon_support.sql:47` | same |
| heal | support, ally | `hunt_support.sql:127-142` (Undying :139) | `dungeon_support.sql:48-50` | same |
| weaken | support, enemy | `hunt_support.sql:148-155` (Spiral :151) | `dungeon_support.sql:66` | same |
| expose | support, enemy | `hunt_support.sql:156-158` | `dungeon_support.sql:67` | same |
| stun | support, enemy | `hunt_support.sql:159-176` (immunity, Desync, Juggernaut) | `dungeon_support.sql:68-70` | `combat_stun_immune` |
| smite | support, enemy | `hunt_support.sql:192-217` (Mirror, settle) | `dungeon_support.sql:71-73` | same |
| cleanse | support, team | `hunt_support.sql:177-191` (Hotfix, Plague, Rot) | `dungeon_support.sql:59-61` | none |

Other effect-name branches: counters `hunt_support.sql:88-100`; log values `hunt_support.sql:226-233`,
`dungeon_support.sql:53-57, 76-79`; Auto pick `dungeon_auto_action.sql:34-46`; the end of empower `hunt_attack.sql:197-198`,
`dungeon_attack.sql:73`. `cards.json` has 127 abilities in 5 shapes; every stun has duration 1.

### 1.2 Passives

| Group | Keys | v1 |
|---|---|---|
| Enemy passives | armored, shrouded, flaming, volatile, regenerating, thorns, frenzied | Unchanged (not ability effects) |
| Counter passives (Hunt boss) | plague, shatterer, dispeller, juggernaut (`hunt_support.sql:88-91,171,180-183`) | Into `combat_effect` as data (2.6) |
| Counter marks (Hunt) | null_next, block_*, half_*, heal_block_card, undying, spiral, stun_fail, lock_cleanse, rot, mirror | Into `combat_effect` as reactions (2.6) |

### 1.3 Where the fight state lives

| Fact | Hunt (columns) | Dungeon and Gauntlet (`dungeon_runs.state`) |
|---|---|---|
| Round | `hunt_combat_state.round` | `state.round` |
| Card HP, max, down | `hunt_card_hp.hp_remaining, max_hp, downed` (a row after commit) | `state.cards.<id>.hp, max, down` |
| Shield, empower, curse | `hunt_card_hp.shield, dmg_buff, dmg_debuff` | `cards.<id>.shield, buff, debuff` |
| Cooldown and stunned card | `hunt_card_hp.cd_until_round` | `cards.<id>.cd` |
| Poison on a card | none | `cards.<id>.psn, psnu` |
| Enemy HP | `hunts.hp_remaining, hp_max` (locked `FOR UPDATE`) | `foes[i].hp, max` |
| Weaken, expose, stun, enrage | `hunt_combat_state.*` (per player and day) | `foes[i].wk/wku, ex/exu, st, enr/enru` |
| Guard | none | `foes[i].sh` |
| Counter marks | `hunt_combat_state.marks` | none |
| One support a round | none | `state.sup_round` |
| Run buff | none | `state.buff` |

### 1.4 Mode differences that v1 keeps

1. Affinity count: the Hunt counts committed cards; the Dungeon counts the whole run squad.
2. Squad synergy: the Hunt reads the other committed cards; the Dungeon the whole run squad.
3. The Hunt commits the ally target first (`hunt_support.sql:114`), with full HP.
4. Stun immunity refusal: the Hunt answers `st + balance stun_immune_rounds`, the Dungeon `st + 2` (the value is 2: one rule).
5. Cleanse: the Hunt sets `dmg_debuff = 1` where it is not 1; the Dungeon sets `debuff 1, psn 0, psnu -1` on every card.
6. Smite: the Hunt credits `hunt_hits` and a kill runs `settle_hunt`; the Dungeon runs `dungeon_after_kill`.
7. Amount order: Hunt amount x potency x counter (only when not 1) x matched_x (ally); Dungeon amount x potency x matched_x.
8. The affinity scale applies to enemy effects only (weaken, expose, smite).
9. `random()` order: miss, crit, block, roll, rampage (`combat_hit`), then the Juggernaut stun fail. The goldens use `setseed`.

### 1.5 Boons and pranks

`play_card_effect` stays a separate system (no fight state; real time; Discord). Five of its effects touch the Hunt hit
(rally, butterfingers, mend, launch_party, raid_crasher, `hunt_attack.sql:102-107,136-161`) and stay in v1; a later PR (4g)
makes them fight inputs. The fight engine never uses `primitive` or `effect_primitives`.

## 2. The design

### 2.1 Primitives (v1: 7, each written once in `combat_effect`)

| Primitive | What it does | Used by |
|---|---|---|
| `damage` | enemy HP - `greatest(1, round(a x scale))`, floor 0 | smite |
| `heal` | HP + `greatest(1, least(round(basis x a), round(target.max x cap)))`, never above max, never on a downed card | heal, lifesteal |
| `shield` | shield + the same value as `heal` | shield |
| `buff` | `attack` (until the next attack), `enemy_damage` (`wk`), `damage_taken` (`ex`) | empower, weaken, expose |
| `apply_status` | `stun`: `st = round + duration`, with the immunity | stun |
| `remove_status` | `curse`, `poison` on all allies | cleanse |
| `hit_mod` | `crit_add`, `no_block`, `dmg_mult`, `extra_strike` | focus, pierce, execute, rampage, set synergy |

Reserved (refused until built with a Lab test): `repeat`, `summon`, `reflect`, statuses `burn`/`mark`, buff stats `crit`/`cooldown`.

### 2.2 Triggers (v1: `use`, `before_hit` (no `random()`), `on_hit`, `after_attack`)

Reserved: `round_start`, `on_crit`, `on_kill`, `on_damage_taken`, `ally_down`, `low_hp`.

### 2.3 Conditions, values and targets

- Conditions: `target_hp_below`, `target_down`, `target_alive`, `matched`, `count_tag {tag, scope, distinct, min, max}`,
  `holds_subject {key, scope}`, `mode_in`, `flag {balance}`.
- Values: a product of refs (`field:`, `balance:`, `potency`, `counter`, `matched_x`, `scale`, `dealt`, `count_tag`),
  with `cap` and `add1`. A row holds no number of its own.
- Targets: `self`, `ally_target`, `enemy_target`, `all_allies`.

### 2.4 The `ability_kinds` table

Columns: `key` (pk), `label`, `slot` (attack | support | squad), `steps` (1 to 8), `fields` (types and limits),
`latent`, `power`, `counter_key`, `auto`, `enabled`, `note`, `updated_at`. A check trigger validates every step against
2.1 to 2.3 and refuses reserved names and unknown balance refs. RLS on, `service_role` grants only. A trigger on
`subjects.ability` runs `ability_ok()` and refuses an unknown kind, a wrong slot, an unknown field, a value outside its
limits, a missing required field, a target not allowed. NULL is allowed.

### 2.5 The 13 rows

| key | steps |
|---|---|
| focus | `before_hit: hit_mod crit_add = field:amount` |
| pierce | `before_hit: hit_mod no_block` |
| execute | `before_hit: hit_mod dmg_mult = add1(field:amount) when target_hp_below(threshold)` |
| rampage | `before_hit: hit_mod extra_strike = field:amount` |
| lifesteal | `on_hit: heal self, basis dealt, cap combat.lifesteal_cap` |
| empower | `use: buff attack on ally_target = add1(a), until next_attack` |
| shield | `use: shield ally_target, basis target max, cap support.heal_cap` |
| heal | `use: heal ally_target, basis target max, cap support.heal_cap` |
| weaken | `use: buff enemy_damage = a x scale, cap support.weaken_cap, rounds field:duration` |
| expose | `use: buff damage_taken = a x scale, cap support.expose_cap, rounds field:duration` |
| stun | `use: apply_status stun, rounds field:duration` |
| smite | `use: damage enemy_target = a x scale` |
| cleanse | `use: remove_status [curse, poison] on all_allies` |

### 2.6 Counters as data

`passives.params.counters` (plague, juggernaut, ...); marks found through `ability_kinds.counter_key`; reactions tied
to a primitive (Mirror = damage from a support, Undying = heal, Spiral = buff enemy_damage, Desync/Juggernaut = stun,
Hotfix/Plague/Rot = remove_status, Packet Loss = any `use`).

### 2.7 The signature

`combat_effect(p_fight jsonb, p_card bigint, p_on text, p_ctx jsonb default '{}') returns jsonb` (VOLATILE), returning
`{ok, changes[], mods{}, log{}}` or `{ok:false, error, ...}`. Squad rows (`slot = 'squad'`) run after the card's kind.
Called once per trigger, as a plpgsql assignment. `combat_hit_core(...)` and `combat_crit_chance_mods(...)` are new;
`combat_hit` (14 args) and `combat_crit_chance` (4 args) stay as wrappers with the same signatures.

### 2.8 The one fight state shape (v1)

The Dungeon key names are canonical: `{v, mode, round, squad, cards{}, enemies[], marks, facts{}, ext{}}`. The Hunt maps
its columns to it; new layers go under `ext` (a Hunt `ext jsonb` column comes with the first new layer).
`fight_state_check(jsonb)` runs in the Lab and tests.

### 2.9 Applying changes

`dungeon_effect_apply(state, changes)` and `hunt_effect_apply(hunt, player, day, changes)` set or add values within
limits only (no combat math). The modes keep their rules and write the log fields the engine returns, so the
`combat_actions` rows stay the same.

### 2.10 Rules that keep v1 the same

`random()` only where it is drawn today; `numeric`, today's multiplication order (the jsonb text shows the scale); the
order of refusals; every answer key kept.

## 3. The PR split

Time check in every PR: `scripts/fight-timing.mjs` (300 calls each, BASE and CANDIDATE in turns; fail above 1.10 x the
BASE mean) for `hunt_attack`, `hunt_support`, `dungeon_attack`, `dungeon_support`, `dungeon_enemy_turn`,
`dungeon_auto_rounds`, `dungeon_finish_room`, `dungeon_pass_turn`, `hunt_card_crits`, `hunt_autopick`, and
`combat_effect` alone; the full Lab within 690 s x 1.10.

| PR | Content | Proof | Risk |
|---|---|---|---|
| 4.0 Test tools (no SQL) | Goldens add `combat_actions` rows; Hunt golden gets plague/shatterer/dispeller/juggernaut bosses and a heal on a hurt card; `fight-timing.mjs` baseline | Goldens pass; `test-golden-mutations` fails each mutation + a new heal +1 | Low |
| 4a `ability_kinds` + validator | Table, check, 13 rows, `ability_ok`, `ability_power`, the `subjects` trigger; a self-check runs every live ability | All 127 pass; planted bad abilities and rows refused; goldens match | Low (studio push must show the error) |
| 4b The engine, unused | `combat_effect` and helpers, `combat_hit_core`, `combat_crit_chance_mods`, state builders, apply functions, `passives.params.counters` | A shadow test (old function vs engine, same `setseed`, text equal) over every kind x mode x target case x counter x mark x points x seeds; planted engine mutations fail it | Medium |
| 4c Dungeon and Gauntlet switch | `dungeon_support`, `dungeon_attack`, `dungeon_auto_action` (0.5 / 0.6 to balance) | `dungeon-golden.mjs` BASE/CANDIDATE no difference; shadow; tests; Lab numbers equal; time | Medium (`dungeon_attack` ~195 ms) |
| 4d Hunt switch | `hunt_support`, `hunt_attack`, wrappers, `hunt_card_crits` | `combat-golden.mjs`, `test-boss-counters-golden.mjs`, Hunt tests, shadow, Lab, time | High (not Thu 14-15 or Mon 16-17 MT) |
| 4e Old branches out + 3 CI checks | Drop `combat_support_value`; numbers to balance (poison rounds, Flurry hits); update `lab-mutations.mjs`; checks c1/c2/c3 + workflow | Goldens, shadow, Lab; each check fails on a planted violation | Low-medium |
| 4f Forbidden Pride (D-202) | Row `set_forbidden_pride` (slot squad), `balance set_synergy.forbidden_pride` all 1 (no change); Lab `sets` section | Goldens match at 1; with test values the synergy works at 3/5/7, 7 Hunt only; duplicates do not count | Low |
| 4g (later) Boons in fights | rally, butterfingers, mend, party, crasher as fight inputs | Hunt golden | Medium |

The three CI checks (no database, about 10 s): (1) no combat number outside `balance` (a ratchet with an allowlist with
reasons); (2) no effect-name comparison outside `combat_effect*` (live snapshot and changed migrations only); (3) no combat
math in `tcg-activity/src` and `tcg-bot/src` (balance leaf names, the old constants in squad/team/crit/combat files).

## 4. The Forbidden Pride set synergy (D-202) as data

A `slot = 'squad'` row with three `before_hit` `hit_mod dmg_mult` steps: `count_tag trait:forbidden-pride, scope squad,
distinct subject` at `small_at`/`big_at`/`top_at` from `balance set_synergy.forbidden_pride`
(`{small_at:3, small:1, big_at:5, big:1, top_at:7, top:1}`), the top step also `holds_subject ottozone-s-head` and
`mode_in hunt`.

Facts that change the design:
- Seven pieces fit only in the Hunt (daily cap 8, at least 1 Character or Creature). The Dungeon squad is 5.
- All 7 pieces are type `Item`: the 3 "attacker" Items cannot attack (only Character and Creature attack), and the 4
  supports have no ability. So the bonus must go to the squad's real attackers.
- Count distinct subjects (two finishes of one subject are two card ids).
- `combat_card_facts` already counts `trait:forbidden-pride` as a trait synergy: avoid a double count.
- A special finisher needs a new trigger: a later PR with a Lab test.

## 5. Traps and how the PRs avoid them

1. Old migrations re-create fight functions with no guard: `apply-sql.mjs` refuses them as SUPERSEDED; regenerate the list in each PR; never `--force-superseded` on them.
2. Tests run old files in undone blocks with the old `combat_hit` / `combat_crit_chance` arguments: keep both signatures as wrappers.
3. Overloads: never change a signature in place; a new core gets a new name; keep defaults.
4. md5 guards in a stack: each shared function belongs to one PR (4c: `combat_hit_elem`, `dungeon_*`; 4d: `combat_hit`, `combat_crit_chance`, `hunt_*`); take the own md5 from the database after the apply.
5. Tests that apply guarded files fail after a switch (`test-element-bonus`, `test-auto-elements`, `test-f3-combat-math`, `test-combat-actions`, `test-hunt-random-target`, `test-damage-log`, `test-dungeon-stun-pass`): put the base text in the test, or run with `--live`.
6. Lab and golden mutations are text replaces: update them in the PR that changes the text; keep `v_dmg := greatest(1, round(v_base));` exactly.
7. Random order and double calls: `combat_effect` VOLATILE, once per trigger; `before_hit` never draws `random()`.
8. Numeric scale in jsonb text: keep the multiplication order; never cast to float; the shadow test compares text.
9. The Hunt commit has side effects: commit only the ally target, after Packet Loss; a target over the daily cap gets no row (a shadow case).
10. Shape checkers (`balance_check_settings`, `passives_check`) refuse new keys: extend them in the same file.
11. New objects need RLS, `service_role` grants, a comment, checks; run the generators.
12. Boons share words: CI check 2 must not flag `v_prim.primitive = 'timeout'`.
13. CI checks scan the live snapshot and changed migrations only (the history files keep old branches).
14. The status table in `docs/foundations.md` says F-3 PR 2b is not merged: fix it.

## 6. Decisions for Nathan

1. Forbidden Pride: count distinct subjects (recommended) or cards.
2. Forbidden Pride: the bonus goes to every squad attacker (recommended) or only to the pieces.
3. Forbidden Pride: a separate factor, like the element bonus (recommended), or inside `syn_cap`.
4. Forbidden Pride: leave set traits out of the trait synergy.
5. Forbidden Pride: the top bonus now, the finisher later (recommended).
6. Forbidden Pride: the values after the Lab report.
7. The 3 "attacker" Items: should they become able to attack?
8. The limits in `ability_kinds.fields`: about 2 x the largest live value; Nathan approves before 4a.
