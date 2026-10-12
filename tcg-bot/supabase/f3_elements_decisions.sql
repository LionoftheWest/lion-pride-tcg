-- f3_elements_decisions.sql (2026-10-12): the owner's answers about the element lists (docs/foundations.md F-3 item 1; PR 2 kept every list as it was).
--   1. "Yes add the other 5 as well": the Dungeon foe pool is all 13 elements. air, arcane, psychic, toxic and metal join the pool after the old 8
--      (dungeon_ord 9 to 13). The Hunt has no element counter data (its weak points are tags chosen by spawn_hunt), so the 5 new counters were
--      PROPOSED and the owner approved them: air beaten by lightning, arcane by metal, psychic by shadow, toxic by earth, metal by fire.
--      This changes play: dungeon_make_foe picks an element by index over the pool, so the pool of 13 gives other foe elements than the pool of 8.
--   2. "No lets keep it as Shadow": nothing in the game changes for the word "spirit" (it is not an element word here).
--   3. "Agreed": physical is a row of elements (ord 14, the word "physical", the client look: glyph, color #dfe6f2). It is NOT in the Dungeon
--      foe pool. A card with the trait "physical" now has the element physical, with the lowest priority.
--   4. "We should have everything counter each other": element_counters is the full list of who beats whom. Every one of the 14 elements is beaten
--      by at least one element and beats at least one element. elements.weak_to stays the PRIMARY counter (the one weakness that a Dungeon foe
--      gets): it is unchanged for the old 8 and the owner's 5. The 6 new pairs (one of them the counter of physical) change no Dungeon foe and no
--      Hunt fight (nothing reads element_counters yet except the test).
--      Nathan approved the 6 pairs, 2026-10-12 ("I approve the 6 counter pairs"): they are final (proposal = false). The column proposal stays, so
--      that a later pair can be proposed first.
-- Only into the rows that are not set yet: a re-run never undoes an edit. Test: card-studio/scripts/test-elements-decisions.mjs.

do $s$
begin
  insert into public.elements (key, name, ord, aliases, glyph, color, color2) values
    ('physical', 'Physical', 14, array['physical'], '💥', '#dfe6f2', '#ffffff')
  on conflict (key) do nothing;
  -- One UPDATE: the checks and the foreign key see the end state.
  update public.elements e set dungeon_foe = true, dungeon_ord = v.o, weak_to = v.w
    from (values ('air', 9, 'lightning'), ('arcane', 10, 'metal'), ('psychic', 11, 'shadow'), ('toxic', 12, 'earth'), ('metal', 13, 'fire')) v(k, o, w)
   where e.key = v.k and not e.dungeon_foe and e.weak_to is null;
  -- Approved (Nathan, 2026-10-12): physical is beaten by psychic (mind over matter). Not a foe element, so this changes no foe.
  update public.elements set weak_to = 'psychic' where key = 'physical' and weak_to is null;
end $s$;

-- ============================================================ element_counters: who beats whom
create table if not exists public.element_counters (
  beater   text not null references public.elements (key),
  target   text not null references public.elements (key),
  proposal boolean not null default false,
  primary key (beater, target),
  check (beater <> target)
);
alter table public.element_counters enable row level security;
revoke all on public.element_counters from anon, authenticated;

-- A row beater > target is the same as "target is beaten by beater". The first 13 rows are every weak_to of the old 8 and the owner's 5 (approved).
-- The last 6 rows are the pairs that close the gaps (ice, air, arcane, psychic, toxic and physical beat nobody before, and physical was beaten by
-- nobody). Nathan approved them on 2026-10-12, so they are proposal = false too. psychic > physical is also the primary counter of physical (weak_to).
do $s$
begin
  if exists (select 1 from public.element_counters) then return; end if;
  insert into public.element_counters (beater, target, proposal) values
    ('water', 'fire', false), ('lightning', 'water', false), ('earth', 'lightning', false), ('nature', 'earth', false), ('fire', 'nature', false),
    ('fire', 'ice', false), ('light', 'shadow', false), ('shadow', 'light', false),
    ('lightning', 'air', false), ('metal', 'arcane', false), ('shadow', 'psychic', false), ('earth', 'toxic', false), ('fire', 'metal', false),
    ('ice', 'nature', false), ('air', 'toxic', false), ('arcane', 'psychic', false), ('psychic', 'physical', false), ('toxic', 'water', false), ('physical', 'arcane', false);
end $s$;

-- A copy that has the earlier version of this file (the 6 pairs as proposals): the approval of Nathan, 2026-10-12, for exactly these 6 pairs. Any other proposal stays.
update public.element_counters set proposal = false
 where proposal and (beater, target) in (('ice', 'nature'), ('air', 'toxic'), ('arcane', 'psychic'), ('psychic', 'physical'), ('toxic', 'water'), ('physical', 'arcane'));

-- The elements that are beaten by no element, or that beat no element (the rule of the owner: none). Empty when the table is complete.
create or replace function public.element_counter_gaps()
returns table(element text, problem text) language sql stable set search_path = public as $$
  select e.key, 'beaten by no element' from public.elements e where not exists (select 1 from public.element_counters c where c.target = e.key)
  union all
  select e.key, 'beats no element' from public.elements e where not exists (select 1 from public.element_counters c where c.beater = e.key)
  union all
  select e.key, 'the primary counter (weak_to) is not in element_counters' from public.elements e
   where e.weak_to is not null and not exists (select 1 from public.element_counters c where c.target = e.key and c.beater = e.weak_to);
$$;

comment on table public.element_counters is $doc$[combat] The full list of which element beats which (f3_elements_decisions.sql, F-3): one row for each pair beater > target. Every element is beaten by at least one and beats at least one (element_counter_gaps lists any gap). elements.weak_to is the primary counter, the one weakness that a Dungeon foe gets. proposal = true: a pair that the owner has not approved yet (none now: Nathan approved the last 6 on 2026-10-12). Nothing in the fights reads this table yet. Server only.$doc$;
comment on column public.element_counters.beater is 'The element that is strong against the target.';
comment on column public.element_counters.target is 'The element that is beaten.';
comment on column public.element_counters.proposal is 'True while the owner has not approved the pair.';
comment on function public.element_counter_gaps() is 'F-3: the elements that are beaten by no element, beat no element, or whose primary counter (weak_to) is missing from element_counters. Empty when complete.';

comment on table public.elements is $doc$[combat] The one list of elements (f3_elements_passives.sql, F-3): key, name, ord (the priority when a card has several element words), aliases (the trait words that mean the element), glyph, color and color2 (the look), weak_to (the primary counter: the element that beats a Dungeon foe of this element), dungeon_foe and dungeon_ord (the Dungeon foe pool and its draw order: the 13 real elements, not physical). physical (f3_elements_decisions.sql) has the word "physical" and is not a foe. element_counters has every pair. element_aliases, card_element, element_of and dungeon_make_foe read it. GET /api/elements returns it. A word that another element has is refused. Server only.$doc$;

notify pgrst, 'reload schema';
