# Weekly Events — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Two events, each on its own day of the week: **Group Pack Draft** (Wednesday) and
**Fantasy Draft Night** (Friday).

## 1. Nathan's decisions (2026-10-02)

1. Group Pack Draft is a weekly event, not a voice-channel game.
2. Fantasy Draft Night is a one-night weekly event, "kinda like a fantasy league".
3. The events happen on specific days.

## 2. Group Pack Draft (Wednesday)

Members open a shared set of packs together and take turns to pick the cards.

1. **Sign up** until 18:00 MT on Wednesday, in the Activity.
2. At 18:00, the game makes **pods of 4 to 6 members**.
3. Each pod gets **one event pack for each member** (the game makes the packs). The pod
   sees all the cards at once.
4. **The snake draft:** the members pick one card at a time, in an order that reverses
   each round (1-2-3-4, 4-3-2-1). Each member gets 5 cards.
5. **A pick timer:** 60 seconds. When it ends, the game picks the best card left for the
   member, so a member who is away does not stop the pod.
6. Each member keeps the cards that they picked.
7. The bot posts the best pull of each pod.

**The pack budget:** each member gets 5 cards, the same as one pack. The event packs count
as one event pack, not as an earned pack, so the 5-pack daily limit stays true. They use
the normal pack odds.

## 3. Fantasy Draft Night (Friday)

Members draft squads from a shared pool, and then the squads fight in a bracket.

1. **Sign up** until 19:00 MT on Friday.
2. At 19:00, the game shows **one shared pool** of cards from the seed. The cards are
   borrowed for the night (base stats, no stat points).
3. **The live snake draft:** each member picks 4 cards, with a 45-second pick timer.
4. **The bracket:** the engine fights the squads in a single-elimination bracket. A fight
   is automatic (both sides use the AI from `04-pvp-arena.md`).
5. **The show:** the members watch each fight as a replay in the Activity, one round of
   the bracket at a time. The feed shows the results.
6. **The rewards:** Shards by the place, and a weekly title for the winner ("Friday
   Night Champion").

**The fantasy league part (a later option):** the Friday results add up over a season.
The season champion gets a frame.

## 4. Data

- `events(id, kind, day, signup_closes, starts_at, status, seed)`.
- `event_entries(event_id, player_id, pod int, seat int, created_at)`.
- `draft_picks(event_id, pod int, n int, player_id, card_id, auto boolean, created_at)`.
- `bracket_fights(event_id, round, slot, a_id, b_id, seed, actions jsonb, winner_id)`.
- The pick RPC checks the turn order and the timer on the server. An automatic pick uses
  the same RPC.

## 5. Flags and build phases

- Flag `FEATURE_EVENTS` and `EVENT_USERS`.

1. Group Pack Draft (it reuses the pack opening and needs no fight).
2. Fantasy Draft Night, after the Arena AI exists.

## 6. Open questions for Nathan

1. Are 18:00 MT (Wednesday) and 19:00 MT (Friday) good times?
2. A pod of 4 to 6: correct?
3. If too few members sign up (for example 2), does the event still run?
