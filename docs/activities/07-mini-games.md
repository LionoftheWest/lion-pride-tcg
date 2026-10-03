# Mini Games — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Four short games. Each game owns a day of the week (`README.md`, Section 2), and each
gives Shards.

## 1. Nathan's decisions (2026-10-02)

1. Keep: **Who's That Card?**, **Whose Main?**, **Memory Match**, and **Fishing**.
2. Cut: Higher or Lower.
3. The rewards are Shards.
4. The mini games happen on specific days, not every day.

| Day | Game |
|---|---|
| Tuesday | Trivia Tuesday: Who's That Card? and Whose Main? |
| Saturday | Fishing Derby |
| Sunday | Memory Match |

## 2. Shared rules

- **One scored play** for each game on its day. A member can play again for fun, but only
  the first play counts.
- **The server holds the answers.** The client never gets an answer before the member
  guesses. (See the image rule in Section 3.)
- Each game has a Today leaderboard. The top 3 get bonus Shards.

## 3. Who's That Card? (Tuesday)

- 10 rounds. Each round shows a part of a card's art: a silhouette, a zoomed crop, or a
  blurred image.
- The member picks the name from 4 choices. A faster answer gives more points.
- **The image rule:** the card art URLs contain the card's name (observed 2026-10-02:
  `card-art/cards/heero-s-meowscarada-secret_rare.webp`). So the server
  makes each crop or silhouette and serves it under a random token for that round. The
  client never sees the real URL until the round ends.
- The seed picks the same 10 cards for everyone that day.

## 4. Whose Main? (Tuesday)

- 10 questions: "Which member mains Incineroar?" The member picks from 4 members.
- It teaches new members who is who in the community.
- **It needs data:** the cards name the member in text ("Kaminari's Incineroar"), but no
  field links a card to the member's Discord account. The portal gets a new field,
  `subjects.member_id`, and Nathan fills it. Only cards with a member link appear in
  this game.

## 5. Memory Match (Sunday)

- A grid of card backs (4x4, 8 pairs). The member flips two at a time to find pairs.
- The score: the time plus a penalty for each wrong flip.
- The server shuffles and reveals each card on each flip, so the client cannot read the
  layout early.

## 6. Fishing Derby (Saturday)

- The member casts a line at the Lion's Den pond. A timing bar shows. A tap at the right
  moment catches the fish.
- **20 casts** on Saturday.
- Each catch has a size and a rarity (common fish, rare fish, a treasure chest, junk).
  The server rolls each catch.
- The Shards come from the catches. The **Derby board** ranks the biggest single catch.
- The pond art can come from the KayKit or Quaternius packs (`02-fight-engine.md`).

## 7. Data

- `minigame_days(day, game, seed, content jsonb)`. The content stays on the server.
- `minigame_plays(id, player_id, day, game, score, details jsonb, scored boolean,
  created_at)`, with one scored row for each member, day, and game.
- `minigame_finish(p_player, p_day, p_game, ...)` checks the answers on the server, writes
  the score, and grants the Shards.

## 8. Flags and build phases

- Flag `FEATURE_MINIGAMES` and `MINIGAME_USERS`. Each game also has its own switch in
  `settings.minigames`, so one game can be turned off.

1. Who's That Card? (the cheapest, and it proves the image rule).
2. Memory Match.
3. Whose Main? (after Nathan fills `subjects.member_id`).
4. The Fishing Derby.

## 9. Open questions for Nathan

1. Is 20 casts on Saturday correct for the Fishing Derby?
2. Do you want the mini games only on their day, or also playable for fun on the other
   days (with no Shards)?
