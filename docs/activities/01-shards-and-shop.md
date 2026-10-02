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
5. **Shards can buy packs with no limit.** Shards may go around the 5-pack daily earn
   limit (`daily_cap_5.sql`). The member chooses: spend all the Shards on packs, or save
   them for cards and season items.
6. The anchor is 100 Shards for 1 pack **for now**. It changes as the earn rates of the
   modes become clear.
7. Shards buy a **stat reset**, not stat points. (Stat points buy power, and the power
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
| 1 pack | 100 | none (Section 4.1) |
| A Normal card from the **daily stock** | 150 | each stock card 1 time each day |
| An Illustrated Rare from the daily stock | 450 | each stock card 1 time each day |
| A Secret Rare from the daily stock | 1,500 | 1 time each day |
| A stat reset (one card) | 150 | none (the free reset each week stays) |
| Den decorations | 50 to 2,000 | none |
| Card flair and profile frames | 300 to 1,500 | none |
| **Season event:** specific Full Art cards | 6,000 | 1 for each member, each season |
| Gold | never sold | — |

### 4.1 Packs and the 5-pack limit

The 5-pack limit (`daily_cap_5.sql`) applies to EARNED packs only. A pack that a member
buys with Shards is a purchase, not an earning, so it does not count toward the limit
(Nathan, 2026-10-02). The ledger records it with the reason `shop`, so the pack economy
reports can still separate earned packs and bought packs.

The price of a pack is the main control. If members turn too many Shards into packs, the
fix is the anchor price, not a limit.

### 4.2 The daily stock (Nathan, 2026-10-02)

- The Shop never lets a member pick any card. It sells a **random stock that changes
  every day**.
- Each day at 00:00 MT, a seed picks the stock: 6 Normal cards, 3 Illustrated Rare cards,
  and 1 Secret Rare (a proposal).
- The stock is the same for all members. A member comes back each day to check it, and
  the members talk about it in chat ("the SR today is Meowscarada!").
- A member can buy a card that they do not own yet, or a card that they own already (a
  copy for ascension).
- Each stock card can be bought 1 time each day by each member.
- **A 7-day cooldown** (Nathan, 2026-10-02): after a card shows in the stock, it cannot
  show again for 7 days. On day 8 it can come back. The stock stays fresh, and every card
  returns over time.

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
- `shop_stock(day, slot, card_id, rarity, price)`: the daily stock.
- `shop_purchases(id, player_id, day, kind pack|card|stat_reset, slot, card_id, qty, price,
  created_at)`. A unique index allows each stock slot 1 time each day for each member.
- RPCs (built in PR #118, `tcg-bot/supabase/shards_shop.sql`):
  - `grant_shards(p_player, p_amount, p_reason, p_ref_kind, p_ref_id)`. The only writer of
    the balance. Only other RPCs call it. It never runs from a client request.
  - `shop_pick_stock(p_day)`: picks the stock for a day, one time (an advisory lock).
  - `shop_today(p_player)`: the balance, today's stock, and the prices.
  - `buy_shop_item(p_player, p_kind, p_slot, p_card, p_qty)`. It locks the player row,
    checks the balance and the limits, takes the Shards, gives the item, and writes the
    ledger and the purchase, in one transaction.
  - `convertible_copies(p_player, p_card)` and `convert_dupes(p_player, p_card, p_count)`.
    They keep 1 copy and the copies that ascension still needs, and they never convert a
    held copy.
- `settings.shards`: `{ enabled, pack_price, stat_reset_price, stock, prices,
  cooldown_days, max_packs_per_buy, dupe_values }`. Nathan can change a number without a
  deploy.
- The Season Full Art event and the decorations come later (Section 8).

## 6. The surface

- The top bar shows the Shard balance next to the pack count.
- A **Shop** view: the daily stock with a countdown to the next stock, the packs, the decorations,
  and the season event when it is open. A bought stock card shows "Bought today".
- A confirm step before each purchase.
- The Card Information view gets a **Convert extras** button on a Prestige card.

## 7. The balance test

A new `card-studio/scripts/shard-sim.mjs` plays a month for three members: a casual
member, an active member, and a member who does every activity at its limit.

It reports, for each member: the Shards earned each day, the packs that the Shards can
buy, and the days to save for one daily-stock Secret Rare. Nathan uses the report to set the
anchor price.

It fails if any path in the Shop gives a Gold or a Full Art card outside the season event.

## 8. Flags and build phases

- Flag `settings.shards.enabled`, default false. `SHARDS_USERS` lets Nathan test first.

1. The balance, the ledger, `grant_shards`, and `buy_item`, with the database test.
2. The Shop with packs and the stat reset.
3. The daily stock and `convert_dupes`.
4. The decorations and the flair (with the Den).
5. The season event for Full Art.

## 9. Open questions for Nathan

None. The daily stock size is approved (2026-10-02).
