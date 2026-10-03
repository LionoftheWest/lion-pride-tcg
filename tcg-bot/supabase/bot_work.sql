-- One small question for the bot timers (Nathan, 2026-10-02: Supabase Log Ingestion 139% of the
-- Free quota). Each REST request is one edge log line. Measured over 24 h (edge logs): the bot
-- timers asked 4 (discord-effects, every 10 s), 1 (effect-notify, 10 s), 1 (hunt-notify, 15 s)
-- and 1 (auction-posts, 60 s) questions with nothing to do, about 47,000 lines a day of the
-- 191,000. bot_work() answers for all of them in one call; a timer runs its full queries only
-- when its part has work (tcg-bot/src/bot-work.ts). Each flag is the SAME filter as the timer's
-- own query, so a timer never skips work that its query would find.
-- card_plays only grows: the unposted check reads a small partial index (hunt_events has one).
create index if not exists card_plays_unposted on public.card_plays (id) where posted_at is null;

create or replace function public.bot_work() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    -- discord-effects.ts tick: 1. pending + due, 2. ping parades, 3. reaction storms, 4. reverts due.
    'fx', exists (select 1 from discord_effects where status = 'pending' and execute_after <= now())
       or exists (select 1 from discord_effects where status = 'active'
                    and (primitive in ('ping_parade', 'reaction_storm') or revert_at <= now())),
    -- effect-notify.ts drain.
    'plays', exists (select 1 from card_plays where posted_at is null),
    -- hunt-notify.ts drain.
    'events', exists (select 1 from hunt_events where posted_at is null),
    -- auction-posts.ts tick.
    'auctions', exists (select 1 from auctions where notice_message_id is null
                          or (status in ('sold', 'closed', 'expired') and notice_dirty)));
$$;
revoke all on function public.bot_work() from public, anon, authenticated;
grant execute on function public.bot_work() to service_role;
