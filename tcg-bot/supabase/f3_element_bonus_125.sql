-- Nathan's pick (2026-10-14): the element bonus is 1.25, no penalty. Chosen from the options of scripts/element-bonus-balance.mjs
-- (bonus 1.0, 1.15, 1.25, 1.5, penalty 0.85). Needs f3_element_bonus.sql first (the keys and their limits).
-- A data change only: balance combat.element_bonus 1 -> 1.25. element_penalty stays 1 (no penalty). balance_log records it with "by" = nathan.
select set_config('balance.by', 'nathan', true);
update public.balance
   set value = value || '{"element_bonus": 1.25}'::jsonb
 where key = 'combat';

do $$
declare v jsonb;
begin
  select value into v from public.balance where key = 'combat';
  if (v->>'element_bonus')::numeric <> 1.25 or (v->>'element_penalty')::numeric <> 1 then
    raise exception 'f3_element_bonus_125: balance.combat is not bonus 1.25 and penalty 1: % / %', v->>'element_bonus', v->>'element_penalty';
  end if;
  if not exists (select 1 from public.balance_log where key = 'combat' and (new_value->>'element_bonus')::numeric = 1.25 and changed_by = 'nathan') then
    raise exception 'f3_element_bonus_125: balance_log has no row for the change (by nathan)';
  end if;
end $$;
