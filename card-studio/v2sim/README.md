# v2sim: a prototype simulator of combat v2

This is a local tool for balance tests. It does not change the live game. It does not write to a database. It does not call SQL.
The numbers are PROTOTYPE ESTIMATES. Verify each decision in the Combat Lab (`docs/combat-lab.md`) when the real functions exist.

## Commands

```
node card-studio/v2sim/run.mjs <experiment|all> [--runs N] [--seed S] [--patch '{"v2_dungeon":{"atk_x":0.8}}'] [--config file.json]
node --test card-studio/v2sim/*.test.mjs
```

Experiments: `fairness`, `shapes`, `survival`, `stat-weights`, `speed`, `statuses`, `archetypes`, `pp` (the PP table).
`teams` (in `teams.mjs`) runs the 20 "no meta" teams of `teams.json` with the 130 approved Set 1 actives in the Hunt (a neutral boss and the 16 named bosses of `v2_bosses`), the Dungeon (run, horde, guardian and the guardian with each named boss's mechanics) and the Gauntlet, at casual and active, and reports 5 no-meta checks (a strong somewhere, b has a weakness, c not best everywhere, d overall within x0.8-x1.2 of the median team (a designed specialist, `"specialist": true` in teams.json, is skipped: Field Hospital), e casual teams clear floor 3) and a team x content matrix. About 30 s. A what-if on one card: `--patch '{"v2_templates":{"s1.<card key>":{...}}}'`.
  The actives are UNRELEASED card designs and stay PRIVATE: `teams` reads them from `$V2SIM_ACTIVES`, else from `../discord-card-ideas/set1-actives.json` beside the repo. Never commit that file. The unit tests use the synthetic `teams-test-fixture.json`, so `node --test` passes without it.
`monsters` (in `monsters.mjs`) runs the 20 teams against the 16 named Hunt bosses of `v2_bosses` and the neutral boss (Hunt day and the Dungeon guardian with the same mechanics, casual and active) and reports the counter matrix, the counter cap (no Normal or Heroic boss cuts a team below x0.65), rule A (2 enemies at x0.80 or lower), rule B (top 5 against 2 enemies), the measured boss damage factor and the "Weak to: role" weeks. `--tier Mythic` adds the Mythic rules. About 60 s. It reads the same private actives file.
`targets` (in `targets.mjs`) measures every tuning target of 2026-10-18 in about 10 s and writes a PASS/FAIL table plus a JSON file. `--tag name` adds a suffix to the report names (for before/after).
Each report goes to `card-studio/out/v2sim/<experiment>.md` (the `out/` folder is not committed). The seeds are fixed, so a run repeats.
On a laptop, `all` takes about 35 s. The slowest experiment (`stat-weights`) takes about 17 s.

## Files

| File | Content |
|---|---|
| `config.json` | Every number. Each top-level key has the shape of a future `balance` key (`v2_stats`, `v2_asc`, `v2_speed`, `v2_status`, ...) |
| `fixture.json` | A snapshot of PUBLIC card data (live, read-only, 2026-10-18): 133 subjects, their 362 finishes, and the balance values that v2sim starts from. No player data |
| `make-fixture.mjs` | Builds `fixture.json` from three read-only SELECT dumps (the queries are in the file header) |
| `formulas.mjs` | Every formula in one object, so that a test can plant a fault in one formula |
| `cards.mjs` | Roles, the placeholder actives, PP prices, point builds, card stats |
| `engine.mjs` | One fight: the speed meter, statuses, the damage pipeline, card and enemy actions |
| `policy.mjs` | `auto` (the Auto button) and `best` (holds payoffs for their status, kill targets, control on a Charging boss) |
| `modes.mjs` | The Hunt boss and a Hunt day, Dungeon foes, floors and runs, the Gauntlet |
| `experiments.mjs`, `run.mjs` | The 7 experiments and the CLI |
| `teams.json`, `teams.mjs`, `teams-test-fixture.json` | The 20 test teams (card keys only), the `teams` experiment, and a synthetic fixture (made-up cards and teams) for the unit tests. The real actives are in the private notes folder |
| `checks.mjs`, `*.test.mjs` | Invariant checks (formulas, meter, statuses, immunity, fuzz) and planted faults |
| `monsters.mjs` | The `monsters` experiment: the 16 named bosses x 20 teams counter matrix and its checks |
| `lab-checks.mjs`, `lab.test.mjs` | The Combat Lab items of 2026-10-19: one unit check for each mechanic and one planted fault for each |

## What the model does

- **Turn system (option B).** Each clock step, every standing unit adds its speed to a meter. A unit with 100 acts and loses 100.
  Speed 100 = one action a step. The step counts durations, the Hunt daily cap (40) and the Dungeon fight cap (40). Speed replaces cooldowns.
  Supports are squad members. Enemies hit them in every mode.
- **Every card** has a basic attack (supports hit for `v2_support.basic_x` x CP), a role passive (always on, `v2_roles`) and a unique active.
  The active is ready after N own turns that did not use it (`v2_charge`: attackers 2, supports 1). When it is not ready, the card attacks.
- **9 stats** from the 8-stat study: flat Attack (+3 CP) and HP (+8), rates for the rest, with caps. ASC-3 ascension. 1 point a level, 30 at level 30.
  The convergence dial D is `v2_level.converge_d` (0 = off).
- **Statuses** (`v2_status`): Poison (Toxic burst at 3 stacks, then reset), Burn (decays, halves heals, x1.5 on healers), Stunned, Frozen (Chill 3),
  Sleep (until damaged), Paralyzed (50% fail), Blinded, Confused, Slowed, Quickened, Chill, Exposed, Weakened, Mark, Shielded, Empowered, Focused.
  ONE control immunity for Stunned, Frozen, Sleep and Paralyzed. The Hunt boss gets 1-step control and a 3-step immunity.
- **Counters, both ways**: Pierce and the Breaker passive (Defense), true strike (Dodge and miss), Accuracy (miss and resolve), Burn (heals),
  Slowed and Chill (Speed), shield break, Ironhide (no crit unless Marked), Purify, Elementborn, Unstoppable, Sunder, Shatter, Dispeller, Thick Hide.
- **Enemies**: a Hunt boss per tier (live HP and ATK, live move table, Cataclysm every 8th turn after Charging, rage below 50%, 1-2 signatures),
  or one of the 16 named bosses (`v2_bosses`), Dungeon foes (live monsters and growth, the v2 status moves and passives, the live floor plan of 5 rooms,
  rest and choice rooms), the Gauntlet (one weekly squad, 0 stars, level 0, its own foe scale and heal rooms).

## The Combat Lab items of 2026-10-19

| Item | Mechanic | Where | Default |
|---|---|---|---|
| P3 | Support area smite: block `area` on a support (smite on the target, the area value on every other foe, true strike). With one foe it adds `v2_support.area_one_foe_x` (0.2, the plan area rule) of its value. Price: smite x area x `ref.foes_other` | `engine.mjs` `doActive`, `cards.mjs` | on (a new block) |
| Revision 5 | Free cure: block `cure` (`statuses`, `immune` steps) cures ONE ally (the one with the most listed statuses) and makes it immune to them. 0 PP (`v2_pp.support_pp.cure`). A `shield` block with `to: "cured"` shields that ally | `engine.mjs` `cure`, `policy.mjs` | on (a new block) |
| P4 | Empower stacking: `v2_status.empowered.stack` true adds Empowers up to `stack_cap` (0.5 = x1.5) | `engine.mjs` `apply` | OFF |
| P5 / plan 8.3 | Enemies put statuses on cards: the monster status moves (`v2_dungeon.moves_v2`: Hellfire Burn 2, Frost Punch Chill 2, Squeeze Blinded, Rattle Exposed, Infect Poison + no heal), the monster passives at elite+ (`v2_dungeon.monster_passives`: Plaguebearer, Burning, Frost Aura, Elusive, Sunder, Shatter, Regrowth, Undying, Volatile Core, Bulwark, raptor Pack), and the boss counter moves | `engine.mjs`, `modes.mjs` | on (approved monsters) |
| Auto | Auto holds a control active for a Charging enemy: `v2_auto.hold_control_for_charging` (max `hold_max` ready turns) | `policy.mjs` `auto` | OFF |
| Monsters | The 16 named Hunt bosses (`v2_bosses`: resists, signature and Mythic rules of `v2_boss_rules`, 3-4 counter moves, hp_factor), boss HP = tier HP x `asc3_hp_x` (1.7) x hp_factor, Regrowth 0.4% (boss) / 1% (foe) flat, the counter cap check, "Weak to: role" (`weakRole`, +`weak_role_x`), the Gauntlet fix (`v2_gauntlet`: foes x0.4, growth 1.15 / 1.07, rest 80%, choice 60%, rest and choice weight 20, 10 floors) | `engine.mjs`, `modes.mjs`, `monsters.mjs` | on (approved 2026-10-19) |
| Fix | Dungeon minibosses and guardians did not charge or make their Cataclysm: the foe flag `charge` was overwritten by the card charge counter. The flag is now `cataclysm` | `modes.mjs`, `engine.mjs` | fixed |

Nathan's answers of 2026-10-19 (applied): the team test uses the 16 named bosses as its counter contents; check d skips the designed specialist Field Hospital; a "Weak to: Controllers" week boosts control, not damage (`v2_enemy.weak_role_rules`: each Controller control on the boss lasts 1 more boss action); the counter-cap boss numbers (Hydra, Netcode, Grind Vampire, AFK Warzombie, `v2_bosses._tuning`); every `hp_factor` = the measured median Hunt damage vs the neutral boss. The Flurry value stays: no measured trim helped a check.

Not modelled: the Mirror Hide reflect, the boss weak-to rule tags, the Dungeon day rule and Elementborn from the element. A boss Guard is 10% of `boss_heal_ref`, not of its max HP.

## The placeholder unique active (deterministic)

The active of a card = one template of its role: `templatesOf(role)[hash(subject key) mod count]` (`cards.mjs`, `templateFor`).
The 42 templates are in `config.json` `v2_templates`. Each template costs 10 PP (± 0.6) by the price rules in `v2_pp` (`node run.mjs pp`).
Rarity scales the numbers: a support amount x F, with F = (CP_base / 25)^0.2 (so rarity and stars count). An enabler adds +1 stack at Full Art, Event and Gold.
An attacker scales through CP. The role of a card comes from today's ability kind (the roles draft). The no-ability cards and three Cleavers are overrides (`v2_role_map`).

## What the model simplifies

- No weakness, resistance, element chart, squad synergy, block, boons or pranks.
- The Hunt boss HP is shared, so one day never kills it. A day starts at a random HP share (5% to 100%). The Hunt score is net damage (dealt minus boss heals).
- The Dungeon ignores the budget and the day rules. Choice rooms heal 25% (the Gauntlet 60%). Treasure rooms do nothing. A fight that reaches the step cap ends the run.
- Durations count clock steps. A card acts about once in 5 steps, so card statuses have longer durations (`dur_card`).
- The `best` policy is simple. It does not plan the order of several cards.
- Supports crit on their effect amounts (the 8-stat study rule). The effect caps stay.

## Values tuned in this prototype

- Support base speeds: the 8-stat study start values (about 40) made 1A+7S and 2A+6S the best Hunt shapes. v2sim uses 20 to 24.
- Dungeon foe speeds: 50 (not 100), so that a 5-card squad makes about one attack for each foe action, as today.
- The tuning pass of 2026-10-18 (Nathan approved the 6 recommendations): convergence D 0.22, support power_exp 0.1, ABL 5% a point,
  boss control immunity 2, Cleaver Hunt area 0.2 and splash 0.6, Artillery basic 0.25 and smite 5 PP per 1.0 CP, Flurry speed 18,
  Medic heal 0.6 / after-action heal 5%, Spotter Expose 0.4 / basic 15%, Envenom Weaken 0.09, Stun charge 1, Hunt Poison reference 700.
  Before/after tables: `discord-card-ideas/v2sim-tuning-2026-10-18.md` (local design notes) and `node run.mjs targets`.
