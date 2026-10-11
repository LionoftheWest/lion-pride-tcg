# Player reports

Members send a Bug, Feedback, or Idea with the wrench button in the top bar (design 23).
Each report becomes a GitHub Issue in this repository with the label `player-report`.

## How a report travels

1. The member writes the report. The panel also sends short context items: the screen,
   the app version (the bundle hash), the window size, the last script error, and the device
   facts (below).
2. `POST /api/feedback` (`tcg-activity/reports.js`) takes the member from the verified
   Discord token, never from the request body.
3. `submit_report()` (`tcg-bot/supabase/player_reports.sql`) checks the kind and the length
   (5 to 1500 characters). It also checks the limit: 3 a day per member, reset at midnight MT.
   Set `settings.reports.per_day` to change the limit. Set it to 0 to stop new reports.
4. The Activity server sends each waiting report to GitHub within a minute. It retries a
   failed call up to 8 times. `player_reports.issue_number` and `issue_url` record the result.

## Device facts

`tcg-activity/src/device-facts.js` makes six short words from the browser facts. The client sends
them in the report context. `cleanContext` (`reports.js`) keeps only these keys, each with a
length limit. The Issue shows each one as a table row. The raw user agent is never stored or sent.

| Key (limit) | Issue row | Values |
|---|---|---|
| `app` (20) | App | Desktop app, Mobile app, Browser |
| `device` (12) | Device | Phone, Tablet, Desktop |
| `os` (24) | System | For example iOS 18, iPadOS 17, Android 15, Windows 10 or 11, macOS |
| `engine` (12) | Engine | WebKit, Chromium, Gecko |
| `layout` (32) | Layout | The size class of `docs/design.md` 2.1 (`ui3/size-class.js`), for example compact landscape low |
| `dpr` (8) | Pixel ratio | For example 3x, 2.6x |

- The inputs: the user agent, `maxTouchPoints`, the window size, `devicePixelRatio`, the Discord SDK
  platform, and `body.dataset` (the size class). Without a class, it calls `sizeClass()`.
- The SDK platform `desktop` is the desktop app and also discord.com in a browser. The agent decides:
  Electron with `discord/<version>` is the Desktop app.
- macOS and Windows 11 cannot be read from the agent (it is frozen). The optional input
  `platformVersion` (the client hint) gives "macOS 15" or "Windows 11".
- The Feedback window (UI-40) does not call it yet. That waits for the approved UI-40 design.

## Screenshots (private)

A member can add up to 3 screenshots to an own report. `report_shots.sql` has the table, the bucket
and the functions.

1. The client sends the report first and gets its id. The report never waits for an image.
2. The client sends each image to `POST /api/feedback/<id>/shot`. The body is the raw image with
   `Content-Type` `image/webp`, `image/png` or `image/jpeg`.
3. The route takes the member from the Discord token. It refuses an image whose first bytes do not
   match the `Content-Type` (415). It reads at most 5 MB (413). It allows 6 uploads per member in 10 minutes (429).
4. `reserve_report_shot()` checks the owner (404), the size (413), the count (409) and the report age.
   It locks the report, so two fast uploads cannot both pass the count.
5. The route uploads the file to the PRIVATE bucket `report-shots` at `<report id>/<n>.<webp|png|jpg>`,
   and sets `stored_at`. If the upload fails, it deletes the row, so the member can try again.

| Status | Error | Cause |
|---|---|---|
| 415 | `type` | Not webp, png or jpeg by its first bytes, or the header does not match |
| 413 | `big` | Above `balance report_shots.max_bytes`, or above the 5 MB read limit |
| 404 | `report` | Not the member's own report, unknown, or older than `keep_days` |
| 409 | `full` | The report has `per_report` screenshots |
| 429 | `slow down` | More than 6 uploads in 10 minutes |

GitHub:
- The images never go to GitHub. The Issue has no storage link.
- When the Issue is made, it counts the stored screenshots: "2 screenshots, see the Admin page (private)."
- A screenshot stored after the Issue gets one comment for each sync pass: "1 screenshot added to
  report #N after this Issue, see the Admin page (private)." `noted_at` records which screenshots
  the Issue or a comment counted.

The numbers are in `balance report_shots`: `keep_days` (90), `per_report` (3), `max_bytes` (1572864).
`balance_check_report_shots` refuses a value that is not a whole number of at least 1, `per_report` above 9,
and `max_bytes` above 5 MB.

Cleanup: the Activity runs `pruneShotsOnce` 1 minute after the start and then every 6 hours, also with
`FEATURE_REPORTS` off. `report_shots_expired()` lists the screenshots older than `keep_days`. The Activity
removes the files with the storage API, then the rows. SQL cannot do this: a row delete in
`storage.objects` does not remove the stored file. If the file removal fails, the rows stay for the next pass.
Then `pruneOrphanShotsOnce` lists the bucket with the storage API, page by page. It removes every file that is
older than `keep_days`. It also removes every file that has no `player_report_shots` row and is older than 1 day,
for example the files of a deleted member (the rows go with the report). The 1-day grace protects an upload in
progress. Without the balance key, or when the rows cannot be read, it removes nothing.

The Admin page: card studio, Admin view, **Player reports** (`#/player-reports`, `ADMIN_VIEW=1`). It is read only.
It shows each report with the kind, the text, the device facts, the Issue link, the reporter and the target,
and the screenshots. The screenshot links are signed and end after 5 minutes. Press Refresh for new links.

## Privacy

This repository is public. The Issue says "a member (report #N)" and never names the member.
Every `@` is broken, so that an Issue cannot ping anyone, and `<` is escaped. The member is
recorded only in `player_reports.player_id`. RLS is on and no policy exists, so no member can
read the table. To answer a member, read the row with the service key. The screenshots follow
the same rule: the bucket is private, `player_report_shots` has RLS with no policy, and only the
service role reads them (the Admin page uses short signed links).

## Flags (default OFF)

| Variable (VM `activity/.env`) | Effect |
|---|---|
| `FEATURE_REPORTS=1` | The wrench shows and `/api/feedback` accepts reports. |
| `GITHUB_ISSUES_TOKEN` | A fine-grained token: repository `lion-pride-tcg` only, permission Issues read and write. Without it, reports wait in the table and sync when the token is set. |
| `GITHUB_ISSUES_REPO` | Optional. The default is `LionoftheWest/lion-pride-tcg`. |

## Working on reports (an agent session)

Nathan asks for this work. A session does not start it alone.

1. List the open reports: `gh issue list --label player-report --state open`.
2. For each report, reproduce the problem first: use the preview harness, a rolled-back
   SQL test, or the logs. Write what you saw in a comment on the Issue. If you cannot
   reproduce it, say so and ask for more detail. Do not guess a fix.
3. Write a test that fails because of the defect. Then make the smallest fix that passes it.
   Prove the test with a baseline: the test must fail on `main`.
4. Commit on a branch in a worktree, and open a DRAFT pull request that says `Fixes #N`.
   Comment on the Issue with the PR link, the test, and the evidence.
5. Do NOT merge, migrate, or deploy. Nathan reviews each fix and gives the go.
6. For Feedback and Idea Issues, write a short proposal (what, why, cost) in a comment.
   Do not build it until Nathan approves.
