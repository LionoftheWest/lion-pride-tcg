-- f3_elements_decisions.sql (2026-10-12): the owner's answers about the element lists (docs/foundations.md F-3 item 1; PR 2 kept every list as it was).
--   1. "Yes add the other 5 as well": the Dungeon foe pool is all 13 elements. air, arcane, psychic, toxic and metal join the pool after the old 8
--      (dungeon_ord 9 to 13). The Hunt has no element counter data (its weak points are tags chosen by spawn_hunt), so the 5 new counters are
--      PROPOSED here and are questions for the owner (air beaten by lightning, arcane by metal, psychic by shadow, toxic by earth, metal by fire).
--      This changes play: dungeon_make_foe picks an element by index over the pool, so the pool of 13 gives other foe elements than the pool of 8.
--   2. "No lets keep it as Shadow": nothing in the game changes for the word "spirit" (it is not an element word here).
--   3. "Agreed": physical is a row of elements (ord 14, the word "physical", the client look: glyph, color #dfe6f2). It has no counter and is not in
--      the Dungeon foe pool (questions for the owner). A card with the trait "physical" now has the element physical, with the lowest priority.
-- Only into the rows that are not set yet: a re-run never undoes an edit. Test: card-studio/scripts/test-elements-passives.mjs.

do $s$
begin
  insert into public.elements (key, name, ord, aliases, glyph, color, color2) values
    ('physical', 'Physical', 14, array['physical'], '💥', '#dfe6f2', '#ffffff')
  on conflict (key) do nothing;
  -- One UPDATE: the checks and the foreign key see the end state.
  update public.elements e set dungeon_foe = true, dungeon_ord = v.o, weak_to = v.w
    from (values ('air', 9, 'lightning'), ('arcane', 10, 'metal'), ('psychic', 11, 'shadow'), ('toxic', 12, 'earth'), ('metal', 13, 'fire')) v(k, o, w)
   where e.key = v.k and not e.dungeon_foe and e.weak_to is null;
end $s$;

comment on table public.elements is $doc$[combat] The one list of elements (f3_elements_passives.sql, F-3): key, name, ord (the priority when a card has several element words), aliases (the trait words that mean the element), glyph, color and color2 (the look), weak_to (the element that beats a Dungeon foe of this element), dungeon_foe and dungeon_ord (the Dungeon foe pool and its draw order: the 13 real elements, not physical). physical (f3_elements_decisions.sql) has the word "physical" and no counter. element_aliases, card_element, element_of and dungeon_make_foe read it. GET /api/elements returns it. A word that another element has is refused. Server only.$doc$;

notify pgrst, 'reload schema';
