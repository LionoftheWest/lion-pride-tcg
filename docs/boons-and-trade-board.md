# Boons and the Trade Board — Design

Status: DRAFT for Nathan's decisions (2026-09-27). Extends
[pve-and-social-design.md](./pve-and-social-design.md) Section 7 (boons first) and
the existing trades (`tcg-bot/supabase/trades.sql`).

## 0. The fact that shapes both designs

On 2026-09-27, 26 of 27 members had never opened the Activity. They read 0 of 138
bell notifications, and they opened 0 of 160 earned packs. They use Discord chat.

Nathan's rule (2026-09-27): **everything happens in the Activity. No commands.** So:

- Every action (boons, pranks, trades) is a screen in the Activity.
- The bot only POSTS in the notifications channel. Each post carries an
  **Open Lion Pride TCG** button (`launch:activity`, `interaction.launchActivity()`).
  The post shows the game to members in chat, and the button brings them in.
- The Activity UI rules stay: one window, no scrolling.

## 1. Boons (the positive half of the prank system)

A boon is a social card ability. A member plays an owned card ON another member.
The effect is positive. The bot announces each boon in the notifications channel.
The public post is the point: it shows the game to members who do not play yet.

### 1.1 The first three boons (no new bot permissions)

| Boon | Effect on the target | Where it acts |
|---|---|---|
| **Gift Pack** | +1 pack. The game makes the pack. It does not come from the player. | `grant_packs` |
| **Lucky Pull** | The target's next pack rolls one card at better odds (rare rates ×3). | `drawPack` in the bot |
| **Rally** | The target's next Hunt attack deals +25%. | `hunt_attack` |

DEFER: **Spotlight** (a 24h role needs the Manage Roles permission) and **Shield**
(it blocks pranks, and pranks do not exist yet).

### 1.2 Data

- `subjects.boon jsonb` — separate from `subjects.ability` (the Hunt ability). Shape:
  `{ "effect": "gift_pack" | "lucky_pull" | "rally", "amount": 1, "cooldown_hours": 168,
  "name": "...", "desc": "..." }`. Only some cards carry a boon.
- `boon_plays(id, player_id, card_id, target_id, effect, created_at)` — the log. It
  drives the cooldowns and the caps.
- `players.luck_charges int`, `players.rally_charges int` — the pending effects.
- One atomic RPC `play_boon(p_player, p_card, p_target)`. It checks ownership, the
  cooldown, and the caps, then applies the effect and writes the log.
- The portal edits `subjects.boon` (the rule in Section 11 of the tags design).

### 1.3 Anti-abuse (the real risk is two friends minting packs for each other)

- A cooldown for each card and each player (for example, Gift Pack 7 days).
- Each player can send at most 1 Gift Pack boon each day, across all cards.
- Each member can receive at most 2 boons each day.
- A player cannot target themself.
- Every play is logged and posted in public.

### 1.4 Surface (Activity)

- The card viewer shows the boon under the ability, with a **Play on a member**
  button and the cooldown.
- The button opens a member picker (the existing `/api/players` search), then a
  confirm step. The server calls `play_boon` with the verified Discord user.
- The bot posts: "🎉 **A** played **Card** on **@B**: Lucky Pull! B's next pack
  has better odds." with the **Open Lion Pride TCG** button.
- Flag `FEATURE_BOONS`, default OFF.

## 2. The Trade Board

Today a trade needs a direct offer to one named member. Nobody has used it. The
board lets a member post "I have X, I want Y", and the game finds the match.

### 2.1 Rules (unchanged)

- A trade stays in the same rarity. Gold never trades. `cards.tradeable = false`
  still locks a card.

### 2.2 Data

- `trade_listings(id, player_id, have_card_id, want_card_id null, want_rarity,
  status open|filled|cancelled, created_at, expires_at)`.
  `want_card_id = null` means "any card of this rarity that I do not own".
- A listing does not reserve the card. The existing `create_trade` checks
  `free_copies` when a match becomes an offer.
- Each member can have at most 5 open listings. A listing expires after 14 days.

### 2.3 Matching

- When a member posts a listing, the game looks for a reverse listing (B has Y and
  wants X, or wants any card of that rarity).
- On a match, the game creates a normal `trade_offers` row and @mentions both
  members. They accept with the existing flow.
- Any member can also fill a listing directly from the board.

### 2.4 Surface (Activity)

- The Trading tab gets a **Board** view: the open listings as a paged grid (no scroll).
- The card viewer gets **List for trade**: pick the card that you want (same rarity)
  or "any of this rarity".
- **My listings** shows your open listings with a cancel button.
- On a match, the bot @mentions both members with the **Open Lion Pride TCG** button.
- Flag `FEATURE_TRADE_BOARD`, default OFF.

## 3. Decisions for Nathan

1. Are the three first boons correct (Gift Pack, Lucky Pull, Rally)?
2. Which cards carry a boon? Proposal: about 20 support cards (Item, Place,
   Moment), spread across the rarities. A rarer card gets a shorter cooldown.
3. Are the caps correct (1 Gift Pack sent each day, 2 boons received each day)?
4. The trade board limits: 5 open listings, 14 days to expire?
5. The bot has player slash commands today (`/open`, `/collection`, `/card`, `/packs`,
   `/gift`, `/hub`, `/notifications`, `/ping`). Remove them, so the Activity is the only
   way to play? The admin commands (`/givepacks`, `/grantall`, `/packrate`,
   `/testpack`) stay, visible to admins only.
