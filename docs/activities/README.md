# New Activities — Overview

Status: DRAFT for Nathan's review (2026-10-02). Nothing here is built.

Nathan's goal: give the members more to do each day, and more reasons to play with
each other. This folder has one design doc for each new system. This file holds the
rules that all of them share, the weekly calendar, and the build order.

## 1. The systems

| # | System | Doc | Depends on |
|---|---|---|---|
| 1 | Shards and the Shop | [01-shards-and-shop.md](./01-shards-and-shop.md) | none |
| 2 | The fight engine and the monsters | [02-fight-engine.md](./02-fight-engine.md) | none |
| 3 | Dungeon Run (and Draft Dungeon) | [03-dungeon-run.md](./03-dungeon-run.md) | 1, 2 |
| 4 | PvP Arena | [04-pvp-arena.md](./04-pvp-arena.md) | 1, 2 |
| 5 | Expeditions | [05-expeditions.md](./05-expeditions.md) | 1 |
| 6 | Wandering Monsters | [06-wandering-monsters.md](./06-wandering-monsters.md) | 1, 2 |
| 7 | Mini games | [07-mini-games.md](./07-mini-games.md) | 1 |
| 8 | Weekly events (Group Pack Draft, Fantasy Draft Night) | [08-weekly-events.md](./08-weekly-events.md) | 1, 2 |
| 9 | Crews and seasons | [09-crews-and-seasons.md](./09-crews-and-seasons.md) | 1 |
| 10 | Server milestones | [10-server-milestones.md](./10-server-milestones.md) | 1 |
| 11 | Create-a-Card contest | [11-create-a-card.md](./11-create-a-card.md) | none |
| 12 | The Den | [12-the-den.md](./12-the-den.md) | 1 |
| 13 | Lore unlocks | [13-lore-unlocks.md](./13-lore-unlocks.md) | none |

## 2. The weekly calendar

Nathan (2026-10-02): something happens EVERY day. The core modes run every day. The
mini games and the events each own a day of the week.

| Day | Every day | The special of the day |
|---|---|---|
| Monday | Dungeon, Expeditions, Arena, Wandering Monsters | **Draft Dungeon** (everyone gets the same 10 cards) |
| Tuesday | the same | **Trivia Tuesday**: Who's That Card? and Whose Main? |
| Wednesday | the same | **Group Pack Draft** |
| Thursday | the same | **The Hunt spawns** (21:00 UTC, the window runs to Monday) |
| Friday | the same | **Fantasy Draft Night** (the draft, then the bracket) |
| Saturday | the same | **Fishing Derby** |
| Sunday | the same | **Memory Match**, and the weekly milestone payout |

The calendar is data (`settings.calendar`), not code. Nathan can move a game to another
day without a deploy.

## 3. Rules that every system obeys

These rules come from earlier decisions. A new system must not break them.

- **Everything happens in the Activity** (Nathan, 2026-09-27). The bot only posts, and
  each post has the **Open Lion Pride TCG** button.
- **No scrolling.** Every screen fits one window. Lists page. The design session designs
  each screen in pen.dev, and Nathan approves it before the build.
- **The server decides every result.** The client sends an action, the server resolves
  it, and the server writes the result. The client never sends a damage number, a score,
  or a reward.
- **Every change to a balance is one atomic RPC** (the `spend_pack` pattern). RLS is on,
  no policy exists, and only the service role calls the RPC.
- **Every system has a flag, default OFF**, and a `*_USERS` list, so Nathan tests it first.
- **No real losses.** Nothing takes away a card, a pack, or Shards that a member owns,
  except a purchase that the member confirms.
- **The game day is the MT clock** (`mt_clock.sql`).
- **The tech stack stays free** (Nathan, 2026-10-02). See Section 5.

## 4. The pack limit and Shards (a conflict, resolved)

Two decisions meet here:

- Nathan, 2026-09-30: a member can EARN at most 5 packs each day ("5 is tops",
  `daily_cap_5.sql`).
- Nathan, 2026-10-02: no daily limit on Shards, and the Shop sells packs.

Without a rule, Shards would go around the 5-pack limit. The resolution keeps both
intents: Shards have no daily limit, but the Shop sells at most a fixed number of packs
to each member each week (`01-shards-and-shop.md`, Section 4). The new modes give Shards,
not packs, so the 5-pack limit stays true.

## 5. The free stack (measured 2026-10-02)

| Resource | Free limit | Used now | Source |
|---|---|---|---|
| The Oracle A1 VM | 4 cores, 23 GB memory | about 1 GB memory, load 0.00 | observed (`nproc`, `free`, `docker stats`) |
| The Supabase database | 500 MB | 22 MB | observed (`pg_database_size`) |
| Supabase egress | 5 GB, plus 5 GB cached, each month | not measured | reported by pricing pages, not verified |

The rules that keep the stack free:

1. Each fight runs on the VM, in the Activity server (Node), not in a paid service.
2. A fight is stored as its seed plus the list of actions, not as frames. A replay runs
   the engine again from that data.
3. Old fight logs are pruned after each season. The largest table today is
   `hunt_combat_log` (2.3 MB).
4. The 3D models and the art go through the VM image cache (`/api/img`), so a member
   does not load them from Supabase each time.

## 6. The build order

1. Shards and the Shop. Every later mode needs a reward to give.
2. The fight engine, then the Dungeon Run. Draft Dungeon, Wandering Monsters, and Fantasy
   Draft Night use the same engine.
3. Expeditions.
4. The mini games.
5. The PvP Arena.
6. Crews, seasons, and server milestones.
7. The weekly events.
8. The Den.

Create-a-Card and Lore unlocks are mostly content and process. They can start at any time.
