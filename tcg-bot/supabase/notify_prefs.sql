-- Ping settings (Nathan, 2026-09-29): each member chooses in the Activity (the bell >
-- Settings) whether the bot's channel posts may ping them. Keys: all, plays, trades, raid,
-- packs; false = muted, missing = on. The bot reads it (tcg-bot/src/ping-prefs.ts) and
-- leaves muted members out of allowed_mentions: they are still named, but not pinged.
-- Idempotent.
alter table public.players add column if not exists notify_prefs jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
