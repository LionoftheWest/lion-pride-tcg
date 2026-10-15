-- f3_stat_labels.sql (2026-10-15): F-3, the stat names say what they do (docs/foundations.md F-3 item 9 "Decided (Nathan, 2026-10-11)" and item 11).
-- Before: the five stat names were typed in the Activity code (ui-v2.js STAT_DEFS, ui-v2-shop.js STAT_NAME / STAT_SHORT, effects-ui.js, two
-- explain texts, one help text), with the old words (Vitality, Precision, Potency, Haste) and the numbers typed in the texts.
-- After: ONE balance key `stat_labels`. The stored keys of the stat points do NOT change (attack, vitality, precision, potency, haste); only the
-- words that a player reads:
--   attack -> Attack   vitality -> Health   precision -> Crit   potency -> Support   haste -> Recharge
-- Each stat has label, short (the 3 or 4 letter form of a small chip) and text (the one-line explainer after "<label>: "). The text has the
-- place {n}, which is the number of balance stat_points for that stat in percent (stat_points.attack 0.05 = 5), so a balance change cannot make
-- a text wrong. stat_labels() returns the answer with the numbers in. The Activity reads the raw key from the public balance (it is public) and
-- fills {n} the same way (tcg-activity/src/stat-labels.js; the test of both: tcg-activity/src/stat-labels.test.js and test-stat-labels.mjs).
-- NO CHANGE IN PLAY: no function of the fights reads this key. Limits: balance_check_stat_labels. Idempotent (an existing value stays).
-- Test: card-studio/scripts/test-stat-labels.mjs (rolled back; MUTATE=<name> must FAIL).

insert into public.balance (key, value, note) values ('stat_labels', jsonb_build_object(
  'attack',    jsonb_build_object('label', 'Attack',   'short', 'ATK', 'text', 'your card hits harder (+{n}% attack power for each point)'),
  'vitality',  jsonb_build_object('label', 'Health',   'short', 'HP',  'text', 'your card has more HP (+{n}% HP for each point)'),
  'precision', jsonb_build_object('label', 'Crit',     'short', 'CRT', 'text', 'your card lands critical hits more often (+{n}% chance for each point)'),
  'potency',   jsonb_build_object('label', 'Support',  'short', 'SUP', 'text', 'the support of your card is stronger (+{n}% heal, shield or empower for each point)'),
  'haste',     jsonb_build_object('label', 'Recharge', 'short', 'RCH', 'text', 'supports are ready sooner (-{n}% cooldown for each point)')),
  'The names of the five stat points as a player reads them (Nathan, 2026-10-11; f3_stat_labels.sql). The key is the stored stat (attack, vitality, precision, potency, haste) and does not change; label = the name (Attack, Health, Crit, Support, Recharge), short = the chip form (at most 4 letters), text = the one-line explainer shown after "<label>: ". {n} in the text = the percent of balance stat_points for that stat (attack 0.05 = 5, vitality 0.06 = 6, precision 0.03 = 3, potency 0.05 = 5, haste 0.04 = 4), so the numbers in the texts always follow stat_points. Read by the Activity stat screens through the public balance; stat_labels() gives the texts with the numbers in. No fight reads this key. Limits: balance_check_stat_labels (all five stats, a label of 1 to 12 characters, a short of 1 to 4, a text with {n} once).')
on conflict (key) do nothing;

-- The limits (a new trigger, the f3_element_bonus.sql pattern). A key that is absent is not checked (the seed insert has it).
create or replace function public.balance_check_stat_labels() returns trigger language plpgsql set search_path = public as $f$
declare k text; v jsonb;
begin
  if new.key = 'stat_labels' then
    foreach k in array array['attack', 'vitality', 'precision', 'potency', 'haste'] loop
      v := new.value->k;
      if jsonb_typeof(v) is distinct from 'object' then
        raise exception 'balance stat_labels: % must be an object with label, short and text', k;
      end if;
      if jsonb_typeof(v->'label') is distinct from 'string' or length(trim(v->>'label')) not between 1 and 12 or v->>'label' <> trim(v->>'label') then
        raise exception 'balance stat_labels: % label must be 1 to 12 characters', k;
      end if;
      if jsonb_typeof(v->'short') is distinct from 'string' or length(trim(v->>'short')) not between 1 and 4 or v->>'short' <> trim(v->>'short') then
        raise exception 'balance stat_labels: % short must be 1 to 4 characters', k;
      end if;
      if jsonb_typeof(v->'text') is distinct from 'string' or length(v->>'text') not between 5 and 120
         or length(v->>'text') - length(replace(v->>'text', '{n}', '')) <> 3 then
        raise exception 'balance stat_labels: % text must be 5 to 120 characters and have {n} exactly once', k;
      end if;
    end loop;
    if (select count(*) from jsonb_object_keys(new.value)) <> 5 then
      raise exception 'balance stat_labels: only the five stats (attack, vitality, precision, potency, haste)';
    end if;
  end if;
  return new;
end $f$;
drop trigger if exists balance_check_stat_labels on public.balance;
create trigger balance_check_stat_labels before insert or update on public.balance
  for each row execute function public.balance_check_stat_labels();

-- The labels with the numbers in: { stat: { label, short, text } }, {n} = the percent of balance stat_points for that stat (no trailing zero).
create or replace function public.stat_labels() returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(l.key, jsonb_build_object('label', l.value->>'label', 'short', l.value->>'short',
           'text', replace(l.value->>'text', '{n}', trim_scale(round((s.value->>l.key)::numeric * 100, 1))::text))), '{}'::jsonb)
    from balance b, jsonb_each(b.value) l, balance s
   where b.key = 'stat_labels' and s.key = 'stat_points';
$$;

comment on function public.stat_labels() is $doc$[stats] The five stat names as a player reads them, from balance stat_labels with {n} filled from balance stat_points (percent). { attack|vitality|precision|potency|haste: { label, short, text } }. The stored stat keys are unchanged.$doc$;
comment on function public.balance_check_stat_labels() is $doc$Trigger (before insert, update on balance): stat_labels must have the five stats, each with a label (1 to 12 characters), a short (1 to 4) and a text with {n} exactly once (f3_stat_labels.sql).$doc$;

notify pgrst, 'reload schema';
