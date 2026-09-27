-- First-pack @mention (2026-09-27). 26 members earned 160 packs but never opened
-- one, and read 0 of 138 bell notifications: the in-app bell never reaches a member
-- who has not opened the Activity. So the bot @mentions each member ONCE, in the
-- public notifications channel, the next time they earn a pack.
-- Nathan's rule stays: no per-pack posts (they flood the channel). This fires once
-- per member, ever.

alter table players add column if not exists first_pack_ping_at timestamptz;

-- Atomic claim: true only for the first caller for this player. Two messages that
-- earn at the same moment cannot both post.
create or replace function claim_first_pack_ping(p_player text)
returns boolean language sql security invoker set search_path = public as $$
  with claimed as (
    update players set first_pack_ping_at = now()
     where id = p_player and first_pack_ping_at is null
    returning 1
  )
  select exists (select 1 from claimed);
$$;
