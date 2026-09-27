# Boons and Pranks — Design

Status: DRAFT for Nathan's decisions (2026-09-27). Replaces Section 1 of
[boons-and-trade-board.md](./boons-and-trade-board.md). The trade board moves to a
dedicated session.

Nathan's goals:
- Every card carries a boon or a prank.
- Each card is individual.
- The system is deep and interactive between members.
- It is balanced: no loops and no broken combinations.
- Everything happens in the Activity. No commands.

## 1. How each card stays individual without new code for each card

The engine knows a small, fixed set of **effect primitives** (Section 3). Each card
picks ONE primitive and makes it its own with these parts:

| Part | Example |
|---|---|
| A name and a text in the card's voice | "Breakfast Blessing: Blade serves you beans on toast." |
| Numbers inside the budget for its rarity | +1 luck charge, cooldown 72h |
| A **tag condition** (optional) | Stronger if the target owns a `trait:fire` card |
| A **namesake bonus** (optional) | Stronger if played ON the member that the card is named after |
| Its own visual | The card's own art is the sticker, the confetti, or the badge |

So 127 cards give 127 different plays, but the engine has only about 15 things to
balance.

**The namesake bonus** is the deepest social hook. Many cards are named after members
("LionoftheWest's Pichu", "Keeb's Mii Gunner", "Blade's Beans on Toast"). A card played
on its namesake gets a bonus (for example, a double effect) and a special post:
"@A played **Keeb's Mii Gunner** on @Keeb himself!" This needs a map from each card
to the namesake's Discord ID. The portal gets that field.

## 2. Which cards get a boon, and which get a prank

The card **type** sets the flavor (from pve-and-social-design.md, Section 7):

| Type | Count | Gets | Flavor |
|---|---|---|---|
| Moment | 54 | Prank | Chaos, in-jokes |
| Character | 32 | Boon | Help a friend |
| Creature | 18 | Boon | Luck |
| Item | 7 | Boon or prank | Tools and tricks |
| Place | 7 | Room effect | Everyone in the room (the Activity voice-channel room) |
| No type yet | 9 | — | Give them a type first |

That is about 57 boons, 58 pranks, and 7 room effects.

## 3. The effect primitives

### Boons

| Primitive | Effect on the target |
|---|---|
| `lucky_pull` | The next pack: one card rolls on a better table (rare rates ×N). |
| `gift_pack` | +1 pack, made by the game. The strongest cap applies (Section 4). |
| `rally` | The next Hunt attack: +X% damage. |
| `mend` | Heals one of the target's damaged Hunt cards for today. |
| `ward` | Blocks the next prank on the target. |
| `spotlight` | 24h: a glow and a title on the target's profile and showcase, in the Activity. |

### Pranks (in the Activity only, cosmetic or social, never a loss)

| Primitive | Effect on the target |
|---|---|
| `sticker` | 24h: the card's art sits on the target's profile and showcase for all to see. |
| `title` | 24h: a silly title under the target's name, written by the card. |
| `jinx` | The next pack reveal plays in "cursed" style (upside down, spooky sound). The cards do not change. |
| `confetti` | The next time the target opens the Activity, the card's art bursts over the screen. |
| `swap_showcase` | 24h: the target's showcase shows a random Normal card. |

### Counters and neutral effects (they make it interactive)

| Primitive | Effect |
|---|---|
| `reflect` | The next prank on the target bounces back to its sender. A reflected prank cannot bounce again. |
| `cleanse` | Removes all pranks from the target now. |
| `wheel` | A random boon or prank from the same rarity. The wheel never picks `wheel`. |
| `duet` | The sender and the target both get the same small boon. |

### Room effects (Place cards)

| Primitive | Effect |
|---|---|
| `room_rally` | Everyone in the sender's voice-channel room: +X% on the next Hunt attack. |
| `room_confetti` | Everyone in the room sees the card's art burst. |

## 4. Balance: no loops, no broken combinations

### 4.1 Rules in the engine (every card obeys them)

1. **No effect causes another effect.** The only exception is `reflect`, and a
   reflected prank cannot be reflected. So no chain can run forever.
2. **No effect changes a cooldown.** Nothing resets, shortens, or refunds a cooldown.
3. **No effect gives something back to its sender.** Only `duet` touches the sender,
   and its sender part is a small, fixed boon that no card can raise.
4. **Pending effects do not stack.** A target holds at most 1 luck charge, 1 rally,
   and 1 ward. Another play of the same kind is refused.
5. **Every play is one atomic database call** (`play_card_effect`). It checks
   ownership, the cooldown, the caps, and the shield in one transaction.

### 4.2 Caps

| Cap | Proposal |
|---|---|
| The cooldown for each player and each card (it stays with the player after a trade) | 24h to 7 days, set by rarity and effect |
| Plays that a member can SEND each day | 5 |
| Boons that a member can RECEIVE each day | 3 |
| Pranks that a member can RECEIVE each day | 2 |
| `gift_pack`: packs made in total, per member, per week (sent + received) | 2 |
| The same sender on the same target | once each day |
| A pair who play on each other | Each week, the second and later mutual boons give half the effect (this stops two friends from farming) |
| Hunt bonus from boons, per member, per day | at most +25% in total |

### 4.3 The power budget by rarity

A rarer copy of the same card is stronger, or its cooldown is shorter. A Normal copy
still does the full effect type, so every member can play.

| Rarity | Effect size | Cooldown |
|---|---|---|
| Normal | ×1.0 | the longest |
| Illustrated Rare | ×1.15 | −15% |
| Secret Rare | ×1.3 | −25% |
| Full Art | ×1.3 | −30% |
| Gold | ×1.5 | −40% |

### 4.4 The balance test

A new `card-studio/scripts/boon-sim.mjs` plays these strategies against the real rules:

- two friends who play gift and luck on each other every day,
- a group of 5 who all target one member with pranks,
- a member who plays every card as soon as its cooldown ends.

The test fails if a member can get more than the weekly pack cap, more than the prank
cap in a day, or a guaranteed Gold from luck. A static check also fails if any
primitive can cause another primitive, except `reflect` at depth 1.

## 5. Consent and safety

- **Prank Shield** is a toggle in the Activity profile. When it is on, pranks cannot
  target that member. Boons still can.
- Admins and mods can be exempt (a decision for Nathan).
- A member can remove a prank from themself one time each day ("Shake it off").
- Every play is logged (`card_plays` table), so an admin can see and undo any play.
- A prank never removes cards, packs, or Hunt progress.
- The titles are chosen from a fixed list that each card defines. Members never type
  free text, so nobody can write an insult into another member's title.

## 6. The flow in the Activity

1. The card viewer shows the card's boon or prank under its Hunt ability: the name,
   the text, the cooldown, and a **Play on a member** button. For a Place card, the
   button is **Play on the room**.
2. The member picker shows the members who can receive it now. Shielded members and
   members at their cap are grayed out, with the reason.
3. A confirm step, then the effect shows at once.
4. The target sees it the next time they open the Activity (a banner: "@A played
   **Card** on you!"). The target can press **Thank**, **Shake it off**, or play a card
   back.
5. The bot posts it in the notifications channel with the **Open Lion Pride TCG** button.

## 7. Data

- `subjects.effect jsonb`: `{ kind: boon|prank|counter|room, primitive, name, desc,
  amount, cooldown_hours, condition?: { tag }, namesake?: { discord_id, bonus } }`.
- `card_plays(id, player_id, card_id, target_id, primitive, amount, reflected, created_at)`.
- `player_effects(player_id, primitive, amount, source_play_id, expires_at, consumed_at)`.
- `players.prank_shield boolean default false`.
- The portal edits `subjects.effect` (the portal is the only edit surface).
- Flags, default OFF: `FEATURE_CARD_EFFECTS` (the Activity), with a separate flag for
  pranks: `FEATURE_PRANKS`.

## 8. Build phases

1. The schema, `play_card_effect`, the caps, and `boon-sim.mjs`.
2. The boons: `lucky_pull`, `rally`, `mend`, `ward`, `spotlight`, `gift_pack`.
3. The Activity flow (Section 6) and the bot post.
4. The pranks and the counters, behind `FEATURE_PRANKS`.
5. The room effects.
6. Write all 127 cards: a draft script picks the primitive from the type and the tags,
   I write each name and text, and Nathan edits them in the portal.

## 9. Decisions for Nathan

1. Pranks in the Activity only (cosmetic, no Discord permissions)? Or also in Discord,
   for example a nickname change (this needs the Manage Nicknames permission)?
2. Is the type split correct (Moment = prank, Character and Creature = boon, Place = room)?
3. Do you want the namesake bonus? If yes, somebody must map each namesake card to a
   Discord member. I can draft the map from the names, and you correct it.
4. Does the bot post every play, or one daily digest ("Today: 14 boons, 9 pranks. Top
   giver: @A")? A post for every play can flood the channel when many members play.
5. Are the caps in Section 4.2 correct?
