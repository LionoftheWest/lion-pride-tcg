# Dungeon Run — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

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
- The RPCs only write. The engine runs in the Activity server. Each action:
  1. The server reads the run state.
  2. The engine resolves the action.
  3. One RPC writes the new state, the action, and any loot, and it grants the cards and
     the Shards in the same transaction.

## 10. The surface

- A **Dungeon** view in the dock: today's rule, the budget, the squad picker, and Start.
- The fight screen: the room background, the monsters, the squad row, the turn banner,
  and the big damage numbers (the Hunt rules).
- The map strip: the floor and the 5 rooms, with the current room lit.
- The offer screen between rooms: three cards to choose.
- The end screen: the depth, the loot, and the rank today.

## 11. Flags and build phases

- Flag `FEATURE_DUNGEON` and `DUNGEON_USERS`.

1. The generator and the seed check, as a script only.
2. The run, the fights, and the loot. Nathan tests.
3. The offers and the room types.
4. The leaderboard.
5. Draft Dungeon.

## 12. Open questions for Nathan

1. Do the season-best runs give a reward at the end of the season?
