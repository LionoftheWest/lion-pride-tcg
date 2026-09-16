# Lion Pride TCG — Discord Activity (minimal spike)

A Discord **Activity** is a web page Discord runs inside its own client (an
embedded frame). This spike proves the whole pipeline: **launch it inside
Discord → it logs you in → it shows YOUR collection**. Single-player, no realtime.
Card art + the interactive tilt come next once this loads cleanly.

It reuses the same Supabase the bot and studio already use, so it reads real
`player_cards`. Claude builds and hosts the code; **you** do the Discord
dev-portal steps below (only you can).

---

## What Claude needs from you (one secret)

1. **OAuth2 Client Secret**
   - Discord **Developer Portal** → your app → **OAuth2** → **Client Secret** → **Reset** (or Copy).
   - This is NOT the bot token. The backend uses it to turn a login code into a token.
   - Paste it to Claude (it goes only into the server's private `.env`, never the browser, never git).

That is the only secret. The app id (`DISCORD_CLIENT_ID`) is already known.

---

## Portal steps you do (Claude will give you the exact URL to paste once it deploys)

2. **Turn the app into an Activity**
   - Dev Portal → your app → **Activities** → **Settings** → enable **Activities**.

3. **URL Mapping** (this is how the frame reaches our server) — **DEPLOYED, ready**
   - Dev Portal → your app → **Activities** → **URL Mappings**.
   - Add a **root mapping**: `PREFIX = /`  →  `TARGET = lionpridetcg.duckdns.org/app`
   - Live check (open in a browser, should show the app): `https://lionpridetcg.duckdns.org/app/`
   - Later we add one more mapping for card images (Supabase). Not needed for this first load.
   - If the portal rejects the `/app` path in the target, tell Claude — he'll switch the
     Activity to its own subdomain (a 2-minute change).

4. **Let yourself launch it while it is unpublished**
   - Dev Portal → your app → **App Testers** (or the Activities test settings) → add **yourself**.
   - This makes it launchable for you before it is submitted for public review.

5. **Launch it in Discord to test**
   - Join a **voice channel** in your server → open the **Activity shelf** (the rocket / controller icon) → pick **Lion Pride TCG**.
   - (Some clients also show it in the `+` / app launcher.)

---

## What "available anywhere like Wordle" needs (later)

Steps 2–5 let **you** run it. To let **any** server run it with no invite, the
app goes through Discord's **App Directory / Activities review** — a quality +
safety check, done once, after the experience is solid. That is the gate to
cross-server reach; it is not needed to build or test.

---

## How it runs (Claude's side, for reference)

- `npm install` then `npm run build` → bundles `src/main.js` + the Embedded App
  SDK into `public/main.bundle.js` (everything served from our own domain, so the
  frame's strict CSP stays simple).
- `npm start` → the backend serves the page and does the token exchange +
  collection lookup.
- Hosted on the same Oracle VM as the gallery, over HTTPS via Caddy.

## Files
- `server.js` — serves the page, `POST /api/token` (OAuth exchange), `GET /api/collection`.
- `src/main.js` — the embedded front-end (SDK handshake → login → render).
- `public/` — the page + bundled script + styles.
- `.env` — secrets (copy from `.env.example`).
