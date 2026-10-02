# The Fight Engine and the Monsters — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

The Dungeon Run, Draft Dungeon, the PvP Arena, Wandering Monsters, and Fantasy Draft Night
all need fights. This doc describes one engine that all of them share, and the monsters
that they fight.

## 1. The facts today (observed 2026-10-02)

- The Hunt fight lives in SQL. `hunt_attack` is defined again in 17 migrations in
  `tcg-bot/supabase/`.
- `card-studio/scripts/combat-sim.mjs` is a separate Monte-Carlo model for balance. It is
  not the same rules as `hunt_attack`.
- The card stats come from SQL functions: `card_power`, `card_max_hp`, and `card_combat`
  (`stat_points.sql`). The stat points live on `player_cards.stat_points`.

## 2. The decision: a new engine in JavaScript

The new modes need a fight engine that runs thousands of times quickly (the Arena AI and
the seed check). SQL cannot do that. So:

- A new pure module, `tcg-activity/engine/`, runs every new fight. "Pure" means no
  database, no network, and no clock. The same input always gives the same result.
- It uses a seeded random generator. The seed and the list of actions replay a fight
  exactly.
- The Activity server (Node, on the VM) runs it. The client only shows the result.
- **The Hunt does not change.** It stays in SQL. A later project can move it to the
  engine, but this design does not need that.

## 3. One source for the card stats

The engine never computes a card's base stats itself. At the start of a fight, the
server reads each card's stats from SQL (`card_combat`, the ability, the tags, the
element) and puts a **snapshot** into the fight state. So the stat rules stay in one
place, and a stat change in SQL reaches every mode.

A test proves it: for each rarity and each star, the snapshot equals `card_combat()`.

## 4. The fight rules (the same feel as the Hunt)

The engine uses the Hunt turn model (`docs/battle-turn-based.md`):

1. The player turn: support cards act at once. An attack ends the turn.
2. The enemy turn: the enemy picks one action from its pool.
3. The round repeats until one side has no attacker left.

The engine implements the same effect primitives as the Hunt abilities (`empower`,
`shield`, `heal`, `weaken`, `expose`, `smite`, `stun`, `cleanse`, `lifesteal`, `execute`,
`rampage`, `pierce`, `focus`). Each mode adds its own rules on top (the dungeon modifiers,
the Arena rating), but the core stays the same.

**A parity risk:** the Hunt (SQL) and the engine (JavaScript) both implement the
primitives. They can drift apart. A shared test table lists each primitive with a fixed
input and its expected result, and both the SQL test and the engine test read it.

## 5. The compute budget (it must stay free)

The VM has 4 cores and 23 GB of memory, and it uses about 1 GB now (observed 2026-10-02).

| Work | Estimate |
|---|---|
| One Dungeon or Wandering Monster turn | under 1 ms |
| One Arena AI decision (look-ahead search) | a budget of 50 ms, then the AI stops and picks the best action so far |
| One full Arena fight | about 20 decisions, so about 1 second of CPU |
| A busy day: 200 members x 5 Arena fights | about 17 minutes of CPU in the whole day |
| The daily seed check (Dungeon) | a few seconds, one time each day |

Rules:

- The Arena AI runs in a worker thread, so a long search never blocks the server.
- Each search has a hard time budget. A search never runs without a limit.
- A fight row stores the seed and the actions, not the frames.

These numbers are estimates. The first build measures them (a benchmark script) before
the Arena ships.

## 6. The monsters

### 6.1 The art: free 3D packs (CC0)

Nathan asked for free 3D monster packs. These packs report the CC0 license (public
domain: any use, no credit required). Each license must be read on its page before use.

| Pack | Contents | Formats |
|---|---|---|
| [Quaternius: Ultimate Monsters](https://sketchfab.com/3d-models/ultimate-monsters-pack-fd72e114d119488da71fe3a16f216c4f) | about 50 monsters, with attack, death, walk, and run animations | Blend, FBX, OBJ, glTF |
| [Quaternius: LowPoly Animated Monsters](https://quaternius.itch.io/lowpoly-animated-monsters) | animated monsters (punch, attack, jump, fly, walk) | Blend, OBJ, FBX |
| [Quaternius: Textured Cute Monsters](https://opengameart.org/content/textured-cute-monster-pack) | 21 animated monsters | FBX, OBJ, Blend |
| [KayKit: Skeletons](https://kaylousberg.itch.io/kaykit-skeletons) | 4 rigged skeletons, 90+ animations, weapons | FBX, OBJ, DAE, glTF |
| [KayKit: Dungeon](https://kaylousberg.itch.io/kaykit-dungeon) | 200+ dungeon pieces and characters, for the rooms | FBX, OBJ, DAE, glTF |

**The recommendation:** Quaternius Ultimate Monsters as the main set. One artist made all
50, so the style is the same. The animations already include attack and death, which a
fight needs. glTF loads in the existing three.js boss code (`boss-model.js`). KayKit
Dungeon gives the room backgrounds.

**A style test first:** The Hunt bosses (Warrok, Mutant, Maw) are realistic models. These
packs are low-poly. Put three pack monsters next to a Hunt boss and a card, and Nathan
decides if the styles fit together. The other option is the Gemini sheet pipeline.

### 6.2 Many monsters from a few models

One model makes many monsters with these parts:

| Part | Example |
|---|---|
| The base model | Slime, Goblin, Skeleton, Bat |
| An element (a color tint and a particle effect) | Fire, Ice, Shadow |
| A modifier (a size, an aura, a trait) | Armored, Swift, Elite, Ancient |
| A name from the parts | "Armored Fire Slime" |

The element and the traits use the existing tag vocabulary, so the weaknesses and the
resistances of the Hunt work on monsters too.

### 6.3 Storage and loading

- CC0 permits redistribution, but the model files are large. They go in Supabase storage,
  not in git. The credits go in `docs/activities/monster-credits.md`.
- A member loads them through the VM image cache (`/api/img`), not from Supabase
  directly, to save the free egress.
- Each model loads only when a fight needs it (the `boss-lazy.js` pattern). A phone loads
  only the models of the current room.

## 7. Build phases

1. The engine core: the seeded random generator, the turn loop, the primitives, the
   snapshot, and the parity table. Tests only, no screen.
2. The style test and the first 10 monsters.
3. The benchmark script, before the Arena.
