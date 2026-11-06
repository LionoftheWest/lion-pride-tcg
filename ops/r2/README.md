# Card art on Cloudflare R2 (R2-MOVE)

The public card media (Supabase bucket `card-art`) moves to Cloudflare R2. The stored URLs do not change.
The private bucket `report-shots` stays in Supabase.

## The parts

| Part | Value |
|---|---|
| Bucket | `lptcg-media` (tests: `lptcg-media-test`), on Nathan's PERSONAL Cloudflare account (zone `lionpridetcg.com`) |
| Key | `card-art/<the Supabase object name>`, for example `card-art/cards/abc-gold.webp` |
| Public domain | `https://img.lionpridetcg.com/card-art/<name>` (custom domain of `lptcg-media`; a missing key = 404) |
| Cache Rule | host `img.lionpridetcg.com`: eligible for cache, query string in the cache key, 4xx and 5xx = no-store (needed before S5) |
| S3 endpoint | `https://<account id>.r2.cloudflarestorage.com` (the account id is in `card-studio/src/r2-vault.js`; it is not a secret) |
| Token | `lptcg-media-rw`: Object Read & Write on `lptcg-media` and `lptcg-media-test` only (ListBuckets = 403) |

## The write key (I-6)

The key is ONLY in the DPAPI vault on Nathan's PC: `C:\Users\vaugh\.secrets\vault.ps1`, entries `r2-access-key-id` and
`r2-secret-access-key` (CurrentUser scope: only the Windows user `nathan_gaming\vaugh` can read them).
`card-studio/src/r2-vault.js` reads them with a child `powershell`. It never prints a value.
No R2 key goes into any `.env`, into this repo, or onto a host. The hosts READ the public domain and need no key.
Before every push of an R2 branch run `node card-studio/scripts/r2-secret-check.mjs`. It must print `SECRET-CHECK PASS`.

## Env names (the modes are not secrets)

| Env | Where | Values | Unset |
|---|---|---|---|
| `IMG_UPSTREAM` | Activity and bot `.env`, every serving host | `supabase` / `r2-first` / `r2` | the process does not start |
| `R2_PUBLIC_BASE` | Activity, bot, gallery, Studio | `https://img.lionpridetcg.com` | refused when a mode needs it |
| `GALLERY_ART` | gallery `.env` (and the Studio gallery) | `supabase` / `r2` | the gallery does not start |
| `ART_STORE` | Nathan's PC, `card-studio/.env` | `supabase` / `r2` (picks the writer backend only; `r2` is refused until `CUTOVER` exists) | `supabase` |
| `ART_WRITE_LOG` | Nathan's PC | path | `C:\Users\vaugh\.lptcg\r2\art-writes.jsonl` |

- `r2-first`: R2, and on ANY non-200 or error, Supabase. Each fallback prints `img-fallback <key> <status|error> mode=r2-first`
  at once. The hourly `img-cache` line has `fallback= r2err= r2=`.
- `r2`: R2 only.
- The Activity `/api/config` has `"img":"<mode>"`. `ops/deploy.sh` checks it against the host `.env` and loads one image.
- The bot start line is `Ready. Logged in as <tag>. img=<mode>`.

## The freeze and the cut are FILES (Nathan's PC)

Folder `C:\Users\vaugh\.lptcg\r2\`. Every art writer reads it on EVERY call (`card-studio/src/art-store.js`), whatever its `.env`.

| File | Meaning |
|---|---|
| `FROZEN` | No NEW logical write starts (`refused: art-store frozen (R2-MOVE S4) <label>`). A started write finishes. |
| `CUTOVER` | The writers use R2 only. `ART_STORE=supabase` is refused (`refused: cut to R2 (R2-MOVE)`). Without `CUTOVER`, `ART_STORE=r2` is refused (`refused: ART_STORE=r2 before the cut (R2-MOVE)`): before the cut an R2-only write is lost. |
| `inflight\<pid>-<n>` | One logical write runs: one tier of a push (main + grid + reveal + row), one pack art, the card back, one delete, one thumbnail pair, one boss or shimmer file. |
| `art-writes.jsonl` | The write log: one line per R2 write or delete `{t, op, key, md5, bytes, type}`, written BEFORE the request. |

- `node card-studio/scripts/r2-s4-wait.mjs` waits until `inflight\` is empty (max 10 min). It reports and removes a dead
  process's file as `STALE-INFLIGHT <file> <label>`.
- `stage-faces.mjs --live` writes Supabase only. It refuses (exit 6) with `FROZEN`, `CUTOVER` or `ART_STORE` not `supabase`.

## The writers and readers

- Writers (all through `art-store.js`): Studio push, pack art, card back, tier and card delete, `make-thumbs.mjs`,
  `tcg-activity/scripts/upload-boss-*.mjs`, `tcg-bot/src/upload-anim.ts`. CI gate G3a (`ci/gates/art-direct.test.mjs`)
  fails on any other storage API call of the card art.
- Readers: the Activity `/api/img/` (the disk-cache key stays the logical URL), the bot `art()` and embeds, the public
  gallery and the Studio gallery (`GALLERY_ART`), the Studio admin grid (`ART_STORE`).

## The Discord rule (I-8)

Every image that the Activity or a Discord embed shows stays under `/app/api/img/` (`play.lionpridetcg.com`, or the
duckdns `/app/api/img/` for embeds). The Activity CSP allows images from its own origin only. The R2 domain is used only
on the server side and by the public gallery (a normal web page). G3a fails on `img.lionpridetcg.com` or `R2_PUBLIC_BASE`
in `tcg-activity/src` or `tcg-activity/public`.

## The stored URLs (I-4)

`cards.image_url` and `card_sets.pack_art_url` keep the LOGICAL form
`https://kgvdqqehefezbypozvrh.supabase.co/storage/v1/object/public/card-art/<name>?v=<n>`. After the Supabase delete (S7)
that host has no file. Every reader maps the name (`art-url.js`: `artKey`, `r2Url`). Never fetch a stored URL directly.

## The tools (card-studio/scripts)

| Tool | Step |
|---|---|
| `r2-copy.mjs` (`--live`, `--delta`, `--reverse`, `--max-deletes <n>`) | S2 full copy, S4 delta, the rollback copy R2 -> Supabase. `--delta` refuses more than 200 DELTA-DEL before any write (a short DB list). Check the list, then add `--max-deletes <n>`. `--reverse --live` refuses without `FROZEN`. |
| `r2-verify.mjs` (`--exact`, `--before`, `--manifest`, `--source`) | G1 |
| `r2-preflight.mjs` | G10, before S5, from each serving host |
| `r2-live-check.mjs` (`--expect supabase` for G7/G8) | G6 after S5 |
| `r2-stats-check.mjs` | G5, 24 h with no fallback before S6 |
| `r2-retire-supabase.mjs` (`--dry`, `--live`, `--hosts-check`) | G9, S7 |
| `r2-sign-check.mjs` | the real signing check on `lptcg-media-test` |
| `r2-secret-check.mjs` | G11, before every push |
| `r2-mutations.mjs` | the mutation runner of THE GATE (`mutations/*.mjs`) |

## The deploy health check and the rollback (ops/deploy.sh)

- A NEW Activity build is healthy when `/api/config` has `"hunt":true` and `"img"` = the `IMG_UPSTREAM` of the host `.env`,
  and one image loads as `image/webp` through `/api/img` (`HEALTH`).
- The rollback checks the OLD image with `HEALTH_PREV`: `"hunt":true`. When the `"img"` field exists, it must equal the
  `.env` value, and one image must load as `image/webp`. An Activity built before R2-MOVE has no `"img"` field and passes.
  So `ROLLBACK ALSO UNHEALTHY` means a real defect.
- An env-only deploy (S5, S6) rolls back to the same code with the same `.env`. If that mode does not serve images, the
  rollback is also broken, and deploy.sh prints `ROLLBACK ALSO UNHEALTHY`. Set the `.env` back to the last mode, then deploy again.
- Bot and gallery: the rollback uses the same check as the new build. Test: `bash ops/deploy-health.test.sh`.
- **Main hosts: to change an env value (S5, S6), edit the `.env`, then run `ops/deploy.sh <activity|bot|gallery>`. Never use
  `docker restart`.** Docker reads `--env-file` only when it creates a container. deploy.sh removes the container and runs
  it again (`run()`), so the new `.env` takes effect.

## The bot on the backup VM (STANDBY)

Observed 2026-11-06 on the backup VM (137.131.48.8, private 10.0.0.94):
- The failover bot runs image `tcg-bot:399a67f`. That commit is older than PR 527. Its start line has no `img=`, and its
  code does not read `IMG_UPSTREAM`. The `.env` and the container env have `IMG_UPSTREAM=supabase`. The old code ignores them.
- `TARGET=backup ops/deploy.sh bot` stops while that bot runs (the STANDBY rule). This is correct. Do not change it.
  So the bot image on the backup stays old until a failback (`ops/failover/failback.sh`), then `TARGET=backup ops/deploy.sh bot`.

Docker reads `--env-file` only when it creates the container. `docker restart` and `docker start` keep the old values
(test 2026-11-06: `X=one` in the file, the file changed to `X=two`, `docker restart`, the container still had `X=one`).
The bot reads `IMG_UPSTREAM` from its process env (`tcg-bot/src/index.ts:21` at start, `playing-posts.ts` on each call).
So `docker restart tcg-bot` is NOT enough for an S5 or S6 env change:
- The old backup image (`399a67f`): an env change has no effect. Nothing to do for S5 and S6.
- A bot image of PR 527 or newer: create the container again with the same image and the new `.env` (no build):

```
sudo docker stop -t 10 tcg-bot && sudo docker rm tcg-bot
sudo docker run -d --init --name tcg-bot --network host --restart unless-stopped --log-opt max-size=20m --log-opt max-file=3 --env-file /home/ubuntu/tcg-bot/.env tcg-bot:latest
sudo docker logs tcg-bot 2>&1 | grep 'Ready. Logged in'     # must end with img=<the new mode>
```

  For a STOPPED standby container, use `docker create` with the same flags in place of `docker run -d`.
- Before S7 (the Supabase delete) the backup bot must run an image of PR 527 or newer. The old image reads Supabase
  directly for an image fallback. Do a failback, then `TARGET=backup ops/deploy.sh bot`.

## Rollback

- Before S4: set `IMG_UPSTREAM=supabase` and `GALLERY_ART=supabase` on each host, then deploy.
- S4 to S7: write `FROZEN`, run `r2-copy --reverse --live` (every write-log key, R2 -> Supabase), then `r2-verify --exact`.
  Then remove `CUTOVER`, set `ART_STORE=supabase`, set the reader env back, and remove `FROZEN`.
- After S7: no rollback to Supabase. R2 and the S7 second copy are the only copies.
