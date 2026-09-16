# Lion Pride TCG — PVE & Social Design

Status: DRAFT for review · Last updated: 2026-09-14

This document describes the community-feature direction for Lion Pride TCG: a co-op
PVE loop (not card-vs-card PVP), a duplicate-driven upgrade system, leaderboards,
and light player-to-player social "prank & boon" cards.

## 1. Design goals

- **Co-op, not competitive.** PVE the whole server fights *together*.
- **Coordination matters.** People must cover gaps, so they talk to each other.
- **Varying difficulty → varying rewards.** Some weeks are easy, some brutal.
- **Duplicates are valuable.** Dupes upgrade cards (power + flair), not clutter.
- **Everything feeds the pack economy.** Rewards are packs. No new currency.

## 2. Core loop

Earn packs → pull cards + duplicates → **Ascend** cards (power + flair) → fight the
weekly **Pride Hunt** together → win packs (scaled by contribution × difficulty) →
climb leaderboards → repeat. Later: live **Den Dives** and social **Prank/Boon** cards.

## 3. Card system additions

### 3.1 Typing (prerequisite for everything)
Each card gets a **Type** (identity, separate from subject and rarity):

| Type | Meaning |
|---|---|
| Character | a person / persona / mascot |
| Creature | a pet, animal, critter |
| Item | an object / thing |
| Place | a venue / location |
| Moment | an event / happening / in-joke |

Type is the primary **weak-point** axis for the Hunt and a future hook for synergies.
Requires: a `type` column on `cards`, a one-time **backfill** of every existing card,
and a type picker in the card-creation pipeline.

### 3.2 Ascension (dupes → power + flair)
Each owned card has an **Ascension star level (0–5★)**. Feeding duplicates raises it.
Each star adds power AND a visual flair tier.

- Flair tiers by star: 0 plain · 1 glow · 2 foil · 3 shimmer · 4 animated · 5 radiant.
- Maxed (5★) cards show a prestige marker in the community feed + leaderboards.

### 3.3 Prestige Foil craft (long-term flex)
A 5★ card + a large extra duplicate cost forges a one-time **Prestige Foil**: radiant
animated border, a prestige badge, and a small extra power bonus. Purely earned.

## 4. Power model (all numbers TUNABLE)

`Power = RarityBase × AscensionMultiplier (+ PrestigeBonus)`

| Rarity | Base |
|---|---|
| Normal | 10 |
| Illustrated Rare | 25 |
| Full Art | 50 |
| Gold | 100 |
| Secret Rare | 200 |

Ascension multiplier by star: 1.0 / 1.25 / 1.5 / 1.75 / 2.0 / **2.5** (5★).
Prestige Foil: +25% power on top.

Duplicates to advance one star (rarity-scaled; commons need more, rares need fewer):

| Rarity | ★1 | ★2 | ★3 | ★4 | ★5 | Prestige craft |
|---|---|---|---|---|---|---|
| Normal | 2 | 3 | 4 | 6 | 8 | +15 |
| Illustrated | 2 | 2 | 3 | 4 | 5 | +10 |
| Full Art | 1 | 2 | 2 | 3 | 4 | +8 |
| Gold | 1 | 1 | 2 | 2 | 3 | +5 |
| Secret Rare | 1 | 1 | 1 | 2 | 2 | +4 |

## 5. The Pride Hunt (flagship — weekly randomized co-op raid)

A boss auto-spawns each week (for example Friday 6pm → Sunday midnight) and the whole
server chips away at one shared HP pool.

- **Randomized each week (the content):** random name/flavor, random **weak points**
  (mostly Types, sometimes a rarity or season), and a **random tier**
  (Normal / Heroic / Mythic) — this delivers "varying difficulty".
- **HP scales to recent active players** × tier, so a random Mythic is hard-but-fair,
  never impossible for the server's size.
- **Weak points:** Normal 1 · Heroic 2 · Mythic 3. A card matching a weak point deals
  **×2**. Uncovered weak points let the boss **heal a little each day** → the Activity
  shows coverage so people rally in chat to fill gaps. This is the coordination.
- **Pacing:** each owned card can be **sent once per Hunt-day**. Damage = the card's
  Power × weak-point bonus. Rewards a broad, ascended roster and daily check-ins.
- **Rewards (packs):** on defeat, a pack pool split by **contribution share × tier**
  (Mythic pays far more); everyone who landed a hit gets a base payout, top
  contributors a bonus. If the boss survives the window: **consolation packs** by the
  % of HP the server removed (effort is never wasted).

## 6. Den Dives (phase 2 — live co-op dungeon)

Uses the existing WebSocket rooms (a voice channel = a room). A group starts a Dive and
descends floor by floor; each floor is a check needing the group's combined power of a
type/threshold. Everyone taps to commit a card each round; clear the floor, go deeper.
Difficulty = depth. Adds the **Deepest Dive** leaderboard.

## 7. Social — "Play a card ON someone" (phase 4)

Some cards carry an **Ability** that targets another member (or a whole voice channel).
A light social interaction, not PVP. The card's **Type** drives its ability flavor
(Moment → chaos, Item → tools, Character → support, Creature → luck, Place → room-wide).

### 7.1 Ability categories (extensible)
The system is built around a category + effect, so new kinds can be added later:

- **Boon** (positive): gift a bonus pack, boost a friend's next pull odds, lend Hunt
  power, a 24h cosmetic "spotlight" role, shield someone.
- **Punishment** (negative / prank): short timeout (hard cap 60s), temporary nickname
  swap (auto-reverts), emoji storm on their next message, "peek" at a random owned card.
- **Quirk** (neutral / chaotic): swap two members' nicknames, a random "wheel" effect,
  a temporary title for everyone in a channel, a mirrored reaction.
- Room for more categories over time. Effects are authored per card, never every card.

### 7.2 Cost & anti-spam — per-card cooldown
Playing a card's ability puts THAT card on a **cooldown** (per player, per card) before it
can be used again. No daily charge, no dupe cost — cooldown length is tuned per effect
(a 60s timeout has a long cooldown, a minor quirk a short one). This is the primary
anti-spam control.

### 7.3 Consent — opt-out ("Prank Shield")
Members are targetable **by default**; a per-user **Prank Shield** toggle (in the Activity)
blocks incoming Punishments (and optionally Quirks). Boons are always allowed. Admins and
mods are always immune.

### 7.4 Guardrails (mandatory — these are real moderation actions)
- Bot permissions: Moderate Members (timeout), Manage Nicknames, Manage Roles (spotlight).
  Scope tightly.
- Hard caps: timeout <= 60s; nicknames auto-revert on a timer; no stacking of the same
  effect on one target.
- Per-target daily cap on Punishments (nobody gets prank-spammed) on top of per-card
  cooldowns.
- Immunity: admins/mods + the Prank Shield opt-out.
- Transparency: every use is logged and announced in the feed (public = fun + deters
  abuse).
- Punishments never damage progress — no collection loss, no pack theft. Social only.

### 7.5 Rollout
Ship **Boons first** (no risky permissions), then **Punishments/Quirks** once the bot
permissions and guardrails are in place.

## 8. Leaderboards

- **Hunt Contribution** — per season, resets for fresh competition.
- **Total Collection Power** — sum of owned card power (rewards Ascension).
- **Hunts Slain** — all-time.
- **Deepest Den Dive** — added with phase 2.

## 9. Schema changes (high level)

- `subjects`: **`type`** column — DONE (Character/Creature/Item/Place/Moment), backfilled,
  synced by `push.js`. Cards read type via the cards→subjects join.
- `player_cards`: add `ascension` (int 0–5), `prestige_foil` (bool). Power is derived.
- New `hunts`: one row per weekly boss (tier, weak_points[], hp, hp_remaining, opens_at,
  closes_at, status).
- New `hunt_contributions`: (hunt_id, player_id, damage) — drives payout + leaderboard.
- New `card_sends` or a per-card daily lock: enforce "each card once per Hunt-day".
- Abilities (phase 4): ability metadata per card (category boon/punishment/quirk, effect
  key, params jsonb, cooldown_seconds, targeting single/room). A cooldown tracker
  (player_id, card_id, last_used_at). A `players.prank_shield` opt-out flag. A punishment
  daily-cap counter per target. The bot executes the Discord action (timeout / nickname /
  role) behind its internal endpoint, same pattern as `/open`.
- All new mutations as atomic RPCs (same pattern as `spend_pack`), each behind a flag,
  RLS-locked, service-role only. Run `notify pgrst` after each migration.

## 10. Build order (phases, each shippable)

0. **Typing prerequisite** — `type` column + backfill tool + creation-pipeline picker.
1. **Ascension** — dupes → stars → power + flair; Total Collection Power leaderboard.
   Self-contained, makes dupes valuable immediately (value before PVE exists).
2. **The Pride Hunt** — weekly randomized raid + contribution leaderboard + pack payout.
3. **Prestige Foil** crafting.
4. **Prank & Boon** cards — only after guardrails + permissions are decided.
5. **Den Dives** — live co-op + Deepest Dive leaderboard.

Each phase ships behind its own flag, default OFF, validated before enabling.
