# The UI gates G1, G3 and G4

The UI standard (`docs/design.md` 12.5) names the gates. This folder builds G1, G3 and G4. The workflow is
`.github/workflows/ui-gates.yml`. G2 and G5 to G8 are not in this folder yet.

| Gate | Job name | Script | Fails when |
|---|---|---|---|
| G1 Register | `G1 Register` | `gates/g1-register.mjs` | A UI PR has no register ID in its title, or a title ID has no recorded design approval in `docs/ui-register.md` |
| G3 UI check | `G3 UI check` | `ui-check/run.mjs`, `ui-check/evaluate.mjs` | An enforced screen has a defect from the list in design.md 12.6, or a screen was not checked |
| G4 Literal counter | `G4 Literal counter` | `gates/g4-literals.mjs` | A literal count in the UI scope rises against the base of the PR, or a generated token file is not current |

## The UI scope (G1, G3, G4)

`gates/scope.json` lists the files. A file is in scope when it matches `ui` and no `notUi` pattern:

- `tcg-activity/public/**`, `tcg-activity/src/**` (not `*-routes.js`: server routes), the bot picture modules
  (`playing-card.ts`, `post-pictures.ts`, `raid-cards.ts`) and the gallery page (`gallery-deploy/public-gallery/**`).
- Tests (`*.test.*`) are not in scope.

A PR that changes no file in scope passes G1, and G3 does not run.

## G1 Register

- The register IDs are the `UI-nn` words in the PR title, for example `UI-07 Collection grid` (design.md 12.3 step 5).
- Each ID needs a row whose Approved column starts with `YYYY-MM-DD, design` (the record format of design.md 12.4).
  A row with "No", a spec approval, a legacy "Yes, date not recorded", or a Retired row fails.
- G1 reads the register of the PR head.

## G4 Literal counter

- Files: every git-tracked file in scope that ends in `.css`, `.html`, `.js`, `.mjs` or `.ts`, minus the token source and
  the files generated from it (`tokenSource` in `gates/scope.json`).
- The token files (design.md 4.1): G4 also runs `node shared/build-tokens.mjs --check`. It fails when a token is missing
  or invalid, or when a generated file is stale or was changed by hand. So no literal can hide in a skipped file.
  To change a token: edit `shared/tokens.json`, run `node shared/build-tokens.mjs`, and commit the source and the 4
  generated files (`tcg-activity/public/tokens.css`, `tcg-activity/src/tokens.js`, `tcg-bot/src/tokens.ts`,
  `card-studio/gallery-deploy/public-gallery/tokens.css`).
- Units:
  - `color`: hex colors (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`), JS hex (`0xRRGGBB`), and `rgb()`, `rgba()`, `hsl()`, `hsla()`.
  - `px`: every number literal with the unit `px`.
  - `z`: every `z-index` or `zIndex` value that is not a `var(--z-*)` token.
  - `mland`: every `m-land`. `mport`: every `m-port`.
- An element id that only looks like hex (`#feed`) is not a color. CSS block comments are not counted.
- A unit fails when its total rises against the merge base with `main`. A move from one file to another changes no total.
- The 2026-10-04 baseline (`20a1327`): 1,727 colors, 6,416 px, 140 z, 1,197 m-land, 942 m-port.

## G3 UI check

**How it runs.**
- The client is built from `tcg-activity/src` with the SDK stub (`ui-check/build.mjs`, into `ui-check/.out`).
- `ui-check/serve.mjs` serves `tcg-activity/public`, the build, and every `GET /api` answer from the recorded fixtures
  (`ui-check/fixtures/api.json`). There is no database, no secret and no real member data. Every write answers 403.
- `ui-check/run.mjs` opens each screen and window of the audit walkthrough (`ui-check/screens.mjs`: 26 entries, from
  `discord-ui-audit/common.py`) at each test size of design.md 2.2 (15 sizes), in a new browser context for each cell.
- The browser clock is set to the recording time (time zone America/Denver), so countdowns and the Hunt state stay the same.
- 6 CI jobs for each browser (Chromium, WebKit): `--shard k/6` gives each job every 6th cell, so all jobs together run
  every cell. The verdict job merges the `g3-*` artifacts. Each job runs 4 cells at a time (`--workers 4`), each cell in
  its own browser context. One job for each browser took 76 min for 764 cells; 6 shards took 22 min (PR #267, 2026-10-07).
- Time limits: the browser install has 8 min for each try and 2 tries (it hung once for 1 h 49 min), the Install step
  20 min, and a shard job 45 min.
- Each step waits until the screen is ready (fonts loaded, no loading placeholder, no running animation, the page
  unchanged for 0.75 s), not a fixed time. `UI_CHECK_WAIT=fixed` gives the fixed waits of the audit walkthrough back.
  `compare.mjs <dirA> <dirB>` compares two runs cell by cell.

**Which screens a run checks** (`ui-check/plan.mjs`):
- A PR checks the screens of its enforced IDs (below), at every size and in both browsers.
- A PR that names the shell (`UI-01` top bar and dock, `UI-02` sub-tabs) checks every screen, because the shell is on every screen.
  The same applies to `UI-00`, the design system (tokens and components): it is on every screen and has no screen of its own.
- A PR that changes the check itself (`ci/ui-check/`, the two workflows) checks every screen.
- A UI PR with no enforced ID checks no screen. G1 fails it anyway (no ID in the title).
- The nightly report (`.github/workflows/ui-report.yml`, 03:17 MT and on demand) checks every screen. Its artifact
  `g3-report` (`defects.json`) is the list for all screens. It fails when a Migrated screen has a defect.

**The checks** (one item for each row of design.md 12.6):

| Item | Source |
|---|---|
| Page scroll, bleed, clipped text, cut buttons, overlapping sections | `checks/fitdetect.js` (unchanged from `discord-ui-preview`), `checks/cutdetect.js`, `checks/walk-checks.js` |
| "…" on a name | `cutdetect.js` `ellipsis` |
| Text below 11 px, touch target below 44 px, covered control (`elementFromPoint`), Discord corner zone, window outside the frame, empty space, missing vs 1990x830 | `checks/walk-checks.js` (the audit `checks.js`, unchanged) |
| Icon-only control without a name, contrast | `checks/extra.js` (new) |

**Variants** (design.md 12.6), on every size unless stated:
- `base`: every screen.
- `long`: a 32-character name and a 9-digit number, on the screens that show member names or counts (the spec has `long: true`).
- `safe`: the safe-area presets (portrait: top 59, bottom 34; landscape: sides 59, bottom 21), on the compact touch sizes,
  on the overlays, windows and stages (the spec has `safe: true`).
- `keyboard`: a text box focused and the keyboard height taken off the view (40% in portrait, 55% in landscape), on the
  touch sizes, for the screens with a text box.

**Which defects fail the gate.** Every defect is listed in the summary and in `defects.json`. The gate fails on the
defects of the enforced IDs:
- the IDs in the PR title (the screens that the PR changes), and
- every register row whose Standard is `Migrated` or `In migration`.

The other IDs are reported, not enforced, because a screen stays `Not migrated` until its own PR (design.md 12.9).
Today every screen fails the full list (the 2026-10-04 audit found 1,599 detector defects), so a gate that enforced every
screen would block every PR. `evaluate.mjs --strict` enforces every ID.
- A defect in the top bar or the dock belongs to `UI-01`. A defect in the sub-tab bar belongs to `UI-02` (`ownerOf()` in `screens.mjs`).
- A cell with no result, a step that finds no control, or a call with no fixture is "not checked". On an enforced ID, it fails.
- An enforced ID that no screen of `screens.mjs` opens (for example `UI-49` today) fails as "not checked". Add its screen
  to `screens.mjs` in the PR that builds it.

**How to add a screen.** Each step changes only the lines of the new screen, so two PRs do not conflict on a shared line:
1. Add one spec line to `SCREENS` in `ui-check/screens.mjs`: `'my-screen': { id: 'UI-nn', notOn: [...], steps: [...] }`.
2. Put the flags on that same line. `long: true` runs the `long` variant. `safe: true` runs the `safe` variant.
   `run.mjs` reads both from `SCREENS`. It has no list of screen names.
3. If the screen needs a state that the recording does not hold, set a cookie field on the spec (for example `dungeon: 'rest'`).
   Then register the state in `ui-check/serve.mjs`: write the helper function and, directly under it, one line
   `DERIVED.push({ when: (p, c, body) => ..., make: (body, c) => ... })`. `p` is the path, `c` the cookies, `body` the recorded answer.
   Do not edit the request handler.

**Record the fixtures again** when the API changes (the summary shows "no fixture" on a screen):
1. Start the preview server on the LOCAL database copy, with `LOADTEST=1` and every `FEATURE_*` flag on (port 4471).
2. `cd ci/ui-check && node record.mjs --base http://127.0.0.1:4471 --me <member id>`.
3. The recorder replaces every member id, name and avatar (`fixture-lib.mjs`), and it stops when a real name or id is still in
   the text. Card names are catalog data (`card-studio/cards.json` is public) and stay.

**Run it locally.**
```
npm ci --prefix ci/ui-check && (cd ci/ui-check && npx playwright install chromium webkit)
node ci/ui-check/build.mjs
node ci/ui-check/run.mjs --browser chromium --sizes 430x932 --screens home,dungeon --workers 4
node ci/ui-check/evaluate.mjs --browsers chromium --sizes 430x932 --screens home,dungeon
```

## Making the gates required

Done on 2026-10-05: `main` requires `G1 Register`, `G3 UI check` and `G4 Literal counter`, for admins too (design.md
12.5 G7, 12.9 item 4). The job names must not change: branch protection matches them by name.

