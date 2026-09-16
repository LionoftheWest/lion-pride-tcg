-- TCG Bot schema for Supabase (Postgres).
--
-- Run this in your PERSONAL Supabase project, in the SQL Editor.
-- Do NOT run it against any R3VCORE project (staging or prod).
--
-- After you run it, open the Supabase Advisors (Security) and confirm there are
-- no new warnings. RLS is intentional here — see the note at the bottom.

-- Enums -----------------------------------------------------------------------
create type card_rarity as enum (
  'normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'
);

create type card_source as enum (
  'draw', 'achievement', 'event', 'promo'
);

create type submission_status as enum (
  'pending', 'approved', 'rejected'
);

-- Subjects: the person, joke, game, or event a set of cards shows. -------------
create table subjects (
  id          bigint generated always as identity primary key,
  key         text not null unique,          -- stable slug, for example "ember-fox"
  name        text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- Cards: one collectible finish. Each rarity finish is its own row. ------------
create table cards (
  id            bigint generated always as identity primary key,
  subject_id    bigint not null references subjects (id) on delete cascade,
  name          text not null,
  rarity        card_rarity not null,
  source        card_source not null default 'draw',
  image_url     text,
  artist_credit text,
  lore          text,
  in_draw_pool  boolean not null default true,
  created_at    timestamptz not null default now()
);
-- Speeds up "pick a random card of rarity X that is in the draw pool".
create index cards_pool_rarity_idx on cards (rarity) where in_draw_pool;

-- Players: a Discord member. --------------------------------------------------
create table players (
  id         text primary key,               -- the Discord user id
  username   text not null,
  created_at timestamptz not null default now()
);

-- Ownership: which cards a player holds, and how many. ------------------------
create table player_cards (
  player_id         text not null references players (id) on delete cascade,
  card_id           bigint not null references cards (id) on delete cascade,
  quantity          integer not null default 1 check (quantity > 0),
  first_obtained_at timestamptz not null default now(),
  primary key (player_id, card_id)
);

-- Daily activity: one row per member per day. It controls the packs. ----------
create table daily_activity (
  player_id     text not null references players (id) on delete cascade,
  activity_date date not null,               -- the UTC day
  message_count integer not null default 0,
  base_claimed  boolean not null default false,
  bonus_claimed boolean not null default false,
  primary key (player_id, activity_date)
);

-- Artist submissions: proposed cards awaiting an admin decision. --------------
create table artist_submissions (
  id              bigint generated always as identity primary key,
  submitted_by    text not null,             -- the Discord user id of the artist
  subject_name    text not null,
  proposed_rarity card_rarity not null default 'normal',
  image_url       text,
  artist_credit   text not null,
  lore            text,
  status          submission_status not null default 'pending',
  reviewed_by     text,
  created_at      timestamptz not null default now()
);

-- Row Level Security ----------------------------------------------------------
-- The bot connects with the service_role key, which BYPASSES RLS. So enabling
-- RLS does not block the bot. We add PUBLIC READ only on the catalog tables
-- (subjects, cards), ready for a future web showcase that reads with the anon
-- key. The player tables stay closed to anon on purpose — the bot is the only
-- reader until the web UI adds Discord-authenticated policies. This is a
-- deliberate "RLS on, bot-only" state, not the "RLS on with no policy by
-- accident" trap.

alter table subjects           enable row level security;
alter table cards              enable row level security;
alter table players            enable row level security;
alter table player_cards       enable row level security;
alter table daily_activity     enable row level security;
alter table artist_submissions enable row level security;

create policy "public read subjects" on subjects for select using (true);
create policy "public read cards"     on cards    for select using (true);

-- Atomic helpers --------------------------------------------------------------
-- The bot calls these with rpc(). They keep concurrent updates correct without
-- a read-then-write race.

-- Add one copy of a card to a player. Raise the count if the player owns it.
create or replace function add_card_to_player(p_player_id text, p_card_id bigint)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into player_cards (player_id, card_id, quantity)
  values (p_player_id, p_card_id, 1)
  on conflict (player_id, card_id)
  do update set quantity = player_cards.quantity + 1;
$$;

-- Raise a member's message count for a day. Create the day row if it is absent.
-- The player row must already exist (the bot upserts it first).
create or replace function record_activity(p_player_id text, p_date date)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into daily_activity (player_id, activity_date, message_count)
  values (p_player_id, p_date, 1)
  on conflict (player_id, activity_date)
  do update set message_count = daily_activity.message_count + 1;
$$;
