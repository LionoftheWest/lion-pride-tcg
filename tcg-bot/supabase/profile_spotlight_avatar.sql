-- Player profile fields for the v2 Home (Nathan, 2026-09-27):
-- * spotlight: up to 3 card ids the player shows on their profile (the "Spotlight").
--   Empty = the Activity shows the 3 strongest owned cards.
-- * avatar: the Discord avatar hash, saved at login. The Activity serves the picture
--   through its own /api/avatar/:id route (Discord blocks unmapped fetches).
-- Additive only. The service role writes both; RLS stays on, anon has no grant.

alter table players add column if not exists spotlight bigint[] not null default '{}';
alter table players add column if not exists avatar text;

alter table players drop constraint if exists players_spotlight_max3;
alter table players add constraint players_spotlight_max3 check (coalesce(array_length(spotlight, 1), 0) <= 3);

notify pgrst, 'reload schema';
