# Server Milestones — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

The whole server works toward shared goals. When the server reaches a goal, every member
who helped gets a reward.

## 1. Nathan's decisions (2026-10-02)

1. Server milestones: **daily, weekly, and season** goals.

## 2. The goals

Each period has 1 to 3 goals from a pool. The seed picks them.

| Period | Example goals |
|---|---|
| Daily | "Send 500 messages", "Clear 40 Dungeon rooms", "Defeat 2 Wandering Monsters" |
| Weekly | "Open 150 packs", "Win 100 Arena fights", "Deal 100% of the Hunt boss HP" |
| Season | "Ascend 50 cards to Silver", "Complete 20 Expeditions of 8 hours" |

- The goal size scales with the number of members who were active in the last period.
- A Wandering Monster that escapes takes a small part of the daily goal
  (`06-wandering-monsters.md`).

## 3. Who gets the reward

- A member must **contribute a minimum** to get the reward: for example, 1% of the goal,
  or one action of that type. A member who does nothing gets nothing.
- The rewards: daily 10 Shards, weekly 50 Shards, season 300 Shards and a Den decoration
  (a proposal).
- The weekly payout is on Sunday (`README.md`, Section 2).

## 4. The surface

- A progress bar on Home for each active goal, with the time left.
- The bot posts when the server reaches a goal: "🎉 The server opened 150 packs this week!
  Everyone who helped gets 50 Shards." with the **Open Lion Pride TCG** button.

## 5. Data

- `milestones(id, period daily|weekly|season, period_key, kind, target, progress,
  reached_at)`.
- `milestone_contrib(milestone_id, player_id, amount)`.
- Each mode adds to the progress inside its own RPC (one more update in the same
  transaction). A job pays the rewards when the period ends.

## 6. Flags and build phases

- Flag `FEATURE_MILESTONES`.

1. Daily and weekly goals from the modes that exist (messages, packs, the Hunt).
2. The season goals.
3. Goals from each new mode as it ships.

## 7. Open questions for Nathan

1. Does a goal that the server misses give a smaller reward, or nothing?
