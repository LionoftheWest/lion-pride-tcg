-- Screen pranks are short (Nathan, 2026-10-01): "pranks like this don't stay on forever and are
-- gone within 1-3 minutes depending on the card rarity/ascending".
-- The screen pranks change the target's own Activity: googly_eyes, upside_down, fog,
-- rubber_chicken (BODY_FX in tcg-activity/src/effects-ui.js).
-- The duration = base x rarity power x ascension power (play_card_effect), then the hard cap.
-- Base 80 s: Normal 1:20, Illustrated Rare 1:32, Secret Rare / Full Art 1:44, Gold 2:00;
-- each star +10 %; the cap is 3:00 (a Gold at 5 stars).

update effect_primitives set max_duration_s = 180
 where primitive in ('googly_eyes', 'upside_down', 'fog', 'rubber_chicken');

-- The cards: the new base, and no fixed time in the text (the card view shows the time).
update subjects
   set effect = jsonb_set(jsonb_set(effect, '{base,duration_s}', '80'::jsonb), '{desc}',
                 to_jsonb(regexp_replace(effect->>'desc', ' (for a day|for 10 minutes)\.$', '.')))
 where effect->>'primitive' in ('googly_eyes', 'upside_down', 'fog', 'rubber_chicken');

-- The screen pranks already on members: they end at most 3 minutes after they started.
update player_effects
   set expires_at = least(expires_at, starts_at + interval '180 seconds')
 where primitive in ('googly_eyes', 'upside_down', 'fog', 'rubber_chicken')
   and expires_at > now();

notify pgrst, 'reload schema';
