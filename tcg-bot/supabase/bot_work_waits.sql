-- bot_work(): rows that only WAIT for the member are not work (Nathan, 2026-10-03). After bot_work.sql
-- the bot still asked 4 questions every 10 s for 13 hours (16,787 discord_effects requests in 12 h):
-- a pending name color waits up to 24 h for the target's pick, and bot_work() called it due. The bot
-- (discord-effects.ts) leaves these rows alone until something changes:
-- - color_role, pending: it acts when options.color is one of the 8 colors (the pick, an Activity
--   write) or when the row is 24 h old (then gold; colorFor()).
-- - vc_mute / vc_deafen, pending: they act when the target joins voice (the VoiceStateUpdate event
--   runs the tick itself, with no bot_work() check) or after 1 h (skipped: never in voice).
-- - vc_mute / vc_deafen, active, revert due, error 'waiting_for_voice': the undo is retried when the
--   target joins voice (the same event).
-- Everything else is the same filter as bot_work.sql.
create or replace function public.bot_work() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fx', exists (
        select 1 from discord_effects e where e.status = 'pending' and e.execute_after <= now()
          and not (e.primitive = 'color_role' and e.created_at > now() - interval '24 hours'
                   and upper(coalesce(e.options->>'color', '')) not in
                     ('#F4B73C', '#FF5A5A', '#FF9A3C', '#5BE38A', '#4FD6F0', '#5B8CFF', '#B45AD8', '#FF7AC8'))
          and not (e.primitive in ('vc_mute', 'vc_deafen') and e.created_at > now() - interval '1 hour'))
       or exists (select 1 from discord_effects e where e.status = 'active'
                    and (e.primitive in ('ping_parade', 'reaction_storm')
                         or (e.revert_at <= now()
                             -- coalesce: a NULL error would make the whole test NULL (= no work)
                             and not (e.primitive in ('vc_mute', 'vc_deafen') and coalesce(e.error, '') = 'waiting_for_voice')))),
    'plays', exists (select 1 from card_plays where posted_at is null),
    'events', exists (select 1 from hunt_events where posted_at is null),
    'auctions', exists (select 1 from auctions where notice_message_id is null
                          or (status in ('sold', 'closed', 'expired') and notice_dirty)));
$$;
revoke all on function public.bot_work() from public, anon, authenticated;
grant execute on function public.bot_work() to service_role;
