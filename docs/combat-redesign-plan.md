# Combat v2: the redesign plan (2026-10-18)

Status: **plan for review**. Docs only. No code, no SQL, no balance change.
Owner of the decisions: Nathan. Decisions of 2026-10-18 are encoded below. Section 15 lists what is still open.

This plan is built from these inputs:
- Private notes of 2026-10-18 (not in this repo): the combat audit, the combat research, the roles draft, the effect library,
  the 3-stat study, the 9-stat study, the simulator results and the simulator tuning pass.
- The simulator `card-studio/v2sim` in PR #436 (branch `feat/combat-v2-sim`, not merged). Its `config.json` holds every tuned number.
- Repo docs: [`f3-effect-engine.md`](f3-effect-engine.md), [`foundations.md`](foundations.md) (F-3), [`design.md`](design.md) (section 12),
  [`ui-register.md`](ui-register.md), [`combat-lab.md`](combat-lab.md). PR #435 (F-3 PR 4e and the 3 combat CI checks).

**How to read the numbers.** Each number has one mark:

| Mark | Meaning |
|---|---|
| **[D]** | Decided by Nathan (2026-10-18 unless another date is given) |
| **[T]** | Tuned in the simulator. An estimate from a simplified model. The Combat Lab must confirm it on the built functions |
| **[P]** | A proposal. Not tuned and not decided |
| **[L]** | A live fact (code or aggregate data on 2026-10-18) |

The simulator has no weakness, resist, element chart, squad synergy, block, boons or pranks. Every [T] number must pass the
real Lab again (section 10). No player data is in this file. Counts are aggregates only.

---

## 1. Goal and principles

**Goal.** One combat system ("combat v2") for the Gauntlet, the Dungeon and the Hunt. It is deeper, clearer and reusable
for later modes. Every card has a clear job. The squad mix decides the strategy. Every number is data.

**What changes for the player** [D]:
- Turn order comes from Speed (turn system B). The player sees who acts next.
- Supports are squad members. Enemies can hit them in every mode.
- Every card has a basic attack, a role passive and one unique active ability.
- 9 stats for every card. Points come from card levels (play), not from stars.
- 16 statuses with one rule each, in 6 families.

**Principles** (each one prevents a defect found in the audit):

| # | Principle | The defect it prevents [L] |
|---|---|---|
| P1 | No silver bullet. Enablers apply a status, payoffs profit from it. No card holds both halves at full strength | Today rampage and shield win every Lab table. 5 shields give x3.5 |
| P2 | One rule, written once, for each status and each stat. Same rule on both sides (cards and enemies) | Today two affinity rules share one field. Card "Curse" and enemy "weaken" are two words for one idea |
| P3 | Every number in `balance`. No combat math in JS. No effect-name branch outside `combat_effect*` | The 3 CI checks of PR #435 (C1, C2, C3) enforce this. v2 keeps them |
| P4 | Fair for players without high rarities. Every role works at Normal rarity | Today a Gold 0-star card has x14 the CP of a Normal 0-star card |
| P5 | Readable in one Discord window. Card text 6-20 words (Nathan 2026-10-20; was 8-14). Max 3 status icons on a unit, then "+N" | Most synergy rules are hidden today. Support texts show no number |
| P6 | Flag OFF = today, exactly. v2 is built beside v1 and goes live mode by mode | The fight flow changes, so today's goldens cannot prove v2. They prove v1 stays the same |
| P7 | Live progress keeps its value. Nobody loses stars or points without a refund | 1,443 ascended rows and 2,486 spent points exist [L] |

---

## 2. The model

### 2.1 Class, role and card structure [D]

- **2 classes.** Attacker and support. The card type decides the class (only Character and Creature attack) [L].
- **12 roles.** 6 attacker roles (Breaker, Striker, Flurry, Finisher, Survivor, Cleaver) and 6 support roles (Warden, Medic,
  Controller, Spotter, Herald, Artillery). The role is a **designer-set tag** (`role:<key>`). It is not derived from the ability.
- **Every card has three parts:**

| Part | What it is | Where the text is |
|---|---|---|
| Basic attack | A plain hit. Supports hit for 0.18 x CP [T] (Artillery 0.25 x CP [T]) | No text. The same for every card |
| Role passive | Always on. The same for every card of the role | The role icon. A tap shows one line |
| Unique active | The card's own ability. It charges over the card's own turns | The only card text: name + 6 to 20 words (Nathan 2026-10-20; was 8 to 14) |

- **Charge** [T]: the active is ready after 2 own turns that did not use it (attackers) or 1 own turn (supports).
  The charge starts at 0 in each fight (each Hunt day).
- **Rarity scales the numbers, not the blocks** [D]. Every subject has a 10 PP budget (section 5). Attackers scale through CP.
  Supports scale their amounts by `F = (CP_base / 25) ^ 0.1` [T]. Enablers get +1 stack at Full Art, Event and Gold [P].

### 2.2 The 9 stats [D list, T values]

Every card, attacker or support, has the same stat line. Points: max 10 in one stat, 30 at level 30.

| # | Stat | Per point | Cap | Formula | Future key |
|---|---|---|---|---|---|
| 1 | Attack (ATK) | +3 CP, flat [D flat, T value] | 10 points | `CP = CP_base + 3 x ATK` | `v2_stats.atk.flat` |
| 2 | Defense (DEF) | -3% damage taken [T] | 30% [T] | `taken = raw x (1 - DEF x (1 - pierce))` | `v2_stats.def` |
| 3 | HP | +8 HP, flat [D flat, T value] | 10 points | `HP = 50 + 1.5 x CP_base + 8 x HP` [T] | `v2_stats.hp`, `v2_card_hp` |
| 4 | Crit Damage (CRD) | +0.10 [T] | 10 points | `crit x = 2.0 + 0.10 x CRD` | `v2_stats.crd` |
| 5 | Crit % (CRT) | +4% [T] | 60% total [D loose cap, T value] | `crit = min(0.60, 0.10 + adds + 0.04 x CRT)` | `v2_stats.crt` |
| 6 | Ability (ABL) | +5% to the active's amounts [T, was 8%] | 10 points, then the effect caps | `amount x (1 + 0.05 x ABL)` | `v2_stats.abl` |
| 7 | Dodge (DDG) | +3% [T] | 30% [D loose cap, T value] | single hits `0.03 x DDG x (1 - keen)`. Area hits: half | `v2_stats.ddg` |
| 8 | Accuracy (ACC) | -2% own miss, -2% enemy resolve [T] | useful until 0% miss | `miss = max(0, 0.08 + evasion + blind - 0.02 x ACC)` | `v2_stats.acc`, `v2_hit` |
| 9 | Speed (SPD) | +3% speed [T] | x1.30 from points. x1.6 total with statuses [D loose cap, T value] | `speed = role base x (1 + 0.03 x SPD) x statuses` | `v2_stats.spd`, `v2_speed` |

Why flat Attack and HP [D]: with percent points the Gold / Normal ratio never changes. With flat points the ratio falls as
points grow. Full build, both 5 stars: Gold / Normal power x7.1 (percent) vs x4.7 (flat), before the catch-up dial.

**Stat counters** [D] (each counter lives in a role passive, an ability block or an enemy passive, never in a new stat):

| Stat | Its counter | Where |
|---|---|---|
| Defense | Pierce (ignores a share of Defense) | Breaker passive (30% [T]), Pierce blocks. Enemy side: Sunder |
| Dodge | True strike (cannot be dodged or miss) | Artillery passive, True Aim block, Mark. Enemy side: True Strike passive |
| Healing | Anti-heal: Burn halves heals | Burn status. Enemy side: Regrowth vs Burn |
| Speed | Slowed and Chill | Controller and Warden blocks. Enemy side: Slowing, Frost Aura |
| Shields | Shield break (x1.5 to x3 vs shields) | Breaker passive and Shield Bash. Enemy side: Shatter |
| Crit | Ironhide (no crit unless Marked) | Enemy passive. Mark answers it |

### 2.3 Ascension ASC-3 [D]

Stars give a multiplier only. Stars give no stat points. Tier names: 1 Normal, 2 Bronze, 3 Silver, 4 Gold, 5 Crown.

`CP = base[r] x (1 + (top[r] / base[r] - 1) x w[stars]) x cp_mod`, `w = 0, 0.286, 0.500, 0.678, 0.857, 1.000` [T].
Every 5-star value equals today's 5-star value. The 0-star base of the low rarities rises.

| Rarity | 0* | 1* Normal | 2* Bronze | 3* Silver | 4* Gold | 5* Crown | Today's 0* / 5* [L] |
|---|---|---|---|---|---|---|---|
| Normal, Promo | 25 | 39.3 | 50.0 | 58.9 | 67.8 | 75 | 10 / 75 |
| Illustrated Rare | 40 | 68.6 | 90.0 | 108 | 126 | 140 | 20 / 140 |
| Secret Rare | 60 | 82.9 | 100 | 114 | 129 | 140 | 40 / 140 |
| Full Art, Event | 100 | 125 | 144 | 159 | 175 | 187.5 | 75 / 187.5 |
| Gold | 149.3 | 171 | 187 | 200 | 213 | 224 | 140 / 224 |

- No live row loses CP or HP. The start gap Gold 0* / Normal 0* falls from x14 to x6.0.
- The mean live CP rises about x1.71 [I from the 9-stat study]. The Lab must set the boss HP and the foe growth again.
- Future keys: `v2_asc.base`, `v2_asc.top`, `v2_asc.curve`, `v2_asc.alias` (Promo = Normal, Event = Full Art).

### 2.4 Card levels and the catch-up dial [D source, T values]

- A card gets XP for each fight-day in which it acts or is hit: 10 XP for a Hunt day or a Dungeon run [P]. The Gauntlet gives no XP
  (its cards are not the player's cards) [L].
- Level L to L+1 costs `5 + L` XP [P]. Max level 30 = 585 XP = about 58 fight-days. 1 point a level, the same for every rarity [T].
- Time to level 10: about 1.5 weeks (active) or 4.8 weeks (casual). Level 30: about 9 or 29 weeks [P, from today's activity].
- Catch-up XP [P]: a card below the mean level of the player's top 8 gets x2 XP, so a new pull can catch up.
- **Catch-up dial D** [D dial, T value 0.22]: `CP' = CP + D x (level / 30) x (260 - CP)`. HP and the support factor use `CP'`.
  D = 0 turns it off. D 0.22 gives the decided end gap (x2.14 Hunt damage, section 10).
- Future keys: `v2_level.max_level`, `points_per_level`, `converge_d`, `target_cp`, and a new `card_level` key for the XP rules.

### 2.5 The power number [D role-weighted, T formula]

The card shows one Power number. It is calculated in SQL, never in the client (CI check C3).

```
Offense (attacker) = CP x (1 + crit x (critdmg - 1)) x hit chance x speed x (1 + 0.25 x (ABL - 1))
Offense (support)  = (basic hit + 25 x F x ABL) x (1 + crit x (critdmg - 1)) x speed
Survival           = HP / (1 - DEF) / (1 - 0.7 x DDG)
Power              = Offense x Survival x k[role]
```

- `k[role]` = simulated strength / analytic value of the role's reference card. One number per role in `balance` (`v2_power.k`) [T].
- Rank correlation with simulated strength (Spearman, 144 random cards): 0.82 overall, 0.97 attackers, 0.68 supports [T].
  Naive CP x HP: 0.51 [T].
- Today k is 0.87 (Medic) to 1.44 (Artillery) [T]. The support Offense term does not count smite, Poison or control.
  The fix is formula work, not balance work (decision 3, section 15).
- Refit k after each balance change (a Lab step, section 10).
- Built in E9 (20.6): the support Offense counts the PP of its smite, dot (Poison, Burn) and control blocks x `v2_power.value`; k with that formula is
  0.94 to 1.10 (stored), Spearman 0.876 overall, 0.980 attackers, 0.782 supports (Hunt). SQL: `card_power_v2`, `combat_v2_squad_value`.

---

## 3. Turn system B [D]

### 3.1 How it works

- A hidden clock runs in **steps**. Each step, every standing unit adds its speed to its meter. A unit at 100 acts and loses 100.
- Speed 100 = one action a step. Enemies have speed 100 (Hunt boss) or 45 to 55 (Dungeon foes) [T].
- Card base speed comes from the role [T]: Breaker 16, Striker 17, Flurry 18, Finisher 17, Survivor 15, Cleaver 15,
  Warden 24, Medic 24, Controller 20, Spotter 23, Herald 24, Artillery 20. A card acts about once in 4 to 7 steps.
- Ties at the same step: a fixed order (higher meter first, then squad order). No random draw [P], so goldens stay stable.
- Max 4 actions of one unit in one step (`v2_speed.max_actions_per_step`) [T]. Status speed limits: x0.4 to x1.6 [T].
- **Speed replaces cooldowns** [D]. The v2 path has no `combat_cooldown`. One-support-a-round goes away.
- Durations count clock steps. Statuses on cards last longer than on enemies (cards act less often): `dur` and `dur_card` [T].
- Damage statuses tick at the end of each step [T]. A tick draws no random number.

### 3.2 What the player sees

- A **turn-order strip** across the full width: as many projected actors (cards and enemies) as fit, 10 at 430 px, 33 at 1280 px,
  52 at 1990 px (UI-67, Nathan 2026-10-19). The projection draws no random number. When a speed or control status changes the order,
  the chips redraw in place. Enemy turns and the turn on which a card's active is charged are marked. The clock itself stays hidden.
- On a card's turn: the basic attack, or the active when it is charged, and the target (an ally for most supports). Auto plays for the player.
- A charge mark on each card (for example 2 pips). The "Charging" warning before a Cataclysm stays.
- Status icons on every unit (section 6). One line on tap.
- The steps left today (Hunt) or in the fight (Dungeon), shown as "turns left".

### 3.3 Mode specifics

| Item | Hunt | Dungeon | Gauntlet |
|---|---|---|---|
| Squad | 8 cards a day [L] | 5 cards, budget 12 [L] | the weekly squad: 3 attackers + 2 supports, 0 stars, level 0 [L] |
| Enemy | one boss, shared HP, a private boss state for each player [L] | 1 to 5 foes a room [L] | the same as the Dungeon |
| Enemy speed | 100. Mythic 110 with ATK x0.91 [T] | fight 50, horde 55, elite 50, miniboss 48, guardian 45 [T] | the same as the Dungeon |
| Cap | **40 steps a day** [T] | 40 steps a fight [T] | 40 steps a fight |
| Actions | the cap counts steps, not card actions [T]. A 6A+2S squad with all cards up gets about 55 to 60 card actions a day [P, inferred from the base speeds] | about one card action for each foe action [T] | the same |
| Who enemies hit | any standing card. Warden weight x2 [T] | the same | the same |
| Supports | targetable squad members (supports have HP in v2) | the same (today they are never hit [L]) | the same |
| Calls | one call does the card action, then runs the clock to the next player choice | the same. Auto and Finish Room run the clock | the same |
| Progress | XP, level points, stars | XP, level points, stars | none: base values only. Stays equal for everyone [L] |

Why the cap counts steps and not card actions [T]: then Speed gives more actions inside a fixed cap, and the Speed cap limits it.
A cap in card actions would make Speed worth 0 in the Hunt.

**Hunt specifics.** The boss row stays locked `FOR UPDATE` [L]. One call resolves one card action and the boss turns before the next
player choice, so the lock time per call stays near today's. The Cataclysm comes every 8th boss turn after one "Charging" turn [L].
Stun or Frozen on the Charging turn cancels it [P, Lab check].

---

## 4. The 12 roles

Role passives and base speeds are [T] values from `v2_roles` and `v2_speed`. Stat priorities are the top 3 measured marginal values [T].
Every role value is within 0.87 to 1.11 of the mean of the 12 roles after tuning [T].

### 4.1 Attacker roles

| Role | Purpose | Role passive | Enemy problems it answers | Stat priority |
|---|---|---|---|---|
| Breaker | Hit through defenses | Hits ignore 30% of Defense and deal x1.5 to shields | Defense, foe Guard, Armored, Bulwark, shields | ATK, CRT, HP |
| Striker | Turn a weak point into a big hit | +8% crit chance and +0.2 crit damage | weak points, big HP (Guardian, boss), Dispeller (crit is not empower) | ATK, HP, CRT |
| Flurry | Steady damage that outruns heals | Each basic attack has a 20% chance of a second strike at 50% | boss heals, Regrowth, foe drain and regenerate, Guard | HP, ATK, SPD |
| Finisher | End a fight before the enemy grows | +40% damage to a target below 30% HP | Frenzied, rage below 50%, phase 2, late boss heals | ATK, HP, CRT |
| Survivor | Stay up vs enemies that hurt attackers | Heals 15% of the damage it deals (max 8% of its max HP a hit) | Thorns, Flaming, Plague, support counters (Ban-Wave) | ATK, SPD, CRT |
| Cleaver | Hit many foes | Basic attacks also hit every other foe for 60%. Hunt: +10% damage, an area active adds 20% of its area value | horde and Swarm rooms. Hunt: Brood (later) | ATK, HP, SPD |

### 4.2 Support roles

| Role | Purpose | Role passive | Enemy problems it answers | Stat priority |
|---|---|---|---|---|
| Warden | Absorb the big hits | Allies take 8% less damage while it stands. Enemies pick it twice as often | Cataclysm, Volatile, Enraged, heavy hits, hits on supports | HP, SPD, ABL |
| Medic | Undo damage and clear statuses | After each of its actions, heals the most hurt ally for 5% of its max HP | Curse (now Weakened), Poison, Burn, Venom, Thorns damage | SPD, DDG, ATK |
| Controller | Make the enemy weaker or slower | Its debuffs ignore 50% of enemy resolve and last 1 step longer | Enraged, rage, Volatile, Cataclysm (stun on Charging), fast foes | SPD, HP, DEF |
| Spotter | Make the enemy take more from everyone | Its basic attack Exposes the target 15% for 2 steps | resist weeks, big HP, heals, Shrouded (Mark) | SPD, ABL, CRT |
| Herald | Make the right attacker hit much harder | Its basic attack also Empowers the strongest attacker +15% | weak points, Armored and resist weeks, few support plays | ABL, SPD, HP |
| Artillery | Damage with no attack roll | Its basic attack deals 25% (not 18%) and cannot miss | Shrouded, Dodge-type foes, Thorns (it does not attack), hordes | ABL, HP, SPD |

**Notes.**
- Medic, Controller and Spotter stay the lowest roles (0.87 to 0.92) [T]. The Lab watches them first.
- Speed is the best single stat for 1 of 8 measured roles (the Controller) [T]. Against a Slow/Chill boss: 3 of 8 [T].
- Card counts per role are not fixed yet. Section 12 assigns a role to every card. The placeholder map of the simulator has
  10 to 18 cards a role in Set 1 [T].

---

## 5. Abilities

### 5.1 The block library

An active is a short list of **blocks**. Each block has a price in power points (PP). The block library is the menu of the studio builder.

| Group | What it does | Examples (block code: text) |
|---|---|---|
| Main | The core of the active. One per card | `hit` (x CP), `strikes` (N hits), `area`, `smite`, `shield`, `shield_all`, `heal`, `empower`, `rally`, `quicken`, `focus`, `apply <status>`, `dispel`, `consume` |
| Rider | A chance add-on after the hit | "X% chance to Poison 1", "a crit Stuns (50%)", "a crit Marks" |
| Condition | When a block works | target below T HP, target has [status], this card has [status], N+ squad cards with a tag or role, Hunt only / Dungeon only, enemy is Charging |
| Payoff | A bonus vs or with a status that another card makes | "+X% damage vs Poisoned", "+X% crit vs Poisoned", "Stunned, Frozen, Asleep or Marked count as low HP", "x2 vs Frozen" |
| Scaler | A bonus that grows | "+X% per Chill stack", "+X% per different status", "+X% per living foe", "+damage = Y% of own shield" |

Card text limits: at most 1 rider [D, 5.3], at most 8 blocks (engine steps) [L limit], text 6 to 20 words [D Nathan 2026-10-20, the card text style; was 8 to 14].
"1 main block" and "at most 1 condition" stay proposals [P]: the approved support actives have up to 4 main blocks, so the validator (E6) checks ONE main hit
for an attacker only.

### 5.2 PP costs and the budget

- **1 PP = +2.5% of the card's expected damage per own turn** [T]. The basic attack and the role passive are free.
- An attacker active that fires once per cycle of C own turns and adds V basic hits costs `40 x V / C` PP [T].
- Support mains use the library prices at a cycle of 2 (`x 2 / C`) [T].
- **Budget: 10 PP for every subject, tolerance +/- 0.6** [D 10 PP, T tolerance]. The ability belongs to the subject. One subject has 1 to 5 finishes [L].
- Payoff price = raw price x 0.6 [T]. A condition on HP = raw price x the share of attacks where it is true [P].
- **Floor rule** [P]: with no partner, an attacker still deals at least 80% of its expected damage. A support needs an unconditional
  main of at least 6 PP.

Tuned prices (`v2_pp`) [T]:

| Status application (`status_pp`, PP per 1.0 of value or per stack) | PP | Support main (`support_pp`) | PP |
|---|---|---|---|
| Poison, per stack | 4 | Shield, per 1.0 x max HP | 25 |
| Burn, per stack | 1.5 | Shield all allies (P1 price, was 75) [D Nathan 2026-10-18] | 100 |
| Chill, per stack | 2 | Heal, per 1.0 x max HP | 16.7 |
| Mark, per 1.0 | 16 | Heal all allies | 60 |
| Exposed, per 1.0 | 25 | Empower, per 1.0 | 20 |
| Weakened, per 1.0 | 23.3 | Rally (all allies), per 1.0 | 50 |
| Stunned or Frozen | 8 | Quicken | 13.3 |
| Sleep, Paralyzed | 5 | Focus (crit), per 1.0 | 20 |
| Blinded, Slowed | 3 | Smite, per 1.0 x CP | 5 |
| Confused | 4 | Cleanse, Dispel, Consume | 4 each |

42 placeholder templates (3 to 7 a role) all fit 10 +/- 0.6 PP, and every template is within x0.85 to x1.19 of its role mean [T].
They are placeholders. Each real card gets its own ability in section 12.

### 5.3 The Silver upgrade [D one rule for all cards]

- At 3 stars (Silver) the active is upgraded. It is not a second ability and not a second button [L, foundations F-3 item 10].
- One rule for every card [D]: **+3 PP** at Silver.
- **The Silver upgrade types [D Nathan 2026-10-20, "Silver: yes"].** A measured sample of 12 cards (v2sim, 2 cards for each type, private notes)
  compared each type with the "+number" Silver at the same +3 PP. In line = x0.67 to x1.5 of the "+number" value.

  | Type | Decision | Reason (measured) |
  |---|---|---|
  | 1. A stronger number (+3 PP on the main number) | **KEEP, the default** for most cards | The reference. Simple text. No new engine part |
  | 2. More rider chance | **CUT** | A crit rider cannot hold 3 PP. The cards that can hold 3 PP measured x1.0 at best, below x0.7 in most contents |
  | 3. A new small rider | **PILOT, supports only** (for example a sure Slow or Blind) | In line in Dungeon runs and hordes, too strong against one big enemy |
  | 4. One more stack | **PILOT, supports only** (for example +1 Burn). **Never an extra Poison stack on an attacker** | In line in most contents, x4 to x5 against a guardian |
  | 5. One more target (a second ally) | **DEFERRED** | x2 to x9 even at half the amount. It needs a "second ally" target rule with a measured price first |
  | 6. Faster charge or starts charged | **CUT** | "1 turn faster" costs +5 to +10 PP. "Starts charged" changes from x0.7 to x10.8 with the fight length |

- Before the pilot of types 3 and 4, measure a guardian price factor for Burn and Poison stacks [D Nathan 2026-10-20].
  The ticks are a share of the foe max HP (6.1), so the fixed `status_pp` price is too low against a big-HP guardian.
- Type 3 makes the Silver add a block, not only change a number. The validator keeps the limit of 1 rider (5.1).
- The validator accepts 13 PP at Silver for this rule only. The card shows the Silver line greyed out until 3 stars.
- The Gauntlet never has the upgrade (0 stars) [L].
- This rule removes the old conflict "stun +1 round vs the stun limit 1" (it changes a chance or an amount, never a control duration).
- Today only 26 card rows are at 3 stars or more [L].

### 5.4 The validator

`ability_kinds` and `ability_ok()` exist and check every live ability today [L]. v2 extends them:
- Every block row has its PP price (`ability_kinds.power`, the column exists [L]) and its allowed roles.
- A v2 ability passes only when: the sum is 10 +/- 0.6 PP (13 at Silver), the blocks fit the role, the limits of 5.1 hold,
  every status and trigger is built, and the text has 6 to 20 words (E6: the numbers are in balance ability_v2).
- The card text is **generated from the blocks** (one text pattern per block), so the text always matches the data.
- `enables[]` and `pays[]` are derived from the blocks (apply steps vs `target_has` conditions). Auto and the "Makes / Uses" chips read them.
- A planted bad ability (over budget, wrong role, reserved part) must be refused (acceptance test).

---

## 6. Statuses

### 6.1 The 16 statuses and 6 families [D list, T values]

Durations are clock steps: enemy / card [T]. "Ref HP" = the foe max HP in the Dungeon, `v2_status.hunt_ref_hp` 700 in the Hunt [T].

| Family | Status | One-line rule | Stacking | Duration | Icon idea [P] |
|---|---|---|---|---|---|
| Damage over time | Poison | Each stack ticks 2% of ref HP at step end. The 3rd stack bursts for 12% of ref HP, then Poison resets. Ignores shields | adds | 4 / 8 | skull drop |
| | Burn | Each stack ticks 1.5 x the Poison tick, then loses 1 stack. A Burning unit heals half. x1.5 vs a healer. Ignores shields | adds, max 5, decays 1 a step | until 0 | flame |
| Control | Stunned | Skips its next action | no stacks | 1 action | spiral |
| | Frozen (the end state of Chill) | Skips its next action. Shares the one control immunity | no stacks | 1 action | ice block |
| | Sleep | Skips actions until it takes damage | no stacks | 3 / 10 | moon |
| | Paralyzed | Each action fails 50% (electric sources) | no stacks | 3 / 10 | bolt |
| Accuracy | Blinded | +25% miss chance | no stacks | 2 / 8 | closed eye |
| | Confused | 30% of its single attacks hit a wrong target | no stacks | 2 / 8 | swirl |
| Tempo | Slowed | Speed x0.7 | no stacks | 3 / 10 | snail |
| | Chill | Each Chill stack: -8% damage and -8% speed. At 3 stacks: Frozen, then Chill clears. No control immunity while it stacks | adds, max 3 | 3 / 10 | snowflake |
| Vulnerability | Exposed | Takes +X% damage from every source, ticks included | adds, cap +100% | 2 / 8 | cracked eye |
| | Weakened | Deals X% less damage. Replaces the card "Curse" | adds, cap 60% | 2 / 10 | down arrow |
| | Mark | The next attack on it deals +X%, cannot miss, and can crit an Ironhide enemy. Then it ends | the higher X stays | 4, or 1 attack | target |
| Boons | Shielded | Absorbs damage before HP | adds, cap 1.0 x max HP | until used | shield |
| | Empowered | The next attack deals +X% | the higher X stays [P] | 1 attack | up arrow |
| | Focused | +crit chance | no stacks | 10 | crosshair |
| | Quickened | Speed x1.3 | no stacks | 3 / 10 | rabbit |

Quickened is a Boon (Nathan 2026-10-19, UI-67): every Boons status is good for its holder. The approved icons are in UI-67
(the icon ideas above are the first proposals). Chill and Frozen count as one status of the 16 (Frozen is the end state of Chill). Chill is Tempo: a
slow that stacks freely and starts no control immunity. Only Frozen is Control: it starts the one shared control immunity [D Nathan 2026-10-18].
Two enemy states are also shown with an icon:
**Guarded** (a foe shield) and **Enraged** (x1.4 for 2 steps) [L].

### 6.2 Shared rules

- **One control immunity** [D]: Stunned, Frozen, Sleep and Paralyzed share one immunity. It starts when a control status ends.
  Immunity: 2 steps on foes, 8 steps on cards [T].
- **Hunt boss** [D]: control lasts at most 1 step, then an immunity of 2 steps (was 3). Proof: with all 4 controls tried every step,
  the boss loses at most 1 action in 3 (bound 1 / (1 + immunity)) [T]. A Lockdown squad skips 11.7% of the boss turns [T].
- **Resolve and Accuracy**: a debuff fails with the enemy's resolve (Heroic 10%, Mythic 20%, elite 10%, guardian 20% [T]).
  Each ACC point removes 2%. The Controller passive ignores half.
- **Order**: ticks at step end, in a fixed status order. A rider draws its random number after every draw of the hit (miss, crit,
  block, roll, extra strike) [L rule of the F-3 engine], so old random orders stay.
- **Display**: max 3 icons on a unit, then "+N". Fixed slots, so nothing moves on a status change [L design rule].
- Every number goes under `v2_status.<name>` and `v2_control` [T keys].

---

## 7. Synergies and tags

### 7.1 Two levels of tags [D]

| Level | Tags | Used by | Shown |
|---|---|---|---|
| Rule tags | role, element, family (origin), set | fight rules: role passives, the affinity rule, weak points, element chart, set synergy, Auto answers | on the card face as icons |
| Label tags | kind traits (humanoid, beast, royal ...), genre, realm, type, class, object, location | search and filters only. Never a fight rule | in the card detail |

- One exception to fix: `trait:melee` drives Armored today [L]. Plan: Armored becomes "takes 28% less from attacks without Pierce" [P],
  so the rule reads a role and a block, not a label tag.
- Weak points draw only from rule tags [P], so the player sees every weak point on the card face.
- The trait synergy goes away [P]. It is hidden today and doubles `trait:community` with `origin:community` [L].

### 7.2 One visible affinity rule [D]

- One rule for every support: **"+X% for each squad card of this card's element or family"**, shown as "Fire 3: +45%" [D rule, P numbers].
- The `matched_x` rule (x1.8 on a matched target) goes away. Keys `support.affinity_step` and `support.affinity_cap` stay [P].
- The affinity tag must be a rule tag. A tag with no attacker that carries it (today: ice) cannot be an affinity [L defect].

### 7.3 The element chart

- One source: `element_counters` (19 pairs) [L]. Today the foe weak tag and the chart double count in the Dungeon (x1.5 and x1.25) [L].
- Plan [P]: the chart gives the element bonus. A foe's weak tags come from the other rule tags, not from its counter element.
- Element synergy (3 / 5 cards of one element) stays and shows its % in the squad picker.
- Element riders: fire attackers lean Burn, water and ice lean Chill, lightning leans Paralyzed, toxic leans Poison [P design guide, not a rule].
- The simulator has no element chart. The Lab must measure it (section 10).

### 7.4 Status synergy webs (archetypes)

Each web needs at least 2 cards: one makes the status, one profits. [T] = the Hunt value vs the median archetype after tuning.

| Archetype | Makers | Users | Good vs | Countered by | Hunt [T] |
|---|---|---|---|---|---|
| Toxic | Controller (Envenom), Flurry and Breaker Poison riders | Striker "vs Poisoned", Finisher "Poisoned counts as low" | Guard, Bulwark, big HP | Purify, Toxic-born | x0.83 |
| Wildfire | Artillery (Ignite), fire riders, Cleaver spread | Artillery (Detonate), Herald, Finisher | healing bosses, Regrowth | Fireborn, Purify | x1.02 |
| Shatter | Controller (Cold Snap), Warden (Ice Fortress), Chill riders | Breaker (Shatter), Artillery "x2 vs Frozen" | Volatile, Enraged, Cataclysm | Frostborn, Unstoppable | x1.35 |
| Mark and Hunt | Spotter (Mark), Striker "a crit Marks" | Finisher, Flurry, Striker | Shrouded, Ironhide | Elusive | x0.98 |
| Wall | Warden, Survivor (Guard Up) | Survivor "while Shielded", Breaker (Shield Bash) | Volatile, Sunder, Thorns | Shatter, Venom | x1.02 |
| Crit Chain | Herald (Focus), Spotter (Mark) | Striker riders, Flurry | Dispeller, short rooms | Ironhide | x0.97 |
| Cleave | Spotter, Controller, Artillery Burn | Cleaver | hordes, Swarm, Brood (later) | single big foes | x1.07 |
| Lockdown | Controller (Stun, Sleep, Paralyze) | Finisher, Breaker "vs Stunned" | Enraged, Frenzied | Unstoppable, Purify | x0.77 |
| Pile On | any 3 different makers | Finisher, Spotter "+per status kind" | Steadfast | Purify, Thick Hide | x1.16 |
| Herald's Court | Herald (Empower, Rally, Quicken) | Striker, Breaker | Armored, resist weeks | Dispeller | x0.74 |

No archetype is a silver bullet [T]: Shatter is above x1.30, but its counter boss cuts it to x0.73. Every counter boss cuts its
archetype (x0.63 to x0.93) [T].

### 7.5 Set synergy (Forbidden Pride) [L design, P values]

- A `slot = 'squad'` row (F-3 section 4): it counts distinct pieces of `trait:forbidden-pride` at 3 / 5 / 7. The top step is Hunt only
  (7 pieces fit only in an 8-card squad).
- The bonus goes to every squad attacker, as a separate factor (F-3 decisions 1 to 3, recommended). Values stay 1 until the Lab report.
- Every piece also gets a normal role and its own active (section 12). The set synergy is the set's reward, not a role.
- The set trait leaves the trait synergy (no double count).

---

## 8. Monsters [D monsters get new effects]

### 8.1 Today's passives in the new language

| Passive [L] | Rule today | v2 rule [P] | Archetype it favors |
|---|---|---|---|
| armored | melee x0.72 | takes 28% less from attacks without Pierce | Breaker |
| shrouded | +10% miss | +10% miss. Marked attacks never miss | Mark and Hunt, Artillery |
| flaming | 30%: attacker takes 0.4 ATK | 30%: the attacker gains Burn 2 | Medic, Wall |
| volatile | hits x1.25 | the same, shown as a permanent Enraged mark | Lockdown, Wall |
| regenerating | heals each turn | the same. Burn halves it | Wildfire |
| thorns | attacker takes 10% back | the same. Shields take it first | Wall, Artillery |
| frenzied | +5% per 10% HP lost | the same | Finisher, Lockdown |
| plague (counter) | heal x0.1 | heals x0.1. Card Poison cannot be cleansed | Wall, Survivor |
| shatterer (counter) | shield and smite x0.1 | shields x0.1, smite x0.1. Ticks are not smite | Toxic, Wildfire |
| dispeller (counter) | empower and expose x0.1 | Empowered and Exposed work at 10% | Toxic, Shatter |
| juggernaut (counter) | weaken x0.1, stun fails 90% | Weakened x0.1. Control fails 90% | Toxic, Wall |

### 8.2 New enemy passives (as data in `passives.params`)

In the simulator [T]: Purify (every 3rd action removes its negative statuses), Ironhide, True Strike, Shatter (x2 to shields),
Regrowth (1% of ref HP a step, x2 below half, Burn halves it), Frost Aura (single hits Chill 1), Thick Hide (Exposed cap 15%),
Unstoppable (control fails 90%), Venom (single hits Poison 1), Burning (single hits Burn 2), Sunder (ignores 50% of card Defense),
Slowing (area hits Slow), Elusive (Marks fall off at its turn), Toxic-born / Fireborn / Frostborn (immune to their status),
Steadfast (takes 40% less until it has 3 different negative statuses).

Later [P]: Bulwark (Guard every 2 turns), Mirror Hide (reflect second strikes and splash), Plaguebearer, Undying, Volatile Core,
Swarm (room kind), Brood (Hunt), Drenched (a rain move that clears Burn).

### 8.3 Dungeon foes (data rows in `dungeon_monsters.moves`) [P]

| Monster [L] | v2 change | New job it creates |
|---|---|---|
| golem | Elementborn from its element. More Guard | Breaker |
| ooze | Acid Spit = Poison on a card. Plaguebearer at elite | Medic |
| demon | Hellfire = Burn 2 on the hit card | Medic, Wall |
| yeti | Frost Punch = Chill 2 on the hit card | Medic, Warden |
| squid | Ink Blast = Weakened (the old Curse) | Medic |
| skeleton | Rattle = Sunder on the card | Warden |
| raptor | Pack: Swarm aura in hordes | Cleaver |
| slime | Regrowth at elite | Wildfire |
| zombie | Undying at miniboss | Toxic, Wildfire |
| giant | Volatile Core at elite | Lockdown |

Room kinds [P]: elite gets 1 passive, miniboss gets Charging + 1 passive, guardian gets 2 passives, one of them the counter of the day's
archetype. Today the Dungeon counters cut most archetypes by only 2% to 6% [T], so the guardian counter is the fix to measure.

### 8.4 The weekly Hunt boss template [P]

The boss card shows three lines, all icons with one-line tooltips:
1. **Weak to:** 1 to 3 rule tags (today's rule, rule tags only). Built (E7b, Nathan 2026-10-21): ONE role tag a boss (`hunt_bosses_v2.weak_to`), never Warden, Medic, Spotter or Herald, no element or family tag; the fight reads this tag (one source).
2. **Resists:** 0 to 2 tags and 1 immune status family (for example "Immune: Poison").
3. **Signature:** 1 passive (Mythic: 2 [T]) that counters 1 archetype, and a **"Bring"** chip with 2 archetypes that it favors.

Rotation rule [P]: the countered archetype is not the same as in the last 2 weeks. The favored archetypes change each week. DEFERRED (Nathan 2026-10-21): built with the weekly Hunt spawn (R3), together with the Counters / Bring chips.
Today's 12 counter bosses keep their moves, renamed into the status families [L moves]. New counter bosses for the families with no
counter today [P]: a Poison-immune Purify boss, a Mirror Hide + Elusive boss, a Frostborn Frost Aura boss, a Regrowth + Undying boss,
a Steadfast boss. Names and art are Nathan's choice.

The Hunt boss has Defense 10 / 15 / 20%, evasion 0 / 4 / 8%, resolve 0 / 10 / 20%, keen 0 / 0 / 25% by tier [T].
HP and ATK stay live values until the Lab sets them again for ASC-3 [L].

---

## 9. Data model: how v2 maps onto the F-3 engine

Rule: v2 objects are **new objects beside v1**. Never change a v1 signature in place (F-3 trap 3). Flag OFF must give today's results as text.

### 9.1 Mapping table

| v2 part | Existing object [L] | v2 change [P] |
|---|---|---|
| Block library | `ability_kinds` (13 rows, `steps`, `fields`, `power`, `auto`) | New rows: one per block, with `power` = PP price, allowed roles, text pattern. Today's 13 rows stay for v1 |
| Card ability | `subjects.ability` (jsonb, checked by `ability_ok`) | New `subjects.ability_v2`: `{name, blocks[], silver}`. The v1 column stays until v1 retires |
| Role | none (the roles draft derived it from the kind) | New `roles` table: key, class, base speed, passive steps, icon, stat weights, `k`. The card holds tag `role:<key>` |
| Statuses | ad-hoc state keys (`ex`, `wk`, `st`, `enr`, shield, `psn`) | New `statuses` table: key, family, icon, stacking rule, negative flag, immunity group. Numbers in `balance v2_status` |
| Fight state | the one shape `{v, mode, round, squad, cards{}, enemies[], marks, facts{}, ext{}}` (Hunt `ext` column) | `v = 2`: plus `clock`, `meter` and `charge` per unit, `status{}` per unit. Old keys read as statuses (step E1) |
| Stats | `card_combat`, `card_cp_exact`, `card_max_hp`, `stat_points` | New `card_combat_v2`: 9 stats, ASC-3, level, dial D, role, speed, active. `card_combat` is shared: run the full suite |
| Levels | none | `player_cards`: `level`, `xp`, `points_v2` (jsonb). The old point columns stay for v1 |
| Turn meter | `round` in Hunt and Dungeon state, `cd_until_round` in `hunt_card_hp` | `combat_v2_advance(state)`: runs the clock to the next player choice. Meter columns replace cooldown columns in the v2 path |
| Triggers | built: `use`, `before_hit`, `on_hit`, `after_attack` | add `turn_start`, `step_end` (tick point), `on_crit`, `on_kill`. Later: `on_damage_taken`, `low_hp`, `ally_down` |
| Targets | `self`, `ally_target`, `enemy_target`, `all_allies` | add `all_enemies` (Hunt: the boss), `all_allies` for shield, heal and buff, `lowest_hp_ally` |
| Conditions and values | `target_hp_below`, `count_tag`, `mode_in`, ... | add `target_has {status, min}`, `self_has`, `chance`, `enemy_charging`, `foes_alive`. values `stacks:<status>`, `status_kinds`, `self:shield` |
| Enemy mechanics | `passives` (11), `balance boss_passives`, `boss_counters`, `settings.hunt_boss_moves` | new rows in `passives` with `params` (immune, purify, cap, aura). Move lists into data with numbers in `balance` |
| Log | `combat_actions` (round) | add `step` and an action index |
| Power number | `hunt_squad_value`, `card_powers` | `card_power_v2` in SQL (2.5). The client shows it only |

### 9.2 Balance keys to create

All from `card-studio/v2sim/config.json` (PR #436), each with a note, a fixed shape and limits (`balance_check_*`), logged in `balance_log`:
`v2_stats`, `v2_card_hp`, `v2_asc`, `v2_level`, `card_level` (XP rules), `v2_support`, `v2_speed`, `v2_charge`, `v2_hit`, `v2_roles`,
`v2_status`, `v2_control`, `v2_enemy` (tier stats and new mechanics), `v2_dungeon` (foe kinds, speeds, resolve), `v2_pp`, `v2_power` (k per role),
and the flag key `combat_v2` (section 14.2).

### 9.3 What stays from F-3

- `combat_effect` as the one place for effects, called once per trigger, VOLATILE. `before_hit` draws no random number.
- The state builders and the apply functions (`dungeon_effect_apply`, `hunt_effect_apply`): set or add values within limits, no combat math.
- The shadow test, the goldens with `setseed`, the Lab, `fight-timing.mjs` and the 1.10 rule.
- The 3 CI checks of PR #435 cover the v2 functions too: **C1** no combat number outside `balance`, **C2** no effect-name comparison
  outside `combat_effect*`, **C3** no combat math in `tcg-activity/src` or `tcg-bot/src`. The allowlists are a ratchet: v2 adds no entry.
- The F-3 traps list (section 5 of `f3-effect-engine.md`): SUPERSEDED files, wrappers, md5 guards, numeric scale, RLS and grants.

---

## 10. Fairness targets and the measurement

### 10.1 Targets [D targets, T results]

| # | Target | Goal | Simulator result after tuning |
|---|---|---|---|
| 1 | Hunt damage a day, Gold / Normal, fully built (5 stars, level 30) | x2.0 to x2.5 [D] | x2.14 [T] PASS |
| 1b | Dungeon depth, Gold vs Normal, fully built | Gold 2-3 floors deeper (decision 1) | x1.37 floors, +2.1 floors [T] |
| 2 | Normal squad, active (5 stars, level 30), clears Dungeon floor 5 | 70% of runs or more [D] | 95% [T] PASS |
| 2b | Normal squad, casual (2 stars, level 10), clears floor 3 | 70% or more [D] | 89% [T] PASS |
| 3 | Hunt shapes 6A+2S to 3A+5S within 15% of the best (casual and active) | x0.85 or more [D] | x0.87 and x0.87 [T] PASS |
| 3b | Dungeon shapes 5A to 2A+3S within 15% of the best | x0.85 or more [D] | x0.95 and x0.91 [T] PASS |
| 4 | Lockdown in the Hunt | about x0.76, no lock (decision 2) | x0.77, no lock [T] (decision 2, section 15) |
| 5 | Cleave in the Hunt (reduced bonus [D]) | x1.15 or less | x1.07 [T] PASS. Hordes: floor 7 wins 26% vs 19% [T] |
| 6 | Every role value | 0.85 to 1.15 of the mean | 0.87 to 1.11 [T] PASS |
| 7 | No silver bullet. every counter boss cuts its archetype. Speed best for at most 2 of 8 roles | all | all PASS [T] |

The simulator result: **20 PASS, 2 FAIL, 1 CHECK**, the same on seeds 1, 2 and 3 [T]. The 2 FAILs are the Dungeon floor ratio
(decision 1, section 15) and the role scale k (a formula item, decision 3). The CHECK is Lockdown (decision 2, section 15).

### 10.2 Step 1: the simulator (before any build)

```
node card-studio/v2sim/run.mjs targets --runs 400 --seed 1     # every target, about 10 s
node card-studio/v2sim/run.mjs all                              # the 7 experiments, about 35 s
node --test card-studio/v2sim/*.test.mjs                        # 121 tests, 9 planted faults
```

Each balance proposal in this plan runs `targets` first. A change that turns a PASS into a FAIL needs Nathan's decision.

### 10.3 Step 2: the real Combat Lab on the built functions

- New Lab sections for v2 (`--v2`): the same 7 targets, measured with the real SQL functions on the local copy, in undone blocks.
- The Lab adds what the simulator skips: weakness, resist, element chart, squad synergy, block, Forbidden Pride, boons in fights.
- New baselines for flag ON: new golden fights with `setseed`, recorded once per mode, and a new `fight-timing.mjs` BASE.
  Never compare a v2 call with a v1 BASE.
- **Flag OFF = today's goldens exactly**: `combat-golden.mjs`, `dungeon-golden.mjs`, `test-boss-counters-golden.mjs` and
  `test-effect-shadow.mjs` must give no difference with every v2 file applied and the flag OFF. This is the main invariant of every PR.
- Mutation rule: a mutation result counts only on a green baseline printed in the same run (`test-golden-mutations.mjs`, `lab-mutations.mjs`).
- After the Lab: refit `k[role]`, set the boss HP and the foe growth for ASC-3, and record each change in `balance_log`.

---

## 11. Migration of live progress [D principles, L counts, P method]

Live (aggregates, 2026-10-18): 1,443 ascended card rows (0 of them Full Art or Gold), 952 stat point rows with 2,486 points,
held by 13 players, and 215 open reset gifts that expire 2026-10-29 [L].

| Step | Rule | Result |
|---|---|---|
| 1. Stars | Keep every star. ASC-3 gives every rarity x star the same or more CP and HP | 0 rows lose CP [I] |
| 2. Level grant | Each card's level at go-live = max(3 x stars, the converted points below) | nobody loses a point |
| 3. Point conversion | Attack -> ATK x1, Vitality -> HP x1, Precision -> CRT x1.25, Potency -> ABL x1.5, Haste -> SPD x3.33, capped at 10 | 834 of 952 rows keep or gain value [I] |
| 4. Top-up | "New points = the smallest count that reaches the old value" | fixes the 2 attacker rows that lose value |
| 5. Refunds | Points above a cap of 10 become free points (21 rows). The 116 support Haste rows that lose play rate get their points back as free points | no fair ratio exists for a x2 cooldown step inside the Speed cap |
| 6. Old dead points | 40 points on attacker Support and Recharge become ABL and SPD, which work for attackers in v2 | a gain |
| 7. Free reset | One new `stat_reset_gifts` row per player at go-live, valid 30 days | every player can choose again |

**Timing** [P]: the progress switch (ASC-3, levels, 9 stats) goes live with the Dungeon v2 switch. Until the Hunt switches, the v1 Hunt
keeps reading the old point columns (frozen, no new spending). The refunds and the reset gifts run at the Hunt switch (decision 5, section 15).
A dry run on the local copy prints the before / after table of the 952 rows (aggregates only) before the live run.

---

## 12. Card-by-card work (Set 1, then Set 2) [D]

Scope: Set 1 has 130 subjects and Set 2 has 73 subjects in `card-studio/cards.json` (3 Set 2 subjects are already live) [L].
Every subject gets a role tag and its own unique active. Live cards change too [D].

### 12.1 The studio ability builder comes first

The batches need one tool, so that every proposal is valid data:
- In the card studio (local, admin only): pick the role, pick the blocks from the block library, fill the numbers.
- A live PP meter and the generated card text come from one SQL check on the local copy (`ability_v2_check`), not from JS math.
- It refuses what the validator refuses (5.4). It shows "Makes / Uses" chips and the Silver line.
- Output: a batch file of `ability_v2` rows. `push-abilities.mjs` pushes them later with a `--dry` diff of 0 after the push [L tool].

### 12.2 Batches

| Batch | Content | Size |
|---|---|---|
| S1-1 to S1-6 | Set 1 attackers, one attacker role a batch | about 10 to 18 cards each |
| S1-7 to S1-12 | Set 1 supports, one support role a batch | about 8 to 18 cards each |
| S2-1 to S2-4 | Set 2: attackers, supports, the Forbidden Pride pieces, the cards with an open role | about 15 to 20 cards each |

- Role mix rule [P]: fill the thin roles in Set 2 (Warden, Spotter, Artillery, Cleaver). Keep stun sources rare.
- Each batch also fixes the Set 2 class mismatches: 5 Items tagged attacker, 1 Creature and 1 Character tagged support [L] (decision 6, section 15).

### 12.3 The review format for Nathan

One table per batch, one row per card:

| Column | Content |
|---|---|
| Card | the card name and type |
| Role | the proposed role, and one line why (lore) |
| Active | name + card text (6 to 20 words), as the card will show it |
| Blocks | the block list with PP (sum 10 +/- 0.6) |
| Silver | the upgraded line |
| Makes / Uses | the statuses it enables and the statuses it pays off |
| Pairs with | 1 to 3 cards or roles |

Under the table: the role count of the batch, the enabler / payoff count per status (each status keyword needs about 8 makers and
2 users over the set [P research rule]), and the `targets` run of the simulator with the batch's real abilities.
Nathan answers per row: OK, or a change. The approved rows go into the batch file. Review files with card art stay in the private
design repo, never in this public repo.

---

## 13. Screens and designs [D designs after the plan is approved]

### 13.1 The visual language first

One design set before any screen: the **16 status icons**, the **12 role icons**, the **9 stat icons**, the 2 enemy state icons,
the charge pips, the turn-order chip, and the colors of the tick numbers. It extends UI-00 (the design system).
Every later screen uses only this set and the UI-00 tokens (gate G4 counts new literals).

### 13.2 Screens

New IDs are reserved at request time (the next free ID on `main` today is UI-67).

| Screen | Register | Change |
|---|---|---|
| Visual language: status, role and stat icons | new ID (extends UI-00) | new |
| Card face (role icon, active text, Silver line, Makes / Uses chips) | new ID | new card face layout (card-studio render) |
| Card panel and card detail | UI-08 | role, active, 9 stats, Power |
| Ascension and stat points | UI-10 | ASC-3 tiers, level bar, 9-stat grid (3 x 3), "MAX" |
| Hunt squad select | UI-17 | role chips, "Makes / Uses" line, boss "Bring" chips |
| Hunt battle | UI-18 | turn-order strip, charge pips, status slots, supports with HP |
| Hunt resting | UI-19 | turns left |
| Boss detail | UI-20 | Weak to / Resists / Signature / Bring |
| Dungeon lobby | UI-46 | role chips and Power |
| Dungeon fight | UI-47 | turn-order strip, status slots, supports as targets |
| Gauntlet | UI-52 | the same fight changes |
| Card picker | UI-64 | role filter |
| Help, explainers, walkthrough | UI-38, UI-39, UI-37 | new texts ("Each star gives 3 stat points" becomes false [L]). A Dungeon and Gauntlet explainer |
| Status tap line (one-line tooltip) | new ID | new |
| **Glossary** (roles, statuses by family, stats, keywords, element chart; role entries show example cards from the player's collection) | new ID | new [D Nathan 2026-10-18] |

### 13.2a The Glossary [D Nathan 2026-10-18]

v2 adds many words (12 roles, 16 statuses, 9 stats, keywords such as Pierce, True strike, Cleave). Players need one place to look them up.
- One Glossary screen with sections: roles (icon, purpose, role passive), statuses by family (icon, rule, stacking), stats (one line each),
  keywords, and the element chart (approved for the FAQ, UI-38 / UI-39).
- Tap a status icon or a keyword on a card or in a fight: its Glossary entry opens. The status tap line (above) is the short form.
- One source: the Glossary reads its texts and icons from the `roles` and `statuses` tables and the `balance` keys that the fights use.
  A number changed in `balance` shows in the Glossary with no other change. No text is written twice.
- A role entry can show example cards of that role from the player's own collection (the "Gallery" view).
- It needs a reserved ID and an approved design, after the visual language (13.1), because it shows every icon.

### 13.3 The process (`docs/design.md` section 12.3)

For each screen: a `ui` issue and a reserved ID, a pen.dev design from a capture of the current screen at the test sizes, a review set
in the private design repo, Nathan's recorded approval, then a build PR with the ID in the title, the gates G1 to G7, and an
approved-vs-built image for each size. One window, no scroll, no bleed, nothing moves on a status change. v2 screens are built
behind the same flag as their mode.

---

## 14. Build order

### 14.1 Phases and PRs

Each PR: a worktree from the latest `origin/main`, rehearsed on the local copy, the flag OFF invariant (10.3), the 3 CI checks,
`fight-timing.mjs` within 1.10 of the right BASE, and `test-all-local.mjs` against the main baseline.

| Phase | PR | Content | Proof | Risk |
|---|---|---|---|---|
| 0 | V0 | This plan. Nathan's decisions on section 15 | review | - |
| 1 | V1 | Flag `combat_v2` (OFF) and all v2 balance keys from `config.json`, with checks and notes | flag OFF goldens equal. shape checks refuse a bad key | Low |
| 1 | E1 | `statuses` table, `roles` table, fight state `v = 2` (clock, meter, charge, `status{}`), old keys read as statuses | shadow test equal. `fight_state_check` | Low |
| 2 | E2 | The turn meter: `combat_v2_advance` (pure), turn-order output | the simulator meter checks as SQL tests (speed 100, 50, 200, 17, slowed, quickened, cap) | Medium |
| 2 | E3 | Stats: `card_combat_v2` (9 stats, ASC-3, level, dial D), role passives | the simulator formula checks as SQL tests. full suite (shared function) | Medium |
| 2 | E4 | Hit core v2: Defense, Pierce, Dodge, Accuracy, crit damage, true strike, Ironhide, Mark | planted faults (Defense, Pierce) fail the tests on a green baseline | Medium |
| 3 | E5 | The 16 statuses, the step-end tick, families, control immunity, boss limit | the 64 status checks as SQL tests. no-lock bound. fuzz (HP in range) | Medium |
| 3 | E6 | Abilities: block rows with PP, `ability_v2_check`, charge, new conditions, triggers `on_crit` / `on_kill`, targets `all_enemies` / `all_allies` | planted bad abilities refused. rider draws after the hit (a mutation fails) | Medium |
| 3 | T1 | Studio ability builder (12.1) | it refuses what the validator refuses. push `--dry` diff 0 | Low |
| 3 | T1b | The T1 follow-up: the prices of Nathan's 6 decisions of 2026-10-20 (19.4) | SQL = the simulator. a planted fault for each decision fails the test on a green baseline | Low |
| 3 | T1c | The minimum share of a condition (19.5) | SQL = the simulator. planted faults fail the test on a green baseline | Low |
| 4 | E7 | Monsters: new passives as data, foe moves, the Hunt boss template, counter bosses | Lab: each passive x each archetype. boss counters golden for v1 unchanged | Medium |
| 4 | E7b | The E7 follow-up (20.2): monster tuning, the Weak to tags as one source | Lab before / after. SQL = the simulator. a planted fault for each change | Low |
| 4 | E7c | The second E7 follow-up (20.3): `weak_role_x` 0.5, the Warlord's own Ironhide | SQL = the simulator. a planted fault for each change | Low |
| 4 | E8 | Auto v2: Dungeon Auto plays each ready card. Hunt auto-pick with role answers and the pair score | Auto reaches 85% or more of a scripted best play | Medium |
| 4 | E9 | Power number `card_power_v2` and squad value in SQL. client shows it only | rank correlation report. C3 passes | Low |
| 5 | B1-B10 | Card batches (section 12), data only, pushed after each approval | validator passes every row. `targets` per batch | Low |
| 5 | M1 | Progress: levels, XP, migration script, refunds, reset gifts (dry run first) | before / after table: 0 rows lose value without a refund | High (live progress) |
| 6 | U0 | Visual language design, then each screen PR (section 13) | gates G1 to G7, approved-vs-built images | Medium |
| 7 | R1 | Gauntlet v2 ON | new goldens. Lab Gauntlet section. equal for all players | Low |
| 7 | R2 | Dungeon v2 ON (with M1) | Lab Dungeon targets 2, 3b. new goldens. timing | Medium |
| 7 | R3 | Hunt v2 ON (between two Hunts) | Lab Hunt targets 1, 3, 4, 5. boss lock time. timing | High |

E1 to E9 are the effect library's engine parts, re-cut for v2: the meter (E2) and stats (E3) come before statuses and abilities,
because every later part reads them.

### 14.2 Flags and go-live rules

- One flag key `combat_v2` in `balance` with one boolean per capability: `gauntlet`, `dungeon`, `hunt`, `progress`. Each defaults to OFF.
  A missing key or a read error = OFF (fails closed). One reader function, `combat_v2_on(mode)`.
- Order: Gauntlet, then Dungeon, then Hunt [D]. Each mode runs at least one full week before the next switch [P].
- Hunt switch: only between two Hunts (after the Monday close, before the Thursday spawn). Never on Thu 14-15 or Mon 16-17 MT [L rule].
- Migrations: rehearse with `rehearse-sql.mjs`, apply with `apply-sql.mjs --live` before the code that needs them, then
  `check-schema-drift.mjs --live` = 0 differences. Deploy with `ops/deploy.sh`.
- Rollback: set the mode's flag OFF. v1 code and data stay until v1 retires (a later cleanup PR after all three modes run on v2).
- Before Set 1 goes live: the two Combat Lab measurements of 19.5 (L1 the vs_status share with a control partner, L2 the area payoff share
  with the designed teams) [D Nathan 2026-10-20].

---

## 15. Decisions (Nathan, 2026-10-18: all 8 recommendations approved)

1. **Dungeon fairness target.** A x2 floor ratio is not possible together with a x2-2.5 Hunt gap: floors grow with the log of power.
   Measured: x1.38 floors, Gold 7.9 vs Normal 5.7 = +2.1 floors [T].
   **Decided (the recommendation):** restate the target as "Gold goes 2 to 3 floors deeper than Normal at the same investment".
2. **Lockdown in the Hunt at about x0.76 to x0.77 of the median.** More control value moves toward a boss lock (bound 1/3 of the boss turns).
   **Decided (the recommendation):** accept it. Lockdown is a Dungeon archetype (4 controllers skip 31.6% of a floor 5 guardian's turns [T]).
   Give the Hunt a "Stun on Charging cancels the Cataclysm" reward later.
3. **The Power formula must count smite, Poison and control.** Today k is 0.87 to 1.44 because the analytic support term misses them.
   **Decided (the recommendation):** add the smite, status and control value of the active to the Offense term in E9, then refit k (target 0.85-1.15).
4. **The Dungeon support cost** (you said "after the math"). With v2 a Gold support still costs 5 budget for support amounts only x1.1 to x1.2 of a Normal at the same stars [I from F].
   **Decided (the recommendation):** measure 3 squads at the same budget in the Lab (R2), then decide a separate support cost table.
5. **Progress timing.** The 9 stats and levels must exist when the Dungeon switches, but the v1 Hunt still uses the old points.
   **Decided (the recommendation):** freeze the old points for the v1 Hunt (no new spending), switch the progress with the Dungeon, and run the
   refunds and reset gifts at the Hunt switch.
6. **Set 2 class mismatches.** 5 Items are tagged attacker (they cannot attack) and 1 Creature + 1 Character are tagged support.
   **Decided (the recommendation):** the type decides the class. The Items become supports (the Airship-type card as Artillery). The Creature and
   the Character become attackers (Survivor), or you change their type.
7. **The family tag in Set 2.** 70 of 73 Set 2 subjects are `origin:community`, so the family synergy becomes automatic.
   **Decided (the recommendation):** split the family into 2 to 3 values by game, before the Set 2 batches.
8. **The Hunt daily cap unit.** **Decided (the recommendation):** keep 40 steps a day (not a number of card actions), so Speed keeps its value inside a fixed cap.

---

## 16. Risks and how the plan reduces them

| Risk | How the plan reduces it |
|---|---|
| v2 changes v1 by accident | New objects beside v1, no signature change in place, flag OFF = today's goldens and the shadow test in every PR |
| The simulator is wrong | Every [T] number passes the real Lab before go-live. The Lab adds what the simulator skips |
| Hunt calls get slower (shared boss row) | One call per player choice, a new timing BASE, the 1.10 rule, a Hunt switch only between Hunts |
| Live progress loses value | ASC-3 keeps every 5-star value. level grant, top-up, refunds and one free reset. a dry run first |
| Gold pulls lose their value | The end gap stays x2-2.5 (dial D 0.22). D is one balance number, easy to change with `balance_log` |
| A silver bullet appears | PP budget 10 per subject, payoff x0.6, counter bosses, the archetype test per batch and per Hunt week |
| Too much to read | 6-20 words per card, generated text, max 3 status icons, the visual language set before screens |
| Speed dominates | +3% a point, x1.30 from points, x1.6 total. the cap counts steps. measured: Speed best for 1 of 8 roles |
| Control locks a boss | One shared control immunity, 1-step boss control, the no-lock bound as a test |
| 203 abilities take too long or drift | The studio builder and the validator. batches by role. Nathan reviews tables, not free text |
| Rollback needed | One flag per mode. v1 stays until all three modes run on v2 |
| Member data in the public repo | Aggregates only in docs. review files with art and names stay in the private design repo |

---

## 17. Phase 1 as built (2026-10-18, local copy 2 only)

### 17.1 V1: the flag and the v2 balance keys (`tcg-bot/supabase/combat_v2_flags_balance.sql`)

- Needs `f3_engine_cleanup.sql` (F-3 PR 4e) first. Nothing reads the new keys. No v1 function changes.
- `balance combat_v2` = `{gauntlet, dungeon, hunt, progress}`, all false. `combat_v2_on(mode)` is the one reader. It returns true only for the
  JSON boolean true of one of the four names. A missing key, another type, another name, a NULL mode or a read error gives false.
- 17 number keys: `v2_stats`, `v2_card_hp`, `v2_asc`, `v2_level`, `card_level`, `v2_support`, `v2_speed`, `v2_charge`, `v2_hit`, `v2_roles`,
  `v2_status`, `v2_control`, `v2_enemy`, `v2_dungeon`, `v2_hunt`, `v2_pp`, `v2_power`. The values are the leaves of `v2sim/config.json` (306 leaves,
  compared by the test). Each key has a note and a FIXED shape: `balance_v2_spec(key)` gives every leaf with its type and limits,
  `balance_shape_errors` walks it, and the trigger `balance_check_combat_v2` refuses a missing, extra or wrong leaf and a `v2_*` key with no shape.
  Extra rules: the ASC-3 curve (0 to 1, never falls), base not above top, every card rarity has a base or an alias, the boss move chances add up to 1.
- Left out of balance, with the reason in the test (`LEFT_OUT`): the role class and texts and the status family and negative list (they are columns of
  the E1 tables), the live floor plan and room rules, the monster rows (`dungeon_monsters`, PR E7), the mechanic texts (PR E7), the simulator-only dials.
- Added beside config.json (`ADDED`): `combat_v2`, `card_level` (plan 2.4, a proposal), `v2_power` (plan 2.5; k = 1 for every role until E9 fits it),
  `v2_speed.act_at` (100, plan 3.1), and `charge: false` on the 3 Dungeon room kinds that do not charge (a fixed shape).
- v2 has its own copy of numbers that equal live v1 numbers today (`v2_hit.miss`, the Hunt boss HP and ATK, the foe growth): ASC-3 raises card CP,
  so the Lab sets them again for v2, and a v2 change must never move v1 (P6).
- Found in config.json: the Flurry text says "25% chance", the number `v2_roles.flurry.extra_chance` is 0.2 (the plan says 20%). The text is not
  copied (the E1 passive text names the number as `{extra_chance}`).
- 2026-10-19 (after PR #449, the Combat Lab items; Nathan approved): Regrowth `below_half_x` 1 (no x2 below half) and `boss_heal` 0.004, the
  boss HP factor `v2_enemy.asc3_hp_x` (1.7, a first proposal), the "Weak to: role" week (`weak_role_x` 0.3, `weak_role_rules.controller`: no damage,
  control +1 boss action), the support area smite (`v2_support.area_one_foe_x` 0.2), the Empower stack cap (`v2_status.empowered.stack_cap` 0.5,
  the switch stays false), the free cure (`v2_pp.support_pp.cure` 0), the monster status moves (`v2_dungeon.moves_v2`) and the monster passive
  numbers (`v2_dungeon.monster_passives` kinds, `v2_dungeon.passive_params`). Left out: the counter cap check line and its accepted pairs
  (simulator checks), the two simulator switches `on`, the monster move names and own passives (`dungeon_monsters` rows, PR E7), the texts, and
  an unread copy of the Pack number.

### 17.2 E1: statuses, roles and the fight state v = 2 (`tcg-bot/supabase/combat_v2_statuses_roles.sql`)

- Needs `combat_v2_flags_balance.sql` first (the rows point to `v2_status`, `v2_roles` and `v2_speed`). No v1 function reads the new objects.
- `statuses`: 19 rows. The 16 statuses of 6.1 (kind `status`), the end state `frozen` of Chill (kind `end_state`: Chill and Frozen count as
  one of the 16) and the 2 enemy states that also have an icon (kind `enemy_state`: `enraged`,
  `guarded`). Columns: family, negative, stacking rule, `max_stacks` (a balance leaf), duration rule, the one control immunity group, `end_state`
  (Chill ends in the row `frozen`), icon key, `on_enemy` / `on_card`, `numbers` (the balance object) and the one-line `rule`.
- `roles`: 12 rows. Class, label, purpose, the `passive` text, `numbers` (`v2_roles.<key>`), `speed` (`v2_speed.role_base.<key>`), icon key,
  `stat_priority` (3 of the 9 stats, plan 4), `answers` (the enemy problems of plan 4) and `auto` hints (`target`, `hold_for: charging`).
- No number is in a row. A text names each number as `{leaf}` of its balance object. The triggers `statuses_check` and `roles_check` refuse a digit in
  a text, an unknown `{leaf}` and a balance path that does not exist (`balance_path`, `balance_text_errors`). RLS on, no policy, service role only.
- Chill is Tempo with no immunity, and its end state Frozen is its own row in Control with the one control immunity (Nathan 2026-10-18, the same
  as config.json). The table checks hold it: `immunity` = control exactly for the family control, and `end_state` points to a row of kind
  `end_state` (a foreign key and the trigger). A v2 fight state may hold `chill` and `frozen` (the simulator keys).
- Quickened is family `boon` with the icon key `rabbit` (Nathan 2026-10-19, UI-67, 6.1). config.json of the simulator still says `tempo`; the
  family changes no number, and the test holds the decision (`DECIDED`).
- `fight_state_check_v2(state)`: the v1 rules plus `clock`, and `meter`, `charge` and `status{}` on each card and enemy (known statuses that apply
  to that side, with `stacks`, `value`, `until` only). The v1 status keys are refused in a v2 state (one home for each fact).
- `fight_state_v2_from_v1(state)`: a pure, read-only view of a v1 state. Enemy `wk`, `ex`, `st`, `enr`, `sh` and card `shield`, `buff`, `debuff`,
  `psn` become `weakened`, `exposed`, `stunned`, `enraged`, `guarded`, `shielded`, `empowered`, `weakened`, `poison` while they are active (the v1
  value rule, and `until` not below the round). `clock` = round, `meter` and `charge` start at 0. `cd` stays (v2 replaces it by `charge`).
- Found: Dungeon foes already have a v1 key `charge` (a boolean: the foe charges a Cataclysm). The plan's v2 `charge` is the active charge count, so
  the view moves the boolean to `cataclysm` (one word, one meaning). E2 must use these names.

## 18. Phase 2 as built (local copy 2 only)

### 18.1 E2: the turn meter (`tcg-bot/supabase/combat_v2_turn_meter.sql`)

- Needs `combat_v2_statuses_roles.sql` (E1) first. No v1 function calls the new functions, and they write nothing.
- `combat_v2_numbers(keys)`: the balance values of the given keys in one read. A missing key raises.
- `combat_v2_speed(unit, clock, numbers)` (IMMUTABLE): the one speed formula. Base = `unit.speed` (an enemy: the state builder puts the
  `v2_enemy` / `v2_dungeon` speed there), else `v2_speed.role_base[unit.role]`. Points = `unit.spd`, at most `v2_stats.max_per_stat`.
  Speed = base x min(`safety_max_x`, max(`status_min_x`, (1 + `spd.pct` x points) x Slowed x Quickened x (1 - `chill.spd` x stacks))).
  A status counts while its `until` is not below the step (it ends at the end of its `until` step, as in the simulator).
- `combat_v2_advance(state)`: runs the clock to the next actor. A standing unit at `act_at` acts and loses `act_at`. The highest meter acts
  first. A tie goes to the squad order, then the other cards by id, then the enemies by index. When nobody can act, a new step adds each
  speed to its meter, up to the step cap of the mode (`v2_hunt.round_cap`, `v2_dungeon.round_cap` for the Dungeon and the Gauntlet).
  The answer is `{state, event: act | cap | none, actor: {side, id}, steps}`. A unit that acted in the current step has `acts`.
- `combat_v2_turn_order(state, n)`: the next n actors for the turn-order strip (plan 3.2).
- One difference from the simulator, on purpose: the simulator limits the actions of all units in a step together. This file limits each
  unit to `max_actions_per_step` (the plan 3.1 rule). The two are the same below a speed of `max_actions_per_step` x `act_at`.
- Found: the simulator uses float numbers. A speed of 24 x 1.6 is 38.400000000000006 there, so an exact tie can break the other way.
  SQL uses exact numeric and follows the written tie rule. The test shows it on 2 of 71 fights (an exact replay agrees with SQL).
- Step-end ticks (E5) and the active charge (E6) are not in this file.
- Proof (copy 2, refreshed from live; 4e, V1, E1 applied): the goldens with CANDIDATE = this file (Hunt 183, Dungeon 240, boss counters
  128 fights: no difference); `test-effect-shadow.mjs` after the apply 3623 cases, 0 different, MUTATE=all baseline PASS and 23 caught;
  `fight-timing.mjs` 3 runs, the highest v1 ratio 1.024. The new functions alone (`fight-timing.mjs combat_v2_advance combat_v2_turn_order`,
  a Hunt-sized state of 8 cards and a boss): `combat_v2_advance` 0.27 to 0.31 ms, `combat_v2_turn_order(state, 6)` 0.96 to 1.02 ms.
- Test: `card-studio/scripts/test-combat-v2-meter.mjs` (42 checks; MUTATE=all: 25 planted faults caught).

### 18.2 E3: the 9 stats (`tcg-bot/supabase/combat_v2_stats.sql`)

- Needs `combat_v2_turn_meter.sql` (E2) first. `card_combat` (v1) and its helpers are not changed (the test compares their md5).
  Nothing calls the new functions yet: the card levels and the v2 points come with PR M1.
- `combat_v2_stats(cp_base, points, role, numbers)` (IMMUTABLE): the 9 stats of plan 2.2, each point count up to `max_per_stat`:
  `atk` = cp_base + `atk.flat` x ATK, `hp` = `v2_card_hp.base` + `per_cp` x cp_base + `hp.flat` x HP, `def`, `crt`, `ddg` with their caps,
  `crd`, `abl`, `acc`, and `spd` = `combat_v2_speed` of the role (E2: the one speed formula). The role passive adds (for example the
  Striker crit) are not in these numbers: the hit core applies them (E4), as in the simulator.
- `card_combat_v2(rarity, stars, cp_mod, level, points, role)`: ASC-3 (`v2_asc`, the alias, stars clamped 0 to 5), the level (clamped to
  `max_level`) and its points, the catch-up dial D (`cp_base` = cp_asc + D x level / max_level x (target - cp_asc)), the 9 stats, the support
  factor F = (cp_base / `power_ref`) ^ `power_exp` (1 for an attacker), the extra stack of an enabler rarity, and the role from the `roles`
  table (class, label, passive text, `v2_roles` numbers, base speed). It refuses an unknown rarity or role, a negative level, a bad point
  key or count, and more points than the level gives. The numbers are exact (no rounding); a screen rounds.
- No new balance key. C1 scope: `card_combat_v2` (`ci/combat/c1-numbers.json`).
- Found: with today's numbers the caps of Defense, Dodge and Crit % cannot bind (10 points x 3% = the 30% cap; 10% + 40% < 60%). The
  simulator check had the same gap. The test raises the per-point values inside its rolled-back block to prove each cap.
- Proof (copy 2; 4e, V1, E1, E2 applied): the goldens with CANDIDATE = this file (Hunt 183, Dungeon 240, boss counters 128 fights: no
  difference); `test-effect-shadow.mjs` after the apply 3623 cases, 0 different, MUTATE=all baseline PASS and 23 caught; `fight-timing.mjs`
  3 runs: runs 1 and 2 PASS; run 3 had `dungeon_enemy_turn` at 1.138 on a loaded machine (BASE mean 0.63 ms, usual 0.33 ms). That call does
  not call any E3 function. 3 more runs of it: 0.958, 1.010, 1.032; BASE against BASE in the same period: 0.857 (noise). `card_combat_v2`
  alone: 0.15 to 0.17 ms.
- Test: `card-studio/scripts/test-combat-v2-stats.mjs` (30 checks; SQL = the simulator on 23,160 cards, the largest relative difference
  3.3e-16; MUTATE=all: 29 planted faults caught).

### 18.3 E4: the hit core (`tcg-bot/supabase/combat_v2_hit.sql`)

- Needs `combat_v2_stats.sql` (E3) first. No v1 function calls the new functions, and no other function changes (the test compares the md5 of
  every other public function: 434).
- `combat_v2_hit(attacker, target, ctx, numbers)` (VOLATILE: it can draw `random()`; it writes nothing and reads no table): one hit.
  `ctx.side` = `card` (a card hits an enemy) or `enemy` (an enemy hits a card). The units carry the stat line of `card_combat_v2` as rates (`atk`,
  `crt`, `crd`, `abl`, `acc`, `def`, `ddg`; a card also `role` and `class`; an enemy `evasion`, `keen`, `mechanics`) and their `status{}`.
  - Card hit: miss = max(0, `v2_hit.miss` + evasion + Blinded - acc), no roll for a true strike or a Marked target. The roll. Crit chance =
    min(`crt.cap` + Focused, crt + adds + Focused + Striker), no crit vs Ironhide unless Marked; a crit x (crd + Striker). Empowered (Dispeller),
    Weakened, Chill, Exposed, Mark, Finisher, Cleaver, `bonus`, `vs_x`. Breaker Pierce and shield break. `ctx.basic`: the support and Artillery
    basic attack (x and the Artillery true strike).
  - Enemy hit: Blinded, then Dodge = ddg x (1 - keen) (area hits x `ddg.area_x`; none vs the mechanic `true_strike`), the roll, Enraged, the Hunt
    boss rage, Weakened, Chill, Exposed. Sunder and Shatter.
  - Damage: raw x (1 - def x (1 - min(1, pierce))), Warden `ally_dr` on a card target, at least `min_dmg`, then the shield (`shielded` of a card,
    `guarded` of an enemy) absorbs first (shield / shield_x). The Survivor heal amount (the heal rules are the caller's, E5).
  - Draw slots in a fixed order: a card hit [miss], roll, [crit]; an enemy hit [Blinded], [dodge], roll. From `ctx.draws`, else `random()`.
    The answer lists the draws used (a replay gives the same hit). Riders and the Flurry second strike draw after the hit (E6).
  - Answer: `{side, hit, miss, dodged, crit, true_strike, marked, chance, crit_chance, roll, raw, pierce, shield_x, dmg, absorbed, shield_after,
    hp_loss, hp_after, down, heal, draws}`. A down target: no draw, no damage.
- `combat_v2_hit(attacker, target, ctx)` reads the numbers. `combat_v2_status_on` (a status that counts at the clock: the E2 rule) and
  `combat_v2_draw` (one slot) are helpers.
- No new balance key or leaf: every number of the hit is a V1 leaf. C1 scope: `^combat_` covers the new functions (a planted literal fails C1).
- The card class is read from the unit (`card_combat_v2` gives it), not from balance: `v2_roles` has no class leaf (V1 left it out, the
  `roles` table holds it).
- Not in E4: Steadfast and the other new enemy passives (E7), Sleep waking, Burn on heals (E5), Confused, Flurry, Cleaver splash, riders
  (E6). The simulator focus block also adds crit damage (`st.focused.crd`): the v2 status shape has no such key, so E6 decides it.
- Proof (copy 2, refreshed from live; 4e, V1, E1, E2, E3 applied): the goldens with CANDIDATE = this file (Hunt 183, Dungeon 240, boss
  counters 128 fights: no difference); `test-effect-shadow.mjs` after the apply 3623 cases, 0 different, MUTATE=all baseline PASS and 23 caught;
  `test-all-local.mjs` after the apply 142/145, the 3 failures the generated files (db/schema, SUPERSEDED.md, docs/data), which pass after the
  regeneration; `fight-timing.mjs` 3 runs: runs 2 and 3 PASS, run 1 had `dungeon_auto_rounds` at 1.110 (no v1 call reaches an E4 function;
  3 more runs of it: 0.996, 0.973, 0.999; BASE against BASE: 0.897). `combat_v2_hit` alone (a Striker on a Hunt boss, every step of the card
  path): 0.28 to 0.40 ms.
- Test: `card-studio/scripts/test-combat-v2-hit.mjs` (90 checks: 64 fixed cases, the 13 simulator hit checks with 4000 hits each, SQL = the
  simulator on 12,000 hits with the same draws, the draw order with `setseed`, 16 refusals; MUTATE=all: 73 planted faults caught, among them
  Defense and Pierce). The largest relative difference SQL vs simulator is 9.0e-11, on a shield remainder of 0.00077 after
  shield - absorbed x shield_x: the simulator subtracts two nearly equal floats there (absolute difference 7e-14). All other numbers agree to
  float noise.

## 19. Phase 3 as built (local copy 2 only)

### 19.1 E5: the 16 statuses (`tcg-bot/supabase/combat_v2_status_rules.sql`)

- Needs `combat_v2_hit.sql` (E4) first. No v1 function calls the new functions, and no v1 function changes (the test compares the md5 of every
  other public function: 437). The flag stays OFF.
- The reference is the simulator (`engine.mjs` Battle.apply, remove, cure, damage, heal, endStep, act, confusedRedirect, tickStep).
- New unit key of a v2 state: `immune` = `{control: <step>, <status>: <step>}`, each the LAST step of an immunity (the `until` rule of a status).
  `immune.control` is the ONE control immunity (plan 6.2); `immune.<status>` is the cure immunity of a card.
- `combat_v2_status_apply(state, target, key, opts)`: down, mechanic immunity (Toxic-born, Fireborn, Frostborn), the cure immunity of a card,
  resolve (Controller `resolve_ignore`, Accuracy), Unstoppable, the one control immunity (one control at a time), the Hunt boss limit
  (`v2_control.boss_max_dur`), then the stacking rule of the status (Poison and the Toxic burst, Burn up to `max`, Chill to Frozen, the caps of Exposed
  and Weakened, Thick Hide, Dispeller, Mark and Empowered "the higher stays" (or `empowered.stack`), shields up to `cap_maxhp`). Durations: `dur` on an
  enemy, `dur_card` on a card, + the Controller `dur_add` on the other side.
- `combat_v2_status_remove`, `combat_v2_status_cure` (one target, the listed negative statuses, and the cure immunity for N steps: the Medic rule),
  `combat_v2_status_strip` (the boosts and the shields: the dispel and the boss move strip), `combat_v2_damage` (ticks, the Toxic burst, a
  Confused self hit: Defense, the Warden, min_dmg unless a tick, the shield unless it is ignored; damage that is not a tick wakes Sleep),
  `combat_v2_hit_apply` (writes an E4 hit, wakes Sleep), `combat_v2_heal` (a Burning unit heals x `heal_x`).
- `combat_v2_step_end(state)`: Poison and Burn ticks (x `vs_healer_x` vs a healer: the flag `healer` or the mechanic regrowth), Burn decay, then the
  statuses whose `until` is not above the clock end (a control starts the immunity). Once a step (`ext.step_end`). No draw.
- `combat_v2_turn_start(state, actor)`: Stunned and Frozen skip and end, Sleep skips, Paralyzed skips on a draw. `combat_v2_confused_target`: the
  wrong target of a single attack (2 draws).
- `combat_v2_next(state)`: the driver. E2's `combat_v2_advance` runs the clock to the next actor over several steps, so a caller could not put the
  step-end tick between the steps. `combat_v2_next` runs one step at a time (the step cap of `combat_v2_advance` set to clock + 1), runs the step end
  between the steps, stops with `end` when one side has no standing unit (the simulator `checkEnd`), then the turn start of the actor.
- `combat_v2_turn_order(state, n)` is REPLACED (E2 made it; `combat_v2_turn_meter.sql` is now listed in SUPERSEDED.md for it): each entry of a
  unit that skips that action has `skip` (stunned, frozen: the next projected action only; sleep), a Paralyzed one `may_fail`. With no control status
  the answer is the E2 answer (the test proves it). The speed statuses already change the strip through `combat_v2_speed`.
- Draw slots: apply [resolve], [Unstoppable], then the end state (Chill to Frozen: [Unstoppable]); turn start [Paralyzed]; Confused [chance], [pick].
- No new balance key or leaf: every number is a V1 leaf. The cure immunity steps come from the ability block (E6), as in the simulator Lab check.
- Found: a unit can hold Chill and Frozen together (a new Chill on a Frozen unit starts again from 0; the simulator does the same). Not a lock: a
  second freeze is refused by the one control immunity.
- Found and fixed: the Hunt boss limit. The `v2_control` note says a control on the Hunt boss lasts AT MOST `boss_max_dur` steps, but the
  simulator (`engine.mjs` apply) and the first SQL draft set Sleep and Paralyzed on the boss to EXACTLY `boss_max_dur`. With the live value (1)
  both give 1 step, so no test saw it (a planted removal of the rule passed). With `boss_max_dur` above `dur` (the shape allows 10) a Sleep on the
  boss would last longer than on a foe. Both now take min(dur (+ dur_add), `boss_max_dur`); a fixed case with `boss_max_dur` 10 proves it.
- Found: `shield / shield_x` in numeric rounds; a shield that takes all it can is now used up exactly (0), not a rest of 5e-17.
- Not in E5: the Weak-to-Controller week (`control_add`), Tilt, Rubberband, Permafrost Heart, Desync, Purify every Nth action, Elusive,
  Plaguebearer, Regrowth heals, Steadfast, Undying, the Cataclysm cancel by a skip (E7); the charge, the riders and the actions (E6).
- Proof (copy 2, refreshed from live 2026-10-20, where 4e, V1, E1 to E4 are live): the goldens with CANDIDATE = this file (Hunt 183, Dungeon
  240, boss counters 128 fights: no difference); `test-effect-shadow.mjs` after the apply 3623 cases, 0 different, MUTATE=all baseline PASS and
  23 caught; the flag OFF in all 4 modes after the apply; `test-all-local.mjs` after the apply 139/146: the generated files (pass after the
  regeneration), `test-combat-v2-hit.mjs` (its caller check now names the E5 v2 callers: PASS), `test-golden-mutations.mjs` (the 300 s limit
  under load; alone PASS in 194 s), and the 2 studio tests that failed the same way before the apply (both PASS after the rebase on #452);
  `fight-timing.mjs` 3 of 3 runs PASS (ratios 0.847 to 1.098). Alone: `combat_v2_status_apply` 0.47 ms, `combat_v2_step_end` 2.0 ms,
  `combat_v2_next` 3.3 ms, `combat_v2_turn_order` 1.3 ms (the Hunt-sized state of `fight-timing.mjs`).
- Test: `card-studio/scripts/test-combat-v2-status-rules.mjs` (89 checks: 64 fixed cases with explicit draws, the simulator rates, the no-lock
  bound (the Hunt boss skips at most 14 of 40 turns = 0.350 <= 0.353), the draws, SQL = the simulator on 600 random status sequences (23,316
  ops) and on 120 random fights (6,814 actions, 711 skips), the fuzz (3,200 ops), 23 refusals, md5 of the 437 other functions unchanged;
  MUTATE=all: baseline PASS, 83 planted faults caught).

### 19.2 E6: the ability blocks (`tcg-bot/supabase/combat_v2_abilities.sql`)

- Needs `combat_v2_status_rules.sql` (E5) first. No v1 function calls the new functions or reads the new table, and no v1 function changes (the test
  compares the md5 of every other public function: 451). The flag stays OFF. The reference is the simulator (`cards.mjs` blockPP and makeCard,
  `engine.mjs` cardAct, doBasic, doActive, cure, smite).
- **The block library** `ability_blocks` (5.1, 9.1): one row per block with its group, classes, fields and types, the amount that Silver raises, the
  support numbers that F scales, the price rule, the card text patterns (5.4: one pattern per block), the Silver bonus pattern and a one-line rule.
  No number is in a row. Built: the 31 blocks of the simulator, among them the trigger `on_crit`, the targets `all_enemies` (`area`) and `all_allies`
  (`shield_all`, `heal_all`, `rally`, quicken all, `cleanse`), and `heal_all` (the 5.2 price "Heal all allies"; the simulator got the block too).
  Reserved rows (the validator refuses them, with the reason): the trigger `on_kill` and the conditions `self_has`, `enemy_charging`, `foes_alive`
  and the value `self:shield` of 9.1. No rule says what they do and 5.2 has no price for them (decisions for Nathan).
- Not rows of `ability_kinds` (9.1 said "new rows"): its v1 trigger and the v1 readers (`ability_check`, the studio list, `ability_kinds_recheck`)
  would see them. The new table stands beside it (rule 9: v2 objects beside v1).
- **Balance** `ability_v2` (a new key with its own shape `ability_v2_spec` and trigger; not named `v2_*`, so V1's spec function stays): the
  price-model numbers that the simulator had in its code (`pp.att_k` 40, `pp.sup_cycle` 2, `pp.sup_vs_k` 10/3, `pp.line_status` 0.5,
  `pp.quicken_all_x` 1.5), the Silver rule (`silver.stars` 3, `silver.pp` 3), the limits (`limits.blocks` 8, `limits.riders` 1 (5.3), the card
  text `words_min` 6 to `words_max` 20 (Nathan 2026-10-20; was 8 to 14)) and `k1_shield` 0.12 (the shield that the Glossary keyword "Cure ... for N
  steps" names). `v2sim/config.json` has the same key and `cards.mjs` reads it (one number, one home).
  `v2_pp.support_pp.shield_all` 75 -> 100 (5.2, the P1 price; config.json since PR #454), logged by nathan, only while it is 75.
- **The validator** `ability_v2_check(role, ability)` (5.4): an ability is `{name, blocks [...], silver {block, field, value}}`. It passes only
  when every block is built and of the role's class, its fields have the right types and statuses (a rider status needs a verb: Frozen has none),
  a block marked once is there once, an attacker has ONE main hit (`hit` or `strikes`), a support `area` or `vs_status` has a `smite`, a
  `line_status` has an `execute`, a shield "to the cured ally" comes after a `cure`, the riders are at most `limits.riders`, the PP is 10 +/- 0.6,
  the Silver raises the amount of ONE block (type 1) to 13 +/- 0.6 PP (type 2 "more chance" is cut; types 3 and 4 wait for the guardian price
  factor; a field that is not the amount is refused), and the text has 6 to 20 words. The answer has the PP, the text, the Silver line and
  `enables` / `pays` (the "Makes / Uses" chips).
- **The PP** `ability_v2_pp` = the simulator `blockPP` for every block (C = `v2_charge.<class>` + 1).
- **The card text** `ability_v2_text` is generated from the blocks with the patterns of `ability_blocks` and the words of the statuses (new columns
  `statuses.verb` and `statuses.adj`): whole numbers rounded up (Nathan 2026-10-20), "the target" on attackers, "the enemy" then "it" on supports,
  "an ally" then "it" (two single-ally blocks are one sentence), the keyword K1 for a cure with the `k1_shield` shield, and the short forms S1 to S5
  only above 20 words. `ability_v2_silver_text`: only the bonus ("+23% damage"), the raise rounded up.
- **The card action** `combat_v2_card_act(state, actor, opts)`: one action of a card: the active when `opts.use` and the charge is full
  (`v2_charge.<class>` own turns), else the basic attack. `opts.target` is the enemy, `opts.ally` the ally of every single-ally block (the card text
  says "an ally ... it"). The basic attack: Confused, the hit, the Flurry second strike (its draw after the hit), the Cleaver splash, the support
  basic (Artillery, the Spotter Expose, the Herald Empower of the strongest attacker), then Empowered and the Mark of the target end. The attacker
  active: the shape of its hits (ABL raises the amounts), each hit then its riders (their draws AFTER the hit, 6.2) and `on_crit`, the area hits,
  lifesteal and guard_up. The support active: its blocks in order (one crit roll for each shield, heal, empower and rally block and for an Expose,
  Weaken or Mark), the smite last. Then the charge (0 after the active; +1, or `held` +1 when full) and the Medic passive (the most hurt ally).
- **The Focused crit damage and the Quickened amount** (E4 left the first to E6): a Focused status may hold `crd` (added to the crit damage of a crit),
  a Quickened status may hold `value` (its speed multiplier; a quicken block sets 1 + v x ABL; none = `quickened.x`). Four earlier v2 functions are
  REPLACED with that one change each: `fight_state_check_v2` (E1), `combat_v2_speed` (E2), `combat_v2_hit` (E4), `combat_v2_status_apply` (E5). With
  no `crd` and no Quickened value their answers are the E1 to E5 answers (the test proves it). `SUPERSEDED.md` now lists those files for them.
- Found: the simulator drew the hit of a support smite on a target that an earlier block of the same active had downed (a Toxic burst). The simulator
  now skips that smite, as SQL does (no change to `targets`: the same 20 PASS, 2 FAIL, 1 CHECK). The simulator focus price read `crd` with no default.
- Found: test-combat-v2-balance.mjs compared `v2_pp` with config.json, where PR #454 had already set `shield_all` 100; it now runs the balance part of
  this file after V1 (as on live), between the markers `-- @balance-begin` and `-- @balance-end`.
- Checked against the approved private Set 1 actives (they stay private): the validator accepts 129 of 130 with PP = the simulator; the one refused is
  the "one random status" approximation (4 riders of 25%). The generated text equals the approved text for 95 of the 100 actives that the simulator
  runs exactly; the 5 others: 6.75% now shows as 7% (whole numbers rounded up), two texts with "Then", one "the strongest one", one "This never misses".
- Not in E6: the storage of the abilities (`subjects.ability_v2`, 9.1) and the studio builder (T1); the policy choices of Auto (which ally, when to
  use the active: E8); the boss and monster moves (E7).
- Proof (copy 2: 4e, V1, E1 to E5 applied): the goldens with CANDIDATE = this file (Hunt 183, Dungeon 240, boss counters 128 fights: no
  difference); then the file applied on copy 2: the flag OFF in all 4 modes; `test-effect-shadow.mjs` 3623 cases, 0 different, MUTATE=all baseline PASS
  and every mutation caught; every v2 test PASS (V1 13, E1 15, E2 42, E3 30, E4 90, E5 89, E6 59); `test-all-local.mjs` 144/147, the 3 failures the
  generated files (db/schema, SUPERSEDED.md, docs/data), which pass after the regeneration; `fight-timing.mjs` with the candidate, 3 runs: each run had
  one or two calls above 1.10, never the same one (dungeon_enemy_turn 1.179, dungeon_pass_turn 1.128, hunt_card_crits 1.186, hunt_autopick 1.163; no v1
  call reaches an E6 function); 3 more runs of those 4 calls: 0.865 to 1.069; BASE against BASE: 0.987 to 1.040. Alone: `combat_v2_card_act` (a Flurry
  active, 3 strikes with riders) 2.7 ms, a Herald basic attack 1.8 ms, a Medic active 1.7 ms, `ability_v2_check` 1.3 ms. The simulator `targets` run is
  the same before and after the simulator changes (20 PASS, 2 FAIL, 1 CHECK). The three combat CI checks PASS.
- Test: `card-studio/scripts/test-combat-v2-abilities.mjs` (59 checks: 31 fixed card actions with explicit draws, 36 planted bad abilities each refused
  with its message, the 42 templates, SQL = the simulator on the PP of 2000 random abilities (the largest relative difference 7.6e-16) and on 120 random
  fights (3067 actions: 454 actives, 745 basic attacks, 69 skips; equal action by action), the card texts and the Silver line, the private Set 1 actives
  when the private file exists, the fuzz (535 actions, each replayed with its draws); MUTATE=all at V2_FIGHTS=30 V2_FUZZ=15 V2_PP=400: baseline PASS and
  73 planted faults caught, before and after the apply, among them a rider that draws before the hit and the Flurry draw before the hit).

### 19.3 T1: the ability builder and the new blocks (`tcg-bot/supabase/combat_v2_ability_builder.sql`)

Nathan's decisions of 2026-10-20 (all agreed): (1) `on_kill` is a rider trigger like `on_crit`, with a kill share in balance; (2) the conditions
`self_has`, `enemy_charging`, `foes_alive`, `self_shield` cost the raw price x the share of the time they are true, one share for each condition in
balance; (3) a `random_apply` block ("one random status") costs the mean of its options and counts as one rider; (4) build the blocks that the ~30
approximated Set 1 actives need; (5) the 5 text differences of E6 are accepted. Silver: only type 1.

- Needs E6. No v1 function calls a new or replaced function or reads `subjects.ability_v2`; the flag stays OFF; the md5 of the other 469 public
  functions is the same after the file. The reference is the simulator (`cards.mjs` blockPP, `engine.mjs` doActive).
- **The shares (decision 2), measured** with `node card-studio/v2sim/run.mjs shares --runs 2000` (new experiment `v2sim/shares.mjs`): at every
  active use of the standard squads (Hunt Heroic 8 cards, Dungeon run 5 cards, Normal, active, policy best), the share where the condition holds;
  each share = the mean of Hunt and Dungeon. Seed 1 (seed 7 within 0.003): on_kill 0.022 (attacker actives that down the target while another
  enemy stands), enemy_charging 0.082, foes_alive 0.093, self_shield 0.210, self_has 0.096 (the mean of Empowered, Focused, Quickened and a shield;
  the single statuses go from 0 to 0.09), per_ally 2.40 other standing attackers. Balance `ability_v2.share` = 0.02, 0.08, 0.09, 0.21, 0.1 and
  `ability_v2.ref.per_ally` = 2.4 (config.json the same; one number, one home).
- **Attachments** (new columns `ability_blocks.attach` gate | amount and `hosts`): an attachment changes the block right before it (its host), one
  for each host. Gates (`self_has {status}`, `enemy_charging`, `foes_alive` = 2 or more enemies, `self_shield`): the host works only while the
  condition holds; price host x (share - 1), so the pair costs host x share. Amount attachments: `target_has {status | statuses, x}` (host x (x - 1) x
  payoff, x frozen_share for a control list), `ally_below {line, x}` (host x (x - 1) x line), `more_per {v, status?}` (+v for each stack, or each other
  harmful status, on the enemy: the host at v x ref.stacks or ref.kinds x payoff), `coin {alt, chance}` (the mean of the two amounts).
- **Other new parts**: `on_kill` (attackers; after a main hit and its riders, when the target is down: a chance for the status on the next standing
  enemy; status x chance x share.on_kill / C; one rider), `random_apply {options, chance?}` (2 to 6 options with no value status; one pick draw; the
  mean price; one rider), `per_ally {v}` (+v damage for each other standing attacker; att_k / C x v x ref.per_ally), the target field `to`
  (`most_hurt` = the lowest HP share, `strongest` = the attacker with the most power) on shield, heal, empower, focus, quicken and lifesteal (same price),
  `apply per` (a support value status x the stacks or the other statuses on the enemy; status x value x (the count the active adds + ref x payoff)),
  the field `statuses` ("any of") on payoff_dmg, payoff_crit and vs_status (priced as one status, as the approved batches), and payoff_dmg and crit_add
  on a support smite (smite x v x payoff; smite x x x v x (crd.base - 1)).
- **Card text**: a gate is a clause ("... while this card is Empowered"), target_has / ally_below a sentence ("Shield twice as much if it is below 30%
  HP."), more_per and coin a clause ("+10% more for each Poison stack on the enemy", "+70% or +30% damage, with a 50% chance of each"), lists read
  "Paralyzed, Blinded, or Slowed", "the most hurt ally", "the strongest attacker", "Kills Stun the next enemy.", "Add one at random: ...". A heal with
  a `to` target right after a heal_all says "more". The E6 functions that the file replaces give the E6 answer on E6 abilities (342 abilities and 81
  card actions compared in the test).
- **Storage** `subjects.ability_v2` = `{role, name, blocks, silver}` (NULL = none); the trigger `subjects_ability_v2_check` refuses a value that
  `ability_v2_check` refuses. Plan 9.1 said the role is a tag `role:<key>`: it is in the value for now, because a new tag changes `tag_slugs`, which
  v1 combat reads (the flag OFF must change nothing). The tag can come with M1.
- **The builder**: Admin view section "Abilities" (`#/abilities`, `public/admin/abilities.js`, `src/ability-builder-routes.js`), in the approved
  Admin layout (one design for all Admin pages, Nathan 2026-10-07). Pick the role, the blocks of the library, the numbers; the PP meter, the PP of
  each block, the card text, the Silver line, "Makes / Uses" and the errors come from ONE `ability_v2_check` call on the LOCAL copy. Save checks
  every row again and writes a PRIVATE batch file (default `discord-card-ideas/batches/`, outside the repo). `push-abilities.mjs --v2 <batch>`
  checks every row on the target first (one refused row = nothing written), writes `subjects.ability_v2`, and `--dry` shows 0 after a push.
- **Set 1 (private, counts only)**: the 130 approved actives as a T1 batch (20 approximations rebuilt with the T1 blocks): the validator accepts
  127 of 130; the generated text equals the approved text for 121 of 130. Refused (price questions for Nathan, in the PR): a support
  vs_status with a status list (8.90 PP: the support vs_status price does not scale with the smite), a per_ally scaler (7.07 PP at the measured 2.4
  allies), an apply per on stacks (10.70 PP). The 9 text differences: the 5 accepted E6 ones, two "Then" (accepted class), one pair of applies that
  the approved text joins with "and" (two sentences here) and the phrasing of the refused apply per.
- Proof (copy 2: V1, E1 to E6 applied): the goldens with CANDIDATE = this file (Hunt 183 fights, Dungeon 240 fights, boss counters 128 fights: no
  difference); `test-combat-v2-t1.mjs` PASS 38 (the E6 answers on 342 abilities and 81 card actions; md5 of 469 other functions unchanged; SQL = the
  simulator on the PP of every block of 1500 random T1 abilities (largest relative difference 1.1e-15) and again with changed numbers; 120 random
  fights with T1 actives, 3009 actions, equal action by action (1 differs only after a float near-tie of the simulator); 15 fixed cases with explicit
  draws; 22 planted bad abilities each refused with its message; 21 card texts; Silver; the storage trigger; fuzz 550 actions replayed);
  MUTATE=all (V2_FIGHTS=30 V2_FUZZ=10 V2_PP=300): baseline PASS and 45 planted faults caught. The E6 test PASS 59 and the earlier v2 tests PASS.
  Then the file applied on copy 2 (`rehearse-sql.mjs`): `test-all-local.mjs` 143 PASS; the failures were the 3 generated files (pass after the
  regeneration), the caller lists of 3 earlier v2 tests (the T1 functions added, as E6 did) and the push test (a Windows exit crash, fixed).
  `test-ability-builder-routes.mjs` PASS 8 (no database), `test-push-abilities-v2.mjs` PASS 6 (copy 2: --dry, push, --dry = 0, one refused row =
  nothing written). The simulator `targets` report is the same before and after the simulator change (60 runs).

### 19.4 T1b: the follow-up of T1 (`tcg-bot/supabase/combat_v2_ability_prices.sql`)

Nathan approved the 6 recommendations of the T1 PR on 2026-10-20. Needs T1. No v1 function calls a replaced function, the flag stays OFF, and the
md5 of the other 488 public functions is the same after the file. Replaced from T1 (one change each): `ability_v2_spec`, `ability_v2_block_pp`,
`ability_v2_pps`, `combat_effect_v2_active`. The reference is the simulator (`cards.mjs` blockPP, `engine.mjs` doActive).

| # | Decision | What is built | Measured number (balance `ability_v2`) |
|---|---|---|---|
| 1a | A support "x times the damage vs a status" gets a raw price, measured first | price = smite price x the smite x (x - 1) x `pp.vs_smite` x the condition share (frozen_share x payoff, as an attacker) x sup_cycle / C. It grows with the smite | `pp.vs_smite` = 0.9 |
| 1b | The per-ally scaler: +13% for each ally | card number in the private batch | - |
| 1c | The "for each Poison stack" Weaken: 3.5% | card number in the private batch | - |
| 2 | `self_has`: one share for each status | `share.self_has_each.<status>` (15 card statuses) | 0 to 0.089 |
| 3 | A status list: an extra price for each added status | the share of the condition + `ref.list_extra` x (statuses - 1), at most 1 | `ref.list_extra` = 0.039 |
| 4 | `on_kill` keeps the next standing enemy | no change; a fixed case and a planted fault pin it (the fixed order, not the lowest HP) | - |
| 5 | A payoff also counts on each area hit | payoff_dmg and payoff_crit of an attacker with an area block count on each area hit against the statuses of THAT enemy. Price x (1 + area x ref.foes_other x `share.area_payoff`) | `share.area_payoff` = 0.003 |
| 6 | The two text differences stay | no change | - |

- **The measurements** (`node card-studio/v2sim/run.mjs shares --runs 2000`, seed 1; seed 7 within 0.002; the method is in the head of
  `v2sim/shares.mjs`):
  - `pp.vs_smite`: the card value of `targets` row 6 (net Hunt Heroic damage of the card + 4 reference cards) of an Artillery card
    [sure Chill 1, smite S] against the same card with vs_status Chill x2 (always true: its own Chill is on the enemy at each smite) and
    against the card with smite S + 1 (5 PP more). Measured PP of the vs_status / (smite price x S x (x - 1)) = 0.899 at S = 1.2, 1.52 and 1.7.
  - `share.self_has_each`: the share of the actives where the card has the status (the T1 probe): Empowered 0.089, Quickened 0.082, Weakened
    0.061, Poison 0.04, Chill 0.032, Slowed 0.025, Exposed 0.009, Blinded 0.008, Burn 0.006, Focused 0.004, and 0 for Stunned, Frozen, Asleep,
    Paralyzed and Confused.
  - `ref.list_extra`: the mean share of the actives whose target has one given harmful status (13 statuses; Hunt 0.051, Dungeon 0.028).
  - `share.area_payoff`: at the attacker actives with an area block while 2 or more enemies stand (Dungeon run and a horde room at floor 9,
    1311 actives), the share of the other enemies with a status / the share of the main targets with it.
- **The balance keeps every old leaf.** `balance_check` refuses a value that loses a leaf or changes its type. So `pp.sup_vs_k` and the T1
  number `share.self_has` stay in balance, and no function reads them after T1b. The new numbers are new leaves. The simulator reads the shape:
  without the T1b leaves (the E6 and T1 files) it keeps the E6 and T1 rules, so the E6 and T1 tests still compare their own files.
- **Set 1 (private, counts only)**: the validator accepts 130 of 130 (T1: 127). The generated text equals the approved text for 121 of 130.
  The private approved texts got the numbers of 1b and 1c (backups in `discord-card-ideas/backups/`).
- **Proof** (copy 2, T1 applied): the goldens with CANDIDATE = this file (Hunt 183, Dungeon 240, boss counters 128 fights: no difference);
  `test-combat-v2-t1b.mjs` PASS 28; MUTATE=all (V2_FIGHTS=30 V2_FUZZ=10 V2_PP=300): baseline PASS, 23 planted faults caught (at least one for
  each decision). The E6 test PASS 59 and the T1 test PASS 38 (both now take `ability_v2` of their own file as a whole and skip the T1b leaves
  in their balance comparison). The simulator `targets` report is the same before and after (20 PASS, 2 FAIL, 1 CHECK); `node --test` of v2sim
  PASS 182. Then the file applied on copy 2 (`rehearse-sql.mjs`): grants check OK; `test-all-local.mjs` 145 of 151
  PASS (2 one-time skipped). The 6 failures: the 2 generated files (db/schema, SUPERSEDED.md: PASS after the regeneration) and 4 tests that read
  `card-studio/.env`, which a fresh worktree does not have (PASS with a local-only .env; test-ability-sync prints PASS all, then the known Windows
  exit crash). The flag combat_v2 is OFF in all 4 modes on copy 2. After this PR, SUPERSEDED.md lists `combat_v2_ability_builder.sql`: T1 goes
  live first.
- **Open questions** (in the PR): the 5 statuses with a self_has share of 0; the measured control share at a support smite (about 0.001)
  against the assumed frozen_share x payoff (0.12); `share.area_payoff` with an area status partner; the two balance leaves that no function reads.

### 19.5 T1c: the minimum share of a condition (`tcg-bot/supabase/combat_v2_min_share.sql`)

Nathan approved question 1 of the T1b PR on 2026-10-20. Needs T1b. No fight reads the validator, the flag stays OFF, and the md5 of the other
490 public functions is the same after the file. Replaced: `ability_v2_spec` (+ `limits.min_share`) and `ability_v2_check` (+ the rule).

- **The rule.** The validator refuses a condition whose MEASURED share is below `ability_v2.limits.min_share` (0.01, a balance number with
  the limits 0 to 0.2; 0 turns the rule off). Such a block costs almost 0 PP and almost never works. The conditions with a measured share:
  the gates `self_has` (`share.self_has_each.<status>`), `enemy_charging`, `foes_alive`, `self_shield`, and the trigger `on_kill`
  (`share.on_kill`). Today it refuses `self_has` on Stunned, Frozen, Asleep, Paralyzed, Confused (0), Focused (0.004), Burn (0.006),
  Blinded (0.008) and Exposed (0.009). The error: "block N (self_has stunned): the condition is true at only 0 of the actives (the measured
  share), below the minimum 0.01 (limits.min_share): ...". These errors come last, so the PP, the card text and the Silver answer stay as before.
  No `limits.min_share` in the numbers = an exception (it never accepts by a missing number).
- **Not in the rule:** the assumed reference shares of `v2_pp.ref` (`payoff` 0.6, `frozen_share` x `payoff` 0.12 of target_has, vs_status
  and the payoffs). They are not measured. L1 below measures the vs_status share.
- **The simulator** has the same rule (`v2sim/cards.mjs` `minShareErrors`). The template check and the private Set 1 test use it.
- **Retired but kept:** `pp.sup_vs_k` (since T1b: `pp.vs_smite`) and `share.self_has` (since T1b: `share.self_has_each`). No function reads
  them. They stay in balance until the balance guard can retire a leaf (`balance_check` refuses a value that loses a leaf).

**Before Set 1 goes live: two Combat Lab measurements** [D Nathan 2026-10-20]. No number changes until they run.
- **L1 the vs_status share.** Today 0.12 is ASSUMED (`v2_pp.ref.frozen_share` x `payoff`). Measure the share of the actives where the target
  has a control status when the squad has a partner that applies controls (a Controller), for attackers AND supports. A T1b probe of the 20
  teams measured about 0.001 at the support smites and about 0.01 at all actives.
- **L2 the area payoff share.** Today `share.area_payoff` = 0.003, from the standard squads (no area status partner). In the horde rooms of the
  20 designed teams it measured about 0.15. Measure it again with the designed teams.
- **Proof** (copy 2, T1b applied): `test-combat-v2-min-share.mjs` PASS 25 (973 abilities: the errors are the T1b errors + the new errors,
  every other answer is the T1b answer; SQL = the simulator on the refused blocks, also with changed numbers); MUTATE=all: baseline PASS, 14
  planted faults caught. Goldens with CANDIDATE = this file: Hunt 183, Dungeon 240, boss counters 128 fights, no difference. After the apply:
  E6 PASS 59, T1 PASS 38, T1b PASS 28; v2sim `node --test` PASS 187; the `targets` report is the same. Private Set 1: the validator accepts
  130 of 130 (no Set 1 active has a gate or on_kill). After this PR, SUPERSEDED.md lists `combat_v2_ability_prices.sql`: T1b goes live first.

## 20. Phase 4 as built (local copy 2 only)

### 20.1 E7: the monsters (`tcg-bot/supabase/combat_v2_monsters.sql`)

- Needs `combat_v2_min_share.sql` (T1c) first. No v1 function calls a new or replaced function or reads the new tables or `enemy_v2`, and no v1
  function changes (the test compares the md5 of every other public function: 476). The flag stays OFF. The reference is the simulator (`engine.mjs`
  act, enemyAct, bossMove, bossTarget, enemyHit, pickCard, apply, blocked, damage, fall, heal, endStep; `modes.mjs` makeBoss, makeFoe, ownPassives).
- **Balance** `enemy_v2` (a new key with its own fixed shape `enemy_v2_spec` and trigger; not named `v2_*`, so V1's spec function stays):
  `rules.<name>` = the numbers of the 15 boss rules of `config.json v2_boss_rules` (Undying keeps its one home in `v2_dungeon.passive_params`),
  `bosses.<key>` = the numbers of the 16 named Hunt bosses (`hp_factor`, `counter_share`, `params` = its own mechanic numbers, `moves.<id>`).
- **The mechanics as data** `enemy_mechanics`: one row for each of the 38 enemy mechanics of the simulator (the 18 of `v2_enemy.mechanics`, the 5
  of `v2_dungeon.passive_params`, the 15 boss rules): kind, label, the balance object of its numbers, `on_boss` / `on_foe`, the one-line text (card
  text style: "this enemy", "a card", no digit, each number a `{leaf}`), `counters` / `favors` (the archetypes of 7.4, only where the plan settles
  it). Not rows of the v1 table `passives` (9.1 said "new rows in passives"): `passives_for` and `dungeon_make_foe` would draw them (rule 9).
- **The monsters** `dungeon_monsters_v2` (8.3): the 10 monsters with their own copy of HP and ATK, the v1 moves with the v2 status moves of
  `v2_dungeon.moves_v2` (Acid Spit, Hellfire, Frost Punch, Ink Blast, Rattle, ...), the own passive and its room kinds, and the raptor Pack aura.
- **The counter bosses** `hunt_bosses_v2` (8.4): the 16 named bosses of `config.json v2_bosses` (5 of them with the `_approx` note: the simulator runs a near form of the design): resists, the
  signature mechanics, the Mythic adds, the words of each counter move (the numbers are in `enemy_v2`), `weak_to` (empty: Nathan's choice).
- **The enemy action** `combat_v2_enemy_act`: the Hunt boss (Charging the turn before the Cataclysm, the Cataclysm every `boss_moves.cycle` turns
  with Rollout, a counter move with `counter_share`, else the move table) and a Dungeon foe (the Cataclysm of a kind that charges, Bulwark, the
  weighted moves with the v2 status moves). `combat_v2_boss_move` runs the 21 counter move kinds; `combat_v2_boss_target`, `combat_v2_pick_card`
  (Warden taunt), `combat_v2_enemy_hit` (Crush, Frost Aura, Venom, Burning, Slowing, Swarm, Pack).
- **The E5 leftovers** (19.1): the Weak-to-Controller week (`control_add`), Tilt, Rubberband, Permafrost Heart, Desync, Purify every Nth action,
  Elusive, Plaguebearer, Regrowth heals, Steadfast, Undying, Volatile Core, and the Cataclysm cancel: a skipped enemy turn ends Charging.
- **Replaced** (each gives its T1c answer on a state with no E7 key and no E7 mechanic; the test proves it on 60 random fights): 16 functions of E1,
  E2, E4, E5, E6, T1 and T1b (the list is in the head of the file). `SUPERSEDED.md` now lists those files for them.
- **The builders** `combat_v2_hunt_boss(tier, key)` (HP = `v2_enemy.hunt.<tier>.hp` x `asc3_hp_x` x `hp_factor`; Plated, Fade, Brood) and
  `combat_v2_dungeon_foe(monster, floor, room, kind)`, and **the template** `hunt_boss_v2_card(key, tier)`: Weak to, Resists (+ Mythic), Signature
  (label, text and numbers of each mechanic), Counters and Bring.
- Not built: the rotation rule of 8.4 (the countered archetype is not the same as in the last 2 weeks); it belongs to the weekly Hunt spawn (R3).
- One simulator change: Regrowth and the regenerate move read the HP line `v2_enemy.boss_moves.rage_at` (0.5) instead of the literal 0.5, so
  SQL has no literal (C1). The value is the same, so no fight changes.
- Found: parallel runs of the planted faults serialize on the locks of the replaced functions and can deadlock; a deadlocked run FAILS for a
  reason that is not the fault (a false catch). The test now runs one at a time and runs a deadlocked run again.
- Found: 4 planted faults passed at the small MUTATE sizes (the timed Steadfast line of Stand Firm, Volatile Core while Stunned, the step-end draws
  before the turn-start draws, the card heal count for Decay). A fixed case for each now catches it.
- **The Lab** (`card-studio/scripts/lab-combat-v2-passives.mjs`, local copy only): each of the 38 mechanics alone on the Dungeon guardian of
  floor 7 against each of the 11 archetype squads of `v2sim/experiments.mjs` (Normal 2 stars level 10), 200 simulator fights a cell (policy
  best), and 858 SQL fights (2 a cell, a simple shared policy) that equal the simulator fight by fight (857; 1 differs only after a float near-tie
  of the simulator: a meter of 99.99999999999996 against the exact 100 of SQL). The cut = the win rate with the mechanic / without it.
  - Out of line, walls every squad (median cut below 0.6): Steadfast 0.13, Plated 0.16, Bulwark 0.23, Fade 0.36, Brood 0.37, Undying 0.52,
    Regrowth 0.58. Steadfast, Plated, Fade and Brood are Hunt boss rules: on a Dungeon guardian they are far too strong.
  - Hard counters (one archetype below x0.5): Ironhide vs Crit Chain x0.01, Toxic-born vs Toxic x0.15, Slowing vs Wall x0.16, Venom vs Cleave
    x0.24, Fireborn vs Wildfire x0.37, Unstoppable vs Lockdown x0.40, Dispeller vs Herald's Court x0.40, Burning vs Cleave x0.46, Purify vs
    Lockdown x0.49, Thick Hide vs Cleave x0.49. Plan 7.4 targets a counter cut of x0.63 to x0.93.
  - No effect in this room (x1.00 for every archetype): True Strike, Time Lock, Bloodrot, Rollout. The Lab does not say why; the Hunt
    boss Lab (R3) measures them where they appear.
  - Wall is the weakest squad (31% with no mechanic) and is the lowest archetype under 12 of the 38 mechanics.
- **Proof** (copy 2, refreshed from live 2026-10-21 with V1 to T1c live): `test-combat-v2-monsters.mjs` PASS all 133 (md5 of 476 other
  functions unchanged; no v1 caller; the flag OFF in all 4 modes; data = config.json; 13 planted rows and 6 planted balance values refused;
  the T1c answers on 60 random fights with no E7 key, 1363 actions; 109 fixed cases with explicit draws; the builders for the 16 bosses at
  each tier and 120 random foes; the template; SQL = the simulator on 320 random fights, 8974 actions (5553 enemy actions, 1675 counter moves,
  359 skips), equal action by action, 0 near-ties; fuzz 1043 actions replayed). MUTATE=all (V2_FIGHTS=30 V2_FUZZ=10 V2_OLD=20) after the
  apply: baseline PASS all 133 and 110 of 110 planted faults caught. Goldens with CANDIDATE = this file: Hunt 183, Dungeon 240, boss counters 128
  fights, no difference. Then the file applied (`rehearse-sql.mjs`): grants OK; `test-all-local.mjs` 146 of 153 PASS (2 one-time skipped); the 7
  failures were the 3 generated files and the caller lists of 4 earlier v2 tests (the E7 functions added, as E6 and T1 did); all 7 PASS after.
  Every v2 test PASS (V1 13, E1 15, E2 42, E3 30, E4 90, E5 89, E6 59, T1 38, T1b 28, T1c 25). v2sim `node --test` PASS 187.
  `fight-timing.mjs`: 9 of 10 calls within 1.10; `dungeon_finish_room` 1.237, again 1.255, 0.991, 1.029, BASE against BASE 0.923 (copy 2
  has the file, so both sides run the same code: noise).
- **Open questions** (in the PR): the out-of-line mechanics above (which are Hunt-only, and the numbers of the rest); the `weak_to` tags of the
  16 bosses; the rotation rule (where it is built); the `counters` / `favors` that the plan does not settle.

### 20.2 E7b: the monster tuning and the Weak to tags (`tcg-bot/supabase/combat_v2_monster_tuning.sql`)

Nathan's 7 decisions of 2026-10-21 (the open questions of E7). Needs E7. The flag stays OFF; no v1 function calls a replaced function.
- **Hunt boss only** (decision 1): Steadfast, Plated, Fade and Brood had `on_foe` false already. Now `combat_v2_dungeon_foe` refuses any mechanic
  with `on_foe` false, and `combat_v2_hunt_boss` refuses a tier-boss signature with `on_boss` false. The Lab measures each mechanic where it can appear:
  the Dungeon table has only the 20 foe mechanics, the new Hunt table has the 30 boss mechanics (Heroic tier boss, 8-card squads, casual and active).
  In the Hunt the four rules cut every squad alike (raw median Steadfast x0.56, Plated x0.55, Fade x0.67, Brood x0.67; the named bosses pay it back
  with their `hp_factor`) and counter no squad (lowest field-relative cut x0.88 to x0.96). Steadfast favors Pile On (x1.53), Brood favors Cleave (x1.37).
- **Walls** (decision 2), numbers only: Bulwark every 2nd action 20% -> every 3rd action 18%; Undying 25% -> 15%; Regrowth on a Dungeon foe 1% -> 0.7% a
  step (the Hunt boss keeps 0.4% of the reference HP). Dungeon median cut before -> after: Bulwark x0.26 -> x0.67, Undying x0.51 -> x0.66, Regrowth
  x0.51 -> x0.65 (800 fights a cell).
- **Hard counters** (decision 3): Ironhide, Venom and Slowing get one number each. Ironhide: unless Marked, cards have `crit_x` 0.7 of their crit chance
  (was: no crit); Crit Chain x0.01 -> x0.69. Venom: a single hit poisons with the chance 0.35 (was: every hit; one draw); Cleave x0.39 -> x0.70.
  Slowing: an area hit Slows with the chance 0.4 (one draw); Slowing is a Hunt-only mechanic, so it was tuned on the Hunt boss: raw median x0.62 -> x0.76.
  The value 0 (crit_x) and 1 (chance) give the E7 rule, with no draw. The other counters below x0.5 stay the counter of the day: Toxic-born vs Toxic
  x0.13, Fireborn vs Wildfire x0.37, Unstoppable vs Lockdown x0.41 (Dungeon); Bulwark, Undying and Regrowth still cut Wall (the weakest squad, 31% with
  no mechanic) to x0.08, x0.33 and x0.22. Dispeller (Hunt only) is x0.88 or more in the Hunt.
- **The Weak to tags** (decisions 4 and 6): the 16 primary role tags of Nathan's table in `hunt_bosses_v2.weak_to` and `config.json v2_bosses.<key>.weak_to`.
  ONE SOURCE: `combat_v2_hunt_boss` puts the role of that tag on the boss (`weak_role`) and refuses `opts.weak_role`; the simulator `makeBoss` does the same
  (a `weakRole` option stays only for the unnamed tier boss of the experiments). `hunt_bosses_v2_check` refuses a tag that is not a role tag, a second
  role tag, an unknown role, and Warden, Medic, Spotter or Herald.
- **The Weak to size** (decision 5), the Lab table (Heroic, the 16 bosses, 300 days a cell): the favored squad's median gain is x1.10 at
  `weak_role_x` 0.3, x1.16 at 0.5, x1.22 at 0.7 (the 14 damage weeks; the 2 Controller weeks have their own rule and gain x1.05 to x1.07). The balance
  value stays 0.3; Nathan chooses it from the table (he chose 0.5 after the PR: 20.3).
- **Deferred** (decision 7): the rotation rule of 8.4 and the Counters / Bring chips: with the weekly Hunt spawn (R3).
- Proof: in the PR (test-combat-v2-monster-tuning.mjs, the planted faults, the goldens with this file as the candidate, the full local suite).

### 20.3 E7c: `weak_role_x` 0.5 and the Warlord's own Ironhide (`tcg-bot/supabase/combat_v2_e7_followup.sql`)

Nathan approved two items after PR #463 (2026-10-21). Needs E7b. The flag stays OFF.
- **The Weak to size**: `v2_enemy.weak_role_x` 0.3 -> 0.5 (the Lab table of 20.2: the favored squad's median gain x1.16). A balance update, so
  `balance_log` records it. `config.json` has the same value, and the Lab check `boss.weak_role` pins +50%.
- **The Rage-Quit Warlord keeps the full Ironhide**: `enemy_v2.bosses.warlord.params.ironhide.crit_x` = 0 (the numbers of a named boss are in
  balance `enemy_v2.bosses.<key>`; `hunt_bosses_v2` holds the words). `enemy_v2_spec` gets the one leaf. The global Ironhide stays `crit_x` 0.7 (the
  Mythic Netcode and the Mythic Maw keep it). No fight code changed: `combat_v2_mech` and the simulator `mechParams` already put a boss's own params
  over the base numbers, and the boss card shows the merged number. The Warlord resists Mark, so in play cards never crit on it.
- Lab (`lab-combat-v2-passives.mjs --only warlord`, Heroic, 11 archetypes, 300 days a cell): Crit Chain cut on the Warlord (net damage / no
  Ironhide) x0.86 -> x0.54, field-relative x0.93 -> x0.73; the median cut of all squads x0.92 -> x0.74 (the Warlord's `hp_factor` 0.71 was measured
  with the E7 rule, no crit, so it fits the full Ironhide).
- Found, not fixed (a gap of E7): the simulator caps the actions of a step for all units together, SQL caps each unit (`max_actions_per_step`).
  Only the Hydra's New Head (`extra_action`) reaches the cap; the test counts such fights apart.
- Proof: in the PR (test-combat-v2-e7-followup.mjs, the planted faults, the goldens with this file as the candidate, the full local suite).

### 20.4 The tester list and the Admin "Combat v2 Lab" (`tcg-bot/supabase/combat_v2_testers.sql`)

Nathan asked for a tester unit to see the v2 changes. No v1 function calls `combat_v2_on` yet and there is no v2 fight screen (U0), so a tester
list alone shows nothing. Two parts:
- **The tester list** (for the go-live steps R1 to R3): `balance combat_v2.testers` = 0 to 20 Discord ids (a string of 17 to 20 digits, no id twice),
  `[]` now; the four modes stay false. `combat_v2_on(mode, player)` = `combat_v2_on(mode)` OR (one of the four modes AND the player is in the list).
  The tester part fails closed (NULL, an unknown mode, a value that does not match the fixed shape, no row, a read error). `combat_v2_on(mode)` does
  not change. No v1 function calls either form. `balance_shape_errors` has the new spec word `discord_id`; `balance_v2_spec` = the E7b text + the list.
- **Found and fixed**: the generic trigger `balance_check` refuses an update that loses a leaf, and list items are leaves, so a tester could be
  added but never removed. `balance_check` (replaced: the text of `balance_table.sql`) exempts only the ids of `combat_v2.testers`.
- **The Admin page** `#/combat-lab` (`public/admin/combat-lab.js`, `src/combat-lab-routes.js`):
  - Flag and testers: the four modes and the list; add or remove an id with the Phase 2 balance editor (review, test on the local copy, apply
    live, the Admin log and `balance_log`). No other write path.
  - Fight viewer: a member of the LOCAL copy, a squad of the member's own cards (or auto: the best N by v2 CP), a Hunt boss of `hunt_bosses_v2`
    (or the tier boss) at a tier and a start HP, or Dungeon foes (`combat_v2_dungeon_foe`: monster, room kind, floor, room, 1 to 4 foes), a card
    level and a seed. The real v2 SQL functions run in ONE block on the local copy that always ends with a RAISE (nothing is kept). It shows
    the squad (the v2 stats of `card_combat_v2`, the role passive, the active and its text: `subjects.ability_v2`, else the simulator placeholder of
    the role), the boss card (`hunt_boss_v2_card`: Weak to, resists, mechanics, counter moves, counters, bring), the turn order, the action log
    (actor, active or basic, each hit with crit and miss, the HP, status and Charging changes of every unit, the step-end ticks, downs) and the totals.
  - Compare (Hunt): the same cards in v1 (`hunt_attack`, the admin sim: a test member with copies of the cards, a PRIVATE test boss of the tier
    with no passive, rolled back) and in v2. The Dungeon has no compare: the v1 Dungeon is a run of rooms with no one-fight path.
  - Limits: the policy was the simple Lab policy until E8 (since E8: Auto v2, 20.5); the stat points are the simulator build of the role (no live card levels before M1).
- Proof: in the PR (test-combat-v2-testers.mjs with its planted faults, test-combat-lab-routes.mjs, test-combat-lab-nowrite.mjs, the goldens with
  this file as the candidate, the full local suite).

### 20.5 E8: Auto v2 (`tcg-bot/supabase/combat_v2_auto.sql`)

Plan row E8: "Dungeon Auto plays each ready card. Hunt auto-pick with role answers and the pair score", acceptance "Auto reaches 85% or more of a
scripted best play". Needs E7c. No function is replaced (the md5 of the other 518 public functions is the same after the file), nothing in play calls a
new function, and the flag stays OFF. The reference is the simulator: `v2sim/policy.mjs` `autov2` (the fight) and `v2sim/auto.mjs` `autoPick` (the pick).

- **The fight decision** `combat_v2_auto(state, actor, numbers, auto)`: `{use, why, target, ally}` for `combat_v2_card_act`. It reads the blocks of each
  active (what it makes and what it pays off: the "Makes / Uses" rule of 5.4, + `consume`, + Frozen for a Chill maker, + the role passive
  `auto_v2.fight.passive_makes`), the role hint `roles.auto` and balance `auto_v2.fight`. No template id, no random draw, no write. Every charged active is
  used unless a rule holds it, at most `hold_max` ready turns:
  - an attacker holds an execute active until the target is below its line or has a line status, an active with a gate (T1) until the gate holds,
    an active that pays off a status until the target has it while another standing card makes it, a `per_kind` active until `per_kind_min` statuses;
  - a support uses its active when one of its blocks is useful now (a shield while an enemy is Charging or a card is hurt, a heal below `heal_below`, a
    cure or a cleanse on a harmful status that is not locked, a boost while an attacker stands, a control on a target that is not controlled or immune,
    a value status that is missing or ends within `refresh` steps, any other block); the Controller (`roles.auto.hold_for` = charging) holds a control
    active for a Charging enemy (the Hunt boss or a foe with a Cataclysm).
  - Target: the Hunt boss; in the Dungeon a control, Weakened or Blinded support active takes the foe with the most attack, a payoff attacker active the
    first foe with a paid status, else the first foe the card can down (`kill_x`), else the lowest HP foe. Ally (one ally for every single-ally block, as
    `combat_v2_card_act` takes it): a cure takes the ally with the most listed statuses, a shield the lowest HP + shield share, an Empower, Focus or Quicken
    the free attacker with the most attack x (`ready_x` when charged) x (meter + 1); else the most hurt ally.
- **The Hunt auto-pick** `combat_v2_autopick(pool, boss, cap, numbers, auto)`: a score for each card = its offense (2.5 without the hit chance: attack x
  (1 + crit x (crit damage - 1)) x speed) x the role answers of the boss mechanics (`auto_v2.pick.answers`) x the Weak to bonus x the pair score
  (`pair_floor` 0.8 for a payoff card with no maker of its status among the other picked cards: the 5.2 floor rule). The best `supports` (4) supports, at
  most `max_same_support` (1) of one role, and the best attackers; a short class fills from the other; again with the pair scores of the squad (at most
  `passes`). The tier boss draws its signatures in the fight, so its pick has no mechanics.
- **Balance** `auto_v2` (a new key, its own fixed shape `auto_v2_spec` and trigger; config.json `auto_v2` has the same value): `fight` (10 numbers and
  `passive_makes`), `pick` (supports, max_same_support, pair_floor, passes, and the full answers table: 30 boss mechanics x 12 roles, 1 = no answer).
  - The answers are measured (`node card-studio/v2sim/run.mjs answers`): each mechanic alone on the Heroic tier boss, the strength of each role template
    (+ 4 reference cards) with / without it, relative to the median role, the mean of seeds 1 and 7 (800 days a template). 36 cells differ from 1 (for
    example Medic x0.61 vs Siphon, Artillery x1.23 vs Fade, Breaker x1.12 vs Plated, Cleaver x1.10 vs Brood).
  - `supports` 4 and `max_same_support` 1 are measured on 32 tuning pools (seed 101). The offense value replaced the plain attack (tuning mean x0.84 ->
    x0.88). Measured on the same pools: without the pair score x0.88, without the answers x0.89 (both within the noise of the pools).
- **The Admin "Combat v2 Lab"** (20.4) now plays every card with `combat_v2_auto` and shows the Auto choice of each card action in the log (why, target,
  ally); its Hunt squad "auto" is the auto-pick (the squad table shows the pick score). The Dungeon "auto" squad stays the best N by v2 CP (E8 has no
  Dungeon pick).
- **The Lab** (`card-studio/scripts/lab-combat-v2-auto.mjs`, the simulator tables with the numbers of the database, and SQL = the simulator on the Lab
  fights and picks). "Scripted best play" = the simulator policy `best` (it scripts each placeholder template: payoff holds, kill targets, control on a
  Charging boss). The pick reference is stronger: a squad that a local search finds (swap one card at a time, 24 days a squad, the best policy).
  Held-out pools (seed 1), 300 days a cell:

  | Archetype | Hunt: Auto v2 / best | Hunt: old Auto / best | Dungeon: Auto v2 / best | Dungeon: old Auto / best |
  |---|---|---|---|---|
  | Neutral | x1.00 | x0.98 | x1.00 | x1.00 |
  | Toxic | x1.00 | x0.99 | x1.00 | x0.99 |
  | Wildfire | x1.00 | x0.99 | x1.00 | x0.99 |
  | Shatter | x1.00 | x1.04 | x1.00 | x1.00 |
  | Mark and Hunt | x1.01 | x0.95 | x1.00 | x1.00 |
  | Wall | x1.00 | x1.00 | x1.00 | x0.99 |
  | Crit Chain | x1.00 | x0.95 | x1.00 | x0.98 |
  | Cleave | x1.00 | x1.01 | x1.00 | x1.00 |
  | Lockdown | x1.02 | x1.16 | x1.00 | x0.99 |
  | Pile On | x1.00 | x1.01 | x1.00 | x0.99 |
  | Herald's Court | x1.00 | x0.99 | x1.00 | x0.99 |

  - The 20 designed teams with the private Set 1 actives (aggregates): Auto v2 / best Hunt x0.949 to x1.010 (median x0.988), Dungeon x0.975 to x1.007.
  - The Hunt pick + fight (2 pools of 20 real cards for each of the 16 named bosses): Auto / searched best mean x0.878 (lowest pool x0.641, Camper
    Colossus); the old Lab pick (top 8 by attack + the simple Auto) x0.724. Per boss (mean): Warlord 0.86, Nightshade 0.87, Netcode 0.93, Vampire 0.95,
    Warzombie 0.87, Maw 0.81, Smurf 0.95, Skeleton 0.82, Pumpkin 0.83, Lagspike 0.93, Banwave 0.93, Zerg 0.89, Salt Miner 0.87, Frost Lich 0.91,
    Camper Colossus 0.74, Hydra 0.89. 12 of 16 bosses at x0.85 or more.
- **Open**: the 4 bosses below x0.85 in the pick (the search finds template combinations that no per-card score sees; the E9 Power number is the next
  step), whether the pair score and the role answers stay (their measured effect is within the noise), a Dungeon squad pick.
- SQL = the simulator on the Lab: 88 Lab fights (4 for each archetype and mode, the same draws) 87 equal (result, steps, every HP, 523 actives), 1 differs
  only after a float near-tie of the simulator; the 32 Lab picks give the same squad in the same order.
- Found, not fixed (E4/E5, not this file): numeric shield arithmetic can leave a shield or a Guard of about 1e-17 where the simulator float gives 0 (1 of
  160 test fights). The test counts it apart.
- Proof (copy 2, V1 to E7c and the tester list applied): `test-combat-v2-auto.mjs` 86 checks (no other function changes, md5 of 518; 52 fixed decisions;
  SQL = the simulator on 565 decisions of random states, on 160 random fights played by Auto v2 (4158 actions, 1455 card decisions, 0 near-ties), and on
  300 random pools; 11 fixed picks and 7 refusals; fuzz 860 actions); MUTATE=all after the apply: baseline PASS and 53 of 53 planted faults caught. Goldens with
  CANDIDATE = this file: Hunt 183, Dungeon 240, boss counters 128 fights, no difference. Then the file applied (`rehearse-sql.mjs`): grants OK; the earlier
  v2 tests got the E8 functions in their caller lists (as E6, T1 and E7 did); the generated files regenerated. Combat checks C1, C2, C3 PASS.

### 20.6 E9: the Power number (`tcg-bot/supabase/combat_v2_power.sql`)

Plan row E9: "Power number `card_power_v2` and squad value in SQL. client shows it only", acceptance "rank correlation report. C3 passes", and decision 3
(section 15): "add the smite, status and control value of the active to the Offense term in E9, then refit k (target 0.85-1.15)". Needs E8. One function is
replaced (`balance_v2_spec`: the v2_power leaves only; the spec of every other key is the same); nothing in play calls a new function; the flag stays OFF.
The reference is the simulator `v2sim/power.mjs` (`cardPower`, `squadValue`; the Lab: `node card-studio/v2sim/run.mjs power` and `powerpick`).

- **The formula** (`card_power_v2(card, blocks)`, the card = `card_combat_v2`, the blocks = the BASE blocks of the active):
  - crit factor cx = 1 + crt x (crd - 1); hit chance = 1 - max(0, `v2_hit.miss` + `v2_enemy.hunt.Heroic.evasion` - ACC) (the Heroic boss: the boss of the fit).
  - Offense (attacker) = atk x cx x hit chance x speed x (1 + `abl_x` x (ABL - 1)) (plan 2.5, unchanged).
  - Offense (support) = (`v2_support.basic_x` x atk x hit chance + `support_abl_ref` x F x ABL + F x ABL x atk x u x V) x cx x speed, with
    V = `value.smite` x PP(smite) + `value.dot` x PP(dot) + `value.control` x PP(control) and u = 1 / (`support_pp.smite` x `sup_cycle`) (the attack share
    of one PP: a smite of 1.0 x CP costs smite x sup_cycle / C PP). This is decision 3.
  - Survival = HP / (1 - DEF) / (1 - `ddg_x` x DDG). Power = Offense x Survival x k[role] x `scale`; the card shows round(Power).
  - The families of the blocks (`card_power_v2_families`): smite = smite, area, vs_status, payoff_dmg, crit_add, consume of a support (the smite and what
    changes it); dot = a status block (apply, on_crit, on_kill; random_apply when all its options are in one family) of the statuses family `dot` (Poison,
    Burn); control = the same for the family `control` (Stunned, Frozen, Sleep, Paralyzed); an attachment counts in the family of its host; the rest is
    other (shield, heal, boosts, cure, Exposed, Weakened, Mark, Chill, ...). PP = `ability_v2_pps` (the 5.2 price list) on the blocks with the extra stack.
  - Why dot and not every status: with every status in the family, the Spotter (Exposed) fell to k 0.86 (the Exposed value is in the old generic term
    already). With Poison and Burn ("smite, Poison or control", decision 3 text), every role is inside the target.
  - The attacker term has no value term: every active costs the same budget, and the attacker k is inside the target with no change.
- **Balance** `v2_power` (V1 key; this file updates it ONCE: a row that has `value` keeps its numbers): k fitted, `value` {smite 0.2, dot 0.175, control
  0.1}, `scale` 0.00195 (the mean Power of a Normal 0-star level-0 card of each placeholder template = 100). `config.json v2_power` has the same value.
  The value weights: one grid fit on the 42 reference templates (Normal 2 stars level 15, the card + the 4 reference cards of experiment 4), the sum of the
  template-level spreads of the Hunt and the Dungeon (3 numbers, one per family); then k per role on the Hunt (12 numbers, mean 1).
- **The squad value** `combat_v2_squad_value(cards)` = the sum of Power x the pair score of each card (the E8 pair rule: `pair_floor` for a payoff card with
  no maker of its status among the other cards). `card_power_v2(rarity, stars, mod, level, points, role, blocks)` gives the Power from the card facts.
- **The k refit** (`run.mjs power`, Hunt Heroic net damage a day of the card + 4 reference cards, policy autov2, 1500 days a template; fit on seed 9, check
  on fresh days of seed 19):

  | Role | k before (plan 2.5, V1) | k with the E9 formula (stored) | Check: E9 x stored k, fresh days | Dungeon k before | Dungeon k E9 |
  |---|---|---|---|---|---|
  | Breaker | 0.90 | 0.942 | 1.01 | 0.88 | 0.92 |
  | Striker | 0.96 | 1.003 | 0.99 | 0.87 | 0.91 |
  | Flurry | 0.91 | 0.956 | 0.99 | 0.84 | 0.87 |
  | Finisher | 0.93 | 0.980 | 0.99 | 0.88 | 0.91 |
  | Survivor | 0.96 | 1.011 | 1.01 | 1.00 | 1.04 |
  | Cleaver | 0.97 | 1.014 | 0.99 | 0.97 | 1.01 |
  | Warden | 0.96 | 1.009 | 1.00 | 0.96 | 1.00 |
  | Medic | 0.91 | 0.951 | 1.00 | 1.33 | 1.39 |
  | Controller | 1.15 | 1.099 | 1.01 | 1.17 | 1.11 |
  | Spotter | 0.95 | 0.997 | 0.98 | 0.94 | 0.99 |
  | Herald | 0.95 | 0.992 | 1.01 | 0.91 | 0.95 |
  | Artillery | 1.46 | 1.045 | 1.01 | 1.25 | 0.90 |

  Before: 0.90 to 1.46 (outside the target: Artillery, Controller). E9: 0.94 to 1.10 (inside 0.85 to 1.15). In the Dungeon the Medic stays at 1.39 (a heal
  is worth more there; one Power number for both modes).
- **The rank correlation report** (Spearman; 240 random cards: random role, finish, stars, level and build; Hunt 300 days, Dungeon 60 runs a card):

  | Mode | Formula | All cards | Attackers | Supports | Mean within one role |
  |---|---|---|---|---|---|
  | Hunt | naive CP x HP | 0.625 | 0.912 | 0.606 | 0.822 |
  | Hunt | plan 2.5 (V1, k = 1) | 0.818 | 0.982 | 0.630 | 0.901 |
  | Hunt | E9 Power | 0.876 | 0.980 | 0.782 | 0.900 |
  | Dungeon | naive CP x HP | 0.558 | 0.883 | 0.518 | 0.807 |
  | Dungeon | plan 2.5 (V1, k = 1) | 0.706 | 0.918 | 0.517 | 0.876 |
  | Dungeon | E9 Power | 0.681 | 0.928 | 0.525 | 0.877 |

  Per role (E9, Hunt / Dungeon): Breaker 0.98 / 0.90, Striker 1.00 / 0.98, Flurry 0.98 / 0.96, Finisher 0.98 / 0.86, Survivor 0.97 / 0.94, Cleaver 0.97 / 0.98,
  Warden 0.78 / 0.77, Medic 0.92 / 0.94, Controller 0.84 / 0.90, Spotter 0.74 / 0.73, Herald 0.77 / 0.68, Artillery 0.88 / 0.89.
  Per squad (120 random squads of real cards; Hunt 8 cards, Dungeon the first 5): sum of CP 0.888 / 0.669, sum of plan 2.5 0.922 / 0.613, sum of E9 Power
  0.941 / 0.635, squad value (Power x pair score) 0.937 / 0.645.
- **The Hunt auto-pick with the Power number** (owner approval of 2026-10-22: use the Power in the pick score and measure per boss). `run.mjs powerpick`
  (v2sim `powerPickLab`): the E8 Lab protocol (the same pools, seeds, searched reference and evaluation days as 20.5), and four Power variants in the
  score (Power x the role answers x the Weak to bonus x the pair score). The "before" column reproduces the E8 numbers of 20.5 exactly.
  Held-out pools (seed 1, 2 pools of 20 real cards a boss, Heroic, 150 fresh days):

  | Boss | Weak to | E8 offense score (before) | E9 Power score (after) | Power for attackers only |
  |---|---|---|---|---|
  | Rage-Quit Warlord | controller | x0.864 | x0.869 | x0.869 |
  | Nightshade | breaker | x0.874 | x0.887 | x0.873 |
  | Netcode | survivor | x0.929 | x0.898 | x0.929 |
  | Grind Vampire | artillery | x0.946 | x0.911 | x0.936 |
  | AFK Warzombie | striker | x0.870 | x0.905 | x0.905 |
  | Maw | cleaver | x0.812 | x0.826 | x0.836 |
  | Smurf | flurry | x0.952 | x0.952 | x0.952 |
  | Skeleton | breaker | x0.815 | x0.760 | x0.788 |
  | Pumpkin | survivor | x0.825 | x0.825 | x0.825 |
  | Lagspike | finisher | x0.932 | x0.794 | x0.887 |
  | Banwave | striker | x0.926 | x0.923 | x0.956 |
  | Zerg | cleaver | x0.892 | x0.910 | x0.892 |
  | Salt Miner | breaker | x0.870 | x0.870 | x0.870 |
  | Frost Lich | flurry | x0.909 | x0.816 | x0.934 |
  | Camper Colossus | controller | x0.741 | x0.730 | x0.730 |
  | Hydra | artillery | x0.886 | x0.851 | x0.872 |
  | MEAN | | x0.878 | x0.858 | x0.878 |
  | Bosses below x0.85 | | 4 | 6 | 4 |

  The same on the tuning pools (seed 101): E8 x0.888 (5 below), E9 Power x0.868 (7 below), Power for attackers only x0.881 (5 below). On a larger held-out
  set (seed 202, 6 pools a boss, 96 pools): E8 x0.877 (4 below), E9 Power x0.860 (8 below), Power without Survival x0.857, Power for supports only x0.861,
  Power for attackers only x0.873 (5 below).
  - **Result: the Power score does not improve the pick.** It is lower on all three pool sets; for attackers alone it is equal or a little lower. So
    `combat_v2_autopick` is NOT changed (it keeps the E8 offense score); the simulator keeps the Power score as a Lab option (`autoPick` reads a pool card's
    `power`; `run.mjs powerpick`).
  - Why: the Power is the value of a card beside 4 fixed reference cards (2 attackers + Warden + Spotter). In an 8-card squad with 4 attackers, the
    amplifiers (Herald, Spotter) and the Medic are worth more and a second damage source (Artillery) less. Support roles picked over the 32 seed-1 pools:
    searched best Herald 24, Medic 23, Spotter 21, Controller 17, Warden 15, Artillery 12; E8 Artillery 18; E9 Power Artillery 22 (fewer Controllers and
    Medics). Cards in common with the searched best (of 8): E8 6.13, E9 Power 6.03, Power for attackers 6.19.
  - Why 4 bosses stay below x0.85 (Camper Colossus x0.741, Maw x0.812, Skeleton x0.815, Pumpkin x0.825): the searched best squad has a SHAPE that the pick
    rules forbid. In 27 of the 32 seed-1 pools the best squad breaks a pick rule (12: a support role twice, against `max_same_support` 1; 22: not 4
    supports, against `supports` 4); in 5 of the 8 pools of these 4 bosses. Camper Colossus (Weak to Controller) and Maw: the best takes 2 Controllers;
    Skeleton: 2 Spotters, or 3 supports; Pumpkin: 6 attackers and 2 supports. No per-card score reaches a squad that the shape rules forbid, so a better
    card number cannot close this gap.
- **Not built**: a player-card form (`card_power_v2` for `player_cards`: needs the live levels and v2 points of M1) and any Activity screen (U0: the
  Activity shows the SQL number only, CI check C3). The Admin "Combat v2 Lab" shows the Power of each card (the card list and the squad table, with its
  offense, survival, k and active value) and the squad value (a KPI of the fight).
- **Open** (with the recommendation):
  1. The pick score: keep the E8 offense score (measured better). To lift the 4 bosses, measure a shape rule next (for example the Weak to support role may
     take 2 slots, or 3 to 5 supports by the boss answers) on the tuning pools, then on held-out pools; do not tune per boss.
  2. The Dungeon: one Power number for both modes leaves the Medic at k 1.39 in the Dungeon and the Dungeon squad correlation at 0.645 (the sum of CP:
     0.669). Recommendation: measure a Dungeon survival weight or a Dungeon k with R2 (Dungeon v2 ON), before the Power shows on a Dungeon screen.
  3. The pair score in the squad value: its measured effect is within the noise (Hunt 0.941 without, 0.937 with; Dungeon 0.635 without, 0.645 with).
     Recommendation: keep it (the same rule as the pick, plan 5.2), measure again after the Set 1 abilities are pushed.
  4. The scale: the mean Normal 0-star level-0 card shows 100 (the 42 templates: 62 to 134); Normal 2 stars level 15: mean 568; Gold 0 stars level 0: mean
     1016; Gold 5 stars level 30: mean 4201 (2504 to 6097). Recommendation: keep; Nathan may choose another reference with the screen design (U0).
- **Proof** (copy 2, V1 to E8 and the tester list applied): `test-combat-v2-power.mjs` PASS all 44, before and after the apply: the md5 of the 527 other
  public functions is the same (the E8 auto-pick included); only `balance_v2_spec` changes, and its spec of every other key is the same; no other function
  calls a new function; the flag OFF; balance = config.json; the status families = the copy in power.mjs; 8 planted values refused; the file runs twice;
  17 fixed Power cases and 4 fixed squad values (hand-computed: each term, each family rule, the extra stack, k, scale, the rounding, the pair rule); 5 + 5 refusals; the 7-argument form on 840 cards;
  monotone in stars and level for the 42 templates x Normal and Gold; SQL = the simulator on 300 random cards end to end, on 300 random abilities with
  attachments (0 rounding near-ties) and on 120 random squads. MUTATE=all (V2_CARDS=40 V2_SQUADS=20, before the apply): baseline PASS all 44 in the same run,
  39 of 39 planted faults caught (36 SQL, 3 simulator). Goldens with CANDIDATE = this file: Hunt 183, Dungeon 240, boss counters 128 fights, no difference.
  Then the file applied (`rehearse-sql.mjs`): grants OK; `test-all-local.mjs` 157 of 163 PASS (2 one-time skipped); the 6 failures were the caller lists of 4
  earlier v2 tests (the E9 functions added, as E6, T1, E7 and E8 did), the V1 config compare (v2_power is now compared by the E9 test) and SUPERSEDED.md; all 6
  PASS after the fixes and the regeneration. `test-combat-lab-routes.mjs` PASS 18, `test-combat-lab-nowrite.mjs` PASS 6 (the Power of every squad card and
  the squad value; nothing written in 22 tables). Combat checks C1 (+ the scope `^card_power_v2`), C2, C3 PASS; `node --test card-studio/v2sim/*.test.mjs`
  PASS 190.
- Go-live order: SUPERSEDED.md now lists `combat_v2_testers.sql` (this file replaces `balance_v2_spec`), so the tester file goes live before this file.
