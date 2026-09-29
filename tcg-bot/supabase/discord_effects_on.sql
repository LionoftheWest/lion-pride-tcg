-- Switch on the real Discord boons + pranks that the bot now does (tcg-bot/src/discord-effects.ts,
-- 2026-09-29). Apply AFTER the bot runs with FEATURE_DISCORD_EFFECTS=1 and the live check passed.
-- The caps stay in effect_primitives (nickname 1 h, timeout 60 s, ping_parade 3 over 5 min,
-- reaction_storm 5 in 1 h, clown_role 1 h, crown / spotlight_role 48 h) and card_effect_caps.
-- Not on yet: color_role (needs a color picker), the voice effects.
update public.effect_primitives set enabled = true
 where primitive in ('nickname', 'crown', 'timeout', 'clown_role', 'spotlight_role', 'hype', 'ping_parade', 'reaction_storm');
