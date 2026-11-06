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
| `ART_STORE` | Nathan's PC, `card-studio/.env` | `supabase` / `r2` (picks the writer backend only) | `supabase` |
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
| `CUTOVER` | The writers use R2 only. `ART_STORE=supabase` is refused (`refused: cut to R2 (R2-MOVE)`). |
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
| `r2-copy.mjs` (`--live`, `--delta`, `--reverse`) | S2 full copy, S4 delta, the rollback copy R2 -> Supabase |
| `r2-verify.mjs` (`--exact`, `--before`, `--manifest`, `--source`) | G1 |
| `r2-preflight.mjs` | G10, before S5, from each serving host |
| `r2-live-check.mjs` (`--expect supabase` for G7/G8) | G6 after S5 |
| `r2-stats-check.mjs` | G5, 24 h with no fallback before S6 |
| `r2-retire-supabase.mjs` (`--dry`, `--live`, `--hosts-check`) | G9, S7 |
| `r2-sign-check.mjs` | the real signing check on `lptcg-media-test` |
| `r2-secret-check.mjs` | G11, before every push |
| `r2-mutations.mjs` | the mutation runner of THE GATE (`mutations/*.mjs`) |

## Rollback

- Before S4: set `IMG_UPSTREAM=supabase` and `GALLERY_ART=supabase` on each host, then deploy.
- S4 to S7: write `FROZEN`, run `r2-copy --reverse --live` (every write-log key, R2 -> Supabase), then `r2-verify --exact`.
  Then remove `CUTOVER`, set `ART_STORE=supabase`, set the reader env back, and remove `FROZEN`.
- After S7: no rollback to Supabase. R2 and the S7 second copy are the only copies.
