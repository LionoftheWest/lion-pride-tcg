# TCG Bot

A Discord bot for a community Trading Card Game. TypeScript + [discord.js](https://discord.js.org) v14.

## What is here now (Phase 1 — the daily-draw spine)

- A command loader that picks up every file in `src/commands/`.
- `/ping` — a health check.
- `/open` — opens the pack or packs you earned today. A pack is 5 cards.
- `/collection [member]` — a member's collection summary by rarity.
- `/card <name>` — shows a card from the catalog, with name autocomplete.
- `/seed …` — admin only. Adds a card, so a draw has cards to pull.
- Passive activity tracking. The bot counts each member's messages per day.

The design and the economy live in `docs/DESIGN.md`. The build plan and the
tested acceptance criteria live in `docs/BUILD_PLAN.md`. The pull-rate math is
tested in `src/draw.test.ts` — run `npm test`.

## Data

The card catalog and the collections live in your **personal** Supabase project.
Run `supabase/schema.sql` in that project before you start the bot. It must never
run against an R3VCORE project.

## First-time setup

1. Create the bot application:
   - Open the [Discord Developer Portal](https://discord.com/developers/applications) and select **New Application**.
   - Open **Bot** and select **Reset Token**. Copy the token.
   - Open **General Information**. Copy the **Application ID**.
2. Get your server ID:
   - In Discord, open **Settings -> Advanced** and turn on **Developer Mode**.
   - Right-click your server icon and select **Copy Server ID**.
3. Prepare Supabase:
   - Create a new project in your **personal** Supabase account.
   - Open the **SQL Editor** and run the whole of `supabase/schema.sql`.
   - Open **Advisors -> Security** and confirm there are no new warnings.
   - Copy the **Project URL** and the **service_role** key from Project Settings.
4. Configure the project:
   ```sh
   cp .env.example .env
   ```
   Fill `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`, `SUPABASE_URL`,
   and `SUPABASE_SERVICE_ROLE_KEY` in `.env`.
5. Install and register:
   ```sh
   npm install
   npm run deploy
   ```
6. Invite the bot to your server. Open **OAuth2 -> URL Generator**, select the
   `bot` and `applications.commands` scopes, open the generated URL, and add the
   bot to your server.
7. Seed a few cards so a pack has something to pull. In Discord, run `/seed` a
   few times (you need the Manage Server permission). Add at least one Normal
   card.

## Run

```sh
npm run dev      # watch mode for development
npm run build    # compile to dist/
npm start        # run the compiled build
```

Run `npm run deploy` again any time you add a command or change its name,
description, or options.

## Next steps (Phase 2 and later)

- Artist submissions: a `/submit` command and an admin review flow.
- Event promos: an admin `/grant` command for event winners.
- The web showcase, reading the same Supabase data with the anon key.
- Achievement cards, once Discord achievements exist (blocked for now).
