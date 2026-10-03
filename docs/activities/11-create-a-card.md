# Create-a-Card Contest — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Members suggest new cards. The community votes. The winner becomes a real card in the
next card set, with credit to the member.

## 1. Nathan's decisions (2026-10-02)

1. The contest is approved.
2. **No image uploads.** Members send a text idea only. (The same reason as the sound
   library: nobody reviews an upload before the whole server sees it.)

## 2. The flow

1. **Submit** (2 weeks). Each member sends **one idea** in the Activity:
   - the card name,
   - the type (Character, Creature, Item, Place, Moment),
   - the idea (up to 300 characters): the moment, the in-joke, or the member's main,
   - optional: the boon or prank idea.
2. **Review.** Nathan sees the ideas in the Card Portal and approves or rejects each one.
   Only approved ideas go to the vote. The member gets a bell note with the result.
3. **Vote** (1 week). Each member gets **3 votes**. A member cannot vote for their own
   idea.
4. **The winner.** The top idea (or the top 3, Nathan decides) goes into the Card Studio
   pipeline for the next card set. The card shows "Idea by @member" in the credits.
5. The bot posts the start of each phase and the winner.

## 3. Privacy and safety

- The idea text is public after Nathan approves it. Before that, only Nathan sees it.
- The text goes through the same rules as a player report: `@` is broken (no pings) and
  `<` is escaped (`docs/player-reports.md`).
- One idea for each member in each contest.

## 4. Data

- `contests(id, phase submit|review|vote|done, submit_ends, vote_ends)`.
- `card_ideas(id, contest_id, player_id, name, type, idea, effect_idea, status pending|
  approved|rejected|winner, created_at)`.
- `idea_votes(contest_id, idea_id, player_id)`, with at most 3 for each member.

## 5. Flags and build phases

- Flag `FEATURE_CONTEST`.

1. Submit and the portal review.
2. The vote and the winner post.

## 6. Open questions for Nathan

1. One winner or the top 3?
2. One contest for each card set, or a different rate?
