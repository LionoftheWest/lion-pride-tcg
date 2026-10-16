/**
 * Unit test of the effect engine ALONE (tcg-bot/supabase/f3_effect_engine.sql, F-3 PR 4b), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-effect-engine.mjs      must PASS
 * It tests the file's text (MIG=<path> for another file), so it passes before and after the file is applied.
 * The fight states are written by hand (no fight function runs). What it checks (docs/f3-effect-engine.md 2.1 to 2.10):
 *   1. each primitive: damage, heal, shield, buff (attack, enemy_damage, damage_taken), apply_status, remove_status, hit_mod (crit_add, no_block,
 *      dmg_mult, extra_strike); the numbers and the jsonb text (the scale of a numeric);
 *   2. each trigger: use, before_hit (no random()), on_hit (only when the hit dealt damage), after_attack; the reserved and unknown triggers raise;
 *   3. the conditions: target_hp_below, target_down, target_alive, matched, count_tag (distinct subjects and cards, min and max), holds_subject,
 *      mode_in, flag; a Forbidden-Pride-shaped squad row (slot squad, three dmg_mult steps at 3 / 5 / 7 pieces, the top one with holds_subject and
 *      mode_in hunt) inserted as DATA: the engine reads it with no code change;
 *   4. the refusals with today's answers: need_target, bad_target, target_downed, boss_stun_immune (ready_round = st + 2), not_support, unknown_effect;
 *      Packet Loss (null_next) nullifies;
 *   5. the counters as data: a counter passive multiplies, a mark reacts (Mirror, Undying, Spiral, Desync, Hotfix, Rot); passives_check refuses a bad
 *      counters object and accepts the live rows;
 *   6. fight_state_check (a built Hunt and Dungeon state is fine; planted bad states are refused), the apply functions (limits, a missing card),
 *      hunt_effect_apply on real rows; the rights and the comments of every new function.
 */
import './localdb-guard.mjs';
import { runBlock, assertLocal } from './lab-lib.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assertLocal('test-effect-engine.mjs');
const mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_effect_engine.sql', import.meta.url)), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (['$m$', '$t$', '$f$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $f$');

const body = String.raw`do $t$
declare r jsonb; f jsonb; h bigint; d date := (now() at time zone 'America/Denver')::date; v text; n int; e text;
  heal jsonb := '{"kind": "support", "effect": "heal", "name": "T", "amount": 0.3, "target": "ally", "affinity": "origin:test", "cooldown": 2, "duration": 1}';
  shield jsonb := '{"kind": "support", "effect": "shield", "name": "T", "amount": 0.4, "target": "ally", "affinity": "origin:test", "cooldown": 2, "duration": 1}';
  empower jsonb := '{"kind": "support", "effect": "empower", "name": "T", "amount": 0.5, "target": "ally", "affinity": "origin:test", "cooldown": 2, "duration": 1}';
  weaken jsonb := '{"kind": "support", "effect": "weaken", "name": "T", "amount": 0.3, "target": "boss", "affinity": "origin:test", "cooldown": 3, "duration": 2}';
  expose jsonb := '{"kind": "support", "effect": "expose", "name": "T", "amount": 0.3, "target": "boss", "affinity": "origin:test", "cooldown": 3, "duration": 2}';
  stun jsonb := '{"kind": "support", "effect": "stun", "name": "T", "amount": 0, "target": "boss", "affinity": "origin:test", "cooldown": 5, "duration": 1}';
  smite jsonb := '{"kind": "support", "effect": "smite", "name": "T", "amount": 200, "target": "boss", "affinity": "origin:test", "cooldown": 4, "duration": 1}';
  cleanse jsonb := '{"kind": "support", "effect": "cleanse", "name": "T", "amount": 0, "target": "team", "affinity": "origin:test", "cooldown": 2, "duration": 1}';
  execute_ jsonb := '{"kind": "attack", "effect": "execute", "name": "T", "amount": 0.5, "threshold": 0.25}';
  focus jsonb := '{"kind": "attack", "effect": "focus", "name": "T", "amount": 0.2}';
  pierce jsonb := '{"kind": "attack", "effect": "pierce", "name": "T"}';
  rampage jsonb := '{"kind": "attack", "effect": "rampage", "name": "T", "amount": 0.25}';
  lifesteal jsonb := '{"kind": "attack", "effect": "lifesteal", "name": "T", "amount": 0.2, "target": "self"}';
  foe jsonb := '{"hp": 500, "max": 1000, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0}';
begin
  execute $m$${mig}$m$;
  create temp table res (c text, ok boolean, d text);
  create function pg_temp.try(p text) returns text language plpgsql as $f$ begin execute p; return null; exception when others then return sqlerrm; end $f$;
  -- a card of a state: hp of max, not down
  create function pg_temp.cd(p_hp int, p_max int) returns jsonb language sql as $f$
    select jsonb_build_object('hp', p_hp, 'max', p_max, 'down', false, 'shield', 0, 'buff', 1, 'debuff', 1, 'cd', 0) $f$;
  -- a fight state: card 1 is the actor (its ability), card 2 the ally target (tags origin:test), card 3 a third card; p_x overrides any key
  create function pg_temp.fs(p_mode text, p_ab jsonb, p_x jsonb) returns jsonb language sql as $f$
    select jsonb_build_object('v', 1, 'mode', p_mode, 'round', 3, 'squad', '[1, 2, 3]'::jsonb,
      'cards', jsonb_build_object('1', pg_temp.cd(60, 60), '2', pg_temp.cd(30, 100), '3', pg_temp.cd(100, 100)),
      'enemies', jsonb_build_array('{"hp": 500, "max": 1000, "wk": 0, "wku": 0, "ex": 0, "exu": 0, "st": 0}'::jsonb),
      'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', jsonb_build_object(
        '1', jsonb_build_object('ability', p_ab, 'potency', 1, 'tags', '["origin:test"]'::jsonb, 'subject', 's1'),
        '2', jsonb_build_object('ok', true, 'match_tags', '["origin:test"]'::jsonb, 'tags', '["origin:test"]'::jsonb, 'subject', 's2'),
        '3', jsonb_build_object('tags', '[]'::jsonb, 'subject', 's3'))),
      'ext', '{}'::jsonb) || coalesce(p_x, '{}'::jsonb) $f$;
  create function pg_temp.chg(p jsonb, p_op text, p_id text) returns jsonb language sql as $f$
    select x->'set' from jsonb_array_elements(p->'changes') x where x->>'op' = p_op and coalesce(x->>'id', x->>'idx') = p_id $f$;

  -- ================================================================ 1. the primitives (use)
  -- heal: 30/100, amount 0.3 x potency 1 x matched_x 1.8 = 0.54 -> 54, never above max (100 - 30 = 70: all 54), the affinity count 2 (cards 1 and 2)
  r := combat_effect(pg_temp.fs('dungeon', heal, null), 1, 'use', '{"target_card": 2}');
  insert into res select 'heal: +54 on a matched ally (0.3 x 1.8 x 100), gained 54, scale 1.30 (2 cards with the tag)',
    pg_temp.chg(r, 'card', '2') = '{"hp": 84}' and r->'log'->>'value' = '54' and r->'log'->>'gained' = '54' and r->'log'->>'scale' = '1.30'
    and r->'log'->>'amount' = '0.54' and (r->'log'->>'matched')::boolean and r->'log'->>'aff_count' = '2', r::text;
  r := combat_effect(pg_temp.fs('dungeon', heal, '{"cards": {"1": {"hp": 60, "max": 60, "down": false}, "2": {"hp": 90, "max": 100, "down": false}}}'), 1, 'use', '{"target_card": 2}');
  insert into res select 'heal: never above max (90 + 54 -> 100, gained 10)', pg_temp.chg(r, 'card', '2') = '{"hp": 100}' and r->'log'->>'gained' = '10', r::text;
  r := combat_effect(pg_temp.fs('dungeon', heal, '{"cards": {"1": {"hp": 60, "max": 60, "down": false}, "2": {"hp": 0, "max": 100, "down": true}}}'), 1, 'use', '{"target_card": 2}');
  insert into res select 'heal: a downed ally is refused (target_downed)', r = '{"ok": false, "error": "target_downed"}', r::text;
  -- not matched: card 3 has no tag; it is not ok (not in the run) unless the facts say so
  r := combat_effect(pg_temp.fs('dungeon', heal, '{}'::jsonb || jsonb_build_object('facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', jsonb_build_object('1', jsonb_build_object('ability', heal, 'potency', 1.36), '3', '{"ok": true, "match_tags": []}'::jsonb)))), 1, 'use', '{"target_card": 3}');
  insert into res select 'heal: not matched, potency 1.36: amount 0.408 (today''s numeric text), +41 capped at max (100)', r->'log'->>'amount' = '0.408' and r->'log'->>'value' = '41'
    and not (r->'log'->>'matched')::boolean and pg_temp.chg(r, 'card', '3') = '{"hp": 100}' and r->'log'->>'gained' = '0', r::text;
  -- shield
  r := combat_effect(pg_temp.fs('hunt', shield, null), 1, 'use', '{"target_card": 2}');
  insert into res select 'shield: + round(100 x 0.4 x 1.8) = 72 on the ally shield, applied 72', pg_temp.chg(r, 'card', '2') = '{"shield": 72}' and r->'log'->>'applied' = '72', r::text;
  -- buff attack (empower), until next_attack
  r := combat_effect(pg_temp.fs('dungeon', empower, null), 1, 'use', '{"target_card": 2}');
  insert into res select 'empower: buff = 1 + 0.5 x 1.8 = 1.90 (add1; scale NOT applied)', (pg_temp.chg(r, 'card', '2')->>'buff') = '1.90' and r->'log'->>'value' = '1.90', r::text;
  -- buff enemy_damage / damage_taken, rounds field:duration
  r := combat_effect(pg_temp.fs('dungeon', weaken, null), 1, 'use', '{}');
  insert into res select 'weaken: wk = least(cap 0.6, 0.3 x scale 1.30) = 0.390, wku = round 3 + duration 2', (pg_temp.chg(r, 'enemy', '0')->>'wk') = '0.390' and pg_temp.chg(r, 'enemy', '0')->>'wku' = '5', r::text;
  r := combat_effect(pg_temp.fs('dungeon', jsonb_set(weaken, '{amount}', '0.6'), '{"squad": [1, 2, 3]}'), 1, 'use', '{}');
  insert into res select 'weaken: the cap (0.6 x 1.30 = 0.78 -> 0.6)', (pg_temp.chg(r, 'enemy', '0')->>'wk') = '0.6', r::text;
  r := combat_effect(pg_temp.fs('dungeon', expose, null), 1, 'use', '{}');
  insert into res select 'expose: ex 0.390, exu 5', (pg_temp.chg(r, 'enemy', '0')->>'ex') = '0.390' and pg_temp.chg(r, 'enemy', '0')->>'exu' = '5', r::text;
  -- apply_status stun, the immunity
  r := combat_effect(pg_temp.fs('dungeon', stun, null), 1, 'use', '{}');
  insert into res select 'stun: st = round + 1', pg_temp.chg(r, 'enemy', '0') = '{"st": 4}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', stun, '{"enemies": [{"hp": 500, "max": 1000, "st": 2}]}'), 1, 'use', '{}');
  insert into res select 'stun: immune after a stun (round 3 < st 2 + 2): boss_stun_immune, ready_round 4', r = '{"ok": false, "error": "boss_stun_immune", "ready_round": 4}', r::text;
  -- damage (smite), the first living foe, the asked foe first, the kill
  r := combat_effect(pg_temp.fs('dungeon', smite, '{"enemies": [{"hp": 0, "max": 100}, {"hp": 500, "max": 1000}, {"hp": 100, "max": 100}]}'), 1, 'use', '{"target_foe": 0}');
  insert into res select 'smite: a dead asked foe -> the first living foe (1), 200 x 1.30 = 260', r->'log'->>'target_foe' = '1' and pg_temp.chg(r, 'enemy', '1') = '{"hp": 240}' and r->'log'->>'value' = '260', r::text;
  r := combat_effect(pg_temp.fs('dungeon', smite, '{"enemies": [{"hp": 500, "max": 1000}, {"hp": 100, "max": 100}]}'), 1, 'use', '{"target_foe": 1}');
  insert into res select 'smite: the asked foe, HP floor 0, kill', pg_temp.chg(r, 'enemy', '1') = '{"hp": 0}' and (r->'log'->>'kill')::boolean, r::text;
  e := pg_temp.try(format('select combat_effect(%L::jsonb, 1, %L)', pg_temp.fs('dungeon', smite, '{"enemies": [{"hp": 0, "max": 100}]}'), 'use'));
  insert into res select 'smite: no living foe raises (today''s function fails there too)', e like '%no living enemy%', coalesce(e, 'accepted');
  -- remove_status: Dungeon every card curse + poison; Hunt only the curse, only where it is not 1
  r := combat_effect(pg_temp.fs('dungeon', cleanse, '{"cards": {"1": {"hp": 60, "max": 60, "down": false, "debuff": 1}, "2": {"hp": 30, "max": 100, "down": false, "debuff": 0.7, "psn": 5, "psnu": 4}}}'), 1, 'use', '{}');
  insert into res select 'cleanse (Dungeon): every card debuff 1, psn 0, psnu -1', pg_temp.chg(r, 'card', '1') = '{"debuff": 1, "psn": 0, "psnu": -1}' and pg_temp.chg(r, 'card', '2') = '{"debuff": 1, "psn": 0, "psnu": -1}', r::text;
  r := combat_effect(pg_temp.fs('hunt', cleanse, '{"cards": {"1": {"hp": 60, "max": 60, "down": false, "debuff": 1.0}, "2": {"hp": 30, "max": 100, "down": false, "debuff": 0.7}}}'), 1, 'use', '{}');
  insert into res select 'cleanse (Hunt): only the cursed card (debuff <> 1), no poison', pg_temp.chg(r, 'card', '1') is null and pg_temp.chg(r, 'card', '2') = '{"debuff": 1}', r::text;

  -- ================================================================ 2. the attack triggers
  r := combat_effect(pg_temp.fs('dungeon', execute_, '{"enemies": [{"hp": 200, "max": 1000}]}'), 1, 'before_hit', '{"target_foe": 0}');
  insert into res select 'before_hit execute: the target below 25% -> dmg_mult 1.5', r->'mods' = '{"dmg_mult": 1.5}' and r->'changes' = '[]', r::text;
  r := combat_effect(pg_temp.fs('dungeon', execute_, '{"enemies": [{"hp": 250, "max": 1000}]}'), 1, 'before_hit', '{"target_foe": 0}');
  insert into res select 'before_hit execute: at 25% (not below) -> no mod', r->'mods' = '{}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', focus, null), 1, 'before_hit', '{}');
  insert into res select 'before_hit focus: crit_add 0.2', r->'mods' = '{"crit_add": 0.2}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', pierce, null), 1, 'before_hit', '{}');
  insert into res select 'before_hit pierce: no_block', r->'mods' = '{"no_block": true}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', rampage, null), 1, 'before_hit', '{}');
  insert into res select 'before_hit rampage: extra_strike 0.25', r->'mods' = '{"extra_strike": 0.25}', r::text;
  perform setseed(0.5); n := (random() * 1000000)::int; perform setseed(0.5);
  r := combat_effect(pg_temp.fs('dungeon', rampage, null), 1, 'before_hit', '{}');
  insert into res select 'before_hit draws no random()', (random() * 1000000)::int = n, n::text;
  r := combat_effect(pg_temp.fs('dungeon', lifesteal, '{"cards": {"1": {"hp": 50, "max": 200, "down": false}}}'), 1, 'on_hit', '{"dealt": 100}');
  insert into res select 'on_hit lifesteal: least(100 x 0.2, 200 x cap 0.06 = 12) = 12 -> hp 62', pg_temp.chg(r, 'card', '1') = '{"hp": 62}' and r->'log'->>'heal' = '12', r::text;
  r := combat_effect(pg_temp.fs('dungeon', lifesteal, '{"cards": {"1": {"hp": 50, "max": 200, "down": false}}}'), 1, 'on_hit', '{"dealt": 0}');
  insert into res select 'on_hit: a hit that dealt 0 heals nothing', r->'changes' = '[]' and not (r->'log' ? 'heal'), r::text;
  r := combat_effect(pg_temp.fs('dungeon', lifesteal, '{"cards": {"1": {"hp": 50, "max": 200, "down": false}}}'), 1, 'on_hit', '{"dealt": 2}');
  insert into res select 'on_hit lifesteal: at least 1 (round(2 x 0.2) = 0 -> 1)', r->'log'->>'heal' = '1', r::text;
  r := combat_effect(pg_temp.fs('dungeon', focus, '{"cards": {"1": {"hp": 50, "max": 200, "down": false, "buff": 1.9}}}'), 1, 'after_attack', '{}');
  insert into res select 'after_attack: the buff until next_attack ends (buff 1)', pg_temp.chg(r, 'card', '1') = '{"buff": 1}', r::text;
  r := combat_effect(pg_temp.fs('hunt', focus, '{"cards": {}}'), 1, 'after_attack', '{}');
  insert into res select 'after_attack: a Hunt attacker with no row still gets the change (the mode keeps it in its variables)', pg_temp.chg(r, 'card', '1') = '{"buff": 1}', r::text;
  foreach v in array array['round_start', 'on_crit', 'on_kill', 'on_damage_taken', 'ally_down', 'low_hp'] loop
    e := pg_temp.try(format('select combat_effect(%L::jsonb, 1, %L)', pg_temp.fs('dungeon', focus, null), v));
    insert into res select 'reserved trigger ' || v || ' raises', e like '%reserved%', coalesce(e, 'accepted');
  end loop;
  e := pg_temp.try(format('select combat_effect(%L::jsonb, 1, %L)', pg_temp.fs('dungeon', focus, null), 'on_tuesday'));
  insert into res select 'an unknown trigger raises', e like '%unknown trigger%', coalesce(e, 'accepted');

  -- ================================================================ 3. the refusals and Packet Loss
  r := combat_effect(pg_temp.fs('dungeon', heal, null), 1, 'use', '{}');
  insert into res select 'need_target', r = '{"ok": false, "error": "need_target"}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', heal, null), 1, 'use', '{"target_card": 3}');
  insert into res select 'bad_target (no ok fact)', r = '{"ok": false, "error": "bad_target"}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', focus, null), 1, 'use', '{}');
  insert into res select 'not_support (an attack card cannot use)', r = '{"ok": false, "error": "not_support"}', r::text;
  r := combat_effect(pg_temp.fs('dungeon', jsonb_set(weaken, '{effect}', '"freeze"'), null), 1, 'use', '{}');
  insert into res select 'unknown_effect (with the effect name)', r = '{"ok": false, "error": "unknown_effect", "effect": "freeze"}', r::text;
  r := combat_effect(pg_temp.fs('hunt', smite, '{"marks": {"null_next": 2}}'), 1, 'use', '{}');
  insert into res select 'Packet Loss: nullified, null_next 2 -> 1', (r->>'nullified')::boolean and r->'changes' = '[{"op": "marks", "del": [], "set": {"null_next": 1}}]', r::text;
  r := combat_effect(pg_temp.fs('hunt', smite, '{"marks": {"null_next": 1}}'), 1, 'use', '{}');
  insert into res select 'Packet Loss: null_next 1 -> removed', r->'changes' = '[{"op": "marks", "del": ["null_next"], "set": {}}]', r::text;

  -- ================================================================ 4. the counters as data (Hunt)
  f := pg_temp.fs('hunt', heal, null);
  r := combat_effect(f || jsonb_build_object('facts', (f->'facts') || '{"passives": ["plague"]}'::jsonb), 1, 'use', '{"target_card": 2}');
  insert into res select 'plague (passives.params.counters.mult.heal): amount 0.3 x 0.1 x 1.8 = 0.054, countered [plague]', r->'log'->>'amount' = '0.054' and r->'log'->'countered' = '["plague"]', r::text;
  r := combat_effect(pg_temp.fs('hunt', smite, '{"marks": {"mirror": true}}'), 1, 'use', '{}');
  insert into res select 'Mirror: the smite hits the smite card (60 - 260 -> 0, down), the mark goes, no credit', pg_temp.chg(r, 'card', '1') = '{"hp": 0, "down": true}'
    and r->'changes' @> '[{"op": "marks", "del": ["mirror"]}]' and not r->'changes' @> '[{"op": "credit"}]', r::text;
  r := combat_effect(pg_temp.fs('hunt', smite, null), 1, 'use', '{}');
  insert into res select 'smite in the Hunt: a credit for the leaderboard', r->'changes' @> '[{"op": "credit", "card": 1, "value": 260}]', r::text;
  r := combat_effect(pg_temp.fs('hunt', heal, '{"marks": {"undying": {"until": 999}}}'), 1, 'use', '{"target_card": 2}');
  insert into res select 'Undying: the boss heals what the card gained (54)', pg_temp.chg(r, 'enemy', '0') = '{"hp": 554}' and r->'log'->'countered' = '["undying"]', r::text;
  r := combat_effect(pg_temp.fs('hunt', weaken, '{"marks": {"spiral": {"until": 999, "bonus": 0.2}}}'), 1, 'use', '{}');
  insert into res select 'Rage Spiral: bonus 0.2 + step 0.2', r->'changes' @> '[{"op": "marks", "set": {"spiral": {"bonus": 0.4, "until": 999}}}]', r::text;
  r := combat_effect(pg_temp.fs('hunt', stun, '{"marks": {"stun_fail": true}}'), 1, 'use', '{}');
  insert into res select 'Desync: the stun fails, the mark goes', (r->'log'->>'failed')::boolean and pg_temp.chg(r, 'enemy', '0') is null and r->'log'->'countered' = '["desync"]', r::text;
  r := combat_effect(pg_temp.fs('hunt', cleanse, '{"marks": {"lock_cleanse": {"until": 999}, "rot": {"until": 999}}, "cards": {"1": {"hp": 60, "max": 60, "down": false, "debuff": 0.7, "buff": 1.5, "shield": 9}}}'), 1, 'use', '{}');
  insert into res select 'Hotfix keeps the curse, Rot removes empower and shields', pg_temp.chg(r, 'card', '1') = '{"buff": 1, "shield": 0}' and r->'log'->'countered' = '["hotfix", "rot"]', r::text;
  r := combat_effect(pg_temp.fs('hunt', shield, '{"marks": {"block_shield": {"until": 999, "mult": 0.1}, "half_shield": {"until": 2, "mult": 0.5}}}'), 1, 'use', '{"target_card": 2}');
  insert into res select 'block_<counter_key> on, half_ expired (until 2 < round 3)', r->'log'->'countered' = '["block_shield"]' and r->'log'->>'amount' = '0.072', r::text;
  r := combat_effect(pg_temp.fs('dungeon', heal, '{"marks": {"half_heal": {"until": 999}}}'), 1, 'use', '{"target_card": 2}');
  insert into res select 'a mark with no mult reads hunt_counter_mult (decay.heal 0.5)', r->'log'->>'amount' = '0.270', r::text;
  -- passives_check
  e := pg_temp.try($q$update passives set params = params || '{"counters": {"mult": {"heal": "nope_x"}}}' where key = 'plague'$q$);
  insert into res select 'passives_check refuses a leaf that is not in keys', e like '%must name one of params.keys%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set params = params || '{"counters": {"mult": {"tickle": "plague_x"}}}' where key = 'plague'$q$);
  insert into res select 'passives_check refuses a kind with no counter_key', e like '%not the counter_key%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set params = params || '{"counters": {"chance": "plague_x"}}' where key = 'plague'$q$);
  insert into res select 'passives_check refuses an unknown counters key', e like '%counters has no key%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set params = params || '{"counters": {"status_fail": {"burn": "juggernaut_x"}}}' where key = 'juggernaut'$q$);
  insert into res select 'passives_check refuses a status_fail that is not stun', e like '%is not a status%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set params = params || '{"counters": {"mult": {"heal": "thorns"}}}' where key = 'thorns'$q$);
  insert into res select 'passives_check refuses counters on a passive that is not a counter', e like '%only a counter passive%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set params = params || '{"extra": 1}' where key = 'armored'$q$);
  insert into res select 'passives_check refuses an unknown params key', e like '%params has no key%', coalesce(e, 'accepted');
  e := pg_temp.try($q$update passives set label = label where true$q$);
  insert into res select 'passives_check accepts every live row (counters included)', e is null, coalesce(e, 'accepted');

  -- ================================================================ 5. the conditions and a Forbidden-Pride-shaped squad row (data only)
  r := (pg_temp.fs('hunt', focus, null));
  insert into res select 'combat_effect_when: target_hp_below / target_down / target_alive / matched / mode_in / flag',
    combat_effect_when('[{"kind": "target_hp_below", "value": "balance:support.weaken_cap"}]', r, '{"target": {"hp": 59, "max": 100}}')
    and not combat_effect_when('[{"kind": "target_hp_below", "value": "balance:support.weaken_cap"}]', r, '{"target": {"hp": 60, "max": 100}}')
    and combat_effect_when('[{"kind": "target_down"}]', r, '{"target": {"hp": 0, "max": 100, "down": true}}')
    and not combat_effect_when('[{"kind": "target_alive"}]', r, '{"target": {"hp": 0, "max": 100, "down": true}}')
    and combat_effect_when('[{"kind": "matched"}]', r, '{"matched": true}') and not combat_effect_when('[{"kind": "matched"}]', r, '{}')
    and combat_effect_when('[{"kind": "mode_in", "modes": ["hunt"]}]', r, '{}') and not combat_effect_when('[{"kind": "mode_in", "modes": ["dungeon", "gauntlet"]}]', r, '{}')
    and not combat_effect_when('[{"kind": "flag", "balance": "balance:combat.auto_elements"}]', r, '{}'), 'conditions';
  insert into ability_kinds (key, label, slot, steps, note) values ('set_test_pride', 'Test Pride', 'squad', jsonb_build_array(
    jsonb_build_object('on', 'before_hit', 'do', 'hit_mod', 'mod', 'dmg_mult', 'value', '{"refs": ["balance:combat.trait_small"]}'::jsonb,
      'when', '[{"kind": "count_tag", "tag": "trait:forbidden-pride", "scope": "squad", "distinct": "subject", "min": 3, "max": 4}]'::jsonb),
    jsonb_build_object('on', 'before_hit', 'do', 'hit_mod', 'mod', 'dmg_mult', 'value', '{"refs": ["balance:combat.trait_big"]}'::jsonb,
      'when', '[{"kind": "count_tag", "tag": "trait:forbidden-pride", "scope": "squad", "min": 5, "max": 6}]'::jsonb),
    jsonb_build_object('on', 'before_hit', 'do', 'hit_mod', 'mod', 'dmg_mult', 'value', '{"refs": ["balance:combat.element_big"]}'::jsonb,
      'when', '[{"kind": "count_tag", "tag": "trait:forbidden-pride", "scope": "squad", "min": 7}, {"kind": "holds_subject", "key": "ottozone-s-head", "scope": "squad"}, {"kind": "mode_in", "modes": ["hunt"]}]'::jsonb)),
    'A test row in the shape of the Forbidden Pride set (rolled back).');
  create function pg_temp.fp(p_mode text, p_subjects text[], p_ab jsonb) returns jsonb language sql as $f$
    select pg_temp.fs(p_mode, p_ab, jsonb_build_object('squad', (select jsonb_agg(i + 10) from generate_subscripts(p_subjects, 1) i) || '[1]'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', jsonb_build_object('1', jsonb_build_object('ability', p_ab, 'tags', '[]'::jsonb, 'subject', 'att'))
        || (select jsonb_object_agg((i + 10)::text, jsonb_build_object('tags', '["trait:forbidden-pride"]'::jsonb, 'subject', p_subjects[i])) from generate_subscripts(p_subjects, 1) i)))) $f$;
  r := combat_effect(pg_temp.fp('hunt', array['a', 'b'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 2 pieces -> no bonus', r->'mods' = '{"crit_add": 0.2}', r::text;
  r := combat_effect(pg_temp.fp('hunt', array['a', 'b', 'c'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 3 pieces -> dmg_mult trait_small 1.08 (a squad row runs after the card kind)', r->'mods' = '{"crit_add": 0.2, "dmg_mult": 1.08}', r::text;
  r := combat_effect(pg_temp.fp('dungeon', array['a', 'b', 'b', 'c', 'c'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 5 cards of 3 subjects (count_tag distinct subject) -> 3 -> 1.08', r->'mods'->>'dmg_mult' = '1.08', r::text;
  r := combat_effect(pg_temp.fp('dungeon', array['a', 'b', 'c', 'd', 'e'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 5 pieces -> trait_big 1.14', r->'mods'->>'dmg_mult' = '1.14', r::text;
  r := combat_effect(pg_temp.fp('hunt', array['a', 'b', 'c', 'd', 'e', 'f', 'ottozone-s-head'], execute_ || '{"threshold": 0.6}'), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 7 pieces with the head in the Hunt -> element_big 1.20 x execute 1.5 = 1.800 (exact numeric product)', r->'mods'->>'dmg_mult' = '1.800', r::text;
  r := combat_effect(pg_temp.fp('dungeon', array['a', 'b', 'c', 'd', 'e', 'f', 'ottozone-s-head'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 7 pieces in the Dungeon (mode_in hunt) -> no bonus', not (r->'mods' ? 'dmg_mult'), r::text;
  r := combat_effect(pg_temp.fp('hunt', array['a', 'b', 'c', 'd', 'e', 'f', 'g'], focus), 1, 'before_hit', '{}');
  insert into res select 'FP shape: 7 pieces without the head (holds_subject) -> no bonus', not (r->'mods' ? 'dmg_mult'), r::text;
  insert into res select 'count_tag distinct card counts each card', combat_effect_count('{"tag": "trait:forbidden-pride", "distinct": "card"}', pg_temp.fp('hunt', array['a', 'a', 'b'], focus)) = 3
    and combat_effect_count('{"tag": "trait:forbidden-pride"}', pg_temp.fp('hunt', array['a', 'a', 'b'], focus)) = 2, 'count';
  update ability_kinds set enabled = false where key = 'set_test_pride';
  r := combat_effect(pg_temp.fp('hunt', array['a', 'b', 'c'], focus), 1, 'before_hit', '{}');
  insert into res select 'a switched-off squad row does not run', r->'mods' = '{"crit_add": 0.2}', r::text;

  -- ================================================================ 6. the fight state, the apply functions, rights, comments
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('tst_engine', 'engine test');
  insert into player_cards (player_id, card_id, quantity) select 'tst_engine', c, 1 from unnest(array[24, 29, 82]) c;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, hp_share, closes_at, status, passive)
    values ('Engine Boss', 'Heroic', '[]', 1000, 900, 1000, now() + interval '1 day', 'active', '{"kind": "plague", "list": [{"kind": "plague"}]}') returning id into h;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids, locked_at) values (h, 'tst_engine', d, array[24, 29, 82]::bigint[], now());
  insert into hunt_combat_state (hunt_id, player_id, hit_date, round, marks) values (h, 'tst_engine', d, 2, '{"rot": {"until": 999}}');
  insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, 'tst_engine', 24, d, 30, 60, false), (h, 'tst_engine', 82, d, 60, 60, false);
  f := hunt_fight_state(h, 'tst_engine', d, 82, 29);
  insert into res select 'hunt_fight_state: the shape check is clean', fight_state_check(f) = '{}', array_to_string(fight_state_check(f), '; ') || ' ' || f::text;
  insert into res select 'hunt_fight_state: rows, boss, marks, passives, the target commit facts', f->'squad' = '[24, 82]' and f->'cards'->'24'->>'hp' = '30'
    and f->'enemies'->0->>'hp' = '900' and f->'marks' ? 'rot' and f->'facts'->'passives' = '["plague"]' and (f->'facts'->'cards'->'29'->>'commit')::boolean
    and (f->'facts'->'cards'->'29'->>'ok')::boolean and f->'facts'->'cards'->'82'->'ability'->>'effect' = 'heal' and f->>'round' = '2', f::text;
  perform hunt_effect_apply(h, 'tst_engine', d, '[{"op": "commit", "card": 29, "max": 70}, {"op": "card", "id": 24, "set": {"hp": 50, "buff": 1.5}}, {"op": "card", "id": 29, "set": {"shield": 7}},
    {"op": "enemy", "idx": 0, "set": {"hp": 0, "wk": 0.25, "wku": 4}}, {"op": "marks", "set": {"spiral": {"until": 9}}, "del": ["rot"]}, {"op": "credit", "card": 82, "value": 33}]');
  insert into res select 'hunt_effect_apply: commit, cards, the boss (0 HP = defeated), weaken, marks, credit',
    (select hp_remaining = 50 and dmg_buff = 1.5 from hunt_card_hp where hunt_id = h and card_id = 24) and (select x.hp_remaining = 70 and x.shield = 7 from hunt_card_hp x where x.hunt_id = h and x.card_id = 29)
    and (select status = 'defeated' and hp_remaining = 0 from hunts where id = h) and (select boss_weaken = 0.25 and weaken_until = 4 and marks = '{"spiral": {"until": 9}}' from hunt_combat_state where hunt_id = h)
    and (select damage = 33 from hunt_hits where hunt_id = h and card_id = 82), 'apply';
  e := pg_temp.try($q$select hunt_effect_apply(1, 'x', current_date, '[{"op": "card", "id": 1, "set": {"hp": -1}}]')$q$);
  insert into res select 'fight_change_check: HP below 0 is refused', e like '%below 0%', coalesce(e, 'accepted');
  e := pg_temp.try($q$select dungeon_effect_apply('{"cards": {}, "foes": []}', '[{"op": "card", "id": 5, "set": {"hp": 1}}]')$q$);
  insert into res select 'dungeon_effect_apply: a card that is not in the run raises', e like '%not in the run%', coalesce(e, 'accepted');
  e := pg_temp.try($q$select dungeon_effect_apply('{"cards": {}, "foes": []}', '[{"op": "marks", "set": {}}]')$q$);
  insert into res select 'dungeon_effect_apply: a run has no marks', e like '%no marks change%', coalesce(e, 'accepted');
  insert into res select 'dungeon_effect_apply: set values, the credit is ignored',
    dungeon_effect_apply('{"cards": {"5": {"hp": 3, "max": 9}}, "foes": [{"hp": 4}]}', '[{"op": "card", "id": 5, "set": {"hp": 9}}, {"op": "enemy", "idx": 0, "set": {"st": 4}}, {"op": "credit", "card": 5, "value": 2}]')
      = '{"cards": {"5": {"hp": 9, "max": 9}}, "foes": [{"hp": 4, "st": 4}]}', 'apply';
  insert into res select 'fight_state_check: planted bad states are refused',
    cardinality(fight_state_check(pg_temp.fs('dungeon', focus, '{"cards": {"1": {"hp": 70, "max": 60, "down": false}}}'))) = 1
    and cardinality(fight_state_check(pg_temp.fs('arena', focus, null))) = 1 and cardinality(fight_state_check(pg_temp.fs('hunt', focus, '{"x": 1}'))) = 1
    and cardinality(fight_state_check(pg_temp.fs('hunt', focus, '{"enemies": [{"hp": -1, "max": 5}]}'))) = 1 and fight_state_check('[]') = array['the fight state must be an object']
    and fight_state_check(pg_temp.fs('hunt', focus, null)) = '{}', 'check';
  -- the rights and the comments
  select string_agg(p.oid::regprocedure::text, ', ') into v from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('combat_effect', 'combat_effect_use', 'combat_effect_hit', 'combat_effect_set', 'combat_effect_mark', 'combat_effect_changes', 'combat_effect_num',
      'combat_effect_value', 'combat_effect_count', 'combat_effect_when', 'combat_hit_core', 'combat_crit_chance_mods', 'hunt_fight_state', 'dungeon_fight_state',
      'fight_state_check', 'fight_change_check', 'dungeon_effect_apply', 'hunt_effect_apply')
    and (obj_description(p.oid, 'pg_proc') is null or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
      or not has_function_privilege('service_role', p.oid, 'execute'));
  insert into res select 'every new function has a comment, no anon / authenticated right, service_role may run it', v is null, coalesce(v, 'ok');
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_effect', 'combat_hit_core', 'hunt_fight_state', 'dungeon_effect_apply', 'hunt_effect_apply', 'fight_state_check');
  insert into res select 'the functions exist', n = 6, n::text;

  raise exception 'RESULT:%', (select jsonb_build_object('n', count(*), 'fails', count(*) filter (where not x.ok or x.ok is null),
    'lines', jsonb_agg(case when x.ok then 'ok   ' else 'FAIL ' end || x.c || case when x.ok then '' else '  :: ' || left(x.d, 700) end order by x.c)) from res x)::text;
end $t$;`;

let out;
try { out = JSON.parse(await runBlock(body)); } catch (e) { console.log('FAIL', String(e.message).slice(0, 3000)); process.exit(1); }
for (const l of out.lines) console.log(l);
console.log(`\n${out.fails ? 'FAIL' : 'PASS'} ${out.n} checks, FAILS ${out.fails}`);
process.exit(out.fails ? 1 : 0);
