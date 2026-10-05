# Lion Pride TCG — UI screen register

Status: **In force** (approved with [`docs/design.md`](design.md), Nathan, 2026-10-04).
This file has one row for each screen, window and view. The rules are in `docs/design.md` section 12.

## How to read and change this register

**Columns.**

| Column | Content |
|---|---|
| ID | `UI-nn`. Reserve the next free number before work starts. Never use an ID again |
| Screen | The screen, window or view, with the names of the glossary (design.md section 10.1) |
| Design file | The file in the design repository. Today the files are on the branch `docs/design-md` |
| Approved | `YYYY-MM-DD, <kind>, <where>`. Write "No" when no approval record exists |
| Built | The PR numbers that built or changed the screen |
| Standard | The migration status against `docs/design.md` |
| Notes | Deviations, open items, flags |

**Values.**
- Kind of approval: `design` (an approved pen.dev PNG set), `spec` (a written spec only) or `build` (Nathan accepted the build).
- Standard status: `Not migrated`, `In migration`, `Migrated`, `Deviates` (with the recorded deviation) or `Retired`.
- Work status (from design.md section 12.3): write it in Notes as `Requested`, `In review`, `Approved` or `Built`.

**Rules for a new row or a change.**
1. Add a row before work starts. Use the next free ID. (design.md 12.2)
2. Write the approval in the same turn that Nathan gives it. Use the format in design.md section 12.4.
3. Put the ID in every design folder, PR title and commit for the screen.
4. Change "Standard" to `Migrated` only in the PR that migrates the screen, after the UI check passes.
5. Do not delete a row. Set "Standard" to `Retired` and give the reason in Notes.

**Design files.** After Nathan approves `docs/design.md`, the files move to the private repository `lion-pride-tcg-design`, in one folder for each ID (`UI-nn/`). Do not move them before that repository exists.

**Sources.** The rows UI-01 to UI-58 come from the 2026-10-04 audit (process report, section 2.2). UI-00 and UI-59 are new rows that the standard needs.

## Register

| ID | Screen | Design file | Approved | Built | Standard | Notes |
|---|---|---|---|---|---|---|
| UI-00 | Design system: tokens and components | `00-design-system.pen` | No | Not built (tokens in `ui-v2.css`) | Not migrated | New row. design.md section 12.8 step 1. Must be approved before any screen work |
| UI-01 | Shell: top bar and dock | `08-v3-home.png` | 2026-09-27, design, old `design.md` section 11 | #10 | Not migrated | Top bar later changed by design 29 (Shards and Shop). Sub-tabs moved into the top bar by #155 with no design |
| UI-02 | Sub-tab bar (all views) | None | No | #155 | Not migrated | One shared component, built with no design. Gap G-018 |
| UI-03 | Home | `19-home.pen`, earlier `08-v3-home` | Yes, date not recorded, design, memory only | #51 | Not migrated | Matches the design at a glance. Season tag removed by Nathan |
| UI-04 | Home boss: live portrait, resting boss | None | No | #35, #88 | Not migrated | |
| UI-05 | Home carousel | None | No | Not built | Not migrated | `docs/activities/README.md` section 2A asks for a design. D-14: later |
| UI-06 | Live in voice tile and Watch chip | `19-home` (Watch shown) | No. The Watch chip is an open question | #71, #72 | Not migrated | One tile has two actions (G-080) |
| UI-07 | Collection: card grid and filter panel | `08-v3-collection.png` | 2026-09-27, design, old `design.md` section 11 | #10, #13, #14 | Not migrated | Round 2 and 3 changes with no design update |
| UI-08 | Collection: card panel (side) | `08-v3-collection.png` | 2026-09-27, design, old `design.md` section 11 | #10 | Not migrated | |
| UI-09 | Card viewer (3D) with swipe arrows | None | No | v1 `openViewer`, #80 | Not migrated | Built before any design. D-16 step 3 |
| UI-10 | Ascension, celebration, stat points | None | No | v1 `renderAscension`, #36, #37 | Not migrated | |
| UI-11 | Collection: Raid Bosses tab | None | No | #36 | Not migrated | Tab name breaks the glossary ("boss") |
| UI-12 | Achievements (50), detail and Claim | `08-v3-achievements.png` | 2026-09-27, design, old `design.md` section 11 | #10, #13, #14, #15 | Not migrated | Uses "Redeem". The glossary says "Claim" |
| UI-13 | Achievement tracks, badges, titles and frames | None (build screenshots only, `design/30-achievements/`, not tracked) | Date not recorded, spec only, #153 | #153 (open, flag off) | Not migrated | Built first. Screenshots were shown as "design 30" |
| UI-14 | Profile (member) | `15-member-profile.pen` | 2026-09-27, design, commit `79ded8d` | #13 | Not migrated | |
| UI-15 | Profile style editor (titles, frames) and Spotlight editor | None | No | #14, #95 | Not migrated | |
| UI-16 | Profile wishlist and wish picker | `27-hall-*` | Yes, date not recorded, design, #112 ("designs 26 + 27, all approved") | #112 | Not migrated | |
| UI-17 | Hunt: squad select | `09-hunt-select-screen.png` | 2026-09-27, design, commit `09ddb67` | #12, #84, #85, #157 | Not migrated | Card details in pickers (#157) have no design |
| UI-18 | Hunt: battle | `08-v3-hunt.png`, `24-*` and `25-*` phone | 2026-09-27 desktop and 2026-10-01 phones, design | #10, #27, #103 | Not migrated | #27 changed the layout with no design |
| UI-19 | Hunt: resting and cooldown | None | No | #13, #156 | Not migrated | |
| UI-20 | Boss detail window | None | No | v1 `openBossModal` | Not migrated | |
| UI-21 | Hunt board (Hunt standings) | `12-leaderboard` (inferred) | No record | v1 `openHuntBoard`, #83 | Not migrated | D-12: becomes a tab of the one Leaderboard |
| UI-22 | Leaderboard | `12-leaderboard.pen` | No record (commit `e68eb37` "designs 10-14") | #13, #107 | Not migrated | Portrait (#107) has no design. Entry depends on another flag (G-074) |
| UI-23 | Logo | `10-logo.pen` | No record | #13 | Not migrated | D-04: the lion is the master logo |
| UI-24 | Bell: notifications, gifts to claim, ping settings | `11-notifications.pen` | No record | #13, #45, #64, #94 | Not migrated | Gift claims, gift animation and ping settings have no design |
| UI-25 | Community: Trades, trade builder, two-step accept | `14-trading.pen`, `14-trade-gift` | No record | #13, #78 | Not migrated | |
| UI-26 | Trade animation | None | No | #73 | Not migrated | |
| UI-27 | Community: Boons and Pranks | `16-community.pen` | 2026-09-27, design, commit | #16, #79, #136 | Not migrated | Visible limits (#136) have no design |
| UI-28 | Effects: member picker, confirm, incoming banners | None | No | #4 | Not migrated | Built the day the design process started |
| UI-29 | Member suggest (Find) | None | No | #108 | Not migrated | Named scroll area (design.md 3.3) |
| UI-30 | Trade Hall (Wanted, For trade, Mine) | `26-hall-*`, `26-review-1/2`, `27-*` | Yes, date not recorded, design, #112 | #112, #114, #115, #117, #122 | Not migrated | 3 review rounds changed the screens with no design update |
| UI-31 | Offer composer and List a card sheet | `26-review-2` | Yes, date not recorded, design, #112 | #112 | Not migrated | |
| UI-32 | Auctions: list, start, auction, seller, bidder, confirm | `26-review-2`, `27-*`, "one list" `bd34eec` | Yes, date not recorded, design, #112 | #112, #119 | Not migrated | |
| UI-33 | OPEN chooser (1, 5, 10) | `17-multi-open.pen`, `17-multi-pack.pen` | No record (#17 says "design 17") | #17 | Not migrated | Two `.pen` files with the same number |
| UI-34 | Pack reveal (single) | None | No | v1 `openPacks`, `showReveal` | Not migrated | D-16 step 3 |
| UI-35 | Multi-pack reveal (5, 10) | `17-reveal-screen.png` | No record | #17, #18, #67 | Not migrated | |
| UI-36 | Dailies window | `18-dailies.pen` | Yes, date not recorded, design, memory only | #51, #65 | Not migrated | Window passes the left edge at 667x375 (G-194) |
| UI-37 | First-time walkthrough | `21-tutorial.pen`, `22-tutorial-steps.pen` | No record (#61 says "designs 21 + 22") | #61 | Not migrated | Steps use old names (G-154) |
| UI-38 | Help panel (?) | `21-help-panel.png` | No record | #61, #65 | Not migrated | D-09: one help entry |
| UI-39 | Explainer carousels (Hall, Auctions, Trades, Pranks, Hunt, Collection) | `29-explainer/` | No. #120 asked to wait for approval and merged 9 minutes later | #120, #123 | Not migrated | |
| UI-40 | Report (wrench) | `23-report.pen` | Conflict: #70 says approved, a memory note says not approved | #70 | Not migrated | Nathan rules on the record |
| UI-41 | Phone layouts (landscape and portrait, all views) | `24-*`, `25-*`, `27-*` | 2026-10-01, design, #75 | #75, #76, #78, #79 and about 15 later fixes | Not migrated | The standard replaces the three layouts with one layout for each screen |
| UI-42 | Top bar Shards and Shop button | `29-shop.png` | 2026-10-02, design, #118 | #118 | Not migrated | Matches at a glance |
| UI-43 | Shop: stock, packs, stat reset, confirms, picker | `29-review-3/` (18 screens) | 2026-10-02, design, #118 | #118, #125 | Not migrated | Featured button label differs. Phone fixes (#125) have no design |
| UI-44 | Convert extra copies | None | Date not recorded, spec only, #128 (option B) | #128 | Not migrated | |
| UI-45 | Adventure tabs (Hunt, Dungeon) | `30-review-2` | 2026-10-03, design, process doc 03 | #147, #155 | Not migrated | The design shows "SOON" tabs. D-13: hide them |
| UI-46 | Dungeon lobby | `30-review-2/01, 06, 11` | 2026-10-03, design, #147 | #147, #154 | Not migrated | Filters changed after approval |
| UI-47 | Dungeon fight | `30-review-2/02, 07, 12` | 2026-10-03, design, #147 | #147, #154, #158, #159 | Not migrated | |
| UI-48 | Dungeon: choose a reward | `30-review-2/03, 08, 13` | 2026-10-03, design, #147 | #147, #158 | Not migrated | |
| UI-49 | Dungeon v2: room map, ? rooms, chest (3D), doors, rest, floor cleared, retreat | None | No | #158, #159, #160 | Not migrated | D-16 step 4 |
| UI-50 | Dungeon run over | `30-review-2/04, 09, 14` | 2026-10-03, design, #147 | #147, #160, #165 | Not migrated | |
| UI-51 | Dungeon leaderboard | `30-review-2/05, 10, 15` | 2026-10-03, design, #147 | #147 | Not migrated | D-12: becomes a tab of the one Leaderboard |
| UI-52 | Gauntlet: lobby, fight, over, prizes, board | None | Date not recorded, spec only, #163 | #163 | Not migrated | D-16 step 4 |
| UI-53 | Unlock gate | None | No | #147 | Not migrated | |
| UI-54 | Music button | None | No | #159 | Not migrated | Replaced by the one sound control (G-118) |
| UI-55 | Avatar effects (mustache) on Home, Profile, Leaderboard | None (build screenshots only, `design/30-effects/`, not tracked) | No | #151 (open) | Not migrated | |
| UI-56 | Loader and sign-in retry (Try again) | None | No | v1, #66 | Not migrated | D-16 step 3. Uses the 🦁 emoji and v1 colors |
| UI-57 | Legal pages (Terms, Privacy) | None | No | #43 | Not migrated | Outside the Activity frame. Named scroll area |
| UI-58 | Bot pictures (is-playing, raid, rare pulls, auctions) | `20-playing-post.pen` | Design 20: yes, #54. #104: spec only, no file | #54, #102, #104, #112 | Not migrated | Bot output. Uses the brand gold and the token source |
| UI-59 | Small live view (`tiny` class) | None | No | Not built | Not migrated | New row. D-06. D-16 step 2 |
| UI-60 | Menu grid (sheet on phones, panel on larger classes) | None | Spec approved (D-31, 2026-10-04) | Not built | Not migrated | New. Holds Dailies, Leaderboard, FAQ, Feedback, Settings, Events |
| UI-61 | Settings page | None | Spec approved (D-31, 2026-10-04) | Not built | Not migrated | New. Ping settings (from the bell) and Reduce effects (D-11) |
| UI-62 | Events / Game Log page | None | Spec approved (D-31, 2026-10-04) | Not built | Not migrated | New. Patch notes and upcoming events. Content source to decide |
| UI-63 | Trade window (Your cards / Their cards) | None | Spec approved (D-35, 2026-10-04) | Not built | Not migrated | New. Replaces the trade builder. UI-25 becomes the member picker + Pending. The request needs a server change first |
| UI-64 | Squad picker window (Hunt, Dungeon, Gauntlet) | None | Spec approved (D-40, 2026-10-04) | Not built | Not migrated | New. Replaces the grids in UI-17, UI-46 and the Gauntlet lobby |
