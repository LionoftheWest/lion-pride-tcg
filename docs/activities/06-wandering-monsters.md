# Wandering Monsters — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

At random times, a monster appears in chat for a short time. All members fight it
together in the Activity. This brings members in during the day, not only at the reset.

## 1. Nathan's decisions (2026-10-02)

1. The flow in this doc is approved.
2. The monster is a model from the Dungeon set (`02-fight-engine.md`, Section 6).

## 2. The flow

1. **The spawn.** The bot posts a picture in the notifications channel: "👹 A Goblin Thief
   appeared! 15:00". The post has the **Open Lion Pride TCG** button.
2. **The live post.** The bot edits the post every 10 seconds: the HP bar, the time left,
   and the number of hunters. (Every 10 seconds stays inside Discord's edit rate limits.)
3. **In the Activity.** A banner shows at the top of every screen, with the countdown. One
   tap opens the fight.
4. **The fight.** The member quick-picks 3 cards, and fights 3 rounds with the shared
   engine. No squad lock. Each member fights once for each spawn.
5. **Co-op.** All members hit one shared HP pool. The feed shows each hit.
6. **The end.**
   - The monster falls in time: each member who hit it gets Shards by their share of the
     damage (a minimum for each hunter). The bot posts the result picture with the top 3.
   - The monster escapes: no Shards. The monster "steals" a small part of today's server
     milestone (`10-server-milestones.md`).

## 3. The spawns

- **2 to 4 spawns each day**, at random times between 09:00 and 23:00 MT.
- A spawn is more likely when chat is active (the bot already counts the messages).
- At least 2 hours between two spawns. Only one monster at a time.
- No spawn in the last hour of a Hunt window, so the two events do not compete.
- The time and the monster come from a daily seed that the server keeps secret.

## 4. The monster

- The model is a Dungeon monster in its **Elite** form: bigger, with an aura.
- The HP scales with the members who were active in the last hour, so a quiet afternoon
  is still winnable.
- Each monster has 1 or 2 weak tags, so the right cards matter.

## 5. Data

- `wandering_spawns(id, day, monster jsonb, hp int, hp_left int, opens_at, closes_at,
  status, message_id)`.
- `wandering_hits(spawn_id, player_id, damage, cards bigint[], actions jsonb, created_at)`,
  with one row for each member and spawn (a unique index).
- `wandering_hit(p_spawn, p_player, ...)` writes the hit and lowers `hp_left` in one
  locked transaction. `wandering_close(p_spawn)` pays the Shards.

## 6. Flags and build phases

- Flag `FEATURE_WANDERING` and `WANDERING_USERS`. The posts: `FEATURE_WANDERING_POSTS`.

1. The spawn job and the shared HP, Activity only (no post).
2. The post and the live edits.
3. The result picture.

## 7. Open questions for Nathan

1. 15 minutes for each spawn: correct?
2. Must the escape "steal" from the milestone, or does an escape only give no reward?
