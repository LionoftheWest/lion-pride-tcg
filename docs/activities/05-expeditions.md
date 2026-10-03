# Expeditions — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

A member sends cards from the collection on timed missions. The cards come back with
rewards. The cards that sit in the collection now get a use, and the member comes back
during the day.

## 1. Nathan's decisions (2026-10-02)

1. Expeditions use the member's cards to get rewards.
2. **A card on an Expedition cannot join any squad**: not the Hunt, the Dungeon, or the
   Arena. The member must pick which cards to send.

## 2. The mission board

- Each day at midnight MT, the seed makes **6 missions**. All members see the same
  missions.
- A member can run **3 missions at the same time** (the Den can add a slot later, as a
  PvE boost).
- Each mission has:

| Part | Example |
|---|---|
| A name and a place | "Clear the Goblin Caves" |
| A duration | 1 hour, 4 hours, or 8 hours |
| A size | 2 to 4 cards |
| Requirements (tags, types, or rarity) | "2 Water cards and 1 Place", "at least one Illustrated Rare" |
| Bonus goals | "+50% if a Fire card goes" |
| Rewards | Shards, and a chance at a Normal or an Illustrated Rare card |

- A team that meets every requirement gets the full reward. Each bonus goal adds more.
- A longer mission gives more for each hour, so a member who comes back at night picks
  an 8-hour mission.

## 3. The lock (a new kind of held copy)

The Trading Hall already holds copies: a copy in an auction or a bid cannot go into a
trade or an ascension (`free_copies`, `hall_auctions.sql`). An Expedition is one more
kind of hold:

- `free_copies` subtracts the copies on an active Expedition.
- A copy on an Expedition cannot go into a squad, a trade, an auction, a bid, or an
  ascension.
- **A busy copy cannot go on an Expedition.** A copy is busy when it is in today's Hunt
  squad, an active Dungeon run, or the Arena defense squad.
- A member who owns 3 copies can send 1 copy and still use the other 2.

## 4. The flow

1. The member opens **Expeditions** and picks a mission.
2. The member picks the cards. The picker shows which requirements each card meets, and
   it grays out busy and held copies.
3. **Send.** The cards leave, with a countdown.
4. When the time ends, the bell shows "Your Expedition is back". The member presses
   **Collect** to get the rewards. The cards come back.
5. **Recall:** the member can call the cards back early. They come back with no reward.

## 5. Data

- `expedition_days(day, seed, missions jsonb)`.
- `expeditions(id, player_id, day, mission_no, cards bigint[], started_at, ends_at,
  status active|collected|recalled, reward jsonb)`.
- RPCs: `start_expedition(p_player, p_day, p_mission, p_cards)` checks the requirements,
  the free copies, the busy copies, and the 3-slot limit in one transaction.
  `collect_expedition(p_player, p_id)` checks `ends_at`, rolls the reward from a seed
  stored at the start, grants it, and frees the cards.
- The reward is rolled at the start and stored, but not shown. So a member cannot recall
  and start again to get a better roll.

## 6. Flags and build phases

- Flag `FEATURE_EXPEDITIONS` and `EXPEDITION_USERS`.

1. The hold in `free_copies` and the busy checks, with a database test (including a
   mutation of the new guard).
2. The mission generator and the board.
3. Collect, recall, and the bell.

## 7. Open questions for Nathan

1. 6 missions each day and 3 slots: correct?
2. Can a member get an Illustrated Rare from an Expedition, or only Shards and Normal
   cards?
