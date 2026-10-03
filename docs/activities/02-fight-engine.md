# The Fight Engine and the Monsters — Design

Status: **the combat core is built** (branch `feat/combat-core`, 2026-10-03, not applied yet).
Decisions by Nathan, 2026-10-03.

The Hunt, the Dungeon Run, Draft Dungeon, the PvP Arena, Wandering Monsters, and Fantasy Draft
Night all need fights. This doc describes the one combat system that all of them share, and the
monsters that they fight.

## 1. Nathan's decisions (2026-10-03)

1. **One combat system for the Hunt, the Dungeon, and the Arena**: "the same systems running
   underneath ... really lock down across the whole underlying system".
2. **Supports use cooldowns** (in rounds), the same as the Hunt. No energy.
3. **The enemy's next move is a surprise**, the same as the Hunt (only the Cataclysm charge shows
   one round ahead).

## 2. The design: one SQL combat core

The first plan was a new JavaScript engine next to the Hunt's SQL engine, with a parity test.
That is two engines that can drift apart. Nathan's decision replaces it:

- **Every combat rule lives in one set of SQL functions** (`tcg-bot/supabase/combat_core.sql`):
  `combat_weak` (weakness / resistance), `combat_squad` (the weak-tag stack and the element,
  origin and trait synergies), `combat_crit_chance`, `combat_hit` (miss, crit, block, damage,
  Execute, Rampage), `combat_lifesteal`, `combat_enemy_mult`, `combat_enemy_act` (the enemy
  action), `combat_area_roll` (Slam / Cataclysm on each other card), `combat_absorb` (shields),
  `combat_burn`, `combat_thorns`, `combat_regen`, `combat_aff_scale`, `combat_support_value`,
  `combat_stun_immune`.
- **A mode keeps only its storage.** The Hunt keeps its tables (`hunt_card_hp`,
  `hunt_combat_state`); the Dungeon keeps its run state; the Arena keeps its fights. Each mode
  calls the same core functions, so a rule change applies to all of them at once.
- **The Hunt is rebuilt on the core with no change in behavior**: the live `hunt_attack` and
  `hunt_support` (2026-10-03) by exact text replacement, with the same formulas, numeric types,
  and order of every random roll.
- **The Arena AI** must test thousands of moves quickly, which SQL cannot do. It gets a
  JavaScript copy of the core that only CHOOSES moves; the SQL core decides every real result. A
  parity test plays the same random fights through both and fails on any difference.

## 3. The lockdown test

`card-studio/scripts/combat-golden.mjs` plays **84 seeded fights** on the live database (every
boss action and passive, all 8 support effects, crit / miss / block, burn, double strike, the 50%
rage, phase 2, defeat, cooldowns, the stun immunity) through the live code and through a
candidate, records every result and every database change (1,580 lines), rolls everything back,
and fails on the first difference. It runs on one frozen snapshot (repeatable read), so a change
that another process commits during the run cannot reach it.

Measured 2026-10-03: live vs live 5 / 5 PASS; live vs `combat_core.sql` 5 / 5 PASS (identical);
a +1 damage mutation FAILS at the first hit (21 vs 22). Run it before any change to the core.

**A known fact of the live Hunt (kept as it is):** a Slam or Cataclysm rolls each other card's
damage in the order that the database reads the rows; the code gives no fixed order. It is fair,
only unordered. Changing it would change the Hunt.

## 4. One source for the card stats

The core never computes a card's base stats itself. Each mode reads them from SQL
(`card_combat`: power, HP, crit, potency, haste with the stat points; the ability; the tags),
so a stat change reaches every mode.

## 5. The fight rules (the Hunt turn model)

1. The player turn: support cards act at once and go on cooldown. An attack ends the turn.
2. The enemy turn: the enemy draws one action (a surprise).
3. The round repeats until one side has no attacker left (or the round limit).

The primitives: `empower`, `shield`, `heal`, `weaken`, `expose`, `smite`, `stun`, `cleanse`
(supports); `lifesteal`, `execute`, `rampage`, `pierce`, `focus` (attack abilities). Each mode
adds its own rules on top (the dungeon rule and loot, the Arena rating), never inside the core.

## 6. The compute budget (it must stay free)

The VM has 4 cores and 23 GB of memory, and it uses about 1 GB now (observed 2026-10-02).

| Work | Estimate |
|---|---|
| One Dungeon or Wandering Monster turn (SQL core) | a few ms (one RPC) |
| One Arena AI decision (look-ahead search) | a budget of 50 ms, then the AI stops and picks the best action so far |
| One full Arena fight | about 20 decisions, so about 1 second of CPU |
| A busy day: 200 members x 5 Arena fights | about 17 minutes of CPU in the whole day |
| The daily seed check (Dungeon) | a few seconds, one time each day |

Rules:

- The Arena AI runs in a worker thread, so a long search never blocks the server.
- Each search has a hard time budget. A search never runs without a limit.
- A fight row stores the seed and the actions, not the frames.

These numbers are estimates. Nathan (2026-10-02): the project must stay free, but we can
test the limits. So the first build measures them with a benchmark script on the VM
before the Arena ships. The benchmark also runs a load test: many fights at the same
time, to find the point where the server slows down.

## 7. The monsters

### 7.1 The art: free 3D packs (CC0)

Nathan asked for free 3D monster packs. These packs report the CC0 license (public
domain: any use, no credit required). Each license must be read on its page before use.

| Pack | Contents | Formats |
|---|---|---|
| [Quaternius: Ultimate Monsters](https://sketchfab.com/3d-models/ultimate-monsters-pack-fd72e114d119488da71fe3a16f216c4f) | about 50 monsters, with attack, death, walk, and run animations | Blend, FBX, OBJ, glTF |
| [Quaternius: LowPoly Animated Monsters](https://quaternius.itch.io/lowpoly-animated-monsters) | animated monsters (punch, attack, jump, fly, walk) | Blend, OBJ, FBX |
| [Quaternius: Textured Cute Monsters](https://opengameart.org/content/textured-cute-monster-pack) | 21 animated monsters | FBX, OBJ, Blend |
| [KayKit: Skeletons](https://kaylousberg.itch.io/kaykit-skeletons) | 4 rigged skeletons, 90+ animations, weapons | FBX, OBJ, DAE, glTF |
| [KayKit: Dungeon](https://kaylousberg.itch.io/kaykit-dungeon) | 200+ dungeon pieces and characters, for the rooms | FBX, OBJ, DAE, glTF |

**The decision (Nathan, 2026-10-02):** Quaternius is the main monster set. KayKit
Skeletons and KayKit Dungeon are approved for skeleton enemies and the room pieces.

- One artist made all 50 Quaternius monsters, so the style is the same.
- The animations already include attack and death, which a fight needs.
- glTF loads in the existing three.js boss code (`boss-model.js`).
- These packs are low-poly, and the Hunt bosses are realistic. Nathan accepts the
  difference ("it's fine if they are a little less graphically nice").

### 7.2 Many monsters from a few models

One model makes many monsters with these parts:

| Part | Example |
|---|---|
| The base model | Slime, Goblin, Skeleton, Bat |
| An element (a color tint and a particle effect) | Fire, Ice, Shadow |
| A modifier (a size, an aura, a trait) | Armored, Swift, Elite, Ancient |
| A name from the parts | "Armored Fire Slime" |

The element and the traits use the existing tag vocabulary, so the weaknesses and the
resistances of the Hunt work on monsters too.

### 7.3 Storage and loading

- CC0 permits redistribution, but the model files are large. They go in Supabase storage,
  not in git. The credits go in `docs/activities/monster-credits.md`.
- A member loads them through the VM image cache (`/api/img`), not from Supabase
  directly, to save the free egress.
- Each model loads only when a fight needs it (the `boss-lazy.js` pattern). A phone loads
  only the models of the current room.

## 8. Build phases

1. ~~The combat core and the lockdown test~~ **done** (2026-10-03, `feat/combat-core`).
2. The Dungeon on the core (`03-dungeon-run.md`). The rebuilt Hunt goes live with it; the
   lockdown test runs right before the migration is applied.
3. The first 10 monsters from Quaternius (bigger on screen, Nathan 2026-10-03), and the room
   pieces from KayKit Dungeon.
4. The JavaScript copy of the core for the Arena AI, its parity test, and the benchmark and
   the load test, before the Arena.
