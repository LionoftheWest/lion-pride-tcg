-- The server-wide start gift (Nathan, 2026-09-30): when Nathan runs
-- /grantall everyone:true, EVERY human member of the Discord server gets the packs,
-- also members who never played (their players row is created here). Each member gets
-- exactly ONE start gift: a member who already has a 'welcome' or 'launch_gift' ledger
-- row is skipped, so a member who joined earlier, or a second run, never doubles it.
-- The rows created here skip the welcome trigger (tcg.skip_welcome), so the gift is the
-- only grant. No Discord post: one bell note each, in the Activity.

create or replace function public.welcome_packs() returns trigger
language plpgsql set search_path = public as $$
declare n int;
begin
  if new.id !~ '^[0-9]{17,20}$' then return new; end if;
  if coalesce(current_setting('tcg.skip_welcome', true), '') = 'on' then return new; end if;
  select case when jsonb_typeof(value) = 'number' then (value)::int else 0 end into n
    from settings where key = 'welcome_packs';
  if coalesce(n, 0) <= 0 then return new; end if;
  perform grant_packs(new.id, n, 'welcome', null);
  insert into notifications (player_id, kind, message)
    values (new.id, 'pack_gift', format('🎁 Welcome to Lion Pride TCG! Here are %s free packs to start your collection.', n));
  return new;
end $$;

-- p_members: [{"id": "...", "username": "...", "avatar": "..."}] from the guild member list.
create or replace function public.gift_all_members(p_members jsonb, p_amount int, p_by text) returns jsonb
language plpgsql set search_path = public as $$
declare m record; created int := 0; gifted int := 0; skipped int := 0; total int := 0;
begin
  if p_amount is null or p_amount < 1 or p_amount > 100 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if jsonb_typeof(p_members) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_members'); end if;
  perform set_config('tcg.skip_welcome', 'on', true);
  for m in select distinct on (x->>'id') x->>'id' id, left(coalesce(x->>'username', 'player'), 64) username, x->>'avatar' avatar
           from jsonb_array_elements(p_members) x where (x->>'id') ~ '^[0-9]{17,20}$' loop
    total := total + 1;
    insert into players (id, username, avatar) values (m.id, m.username, m.avatar) on conflict (id) do nothing;
    if found then created := created + 1; end if;
    if exists (select 1 from pack_ledger where player_id = m.id and reason in ('welcome', 'launch_gift')) then
      skipped := skipped + 1;
    else
      perform grant_packs(m.id, p_amount, 'launch_gift', p_by);
      insert into notifications (player_id, kind, message)
        values (m.id, 'pack_gift', format('🎁 Launch gift! Here are %s free packs to start your collection.', p_amount));
      gifted := gifted + 1;
    end if;
  end loop;
  perform set_config('tcg.skip_welcome', '', true);
  return jsonb_build_object('ok', true, 'members', total, 'created', created, 'gifted', gifted, 'skipped', skipped);
end $$;
revoke all on function public.gift_all_members(jsonb, int, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
