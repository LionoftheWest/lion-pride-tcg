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
| UI-00 | Design system: tokens and components | lion-pride-tcg-design `UI-00/approved/` (review-8) | 2026-10-05, design, lion-pride-tcg-design `UI-00/approval.md` | Not built (tokens in `ui-v2.css`) | Approved design, not built | Approved 2026-10-04 (review-3); review-5/6 (D-47, D-49, D-50, D-53) approved 2026-10-05 |
| UI-01 | Shell: top bar and dock | lion-pride-tcg-design `UI-01/approved/` (review-3) | 2026-10-04, design, lion-pride-tcg-design `UI-01/approval.md` | #10 | Approved design, not built | Top bar later changed by design 29 (Shards and Shop). Sub-tabs moved into the top bar by #155 with no design |
| UI-02 | Sub-tab bar (all views) | lion-pride-tcg-design `UI-02/approved/` (review-8) | 2026-10-05, design, lion-pride-tcg-design `UI-02/approval.md` | #155 | Approved design, not built | Approved 2026-10-04 (review-3); review-5 (D-47, D-49, D-50) approved 2026-10-05 |
| UI-03 | Home | design repo `UI-03/approved/` (review-3) | 2026-10-05, design, design repo `UI-03/approval.md` (commit faf6576) | #51 | Not migrated | v2 approved: layout by shape (D-46), Live pulls D-56. Earlier: `19-home.pen`, approved in memory only |
| UI-04 | Home boss: live portrait, resting boss | design repo `UI-04/approved/` (review-3) | 2026-10-05, design, design repo `UI-04/approval.md` (commit faf6576) | #35, #88 | Not migrated | Top 3 board D-58, slide control D-57, camera kept D-54 |
| UI-05 | Home carousel (Hunt, Dungeon, Gauntlet) | design repo `UI-05/approved/` (review-3) | 2026-10-05, design, design repo `UI-05/approval.md` (commit faf6576) | Not built | Not migrated | Events slide hidden (D-51). Board on every slide (D-58) |
| UI-06 | Live in voice tile, Watch chip and the "+N" window | design repo `UI-06/approved/` (review-1) | 2026-10-05, design, design repo `UI-06/approval.md` (commit faf6576) | #71, #72 | Not migrated | "+N" opens the Live in voice window (D-59). One tile has two actions (G-080) |
| UI-07 | Collection: card grid and filter panel | lion-pride-tcg-design `UI-07/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-07/approval.md` | #10, #13, #14 | Not migrated | D-60: tiles 55 x 77 px on compact-land |
| UI-08 | Collection: card panel (side) | lion-pride-tcg-design `UI-08/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-08/approval.md` | #10 | Not migrated | Rarity chip "Normal"; "Convert 2 extras" |
| UI-09 | Card viewer (3D) with swipe arrows | lion-pride-tcg-design `UI-09/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-09/approval.md` | v1 `openViewer`, #80 | Not migrated | The magnifier window is the UI-08 Card Detail |
| UI-10 | Ascension, celebration, stat points | lion-pride-tcg-design `UI-10/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-10/approval.md` | v1 `renderAscension`, #36, #37 | Not migrated | The phone sheet fits its content |
| UI-11 | Collection: Raid Bosses tab | lion-pride-tcg-design `UI-11/approved/` (review-1 + review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-11/approval.md` | #36 | Not migrated | Tab name breaks the glossary ("boss") |
| UI-12 | Achievements (50), detail and Claim | lion-pride-tcg-design `UI-12/approved/` (review-1 + review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-12/approval.md` | #10, #13, #14, #15 | Not migrated | Uses "Redeem". The glossary says "Claim" |
| UI-13 | Achievement tracks, badges, titles and frames | lion-pride-tcg-design `UI-13/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-13/approval.md` | #153 (draft: the UI part), #223 (SQL + server, flag off) | Not migrated | D-74 to D-78 answer the open items. Needs the 5 tier tokens (D-75, lane A) |
| UI-14 | Profile (member) | lion-pride-tcg-design `UI-14/approved/` (review-1 + review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-14/approval.md` | #13 | Not migrated | |
| UI-15 | Profile style editor (titles, frames) and Spotlight editor | lion-pride-tcg-design `UI-15/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-15/approval.md` | #14, #95 | Not migrated | Grid moves to the Card picker UI-64 when approved (D-42) |
| UI-16 | Profile wishlist and wish picker | lion-pride-tcg-design `UI-16/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-16/approval.md` | #112 | Not migrated | |
| UI-17 | Hunt: squad select | lion-pride-tcg-design `UI-17/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-17/approval.md` | #12, #84, #85, #157; v3 #280 (flag ui_v3) | In migration | v3 build #280 behind ui_v3: the D-61 boss stage and squad strip; the squad is picked in the Card picker (UI-64). The v2 view stays for members until the flag opens |
| UI-18 | Hunt: battle | lion-pride-tcg-design `UI-18/approved/` (review-4) | 2026-10-06, design, lion-pride-tcg-design `UI-18/approval.md` | #10, #27, #103 | Not migrated | #27 changed the layout with no design |
| UI-19 | Hunt: resting and cooldown | lion-pride-tcg-design `UI-19/approved/` (review-2 + review-3) | 2026-10-05, design, lion-pride-tcg-design `UI-19/approval.md` | #13, #156 | Not migrated | |
| UI-20 | Boss detail window | lion-pride-tcg-design `UI-20/approved/` (review-2) | 2026-10-06, design, lion-pride-tcg-design `UI-20/approval.md` | v1 `openBossModal` | Not migrated | |
| UI-21 | Hunt board (Hunt standings) | `12-leaderboard` (inferred) | No record | v1 `openHuntBoard`, #83 | Retired | Merged into UI-66, one Leaderboard window (D-44). Retired by Nathan 2026-10-06 |
| UI-22 | Leaderboard | `12-leaderboard.pen` | No record (commit `e68eb37` "designs 10-14") | #13, #107 | Retired | Merged into UI-66, one Leaderboard window (D-44). Retired by Nathan 2026-10-06 |
| UI-23 | Logo | lion-pride-tcg-design `UI-23/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-23/approval.md` | #13 | Not migrated | D-04: the lion is the master logo |
| UI-24 | Bell: notifications, gifts to claim, ping settings | lion-pride-tcg-design `UI-24/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-24/approval.md` | #13, #45, #64, #94 | Not migrated | Gift claims, gift animation and ping settings have no design |
| UI-25 | Community: Trades, trade builder, two-step accept | lion-pride-tcg-design `UI-25/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-25/approval.md` | #13, #78 | Not migrated | Member picker + Pending (D-35, D-43); D-63 answers; review-2 in review |
| UI-26 | Trade animation | lion-pride-tcg-design `UI-26/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-26/approval.md` | #73 | Not migrated | |
| UI-27 | Community: Boons and Pranks | lion-pride-tcg-design `UI-27/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-27/approval.md` | #16, #79, #136 | Not migrated | Visible limits (#136) have no design |
| UI-28 | Effects: member picker, confirm, incoming banners | lion-pride-tcg-design `UI-28/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-28/approval.md` | #4 | Not migrated | Built the day the design process started |
| UI-29 | Member suggest (Find) | lion-pride-tcg-design `UI-29/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-29/approval.md` | #108 | Not migrated | Named scroll area (design.md 3.3) |
| UI-30 | Trade Hall (Wanted, For trade, Mine) | lion-pride-tcg-design `UI-30/approved/` (review-2, D-67) | 2026-10-06, design, lion-pride-tcg-design `UI-30/approval.md` | #112, #114, #115, #117, #122 | Not migrated | 3 review rounds changed the screens with no design update |
| UI-31 | Offer composer and List a card sheet | lion-pride-tcg-design `UI-31/approved/` (review-2, D-67) | 2026-10-06, design, lion-pride-tcg-design `UI-31/approval.md` | #112 | Not migrated | |
| UI-32 | Auctions: list, start, auction, seller, bidder, confirm | lion-pride-tcg-design `UI-32/approved/` (review-3, D-67) | 2026-10-06, design, lion-pride-tcg-design `UI-32/approval.md` | #112, #119 | Not migrated | |
| UI-33 | Open window: choose the set, then 1 / 5 / 10 (D-80 to D-90) | lion-pride-tcg-design `UI-33/approved/` (review-3) | 2026-10-07, design, lion-pride-tcg-design `UI-33/approval.md` | #274 (flag ui_v3); #17 (old chooser) | Built (flag ui_v3), PR #274 | Needs `GET /api/sets` and `/api/open` with `set` (PR #237, live 2026-10-07). The Season 2-4 frames are layout previews only |
| UI-34 | Pack reveal (single): idle loop, tap, tear clip, cards face down, best card last (D-91 to D-101) | lion-pride-tcg-design `UI-34/approved/` (review-3) | 2026-10-07, design, lion-pride-tcg-design `UI-34/approval.md` | v1 `openPacks`, `showReveal` | Approved design, not built | Plays the chosen set's clips from `tcg-activity/public/packs/<set_id>/` (`idle_loop.webp`, `open.webp`, `open_rare.webp`; rare = any SR+ card, the rare SFX at ~1400 ms). The clips come from `card-studio/pack-art/` (PR pending). The frames show an earlier pack front: the clips decide the look |
| UI-35 | Multi-pack reveal (5, 10): one swipe opens all packs, all cards on one screen (D-72, D-99, D-100, D-106 to D-109) | lion-pride-tcg-design `UI-35/approved/` (review-3) | 2026-10-07, design, lion-pride-tcg-design `UI-35/approval.md` | #17, #18, #67 | Approved design, not built | Hint text "Swipe to open" (D-106, the frames say a longer text); only the pack with an SR+ card plays `open_rare.webp` (D-107); same clips as UI-34 |
| UI-36 | Dailies window | lion-pride-tcg-design `UI-36/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-36/approval.md` | #51, #65; v3 #279 (flag ui_v3) | In migration | v3 build #279 behind ui_v3 (opens from the Menu, UI-60); the v2 window stays for members until the flag opens. Was: window passes the left edge at 667x375 (G-194) |
| UI-37 | First-time walkthrough | lion-pride-tcg-design `UI-37/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-37/approval.md` | #61 | Not migrated | Steps use old names (G-154) |
| UI-38 | Help panel (?) | lion-pride-tcg-design `UI-38/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-38/approval.md` | #61, #65 | Not migrated | D-09: one help entry |
| UI-39 | Explainer carousels (Hall, Auctions, Trades, Pranks, Hunt, Collection) | lion-pride-tcg-design `UI-39/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-39/approval.md` | #120, #123 | Not migrated | |
| UI-40 | Report (wrench) | lion-pride-tcg-design `UI-40/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-40/approval.md` | #70 | Not migrated | Nathan rules on the record |
| UI-41 | Phone layouts (landscape and portrait, all views) | None (no design needed) | 2026-10-06, design, lion-pride-tcg-design `UI-41/approval.md` | #75, #76, #78, #79 and about 15 later fixes | Not migrated | The standard replaces the three layouts with one layout for each screen |
| UI-42 | Top bar Shards and Shop button | lion-pride-tcg-design `UI-42/approved/` (review-3) | 2026-10-04, design, lion-pride-tcg-design `UI-42/approval.md` | #118 | Approved design, not built | Matches at a glance |
| UI-43 | Shop: stock, packs, stat reset, confirms, picker | lion-pride-tcg-design `UI-43/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-43/approval.md` | #118, #125 | Not migrated | Featured button label differs. Phone fixes (#125) have no design |
| UI-44 | Convert extra copies | lion-pride-tcg-design `UI-44/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-44/approval.md` | #128 | Not migrated | |
| UI-45 | Adventure tabs (Hunt, Dungeon) | None (no design needed) | 2026-10-06, design, lion-pride-tcg-design `UI-45/approval.md` | #147, #155 | Not migrated | The design shows "SOON" tabs. D-13: hide them |
| UI-46 | Dungeon lobby | lion-pride-tcg-design `UI-46/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-46/approval.md` | #147, #154; v3 #275 (flag ui_v3) | In migration | v3 build #275 behind ui_v3: the slots view (D-40); the v2 lobby stays for members until the flag opens |
| UI-47 | Dungeon fight | lion-pride-tcg-design `UI-47/approved/` (review-2, all frames) | 2026-10-06, design, lion-pride-tcg-design `UI-47/approval.md` | #147, #154, #158, #159 | Not migrated | |
| UI-48 | Dungeon: choose a reward | lion-pride-tcg-design `UI-48/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-48/approval.md` | #147, #158 | Not migrated | |
| UI-49 | Dungeon v2: room map, ? rooms, chest (3D), doors, rest, floor cleared, retreat | lion-pride-tcg-design `UI-49/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-49/approval.md` | #158, #159, #160 | Not migrated | D-16 step 4 |
| UI-50 | Dungeon run over | lion-pride-tcg-design `UI-50/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-50/approval.md` | #147, #160, #165 | Not migrated | |
| UI-51 | Dungeon leaderboard | `30-review-2/05, 10, 15` | 2026-10-03, design, #147 | #147 | Retired | Merged into UI-66, one Leaderboard window (D-44). Retired by Nathan 2026-10-06 |
| UI-52 | Gauntlet: lobby, fight, over, prizes, board | lion-pride-tcg-design `UI-52/approved/` (review-1: lobby, over, prizes, board) | 2026-10-06, design, lion-pride-tcg-design `UI-52/approval.md` | #163 | Not migrated | D-16 step 4 |
| UI-53 | Unlock gate | lion-pride-tcg-design `UI-53/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-53/approval.md` | #147 | Not migrated | |
| UI-54 | Music button | None (no design needed) | 2026-10-06, design, lion-pride-tcg-design `UI-54/approval.md` | #159 | Not migrated | Replaced by the one sound control (G-118) |
| UI-55 | Avatar effects (mustache) on Home, Profile, Leaderboard | lion-pride-tcg-design `UI-55/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-55/approval.md` | #151 (open) | Not migrated | |
| UI-56 | Loader and sign-in retry (Try again) | lion-pride-tcg-design `UI-56/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-56/approval.md` | v1, #66 | Not migrated | D-16 step 3. Uses the 🦁 emoji and v1 colors |
| UI-57 | Legal pages (Terms, Privacy) | lion-pride-tcg-design `UI-57/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-57/approval.md` | #43 | Not migrated | Outside the Activity frame. Named scroll area |
| UI-58 | Bot pictures (is-playing, raid, rare pulls, auctions) | None (no design needed) | 2026-10-06, design, lion-pride-tcg-design `UI-58/approval.md` | #54, #102, #104, #112 | Not migrated | Bot output. Uses the brand gold and the token source |
| UI-59 | Small live view (`tiny` class) | lion-pride-tcg-design `UI-59/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-59/approval.md` | Not built | Not migrated | New row. D-06. D-16 step 2 |
| UI-60 | Menu grid (sheet on phones, panel on larger classes) | lion-pride-tcg-design `UI-60/approved/` (review-3) | 2026-10-04, design, lion-pride-tcg-design `UI-60/approval.md` | Not built | Approved design, not built | New. Holds Dailies, Leaderboard, FAQ, Feedback, Settings, Events |
| UI-61 | Settings page | lion-pride-tcg-design `UI-61/approved/` (review-1) | 2026-10-06, design, lion-pride-tcg-design `UI-61/approval.md` | Not built | Not migrated | New. Ping settings (from the bell) and Reduce effects (D-11) |
| UI-62 | Events / Game Log page | None (no design needed) | 2026-10-06, design, lion-pride-tcg-design `UI-62/approval.md` | Not built | Not migrated | New. Patch notes and upcoming events. Content source to decide |
| UI-63 | Trade window (Your cards / Their cards) | lion-pride-tcg-design `UI-63/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-63/approval.md` | Not built | Not migrated | D-63: Gift a pack, extra copies first; review-2 in review |
| UI-64 | Card picker window (squads, trades, Trade Hall, wishlist, Spotlight, boons/pranks; D-42) | lion-pride-tcg-design `UI-64/approved/` (review-3) | 2026-10-05, design, lion-pride-tcg-design `UI-64/approval.md` | #275 (flag ui_v3) | In migration | New. Replaces the grids in UI-17 and UI-46 (the Gauntlet has no picker: the server chooses its squad). First user: the Dungeon (#275) |
| UI-65 | Member picker (Trades, Gift, Boons & pranks, profiles) | lion-pride-tcg-design `UI-65/approved/` (review-2) | 2026-10-05, design, lion-pride-tcg-design `UI-65/approval.md` | v3 PR (flag ui_v3) | In migration | New. The shared component `src/ui3/member-picker.js` (review-2: the magnifier on member tiles, D-64). Not wired yet: first user UI-25 Trades, then UI-27/UI-28 Boons, Gift, profiles |
| UI-66 | Leaderboard window (Main, Hunt, Dungeon, Gauntlet tabs) | lion-pride-tcg-design `UI-66/approved/` (review-1) | 2026-10-05, design, lion-pride-tcg-design `UI-66/approval.md` | Not built | Not migrated | New. Merges UI-21, UI-22, UI-51 and the Gauntlet board |
