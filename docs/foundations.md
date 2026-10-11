# The three foundations — design

Status: DRAFT for Nathan's review (2026-10-11). Nothing here is built.
Roadmap and success tests: `docs/roadmap-next-update.md` (F-1, F-2, F-3).

The facts below come from the schema snapshot `db/schema/` at `origin/main` 2e85253.

## 0. One rule for all three

**Every value that changes the game has one home.** The base value is in `balance`. An event
can change it only through a named variable with limits. No number is copied into JS. The
reason: today the same synergy numbers are in SQL, in `squad-pick.js` and in `main.js`, so
a balance change in one place leaves the other places wrong.

---

## F-1. The event calendar

### What exists

- `events` table with `starts_at`, `ends_at`, a status flow, audience, rewards, a log, and
  payouts. The cron job `event-tick` runs it every 10 minutes.
- The admin Events page: a list, a form, Schedule, End now and Cancel. It has no calendar,
  no theme and no variables.
- A live event can change only its title, description and `ends_at`.

### What is fixed in code today (must become variables)

| Value | Where it is fixed |
|---|---|
| One Hunt each week, Thursday 15:00 to Monday 17:00 MT | `hunt_mt_slot`, the `hunt-*-mt` cron jobs, and the 6-hour guard in `weekly_boss_tick` |
| One Dungeon run each day | `dungeon_start.sql:19` and the unique index `dungeon_runs_one_a_day_mode` |
| One Gauntlet run each week, weeks start on Sunday | `gauntlet_start.sql:20`, `gauntlet_week` |
| Pull odds | balance `pulls`, rolled in the bot with a 60 s cache |
| Earned packs | balance `pack_earn_multiplier`, changed by hand with `/packrate` |

### The design

1. **The `events` table becomes the calendar.** It gets three new parts:
   - `vars` jsonb: the variables that the event changes, for example
     `{"pull_rare_mult": 2, "dungeon_runs_per_day": 2}`.
   - `theme` jsonb: name, color, art, banner text.
   - `repeat_id`: a link to a repeat rule (item 4).
   Two new kinds are added: `modifier` (variables only, no payouts) and `hunt` (item 3).
2. **A variable registry `event_vars`.** Each row has: key, label, note, the balance key
   and path that holds its base value, how events combine (`multiply` or `max`), and the
   limits. Only registered variables can go into `events.vars`. A check refuses a value
   outside the limits. First variables:
   - `pull_rare_mult`, `pack_earn_mult`
   - `dungeon_runs_per_day`, `gauntlet_runs_per_week`
   - `shard_reward_mult`, `dungeon_reward_mult`, `hunt_prize_mult`, `daily_reward_mult`
3. **The Hunt becomes a calendar item.** Each Hunt is an `events` row of kind `hunt`.
   - At `starts_at`, `event_step` spawns the boss and links it (`hunts.event_id`).
   - `hunts.closes_at` follows `events.ends_at`. A change to the end time moves the close.
   - The fixed `hunt-*-mt` cron jobs and the 6-hour guard are removed.
   - Boss Rush is several `hunt` events in one week.
4. **Repeats.** `event_repeats` holds a template (kind, vars, theme, length) and a rule
   (for example "each Thursday 15:00 MT"). A cron step makes the next 4 weeks of rows. A
   change to one row does not change the template. The current weekly Hunt becomes the
   first repeat, so nothing changes for players on the day of the switch.
5. **One reader: `game_var(key)`.** It returns the base value from `balance`, combined
   with every live event that changes it, kept inside the limits. Every reader of these
   values calls it: SQL directly, and the bot through one cached call.
6. **Runs each day.** Add an `attempt` number to `dungeon_runs`, and change the unique index
   to `(player_id, day, mode, attempt)`. `dungeon_start` and `gauntlet_start` compare the
   count with `game_var('dungeon_runs_per_day')` and `game_var('gauntlet_runs_per_week')`.
7. **Timing.** `event-tick` runs every minute, not every 10 minutes. The bot cache for
   game variables is 30 s. An event starts within about 1 minute.
8. **Live edits.** A live event can change its end time, variables and theme. It cannot
   change its start or kind. Each change is written to `event_log`.
9. **The admin calendar (Nathan, 2026-10-11: "just like a Google Calendar view").**
   - The default view is the full current month. Every event shows on its days: Hunts,
     Dungeon and Gauntlet changes, modifiers, and Community Week. A multi-day event is one
     bar across its days. Each kind has its own color.
   - Click an event to open its detail panel. The panel shows all details: time, variables
     (each with its base value and limits), theme, audience, rewards, repeat rule, status,
     payouts and the change log. Every field that can still change is editable in the panel.
   - Click an empty day to create an event on that day (from a blank or from a template).
     Choose one time or a repeat.
   - Previous and next month buttons and a "Today" button. A week view is optional.
   - Drag moves an event. Drag of the edge changes its length.

### Acceptance tests (local copy)

1. No event live: each `game_var` equals its `balance` value.
2. A `pull_rare_mult = 2` event: the rates double while it is live and return after it
   ends. The rates still add up to 1.
3. Boss Rush: three `hunt` events in one week spawn three bosses. Each closes at its own
   end time. A moved end time moves `closes_at`. Each reward pays once.
4. `dungeon_runs_per_day = 2`: a player starts 2 runs. The third is refused. With no
   event, the second run is refused (the flag-off state).
5. A repeat makes the next 4 weeks. A change to one week leaves the other weeks the same.
6. A value outside the limits is refused.

### PR order

1. SQL: `event_vars`, `game_var`, the new `events` columns and kinds, a one-minute tick.
2. SQL: Hunt as a calendar event, `event_repeats`, removal of the fixed Hunt jobs.
3. SQL: runs each day for the Dungeon and the Gauntlet.
4. Bot: pull odds and earned packs read `game_var`. `/packrate` becomes a `modifier` event.
5. Admin: the calendar view.

---

## F-2. Card sets

### What exists

- `card_sets` (id, name, code, `pack_color`, `pack_art_url`, `cover_card_id`, `pullable`,
  `season`). Only S1 "Origins" exists. Packs can pick a set.
- `cards.set_id` and `set_number`. The trigger `cards_set_rules` numbers the cards.
- The Card Portal (`/`) and the Admin page (`/admin/`) are two front ends on one server.

### The problems

- No screen creates a set or puts a card into a set. Today this needs hand-written SQL and
  a hand-added `"set"` key in `cards.json`.
- About 40 places read the old "Season 1" text or fall back to `S1`. They include Hunt weak
  points, badges, the collection, the Open window (the same pack picture for every set), and
  "Season 1 Complete".
- `push.js` finds a card by subject and rarity and moves it to the new set. So the portal
  cannot reprint a card into a second set. It also does not check its insert errors.
- `spawn_hunt` and the achievement functions read `cards.in_draw_pool`, not `draw_pool`, so
  they ignore `pullable`.
- Pack art is a separate command-line script. The Activity uses `/pack_still.png` for every
  set.

### The design

1. **Merge the Card Portal into the Admin page.** The portal becomes the **Cards** section,
   next to **Sets** and **Events**. One page, one navigation, one style.
2. **The Sets section:**
   - Create a set: name, code, color, release date, pullable on or off, order.
   - Pack art: upload the still and the clip. They go to storage and fill `pack_art_url`.
   - Choose the cover card from the cards of the set.
   - The set page lists its cards and has "New card in this set".
3. **The source of truth.** The database owns sets and set membership (it already owns the
   set numbers). `cards.json` keeps the card design data. Each card in `cards.json` gets a
   required `set`. The portal writes it, and the push sends it.
4. **Remove "Season" text.** Every one of the about 40 reads uses `set_id` and
   `card_sets`:
   - The Hunt weak point kind `season` becomes `set`.
   - The badges and "Season 1 Complete" work for each set.
   - The Open window shows the pack art of each set.
5. **Fixes:** `push.js` checks every insert error. `spawn_hunt` and the achievement
   functions read `draw_pool`.
6. **A set check script:** each card has a set, a number, art for every finish, and tags
   from the fixed list (F-3).

### Acceptance test (local copy)

Nathan creates the set "S2 test", uploads pack art, makes one card in it, and pushes it. A
pack of S2 gives only S2 cards and shows the S2 art. S1 is unchanged, and the S1 numbers
are the same.

### PR order

1. Merge the portal into the Admin page (no new features).
2. The Sets section with pack art. `set` in `cards.json`. `push.js` fixes.
3. Remove "Season" text in SQL, then in the Activity (the Activity change is a UI PR).
4. The set check script.

---

## F-3. Combat in one place

### What exists (correction)

Combat data is **not** in one table. The only combat table is `combat_actions`, and it is a
log. v1.1 put the rules in one set of `combat_*` SQL functions, and their numbers come from
`balance`. That part is clean. The rest is spread out:

| Data | Where it is now | Problem |
|---|---|---|
| Abilities | `subjects.ability` jsonb, one for each card | No schema. Nothing checks the fields or the limits. |
| Elements | `element_aliases()` has 13. `dungeon_make_foe` has 8 and its own counter map. `elements.js` is a hand copy. | Three lists that do not agree |
| Boss and foe passives | Fixed in `spawn_hunt`, `hunt_attack`, `dungeon_make_foe` | Two copies |
| Boss names | Fixed in `spawn_hunt` | Not data |
| Callers | `hunt_attack` (attacker types, `trait:melee`), `combat_pool_act` (Flurry 2 hits), `dungeon_auto_action` (0.5, 0.6) | Fixed numbers |
| Auto-pick and Team CP | `squad-pick.js` and `main.js` copy the synergy numbers (1.2, 1.12, 1.6, 0.72) and the crit numbers | The JS math can differ from the fight |
| Old simulators | `combat-sim.mjs`, `boss-sim.mjs` | Old numbers (crit 0.12, but balance has 0.1) |

**A defect that players feel:** Haste costs stat points but does nothing in fights.
`hunt_support.sql:39` uses the raw cooldown. Only boons and pranks read Haste.

### The design

1. **Data tables, with checks:**
   - `elements`: key, aliases, counter, icon. One list for SQL. The Activity reads it from
     the server and stops keeping its own copy.
   - `passives`: key, label, the parameters, and where each one can appear (boss or foe).
   - `ability_kinds`: each ability kind, its fields, its limits, and its power cost (the
     budget). A check refuses a `subjects.ability` that does not fit its kind. The ability
     stays on the card, as the database rule "card facts with the card" requires.
2. **No fixed numbers in the callers.** Each number becomes a `balance` key.
3. **No combat math in JS.** The auto-pick and Team CP call one SQL function that uses
   `combat_squad`. Delete the JS copies and the old simulators.
4. **Haste works in fights**, or it is removed with a refund (Nathan decides).
5. **The Combat Lab: one place to analyze.** One command runs seeded fights on the local
   copy for the Hunt, the Dungeon and the Gauntlet, with every card and every boss.
   It reports:
   - Damage and support value for each card, with the top and bottom outliers.
   - The strongest squads, for example the support stacking of today.
   - **Loops and locks:** a fight longer than a limit, a stun chain, a heal that is larger
     than all damage, a cooldown of 0.
   - **Invariants:** HP is never below 0 or above the maximum, no value is NaN, and each
     reward pays once.
   Later the Admin page shows the last report.
6. **The golden test covers the Dungeon and the Gauntlet**, and runs on the local copy and
   in the SQL test run. Today it covers the Hunt only, and it runs against the live
   database.
7. **The Arena (later):** a JS copy of the core is allowed only with a test that plays the
   golden fights on both copies and fails on any difference.

### Acceptance tests

1. A CI check finds no combat number outside `balance` (like gate G4).
2. A planted infinite loop (a mutation) makes the Combat Lab fail.
3. The auto-pick and the fight give the same team value for the same squad.
4. An ability with a field outside its limits is refused.
5. The golden fights are the same before and after each clean-up PR (no change in play).

### PR order

1. Remove the JS combat math (the auto-pick and Team CP call SQL). Delete the old
   simulators. Fix Haste.
2. `elements` and `passives` tables. Remove the fixed copies.
3. `ability_kinds` and the ability check.
4. The Combat Lab, and the golden test for the Dungeon and Gauntlet on the local copy.

---

## Decisions for Nathan

1. **Boss Rush:** one boss after another, or several bosses at the same time? One after
   another needs no Activity screen change. Several at the same time needs a new Hunt
   screen design.
2. **Haste:** make it work in fights (recommended), or remove it and refund the points?
3. **Reprints:** can an existing card appear again in a new set?
4. **Live variables:** confirm that a live event can change its variables (for example
   from 2x to 3x pull rates during the event).
