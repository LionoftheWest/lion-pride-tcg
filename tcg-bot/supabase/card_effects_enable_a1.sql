-- Card effects, Phase A1 (2026-09-27): turn on the first 9 effect types.
-- Everything else in effect_primitives stays disabled until its phase ships.
-- The Activity still shows nothing until FEATURE_CARD_EFFECTS or CARD_EFFECTS_USERS is set.
update effect_primitives set enabled = true
 where primitive in ('title', 'sticker', 'confetti', 'googly_eyes', 'upside_down', 'rubber_chicken',
                     'ward', 'reflect', 'cleanse');
