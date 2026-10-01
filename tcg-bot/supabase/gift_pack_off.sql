-- No card gives free packs any more (Nathan, 2026-10-01: the gift-pack boon was "a pretty
-- over powered ability"). Its 4 cards became Lucky Pull (cards.json + push-effects.mjs), and
-- the gift_pack effect type is switched off, so no card can use it.
update public.effect_primitives set enabled = false where primitive = 'gift_pack';
notify pgrst, 'reload schema';
