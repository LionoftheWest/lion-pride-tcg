# v2sim: a prototype simulator of combat v2

This is a local tool for balance tests. It does not change the live game. It does not write to a database. It does not call SQL.
The numbers are PROTOTYPE ESTIMATES. Verify each decision in the Combat Lab (`docs/combat-lab.md`) when the real functions exist.

## Commands

```
node card-studio/v2sim/run.mjs <experiment|all> [--runs N] [--seed S] [--patch '{"v2_dungeon":{"atk_x":0.8}}'] [--config file.json]
node --test card-studio/v2sim/*.test.mjs
```

Experiments: `fairness`, `shapes`, `survival`, `stat-weights`, `speed`, `statuses`, `archetypes`, `pp` (the PP table).
`teams` (in `teams.mjs`) runs the 20 "no meta" teams of `teams.json` with the 130 approved Set 1 actives in the Hunt (a neutral boss and 18 counter bosses), the Dungeon (run, horde, guardian and 18 counter guardians) and the Gauntlet, at casual and active, and reports 5 no-meta checks (a strong somewhere, b has a weakness, c not best everywhere, d overall within x0.8-x1.2 of the median team, e casual teams clear floor 3) and a team x content matrix. About 30 s. A what-if on one card: `--patch '{"v2_templates":{"s1.<card key>":{...}}}'`.
  The actives are UNRELEASED card designs and stay PRIVATE: `teams` reads them from `$V2SIM_ACTIVES`, else from `../discord-card-ideas/set1-actives.json` beside the repo. Never commit that file. The unit tests use the synthetic `teams-test-fixture.json`, so `node --test` passes without it.
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
  Dungeon foes (live monsters and growth, the live floor plan of 5 rooms, rest and choice rooms), the Gauntlet (one weekly squad, 0 stars, level 0).

## The placeholder unique active (deterministic)

The active of a card = one template of its role: `templatesOf(role)[hash(subject key) mod count]` (`cards.mjs`, `templateFor`).
The 42 templates are in `config.json` `v2_templates`. Each template costs 10 PP (± 0.6) by the price rules in `v2_pp` (`node run.mjs pp`).
Rarity scales the numbers: a support amount x F, with F = (CP_base / 25)^0.2 (so rarity and stars count). An enabler adds +1 stack at Full Art, Event and Gold.
An attacker scales through CP. The role of a card comes from today's ability kind (the roles draft). The no-ability cards and three Cleavers are overrides (`v2_role_map`).

## What the model simplifies

- No weakness, resistance, element chart, squad synergy, block, boons or pranks.
- The Hunt boss HP is shared, so one day never kills it. A day starts at a random HP share (5% to 100%). The Hunt score is net damage (dealt minus boss heals).
- The Dungeon ignores the budget and the day rules. Choice rooms heal 25%. Treasure rooms do nothing. A fight that reaches the step cap ends the run.
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
