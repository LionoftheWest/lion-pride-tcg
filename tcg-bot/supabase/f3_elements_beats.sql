-- f3_elements_beats.sql (2026-10-14): GET /api/elements also returns the element counter pairs (F-3, UI-38 / UI-39 approval D-189).
-- The element chart of the Activity reads the pairs from the server. The client does not work them out. SQL first, then the UI PR.
--   beats     = the keys of the elements that this element beats  (element_counters, beater = this element, proposal = false)
--   beaten_by = the keys of the elements that beat this element   (element_counters, target = this element, proposal = false)
-- Both lists are in the order of elements.ord and never NULL (an element with no pair has []). A pair that is still a proposal is not returned.
-- This file changes NOTHING in play: no fight reads elements_list. Test: card-studio/scripts/test-elements-beats.mjs (rolled back). Idempotent.

-- GUARD (the combat_core.sql rule): the replaced function must be the live text this file was built from (or the text this file made).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.elements_list()'::regprocedure), chr(13), '')) into strict m;
  if m not in ('311ae868ce14b8cd608e7b55f7701f15', 'cffc595a9a0c6f313b178432c5fccd14') then
    raise exception 'f3_elements_beats.sql: the live elements_list() changed since this file was built (md5 %). Rebuild it from the live text.', m;
  end if;
end $g$;
-- GUARD-END

CREATE OR REPLACE FUNCTION public.elements_list()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'name', e.name, 'ord', e.ord, 'aliases', to_jsonb(e.aliases), 'glyph', e.glyph,
           'color', e.color, 'color2', e.color2, 'weak_to', e.weak_to, 'dungeon_foe', e.dungeon_foe,
           'beats', (select coalesce(jsonb_agg(c.target order by t.ord), '[]'::jsonb)
                       from public.element_counters c join public.elements t on t.key = c.target
                      where c.beater = e.key and not c.proposal),
           'beaten_by', (select coalesce(jsonb_agg(c.beater order by b.ord), '[]'::jsonb)
                           from public.element_counters c join public.elements b on b.key = c.beater
                          where c.target = e.key and not c.proposal)) order by e.ord), '[]'::jsonb) from public.elements e;
$function$;

comment on function public.elements_list() is $doc$[combat] The one list of elements for GET /api/elements: key, name, ord, aliases, glyph, color, color2, weak_to (the primary counter), dungeon_foe, and the approved counter pairs: beats (the keys this element beats) and beaten_by (the keys that beat it), both in the order of elements.ord. A pair with proposal = true is not returned. The client never works the pairs out.$doc$;

notify pgrst, 'reload schema';
