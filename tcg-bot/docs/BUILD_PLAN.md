# Build Plan — Phase 1, the daily-draw spine

This plan builds the core loop only. It depends on `DESIGN.md` for every number.

## Scope

Each item is marked KEEP, DEFER, or CUT.

| Item | Mark | Reason |
|---|---|---|
| Supabase schema | KEEP | Nothing works without the tables. |
| Supabase client + env wiring | KEEP | The bot must connect to read and write. |
| Passive activity tracking | KEEP | The daily pack depends on the message count. |
| The draw algorithm | KEEP | This is the heart of the game. |
| `/open` — claim and open a pack | KEEP | The member's main action each day. |
| `/collection [player]` — show a collection | KEEP | The reward for collecting. |
| `/card <name>` from the database | KEEP | Replaces the seed JSON with real data. |
| An admin seed command for cards | KEEP | We need a way to add cards to test a draw. |
| Artist submissions | DEFER | Phase 2. Not needed for the loop. |
| Event / promo grant command | DEFER | Phase 2. |
| Achievement cards | CUT (blocked) | Achievements do not exist yet. |
| Web showcase | DEFER | Phase 4. The schema already supports it. |

## New dependency

- `@supabase/supabase-js` — the Supabase client.

## New environment variables

Add these to `.env` and to `.env.example`:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

The bot uses the service role key, because it writes on behalf of every member.
Keep this key secret. It is never shared with the web UI.

## New and changed intents

The bot must receive message events to count activity. Add the
`GuildMessages` intent in `src/index.ts`. This is **not** a privileged intent,
because the bot counts the event, not the message text. Do **not** add the
Message Content intent.

## Files to add or change

- `src/supabase.ts` — creates and exports the Supabase client from the env.
- `src/store.ts` — all database reads and writes: activity, packs, ownership.
- `src/draw.ts` — the pure draw algorithm. Rolls rarities, then picks cards.
- `src/events/messageCreate.ts` — raises the day's message count for the author.
- `src/commands/open.ts` — claims an earned pack and opens 5 cards.
- `src/commands/collection.ts` — shows a member's collection summary.
- `src/commands/card.ts` — change it to read the database, not `cards.json`.
- `src/commands/seed.ts` — an admin-only command to add a card. For testing.
- `src/index.ts` — register the message event and the `GuildMessages` intent.

## The draw algorithm (test this in isolation)

Put the rate table and the roll in `src/draw.ts` as a pure function. A pure
function is easy to test without Discord or Supabase.

- Input: the pool of draw cards, grouped by rarity.
- Output: an array of 5 chosen cards.
- Step 1: for each of 5 slots, roll a rarity against the rate table.
- Step 2: pick one card uniformly from that rarity's pool.
- Guard: if a rarity has no cards in the pool, fall back to Normal.

## Acceptance tests

1. **The rate roll is correct.** Roll the rarity 100,000 times with a fixed seed.
   Confirm that each tier's share is within a small tolerance of its rate.
2. **A pack has 5 cards.** Confirm that a draw returns exactly 5 cards.
3. **The empty-rarity guard works.** Give the pool no Gold cards. Confirm that a
   Gold roll falls back to Normal and never fails.
4. **The base pack is once per day.** Claim a base pack, then claim again the same
   UTC day. Confirm that the second claim is refused.
5. **The bonus needs 25 messages.** With 24 messages, confirm no bonus pack. With
   25, confirm one bonus pack.
6. **A duplicate raises the count.** Draw the same card twice. Confirm the owned
   quantity is 2, not two rows.

## Order of work

1. Run `schema.sql` in the personal Supabase project. Run the Advisors check.
2. Add the Supabase client and the env variables.
3. Build `src/draw.ts` and its tests first. It has no external dependency.
4. Build the store, the message event, and the commands.
5. Seed a few cards. Open a pack. Confirm the collection updates.
