-- achievement_view_old_paid.sql (2026-10-11, D-183). Nathan: "Approve your recommendation".
-- Cause (observed): claim_achievement_tiers pays 0 packs for a tier that ach_tier_paid_before proves (the switch rule: the member's claimed old
-- achievements already paid it; Shards, title and frame are still paid). achievement_view did not say so, so the tracks screen showed the pack amount
-- of every tier (live: 135 of 360 tier claims paid 0 packs while the screen showed 1).
-- Change: achievement_view(text) adds per track the field old_paid = how many tiers (1..old_paid) an old achievement already paid, 0 if none.
-- It is the same proof as ach_tier_paid_before, computed ONCE per track (not 5 calls). Everything else of the function is the live text.
-- Test: card-studio/scripts/test-achievement-old-paid.mjs (the view and claim_achievement_tiers agree).

-- GUARD (the combat_core.sql rule): achievement_view must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.achievement_view(text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('0249f80104a4a598ab003001cfc2f3d5', 'e54ef4b2587a4e289fac6d9fba33fbc0') then   -- the live text, or the text this file made
    raise exception 'achievement_view_old_paid.sql: the live achievement_view changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.achievement_view(p_player text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare vals jsonb; tracks jsonb := '[]'::jsonb; badges jsonb := '[]'::jsonb; t record; b record;
  val bigint; reached int; claimed int; ready int := 0; nxt bigint; old_paid int;
begin
  if not ach_tracks_on(p_player) then return jsonb_build_object('enabled', false); end if;
  vals := ach_track_values(p_player);
  for t in select * from achievement_tracks order by ord loop
    val := coalesce((vals->>t.key)::bigint, 0);
    reached := 0;
    loop
      nxt := ach_tier_need(t.key, reached + 1);
      exit when nxt is null or val < nxt or reached > 2000;
      reached := reached + 1;
    end loop;
    select count(*) into claimed from achievement_claims where player_id = p_player and key like 'track:' || t.key || ':%';
    -- D-183: the tiers 1..old_paid are proved by the claimed old achievements (the switch rule of ach_tier_paid_before): they pay Shards, title and frame, no packs.
    -- One pass: the proof of the track is computed once (the same sum as ach_tier_paid_before); the need rises with the tier, so the tiers are 1..old_paid.
    select count(*) into old_paid from unnest(t.tiers) x(need) where x.need <= (
      select greatest(coalesce(sum(m.proves) filter (where m.adds), 0), coalesce(max(m.proves) filter (where not m.adds), 0))
        from achievement_switch_map m join achievement_claims c on c.key = m.old_key and c.player_id = p_player
       where m.track = t.key);
    -- claimed counts the tiers paid; a tier is never claimed out of order, so reached - claimed is ready
    ready := ready + greatest(reached - claimed, 0);
    tracks := tracks || jsonb_build_object('key', t.key, 'group', t.grp, 'name', t.name, 'value', val,
      'tiers', to_jsonb(t.tiers), 'step', t.step, 'titles', to_jsonb(t.titles),
      'reached', reached, 'claimed', claimed, 'next', nxt, 'old_paid', old_paid);
  end loop;
  for b in select x.*, exists (select 1 from achievement_claims c where c.player_id = p_player and c.key = x.key) done
             from ach_tag_badges(p_player) x loop
    if b.have >= b.need and not b.done then ready := ready + 1; end if;
    badges := badges || jsonb_build_object('key', b.key, 'season', b.season, 'short', b.short, 'tag', b.tag, 'label', b.label,
      'title', b.title, 'need', b.need, 'have', b.have, 'packs', b.packs, 'claimed', b.done);
  end loop;
  return jsonb_build_object('enabled', true, 'tracks', tracks, 'badges', badges, 'ready', ready,
    'retired', (select coalesce(jsonb_agg(old_key), '[]'::jsonb) from achievement_switch_map));
end $function$;;
