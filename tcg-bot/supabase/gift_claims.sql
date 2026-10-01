-- Every gift of packs is REDEEMED in the bell (Nathan, 2026-10-01): "even gifting packs or
-- promos, they get the notification and in the notification it has the redeem button to
-- actually get the packs and then it's added to their Open balance".
-- gift_claims: a gift waits until the member presses Redeem (claim_gift); only then are the
-- packs added, with the gift's ledger reason (all outside packs: never counted toward the 5).
--   new_player   "New Player Bonus" (the welcome trigger), once per member
--   launch_day   "Launch Day commemoration gift" (/grantall everyone:true), once per member
--   member_gift  "Gift from <member>" (gift_packs: /gift and the Activity gift)
--   promo        an admin gift or event drop (/givepacks, /grantall) - give_gift / give_gift_all
-- Raid rewards, achievements, the tutorial pack and refunds stay direct.
create table if not exists public.gift_claims (
  id         bigint generated always as identity primary key,
  player_id  text not null references public.players(id) on delete cascade,
  kind       text not null,
  title      text not null,
  amount     int  not null check (amount between 1 and 999),
  reason     text not null default 'gift_received',
  from_id    text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);
create unique index if not exists gift_claims_once on public.gift_claims (player_id, kind) where kind in ('new_player', 'launch_day');
create index if not exists gift_claims_open on public.gift_claims (player_id) where claimed_at is null;
alter table public.gift_claims enable row level security;

-- Put a gift in the bell. The once-only kinds never repeat. Returns the gift id (null = had it).
create or replace function public.give_gift(p_player text, p_kind text, p_title text, p_amount int, p_reason text, p_from text default null)
returns bigint language plpgsql set search_path = public as $$
declare g bigint;
begin
  if p_amount is null or p_amount < 1 then return null; end if;
  insert into gift_claims (player_id, kind, title, amount, reason, from_id)
    values (p_player, p_kind, left(coalesce(nullif(trim(p_title), ''), 'A gift'), 80), p_amount, coalesce(p_reason, 'gift_received'), p_from)
    on conflict do nothing returning id into g;
  return g;
end $$;

create or replace function public.give_gift_all(p_kind text, p_title text, p_amount int, p_reason text, p_by text default null)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  if p_amount is null or p_amount < 1 then return 0; end if;
  insert into gift_claims (player_id, kind, title, amount, reason, from_id)
    select id, p_kind, left(coalesce(nullif(trim(p_title), ''), 'A gift'), 80), p_amount, coalesce(p_reason, 'event'), p_by from players
    on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.claim_gift(p_player text, p_id bigint) returns jsonb
language plpgsql set search_path = public as $$
declare g gift_claims; bal int;
begin
  select * into g from gift_claims where id = p_id and player_id = p_player for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if g.claimed_at is not null then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  update gift_claims set claimed_at = now() where id = p_id;
  bal := grant_packs(p_player, g.amount, g.reason, g.from_id);
  return jsonb_build_object('ok', true, 'packs', g.amount, 'title', g.title, 'balance', bal);
end $$;

-- A member's gift: taken from the sender now, waits in the recipient's bell.
create or replace function public.gift_packs(p_from text, p_to text, p_amount integer) returns boolean
language plpgsql set search_path = public as $$
declare moved boolean := false;
begin
  if p_amount is null or p_amount < 1 or p_from = p_to then return false; end if;
  perform 1 from players where id = p_to;
  if not found then return false; end if;
  update players set pack_balance = pack_balance - p_amount
    where id = p_from and pack_balance >= p_amount returning true into moved;
  if moved is not true then return false; end if; -- NULL when the sender has too few (gift_packs_fix.sql)
  insert into pack_ledger (player_id, amount, reason, granted_by) values (p_from, -p_amount, 'gift_sent', p_to);
  perform give_gift(p_to, 'member_gift', 'Gift from ' || coalesce((select username from players where id = p_from), 'a member'), p_amount, 'gift_received', p_from);
  return true;
end $$;

-- A new member: the New Player Bonus waits in the bell.
create or replace function public.welcome_packs() returns trigger
language plpgsql set search_path = public as $$
declare n int;
begin
  if new.id !~ '^[0-9]{17,20}$' then return new; end if;
  if coalesce(current_setting('tcg.skip_welcome', true), '') = 'on' then return new; end if;
  select case when jsonb_typeof(value) = 'number' then (value)::int else 0 end into n from settings where key = 'welcome_packs';
  if coalesce(n, 0) <= 0 then return new; end if;
  perform give_gift(new.id, 'new_player', 'New Player Bonus', n, 'welcome', null);
  return new;
end $$;

-- /grantall everyone:true: a Launch Day gift waits for each member (never twice).
create or replace function public.gift_all_members(p_members jsonb, p_amount int, p_by text) returns jsonb
language plpgsql set search_path = public as $$
declare m record; created int := 0; gifted int := 0; skipped int := 0; total int := 0;
begin
  if p_amount is null or p_amount < 1 or p_amount > 100 then return jsonb_build_object('ok', false, 'error', 'bad_amount'); end if;
  if jsonb_typeof(p_members) <> 'array' then return jsonb_build_object('ok', false, 'error', 'bad_members'); end if;
  for m in select distinct on (x->>'id') x->>'id' id, left(coalesce(x->>'username', 'player'), 64) username, x->>'avatar' avatar
           from jsonb_array_elements(p_members) x where (x->>'id') ~ '^[0-9]{17,20}$' loop
    total := total + 1;
    insert into players (id, username, avatar) values (m.id, m.username, m.avatar) on conflict (id) do nothing;
    if found then created := created + 1; end if;
    if give_gift(m.id, 'launch_day', 'Launch Day commemoration gift', p_amount, 'launch_gift', p_by) is not null then gifted := gifted + 1; else skipped := skipped + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'members', total, 'created', created, 'gifted', gifted, 'skipped', skipped);
end $$;

revoke all on function public.give_gift(text, text, text, int, text, text), public.give_gift_all(text, text, int, text, text),
  public.claim_gift(text, bigint) from public, anon, authenticated;

-- Today's direct grants (2026-10-01, nobody had used them) become the two gifts to redeem.
do $do$
begin
  if exists (select 1 from pack_ledger where reason not in ('welcome', 'launch_gift'))
     or exists (select 1 from players p where pack_balance <> (select coalesce(sum(amount), 0) from pack_ledger l where l.player_id = p.id)) then
    raise exception 'a member already used packs: convert by hand';
  end if;
  insert into gift_claims (player_id, kind, title, amount, reason, created_at)
    select player_id, 'new_player', 'New Player Bonus', amount, 'welcome', created_at from pack_ledger where reason = 'welcome' on conflict do nothing;
  insert into gift_claims (player_id, kind, title, amount, reason, from_id, created_at)
    select player_id, 'launch_day', 'Launch Day commemoration gift', amount, 'launch_gift', granted_by, created_at from pack_ledger where reason = 'launch_gift' on conflict do nothing;
  update players p set pack_balance = pack_balance - coalesce((select sum(amount) from pack_ledger l where l.player_id = p.id and l.reason in ('welcome', 'launch_gift')), 0);
  delete from pack_ledger where reason in ('welcome', 'launch_gift');
  delete from notifications where kind = 'pack_gift' and (message like '🎁 Welcome to Lion Pride TCG!%' or message like '🎁 Launch day gift!%');
end $do$;

notify pgrst, 'reload schema';
