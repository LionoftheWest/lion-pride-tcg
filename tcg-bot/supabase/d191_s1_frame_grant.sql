-- D-191 option A (Nathan, 2026-10-14: "Yes give them the new origins frame"): every member who claimed "Origins Set
-- Complete" (key s1) before its reward became the Origins Frame (d191_s1_origins_frame.sql) also gets the Origins Frame
-- (holo:S1). They keep the plain Holo frame they already own.
-- The frame is owned through an achievement_claims row (the equip check of /api/cosmetics reads claim rows), key 's1:frame'.
-- That key matches no achievement, so no member gets an extra achievement; only the admin claim count shows the row.
-- Idempotent: a second run inserts nothing.
insert into public.achievement_claims (player_id, key, packs, title, frame)
select c.player_id, 's1:frame', 0, null, 'holo:S1'
  from public.achievement_claims c
 where c.key = 's1' and c.frame is distinct from 'holo:S1'
on conflict (player_id, key) do nothing;

do $$
declare v_missing int;
begin
  select count(*) into v_missing
    from public.achievement_claims c
   where c.key = 's1'
     and not exists (select 1 from public.achievement_claims f where f.player_id = c.player_id and f.frame = 'holo:S1');
  if v_missing > 0 then raise exception 'd191_s1_frame_grant: % s1 claimers still have no Origins Frame', v_missing; end if;
end $$;
