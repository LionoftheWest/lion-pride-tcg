# TCG Bot — Design and Economy

This document records the locked design decisions. Change a number here first,
then change the code. The build plan lives in `BUILD_PLAN.md`.

## What this is

A collection game for a Discord community. The value is the art, the lore, and
the rarity. Cards are not for battling. The core loop is:

> Be active each day → earn a pack → open it → collect the cards → show the collection.

## Locked decisions

- **Rarity is a finish.** Each rarity finish is its own card. Gold Ember Fox and
  Normal Ember Fox are two separate collectibles that share one subject.
- **Storage is the personal Supabase project.** It is never an R3VCORE project.
- **A daily unit is a pack of 5 cards.**
- **A duplicate raises the owned count.** There is no crafting currency.

## Rarity tiers

Normal, Illustrated Rare, Secret Rare, Full Art, and Gold.

## The five rarities and their pull rates

Each card in a pack rolls independently against this table.

| Rarity | Per-card rate |
|---|---|
| Normal | 93.8% |
| Illustrated Rare | 5% |
| Secret Rare | 0.6% |
| Full Art | 0.4% |
| Gold | 0.2% |

The rates total 100%.

### How often each tier lands

| Rarity | Casual (1 pack/day) | Active (2 packs/day) |
|---|---|---|
| Secret Rare | ~1 per month | ~2 per month |
| Full Art | ~1 per 7 weeks | ~1–2 per month |
| Gold | ~1 per 3+ months | ~1 per 7 weeks |

## The daily draw

- **Base pack:** a member who posts at least one message in a day earns one pack.
- **Bonus pack:** a member who posts at least **25 messages** in a day earns a
  second pack.
- A member claims a pack with the `/open` command. The bot checks the day's
  activity and grants the pack if it is earned and unclaimed.
- **A day resets at 00:00 UTC.** This is a starting choice. It is easy to change
  to a community timezone later.

## The draw algorithm

For each of the 5 cards in a pack:

1. Roll a rarity against the pull-rate table.
2. Select one card uniformly at random from the cards that have that rarity, that
   sit in the draw pool (`in_draw_pool = true`), and whose source is `draw`.
3. If the member already owns that card, raise the owned count. If not, add it.

Cards with source `achievement`, `event`, or `promo` never enter the draw pool.
An admin grants them by hand (a later feature).

## Card sources

- `draw` — the normal pool. These are the only cards a pack can produce.
- `achievement` — earned by a Discord achievement. **Blocked**: achievements are
  not implemented yet.
- `event` — a promo for an event winner. An admin grants it.
- `promo` — any other hand-granted card, such as an artist reward.

## Roadmap

- **Phase 1 (the spine):** the schema, the card catalog, activity tracking, the
  daily pack, `/open`, and `/collection`. See `BUILD_PLAN.md`.
- **Phase 2:** artist submissions and an admin grant command for event promos.
- **Phase 3 (blocked):** achievement promo cards, after achievements exist.
- **Phase 4:** the web showcase that reads the same Supabase data.
