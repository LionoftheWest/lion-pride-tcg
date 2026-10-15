# The Combat Lab and the golden tests (F-3 PR 3)

Status: built 2026-10-14. These are local tools in `card-studio/scripts`. No migration. No change to the game.
The Lab comes before the effect engine (F-3 item 6). The effect engine PR must show the same Lab report and the same golden transcripts.

## Rules

- The tools run on the LOCAL copy only. `LOCALDB=1` is required. The preload refuses the live project.
- The tools do not calculate combat. Each number comes from the same SQL functions as a real fight.
  The tools only set up a member and a fight, choose the next action, and read what the fight wrote.
- Each fight runs in an undone block with a fixed seed. Nothing stays on the local copy.
- The helper SQL (`scripts/lab-sql.mjs`) is temporary (`pg_temp`). It lives only inside one request.
- The local database lock applies (`docs/foundations.md`, "How these PRs went live").
  With `LAB_LOCK_OWNER=<name>` each request takes the lock and releases it. Without it, hold the lock yourself.
- One request must end in less than 55 seconds. The tools cut work into small requests and set a request limit (`LAB_LIMIT_S`, 45 s).

## The Combat Lab

```
LOCALDB=1 node scripts/combat-lab.mjs [--quick] [--sections data,hunt,dungeon,gauntlet,stats,rewards,smoke] [--out dir]
```

The report goes to `card-studio/out/combat-lab/report.md` and `report.json`. The folder `out/` is not committed.
The Lab uses only synthetic members, so the report has no member data. The method is the only part that is committed.

### Time budget

| Run | Budget | Measured (2026-10-14, local copy) |
|---|---|---|
| Full | 15 minutes | 690 s (11.5 minutes) |
| `--quick` (samples) | 3 minutes | 110 s |
| `--tiny` (the acceptance test) | 1 minute | 8 to 40 s |

The full run: 60 attackers and 69 supports, 16 seeds each. 36 bosses. 390 Dungeon room fights. 68 Dungeon runs. 6 Gauntlet runs. 352 cards.
The effect engine PR must keep the time of the same run within 10 percent (`docs/foundations.md`, "Performance and cost budget").

### What each section does

| Section | What it plays | What it reports |
|---|---|---|
| `data` | each card at 0 to 5 stars, each ability | NaN, NULL, zero HP, a support cooldown below 1, `combat_cooldown` for every Haste value |
| `hunt` | a duel for each attacker. The same squad with and without each support. Squads of 8 cards. 12 bosses in 3 tiers with all passives | damage and support value for each card (subject level: lowest rarity, 0 stars, no points), top and bottom outliers, the strongest squads and shapes, each boss against a best and a median squad |
| `dungeon` | 13 elements and 5 foe kinds with 3 squads. Whole runs with random squads on the real generated day | win rate by element and kind, floor reached by squad shape, loops and locks |
| `gauntlet` | the real weekly squad | no loot, and the 0-star rule: a member with 5 stars and stat points plays the same fight as a member with none |
| `stats` | one stat point in each stat, 0 to 5 stars in each rarity | value of a point, the best attacker stat, the Haste table, a matrix of life by rarity and star |
| `rewards` | a Hunt boss with low HP, defeated and settled twice. Every Dungeon and Gauntlet run | each reward pays once, and the ledger equals the run |
| `smoke` | every card in a Hunt fight | no broken limit |

Measure for an attacker: the damage of one attack times the HP, divided by the HP that the boss counter takes in that round.
That is the expected damage before the card falls. It uses `hunt_attack` with the Normal tier boss.
Measure for a support: the extra damage of a squad of 3 median attackers in a fight of 40 attacks, against the same squad without the card. The seeds are the same.

### Findings and the exit code

| Class | Meaning | Fails the Lab |
|---|---|---|
| INVARIANT | HP below 0 or above the maximum, NaN, NULL, a negative shield, an SQL error in a fight | Yes |
| REWARD | a reward that paid twice, or the ledger is not equal to the run, or the Gauntlet paid loot | Yes |
| COOLDOWN | a support with a cooldown of 0 | Yes |
| LOOP | a request that does not end, a fight that reaches the round limit or the call limit | Yes, when new |
| LOCK | foes heal as much as all damage, a squad heals as much as all damage, a stun chain of 3 rounds | Yes, when new |
| BALANCE | an outlier: a card, a stat, a boss, a squad shape | No (information) |

`scripts/combat-lab.baseline.json` lists the LOOP and LOCK findings that Nathan has seen. A new LOOP or LOCK fails the Lab.
INVARIANT, REWARD and COOLDOWN are never in the baseline. `--no-baseline` ignores the file.

## The golden test of the Dungeon and the Gauntlet

```
LOCALDB=1 node scripts/dungeon-golden.mjs                       the code against itself (each fight runs twice with the same seed)
CANDIDATE=<file.sql> LOCALDB=1 node scripts/dungeon-golden.mjs   the code against a candidate migration
BASE=<file.sql> CANDIDATE=<file.sql> ...                         a migration that is already applied: the text before it plays the "live" fights
```

It is the twin of `combat-golden.mjs` (the Hunt, 84 fights). It plays 189 fights (63 scenarios, 3 seeds). Each fight starts with the real
`dungeon_start` or `gauntlet_start`. The transcript has every result, a digest of the state after each action, the end of the run and the ledgers.
The test fails on the first difference and prints the fight and the line.
Time: 106 s for the two base runs, 54 s more for a candidate (2 minutes 42 s in all). `GOLDEN_SEEDS=1` makes it three times faster.

The scenarios cover: 13 elements, 5 foe kinds, 10 monsters (all move pools), 7 foe passives, 8 support effects, 5 attack effects,
the refusals (cooldown, stunned, stun immunity), the pass of a turn, a whole run with doors, chests, rest rooms, the guardian pay-out and the retreat,
the Auto button, the real generated day and week, and the 0-star pair of the Gauntlet. The test fails when a marker is missing from the transcripts.

The run id is part of the random key of a door room (`dungeon_choose`). The test restarts the id sequence inside each undone fight, so a seed gives the same fight.

## Acceptance tests

| Test | What it proves | Time |
|---|---|---|
| `scripts/test-combat-lab.mjs` | The baseline Lab is green. Six planted changes make the Lab exit 1: cooldown 0, an infinite loop, foes that heal everything, HP below 0 (Dungeon and Hunt), a prize that pays twice | 84 s |
| `scripts/test-golden-mutations.mjs` | Both golden tests pass on the live text. Each planted change (1 HP, 1 round, one Shard, the 0-star rule) makes a golden test fail | 220 s |

The planted changes are in `scripts/lab-mutations.mjs`. Each one is a text replace in the live function text from `db/schema/functions`. A replace that finds nothing is an error.
The heal gap (found 2026-10-14) is closed (F-3 PR 4.0): `combat-golden.mjs` has 183 fights (was 84). They include the four counter passives (plague, shatterer, dispeller, juggernaut), a stun card, and three bosses with `hurt: true` where the heal goes to the most hurt living attacker. The test fails with COVERAGE GAP when no fight shows a heal that gained HP or one of the four counters. The mutation `hunt-heal-plus-1` is caught (the old golden passed it). Both goldens add the `combat_actions` rows of each fight to the transcript (`ACTIONS` in the Hunt, `ACTION` lines in the Dungeon and the Gauntlet), so a later PR can prove that the log stays the same. The Hunt golden takes the shared lock for each request when `LAB_LOCK_OWNER` is set.

## The time check: `scripts/fight-timing.mjs` (F-3 PR 4.0)

`scripts/fight-timing.mjs` measures 300 calls of each of the 10 fight calls on the BASE text and 300 on the CANDIDATE text (`CANDIDATE=<file.sql>`). The two texts take turns in the same request (batches of 30, the order flips in each request). Each call runs in an undone sub-block after `setseed(0.42)`. The script exits 1 when a CANDIDATE mean is above 1.10 x the BASE mean, or when a measured call returns an error. Each request takes the shared lock when `LAB_LOCK_OWNER` is set.

```
LAB_LOCK_OWNER=<name> LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/fight-timing.mjs
CANDIDATE=../tcg-bot/supabase/x.sql LAB_LOCK_OWNER=<name> LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/fight-timing.mjs [call ...]
```
The baseline on 2026-10-15 (the local copy, other sessions were working on it; with no candidate the second column is the BASE text again, so the ratio is the noise of the measure):

| Call | BASE mean ms | BASE p95 ms | BASE again mean ms | BASE again p95 ms | Ratio (noise) |
|---|---|---|---|---|---|
| hunt_attack | 1.85 | 3.01 | 1.74 | 2.76 | 0.938 |
| hunt_support | 1.18 | 1.93 | 1.18 | 1.90 | 1.008 |
| hunt_card_crits | 0.55 | 0.79 | 0.54 | 0.79 | 0.983 |
| hunt_autopick | 155.78 | 184.30 | 183.90 | 274.27 | 1.181 |
| dungeon_attack | 3.78 | 7.62 | 3.90 | 7.83 | 1.033 |
| dungeon_support | 2.06 | 4.78 | 2.18 | 5.13 | 1.058 |
| dungeon_enemy_turn | 0.55 | 1.14 | 0.52 | 0.96 | 0.937 |
| dungeon_auto_rounds (10 rounds) | 9.16 | 15.64 | 9.33 | 16.20 | 1.018 |
| dungeon_finish_room | 16.19 | 21.33 | 17.92 | 30.48 | 1.106 |
| dungeon_pass_turn | 1.00 | 1.71 | 1.31 | 1.57 | 1.309 |

The noise reaches 1.31 on the two fastest and the slowest calls (a machine with other sessions on it). Read a failing ratio of a call below 2 ms or of `hunt_autopick` again before you act on it. Earlier runs the same day gave 0.81 to 1.15 for the same text.

## Cards that cannot be pulled (2026-10-14)

A card that is in no pullable set's draw pool (the view `draw_pool`: Event and Promo cards such as the two Launch Day cards, and cards of a set that is not
pullable) gets its own report section "Cards that cannot be pulled". The Lab still measures it, but it is never an attacker or support outlier, never in the
median and never in a reference squad. The test is the draw pool, not the rarity name.

## The Dungeon balance tool (2026-10-14)

```
LAB_LOCK_OWNER=<name> LOCALDB=1 node scripts/dungeon-balance.mjs [--options today,F1-medium,...] [--quick|--big] [--candidate file.sql]
```

It measures candidate values for the new member rules and the Guardian heal (`dungeon_new_player_balance.sql`, balance dungeon: `early_floors`, `early_hp`,
`early_atk`, `horde_min`, `horde_spread`, `fight_min`, `fight_spread`, `foe_heal_cap`). The options are in `scripts/dungeon-balance-options.json`
(`name`, `note`, `patch`: `[key, "{path}", json]`). Each request is an undone block: the candidate migration, then the option's patch (through the real balance
triggers, so a value outside the limits is refused), then the fights. For squads of NORMAL cards (what a new member owns) at 0, 1 and 3 stars it reports the
win rate of one room by foe kind on floors 1 and 2, whole runs on generated days (floor reached, share that passes floor 1 and 2, Shards a run), the Guardian
fights on floors 1 to 5 (LOCK, LOOP, the heal as a share of the damage dealt) and the LOCK and LOOP counts. `--big` = 40 fights a cell, 90 runs a level,
60 Guardian fights a row (about 3 minutes for each option). The report goes to `out/dungeon-balance/report.md`.
Test of the migration: `scripts/test-dungeon-new-player-balance.mjs` (`MUTATE=all` plants 17 changes, each must make it fail).

## The element chart rule, "rule A" (F-3 PR 2b, 2026-10-14)

`f3_elements_beats.sql`: `elements_list()` (and `GET /api/elements`) returns `beats` and `beaten_by` for each element, from `element_counters` (approved pairs only).
`f3_element_bonus.sql`: the fight rule. The attacker's element beats the target's element = damage x `balance combat.element_bonus` (1 to 2).
The target's element beats the attacker's = x `element_penalty` (0.5 to 1). Both = both. Today's values are 1 and 1 (no change in play). Nathan picks the values after the Lab report.
- One place: `combat_element(att, def)` finds the pair and the multiplier. `combat_hit_elem` (`combat_hit` + the two elements) multiplies it into the weakness multiplier. `combat_hit` is not changed. The callers pass the two elements.
- Dungeon and Gauntlet: `dungeon_attack` calls `combat_hit_elem` and passes `card_element(card tags)` and the foe's `element`. The Hunt is NOT changed: a Hunt boss has no element (its weak points are tags).
- The answer: `elem` (`bonus`, `penalty` or `both`) and `elem_mult` are in the answer of `dungeon_attack` and in the `combat_actions` result of the attack, only when the chart changed the hit.
- It stacks with the weakness: a Dungeon foe already has the weak tag of its primary counter, so the primary pair gets the weakness and the bonus.
- Tests: `scripts/test-elements-beats.mjs`, `scripts/test-element-bonus.mjs` (both with `MUTATE=all`). Golden proof: `dungeon-golden.mjs` and `combat-golden.mjs` with the file as CANDIDATE match the live code; with the bonus at 1.25 the Dungeon golden shows a DIFF.
- Measuring tool: `LAB_LOCK_OWNER=<name> LOCALDB=1 node scripts/element-bonus-balance.mjs --candidate ../tcg-bot/supabase/f3_element_bonus.sql` (squad shapes stack, mixed, control and matched; whole runs).

### Auto picks by element (flag, ships OFF) and the bonus value (2026-10-14)

- Nathan approved `element_bonus` 1.25, no penalty (`f3_element_bonus_125.sql`, a data change with a self-check).
- `f3_auto_elements.sql`: `balance combat.auto_elements` (boolean, default false = today's rule exactly). When true, the Auto button of the Dungeon and the Gauntlet (`dungeon_auto_action`)
  picks first, among the ready attackers, the card whose element beats the target foe's element (`element_beats`), then today's order (weakness, CP, squad order). Test: `scripts/test-auto-elements.mjs`.
- Measured (`scripts/element-bonus-balance.mjs --candidate ..f3_element_bonus.sql,..f3_auto_elements.sql --options today,b125,b125-auto`, 40 days): bonus 1.25 raises the Shards of squads that
  cover the foes by 5 to 15 percent. The Auto pick by element adds nothing measurable (within noise), so the flag stays OFF.
