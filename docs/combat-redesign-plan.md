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
| P5 | Readable in one Discord window. Card text 8-14 words. Max 3 status icons on a unit, then "+N" | Most synergy rules are hidden today. Support texts show no number |
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
| Unique active | The card's own ability. It charges over the card's own turns | The only card text: name + 8 to 14 words |

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

- A **turn-order strip**: the next 5 to 6 actors (cards and enemies) from the clock. The clock itself stays hidden.
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

Card text limits [P]: 1 main block, at most 1 rider, at most 1 condition, at most 8 engine steps [L limit]. Text 8 to 14 words [D].

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
| Burn, per stack | 1.5 | Shield all allies | 75 |
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
- One rule for every card [D]: **+3 PP**, spent as **+50% rider chance**, or **+50% of the main number** if the card has no rider [P numbers from the effect library].
- The validator accepts 13 PP at Silver for this rule only. The card shows the Silver line greyed out until 3 stars.
- The Gauntlet never has the upgrade (0 stars) [L].
- This rule removes the old conflict "stun +1 round vs the stun limit 1" (it changes a chance or an amount, never a control duration).
- Today only 26 card rows are at 3 stars or more [L].

### 5.4 The validator

`ability_kinds` and `ability_ok()` exist and check every live ability today [L]. v2 extends them:
- Every block row has its PP price (`ability_kinds.power`, the column exists [L]) and its allowed roles.
- A v2 ability passes only when: the sum is 10 +/- 0.6 PP (13 at Silver), the blocks fit the role, the limits of 5.1 hold,
  every status and trigger is built, and the text has 8 to 14 words.
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
| | Chill / Frozen | Each Chill stack: -8% damage and -8% speed. At 3 stacks: Frozen (skips its next action), then Chill clears | adds, max 3 | Chill 3 / 10 | snowflake / ice block |
| | Sleep | Skips actions until it takes damage | no stacks | 3 / 10 | moon |
| | Paralyzed | Each action fails 50% (electric sources) | no stacks | 3 / 10 | bolt |
| Accuracy | Blinded | +25% miss chance | no stacks | 2 / 8 | closed eye |
| | Confused | 30% of its single attacks hit a wrong target | no stacks | 2 / 8 | swirl |
| Tempo | Slowed | Speed x0.7 | no stacks | 3 / 10 | snail |
| | Quickened | Speed x1.3 | no stacks | 3 / 10 | wing |
| Vulnerability | Exposed | Takes +X% damage from every source, ticks included | adds, cap +100% | 2 / 8 | cracked eye |
| | Weakened | Deals X% less damage. Replaces the card "Curse" | adds, cap 60% | 2 / 10 | down arrow |
| | Mark | The next attack on it deals +X%, cannot miss, and can crit an Ironhide enemy. Then it ends | the higher X stays | 4, or 1 attack | target |
| Boons | Shielded | Absorbs damage before HP | adds, cap 1.0 x max HP | until used | shield |
| | Empowered | The next attack deals +X% | the higher X stays [P] | 1 attack | up arrow |
| | Focused | +crit chance | no stacks | 10 | crosshair |

Chill and Frozen count as one status (Frozen is the end state of Chill). Two enemy states are also shown with an icon:
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
1. **Weak to:** 1 to 3 rule tags (today's rule, rule tags only).
2. **Resists:** 0 to 2 tags and 1 immune status family (for example "Immune: Poison").
3. **Signature:** 1 passive (Mythic: 2 [T]) that counters 1 archetype, and a **"Bring"** chip with 2 archetypes that it favors.

Rotation rule [P]: the countered archetype is not the same as in the last 2 weeks. The favored archetypes change each week.
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
(decision 1, section 15) and the role scale k (a formula item, open decision 3). The CHECK is Lockdown (decision 2, section 15).

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
| Active | name + card text (8 to 14 words), as the card will show it |
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
| 4 | E7 | Monsters: new passives as data, foe moves, the Hunt boss template, counter bosses | Lab: each passive x each archetype. boss counters golden for v1 unchanged | Medium |
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
| Too much to read | 8-14 words per card, generated text, max 3 status icons, the visual language set before screens |
| Speed dominates | +3% a point, x1.30 from points, x1.6 total. the cap counts steps. measured: Speed best for 1 of 8 roles |
| Control locks a boss | One shared control immunity, 1-step boss control, the no-lock bound as a test |
| 203 abilities take too long or drift | The studio builder and the validator. batches by role. Nathan reviews tables, not free text |
| Rollback needed | One flag per mode. v1 stays until all three modes run on v2 |
| Member data in the public repo | Aggregates only in docs. review files with art and names stay in the private design repo |
