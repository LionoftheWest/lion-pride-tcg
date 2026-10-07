-- UI-13 decisions (Nathan, 2026-10-06), the data part:
--   D-77: the Hunter track's first title is "Hunter", not "Raider" (glossary: no "Raid").
--   D-74: the tier names are Bronze, Silver, Platinum, Diamond, Obsidian (the balance note says so; the frame ids
--         'diamond:<track>' / 'mythic:<track>' stay as internal keys).
-- The tracks are OFF (settings.achievement_tracks), so no member holds a tier title yet. Idempotent.
do $g$ begin
  if to_regclass('public.achievement_tracks') is null then raise exception 'apply achievement_tracks.sql first'; end if;
end $g$;

update public.achievement_tracks set titles[1] = 'Hunter' where key = 'raider' and titles[1] = 'Raider';

update public.balance set note = 'Achievement tracks (achievement_tracks.sql): tiers = Bronze, Silver, Platinum, Diamond, Obsidian (D-74; packs + Shards each; Platinum adds a title, Diamond and Obsidian a title + a frame); step = each Obsidian +N tier; tag_badge = ceil(cards / cards_per_pack) + extra_packs packs.'
  where key = 'achievement_rewards';

notify pgrst, 'reload schema';
