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

Nathan (2026-10-11): "I want the freedom to make any kind of event I want." An event can be
about recruitment (Community Week), bosses, trading, pranks and boons, or anything else.
So the design has no code for one specific event. It gives building blocks: time, variables,
theme, audience, rewards, and a library of saved events to schedule again.

0. **The event library.** Each saved event is a template in `event_templates`: name, kind,
   variables, theme, audience, rewards, rules, and a default length. Nathan builds the
   library over time. To run one, he drops it on the calendar (one time or as a repeat).
   Each calendar entry is an `events` row made from the template. A change to one entry does
   not change the template. "Save as template" turns any event into a library entry.
1. **The `events` table becomes the calendar.** It gets these new parts:
   - `vars` jsonb: the variables that the event changes, for example
     `{"pull_rare_mult": 2, "dungeon_runs_per_day": 2}`.
   - `theme` jsonb: name, color, art, banner text.
   - `repeat_id`: a link to a repeat rule (item 4).
   - `template_id`: the library entry that it came from (item 0), if any.
   Two new kinds are added: `modifier` (variables only, no payouts) and `hunt` (item 3).
2. **A variable registry `event_vars`.** Each row has: key, label, note, the balance key
   and path that holds its base value, how events combine (`multiply` or `max`), and the
   limits. Only registered variables can go into `events.vars`. A check refuses a value
   outside the limits. The registry covers every system, so that any kind of event is
   possible. A value that is fixed in code becomes a `balance` key first, then a variable.
   First variables (the full list is made from the code in PR 1):
   - Packs and pulls: `pull_rare_mult`, `pack_earn_mult`, Shop prices.
   - Modes: `dungeon_runs_per_day`, `gauntlet_runs_per_week`, Hunt rewards, Dungeon rewards.
   - Daily: `daily_reward_mult`, the Shards for each daily task.
   - Trading and auctions: the limits and the fees that exist in code.
   - Pranks and boons: the play limits, the costs and the strengths.
   - Recruitment: the rewards for a recruit and for the recruiter (Community Week).
   Each new system adds its own variables to the registry. Then an event can use them with
   no new code.
3. **The Hunt becomes a calendar item.** Each Hunt is an `events` row of kind `hunt`.
   - At `starts_at`, `event_step` spawns the boss and links it (`hunts.event_id`).
   - `hunts.closes_at` follows `events.ends_at`. A change to the end time moves the close.
   - The fixed `hunt-*-mt` cron jobs and the 6-hour guard are removed.
   - Several Hunt events can be on the calendar in one week, with no special code.
4. **Repeats.** `event_repeats` links a library template (item 0) to a rule (for example
   "each Thursday 15:00 MT"). A cron step makes the next 4 weeks of rows. A change to one
   row does not change the template. The current weekly Hunt becomes the
   first repeat, so nothing changes for players on the day of the switch.
5. **One reader: `game_var(key)`.** It returns the base value from `balance`, combined
   with every live event that changes it, kept inside the limits. Every reader of these
   values calls it: SQL directly, and the bot through one cached call.
6. **Runs each day.** Add an `attempt` number to `dungeon_runs`, and change the unique index
   to `(player_id, day, mode, attempt)`. `dungeon_start` and `gauntlet_start` compare the
   count with `game_var('dungeon_runs_per_day')` and `game_var('gauntlet_runs_per_week')`.
7. **Timing.** `event-tick` runs every minute, not every 10 minutes. The bot cache for
   game variables is 30 s. An event starts within about 1 minute.
8. **Live edits (Nathan, 2026-10-11: yes).** A live event can change its end time,
   variables and theme, for example a double pull rate tuned up during the event. It cannot
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
3. Three `hunt` events in one week spawn three bosses. Each closes at its own end time. A
   moved end time moves `closes_at`. Each reward pays once.
4. `dungeon_runs_per_day = 2`: a player starts 2 runs. The third is refused. With no
   event, the second run is refused (the flag-off state).
5. A repeat makes the next 4 weeks. A change to one week leaves the other weeks the same.
6. A value outside the limits is refused.
7. Save an event as a template, then schedule it twice. A change to one entry leaves the
   template and the other entry the same.
8. A live `pull_rare_mult` changes from 2 to 3. The next pack uses 3 (within the 30 s
   cache), and `event_log` records the change.

### PR order

1. SQL: `event_vars`, `game_var`, `event_templates` (the library), the new `events` columns and kinds, a one-minute tick.
2. SQL: Hunt as a calendar event, `event_repeats`, removal of the fixed Hunt jobs.
3. SQL: runs each day for the Dungeon and the Gauntlet.
4. Bot: pull odds and earned packs read `game_var`. `/packrate` becomes a `modifier` event.
5. Admin: the month calendar, the detail panel, and the event library.
6. More variables for each system (trading, pranks and boons, recruitment), one PR each.

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
5. **Reprints and set pools (Nathan, 2026-10-11).** A card has one home set, where it is
   printed and numbered. Any other set can add that card to its pull pool. The player gets
   the same card, not a copy. This supports a future "mega set" with every card, and
   special event packs.
   - `set_pool(set_id, card_id)`: one card added to the pool of another set.
   - `set_includes(set_id, included_set_id)`: a whole set added. A mega set includes every
     set, and it updates by itself when a new set comes out.
   - The `draw_pool` view becomes: the home cards of the set, plus `set_pool`, plus the
     cards of each included set. Each pack still draws from one set's pool (D-82 odds).
   - In the Sets section: "Add cards from other sets" (search and select), and "Include a
     whole set".
   - `push.js` no longer moves a card to a new set. A push only changes the home set when
     Nathan changes it on purpose.
6. **Fixes:** `push.js` checks every insert error. `spawn_hunt` and the achievement
   functions read `draw_pool`.
7. **A set check script:** each card has a set, a number, art for every finish, and tags
   from the fixed list (F-3).

### Acceptance test (local copy)

Nathan creates the set "S2 test", uploads pack art, makes one card in it, and pushes it. A
pack of S2 gives only S2 cards and shows the S2 art. S1 is unchanged, and the S1 numbers
are the same.

Then Nathan adds five S1 cards to the S2 pool. An S2 pack can give those cards, and they
keep their S1 numbers. A test set that includes S1 and S2 can give any card of both.

### PR order

1. Merge the portal into the Admin page (no new features).
2. SQL: `set_pool`, `set_includes`, and the new `draw_pool`.
3. The Sets section with pack art and set pools. `set` in `cards.json`. `push.js` fixes.
4. Remove "Season" text in SQL, then in the Activity (the Activity change is a UI PR).
5. The set check script.

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
4. **Haste works in fights.** It lowers the support cooldown in the Hunt and the Dungeon,
   as its label says (Nathan approved the recommendations, 2026-10-11).
5. **One place (Nathan, 2026-10-11: "lets make it one PLACE").** One place to read, one
   place to calculate, and typed tables under them. Not one physical table: the data has
   different shapes, and a table of stored results becomes wrong when a balance number, a
   star or a stat point changes. Size is not a problem (about 5,500 combat rows in total).
   - **One calculation:** `card_combat()` is the only code that calculates CP, HP, crit,
     potency and Haste. The fights, the auto-pick, Team CP and the Arena all call it.
   - **One table to read:** the view `combat_sheet`, one row for each card and finish. It
     shows the calculated CP, HP and crit, the ability with its power cost, the element, the
     tags and the synergy groups. It calculates on each read, so it is always current. If it
     becomes slow, it becomes a materialized view that refreshes after each balance change.
   - **One log:** `combat_actions` only. `hunt_combat_log` and `dungeon_log` are removed
     after their readers move to `combat_actions`.
   - **The Admin page Combat section:** the `combat_sheet` with sorting and filters, the
     `balance` combat keys, and the last Combat Lab report.
6. **The Combat Lab: one place to analyze.** One command runs seeded fights on the local
   copy for the Hunt, the Dungeon and the Gauntlet, with every card and every boss.
   It reports:
   - Damage and support value for each card, with the top and bottom outliers.
   - The strongest squads, for example the support stacking of today.
   - **Loops and locks:** a fight longer than a limit, a stun chain, a heal that is larger
     than all damage, a cooldown of 0.
   - **Invariants:** HP is never below 0 or above the maximum, no value is NaN, and each
     reward pays once.
   Later the Admin page shows the last report.
7. **The golden test covers the Dungeon and the Gauntlet**, and runs on the local copy and
   in the SQL test run. Today it covers the Hunt only, and it runs against the live
   database.
8. **The Arena (later):** a JS copy of the core is allowed only with a test that plays the
   golden fights on both copies and fails on any difference.
9. **Ascension and stat points (Nathan, 2026-10-11).** Make sure that they do what they
   say, then balance them with the rest of combat. Audit of the live state (observed
   2026-10-11):
   - **Haste does nothing in fights.** Players spent 246 points on it. Only boons and
     pranks read it. Fix: item 4.
   - **Attack also raises HP.** `card_combat` calculates HP from CP after Attack is added.
     So 1 Attack point gives +5% CP and +5% HP, and Vitality gives only +6% HP. Attack is
     always the better choice (inferred: not intended).
   - **The power that players see leaves out stat points.** `card_power` (roster, leaderboards,
     deployable power, the ascend result) does not count them. `card_combat` (fights) does.
   - **The Gauntlet ignores stars and points.** `dungeon_card_base` uses 0 stars and no
     points (inferred: a fair-play rule on purpose; Nathan to confirm).
   - **Ascension only multiplies CP.** It gives no new capability. A 5-star normal (80 CP)
     is stronger than a 0-star Full Art (75 CP). A 5-star Gold is 224 CP.
   - **Copies to reach 5 stars:** normal 44, illustrated rare 32, full art 23, gold 15,
     secret rare 11. Live: 4,029 cards at 0 stars, 809 at 1, 133 at 2, 5 at 3, none above.
     Most of the curve has no real play data.
   - Points chosen by players: Potency 664, Attack 463, Haste 246, Vitality 245,
     Precision 55.
   Work:
   - Each stat does exactly what its label says, and nothing more. The labels come from
     `balance`, not from text in the code.
   - `combat_sheet` shows each card at 0 to 5 stars and with each stat build, so that the
     curve can be seen in one place.
   - The Combat Lab measures the value of one point in each stat and one star for each
     rarity. A stat that is always the best choice, or never worth a point, is a defect.
   - No free reset for now (Nathan, 2026-10-11). Cards with Attack points lose the HP part
     of the bonus. Cards with Haste points gain the cooldown effect.
   - **Decided (Nathan, 2026-10-11):**
     - Attack raises only attack power. Vitality raises only HP.
     - The Gauntlet stays equal for all: 0 stars and no points.
     - The stat names must say what each stat does. Proposal (the stored keys do not
       change, only the labels in `balance`):

       | Now | New label | What it does |
       |---|---|---|
       | Attack | Attack | +5% attack power for each point |
       | Vitality | Health | +6% HP for each point |
       | Precision | Crit | +3% chance of a critical hit for each point |
       | Potency | Support | +5% strength of the card's support (heal, shield, empower) |
       | Haste | Recharge | −4% support cooldown for each point |

       Not "Speed" (it suggests turn order) and not "Accuracy" (the game has a miss chance,
       and Precision does not change it).
10. **Latent upgrade (Nathan, 2026-10-11).** Every card has one base ability for fights.
    At 3 stars, the Silver tier, the base ability is upgraded. It is not a second ability
    and not a second button. Live: 127 of 130 subjects have an ability, with 13 effects
    (attack: focus, lifesteal, rampage, execute, pierce; support: weaken, empower, shield,
    expose, heal, smite, cleanse, stun).
    - **A default upgrade for each effect** in `balance` key `latent_upgrades`, for example
      heal: amount +25%; stun: duration +1 round; pierce: amount +20%. Every card gets the
      upgrade of its effect with no extra content work.
    - **An optional upgrade for one card** in `subjects.latent`: a name and its own changes
      (for example a burn that also lowers defense). It replaces the default for that card.
    - `ability_kinds` lists, for each effect, the fields that an upgrade can change and the
      limits. The power budget counts the upgraded ability too.
    - `balance` key `latent_unlock_star = 3`.
    - `card_combat` returns the ability already upgraded when the card has enough stars. The
      fights read it from there and need no new action. The Gauntlet (0 stars) never has it.
    - `combat_sheet` and the Combat Lab show and test each card with and without the upgrade.
    - The 3 subjects with no ability get one first.
    - Card-specific upgrades for S1: drafted after the Combat Lab exists (item 6), so that each
      one is measured. Nathan approves or changes each one in the Card Portal.
    - Screens: the Card Detail ability box (UI-08) shows the upgrade line, dimmed with
      "Unlocks at Silver" before 3 stars. The Silver frame gets a small mark. The 3-star
      celebration (UI-10) shows "Ability upgraded". The printed card image does not change.
11. **The stat screen (UI-10) (Nathan, 2026-10-11).**
    - The new stat names (item 9), each with a one-line explainer of what it does, for
      example "Recharge: supports are ready sooner (−4% cooldown for each point)". The text
      and the numbers come from `balance`.
    - Live preview: when a player adds or removes a point, before they confirm, the card shows
      its stats before and after (attack power, HP, crit, support strength, cooldown).
    - The preview values come from `card_combat` through one server call, not from JS math
      (item 3). The same call gives the latent ability state ("unlocks at Silver").
    - UI-10 has an approved design (2026-10-05). These additions need an updated design in
      the design repo and Nathan's approval before the build (`docs/design.md` 12.3).

### Acceptance tests

1. A CI check finds no combat number outside `balance` (like gate G4).
2. A planted infinite loop (a mutation) makes the Combat Lab fail.
3. The auto-pick and the fight give the same team value for the same squad.
4. An ability with a field outside its limits is refused.
5. The golden fights are the same before and after each clean-up PR (no change in play).
6. Each stat changes only the value that its label names. One Attack point does not change HP.
7. The power on the roster equals the power in a fight for the same card.

### PR order

1. Remove the JS combat math (the auto-pick and Team CP call SQL). Delete the old
   simulators. Fix Haste.
2. `elements` and `passives` tables. Remove the fixed copies.
3. `ability_kinds` and the ability check.
4. The `combat_sheet` view and the Admin page Combat section.
5. The Combat Lab, and the golden test for the Dungeon and Gauntlet on the local copy.
6. One log: move the readers to `combat_actions`, then remove the old logs.
7. Ascension and stat points: the fixes, the new labels, one power number everywhere, and the Lab measurement.
8. Latent upgrade: `latent_upgrades`, `subjects.latent`, `latent_unlock_star`, the fight support, and the Card Portal field.
9. UI-10 stat screen: the updated design first, then the build (explainers and live preview).

---

## Decisions recorded (Nathan, 2026-10-11)

5. **Stats:** Attack raises only attack power, Vitality only HP. Clearer stat names. No free
   reset for now. The Gauntlet stays equal for all.
6. **Latent upgrade:** at 3 stars, the Silver tier, each card's base ability is upgraded.
   Not a second ability (F-3 item 10).
7. **Stat screen:** the new names, an explainer for each stat, and a live preview of the
   card stats (F-3 item 11).

1. **Events:** no code for one specific event. Nathan wants the freedom to make any kind of
   event and to build a library of events to schedule (F-1 item 0).
2. **Combat:** F-3 is approved, with one place (F-3 item 5). Haste works in fights.
3. **Reprints:** yes. A set can add cards from other sets, or whole sets, to its pull pool
   (F-2 item 5).
4. **Live variables:** yes. A live event can change its variables.
