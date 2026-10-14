-- d191_set_rewards.sql (2026-10-12, D-191 and D-192, Nathan): the reward of a "<set name> Set Complete" achievement is one RULE in balance,
-- so a new set needs no new row.
--   D-191: each set achievement pays like S1: 5 packs, a title and the set's OWN holo frame (themed on the pack color).
--   D-192: the title is "<set name> Champion". "Season 1 Champion" becomes "Origins Champion"; a member who earned or equipped the old title keeps it.
-- Change:
--   * balance achievement_rewards gets the key set_complete: { packs, title, frame } where the text may hold {name} (card_sets.name) and {id}
--     (card_sets.id). Today: packs 5, title "{name} Champion", frame "holo:{id}".
--   * claim_achievement: a key 'set:<id>' that has no row of its own in badges is paid by the rule (the set must exist and be pullable).
--     A row 'set:<id>' in badges still wins (a hand-made exception). Every other key works as before; 's1' keeps its row (badges.s1).
--   * badges.s1: the title text is "Origins Champion" (the frame 'holo' and the 5 packs are unchanged: the S1 frame is not changed here).
--   * the old title text in players.title (equipped) and achievement_claims.title (earned) is renamed. A title is stored as TEXT, not as a key,
--     in both tables (and in the log profile_log, which keeps the history as it was).
-- Frame visual: the set frame keys ('holo:<id>') have NO design yet. The Activity draws any 'holo:<id>' with the existing holo look
-- (tcg-activity/src/achievements.js frameBase), so nothing breaks until the design is approved.
-- Test: card-studio/scripts/test-set-rewards.mjs.

-- GUARD (the f2_set_not_season.sql rule): this file replaces the live function below. It runs only on the live text it was built from
-- (the first md5) or on its own result (the second md5).
do $g$
declare m text;
begin
  select md5(replace(pg_get_functiondef('public.claim_achievement(text, text, integer, text, text)'::regprocedure), chr(13), '')) into strict m;
  if m not in ('34f4be6488a0d45577e2745381e41f11', '88eb42003eca69f69de182e90ddca8b6') then
    raise exception 'd191_set_rewards.sql: the live claim_achievement changed since this file was built. Rebuild it from the live text.';
  end if;
end $g$;
-- GUARD-END

-- The rule and the S1 title (idempotent: each change runs only when it is not yet there).
update public.balance
   set value = jsonb_set(value, '{badges,s1,title}', '"Origins Champion"')
 where key = 'achievement_rewards' and value #>> '{badges,s1,title}' = 'Season 1 Champion';
update public.balance
   set value = value || jsonb_build_object('set_complete', '{"packs":5,"title":"{name} Champion","frame":"holo:{id}"}'::jsonb),
       note = note || ' set_complete = the reward of every "<set name> Set Complete" achievement (key set:<id>, claim_achievement): packs, a title and a frame; {name} and {id} are the set name and id (D-191, D-192). badges.s1 is S1.'
 where key = 'achievement_rewards' and not value ? 'set_complete';
do $c$ begin
  if not exists (select 1 from public.balance where key = 'achievement_rewards' and value ? 'set_complete' and value #>> '{badges,s1,title}' = 'Origins Champion') then
    raise exception 'd191_set_rewards.sql: balance achievement_rewards has no set_complete, or badges.s1 has another title';
  end if;
end $c$;

-- D-192: members keep the title under the new name (earned: the claim row, equipped: the player row).
update public.achievement_claims set title = 'Origins Champion' where title = 'Season 1 Champion';
update public.players set title = 'Origins Champion' where title = 'Season 1 Champion';

CREATE OR REPLACE FUNCTION public.claim_achievement(p_player text, p_key text, p_packs integer DEFAULT NULL::integer, p_title text DEFAULT NULL::text, p_frame text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare inserted int; bal int; r jsonb; v_packs int; c jsonb; s record;
begin
  -- The reward is balance achievement_rewards.badges (balance_economy.sql). p_packs, p_title and p_frame are no
  -- longer read: an older Activity still sends them.
  r := balance_get('achievement_rewards')->'badges'->p_key;
  -- A set achievement (key set:<id>) with no row of its own: the rule balance achievement_rewards.set_complete (d191_set_rewards.sql).
  if r is null and left(p_key, 4) = 'set:' then
    c := balance_get('achievement_rewards')->'set_complete';
    select id, name into s from card_sets where id = substring(p_key from 5) and pullable;
    if c is not null and s.id is not null then
      r := jsonb_strip_nulls(jsonb_build_object('packs', c->'packs',
             'title', replace(replace(c->>'title', '{name}', s.name), '{id}', s.id),
             'frame', replace(replace(c->>'frame', '{name}', s.name), '{id}', s.id)));
    end if;
  end if;
  if r is null then return jsonb_build_object('ok', false, 'error', 'unknown'); end if;
  v_packs := coalesce((r->>'packs')::int, 0);
  -- The tracks replace these keys (achievement_tracks.sql): never paid again once they are on.
  if ach_tracks_on(p_player) and exists (select 1 from achievement_switch_map where old_key = p_key) then
    return jsonb_build_object('ok', false, 'error', 'retired'); end if;
  insert into achievement_claims (player_id, key, packs, title, frame)
    values (p_player, p_key, v_packs, r->>'title', r->>'frame')
    on conflict (player_id, key) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then return jsonb_build_object('ok', false, 'error', 'claimed'); end if;
  if v_packs > 0 then
    bal := grant_packs(p_player, v_packs, 'achievement', null, 'achievement', p_key);
    if bal is null then raise exception 'unknown player %', p_player; end if; -- rolls the claim back
  end if;
  return jsonb_build_object('ok', true, 'balance', bal, 'packs', v_packs, 'title', r->>'title', 'frame', r->>'frame');
end; $function$;

notify pgrst, 'reload schema';
