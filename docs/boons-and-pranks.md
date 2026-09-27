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

## 3A. Real Discord effects (Nathan, 2026-09-27)

Nathan wants real pranks and boons in Discord too, not only in the Activity. The
member still plays the card in the Activity. The Activity calls the bot's internal
endpoint (the same pattern as pack opening), and the bot does the Discord action.

### Discord pranks

| Primitive | What happens in Discord | Limit | Permission |
|---|---|---|---|
| `nickname` | The nickname changes to a name from the card's fixed list, for example "Keeb the Clown". | 1 hour, then the bot restores it | Manage Nicknames |
| `timeout` | A Discord timeout. The member cannot type or talk. | 60 seconds at most | Moderate Members |
| `ping_parade` | The bot @mentions the target, with the card art, several times. | 3 pings over 5 minutes, in one prank channel | none |
| `reaction_storm` | The bot reacts with the card's emoji to the target's next messages. | the next 5 messages, within 1 hour | Add Reactions |
| `voice_corner` | The bot moves the target from their voice channel to a "Prank Corner" voice channel. | once, the member can move back | Move Members |
| `clown_role` | A colored "Clown" role. | 1 hour | Manage Roles |

### Discord boons

| Primitive | What happens in Discord | Limit | Permission |
|---|---|---|---|
| `crown` | A "👑" goes in front of the nickname. | 24 hours | Manage Nicknames |
| `spotlight_role` | A shown-separately, colored "Spotlight" role at the top of the member list. | 24 hours | Manage Roles |
| `hype` | The bot posts a hype message about the target, with the card art. | once | none |
| `color_role` | The target picks a name color. | 24 hours | Manage Roles |

### Voice-channel pranks and boons (Nathan, 2026-09-27)

| Primitive | What happens | Limit | Difficulty |
|---|---|---|---|
| `vc_mute` | A server mute in voice. | 30 seconds, then the bot unmutes | Easy (Mute Members) |
| `vc_deafen` | A server deafen in voice. | 30 seconds | Easy (Deafen Members) |
| `speak_sound` | When the target speaks, the bot plays the card's sound (for example a fart) in that channel. | 60 seconds, at most 5 sounds, at least 5s apart | Hard (see below) |
| `entrance_sound` | When the target joins a voice channel, the bot plays a sound. As a prank, the card picks the sound. As a boon, the target picks it from the library. | the next 3 joins, or 24 hours | Medium |

How the bot plays a sound:
- It joins the voice channel, plays a short Ogg Opus file, and leaves.
- `@discordjs/voice` 0.19.2 supports Discord's voice encryption (DAVE) through
  `@snazzah/davey`, and a `linux-arm64-gnu` build exists for the VM (checked 2026-09-27).
- Ogg Opus files play without ffmpeg and without a native Opus encoder.
- The bot needs the GuildVoiceStates intent (not privileged), plus Connect and Speak.

Hard limits that come from Discord:
- **The bot can be in only ONE voice channel in the server at a time.** So only one
  sound prank can run at a time. The others wait in a queue, or they are refused.
- **`speak_sound` needs voice RECEIVE** to know when the target speaks. discord.js
  says that voice receive is not officially supported by Discord, so it can break
  after a Discord change. We build it last, behind its own flag, `FEATURE_VOICE_SPEAK`.
- Everyone in the channel hears the sound, not only the target. So a sound prank
  needs the target in Prank Zone, and it counts as a prank on the whole room for the caps.

The sound library:
- Sounds come only from a curated library in the repo (at most 5 seconds each, volume
  normalized, so there is no ear-rape). The portal attaches a sound to a card.
- Members do not upload sounds. An upload could be anything, and nobody reviews it
  before it plays to a whole room. A later option: members submit a sound, and an
  admin approves it in the portal.

### How the bot undoes each effect

- `discord_effects(id, play_id, target_id, kind, original_value, expires_at, reverted_at)`.
- A loop in the bot runs every 30 seconds and at each start. It reverses each expired
  effect, so a restart cannot leave a member renamed.
- The bot restores a nickname only if the member did not change it again. The bot
  never overwrites a name that the member chose.
- Discord ends a timeout by itself.
- Each action writes an audit-log reason: "Lion Pride TCG: @A played <card>".
- An admin **Undo all** button reverses every active Discord effect at once.
- The kill switch is the flag `FEATURE_DISCORD_EFFECTS`, default OFF.

### Who cannot be targeted (Discord rules and ours)

- The server owner. No bot can do this.
- Each member whose highest role is at or above the bot's role. Today that is almost
  everyone (Section 3B).
- Mods and admins (our rule).
- Members who did not opt in (Section 5).

### Discord's rules

- Discord's developer policy forbids spam and harassment. An unlimited ping storm or
  repeated timeouts on one member can get the bot flagged or removed. So the limits
  above are hard limits in the database, not settings in the Activity.
- A member can report the bot. The consent rule (Section 5) is our main protection.

## 3B. Server changes that only Nathan can make

1. **Move the bot's role.** Server Settings > Roles: drag "Lion Pride TCG" above the
   member roles (Pokemon Unite, Super Smash Bros, Memes, and the others), and below
   "Lion Pride Mod" and the admin roles. Today the bot is below 28 of 30 roles.
2. **Remove Administrator from the bot (recommended).** Give it only: View Channels,
   Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions,
   Manage Nicknames, Manage Roles, Moderate Members, and Move Members. Today the bot
   has Administrator. With Administrator, a leaked token or a bug can do anything in
   the server.
3. Make a "Prank Corner" voice channel and a prank text channel. The bot can also
   make them after you approve.

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

- **Two levels of consent:**
  - **In-Activity pranks** (stickers, titles, confetti): every member can receive
    them, unless the member turns on **Prank Shield** in the Activity profile.
  - **Discord pranks** (nickname, timeout, pings, voice move, clown role): only for
    members who turned on **Prank Zone** in the Activity profile (opt-in). These act
    on the member's real Discord account, so the member must agree first.
  - Boons (in the Activity and in Discord) never need consent.
- Discord prank caps per target: 2 each day, 1 timeout each day, 1 nickname at a time.
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

1. Discord pranks: opt-in with **Prank Zone** (recommended), or open to everyone with
   an opt-out? Are the limits correct (60s timeout, 1h nickname, 3 pings in 5 min)?
2. Is the type split correct (Moment = prank, Character and Creature = boon, Place = room)?
3. Do you want the namesake bonus? If yes, somebody must map each namesake card to a
   Discord member. I can draft the map from the names, and you correct it.
4. Does the bot post every play, or one daily digest ("Today: 14 boons, 9 pranks. Top
   giver: @A")? A post for every play can flood the channel when many members play.
5. Are the caps in Section 4.2 correct?
6. Will you make the two server changes in Section 3B (move the bot role, and remove
   Administrator)? Without the role move, the Discord pranks cannot touch most members.
7. Voice: is the order correct (mute and deafen first, entrance sounds second,
   "sound when they speak" last, behind its own flag)? Curated sounds only?
