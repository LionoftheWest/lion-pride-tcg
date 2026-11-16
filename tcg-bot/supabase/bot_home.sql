-- NO-SERVER P0b (option B, Nathan 2026-11-06): the bot's home host is one settings row.
-- settings.bot_home = "backup" | "office". A bot deploy (ops/deploy.sh) reads bot_home_state() and runs only on the host
-- that the row names. Under option B the backup VM is the bot's home, so the row starts as "backup".
-- Only card-studio/scripts/bot-home.mjs changes the row (with Nathan's GO): it sets the session setting
-- lptcg.bot_home_writer = 'bot-home.mjs' in the same transaction. The trigger refuses every other write (the Admin
-- settings editor, admin_setting_set and admin_undo, a raw update), so the row cannot move by accident.
-- The trigger also sets updated_at = clock_timestamp() on each write (the age is in DB time, and a write inside a long
-- transaction still gets the time of the write). A manual write is one autocommit statement.
-- Idempotent: a re-run changes nothing (the insert is "on conflict do nothing").

create or replace function public.settings_bot_home_check() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (tg_op <> 'INSERT' and old.key = 'bot_home') or (tg_op <> 'DELETE' and new.key = 'bot_home') then
    if coalesce(current_setting('lptcg.bot_home_writer', true), '') <> 'bot-home.mjs' then
      raise exception using errcode = 'LP403',
        message = 'bot_home: only card-studio/scripts/bot-home.mjs changes this row (NO-SERVER 4.5, Nathan''s GO)';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.key = 'bot_home' then
    if new.value is null or jsonb_typeof(new.value) <> 'string' or (new.value #>> '{}') not in ('backup', 'office') then
      raise exception using errcode = 'LP400', message = format('bot_home: the value must be "backup" or "office" (got %s)', new.value);
    end if;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end $$;
revoke all on function public.settings_bot_home_check() from public, anon, authenticated;

drop trigger if exists settings_bot_home_check on public.settings;
create trigger settings_bot_home_check before insert or update or delete on public.settings
  for each row execute function public.settings_bot_home_check();

-- The row. The migration is the writer here, so it sets the writer setting for this transaction only.
select set_config('lptcg.bot_home_writer', 'bot-home.mjs', true);
insert into public.settings (key, value) values ('bot_home', '"backup"'::jsonb)
on conflict (key) do nothing;
select set_config('lptcg.bot_home_writer', '', true);

-- {home, age_s}: the host that the row names and the seconds since the last write, both in DB time.
-- null when the row is missing (a reader treats null as "unreadable" and stops).
create or replace function public.bot_home_state() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('home', value #>> '{}',
                            'age_s', floor(extract(epoch from clock_timestamp() - updated_at))::bigint)
  from settings where key = 'bot_home'
$$;
revoke all on function public.bot_home_state() from public, anon, authenticated;
grant execute on function public.bot_home_state() to service_role;

comment on function public.settings_bot_home_check() is
  'NO-SERVER: the guard of settings.bot_home. Refuses a write unless lptcg.bot_home_writer = bot-home.mjs (only card-studio/scripts/bot-home.mjs sets it), refuses a value other than "backup"/"office", and sets updated_at = clock_timestamp().';
comment on function public.bot_home_state() is
  'NO-SERVER: {home, age_s} of settings.bot_home in DB time (null when the row is missing). ops/deploy.sh reads it before a bot deploy and deploys only to the host that it names. service_role only.';

notify pgrst, 'reload schema';
