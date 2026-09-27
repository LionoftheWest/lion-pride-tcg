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
| Its own visual | The card's own art is the sticker, the confetti, or the badge |

So 127 cards give 127 different plays, but the engine has only about 15 things to
balance.

## 2. Each card gets the effect that fits THAT card (Nathan, 2026-09-27)

There is no split by type. Each card gets the boon or prank that fits the card itself:
its subject, its joke, its game. For example, a bowling ball card knocks the target
into Prank Corner, and a breakfast card gives a boon. I draft all 127 from each card's
name, lore, and tags. Nathan edits them in the portal.

No namesake bonus (Nathan): it would let members spam one person.

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

### Neutral effects (see Section 3C)

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
  counts as a prank on the whole room for the caps.

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
- A member can report the bot. The hard limits and the target caps are our protection.

## 3B. Server changes that only Nathan can make

1. **Move the bot's role.** Server Settings > Roles: drag "Lion Pride TCG" above the
   member roles (Pokemon Unite, Super Smash Bros, Memes, and the others), and below
   "Lion Pride Mod" and the admin roles. Today the bot is below 28 of 30 roles.
2. **Replace Administrator with these 16 permissions (recommended).** Permissions
   integer: `1102094650432`.

   | Permission | What it is for |
   |---|---|
   | View Channels | see the channels |
   | Send Messages | every post |
   | Embed Links, Attach Files | the card art in posts |
   | Read Message History, Add Reactions | the reaction storm |
   | Use External Emojis | card emojis |
   | Use Application Commands | the admin commands |
   | Connect, Speak | join voice and play sounds |
   | Mute Members, Deafen Members | voice mute and deafen |
   | Move Members | the Prank Corner move |
   | Manage Nicknames | rename, crown |
   | Manage Roles | the clown, spotlight, and color roles |
   | Moderate Members | timeout |

   The bot also needs the GuildVoiceStates gateway intent. That intent is not
   privileged, so it needs no Developer Portal change.

3. Make a "Prank Corner" voice channel and a prank text channel. The bot can also
   make them after you approve.

## 3C. Neutral cards: the third group (Nathan, 2026-09-27)

A Neutral card is neither a boon nor a prank. It changes what happens to OTHER plays.
It replaces the "counters" group (ward, reflect, cleanse are now Neutral).

### React to a play (set in advance on yourself or a friend)

| Primitive | Effect |
|---|---|
| `reflect` | The next prank on the holder goes back to its sender. |
| `redirect` | The next prank on the holder goes to a random member, or to a member named when the card is played. |
| `decoy` | The next prank hits a cardboard cutout. The post says "Direct hit!", but nothing happens. |
| `delay` | The next prank on the holder lands 1 hour later. |
| `ward` | The next prank on the holder does nothing. |
| `boomerang` | The next boon that the holder SENDS returns as a small fixed copy (never a pack or a card). |

### Act on active effects

| Primitive | Effect |
|---|---|
| `cleanse` | Removes all pranks from the target now. |
| `hijack` | Moves one active boon from the target to the sender. |
| `trade_places` | Swaps one active prank of the sender with one active boon of the target. |
| `body_swap` | The sender and the target swap nicknames for 1 hour. |
| `freeze` | All effects on the target pause for 1 hour, then continue. |

### Chance and passing

| Primitive | Effect |
|---|---|
| `mystery_box` | A random boon or prank of the same rarity. It never picks itself. |
| `hot_potato` | A timer that members pass. It goes off on the holder at the end. |
| `chain_letter` | Pass it within 1 hour, or it goes off on the holder. |
| `duel` | Both members pick a card. The higher card wins, and the loser gets the winner's effect. |

### Safety rules for Neutral cards

1. **Depth 1.** A Neutral effect changes a play at most once. A reflected prank cannot
   be redirected, and a redirected prank cannot be reflected. No ping-pong is possible.
2. **Neutral effects create no value.** They move, block, delay, swap, or end effects
   that exist. The one exception is `boomerang`: a small fixed copy, never a pack or a card.
3. **The caps count where an effect lands** (the boon-sim finding for `reflect`).
4. **A fixed order** when a member holds several: decoy, ward, reflect, redirect, delay.
5. **A Neutral effect cannot act on a Neutral effect** (no reflect of a reflect, no
   hijack of a ward).
6. **Passing ends:** at most 5 passes and 1 hour.

## 3D. The raid boss layer (Nathan, 2026-09-27)

Boons, pranks, and Neutral cards can also change a member's Hunt fight. Each one acts
on the target's NEXT Hunt attack (or on today's squad), and it is used up then.

### Hunt boons

| Primitive | Effect |
|---|---|
| `rally` | The next attack deals +X% damage. |
| `crit_charm` | The next attack has +X% crit chance. |
| `weak_lens` | The next attack counts as a match to one of the boss's weaknesses. |
| `card_shield` | One squad card blocks the boss's next hit. |
| `mend` | Heals one damaged squad card by X HP. |
| `second_wind` | Brings back one downed squad card for today. |
| `insight` | Shows the next boss's weaknesses before it spawns. |
| `squad_buddy` | +10% for both the sender and the target, if both attack today. |

### Hunt pranks

| Primitive | Effect |
|---|---|
| `butterfingers` | The next attack deals -X% damage. |
| `fumble` | The next attack misses. |
| `no_crit` | The next attack cannot crit. |
| `aggro` | The boss's next counter-attack hits the target's squad twice as hard. |
| `tired_card` | One of the target's squad cards starts today with -X HP. |
| `resist_curse` | The next attack counts as a match to one of the boss's resistances. |

### Hunt Neutral cards

| Primitive | Effect |
|---|---|
| `taunt` | The boss's next counter-attack on the holder goes to another member's squad. |
| `double_or_nothing` | The next attack: 50% for x2 damage, 50% for a miss. |
| `mirror_match` | The next attack deals the same damage as the target's last attack. |
| `delay_strike` | The next attack lands 1 hour later, with +10%. |

### Rules for the raid layer

1. **No reward loss (Nathan: no permanent issues).** A Hunt prank lowers the damage that
   hits the boss. The target's CREDITED damage (the base for reward packs and the
   leaderboard) stays at the full value. The prank slows the shared fight. It never
   takes packs from the target.
2. **Daily limits for each member:** Hunt boons add at most +25% in total each day.
   Hunt pranks remove at most -25% in total each day. At most one `fumble` each day.
3. **No stacking** of the same Hunt effect (the engine rule 4.1.4).
4. **The same Neutral rules** (3C): depth 1, and no Neutral on Neutral.
5. **One hook in `hunt_attack`.** The attack calls one function that reads and uses up
   the attacker's Hunt effects, and returns the damage multiplier, the flags (miss,
   no crit, weak match), and the credited multiplier. The rest of `hunt_attack` stays.
6. **The boss HP stays fair.** The simulation must show that a server can still beat a
   boss in its window when members prank each other at the caps.

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

### 4.2 Cooldowns and caps

**The cooldown is the main limit (Nathan).** Each card has its own cooldown, and a
rarer copy has a shorter one (4.3). The cooldown belongs to the player and the card,
not to the copy, so a trade does not reset it.

A cooldown alone leaves gaps. So these limits exist too, as settings that Nathan can
tune (0 turns a limit off):

| Limit | Why the cooldown cannot do it | Default |
|---|---|---|
| Plays that one member SENDS each day | A member with 60 cards can play 60 cards in one minute, each on its own cooldown. | 10 |
| Pranks that one member RECEIVES each day | 20 members can all prank the same person in the same minute, each with a ready card. | 5 (of these, 2 Discord timeouts) |
| The same sender on the same target each day | One member can target the same person with every card. | 3 |
| Packs made by `gift_pack` per member per week | Two friends can mint packs for each other forever. | 2 |

### 4.3 Tier scaling (dynamic, for each card)

Each card defines its values at the Normal tier. A rarer copy makes the effect
stronger or longer, and the cooldown shorter:

| Tier | Effect (amount or duration) | Cooldown |
|---|---|---|
| Normal | ×1.0 | ×1.0 |
| Illustrated Rare | ×1.15 | ×0.9 |
| Secret Rare | ×1.3 | ×0.8 |
| Full Art | ×1.3 | ×0.75 |
| Gold | ×1.5 | ×0.65 |

Example: a card with "timeout 20s, cooldown 48h" gives 20s every 48h as a Normal, and
30s every 31h as a Gold. The hard limits in Section 3A still apply to every tier (a
timeout is never longer than 60s).

### 4.4 The balance test

A new `card-studio/scripts/boon-sim.mjs` plays these strategies against the real rules:

- two friends who play gift and luck on each other every day,
- a group of 5 who all target one member with pranks,
- a member who plays every card as soon as its cooldown ends.

The test fails if a member can get more than the weekly pack cap, more than the prank
cap in a day, or a guaranteed Gold from luck. A static check also fails if any
primitive can cause another primitive, except `reflect` at depth 1.

## 5. Consent and safety

- **No consent (Nathan, 2026-09-27): every member is a target for boons and pranks.**
- Discord itself protects: the server owner, and each member whose top role is at or
  above the bot's role.
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
  base: { amount, duration_s }, cooldown_h, condition?: { tag }, options }` (Normal-tier values).
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

## 9. Decisions (Nathan, 2026-09-27)

1. No consent. Every member is a target.
2. No type split. Each card gets the effect that fits the card.
3. No namesake bonus.
4. The bot posts every play. Each card has a cooldown, and the tier scales the effect
   and the cooldown (4.3).
5. The cooldown is the main limit. The limits in 4.2 stay as tunable settings, because
   a cooldown cannot stop 20 members who prank one person at the same time.
6. The bot permissions are in Section 3B.
7. Voice order: mute and deafen first, entrance sounds second, "sound when they
   speak" last. Sounds come only from the curated library.
8. The Message Content intent: yes, for SpOnGeBoB and Parrot (the bot reads message
   text, and it stores none).
9. No real losses: no prank causes permanent harm (no card, pack, or reward loss).
10. The raid boss layer (3D), with credited damage kept at full value.
