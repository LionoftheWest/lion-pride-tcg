-- Faceted card tags (Phase 1 of the card-tags-and-battle-engine design).
-- See discord/docs/card-tags-and-battle-engine.md.
--
-- Each subject gains a faceted `tags` object and a flat, facet-prefixed
-- `tag_slugs` array (kept in sync by a trigger) for fast membership tests.
-- Raid bosses gain `resist_points` (mirror of `weak_points`) for the
-- weakness/resistance model.

alter table subjects add column if not exists tags jsonb not null default '{}'::jsonb;
alter table subjects add column if not exists tag_slugs text[] not null default '{}';

-- Flatten the faceted tags into a flat, facet-prefixed slug array.
--   {"class":"attacker","origin":["pokemon"],"traits":["fire","beast"]}
--   -> {class:attacker, origin:pokemon, trait:fire, trait:beast}
-- A single-value facet (class, type) contributes one slug; an array facet
-- (origin, genre, realm, traits) contributes one slug per element. The `traits`
-- facet uses the singular prefix `trait` for readability.
create or replace function subjects_flatten_tags() returns trigger
language plpgsql as $$
declare
  v text[] := '{}';
  facet text;
  val jsonb;
  item jsonb;
  prefix text;
begin
  for facet, val in select key, value from jsonb_each(coalesce(new.tags, '{}'::jsonb)) loop
    prefix := case facet when 'traits' then 'trait' else facet end;
    if jsonb_typeof(val) = 'array' then
      for item in select value from jsonb_array_elements(val) loop
        if nullif(trim(item #>> '{}'), '') is not null then
          v := v || (prefix || ':' || lower(trim(item #>> '{}')));
        end if;
      end loop;
    elsif jsonb_typeof(val) = 'string' then
      if nullif(trim(val #>> '{}'), '') is not null then
        v := v || (prefix || ':' || lower(trim(val #>> '{}')));
      end if;
    end if;
  end loop;
  new.tag_slugs := v;
  return new;
end $$;

drop trigger if exists subjects_flatten_tags_trg on subjects;
create trigger subjects_flatten_tags_trg
  before insert or update of tags on subjects
  for each row execute function subjects_flatten_tags();

create index if not exists subjects_tag_slugs_idx on subjects using gin (tag_slugs);

-- Boss resistance: same shape as hunts.weak_points, each entry {kind, value}.
alter table hunts add column if not exists resist_points jsonb not null default '[]'::jsonb;

notify pgrst, 'reload schema';
