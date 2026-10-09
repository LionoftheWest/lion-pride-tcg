# Lion Pride TCG — UI standard
Status: **Approved** (Nathan, 2026-10-04, words: "Approved", in chat after reading `ui-audit/APPROVE.md`; PR #169). The UI freeze in `CLAUDE.md` stays until the exit criteria in section 12.9 are met.
Owner: Nathan. Screen register: [`docs/ui-register.md`](ui-register.md).
Evidence: the 2026-10-04 audit (197 gaps G-001 to G-197, decisions D-01 to D-22). The audit is not in this repository.

## 0. Purpose, scope and how to use this file
**Purpose.** This file is the one UI standard for Lion Pride TCG. Other files link to it and hold no UI rule. (G-001, G-191)
The standard wins over every design file, old document and memory note. (G-002, G-180)

**Scope.** The Activity (`tcg-activity/`), the bot pictures and embeds (`tcg-bot/`), the gallery and legal pages, and the three.js scenes.
Server, SQL and bot logic that does not change what a member sees is out of scope.

**Who reads it, and when.**
- A design session reads sections 1 to 10 and section 12 before a pen.dev frame.
- A build session reads all sections before a UI change. Before the PR, it runs the check in section 12.6.
- A review session reads section 12 and the register row before an approval or a merge.
- Nathan reads section 1, the register row and the deviation list at each approval.

**How a rule is written.**
- Each rule is one instruction, with a threshold when a number applies.
- The gap ids that the rule closes are in brackets, for example (G-018).
- **[CI]** marks a rule with an automatic check. All other rules are on the review checklist. (G-181)
- **†** marks a start value. The approved design system (UI-00) can change it. This file then records the new value.

**The freeze.** All new UI work is frozen until Nathan approves this file. `CLAUDE.md` holds the freeze text. This file does not lift the freeze. Section 12.9 gives the exit criteria.

## 1. Principles
The principles are in priority order. When two rules conflict, the higher principle wins.

**P0. No redesign.** Keep the look and the flow that members know today. (G-002, G-180)
- Make a change only when it closes a named gap or makes the UI simpler.
- Take each token from today's canonical value. Collapse each near-duplicate into the existing value.
- Take each component from today's best version: the version that matches an approved design.
- Start each pen.dev frame from a screenshot of the current screen.
- Keep the dark theme: near-black panels, gold accents and rarity colors.

**P1. Same experience on every size.** Desktop, tablet and phone members get the same features and quality. (G-003, G-007)
- Make every function and every primary item reachable on every size class, with the same tap flow.
- A size class can move content into a tab, a sheet or a page. It cannot remove content.
- The `tiny` class is the only exception. It shows the small live view (D-06).

**P2. Touch first.** Design each control for a finger first. Then add pointer and keyboard comfort. (G-008, G-104, G-105)

**P3. One source for each fact.** Each token, label, format, string and rule has one source that every surface reads. (G-026, G-094, G-143)
The brand gold `#F4B73C` is the same in the Activity, the bot pictures, the embeds and the gallery.

**P4. Check on every size.** No UI change ships before the UI check passes at every test size (section 2.2). (G-006, G-185)

**P5. Screens show state; windows do the work.** A screen shows where things stand. Choosing, editing, filtering and reading details happen in a window that opens on a tap: the Card Detail, Filters, the Card picker, the Member picker, Pending, the Offer view, the Leaderboard and Menu. (D-30 to D-44)

**P6. Information is one tap away.** A surface shows only what a member needs at a glance. Counts, captions, letters, labels and owned badges are not on the surface. They are in the window that a tap opens. A Dot points to the exact place where an action waits. (D-23, D-24, D-27 to D-29, D-33)

**P7. General rules, no exceptions.** When a case does not fit a rule, change the rule for every case, or show that the case follows a more general rule. Do not add a special case. (D-29, D-41)

## 2. Size classes, test devices and Discord limits
### 2.1 Size classes
The shell computes the class from the **usable** frame in CSS px: the Activity frame minus the safe areas. (G-007, G-009)
Test the rules in this order. The first match sets the class. Every size matches exactly one class.

| Order | Class | Rule (usable px) | Examples | Layout |
|---|---|---|---|---|
| 1 | `tiny` | height < 300 OR width < 360 | Discord PiP, voice grid tile | Small live view only (D-06) |
| 2 | `compact-land` | height < 500 AND width > height | Phones in landscape, desktop windows below 500 px tall | Today's landscape layout: slim top bar, bottom dock (P0) |
| 3 | `compact-port` | width < 600 | Phones in portrait | One column, bottom dock |
| 4 | `medium` | width < 1200 | Tablets in both orientations, desktop at 1024 px | Two columns, sub-tabs on their own row |
| 5 | `expanded` | all other sizes (width ≥ 1200, height ≥ 500) | Discord desktop 1280x720 to 1990x830 | Three columns |

The modifier `short` applies to `medium` and `expanded` when the usable height is below 700. It makes spacing tighter. It never hides a function. (G-007)

The modifier `low` applies to `compact-land` when the usable height is below 400 (the 667x375 phones). The sub-tabs move into the top bar row, right of the logo emblem, as icon tabs. The logo word and the "?" leave the bar (the "?" stays in the screen, as on `compact-port`). (D-117)
- One shell module sets the class, the input, the platform, the GPU tier and the keyboard state on `body`. (G-009, G-016)
- Read the input from `(pointer: coarse)` or the SDK platform. Never derive the input from the size. (G-008)
- Do not use a raw `@media` width or height query in screen CSS. Use the class or `@container`. **[CI]** (G-009, G-021)
- Re-fit every paged surface within 200 ms after a size change. Use one debounced observer in the shell. (G-010)
- Keep the view state on a class or orientation change: open sheet, selection, first visible item, focus. Make no network call. (G-011)
- Remove the flag-off phone path. The phone layout is the only phone layout. (G-017)
- The `tiny` class shows boss HP, the pack count and one **Open full** action. Subscribe to the Discord layout mode. (G-012, D-06)
- Verify the SDK call for **Open full** before the build, and record it here. (G-012)

### 2.2 Test devices (D-18)
The UI check (section 12.6) runs every screen and every overlay at these sizes. Design frames use the same list. (G-006, G-185)

| # | Size (CSS px) | Device or window | Class | Input |
|---|---|---|---|---|
| 1 | 375x667 | iPhone SE, portrait | compact-port | touch |
| 2 | 667x375 | Desktop window, short | compact-land | pointer |
| 3 | 430x932 | iPhone 15 Pro Max, portrait | compact-port | touch |
| 4 | 932x430 | Desktop window, short | compact-land | pointer |
| 5 | 430x822 | Nathan's iPhone, portrait | compact-port | touch |
| 6 | 412x915 | Pixel, portrait | compact-port | touch |
| 7 | 915x412 | Desktop window, short | compact-land | pointer |
| 8 | 820x1180 | iPad, portrait | medium | touch |
| 9 | 1180x820 | Desktop window, medium | medium | pointer |
| 10 | 692x917 | Android tablet, portrait | medium | touch |
| 11 | 917x692 | Desktop window, short | medium + short | pointer |
| 12 | 1280x720 | Discord desktop, small | expanded | pointer |
| 13 | 1990x830 | Discord desktop, design target | expanded | pointer |
| 14 | 1280x480 | Discord desktop, short window | compact-land | pointer |
| 15 | 400x225 | Discord PiP | tiny | touch |

D-136: phones and tablets are locked to portrait (Nathan sets the lock in the Discord Developer Portal), so only desktop has landscape. Rows 2, 4, 7, 9 and 11 are desktop windows: the check runs them with no touch, no safe-area preset and no keyboard variant. D-138: there is no typing in the tiny window, so row 15 has no keyboard variant.
- Run each size in Chromium and in WebKit. Run the touch sizes with the safe-area presets and with the keyboard open. (G-185, G-013, G-015)
- Measure the real PiP and grid-tile frames in Discord. Update row 15 with the measured size. (G-012)

### 2.3 Discord limits
**Safe areas.** (G-013, G-014, G-194)
- Read `--discord-safe-area-inset-*` first, then `env(safe-area-inset-*)`.
- The shell owns the safe frame for every layer. Every overlay, close button and window sits inside it. **[CI]**
- When Discord gives no inset, guess only on a touch platform. Never guess on desktop.
- In landscape, guess both sides. Today the guess is 64 px. Measure it on a real phone and record it here.
- In portrait, guess the top. The value is open. Measure it on a real phone before the shell build.

**Other limits.**
- Corner buttons: Discord puts Leave and collapse in the corners. Keep every control out of the corner zones. **[CI]** (G-013)
- Header: in portrait, the inset can arrive after the first frame. The shell reads the inset again when it changes. (G-014)
- Keyboard: the shell exposes the keyboard height from `visualViewport`. The keyboard never covers the focused text box. (G-015)
- Platform: the shell reads iOS, Android, desktop or web from the SDK, and owns each platform difference. (G-016)

## 3. Screen areas and layout models
### 3.1 Shell areas
The shell is one CSS grid of named areas. No element uses the px size of another element. (G-020, G-021)

| Area | compact-port | compact-land | medium | expanded |
|---|---|---|---|---|
| `safe` frame | Insets, top guess | Insets, both sides guess | Insets | Insets (0 on desktop) |
| `top bar` | Logo, Shards, Shop, bell, Menu, avatar (D-31) | Slim | Full | Full |
| `sub-tabs` | Own row under the top bar (D-37) | Own row under the top bar, slim (D-37) | Own row under the top bar (D-37) | Own row under the top bar (D-37) |
| `content` | 1 column | 2 columns | 2 columns | 3 columns |
| `action rail` | Above the dock | Right edge | Bottom of the content | In the content |
| `dock` | Full width, bottom | Slim, bottom (as today, P0) | Bottom, centered | Bottom, centered |
- Sub-tabs are always one row directly under the top bar, on every class except `tiny`. The place never changes. On `compact-port` the tabs share the full width equally. On the other classes they are compact and left-aligned. On `compact-land` the row is slim (about 30 px). Exception: on `compact-land` with `low`, the tabs are in the top bar row (D-117). (D-37, G-018)
- A view has at most 4 visible sub-tabs, so every label fits at 375 px. Never cut a tab label. **[CI]** (G-065)
- Every sub-tab has an icon and its name, on every class. All tab icons come from the one line-icon set of the UI-00 library: the same stroke, size and color rules. Cards, Achievements and Bosses get icons from that set. (D-47)
- Each tab is as wide as its icon and name, and the row fills its width. The row fits on every phone width (320 px and up). A tab name always stays on one line: it may shrink to the minimum type size, but it never wraps. This is an exception to D-08 for sub-tabs. The row never scrolls and never cuts a name. (D-49)
- One icon has one meaning in the whole app. Tab icons: Trades `arrow-left-right`, Trade Hall `landmark`, Boons `party-popper` (the tab label is "Boons", D-62), Cards `layers`, Achievements `award` (the medal; `trophy` is the Leaderboard), Bosses `skull`, Hunt `swords`, Dungeon `castle`, Gauntlet `crown`. (D-50)
- Build each screen one time. It adapts by class through a short, named list of per-class changes. (G-019)
- Do not add a new `m-land` or `m-port` selector. **[CI]** (G-019, G-182)
- Size each component from its container with `@container`. Take type and space from the scales in section 4. (G-021)

### 3.2 Flowing screens and stage screens
Each screen spec names its model.

| Model | What it is | Examples | How it fits |
|---|---|---|---|
| Flowing | Grids, lists and panels | Collection, Trades, Trade Hall, Shop, Leaderboard, Profile, Dailies | Pages by the items that fit |
| Stage | A fixed composition | Hunt fight, Dungeon fight, Gauntlet fight, pack reveal | Scales the stage, and keeps the regions in fixed ratios |

### 3.3 No scroll, no bleed, no movement, no overlap
- A screen never scrolls. Each screen fits in one view. **[CI]** (G-004)
- Only the named areas can scroll (D-07): help answers, legal pages, member suggest list, Report text box. (G-004)
- Each named area shows a visible scroll cue. A new area needs Nathan's approval and an entry here. (G-004)
- Nothing bleeds. Text and icons stay inside their boxes. **[CI]** (G-005)
- Nothing moves when a state changes. Give each status a place with a fixed size.
- Sections in one view never overlap. When the height is too small, a section moves into a tab, a sheet or a page. **[CI]** (G-196)

### 3.4 Content priority and paging
- Tag each element of a screen spec P (primary), S (secondary) or T (tertiary). (G-023)
- A class can move S and T content into a tab, a sheet or a page. It never removes P content. (G-003, G-023)
- When fit code must remove content, it removes T first and never removes P. (G-023)
- When the content area is taller than it is wide, side columns stack below the main content as full-width rows, in priority order. When it is wider than tall, side columns sit beside the main content. Decide this from the shape of the content area (`@container`), never from the device. (D-46)
- Example (D-41): the Shop shows Today's stock (P), Packs and Stat reset (S). On `expanded`, Packs and Stat reset are a right column beside the stock. On `medium`, `compact-port` and `compact-land`, the three are sub-tabs (D-37). The "New stock in" timer is a chip in the Today's stock header line on every class.
- The pack count (on the OPEN button, D-23), the Leaderboard entry and the profile achievements are P content on every class. (G-003)
- Every list that can overflow pages ("1 / N") or shows "+N more". Never delete a row that does not fit. **[CI]** (G-022)
- The page size is the number of items that fit. A grid adds a row before it adds a page. (G-197)
- Content fills the content area, or it is centered in it. Empty space above 25% is a defect. **[CI]** (G-197)
- Every card grid shows at least 2 rows of cards. (G-099)

### 3.5 No layout in JavaScript
- JavaScript computes one number for each paged surface, the page size, through the one grid fitter. (G-020, G-099)
- JavaScript never sets the position or the size of an element from another element. It never removes a node to fit. (G-020, G-022)

### 3.6 Home hero carousel (D-14, D-45)
- The Home hero is a carousel with 4 slides: Hunt, Dungeon, Gauntlet and Events. A slide shows only when its mode is on. The Events slide stays hidden until the events and daily content exists (UI-62). (D-45, D-51)
- The first slide is the one that needs the member most: a live boss first. When the Hunt rests, the next active mode is first. (D-14, D-45, G-024)
- The carousel never moves by itself. The member changes the slide with the slide control, a swipe or the arrow buttons (44 px). A tap on a slide opens its mode. (D-45)
- The slide control: on `expanded` and `medium`, a small labelled control "Hunt · Dungeon · Gauntlet" (the active slide in gold). On compact classes, dots. (D-57)
- A slide with news shows the Dot, for example a Dungeon run not used today. On the labelled control, the Dot follows the slide name. On dots, it sits on that slide's dot. So it shows from any slide. (D-45, D-55, D-57)
- Every slide follows the Home notes: the boss fully visible, no overlap, no cut text, everything above the dock.
- Each slide shows its mode's Top 3 in the slide's text column, never over the slide art: rank, avatar, name, score. A tap opens the Leaderboard window on that mode's tab. A board with fewer entries shows only the real entries. Where 3 rows do not fit without a smaller boss (`compact-land`), the slide keeps one line, for example "Top hunter: Blade · 6,075", as a button with a frame. (D-58, D-44, D-52; replaces the "no list" part of D-48)
- Live pulls rows have one 8 px gap, left-aligned two-line text ("member pulled", then the card name) and the pager 12 px under the last row. (D-56)
- The "+N" cell of Live in voice opens the Live in voice window: every member in voice, others first and you last, paged with "1 / N". It is a side panel on `expanded`, a side sheet on `medium` and `compact-land`, and a bottom sheet on `compact-port`. (D-59)
- The 3D boss keeps today's camera and framing. (D-54)
- Phones show the boss stats row (Your damage, Boss HP, Tier) as the larger classes do. Live in voice lists the other members first, then you. (D-55)

## 4. Tokens
### 4.1 Token rules
- Keep all tokens in one source file. The first token PR sets the path (proposed: `shared/tokens.json`). (G-051)
- Generate the Activity CSS, gallery CSS, bot module and three.js constants from the source file. (G-026)
- A global token has a plain name (`--gold`). A component variable uses the local prefix `--c-`. (G-051)
- Write colors in one notation: uppercase hex6, or hex8 for alpha. (G-051)
- A lint rule fails a new color, size, radius, shadow, duration or `z-index` literal outside the token source. **[CI]** (G-051, G-182)
- Remove or port every v1 rule. No live screen uses a v1 class or value. (G-027)

### 4.2 Brand gold
One brand gold on every surface (Nathan decision 3). The brand accent of the Discord embeds is `0xF4B73C`. (G-025, G-026)

| Token | Value | Use | Collapses |
|---|---|---|---|
| `--gold` | `#F4B73C` | Brand, primary action, Gold rarity (D-02) | `#F5B942`, `#F4C14B`, `#F59E0B`, `#F7BE35` |
| `--gold-hi` | `#FFD76E` | Highlights, gradient top | `#FFD66B`, `#FFD272`, `#FFE08A` and 8 more |
| `--gold-strong` | `#E0971C` | Gradient bottom, pressed | `#E09A1E`, `#D8901A` |
| `--gold-deep` | `#C9820F` | Deep edge of the logo tile | `#B8791A`, `#B8862A`, `#C69113` |
| `--on-gold` | `#1C1203` | Text and icons on gold | `#1A0D00`, `#1A0D03`, `#221A00` |
| `--gold-a10` to `--gold-a50` | `#F4B73C` at 10, 20, 35, 50% | Soft fills, borders, glows | 118 hand-written `rgba()` golds |

### 4.3 Surfaces
A ladder of 7 named steps. The bot pictures and the gallery use `--bg-base` too. (G-028, G-026)

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#0A0A12` | Page. Replaces bot `#0D0F16` and gallery `#0A0D14` |
| `--bg-raised` | `#11111B` | Dock and top bar fills |
| `--surface-1` | `#181824` | Panels (today `--surface`) |
| `--surface-2` | `#20202F` | Raised items in a panel |
| `--surface-3` | `#2A2A3D` | Highest item, selected row |
| `--overlay` | `#11111B` at 92% | Dock and floating bars |
| `--scrim` | `#000000` at 60% | Under a sheet or a modal |

### 4.4 Text and borders
| Token | Value | Contrast on the 5 surfaces | Note |
|---|---|---|---|
| `--text-primary` | `#F5F2EC` | 12.55 or more | Collapses the cool whites |
| `--text-secondary` | `#AEABC0` | 6.27 or more | Collapses the cool greys |
| `--text-muted` | `#9592AB` (new value) | 4.66 or more | Replaces `#6F6C86` (2.78 to 3.91) |
| `--text-on-color` | `#FFFFFF` | Only on a colored fill | Pure white only here |
| `--border` | `#2A2A3E` | Decorative dividers only | Never a control edge |
| `--border-strong` | `#76769C` (new value) | 3.23 or more | Control edges. Replaces `#3B3B57` |
- Use one text ramp on every surface: primary, secondary, muted and on-color. (G-034)
- Text on a gradient or an image passes 4.5:1 against the lightest stop, or it sits on a scrim. (G-033)

### 4.5 State colors
| Token | Base | Text variant | Soft fill |
|---|---|---|---|
| `--danger` | `#FF4D63` | `#FF6B7D` | base at 14% |
| `--danger-strong` | `#D42F45` | Badge fill with white text (4.89:1) | n/a |
| `--warning` | `#FF8A3D` | base | base at 14% |
| `--success` | `#5BE38A` | base | base at 12% |
| `--info` | `#7FB2FF` | base | base at 14% |
- Each state token has soft, border and on-color variants. (G-035)
- A red count badge uses `--danger-strong`. A badge fill gives 4.5:1 or more with its text. (G-031)
- A value that blocks an action uses `--danger` and states the reason. (G-195)

### 4.6 Game system colors
**Rarity (D-01, D-02).** One table for all 7 rarities. CSS, JS, the bot, the embeds, the gallery and 3D read it. (G-094, G-095, G-096)

| Rarity | Label | Short | Rank | Color | Text variant |
|---|---|---|---|---|---|
| normal | Normal | N | 1 | `#A3ACBC` | base |
| illustrated_rare | Illustrated Rare | IR | 2 | `#3E8BFF` | `#4DA3FF` |
| secret_rare | Secret Rare | SR | 3 | `#B15CFF` | `#B07CFF` |
| full_art | Full Art | FA | 4 | `#FF4FA3` | base |
| gold | Gold | G | 5 (top) | `#F4B73C` (= `--gold`) | base |
| event | Event | EV | special | `#10B981` | base |
| promo | Promo | PR | special | `#C9CED8` (new token) | base |
- Each rarity has a `-soft` (14%) and a `-glow` variant. "Special" means Event and Promo, from this table only. (G-094, G-096)
- On a card face, the frame shows the rarity. The rarity name shows in the Card Detail, the rarity filter chips and the pack reveal. (G-097, D-02, D-29)
- A rarity chip shows only the full rarity name, for example "Normal". It has no letter or short form in front (D-28).
- The design PNG names Rare, Epic, Legendary and Mythic are superseded. (G-002, G-095)

**Elements.** 14 tokens (13 elements and physical) and one icon set. They are the only source for CSS, canvas and three.js. (G-098)

| Key | Color | Key | Color |
|---|---|---|---|
| fire | `#FF6A3D` | air | `#BFEAFF` |
| water | `#3CB6FF` | arcane | `#E06AFF` |
| lightning | `#FFD43B` | psychic | `#FF6AD0` |
| ice | `#9BEBFF` | toxic | `#9CD93C` |
| nature | `#5BD66B` | metal | `#A8BCCF` |
| earth | `#C98D55` | physical | `#DFE6F2` |
| shadow | `#8A6CFF` (text `#A08AFF`) | light | `#FFF1B8` |

**Effect kinds (D-03).** (G-037)

| Kind | Base | Gradient | Note |
|---|---|---|---|
| boon | `#3DD9B4` (teal) | `#3DD9B4` to `#1FA886` | Not gold. Gold already means brand and Gold rarity |
| prank | `#B28CFF` | `#9A73FF` to `#6B45E6` | |
| shield | `#7FB2FF` | `#7FB2FF` to `#3C7BE0` | New token. Shares the `--info` hue, with a shield icon and a label |

**Other game colors.**

| Token | Value | Note |
|---|---|---|
| `--hunt` | `#7C5CFF` | Fill only. Text variant `#A08AFF` |
| `--cur-shards` | `#B8F02A` | Global, not Shop-only. `-deep` `#7FAE12`, `-hi` `#F1FFC9`, `-soft` 12% (G-038) |
| `--name-color-1` to `-8` | Today's 8 `NAME_COLORS` | One list replaces 3 copies (G-039) |
| `--avatar-fallback` | `#7C5CFF` to `#FF4FA3` | One placeholder on every surface (G-070) |
- Use an accent fill for fills, borders and glows. Use its text variant for text. **[CI]** (G-032)
- Two color families share a hue only when a shape, an icon or a label separates them. (G-036)
- The currency color has a deltaE of 10 or more from every element color. **[CI]** (G-038)

### 4.7 Type
Families: `--font-display` Bricolage Grotesque, `--font-ui` Inter, `--font-num` JetBrains Mono, `--font-flavor` Instrument Serif.

| Token | Size / weight / line-height | Use |
|---|---|---|
| `--fs-display` | 48 / 700 / 1.1, tracking -1 px | Celebrations, big numbers |
| `--fs-title` | 28 / 700 / 1.1 | Screen title |
| `--fs-heading` | 20 / 700 / 1.25 | Panel heading. Flavor text uses this size in `--font-flavor` italic |
| `--fs-stat` | 16 / 600 / 1.25, `--font-num` | Numbers, stats |
| `--fs-body` | 15 / 400 / 1.5 | Body text |
| `--fs-small` | 13 / 400 or 600 / 1.25 | Secondary text, small buttons |
| `--fs-caption` | 12 / 600 / 1.25 | Decision text minimum |
| `--fs-label` | 11 / 600 / 1.1, tracking +1.5 px, uppercase in CSS | Labels, dock labels |
- Use only these 8 sizes. Do not use half pixels. **[CI]** (G-040)
- The minimum text size is 11 px. Decision text (prices, odds, limits) is 12 px or more. **[CI]** (G-040)
- Phone text is never smaller than desktop text. Only the display and title sizes can be smaller on compact classes. (G-040)
- Use the weights 400, 600 and 700. Each style fixes its tracking and a unitless line-height. The wordmark keeps 800. (G-041)
- Load latin, latin-ext, cyrillic and greek subsets. Preload Inter and Bricolage. Use metric-matched fallbacks. (G-042)
- The bot pictures use the same families, including `--font-num` for numbers. (G-042)
- Show flavor text (card lore) in `--font-flavor` on every surface, including the gallery. (G-043)
- A number that changes uses `tabular-nums`. (G-148)

### 4.8 Space
| `--sp-half` | `--sp-1` | `--sp-1-5` | `--sp-2` | `--sp-3` | `--sp-4` | `--sp-5` | `--sp-6` | `--sp-7` |
|---|---|---|---|---|---|---|---|---|
| 2 px | 4 px | 6 px | 8 px | 12 px | 16 px | 24 px | 32 px | 48 px |
- Take all space from this scale. Use `--sp-half` and `--sp-1-5` only inside controls. **[CI]** (G-044)
- Round 10 px to 8 px inside a control and to 12 px between blocks. Round 5, 7, 9 and 14 px to the nearest step. (G-044)

### 4.9 Radius, borders, shadow and item states
| Radius | `--rad-sm` | `--rad-md` | `--rad-lg` | `--rad-sheet` | `--rad-card` | `--rad-pill` | `--rad-round` |
|---|---|---|---|---|---|---|---|
| Value | 6 px | 10 px | 16 px | 22 px | 5% of the card width (14 px at 280 px) | 999 px | 50% |
| Component | Tag, small chip | Button, input, icon button | Panel, tile, dialog | Sheet, dock | Card, on every surface | Chip, pill | Avatar |
- Use one radius for each component type. (G-045)
- Border widths: `--bw-1` 1 px (default), `--bw-2` 2 px (emphasis and rarity), `--bw-focus` 2 px. (G-046)

| Shadow token | Value | Use |
|---|---|---|
| `--elev-1` | `0 8px 24px` black 45% | Panel |
| `--elev-2` | `0 12px 40px` black 55% | Dock, popover |
| `--elev-3` | `0 20px 60px` black 60% | Dialog, sheet |
| `--glow-focus` | `0 0 0 2px` gold | Focus ring |
| `--glow-action` | `0 4px 14px` gold at 35% | Primary action |
| `--glow-rarity` | `0 0 16px` rarity glow | Rare cards |
- Use no other shadow. `--elev-0` (none) is the page. (G-047)

| Item state | Recipe | Required cue (G-048) |
|---|---|---|
| Disabled | 40% opacity | The reason in the label or under the control |
| Locked | `grayscale(1) brightness(.6)` | Lock icon |
| Not owned | `grayscale(.7) brightness(.7)` | "Not owned" in the detail |
| Down | `grayscale(1) brightness(.5)` | "Down" label |

### 4.10 Layers
Exactly 6 named layers. (G-049)

| Token | Value | Holds |
|---|---|---|
| `--z-base` | 0 | Screen content, stages, combat text |
| `--z-shell` | 100 | Top bar, sub-tabs, dock, action rail |
| `--z-sheet` | 200 | Sheets, drop panels, popovers |
| `--z-modal` | 300 | Dialogs, card viewer, full-screen views |
| `--z-toast` | 400 | Toasts, banners |
| `--z-system` | 500 | Loader, tutorial layer, offline banner |
- Use only these 6 values for a global `z-index`. **[CI]** (G-049)
- Inside a component, use local values 1 to 9 in a container with `isolation: isolate`. (G-049)
- An open sheet or modal makes the layers under it inert. (G-049)
- No layer covers a control of a higher layer. The UI check tests this with `elementFromPoint`. **[CI]** (G-049, G-185)

### 4.11 Motion
| Duration | `--dur-instant` | `--dur-fast` | `--dur-base` | `--dur-slow` | `--dur-reveal` | `--dur-celebrate` |
|---|---|---|---|---|---|---|
| Value | 80 ms | 120 ms | 200 ms | 360 ms | 700 ms | 1400 ms |
| Use | Press feedback | Hover, small changes | Screen change, popover | Sheet, dialog | One card reveal | Celebration |

| Easing | `--ease-out` | `--ease-spring` | `--ease-in-out` | `--ease-linear` |
|---|---|---|---|---|
| Value | `cubic-bezier(0.22, 1, 0.36, 1)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `cubic-bezier(0.65, 0, 0.35, 1)` | `linear` |
| Use | Enter | Pop | Move | Loops |
- Use one keyframe set: `kf-rise`, `kf-pop`, `kf-pulse`, `kf-spin`, `kf-shake`, `kf-fade`. (G-050)
- A screen change takes 250 ms or less. A panel or a modal grows from the control that opened it. (G-050)
- Under reduced motion, set the iteration count to 1. Each movement becomes a fade of 200 ms or less. (G-115)
- One JS helper `reducedMotion()` stops shake, gyroscope tilt, idle 3D motion and attack effects. (G-115)

## 5. Components
### 5.1 Component rules
- Put each component in one file or block, with its size-class rules next to the base rule. (G-052)
- Give each selector one definition. Do not add a "round" or a "fix" file. **[CI]** (G-052)
- Build each component from the "Base today" column. The design system frame (UI-00) confirms each base.
- Every interactive component has these states: default, hover (pointer only), pressed (scale 0.97), focus-visible, disabled with a reason, busy. (G-055)

### 5.2 The library
| Component | Variants | Per class | Base today | Replaces | Gaps |
|---|---|---|---|---|---|
| Button | primary, secondary, ghost, danger, boon, prank | md 44 px, sm 32 px. Hit area 44 px on touch | `.v2-btn` | `.link-btn`, `.lockin-btn`, `.enter-btn`, `.sh-go`, `.dg-start`, about 60 feature buttons | G-055, G-056, G-057, G-058 |
| IconButton | sm 32, md 40 | Hit area 44 px on touch. Label required | `#topbar .iconbtn` | `.v2-icon`, `#viewer-close`, `#bossModalClose`, `.sh-x` | G-056, G-109 |
| Icon | One SVG set: UI and 14 elements | 16, 20, 24 px, stroke 2 | `element-icons.js`, dock SVGs | 8 `svg()` helpers, emoji as icons | G-053 |
| Tabs | Level 1 sub-tab strip, level 2 segmented | Strip is always its own row under the top bar (D-37) | `subtabs.js`, `.seg` | `.dg-tabs`, `.dg-seg`, `.lb-tab`, `.sh-nav`, `.sh-tabs` | G-065, G-018 |
| Chip | filter, status, rarity, element, effect kind, count | sm 22, md 28. Hit area 44 on touch | `.f-chip` | About 40 chip classes | G-066 |
| Counter and Dot | count badge (99+ cap), dot | Same | `.dk-badge` | `.cnt`, `.navbadge`, `.nt-dot`, `.tab-dot` | G-066, G-093 |
| Card | full, tile, squad, thumb, mini, slot, back, locked | Section 8.1 | `.v2-cell` | About 28 card renderers | G-099 |
| Card Grid | One fitter with a minimum per card size, pager, swipe | At least 2 rows | Collection `fitGrid` | 7 grid fitters | G-099, G-022 |
| Flip Card and Reveal | single, multi, chest | Same | Multi reveal `.mr-card` | `.fc`, `.dg-flip` | G-101 |
| Card Detail | Fixed sections, one Ascend control. Each context shows a named subset. Opens only on a tap (D-38) | A window: centered dialog on medium and expanded, full sheet on compact | Collection card panel | 4 viewer modes, `phoneColumns`, `fillRaidInfo`, `fillSquadInfo`, the second Ascend control | G-100 |
| Panel and Tile | panel, tile, stat box. One header, one section label | Same | `.v2-panel`, `.v2-tile` | `.dg-panel`, `.sh-panel`, `.pbox`, 10 headers | G-052 |
| Dialog | confirm, alert, info | Centered. Full width minus 16 px on compact-port | Shop confirm `.sh-modal` | `.sq-warn`, `.dg-modal`, `.hl-modal`, `.eff-confirm`, `#bossModal`, two-tap arm | G-059, G-112 |
| Sheet | bottom, side | Bottom on compact-port. Side on compact-land and medium. Right panel on expanded | `.hl-sheet` | `.v2-drop` x4, `.wl-picker`, `.v2-chooser`, `#colPanel.m-open` | G-061 |
| Full-screen view | profile, multi reveal | All classes | `.v2-screen` | `#stage.v2-multi` | G-060 |
| Toast | info, success, error, undo | Stacks inside the safe frame | `.v2-toast` | `.v2-toast.act`, `.open-note` | G-089 |
| Banner | incoming effect, offline, flags | Top of the content | `.eff-banner` | `.eff-test` | G-089, G-092 |
| Inline message | success, error, info, with an icon | Same | `.tr-msg` with state colors | `.sh-err`, `.rp-err`, `.gift-msg.err` | G-089 |
| Info popover | Opens on tap, hover and focus | Same | New | About 35 `title` attributes with unique facts | G-105 |
| Row and List | row, row with action, overflow rule | Pages or "+N more" | Leaderboard `.lb-row` | About 30 row patterns, `fitChildren` | G-022 |
| Leaderboard | podium, table, rank row, Top 3 | Same | Leaderboard view | 8 renderings | G-069, G-075 |
| Search Field | icon, clear, 150 ms debounce | 16 px text on touch | `.v2-search` | `.ginput`, 8 placeholders | G-062, G-107 |
| Member Picker | chip row, Find, suggestions | Same | `#trMembers` with `.sg-list` | `#effectPick` list | G-062 |
| Select, Stepper, Switch, Textarea, Selected mark | one each. The Stepper shows its limits | Same | `.v2-select`, `.sh-step`, `.ps-sw`, `.rp-text`, squad `.picked` | Hall `−/＋`, `.pts-add`, plain `select`, `.sel`, `.hl-check`, `.in-spot` | G-063, G-064 |
| Pager | "1 / 3" label, labelled arrows (44 px on touch classes, D-53), 40 px swipe, arrow keys. Always centered under its grid (D-36) | Same | Collection pager | 5 pagers | G-067, G-106 |
| Progress | linear, segmented, HP (card, boss, squad) | Heights 4, 8, 12 px | Hunt boss HP bar | About 22 bars | G-068 |
| Countdown | live, static | Same | `cdSpan` | `.sh-left`, `.dg-left`, `.hl-left`, `.dl-reset` | G-146 |
| Avatar | xs 20, sm 28, md 38, lg 56, xl 96. Frame, live ring | Same | `avatarHTML` | About 14 overrides | G-070 |
| State views | Empty, Loading, Error | Same | `.v2-empty`, `.v2-loading` | `.empty`, `.dg-none`, `.dg-closed`, `.sh-closed`, `.loading` | G-083, G-084, G-085 |
| Combat Text | damage, crit, miss, status words | Never on card art | Hunt `calloutAt` | `bigDamage`, `.dg-pop` | G-102 |
| Dock | 5 fixed places, one badge rule | Section 3.1 | `#dock` | Runtime label changes | G-072 |
| Top Bar | Fixed slots, one control type, no sound control (D-26) | Section 6.4 | `#topbar` (design 29) | `#mute` | G-082, G-118 |
| Help | One entry, explainer carousel, FAQ, tutorial step | Same | `ui-v2-explain.js` carousel | Second "?" control | G-152, G-153 |
| Small live view | boss HP, pack count, Open full | `tiny` only | New | n/a | G-012 |

### 5.3 Component behavior rules
- Show one primary button per view at most. Row actions use the secondary or the chip style. (G-057)
- Every destructive action uses the danger variant. (G-058)
- A Dialog has a title, one line, Cancel on the left and the primary action on the right. (G-059)
- Every icon-only control has an `aria-label` that names the action. **[CI]** (G-109)
- A clickable avatar is a button. (G-070)
- Each dot color has one meaning. Red means "an action waits for you". (G-066)
- Every count badge caps at 99+. A list with more items than it shows has a "Show more" control. (G-093)
- Each component has a rule for every class. No component relies on a desktop-only rule. (G-019)

## 6. Navigation, windows and deep links
### 6.1 Places
- The dock has 5 fixed places: Home, Collection, OPEN, Adventure, Community. (G-072)
- Set the dock labels in one place. They never change at runtime. A dock button always opens the same place. (G-072)
- Adventure opens its last tab. The badge shows on the tab with news, and the dock badge names that tab (D-22). (G-072)
- Sub-tabs show no counts (for example no "37/50" on Achievements, no "12" on Bosses). A tab shows the Dot only when an action waits there, for example an achievement to claim. The Dot takes the place where the count was (D-27). (G-066)
- The Leaderboard and the Shop are views that open from the top bar, each with a back control (D-12). (G-073)
- One Leaderboard has one tab for each board. A mode screen shows a Top 3 that links to it (D-12). (G-075)
- Hide a future mode until it exists. Do not show a "SOON" tab (D-13). (G-081)
- Each entry point has its own visibility rule, tied to its own feature flag. (G-074)

### 6.2 One window system
Three window types, with one rule for each. (G-060, G-073)

| Type | Examples | How to leave |
|---|---|---|
| View | Home, Collection, Shop, Leaderboard | Dock, tab or the back control |
| Sub-view | A composer, an auction, a board | Back control, top left: icon and parent name ("← Auctions") |
| Window | Dialog, sheet, drop panel, card viewer | ✕ at top right (44 px), backdrop, Escape, Back gesture |
- Use one back form and one close form (D-12). (G-073)
- Escape, ✕ and the backdrop close every window except a blocking confirm. **[CI]** (G-060)
- A window that must not close (a reveal, a running purchase) states why. (G-060)
- Focus moves into a window, stays in it and returns to the opener on close. (G-060)
- A tap outside a non-modal panel only closes the panel. It does not press the control under it. (G-111)
- Use at most 2 tab levels. A deeper level becomes a sub-view. (G-065)

### 6.3 History and the Back gesture
- Each window and each sub-view adds one history entry. A view change replaces the entry. (G-076)
- The Android Back gesture and the browser back action close the top window or sub-view. (G-076)

### 6.4 Top bar and the menu
- The top bar has these controls, in this order, on every class except `tiny`: the logo, the Shards count, Shop, then the bell, Menu and the avatar at the right end. Each control is a `<button>` with an `aria-label`. (D-31, G-082)
- The pack count shows only on the OPEN button. The top bar has no packs slot. With 0 packs, OPEN is greyed out and shows no badge, as today. (D-23)
- Top-bar icons have no visible text label. Each icon keeps one meaning on every class. Its name is in `aria-label`. (D-24, G-082)
- Menu opens a grid of places, each an icon with its name: Dailies, Leaderboard, FAQ, Feedback, Settings and Events. A new place gets a tile. It never gets a top-bar icon. (D-31)
- The grid is a bottom sheet on `compact-port` and `compact-land`, and a panel under the Menu button on `medium` and `expanded`. The items and their order are the same on every class. (D-31, P1)
- A tile that has news (for example a daily to claim) shows the Dot. Then the Menu button also shows the Dot. (D-31, G-066)
- Every top-bar control has a 44 px touch target on touch classes. (G-104)
### 6.5 One home for each action
- Each action has one home and one flow. Other doors open that home with the object chosen. (G-077)
- A contextual action always carries its object to the target screen. (G-078)
- One tap target has one action. One result has one outcome text. (G-080, G-077)
- An offer row (Trades, Trade Hall, bell) shows the member, the status, the GIVE and GET cards as Card/thumb (64 px minimum) and its action. A tap on the row opens the Offer view: both cards as Card/full side by side, the member, the status, the time and the actions. A tap on a card there opens its Card Detail. (D-30, G-099)
- The list of open trades is named Pending, with Incoming and Sent sections. On `compact-port` and `compact-land`, a Pending button sits next to the Offer / Gift switch and opens Pending as a full-height sheet. The button shows the Dot when an incoming offer waits. On `medium` and `expanded`, Pending is the side panel. (D-32, 3.4)

### 6.5 pickers: one Card picker, one Member picker (D-42, D-43)
- Every "choose a card" task uses the Card picker window: a small Collection with the toolbar (search, Filters), the pager under the grid, the magnifier for the Card Detail and Confirm. It has two modes: **pick one**, and **pick several**, numbered, with the slot row (6.5a). (D-42)
- The Card picker serves: squads (Hunt, Dungeon, Gauntlet), both views of the Trade window, listing a card and bidding in the Trade Hall, the wishlist, the profile Spotlight, and choosing a boon or prank card. Each task opens it with its own filter and its own rule checks. (D-42)
- Every "choose a member" task uses the Member picker: search, and recent and frequent members. Trades, Gift, Boons & pranks and opening a profile start with it. (D-43)
- Boons & pranks: pick the member, then the Card picker opens with only effect cards, in pick-one mode, then the member confirms the play. (D-43)
- One Leaderboard window with tabs: Main, Hunt, Dungeon and Gauntlet. "Today's top 3", "Top hunters" and "See the leaderboard" open it on their tab. Menu → Leaderboard opens it on Main. (D-44, D-12)

### 6.5a Squads (D-40)
The Hunt, the Dungeon, the Gauntlet and later modes pick a squad the same way.
- The mode's main view shows the squad slots (5 for the Dungeon, 8 for the Hunt) and no card grid. With no squad, it shows **Select your squad**. With a squad, it shows the cards in their slots, the Start action (**Start run**, **Start raid**) and **Edit**. The main view is read-only.
- In the Hunt, the boss stage fills the content area like the Home Hunt slide (UI-04): the whole boss, name, Tier chip, HP bar, countdown and the Top 3 board (D-58). The squad (8 slots, Squad Power, the main button) is one strip at the bottom of the content area, above the dock. (D-61)
- The Hunt fight screen shows no Top hunter line, no Top 3 board and no countdown; the freed space goes to the boss stage. Squad select and resting keep them. (D-65)
- **Select your squad** and **Edit** open the Squad picker window: the full card grid with the toolbar (search, Filters, D-39), **Auto-pick**, and the pager under the grid (D-36).
- A slot row at the top of the picker shows the chosen cards in pick order, each with an × to remove it.
- A tap on a card in the grid selects it and shows its number (1, 2, 3 …). A tap on a numbered card removes it. When a card is removed, the cards after it move up one number.
- The magnifier on each card opens its Card Detail. A tap anywhere else on the card selects it.
- A status bar shows the live checks, for example "3 / 5 cards · 9 / 12 points · an attacker · today's rule". Cards that break a rule are greyed out. **Confirm** works when the squad is valid. A short Hunt squad shows the short-squad warning at Confirm, as today.
- After the first Hunt fight of the day, **Edit** shows locked, with the reason "Squad locked until tomorrow".

### 6.5b Trades (D-35)
A trade is always 1 card for 1 card. Auctions in the Trade Hall have their own flow.
- The Trades tab opens the member picker: search, recent and frequent trade partners, and the Pending button (D-32).
- A tap on a member opens the Trade window. Its header shows you and the member, with avatars and names.
- The Trade window has two views, each a small Collection with a larger grid, search, filters and the pager:
  - **Your cards** (offering). A selected card has two actions: **Offer** and **Gift**.
  - **Their cards** (requesting). A selected card has one action: **Request**.
- Pick one card in one view, or one in each view. The result:
  - Your card only = an **offer**. The member picks one of their cards in return. You accept or reject it.
  - Their card only = a **request**. The member picks one of your cards in return. You accept or reject it.
  - One card in each view = a **full proposal**. The member accepts or declines it.
- Gift sends your card with nothing in return, as today. It replaces the Offer / Gift switch.
- The request is new game logic. It needs a server and database change with tests before the build (outside the UI freeze).

### 6.6 Deep links from bot posts and notifications
- Every bot post and every notification carries a target: view, tab and object id. (G-071, G-079)
- Write a target as `view[/tab][/id]`, for example `community/hall/auction/123`. The Activity opens it after login. (G-071)
- Every notification kind has a label, a button and a target. **[CI]** (G-079)
- Verify how a launch button passes a target into the Activity before the build. Record the method here. (G-071)
- If the SDK cannot pass it, the server stores the target at the button press. The Activity reads it after login. (G-071)

## 7. States
Every view has 4 separate states: loading, empty, error and data. (G-083)

### 7.1 Requests and writes
- Use one request helper for every call. It throws on `!r.ok` and on a body with `error`. (G-083)
- `api()` never shows an error as an empty or a "closed" state. (G-083)
- Show "closed" only when the server answer says closed, with the reason and the reopen time. (G-083, G-085)
- Never cache an error, or an empty result from a failed call. (G-091)
- Every write uses one `runAction` helper. It disables the control and shows a pending label until the answer. **[CI]** (G-086)
- A background repaint never replaces a control in the pending state. (G-087)
- Show success only after a confirmed `ok` answer. (G-088)

### 7.2 One pattern for each state
| State | Pattern | Gaps |
|---|---|---|
| Loading | After 300 ms, a pending state in the control. After 1 s, a skeleton in the target area | G-084 |
| Stale data | Mark data older than its poll interval. Never paint stale data as current | G-084 |
| Empty | Title, one line, one action. A first-use empty differs from a no-result empty | G-085 |
| Error | Title, the player sentence (section 10.6), Try again | G-083, G-145 |
| Offline | A banner on the `offline` event. On `online`, the banner goes and the view reloads | G-164 |
| Rate limited | Wait for `Retry-After` (default 5 s) and try again one time. A write shows a wait message | G-166 |
| Session ended | Authenticate again one time. Then show "Your session ended" with Reload | G-165 |
| Flags failed | Keep the last known flags. Show a banner. Try again in the background | G-092 |
| Double tap | From the tap until the answer, the control is disabled and shows a pending label | G-086 |
| Success | Only after a confirmed `ok` answer | G-088 |

### 7.3 Feedback channels
| Message class | Channel (G-089) |
|---|---|
| Blocking error | Dialog |
| Soft error | Inline message or toast, in the danger color |
| Success | Inline message or toast, in the success color |
| Info | Toast or banner |
- Toasts stack. Each toast shows for 4 s or more, in a `role="status"` region. (G-089)
- An error never uses the success color. A success never uses the error color. (G-089, G-195)

### 7.4 Destructive actions (D-10)
Each destructive action has a confirm or an undo. Add each new destructive action to this table before the build. (G-090)

| Action | Protection |
|---|---|
| Reset stat points (uses the weekly free reset) | Confirm |
| Close an auction early | Confirm |
| A purchase | Confirm, with the balance after the purchase |
| Decline an offer, cancel an offer | Undo toast, 8 s |
| Unlist from the Trade Hall | Undo toast, 8 s |
| Withdraw a bid | Undo toast, 8 s |

## 8. Cards, images and 3D
### 8.1 Card sizes
Use a fixed set of card sizes. Each size has one minimum width. (G-099)

| Size | Use | Minimum width † | Shows |
|---|---|---|---|
| full | Card viewer, reveal | 240 px | Art, name, rarity |
| tile | Card grids | 88 px | The card face only (D-29). Exception: `compact-land` Collection uses 55 x 77 px tiles so that 2 rows fit (D-60) |
| squad | Hunt and Dungeon squads | 80 px | The card face only (D-29). In a fight, also its live state |
| thumb | Pickers, offers | 64 px | The card face only (D-29) |
| mini | Lists, feed rows | 44 px | Art |
| slot | An empty place for a card | Same as its context | Outline, label |
- The card ratio is 5:7 and the radius is `--rad-card` on every surface. (G-099, G-045)
- The card face does not show tags. Tags, ability, effect and stats show in the Card Detail.
- Every card view (grids, squads, trades, pickers, profile, shop) shows only the card face. There is no caption: no name line, rarity letter, element, power, ability or copies. A tap on a card opens the Card Detail, which shows all of it. (D-29)
- A card shows its live state on the face, because it changes while the member plays: HP, Down and status effects in a fight, Not owned, Locked, selected, and the number that limits the current choice (for example the point cost while a member builds a Dungeon squad). (D-29)
- Use one Card Detail with fixed sections. Each context shows a named subset. (G-100)
- The Card Detail is never open by default. It opens only when the member taps a card, as a window: a centered dialog on `medium` and `expanded`, a full sheet on `compact-port` and `compact-land`. No screen keeps a card panel beside the grid, so the grid uses the full width. (D-38)
- The content area ends above the dock on every class. Nothing in a screen sits under the dock. **[CI]** (G-020, G-196)
- Every card grid (Collection, both views of the Trade window, the Trade Hall) has one toolbar above the grid: the search box, always visible, and a **Filters** button beside it, in the same place on every class. Typing in the search box filters at once. (D-39)
- The Filters button shows the number of active filters, for example "Filters (2)". A tap opens the Filters panel on top of the view. It holds every other filter: the All / Owned / Missing / Can ascend switch, rarity, type, element, game and sort. **Confirm** applies the choices and closes the panel. **Clear all** resets them. (D-39)
- "Can ascend" shows only the cards that can ascend now, with their count. The Cards tab shows the Dot when any card can ascend. A tap on that tab, while the Dot shows, opens Collection with "Can ascend" already on. (D-33)
- Use one Flip Card. Every reveal offers Reveal all and uses the same close rule. (G-101)

### 8.2 Images
| Tier | Size | Budget | Where |
|---|---|---|---|
| grid | 480 px | 48 KB or less | Grids, feeds |
| reveal | 480 px or more | 150 KB or less | Pack reveal |
| panel | 640 px | 150 KB or less | Card Detail window |
| still | as needed | 200 KB or less | Pack still, backgrounds |
| full | original | n/a | The zoom viewer only |
- Use the tier that matches the display size. (G-103)
- Lazy-load every image outside the first view. Grids reserve the 5:7 ratio. (G-161)
- A card image that is the only identifier has alt text: the name and the rarity. (G-097)

### 8.3 Logo (D-04)
- The lion is the master logo on every surface. The crown in the design PNGs is superseded. (G-054)
- Use fixed lockups and minimum sizes, and provide a favicon, an app icon and an Open Graph image. (G-054)
- The loader uses the lion logo, not the 🦁 emoji. (G-054, G-027)

### 8.4 3D (D-19) and combat text (D-20)
- Show live 3D on every class. Load the 3D code only when a 3D view is on screen. (G-158)
- On compact classes, use a device pixel ratio of 1 to 1.5 and no shadow map. (G-009)
- Damage numbers are big and clear. They never cover card art. (G-102)
- Use one Combat Text table and one position rule for all modes. One word for each result: "CRIT", "MISS". (G-102)

## 9. Input and accessibility
### 9.1 Touch and pointer
- Every touch target has a 44x44 px hit area and 8 px between hit areas on `pointer: coarse`. **[CI]** (G-104)
- Hover effects exist only under `(hover: hover) and (pointer: fine)`. **[CI]** (G-008)
- Each gesture has a visible single-tap alternative on the same screen. (G-106)
- Set `touch-action: manipulation` on `body`. Keep pinch zoom. Text inputs use 16 px or more on touch. (G-107)

### 9.2 No hover-only information
No information lives only in `title` or on hover. Give each such fact a label, or an Info popover. **[CI]** (G-105)

### 9.3 Keyboard and semantics
- Every action is a `<button>` or an `<a>`. Do not use a clickable `<div>`. **[CI]** (G-108)
- A grid supports the arrow keys, Enter and Space. (G-108)
- Use one global `:focus-visible` ring: 2 px, 3:1 or more, 2 px offset. Never remove an outline without a replacement. **[CI]** (G-110)
- Each modal has `role="dialog"`, `aria-modal="true"` and `aria-labelledby`. (G-112)
- The dock uses `aria-current="page"`. Tabs use `aria-selected`. Toggles use `aria-pressed`. (G-113)
- Each screen has one `h1` (it can be visually hidden). Panels use `h2`. Sections use `h3`. Keep `lang="en"`. (G-114)
- Every form control has a visible label or an `aria-label`. (G-109)

### 9.4 Contrast thresholds
CI checks every token pair against these thresholds. **[CI]** (G-029, G-030, G-031)

| Item | Minimum |
|---|---|
| Body text | 4.5:1 on its surface |
| Large text (18 px, or 14 px bold) | 3:1 |
| Control edges, focus ring, meaningful icons | 3:1 against the neighbor color |
| Badge text on its fill | 4.5:1 |

### 9.5 Flashing, effects and sound
- No content flashes more than 3 times in any 1 s. Do not use a full-screen flash. Measure each new effect. (G-116)
- A "Reduce effects" setting changes a screen prank to a banner. Reduced motion enables it by default (D-11). (G-117)
- The shell has no sound control. Members set the volume with the device or Discord. (D-26, G-118)
- Keep audio quiet by default: no autoplay music outside a fight or a run, and no sound while the tab is hidden. (G-118, G-160)

## 10. Words
### 10.1 Glossary (D-05)
Use one term for each concept in UI strings, help, the tutorial, notifications, bot posts, SQL texts and docs.
(G-119, G-120, G-121, G-122, G-123, G-124, G-125, G-126, G-127, G-128, G-129, G-132, G-134, G-136)

| Concept | Term | Do not use |
|---|---|---|
| The weekly shared boss mode | the Hunt | Raid, Pride Hunt, Battling, Raid Boss |
| Its enemy | boss | Raid Boss, Titan |
| The dock place for the modes | Adventure | Hunt (as a tab name) |
| The daily run mode | the Dungeon. An enemy is a monster. The last room is the guardian | — |
| The weekly fixed-squad mode | the Gauntlet | — |
| Take a reward that waits | Claim | Redeem |
| A card release | Set ("Season 1" is the set name) | Season (as the concept) |
| Boss difficulty | Tier 1, Tier 2, Tier 3 | Normal, Heroic, Mythic |
| Effect card kinds | boon, prank, shield | neutral, ward, decoy (as kind names) |
| Achievement title reward | The achievement name | Another form of the name |
| The 5 rarities (reserved words) | Normal, Illustrated Rare, Secret Rare, Full Art, Gold. Special: Event, Promo | A rarity word for another system |
| A card owned more than once | copy. The ones after the first are extra copies | duplicate, dupe, spare |
| Card strength | Power | CP on a card |
| Sum of a squad | Squad Power | TEAM CP |
| Sum of a collection | Collection Power | Power (alone) |
| The effect number | strength | Power |
| Star up a card | Ascend. The level is stars (★1 to ★5) | Gold, Bronze for a tier |
| The marketplace | Trade Hall. A card in it is a listing | Hall, Trading Hall |
| Swap with a member | trade. The request is an offer | swap |
| Cards a member wants | wishlist. The starred one is the top want | Wanted (as an object) |
| A squad card that attacks | attacker (Character or Creature) | — |
| A squad card that helps | support (every other card type) | The `class: support` tag in copy |
| A card at 0 HP | down | downed, fell, knocked out |
| Daily tasks | Dailies. One is a daily | quest, mission |
| A ranked list | Leaderboard | Standings, Top hunters |
| Open trades that wait for an answer | Pending. Its sections are Incoming and Sent | Offers (as the list name) |
| A person in the game | member | player, hunter, user |
| The game day | day (MT). It starts at midnight MT | UTC day |
| Voice-room pull filter | Voice | Den (reserved for The Den) |
- Code and copy use one definition of attacker and support. (G-130)
- Each tag value has one label, from one table. (G-131)
- Use full stat names, or one abbreviation set that does not collide with boss stats. (G-135)
- Content names use real card types and no rarity words. Use one pattern: "Fire Slime (Elite)". (G-138)
- Rename the "Den" pulls tab to "Voice" before The Den ships. (G-133)
- No player text names a command that does not exist. CI searches for removed command names. **[CI]** (G-137)

### 10.2 Case, punctuation and STE
- Use sentence case for titles, buttons, tabs and chips. Proper names keep capitals: the Hunt, Trade Hall, Shards. (G-140)
- Write ALL CAPS only through the label style in CSS, never in the string. (G-140)
- Use "·" as the one separator. Do not use em dashes, "(s)" plurals or semicolons. (G-141)
- Use one exclamation mark at most, and only in celebration text. (G-141)
- Write instructions, errors and help in ASD-STE100 style: 20 words or fewer, active voice. Flavor text is exempt. (G-142)

### 10.3 No explainer subtitles
- Do not add a helper sentence that explains how something works. Teaching text goes to help. (G-139)
- Show only titles, labels, numbers and the facts that a member needs to decide. (G-139)
- Decision facts stay on screen: odds, prices, deadlines and limits (D-09). (G-139)

Test: "Does the member need this fact to decide now?" If yes, show it. If no, move it to help.

| Text | Result |
|---|---|
| "Once per floor" | Keep. It is a limit |
| "Ends Sat 5:00 PM EDT" | Keep. It is a deadline |
| "The Gauntlet has no loot. Only the depth counts." | Move to help |
| "Tap a card to list it." | Move to help |

### 10.4 Names and truncation (D-08, corrected)
- Names are never cut with "…". A name wraps to 2 lines, or it shrinks to 11 px. (G-005)
- Use "…" only where a 32-character name cannot fit at 11 px on 2 lines. **[CI]** (G-005, G-168)
- Nathan approves each such place, and the table below records it. (G-005)
- Notification bodies in the bell list, offer notes and feed lines can truncate. Each shows the full text on tap. (G-005)

| Place where "…" is permitted for a name | Approved by Nathan (date) |
|---|---|
| None yet | — |

### 10.5 Numbers, time and plurals
- Use one number module: full ("12,345") and compact ("12.3k"), with the `en-US` locale. (G-148)
- On compact classes, numbers of 10,000 or more use the compact form. (G-168)
- Write a multiplier as "×1.5". Docs take each value from the code. (G-149)
- Use one time module: countdown, duration, ago and date. A countdown shows the two largest units: "2d 4h". (G-146)
- Show a time in local time with a zone label: "Sat 5:00 PM EDT" (D-15). (G-147)
- The game day uses MT, with a label: "Resets at midnight MT" (D-15). (G-147)
- Use one plural helper: "1 card", "2 cards". Use one format for each kind of count: "Floor 4 · Room 2". (G-150, G-151)

### 10.6 Error text
- Each condition has one error code, in `snake_case`. (G-144)
- Every code maps to one player sentence with a next step. Never show a raw code or raw database text. (G-145)
- Keep all texts in one string table. One state has one text. (G-143)

| Condition | Player text |
|---|---|
| Timeout | "This took too long. Try again." |
| Offline | "You are offline. The game reconnects when your network returns." |
| Rate limited | "Too many actions. Wait a few seconds, then try again." |
| Session ended | "Your session ended. Reload to continue." |
| Feature off | "This is not open now." |
| Unknown | "Something went wrong. Try again." |

### 10.7 Help (D-09)
- Each view has one help entry: its "?" button. It opens the help for the current view first. General help is FAQ in the Menu (D-31). (G-153)
- On `compact-land`, `medium` and `expanded`, the "?" sits at the right end of the sub-tab row, in the same row as the tabs. On `compact-port` the row has no room for it (Nathan, D-63); its place there is open. (D-63)
- Every view has help in this one model. Each rule has one help text. (G-152)
- Help numbers come from the server settings, or a check fails when they differ. **[CI]** (G-155)
- Tutorial steps use glossary names, and point at controls that do what the step says. (G-154)
- Make the explainer images again, or check them, when a screen changes. (G-156)

## 11. Performance budget and robustness
### 11.1 Budgets
CI fails a PR that passes a budget. **[CI]**

| Item | Budget | Gaps |
|---|---|---|
| Boot JS | 170 KB gzip or less | G-158 |
| Boot CSS | 60 KB gzip or less, one hashed file, immutable cache | G-157 |
| 3D code | Loads only when a 3D view is on screen | G-158 |
| 3D model | 500 KB or less, versioned URL, long cache | G-159 |
| Images | Section 8.2 | G-103 |
| Audio before the first fight | 1 MB or less | G-160 |
| Requests on one screen | 10 per minute or fewer | G-162 |

### 11.2 Audio, live data and polling
- Load each sound only when it first plays. Stream music. Pause all audio when the tab is hidden. (G-160)
- Live data uses SSE or WebSocket. A poll runs every 15 s or slower, and stops while the window is hidden. (G-162)

### 11.3 Timeouts, sessions and reconnect
- Reads time out at 10 s and writes at 15 s. Then the error state shows with Try again. (G-163)
- The loader shows Try again after 15 s. (G-164)
- One handler takes a 401: authenticate again one time, then show "Your session ended". (G-165)
- Throttling uses status 429, never 401. (G-166)
- Reconnect SSE and WebSocket with a backoff from 1 s to 30 s, with jitter. (G-167)
- Reload the screen data after a reconnect. Show "Reconnecting…" after 5 s. (G-167)

### 11.4 Robustness tests
- Test each list with a 32-character name and a 9-digit number. **[CI]** (G-168)
- Test each view with a forced 401, 429 and 500, a stalled request, and offline. (G-083, G-163, G-165)

## 12. Process and gates
### 12.1 Where things live
| Item | Place |
|---|---|
| This standard | `docs/design.md` on `main` |
| The screen register | `docs/ui-register.md` on `main` |
| Token source | One file on `main` (section 4.1) |
| UI check script | This repository, run by CI |
| Design files: `.pen`, PNG exports, review rounds, prompts | The private repository `lion-pride-tcg-design` |
| Build evidence | CI artifacts for each PR |

**The design repository.** (G-169, G-178, G-179, D-21)
- Keep design binary files off `main`. This repository is public, the files hold member data, and they are large (615 MB).
- Nathan creates the private repository `lion-pride-tcg-design` after he approves this file.
- Until then, the files stay on the branch `docs/design-md`. Do not move them before the new repository exists.
- Use one folder for each register ID: `<ID>/source/*.pen`, `<ID>/approved/<size>-<screen>.png`, `<ID>/review-<k>/notes.md`, `<ID>/prompt.md`.
- The approved artifact is the named PNG set for each size, next to the `.pen` file. (G-179)
- Store the prompt and the rule list with each design. Store each review list in its `review-<k>` folder. (G-189, G-176)
- Keep build evidence out of the design folders. (G-178)

### 12.2 The register
- `docs/ui-register.md` has one row for each screen, window and view. (G-171)
- Reserve the register ID before work starts. Every design file, PR and commit uses it. (G-170)
- The session that gets an approval records it in the register in the same turn. (G-171)
- A spec approval and a screen design approval are separate statuses. (G-173)
- Docs that describe the UI state link to the register. They do not copy it. (G-192)

### 12.3 Steps for each new or changed screen
1. Open a GitHub issue with the label `ui`. Reserve the register ID. Status: **Requested**. (G-188)
2. Design in pen.dev at the test sizes, from a screenshot of the current screen. Use this file. Status: **In review**. (G-172)
3. Export the named PNG set to `<ID>/review-<k>/` in the design repository. Show it to Nathan.
4. Record the approval (section 12.4). Status: **Approved**.
5. Build on a branch from the latest `origin/main`, in a new worktree. Put the register ID in the PR title. (G-186)
6. CI runs the gates (section 12.5).
7. Add an approved-vs-built image for each screen and size to the PR. List each deviation. (G-175)
8. Nathan accepts the build (preview, or live behind the flag). Status: **Built**, with the PR number.
9. After a later review round, update the design or record the deviation. (G-175)

### 12.4 Approval record format
Write each approval in the register row and in `<ID>/approval.md` in the design repository. (G-171, G-173)

```
Approved: <ID> · <kind: design | spec | build> · Nathan · <YYYY-MM-DD>
Words: "<Nathan's exact words>"
Set: <design repository commit> <ID>/approved/ (<list of PNG names>)
Where: <PR link, or "chat, recorded by <session> in the same turn">
```

An approval counts only when its PNG set is in the design repository (D-21). (G-169)

### 12.5 Gates
| Gate | Mechanism | Fails when | Gaps |
|---|---|---|---|
| G1 Register | CI reads the register ID from the PR title | No ID, or the status is not Approved | G-174 |
| G2 Design record | CI reads the register row | No approval record with a design commit | G-169, G-171 |
| G3 UI check | Playwright script in this repository, 15 test sizes, Chromium and WebKit | Any item in section 12.6 | G-185 |
| G4 Literal counter | CI counts hex colors, px values, `z-index`, `m-land`, `m-port` against the `main` baseline | Any count rises | G-182 |
| G5 Member data | `check-no-member-data.mjs` | A real member name in a PNG or in text | G-176 |
| G6 Budgets | CI measures the build | A budget in section 11.1 fails | G-157, G-158 |
| G7 Branch protection | GitHub requires G1 to G6 on `main` | A direct push, or a red check | G-183 |
| G8 Deploy | `ops/deploy.sh` refuses a commit without green CI | CI is not green | G-183 |
- The UI check is a required gate. It runs every screen and every overlay. (G-185)
- The literal counter states its scope: the files and the units that it counts. (G-182)
- **Merge rule (D-17).** A UI PR merges only after a recorded approval from Nathan. No waiting time applies. (G-184)

### 12.6 The automatic UI check
The check opens every screen and every overlay at each test size. It also runs with a 32-character name, a 9-digit number, the keyboard open and the safe-area presets. It fails on each item below. (G-185, G-168, G-015)

| Check | Rule |
|---|---|
| Page scroll | 3.3 |
| Bleed, clipped text, cut buttons | 3.3 |
| "…" on a name outside the approved places | 10.4 |
| Text below 11 px | 4.7 |
| Touch target below 44 px on touch | 9.1 |
| An element covered by another layer (`elementFromPoint`) | 4.10 |
| A control in a Discord corner zone, or a window outside the safe frame | 2.3 |
| A function present on expanded and missing on another class | 1 (P1) |
| Overlapping sections | 3.3 |
| Empty space above 25% of the content area | 3.4 |
| Icon-only control without a name | 5.3 |
| Contrast below the thresholds | 9.4 |

### 12.7 Workflow rules
- One session owns each UI file during a change. Push every branch with work. Remove a merged worktree. (G-186)
- Each session pulls the primary checkout to `origin/main` at the start. (G-187)
- Each worktree uses its own preview port, recorded in the session notes. (G-190)
- UI rules live only in this file. Memory notes point to it. (G-191)
- Nathan approves the design system (UI-00), and it becomes the token file before any screen work. (G-177)

### 12.8 Order of the retroactive designs (D-16)
Every screen in the register gets an approved design (Nathan decision 4). Work in this order. (G-172)

1. UI-00 design system (tokens and components).
2. The shell: UI-01 top bar and dock, UI-02 sub-tabs, UI-59 small live view.
3. UI-09 card viewer, then UI-34 pack reveal, then UI-56 loader.
4. UI-49 Dungeon v2 screens, then UI-52 Gauntlet.
5. All other rows, by member traffic.

### 12.9 Freeze exit criteria
The freeze in `CLAUDE.md` lifts when all of these are true:

1. Nathan approves this file. The status line says "Approved", with the date.
2. The register is on `main`, and the private design repository exists.
3. Nathan approves the design system (UI-00). The token source file is on `main`.
4. Gates G1, G3 and G4 run in CI and are required on `main`.

After the freeze lifts, each screen follows section 12.3. An unchanged screen stays "Not migrated" in the register until its own PR.

**Lifted on 2026-10-06.** All four criteria are met (the token source file `shared/tokens.json` has been on `main` since 2026-10-05). Nathan confirmed: "Yes".

### 12.10 One-off defects
Fix these in the first build after the freeze. No new rule applies. (G-193)
- A dead line inside a comment in `ui-v2-hall.js`.
- The launch-gift cleanup pattern misses the real text in `gift_claims.sql`.

## Appendix A. Decisions D-01 to D-22
Nathan accepted all 22 decisions as recommended on 2026-10-04. D-08 and D-21 have corrections.

| ID | Decision | The choice made |
|---|---|---|
| D-01 | Rarity names and top tier | Normal, Illustrated Rare, Secret Rare, Full Art, Gold, with Gold on top. The PNG names are superseded |
| D-02 | Gold rarity color | The brand gold `#F4B73C`, with a text label on every rarity mark. `#F7BE35` goes |
| D-03 | Boon color | Teal `#3DD9B4` |
| D-04 | Master logo | The lion |
| D-05 | Glossary | "the Hunt", "Adventure", "Claim", "Set", "Tier 1-3", "shield", title = achievement name (section 10.1) |
| D-06 | Small live view | Boss HP, pack count and one "Open full" action |
| D-07 | Scroll exceptions | A named list, each with a visible scroll cue (section 3.3) |
| D-08 | Names | Corrected: never cut with "…". Names wrap or shrink. "…" only where a name cannot fit at the minimum size, and each such place is recorded |
| D-09 | Help model | One "?" entry with context. Decision facts stay on screen |
| D-10 | Destructive actions | Confirm for limited resources. Undo toast for decline, cancel, unlist and withdraw (section 7.4) |
| D-11 | Prank opt-out | A "Reduce effects" setting, on by default under reduced motion |
| D-12 | Leaderboard and Shop | Views opened from the top bar, with a back control. One Leaderboard with a tab for each board |
| D-13 | "SOON" tabs | Hide future modes until they exist |
| D-14 | Home hero when the Hunt rests | The next active mode now. A rotation of the active modes later |
| D-15 | Time zone | Local time with a zone label. The game day in MT |
| D-16 | Order of retroactive designs | Shell first (section 12.8) |
| D-17 | Merge rule for a UI PR | A recorded approval before the merge. No waiting time |
| D-18 | Test devices | The 14-size matrix plus Nathan's iPhone (section 2.2) |
| D-19 | Live 3D on phones | Live 3D everywhere, loaded only when on screen, with a DPR cap |
| D-20 | Damage numbers on cards | Never on the cards |
| D-21 | Where the standard and the register live | On `main`. Corrected: the design files go to the private `lion-pride-tcg-design` repository |
| D-22 | Adventure dock target | The last tab. The badge shows on the tab with news, and the dock badge names that tab |
| D-23 | Pack count | Only on the OPEN button. No packs slot in the top bar (Nathan, 2026-10-04: "the only place it shows up with the number of packs they have is on the open button") |
| D-24 | Top-bar labels | No visible labels under the top-bar icons (Nathan, 2026-10-04: "No labels") |
| D-25 | Top-bar menu (REPLACED by D-31) | No overflow menu. Every top-bar icon stays visible (Nathan, 2026-10-04: "No menu, we keep the icons across the top bar") |
| D-26 | Sound control | None (Nathan, 2026-10-04: "Sound is not an option"). The top bar list is Shards, Shop, Dailies, help, Report, bell, Leaderboard, avatar ("I would like the wrench icon as well up there") |
| D-27 | Sub-tab counts | No counts on sub-tabs. The Achievements tab shows a Dot, in the place of the count, when an achievement can be claimed (Nathan, 2026-10-04: "remove the number of Achievements and the bosses … where the number is for the Achievement that is where the little notification can be for when an achievement can be redeemed") |
| D-28 | Rarity chip text | The full name only, no letter in front (Nathan, 2026-10-04: "lets not have the Acronyms, just the name. So for Normal, it wouldn't be N Normal, it would just read Normal") |
| D-29 | Card info under cards | None in any card view (grids, squads, trades, pickers). The card face only; a tap opens the Card Detail. Live state (fight HP, Down, status, Not owned, Locked, selected) stays on the card. The rarity shows by the frame, and its name in the Card Detail, the filter chips and the reveal (Nathan, 2026-10-04: "get rid of the symbols underneath them in the tiles"; option 1 "for all these views … card grids, squads, trading"; "The ability to click into a card for the information is what I want people to do"). The Dungeon picker keeps the point cost (Nathan: "keep the points on there that is fine") |
| D-30 | Offer rows on phones | Card/thumb (64 px minimum) in the row, and a tap opens the Offer view with both cards at full size (Nathan, 2026-10-04: the row is "really tiny to see things on it when you're on a phone"; chose the recommendation) |
| D-31 | Top bar and menu (replaces D-25) | Top bar: logo, Shards count, Shop, bell, Menu, avatar. Menu grid: Dailies, Leaderboard, FAQ, Feedback, Settings, Events. New pages: Settings (ping settings, Reduce effects) and Events / Game Log (patch notes, upcoming events) (Nathan, 2026-10-04: "this is a LOT of icons on the top bar … a little hamburger menu icon … a grid of all the places"; "Yes shard count stays on top bar"; "we keep the shop icon separate"; "Yep I was wrong" about D-25) |
| D-32 | Open trades list | Named "Pending" (Incoming, Sent). On phones a Pending button with the Dot opens it as a full sheet; on larger classes it is the side panel. The trophy in Community goes (Leaderboard lives in Menu) (Nathan, 2026-10-04: "Option A … its repeating Offer with another Offers … Yes I agree with Pending"; "get rid of the trophy in the community view") |
| D-35 | Trade flow | Member picker, then the Trade window with Your cards (Offer, Gift) and Their cards (Request). Offer, request or full proposal, 1 for 1. The other party picks the return card for an offer or a request, then the first party accepts or rejects (Nathan, 2026-10-04: "the first page of this is to search for the individual … a new dedicated screen … two views … an Offering system … and then a Request system"; answers 1-5: "you request, they request, and then you accept their offer or reject it", "1 card for 1 card", full proposal "I do like that", Gift as an action "Agreed", Trade Hall separate "Yes") |
| D-36 | Pager place | Always centered under its grid, on every screen (Nathan, 2026-10-04: "pager positions should be underneath the grid of cards always, wherever it is") |
| D-37 | Sub-tab place | Always one row directly under the top bar on every class, the same place everywhere (Nathan, 2026-10-04: "I don't like the upright phones having their own bar … what can we do to have the same sub tab location regardless always in the same place?"; chose option A). The next design wave shows this layout on its own sheet at every class. On compact-port the tabs fill the width (Nathan, review-3: "the full width on the portrait version is good") |
| D-38 | Card Detail | Opens only on a tap, as a window (dialog on larger classes, full sheet on phones). No card panel beside the grid on any screen; the grid uses the full width (Nathan, 2026-10-04: "I want the card information to pull up when they click a card, not have it be open automatically … on all views, we can have as much grid dedicated to cards") |
| D-33 | Can ascend | A "Can ascend" filter with its count, the Dot on the Cards tab, and the tab opens Collection with the filter on while the Dot shows (Nathan, 2026-10-04: "a filter … 'Can be ascended' … so that people don't have to scroll around … and can clear that notification better"; placement "Yes") |
| D-39 | Filters panel | Search box always visible beside a Filters button with the active count; the button opens a panel on top of the view with every other filter, Confirm and Clear all; the same on every card grid (Nathan, 2026-10-04: "a collapseable window … a tab you click/tap and then it expands on TOP of the view … a Confirm button"; "the search box should always be next to the filter box regardless"; Clear all, count, every grid: "Yes") |
| D-40 | Squad picker | Main view = slots + Select your squad / Start / Edit, read-only. The picker window = full grid, toolbar, Auto-pick, slot row with ×, numbered selection, tap again to remove, magnifier for Card Detail, live checks, Confirm; Hunt lock as today (Nathan, 2026-10-04: "that area become the 5 slots and a button under saying Select your Squad … opens up a pop up window with the same full grid … Confirm … Start Raid or Start Run … an Edit button"; "if they want to edit their squad it should be in the pop up … we do need a way for them to easily unselect cards"; 2-5 "Agreed") |
| D-41 | Shop layout | Desktop (`expanded`) keeps Packs and Stat reset as a right column; smaller classes use the three sub-tabs. "New stock in" is a chip in the stock header on every class. Every stock card uses ShopItem (card, price, Buy) (Nathan, 2026-10-04: "a good example of moving the New Stock to a different location"; "Lets keep it the same on desktop") |
| D-42 | One Card picker | The Squad picker becomes the Card picker, a small Collection with pick-one and pick-several modes, used by squads, trading, the Trade Hall (list, bid), wishlist, Spotlight and boons/pranks (Nathan, 2026-10-04: "a mini version of the collection that can be applied to each of the respective areas … is a smart way to go about it") |
| D-43 | One Member picker; Boons & pranks flow | Trades, Gift, Boons & pranks and profiles start with the Member picker. Boons & pranks: member first, then the Card picker with effect cards (Nathan, 2026-10-04: "The boon/Prank view honestly should get the same treatment as the trading view … search for the person first, THEN … pick the boon/prank") |
| D-44 | One Leaderboard window | Tabs Main, Hunt, Dungeon, Gauntlet; every board link opens its tab (Nathan, 2026-10-04: "Agreed") |
| D-45 | Home carousel | Slides Hunt, Dungeon, Gauntlet, Events; the most urgent first; no automatic sliding; dots, swipe and 44 px arrows; a Dot on a slide with news (Nathan, 2026-10-04: "the window where it shows the Pride Hunt, that will also be a carousel with the events/dungeons/etc"; slides "Yes those 4 slides are right"; auto-slide "None"; Dot "Yes") |
| D-46 | Stack when tall | A content area taller than wide stacks its side columns below the main content as full-width rows; a wide area keeps columns. One rule for every screen (Nathan, 2026-10-04: "I wonder if we stack these as rows instead of columns in this view?"; as a general rule "Yes that is a good rule") |
| D-47 | Sub-tab icons | Every sub-tab has an icon, all from the one line-icon set (Nathan, review-3: "Yes tab icons but making sure that they are universalized to be the same kind of icon") |
| D-48 | Top Hunters on Home | One line under the hero ("Top hunter: name · damage") that opens the Leaderboard window on the Hunt tab; no list over the boss (Nathan, review-3: "Agreed") |
| D-49 | Sub-tabs fit every phone | Each tab is as wide as its content and the row fills the width; it fits on every phone width; a name stays on one line and only shrinks, never wraps (Nathan, 2026-10-05, UI-02 review-4: "Yes, we want the tabs to fit regardless of phone screen"; "it should never wrap to two lines, always stays one line") |
| D-50 | One icon, one meaning | Achievements = `award` ("Yes Medal is fine"); Trade Hall = `landmark`, because `house` is the Home dock icon ("Agreed"); Boons & pranks gets its own icon, `party-popper`, because `sparkles` is the Arcane element ("Different icon") (Nathan, 2026-10-05, UI-02 review-4) |
| D-51 | Events slide hidden | The Events slide stays hidden until the events and daily content exists (Nathan, 2026-10-05, Home review-1: "Hide it for now until we get more of the events/daily things going on") |
| D-52 | Top hunter line | Shows during a live fight too; a button with a frame on every class (Nathan, 2026-10-05: "Yes show it during live fight"; "Button with Frame") |
| D-53 | Pager arrows | 44 px on touch classes (Nathan, 2026-10-05: "yes") |
| D-54 | Boss camera | Keep the current 3D camera and framing (Nathan, 2026-10-05: "No keep it the way it is, I Wanted it to be the the way it is") |
| D-55 | Home details | The news Dot on the dots row; the stats row on phones; other members first in Live in voice (Nathan, 2026-10-05: "Agreed") |
| D-56 | Live pulls spacing | One 8 px row gap, left-aligned two-line rows, the pager 12 px under the list (Nathan, 2026-10-05, Home review-3: "Need to fix the Live Pulls weird spacing"; "Those all look good!") |
| D-57 | Carousel slide control | Labels "Hunt · Dungeon · Gauntlet" on `expanded` and `medium`, dots on compact classes, the news Dot after the slide name (Nathan, 2026-10-05: "maybe on the bigger screens it has the whole label and then as it gets smaller/minimized it becomes dots?"; "Those all look good!") |
| D-58 | Top 3 on every slide | Each carousel slide shows its mode's Top 3 in the text column, never over the art; one line on `compact-land`. Replaces the "no list" part of D-48 (Nathan, 2026-10-05: "show me what a leaderboard would look like over the event window, this would apply to dungeons/arenas/bosses as well"; "Those all look good!") |
| D-59 | Live in voice window | A tap on "+N" opens a window with every member in voice (Nathan, 2026-10-05: "is it possible for us to click the '+4' and have it expand a window to show all the people?"; "Those all look good!") |
| D-60 | Small tiles on compact-land | Collection on `compact-land` uses 55 x 77 px tiles (below the 88 px minimum) to keep 2 rows and 24 cards per page, with 12 px under the toolbar, 8 px between rows and 12 px above the pager (Nathan, 2026-10-05, UI-07 review-1 option a: "Approved"; review-2: "approved with the spacing now") |
| D-61 | Hunt boss stage | The boss fills the Hunt view with its information; the squad is one strip at the bottom above the dock (Nathan, 2026-10-05, UI-17 review-1: "I want a bigger view of the boss, it should fill the whole screen with the boss information (health/leaderboard), almost like the home view looks like. And then the squad goes to the bottom towards the dock") |
| D-62 | Boons tab label | The Community tab is labelled "Boons", as the live app; it fits the 320 px row on one line (Nathan, 2026-10-05, UI-02 review-5: "Yeah just keep 'Boons'") |
| D-63 | Help button place | On the wide classes the view's "?" sits at the right end of the sub-tab row, not in its own row under it. Portrait phones: not decided (Nathan, 2026-10-05, UI-11 review-1 at 932x430: "The question mark should be on the same line as the tab in this view"; at 430x932: "the question mark doesn't fit in the sub tab bar row") |
| D-64 | Trades answers | Gift a pack in the Trade window; "Offer"; extra copies first; a magnifier on member tiles opens the profile; In voice first, then all members A-Z; undo toast; 6 cards per page at 375x667; partner rules; Accept is a secondary button (Nathan, 2026-10-05, Trades review-1; full list in the design repo FEEDBACK.md "Trades group") |
| D-65 | Hunt fight without boards | The fight screen has no Top hunter, no Top 3 and no countdown (Nathan, 2026-10-05, UI-18 review-2: "I would say we don't actualy need the leaderboard/top hunter on the fight screen and the 'beat in 1d 3h' timer as well on this view") |

| D-68 | Role glow in fights | In the Hunt, Dungeon, Gauntlet and Arena fights, the plate behind each card spot glows orange for an attack card (`--role-attack` `#F2611D`) and cyan for a support card (`--role-support` `#3FE3F5`). The card itself does not change; its edge keeps the rarity glow. Orange and cyan, not red and green, so that color-blind players see the difference (Nathan, 2026-10-06: "its strictly just in hunt/dungeon/arena that the spot where the card is at, it glows red/green, its only that, we're not changing anything on the card itself"; then "Yeah lets do the orange and cyan colors.") |
| D-69 | Support HP in fights | Support cards show an HP bar in the fight, as attackers do (Nathan, 2026-10-06: "the supports need to show health as well since they don't currently do that") |
| D-70 | Supports on supports | An ally support (heal, shield, empower) can target any squad card, supports too (Nathan, 2026-10-06: "they also need to be able to work on each other vs just attackers") |
| D-74 | Achievement tier names | Bronze, Silver, Platinum, Diamond, Obsidian; the steps after the last tier are "Obsidian +N". Not Gold (a reserved rarity word) and not Mythic (a superseded rarity name and a boss difficulty word) (Nathan, 2026-10-06, UI-13: "A") |
| D-75 | Achievement tier colors | The 5 tier colors and frame rings are UI-00 tokens, not literals (Nathan, 2026-10-06, UI-13: "agreed") |
| D-76 | Achievement track titles | Each track keeps its own 3 titles, an exception to 10.1 "the title is the achievement name" (Nathan, 2026-10-06, UI-13: "Agreed") |
| D-77 | The Hunter title | The Hunter track's first title is "Hunter", not "Raider" (Nathan, 2026-10-06, UI-13: "Agreed") |
| D-78 | Same-name titles | An old achievement title and a tier title with the same name stay two entries in the gallery (keyed by source) (Nathan, 2026-10-06, UI-13: "agreed") |
| D-79 | Title words | Track titles use no forbidden glossary word: Dupe Smelter -> Copy Smelter, Titan Breaker -> Boss Wrecker (Boss Breaker is an old title), Titan Slayer -> Giant Slayer (Nathan, 2026-10-07: "Yes as suggested", then "A") |
| D-80 | One pack balance, an Open screen | One pack balance; OPEN opens a screen with every pullable set, then the count (Nathan, 2026-10-07: "One pack balance, we will need to look at how to design a new screen then for the 'Opening' instead of it being a one button -> do one thing. There will need to be a screen that has all the sets available that they can pull from.") |
| D-81 | Old sets stay pullable | Season 1 stays pullable after Season 2 releases (Nathan, 2026-10-07: "Yes") |
| D-82 | Same odds for every set | Every set uses the one `pulls` odds row (Nathan, 2026-10-07: "Yes same odds") |
| D-83 | Set code on the card | Each card shows its set code with its number, for example "S2 · #014"; no set symbol (Nathan, 2026-10-07: "Set Code on the card") |
| D-84 | Rewards from all sets | Dungeon, Shop and other card rewards draw from every pullable set; only packs choose a set (Nathan, 2026-10-07: "I like completely random odds still across all sets") |
| D-117 | Sub-tabs on low landscape phones | On `compact-land` below 400 px usable height, the sub-tabs move into the top bar row beside the emblem (an exception to D-37). On 667x375 the second shell row took about 50 px of 375 px, and every Hunt screen was cut (Nathan, 2026-10-08: chose "Tabs into top bar") |
| D-136 | Phones and tablets portrait only | Phones and tablets are locked to portrait; only desktop has landscape. The lock is the Discord Developer Portal setting (no app code). 667x375, 932x430, 915x412, 1180x820 and 917x692 stay in the UI check as desktop windows (no touch, no keyboard and no safe variants). Flag OFF keeps its own lock. Conditional on Nathan's Discord poll (Nathan, 2026-10-09: "I'm honestly wondering if we should even make landscape a thing"; chose "Phones portrait only"; then "tablet would be just a bigger version of portrait in my mind") |
| D-138 | No typing in the tiny window | The UI check drops the keyboard variant at the tiny size (Discord picture-in-picture). Assumed: a tap on the small window opens the full Activity first (not tested on a phone) (Nathan, 2026-10-09, with D-136) |
## Appendix B. Rules that this file replaces
Each old rule below is now in this file. Each old place keeps one line that points here. (G-001, G-180)

| Old rule | Old place | Now |
|---|---|---|
| A screen never scrolls | `tcg-bot/docs/DESIGN.md`, screen rule 1 | Section 3.3 |
| Nothing bleeds. A long name gets an ellipsis | DESIGN.md, rule 2 | Section 3.3. D-08 replaces the ellipsis part (section 10.4) |
| Nothing moves when a state changes | DESIGN.md, rule 3 | Section 3.3 |
| Check three sizes before you ship | DESIGN.md, rule 4 | Sections 2.2 and 12.6 (15 sizes) |
| No explainer subtitles | DESIGN.md, rule 5 | Section 10.3 |
| No scrolling, lists page, pen.dev design and approval before the build | `docs/activities/README.md`, section 3 | Sections 3.3, 3.4 and 12.3 |
| Read the screen rules before a UI change | `CLAUDE.md`, Traps | A pointer to this file |
| Design first, approve, then build | Old draft on `docs/design-md`, section 1 | Section 12.3 |
| The card face shows no tags | Old draft, section 2 | Section 8.1 |
| Big damage numbers, never on the cards | Old draft, section 2 | Section 8.4 |
| The dark theme stays | Old draft, section 2 | Section 1 (P0) |
| Rarity names stay | Old draft, section 7 | Section 4.6 (D-01) |
| Boon is gold | Old draft, section 2 | Replaced: boon is teal (D-03) |
| Screen change 250 ms or less, and respect reduced motion | Old draft, section 5 | Section 4.11 |
| Design for about 1280x720 first | Old draft, section 2 | Replaced by the size classes (section 2.1) |
| Do not change the desktop look | Earlier session rule | Retired. P0 and P1 replace it |

## Appendix C. S1 gaps and the rules that close them
All 24 S1 gaps of the 2026-10-04 audit have at least one rule.

| S1 gap | Title (short) | Rule section |
|---|---|---|
| G-003 | Phones lose functions and primary data | 1 (P1), 3.4, 12.6 |
| G-012 | No design for the smallest Discord window | 2.1, 2.3, 5.2 (small live view) |
| G-018 | Sub-tab area collapses below about 1220 px | 3.1, 5.2 (Tabs) |
| G-022 | Code deletes list rows that do not fit | 3.4, 3.5 |
| G-072 | Dock "Hunt" button changes name and target | 6.1 |
| G-074 | Leaderboard entry depends on another flag | 6.1 |
| G-077 | One action has several doors | 6.5 |
| G-079 | Notification buttons go to the wrong place | 6.6 |
| G-083 | Errors show as empty or closed | 7.1, 7.2 |
| G-086 | Double taps send actions two times | 7.1, 7.2 |
| G-087 | A background repaint removes a pending lock | 7.1 |
| G-088 | Success shows after a failure | 7.1, 7.2 |
| G-089 | Eleven feedback surfaces, one color for success and error | 7.3 |
| G-090 | Destructive actions have no confirm and no undo | 7.4 |
| G-091 | Failed calls are cached as empty data | 7.1 |
| G-092 | Flags fail closed with no message | 7.2 |
| G-105 | Information only in `title` or on hover | 9.2 |
| G-117 | Pranks control the screen of another member, with no opt-out | 9.5 |
| G-118 | No visible sound control | 9.5 (closed by decision D-26: no sound control) |
| G-163 | No request timeout | 11.3 |
| G-164 | No offline detection and no loader timeout | 7.2, 11.3 |
| G-165 | A 401 has no handler | 7.2, 11.3 |
| G-195 | A negative balance shows in the success color | 4.5, 7.3 |
| G-196 | Sections overlap on small phones | 3.3 |
