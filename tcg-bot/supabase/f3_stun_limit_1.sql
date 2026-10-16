-- f3_stun_limit_1.sql (2026-10-16): F-3 PR 4c, the first commit. Nathan's decision (2026-10-16, "agreed"): a stun lasts 1 round.
-- Before: the stun row of ability_kinds (f3_ability_kinds.sql) allowed duration 1 to 2. Today's fight code always stuns for 1 round
-- (dungeon_support: st = round + 1; hunt_support: the same), and the effect engine (f3_effect_engine.sql) reads rounds = field:duration.
-- After the switch to the engine (PR 4c and 4d) a stun card with duration 2 would stun for 2 rounds. Every live stun card has duration 1.
-- After: the duration limit of the stun row is 1 to 1 (max 1, default 1). The studio refuses a stun with duration 2 (subjects_ability_check).
-- The recheck trigger (ability_kinds_recheck) refuses this change when a live stun ability would fail it, so no live data can break.
-- Data only, no change in play. Idempotent.
update public.ability_kinds
   set fields = jsonb_set(fields, '{duration,max}', '1'::jsonb),
       note = 'The enemy loses its turn for 1 round (duration is always 1: Nathan, 2026-10-16; stun immunity applies). amount is not used (always 0).'
 where key = 'stun' and (fields->'duration'->'max' is distinct from '1'::jsonb or note not like 'The enemy loses its turn for 1 round%');

-- The self-check: the limit is 1 and every live stun ability passes.
do $chk$
declare n int;
begin
  if (select fields->'duration' from public.ability_kinds where key = 'stun') is distinct from '{"type": "integer", "min": 1, "max": 1, "default": 1}'::jsonb then
    raise exception 'f3_stun_limit_1.sql: the stun duration limit is not 1 to 1: %', (select fields->'duration' from public.ability_kinds where key = 'stun');
  end if;
  select count(*) into n from public.subjects where ability->>'effect' = 'stun' and public.ability_check(ability) is not null;
  if n > 0 then raise exception 'f3_stun_limit_1.sql: % live stun abilities fail the check', n; end if;
end $chk$;

notify pgrst, 'reload schema';
