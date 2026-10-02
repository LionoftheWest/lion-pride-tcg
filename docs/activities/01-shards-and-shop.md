# Shards and the Shop — Design

Status: DRAFT for Nathan's review (2026-10-02). Not built.

Shards are a currency that members earn in the new modes and spend in the Shop.

## 1. Nathan's decisions (2026-10-02)

1. Shards are the reward of the new modes. The new modes give Shards, not packs.
2. **No daily limit** on the Shards that a member earns. The calendar limits the
   activities instead (each mode has a fixed number of plays, see Section 3).
3. **Gold is never in the Shop.**
4. **Full Art is not in the normal Shop.** One time each season, a special event sells
   specific Full Art cards at a high Shard price.
5. Shards buy a **stat reset**, not stat points. (Stat points buy power, and the power
   would go into the Arena. `docs/card-stats.md` requires that the points give the same
   total strength as the old fixed star bonus.)

This replaces the rule "Rewards are packs. No new currency" in
`pve-and-social-design.md` Section 1.

## 2. The anchor price

Every price comes from one anchor: **100 Shards = 1 pack.** All the numbers below are a
proposal. The simulation (Section 7) tunes them.

## 3. Sources (where members earn Shards)

Each source has a fixed number of plays, so the total stays finite without a daily limit.

| Source | The limit on plays | Proposed Shards |
|---|---|---|
| Dungeon Run | 1 run each day | 5 for each room cleared, plus monster loot |
| Draft Dungeon (Monday) | 1 run | the same as the Dungeon |
| Expeditions | 3 slots at a time | 20 (1 h), 60 (4 h), 110 (8 h) |
| PvP Arena | 5 tickets each day | 15 for each win, 5 for each defense win |
| Wandering Monsters | 2 to 4 spawns each day | 10 to 30, by the share of the damage |
| Mini games | 1 scored play on their day | 20 to 60, by the score |
| Weekly events | 1 each week | 50 to 200, by the place |
| Server milestones | daily, weekly, and season goals | 10 / 50 / 300 |
| Extra duplicates | each copy above the copies that ascension needs | Normal 5, IR 15, SR 40, FA 100, Gold 250 |

**Extra duplicates:** A card at Prestige (5 stars) gets no value from a new copy today.
The member can convert those copies to Shards in the Card Information view. The game
always keeps 1 copy, so a member cannot lose the card. The conversion is a confirmed
action, and the member must press it.

## 4. The Shop

| Item | Proposed price | Limit |
|---|---|---|
| 1 pack | 100 | **at most 3 each week for each member** (Section 4.1) |
| A Normal card of the member's choice | 150 | none |
| An Illustrated Rare of the member's choice | 450 | 2 each week |
| A Secret Rare from the **featured stock** | 1,500 | 1 each week |
| A stat reset (one card) | 150 | none (the free reset each week stays) |
| Den decorations | 50 to 2,000 | none |
| Card flair and profile frames | 300 to 1,500 | none |
| **Season event:** specific Full Art cards | 6,000 | 1 for each member, each season |
| Gold | never sold | — |

### 4.1 Why the pack limit is weekly

Nathan set a limit of 5 earned packs each day (`daily_cap_5.sql`). If the Shop sells
packs with no limit, Shards go around that limit. A weekly Shop limit keeps the 5-pack
rule true and still lets a member turn saved Shards into packs.

### 4.2 The featured stock

Each Monday at 00:00 MT, the Shop picks a new featured stock from a seed: 6 Normal cards,
3 Illustrated Rare cards, and 1 Secret Rare. The stock is the same for all members. A
member comes back each week to check it, and the members talk about it in chat.

### 4.3 What is never in the Shop

- Gold cards.
- Event, promo, and achievement cards (`special_cards_never_in_packs.sql`).
- Cards that are not in the draw pool.
- Anything that gives power in the Arena (stat points, Den boosts).

## 5. Data

- `players.shard_balance int not null default 0`.
- `shard_ledger(id, player_id, amount, reason, ref_kind, ref_id, created_at)`. Each
  change to a balance writes one row. The `reason` values are fixed: `dungeon`,
  `expedition`, `arena`, `wandering`, `minigame`, `event`, `milestone`, `dupes`, `shop`,
  `admin`.
- `shop_items(id, kind, card_id, price, weekly_limit, season_limit, starts_at, ends_at)`.
- `shop_purchases(id, player_id, item_id, price, created_at)`.
- RPCs:
  - `grant_shards(p_player, p_amount, p_reason, p_ref_kind, p_ref_id)`. Only other RPCs
    call it. It never runs from a client request.
  - `buy_item(p_player, p_item)`. It locks the player row, checks the balance and the
    limits, takes the Shards, gives the item, and writes the ledger and the purchase, in
    one transaction.
  - `convert_dupes(p_player, p_card, p_count)`. It checks `free_copies` and keeps 1 copy.
- `settings.shards`: `{ enabled, pack_price, pack_weekly_limit, dupe_values, ... }`.
  Nathan can change a number without a deploy.

## 6. The surface

- The top bar shows the Shard balance next to the pack count.
- A **Shop** view: the featured stock, the packs, the cards to choose, the decorations,
  and the season event when it is open. Each item shows its limit ("2 of 3 left this
  week").
- A confirm step before each purchase.
- The Card Information view gets a **Convert extras** button on a Prestige card.

## 7. The balance test

A new `card-studio/scripts/shard-sim.mjs` plays a month for three members: a casual
member, an active member, and a member who does every activity at its limit. It fails if:

- the active member can buy a Secret Rare of their choice in less than about 2 weeks,
- the member who does everything gets more than about 2 pack-values of Shards each day,
- any path in the Shop gives a Gold or a Full Art card outside the season event.

## 8. Flags and build phases

- Flag `settings.shards.enabled`, default false. `SHARDS_USERS` lets Nathan test first.

1. The balance, the ledger, `grant_shards`, and `buy_item`, with the database test.
2. The Shop with packs, chosen cards, and the stat reset.
3. The featured stock and `convert_dupes`.
4. The decorations and the flair (with the Den).
5. The season event for Full Art.

## 9. Open questions for Nathan

1. Is 100 Shards = 1 pack a good anchor?
2. Is 3 Shop packs each week correct?
3. Must a member own a card before they can buy it, or can the Shop sell a card that the
   member does not own yet?
