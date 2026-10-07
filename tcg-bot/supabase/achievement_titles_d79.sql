-- D-79 (Nathan, 2026-10-07): three track titles used glossary words that are not allowed ("dupe", "Titan").
--   Recycler:     Dupe Smelter  -> Copy Smelter
--   Heavy Hitter: Titan Breaker -> Boss Wrecker   ("Boss Breaker" is an old achievement title: not reused)
--   Boss Slayer:  Titan Slayer  -> Giant Slayer
-- The tracks are OFF (settings.achievement_tracks), so no member holds these titles. Idempotent.
-- achievement_tracks.sql has the same names, so a rerun of it keeps them.
do $g$ begin
  if to_regclass('public.achievement_tracks') is null then raise exception 'apply achievement_tracks.sql first'; end if;
end $g$;

update public.achievement_tracks set titles[2] = 'Copy Smelter'  where key = 'recycler' and titles[2] = 'Dupe Smelter';
update public.achievement_tracks set titles[3] = 'Boss Wrecker'  where key = 'heavy'    and titles[3] = 'Titan Breaker';
update public.achievement_tracks set titles[2] = 'Giant Slayer'  where key = 'slayer'   and titles[2] = 'Titan Slayer';

notify pgrst, 'reload schema';
