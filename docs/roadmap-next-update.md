# The next update — roadmap

Status: DRAFT for Nathan's review (2026-10-11). Nothing here is built.

Nathan's goal: **50 active daily players** in the TCG. The update has five items: daily
mini-games and events, Community Week, the next card set, a deeper combat system, and the
PvP Arena. This file holds the order, the decisions, and the work for each item. Each
system keeps its detailed design in `docs/activities/`.

## 1. The start point (2026-10-11)

- Daily players (observed, partial count from packs, Hunt, Dungeon and fight actions):
  29 on 2026-10-01, then 12 to 16 each day from 2026-10-07.
- Registered players (observed): 215. Players still in the server: 210.
- Only one card set exists: S1 "Origins" (130 subjects, 352 finishes in `card-studio/cards.json`).

The goal is about three times the current number. Most members already have an account, so
the onboarding and the daily reasons to return matter as much as recruitment.

## 2. Nathan's decisions (2026-10-11)

| # | Question | Decision |
|---|---|---|
| R-01 | What is an active player? | Game actions only, including the daily log-in (check-in). Chat and voice do not count. |
| R-02 | When does a recruit count? | Not a fixed "3 of 7 days" rule. Build a full onboarding system that gets each new player going quickly. (Proposal for the credit rule: section 4.3.) |
| R-03 | A code for each streamer or community? | Yes. |
| R-04 | How often is Community Week? | As often as Nathan wants. The admin page gets a calendar. Nathan schedules events on it and makes them shorter or longer. The same calendar controls the live modes (Hunt, Dungeon, Gauntlet). |
| R-05 | Set 2 | Theme not decided. Release in the next two weeks (by about 2026-10-25). At least 150 cards. |
| R-07 | Set size and recruit credit | Set 2 has no fixed size (about 150 finishes is a ballpark). Nothing in code fixes a set size. A recruiter gets credit when the recruit finishes onboarding. |
| R-06 | Combat and Set 2 | The combat overhaul is done before Set 2 comes out, so that the new set gets all the new features. |

## 2a. The three foundations and their success tests (Nathan, 2026-10-11)

Build these first. Each one is done only when Nathan can do its test himself.

| # | Foundation | Success test |
|---|---|---|
| F-1 | Event calendar | Nathan has an idea, opens the admin page, creates a new event, selects the variables that it brings (for example 2x pull rates, 2x dungeon runs), and schedules it one time or as a repeat. Time, variables and theme are each changeable, also on a live event. The calendar also controls Hunt, Dungeon and Gauntlet. Every value that is fixed in code today becomes a variable that an event can change (for example, a "Boss Rush" week with several raid bosses in one week, or 2 Dungeon runs each day). |
| F-2 | Card sets | Nathan makes a new set easily, adds cards to that set, and sets up its pack art, all in the Card Portal. |
| F-3 | Combat in one place | Every combat number and rule is in one place, so that balance and tweaks are easy as abilities, cards and synergies are added. The same place finds bugs, loopholes and infinite loops. |

## 3. The order

| Step | Work | Why it is at this position |
|---|---|---|
| 1 | Activity count (R-01) and referral tracking | A join before the tracking is live cannot get credit later. |
| 2 | Combat overhaul, with set plumbing at the same time | Set 2 must get all the new features (R-06). |
| 3 | Set 2 content (tags and abilities after step 2) | Each card is tagged once, on the new engine. |
| 4 | Admin calendar (R-04) | Community Week and every event start from it. |
| 5 | Onboarding (R-02) | Recruits must get going before Community Week #1 brings them in. |
| 6 | The first mini-game, then Community Week #1 | Recruits need a daily reason to return. |
| 7 | PvP Arena | It needs the overhauled engine and the JS copy of it. |

Steps 1, 2 and 4 can run at the same time in separate sessions. Each new screen needs an
approved design first (`docs/design.md` 12.3), so claim the design IDs in week 1.

**Set 2 and combat (R-06).** The overhaul ships before Set 2. Work that does not depend on
the engine starts now: the theme, the subject list, and the art. Tags, abilities and
`cp_mod` for Set 2 are set only after the overhaul is merged. Nathan (2026-10-11): all
of this fits in two weeks, because v1.1 built the foundation (the `combat_*` engine, the
golden fights, `card_sets`, `events`). Each balance change is still measured on the local
copy before it goes live.

## 4. The work for each item

### 4.1 Active players and referrals

- Write one SQL function `active_players(from, to)` with game actions only (R-01). Add the
  daily check-in as a source. The existing `admin_active_days` merges chat and voice with
  `game=false`. Reuse its sources. Do not write a second list.
- Show the number of daily players in the admin page, and to members as the server goal.
- Referrals have three sources:
  1. A personal invite link for each player, made by the bot. On a join, the bot compares
     invite use counts to find the link. This needs the Server Members intent
     (`FEATURE_GUILD_MEMBERS_INTENT`) and the Manage Server permission.
  2. A code for each streamer and each community (R-03). The new player enters it in
     onboarding, or the link carries it.
  3. "Who invited you?" in onboarding, for joins that the bot cannot match.
- A new table `referrals` (recruit, source kind, source id, joined at, credited at).
  Each recruit has one row. The first source wins.

### 4.2 The admin calendar (R-04)

Today the times are fixed in code:
- Hunt: pg_cron jobs `hunt-spawn-mt` (Thursday), `hunt-nudge-mt`, `hunt-close-mt-*`, and
  `hunt_mt_slot`.
- Gauntlet: `gauntlet_week` (weeks start on Sunday).
- Dungeon: `dungeon-prepare-day` each day.
- Events: the `events` rows have their own start and end, read by `event-tick`.

The change:
- A new table `schedule` with one row for each thing on the calendar: kind (`hunt`,
  `gauntlet`, `dungeon`, `event`, `minigame`, `community_week`), starts at, ends at, and a
  link to its config (for example the `events` row).
- One cron tick reads `schedule` and starts or closes each item. The fixed hunt jobs are
  removed. The tick replaces them.
- A repeat rule ("each Thursday 21:00 MT") makes the future rows, so the current week
  keeps going with no action from Nathan.
- In the admin page: a calendar view. Nathan adds an item, drags it, and changes its
  length. A change to a live item changes its end time (for example `hunts.closes_at`).
- Acceptance test: move a Hunt end by one day on the local copy. The Hunt closes at the
  new time, and the reward pays once.

### 4.3 Onboarding (R-02)

- Base: the existing tutorial (`ui-v2-tutorial.js`, `ui3/walkthrough.js`).
- Make it a list of first-week steps with rewards: open the first pack, build a squad, hit
  the Hunt boss, run the Dungeon, claim the dailies, make a trade.
- Each step pays once and is recorded in the ledger.
- **The credit rule (R-07, decided):** the recruiter gets credit when the recruit finishes
  onboarding. The steps need game actions on more than one day, so one person cannot
  finish a fake account in a few minutes.

- The UI needs a design (new register ID).

### 4.4 Mini-games

- Design: `docs/activities/07-mini-games.md`.
- Build a general `minigame_days` / `minigame_plays` slot first. The calendar (4.2)
  places each mini-game, and each one adds a daily task. The `dailies_tasks` list is fixed
  today. Change it to read the calendar, so that a new game needs no change to it.
- First game: "Who's That Card?". It uses only the existing card art.
- Defer: Whose Main?, Fishing Derby, Memory Match.
- Trap: `08-weekly-events.md` plans a new `events` table, but that name is in use. Use a
  new `kind` in the existing `events` table.

### 4.5 Community Week

- A `community_week` item on the calendar (4.2), with any length.
- It runs three boards: recruits credited (4.1, 4.3), the most active players, and the
  server goal (daily players against the target). The server goal uses
  `docs/activities/10-server-milestones.md`.
- Rewards are paid through the existing `events` payouts and recorded in the ledger.
- Each streamer and community code has its own count, so that the sources can be compared.

### 4.6 Card sets and Set 2

Plumbing (before the Set 2 content):
- Card-studio: a page to create a set (`card_sets` row) and a required `set` field on each
  subject in `cards.json`.
- Remove the dependency on the `season` text: `combat_weak(p_season)` and the
  achievement tag badges read `set_id` instead.
- A check script: each card has a set, a set number, art for every finish, and tags from the
  fixed list.

Set 2 content:
- Theme: open (R-05).
- Size: no fixed number (R-07). About 150 finishes is a ballpark. Nothing in code limits
  the size of a set.

### 4.7 Combat overhaul (before Set 2, R-06)

Known issues (`docs/hunt-boss-moves.md`, `docs/card-tags-and-battle-engine.md`):
- Support stacking (for example 3 attackers and 5 supports) is the strongest strategy.
- `origin:smash` is on 59% of attackers, so weak-tag coverage is small.
- The ability power budget is only a proposal.
- The balance pass in `docs/battle-turn-based.md` is still open.

Method:
- Each change is a `balance` key or a `combat_*` function, measured with
  `sim-support-value.mjs` and `combat-golden.mjs` on the local copy before it goes live.
- Port the combat core to JS for the Arena AI. A CI test runs the 84 golden fights on both
  the SQL and JS versions and fails on any difference. This keeps one source of truth.

### 4.8 PvP Arena

- Design: `docs/activities/04-pvp-arena.md` (decided: live attacker against an AI defender,
  5-card squads, Elo plus a CP factor, 5 tickets each day).
- Open: league names, a register ID, and the screen designs.
- Arena seasons are calendar items (4.2).

## 5. Open questions for Nathan

1. Which onboarding rewards and which Community Week rewards (packs, Shards)? These become
   event variables (F-1), so they can change at any time.
