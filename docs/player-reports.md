# Player reports

Members send a Bug, Feedback, or Idea with the wrench button in the top bar (design 23).
Each report becomes a GitHub Issue in this repository with the label `player-report`.

## How a report travels

1. The member writes the report. The panel also sends 4 short context items: the screen,
   the app version (the bundle hash), the window size, and the last script error.
2. `POST /api/feedback` (`tcg-activity/reports.js`) takes the member from the verified
   Discord token, never from the request body.
3. `submit_report()` (`tcg-bot/supabase/player_reports.sql`) checks the kind and the length
   (5 to 1500 characters). It also checks the limit: 3 a day per member, reset at midnight MT.
   Set `settings.reports.per_day` to change the limit. Set it to 0 to stop new reports.
4. The Activity server sends each waiting report to GitHub within a minute. It retries a
   failed call up to 8 times. `player_reports.issue_number` and `issue_url` record the result.

## Privacy

This repository is public. The Issue says "a member (report #N)" and never names the member.
Every `@` is broken, so that an Issue cannot ping anyone, and `<` is escaped. The member is
recorded only in `player_reports.player_id`. RLS is on and no policy exists, so no member can
read the table. To answer a member, read the row with the service key.

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
