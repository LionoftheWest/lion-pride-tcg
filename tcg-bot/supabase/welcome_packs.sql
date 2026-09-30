-- Welcome packs (Nathan, 2026-09-30): a NEW member gets a free gift of packs the first
-- time they interact (chat, a command, a gift, or opening the Activity: every path
-- inserts their players row). An AFTER INSERT trigger, so an upsert of an existing
-- member (ON CONFLICT) never grants again. Only real Discord ids (17-20 digits): the
-- test players ('tst_...') get nothing. settings.welcome_packs = the amount, 0 = off.
insert into public.settings (key, value) values ('welcome_packs', '10'::jsonb)
on conflict (key) do nothing;

create or replace function public.welcome_packs() returns trigger
language plpgsql set search_path = public as $$
declare n int;
begin
  if new.id !~ '^[0-9]{17,20}$' then return new; end if;
  select case when jsonb_typeof(value) = 'number' then (value)::int else 0 end into n
    from settings where key = 'welcome_packs';
  if coalesce(n, 0) <= 0 then return new; end if;
  perform grant_packs(new.id, n, 'welcome', null);
  insert into notifications (player_id, kind, message)
    values (new.id, 'pack_gift', format('🎁 Welcome to Lion Pride TCG! Here are %s free packs to start your collection.', n));
  return new;
end $$;
revoke all on function public.welcome_packs() from public, anon, authenticated;

drop trigger if exists players_welcome_packs on public.players;
create trigger players_welcome_packs after insert on public.players
  for each row execute function public.welcome_packs();

notify pgrst, 'reload schema';
