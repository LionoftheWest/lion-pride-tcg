# Dungeon Run — Design

Status: **designs approved** (design 30, desktop + portrait + landscape, 2026-10-03). Being built.

Each day, every member takes one squad into a new dungeon. The squad fights through
floors and rooms that get harder, and the member sees how deep they can go.

## 1. Nathan's decisions (2026-10-02)

1. A new dungeon each day, from a seed. All members get the same dungeon that day.
2. **One run each day.**
3. The Dungeon is completely separate from the Hunt (its own squad, its own card HP).
4. Each day has a rule that limits the cards (a type, a tag, or a rarity), and the squad
   has a **budget**.
5. Floors give random rewards, and monsters drop random **loot**: Shards and cards. A
   deeper floor gives a better chance of an Illustrated Rare or a Secret Rare. **Full Art
   and Gold never drop.**
6. **One leaderboard**, its own board: the deepest point, for example "4F Room 3".
7. Simple monsters (`02-fight-engine.md`, Section 6).
8. **Draft Dungeon** is a second mode, where members learn the cards.

### Nathan's decisions (2026-10-03)

9. **The screens of design 30 are approved** (15 screens). Make the monsters **bigger** on screen.
10. **The same combat system as the Hunt** (`02-fight-engine.md`): supports use **cooldowns**, and the
    enemy's next move is a **surprise**.
11. **The budget stays by rarity** (Normal 1 ... Gold 5, budget 12): simple to explain. After launch,
    measure the leaderboard; if the same few Gold owners hold the top every day, change the costs (a
    setting).
12. **No loaner cards. A gate instead** (Section 3A): a member who has not redeemed the starter gifts
    or owns fewer than 8 attackers cannot start a Dungeon run or a Hunt squad.

## 2. The shape of a dungeon

- A dungeon has floors. Each floor has **5 rooms**.
- Rooms 1 to 4 are a mix of room types. Room 5 is the **floor guardian** (an elite).
- The dungeon has no last floor. The generator makes 30 floors, and the difficulty grows
  in each room. A squad is not expected to reach floor 30.

| Room type | What happens |
|---|---|
| Fight | 1 to 3 monsters |
| Elite | one strong monster with a better loot table |
| Treasure | pick 1 of 3 rewards, no fight |
| Rest | heal the squad, or remove one curse |
| Event | a short choice with a risk ("Open the cursed chest? +loot, -20% HP") |
| Guardian | room 5 of each floor: an elite with a second action |

## 3. The squad

- **5 cards** (Nathan, 2026-10-02).
- **The budget:** each card costs points by its rarity: Normal 1, Illustrated Rare 2,
  Secret Rare 3, Full Art 4, Gold 5. The daily budget is **12 points** (Nathan, 2026-10-02:
  try it and test it). So a
  member can bring one Gold card, but then the other cards must be cheap.
- **The daily rule** (from the seed). Examples: "Creatures and Items only", "Fire cards
  deal +25%", "No Gold today", "A budget of 8".
- The squad locks at the start of the run. Card HP stays through the whole run. A downed
  card stays down until a Rest room heals it.
- A copy on an Expedition cannot join the squad (`05-expeditions.md`).

## 3A. The unlock gate (the Hunt and the Dungeon, Nathan 2026-10-03)

Nathan: "what I don't want is a new player drawing some cards, go into the hunt / dungeon run and
not have redeemed all their cards or try to do it with a small squad."

- The Hunt and the Dungeon open when **both** are true:
  1. **The starter gifts are redeemed** (`gift_claims` kinds `new_player` and `launch_day`: none of
     the member's is still open; a member without a Launch Day gift needs only the first).
  2. **The member owns at least 8 attackers** (Character or Creature cards): a full Hunt squad of 8 and
     a Dungeon squad of 5.
- Unopened packs do NOT block the gate: on 2026-10-03, 6 veteran members had 1 unopened pack each.
- A locked tab shows a checklist with progress and a button for each step: "Redeem your starter gifts
  (0 / 2)" -> the bell; "Own 8 attackers (3 / 8)" -> OPEN.
- The server enforces it (the squad lock and the run start refuse with `locked`), not only the screen.
- Measured 2026-10-03: all 23 members who hit the boss in the last 7 days pass it (the smallest owns 39
  attackers); 13 of 43 members with cards own 0 to 3 attackers (new or never started).

## 4. Between rooms: the choice

After each cleared room, the member picks one of three offers. The seed makes the offers,
so all members see the same offers in the same room.

| Offer | Example |
|---|---|
| Heal | +30% HP to every card in the squad |
| A run buff | "Your attackers deal +10% for the rest of the run" |
| Loot | a chance at a card drop in the next room |
| Shards | a fixed number of Shards now |

The choices make each run a set of decisions, not only a check of the collection.

## 5. Loot

- Each defeated monster drops Shards.
- Each defeated monster has a chance to drop a card. The tier weights change with depth
  (a proposal, the simulation tunes it):

| Depth | Normal | Illustrated Rare | Secret Rare |
|---|---|---|---|
| Floors 1 to 3 | 100% | 0% | 0% |
| Floors 4 to 6 | 90% | 10% | 0% |
| Floors 7 to 9 | 80% | 18% | 2% |
| Floor 10 and deeper | 70% | 25% | 5% |

- Full Art and Gold never drop. Event, promo, and achievement cards never drop.
- The member keeps all loot when the squad falls. A run never loses its loot.

## 5A. Retreat (Nathan, 2026-10-02)

- Between rooms, the member can press **Retreat**. The run ends. The member keeps the
  depth that they reached and all the loot.
- A retreat and a fall give the same result. Retreat only lets a member stop when the
  squad cannot go farther, so they do not have to play out a lost fight.
- Retreat is not possible in the middle of a fight.

## 6. The daily seed

1. Each day at 12:00 MT, the bot makes the seed for the NEXT day: a hash of the date and
   a secret salt (`DUNGEON_SALT`, only in the VM `.env`). Members cannot calculate a
   future dungeon. The bot makes it a day early, so a failure has 12 hours to be fixed.
2. The generator builds the dungeon from the seed: the floors, the room types, the
   monsters (by tags), the offers, and the daily rule.
3. **The check.** The engine runs reference squads through the new dungeon. The reference
   squads come from the real roster (for example, the median member's best squad inside
   the budget). The seed is good if:
   - the median squad reaches floor 3 to 6,
   - no reference squad clears floor 15,
   - the best reference squad and the worst reference squad are at least 3 floors apart.
4. If a check fails, the bot tries the next salt. After 20 failures, it uses the last
   good generator settings and alerts Nathan.
5. The final dungeon goes in `dungeon_days`. It does not change during the day.

## 7. The leaderboard

- One board, separate from the other boards. The rank is the deepest point: the floor,
  then the room ("4F Room 3").
- A tie: fewer turns wins. Then the earlier finish wins.
- Two views of the one board: **Today** and **Season best**.
- Each row shows the squad that the member used. Members learn from the best runs.

## 8. Draft Dungeon (Monday)

- On Monday, the daily run IS the Draft Dungeon. The member still has one run.
- Every member gets the same **10 cards** from the seed. The member picks 5. The member's
  own collection does not matter, so a new member can beat a veteran.
- The draft cards come with their base stats (no stat points, no ascension).
- The loot is Shards only, because the cards are borrowed.
- The Card Information view shows the tips: which tags match today's monsters, and what
  each ability does. This is the mode where members learn the cards.
- Draft Dungeon has its own Today view on the board.

## 9. Data

- `dungeon_days(day date primary key, mode text, seed text, rule jsonb, floors jsonb,
  checked jsonb, created_at)`.
- `dungeon_runs(id, player_id, day, mode, squad jsonb, state jsonb, floor int, room int,
  turns int, status text, started_at, ended_at)`. One row for each member and day
  (a unique index).
- `dungeon_actions(run_id, n, action jsonb)`. The replay data.
- `dungeon_loot(run_id, kind, card_id, shards, created_at)`.
- Each action is one SQL RPC (`dungeon_attack`, `dungeon_support`, `dungeon_choose`,
  `dungeon_retreat`) that reads the run state, resolves it with the **shared combat core**
  (`combat_core.sql`, the same functions as the Hunt), and writes the new state, the action, and any
  loot, and grants the cards and the Shards, in one transaction. The client never sends a result.

## 10. The surface

- A **Dungeon** view in the dock: today's rule, the budget, the squad picker, and Start.
- The fight screen: the room background, the monsters, the squad row, the turn banner,
  and the big damage numbers (the Hunt rules).
- The map strip: the floor and the 5 rooms, with the current room lit.
- The offer screen between rooms: three cards to choose.
- The end screen: the depth, the loot, and the rank today.

## 11. Flags and build phases

- Flag `FEATURE_DUNGEON` and `DUNGEON_USERS`.
- The database switch `settings.dungeon.enabled` (default false): while it is false, every RPC refuses.

### The build (2026-10-03, branch `feat/combat-core`)

- SQL: `combat_core.sql` (the shared rules), `adventure_gate.sql` (the gate on the Hunt), `dungeon.sql`
  (the generator, the run, attack, support, choose, retreat, the leaderboard, the view). Apply in that order.
- Test: `card-studio/scripts/test-dungeon.mjs` (rolled back; 8 mutations must fail).
- Activity: `src/dungeon-routes.js`, `src/ui-v2-dungeon.js`, `src/ui-v2-gate.js`, `src/dungeon-stage.js`,
  `public/ui-v2-dungeon.css`. The dock button becomes **Adventure** (Hunt | Dungeon tabs) when the flag is on.
- The monsters: 10 Quaternius CC0 models from poly.pizza (`public/dungeon/monsters/`, `CREDITS.md`): Slime,
  Ooze, Skeleton, Zombie, Giant, Yeti, Demon, Golem, Squid, Raptor. The element tints each model. The
  Quaternius Google Drive refused the download (quota), so the files come from poly.pizza.
- The room log lives on the device for the session (the server keeps `dungeon_log`).

1. The generator and the seed check, as a script only.
2. The run, the fights, and the loot. Nathan tests.
3. The offers and the room types.
4. The leaderboard.
5. Draft Dungeon.

## 12. Open questions for Nathan

1. Do the season-best runs give a reward at the end of the season?

## 13. v2 (Nathan's test, 2026-10-03)

`tcg-bot/supabase/dungeon_v2.sql` on `combat_core.sql` (`combat_pool_act`). Test: `card-studio/scripts/test-dungeon.mjs`.

- Scaling (item 22): x1.42 HP and x1.22 ATK per floor. Guardian x4 HP, x1.7 ATK.
- Loot at risk (item 12): kill Shards, drops, chests, and rewards go to `state.pend`. The floor guardian moves pend to `state.bank` and adds 10 x floor Shards. A fall loses pend. Retreat works only on the `floor_done` screen. All loot is granted once, at the end (`dungeon_settle`). Cap: 300 Shards per run.
- Rewards (item 7): 3 offers with a tier (Common 60, Uncommon 25, Rare 10, Ultra 4, Legend 1). Kinds: heal, buff, shards, card, ward, reset, revive. The last kind picked cannot come back next. Heal and revive work once per floor.
- Rooms (items 14, 15): fight, horde, elite, miniboss, treasure (a chest of a tier), rest, choice (doors). The view shows "?" for the rooms ahead, except the guardian.
- Combat (items 9, 17, 20): support cooldowns carry over between rooms. One support per turn (`one_support`). Each monster type has a named move pool.
- UI: the room map with "?", the at-risk and banked counters, the reward tiers, the chest, the doors, the "Floor cleared" screen (Descend or Retreat), the move names, the element icon on each plate, and one fixed row of status icons under each card.
- Item 13: each card attack plays the Raid effect of its element (attack-fx.js) on the target; each monster move plays a Raid boss effect.
- Item 16: Auto (a toggle in the arena, remembered). One useful support per turn, then the best attack (a weakness hit first). It stops at every choice. Auto runs count on the board.
- Item 19: src/dungeon-music.js plays one CC0 track per mood (explore, fight, boss) with a mute button. TRACKS stays empty (no button, no sound) until Nathan picks the tracks.
- Fix (dungeon_v2_fix.sql): the squad falls when no attacker stands (support cards alone left the run stuck).
- Landscape: no room log column, a thin plate band, the monsters spread over the width.
- Chest card odds (dungeon_chest_odds.sql, settings.dungeon.chest_rarity, weights Normal / IR / SR): Uncommon 80/18/2, Rare 55/38/7, Ultra 35/50/15, Legend 15/50/35. The card chance stays 0 / 35 / 60 / 100 / 100%. The dark door chest uses the Ultra odds.
- Reward card odds (dungeon_reward_odds.sql): a card reward after a room uses the same odds by its tier. The rarity rolls when the card is picked; the offer shows the odds ("15% Normal · 50% IR · 35% SR").

## Gauntlet (Nathan, 2026-10-03)

The weekly skill mode on the same Dungeon engine (`tcg-bot/supabase/gauntlet.sql`).

- **The week:** Sunday to Saturday, America/Denver (`gauntlet_week(day)` = the Sunday). One squad and one dungeon for the whole week, the same for everyone (`gauntlet_weeks`).
- **The squad** (`gauntlet_squad(week)`, seeded by the salt and the week):
  - 3 attackers (Character / Creature) and 2 supports (another type with a support move).
  - 5 different characters ("A's Link" and "B's Link" never pair).
  - No Event or Promo card (`gauntlet_pool()`). Every other rarity can appear, Gold too.
  - The cost stays within the budget (12), as close to it as possible. A Gold card (5) leaves 7 points for the other 4.
  - The theme: a support affinity tag that at least 3 attackers carry. All 3 attackers carry it, and the supports match it (the x1.8 ally boost and the team scale). With no theme, any attackers, and supports that match them where possible.
  - All cards play at base level (no ascension, no stat points). Nobody needs to own them.
- **The runs:** one Gauntlet run a day (`dungeon_runs.mode = 'gauntlet'`). The best run of the week counts. A member can also play the daily Dungeon on the same day.
- **No loot:** no Shards or cards from kills, rooms, or the guardian. No treasure rooms, no chest doors. The room rewards (heal, damage, ward, reset, revive) still work.
- **The boards:** `dungeon_board(day)` (the daily Dungeon only) and `gauntlet_board(week)` (each member's best run of the week).
- **The prizes** (`settings.dungeon_prizes`, all tunable; paid once per period by the hourly pg_cron job `dungeon-prizes`):

| Place | Daily Dungeon | Weekly Gauntlet |
|---|---|---|
| 1st | 300 Shards | 500 Shards + 5 packs + 3 cards (70% IR / 30% SR) |
| 2nd | 200 Shards | 300 Shards + 3 packs + 2 cards (60% Normal / 32% IR / 8% SR) |
| 3rd | 150 Shards | 200 Shards + 2 packs + 1 card (75% Normal / 25% IR) |
| 4th-10th | 50 Shards | 1 pack |

The daily Dungeon prizes are Shards only: packs are for the weekly Gauntlet only (Nathan, 2026-10-03, `dungeon_prizes_daily.sql`). Each prize card rolls its own rarity on the place's odds. Every winner gets a notification.

- **Flags:** `settings.gauntlet.enabled` (the mode) and `settings.dungeon_prizes.enabled` (the payouts, with `from` = the first day to pay). Both default to false.
- **Test:** `card-studio/scripts/test-dungeon.mjs` sections 16 and 17 (mutations g*).
- **Preview:** `discord-ui-preview/dgga.py` (every Gauntlet screen at a size: no scroll, no bleed).
