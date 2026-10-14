-- d191_s1_origins_frame.sql (2026-10-14, D-191, Nathan: "yes change it to orange", UI-13 option A): the S1 set reward frame is the
-- Origins set frame 'holo:S1' (the Holo frame in the pack color of S1, label "Origins Frame"), not the plain 'holo'.
-- Change: balance achievement_rewards.badges.s1.frame 'holo' -> 'holo:S1'. Packs (5) and the title ("Origins Champion") do not change.
-- Not changed: a member who claimed s1 before keeps the frame 'holo' (no grant here: a grant to past claimers is Nathan's open question).
-- Not changed: the plain 'holo' frame stays in the game (a member who owns it keeps it, "Rainbow Pride" still pays it).
-- Idempotent: it changes the value only while it is 'holo'. The set_complete rule already pays 'holo:{id}' (d191_set_rewards.sql).
-- Test: card-studio/scripts/test-set-rewards.mjs.
do $c$ begin
  if not exists (select 1 from public.balance where key = 'achievement_rewards' and value #>> '{badges,s1,frame}' in ('holo', 'holo:S1')) then
    raise exception 'd191_s1_origins_frame.sql: balance achievement_rewards badges.s1.frame is not holo (it was changed by hand). Check it first.';
  end if;
end $c$;
update public.balance
   set value = jsonb_set(value, '{badges,s1,frame}', '"holo:S1"')
 where key = 'achievement_rewards' and value #>> '{badges,s1,frame}' = 'holo';
