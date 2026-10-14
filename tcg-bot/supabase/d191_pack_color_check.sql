-- d191_pack_color_check.sql (2026-10-14, D-191, Nathan: "Yes" to "the studio requires a pack color with enough color").
-- The set holo frame is made from card_sets.pack_color (UI-13 set frames). A near-grey color gives a ring with no color, so admin_set_save
-- refuses it. Definition of "enough color" (pack_color_ok): HSL saturation >= 0.35 AND HSL lightness between 0.25 and 0.75.
-- The two live colors pass (S1 #ff8d4d: saturation 1.00, lightness 0.65. S2 #3366cc: saturation 0.60, lightness 0.50).
-- admin_set_save checks it on a create and when the color changes (LP400). Everything else of the function is the live text
-- (set_season_one_set.sql). The studio Sets page checks the same rule before the request (card-studio/public/admin/sets.js).
-- Test: card-studio/scripts/test-pack-color.mjs.

-- GUARD (the combat_core.sql rule): admin_set_save must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.admin_set_save(text,jsonb,jsonb,text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('42f311c772de7d6f63c0679cfddd7583', 'eee35af037d21af6627b3d98a4793cbf') then   -- the live text, or the text this file made
    raise exception 'd191_pack_color_check.sql: the live admin_set_save changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

create or replace function public.pack_color_ok(p_color text) returns boolean
language plpgsql immutable set search_path = public as $f$
declare r numeric; g numeric; b numeric; mx numeric; mn numeric; l numeric; s numeric;
begin
  if p_color is null or p_color !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
  r := ('x' || substr(p_color, 2, 2))::bit(8)::int / 255.0;
  g := ('x' || substr(p_color, 4, 2))::bit(8)::int / 255.0;
  b := ('x' || substr(p_color, 6, 2))::bit(8)::int / 255.0;
  mx := greatest(r, g, b); mn := least(r, g, b);
  l := (mx + mn) / 2;
  if mx = mn then return false; end if;   -- a pure grey has no color
  s := (mx - mn) / (1 - abs(2 * l - 1));
  return s >= 0.35 and l between 0.25 and 0.75;
end $f$;
revoke all on function public.pack_color_ok(text) from public, anon, authenticated;
grant execute on function public.pack_color_ok(text) to service_role;
comment on function public.pack_color_ok(text) is 'True when a #rrggbb pack color has enough color for a set holo frame: HSL saturation >= 0.35 and lightness between 0.25 and 0.75 (D-191). admin_set_save refuses any other color.';

CREATE OR REPLACE FUNCTION public.admin_set_save(p_actor text, p_set jsonb, p_before jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare k text; v_other text; v_id text := p_set->>'id'; v_old card_sets; v_new card_sets; v_create boolean; v_aid bigint;
  editable constant text[] := array['id', 'name', 'code', 'pack_color', 'released_at', 'pullable', 'sort', 'season', 'pack_art_url', 'cover_card_id'];
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then raise exception using errcode = 'LP400', message = 'admin: the actor is required'; end if;
  if p_set is null or jsonb_typeof(p_set) <> 'object' then raise exception using errcode = 'LP400', message = 'admin: the set must be an object'; end if;
  for k in select jsonb_object_keys(p_set) loop
    if not k = any(editable) then raise exception using errcode = 'LP400', message = format('admin: %s cannot be set', k); end if;
  end loop;
  if v_id is null or v_id !~ '^[A-Z0-9]{1,8}$' then
    raise exception using errcode = 'LP400', message = 'admin: the set id is 1 to 8 capital letters or digits (for example S2)';
  end if;
  select * into v_old from card_sets where id = v_id for update;
  v_create := not found;
  if v_create and p_before is not null then perform admin_stale(format('set %s', v_id), null, p_before); end if;
  if not v_create and p_before is null then
    raise exception using errcode = 'LP409', message = format('admin: the set %s exists already. Open it to change it.', v_id);
  end if;
  if not v_create and admin_set_fields(v_old) is distinct from p_before then perform admin_stale(format('set %s', v_id), admin_set_fields(v_old), p_before); end if;
  begin
    if v_create then
      v_new := jsonb_populate_record(null::card_sets, jsonb_build_object('id', v_id, 'pullable', true, 'sort', 0) || p_set);
    else
      v_new := jsonb_populate_record(v_old, p_set);
    end if;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range or invalid_parameter_value then
    raise exception using errcode = 'LP400', message = 'admin: a value has the wrong type: ' || sqlerrm;
  end;
  v_new.name := btrim(v_new.name);
  v_new.code := upper(btrim(v_new.code));
  v_new.pack_color := lower(btrim(v_new.pack_color));
  v_new.pack_art_url := nullif(btrim(v_new.pack_art_url), '');
  if v_new.name is null or length(v_new.name) not between 1 and 60 then raise exception using errcode = 'LP400', message = 'admin: the name is 1 to 60 characters'; end if;
  if v_new.code is null or v_new.code !~ '^[A-Z0-9]{1,8}$' then raise exception using errcode = 'LP400', message = 'admin: the code is 1 to 8 capital letters or digits (for example ORI)'; end if;
  if v_new.pack_color is null or v_new.pack_color !~ '^#[0-9a-f]{6}$' then raise exception using errcode = 'LP400', message = 'admin: the pack color is #rrggbb'; end if;
  -- The set holo frame is made from the pack color (D-191): a near-grey, near-white or near-black color gives a ring with no color. Checked on a
  -- create and on a color change only (an edit of another field of an old set is not blocked).
  if (v_create or v_new.pack_color is distinct from v_old.pack_color) and not public.pack_color_ok(v_new.pack_color) then
    raise exception using errcode = 'LP400', message = 'admin: the pack color needs more color: saturation 35% or more and lightness 25% to 75% (the set frame is made from it)';
  end if;
  if v_new.season is null or v_new.season < 1 then raise exception using errcode = 'LP400', message = 'admin: the season is a whole number of 1 or more'; end if;
  if v_new.pullable is null then v_new.pullable := true; end if;
  if v_new.sort is null then v_new.sort := 0; end if;
  -- https:// only, except http:// to localhost or 127.0.0.1 (the local copy serves storage there: the studio's local test).
  if v_new.pack_art_url is not null and (length(v_new.pack_art_url) > 500
      or v_new.pack_art_url !~ '^(https://[^[:space:]/]+(/[^[:space:]]*)?|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/[^[:space:]]*)$') then
    raise exception using errcode = 'LP400', message = 'admin: the pack art is an https:// address of up to 500 characters (http:// only to localhost or 127.0.0.1)';
  end if;
  if v_new.cover_card_id is not null and not exists (select 1 from cards where id = v_new.cover_card_id and set_id = v_id) then
    raise exception using errcode = 'LP400', message = format('admin: the cover card must be a card of set %s (its home set)', v_id);
  end if;
  if exists (select 1 from card_sets where id <> v_id and name = v_new.name) then raise exception using errcode = 'LP400', message = format('admin: another set has the name %s', v_new.name); end if;
  if exists (select 1 from card_sets where id <> v_id and code = v_new.code) then raise exception using errcode = 'LP400', message = format('admin: another set has the code %s', v_new.code); end if;
  -- One set per season (set_season_one_set.sql): cards_set_rules gives a card with no set_id the ONE set of its season, so a
  -- second set in a season stops every such insert. Checked on a create and on a season change only (a rename keeps its season).
  -- The lock makes two concurrent saves wait for each other, so both cannot take the same free season.
  if v_create or v_new.season is distinct from v_old.season then
    perform pg_advisory_xact_lock(hashtext('card_sets.season'));
    select id into v_other from card_sets where id <> v_id and season = v_new.season order by id limit 1;
    if found then
      raise exception using errcode = 'LP400', message = format('admin: season %s is already used by set %s. Each season has one set (a card with no set gets the set of its season). The next free season is %s.',
        v_new.season, v_other, (select coalesce(max(season), 0) + 1 from card_sets));
    end if;
  end if;
  -- The bot's pack with no set and every reward draw need at least one pullable set.
  if not v_new.pullable and not exists (select 1 from card_sets where id <> v_id and pullable) then
    raise exception using errcode = 'LP400', message = 'admin: this is the last pullable set; packs and rewards need one';
  end if;
  if v_create then
    insert into card_sets (id, name, code, released_at, pullable, sort, pack_color, pack_art_url, season, cover_card_id)
      values (v_id, v_new.name, v_new.code, v_new.released_at, v_new.pullable, v_new.sort, v_new.pack_color, v_new.pack_art_url, v_new.season, v_new.cover_card_id)
      returning * into v_new;
  else
    if admin_set_fields(v_new) = admin_set_fields(v_old) then raise exception using errcode = 'LP400', message = 'admin: nothing changed'; end if;
    update card_sets set name = v_new.name, code = v_new.code, released_at = v_new.released_at, pullable = v_new.pullable, sort = v_new.sort,
                         pack_color = v_new.pack_color, pack_art_url = v_new.pack_art_url, season = v_new.season, cover_card_id = v_new.cover_card_id
     where id = v_id returning * into v_new;
  end if;
  v_aid := admin_log_action(p_actor, case when v_create then 'set_create' else 'set_edit' end, 'card_set', v_id,
    case when v_create then null else admin_set_fields(v_old) end, admin_set_fields(v_new), p_reason, 'studio');
  return jsonb_build_object('action_id', v_aid, 'created', v_create, 'set', admin_set_fields(v_new));
end $function$;

comment on function public.admin_set_save(text, jsonb, jsonb, text) is 'Admin: create a set (p_before null) or edit one (p_before = admin_set_fields as loaded; LP409 when it changed). Checks every field, refuses a season that another set uses (one set per season: cards_set_rules), refuses a pack color with too little color (pack_color_ok), refuses to turn off the last pullable set, logs set_create / set_edit in admin_actions.';

notify pgrst, 'reload schema';
