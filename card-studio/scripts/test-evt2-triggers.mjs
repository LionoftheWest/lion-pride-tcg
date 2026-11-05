/**
 * EVT-2 B2 (evt2_event_triggers.sql): the triggers app_visit and the v2-aware hunt_hit. Fake members only, one DO block,
 * always rolled back. items/EVT-2/SPEC.md v2.4 section 6, conditions C3-C12 (+ L4: apply -> undo -> apply md5).
 *   node scripts/test-evt2-triggers.mjs [evt2_event_triggers.sql] [evt2_event_triggers_undo.sql]
 *   MUTATE=all (or MUTATE=<id>) runs each mutation of section 6 and expects the named condition to FAIL.
 * The block applies the undo file (the base text, md5 checked), then the B2 file, so the result does not depend on the
 * state of the copy (before or after the rehearsal).
 * Time points (Z): L = 2026-11-06 19:00:00 (the test value), E = 2026-12-01 07:00:00 (exclusive end = 2026-11-30 24:00 MT).
 *   C3  WoW: a visit 1 s before L = no gift
 *   C4  WoW: a visit at L and at L + 1 s = 1 gift each
 *   C5  WoW: a visit that started before L and continued after L = no gift; the next visit after L = a gift (Nathan Q9)
 *   C6  WoW: E - 1 s counts, E does not (the end pay at E + 1 min, t1 = E)
 *   C7  OoT: v1 hunt_hits, hunt_combat_log, combat_actions (hunt), v2 day started, v2 day ended in the window = 5 gifts;
 *       3 members at L - 1 s = 0; a tester practice day (state.practice_ended) at L + 1 s = 0
 *   C8  OoT: v2 day and v1 hit at E - 1 s count, at E do not
 *   C9  an event made after its start (starts_at 2 days ago): scheduled is accepted, the first tick pays the visit since the start
 *   C10 once: 3 ticks + the end pay, 4 visits and 3 Hunt rows = 1 WoW gift + 1 OoT gift
 *   C11 the ledger: Redeem of a WoW gift = 1 card_ledger row (reason event, ref_kind gift, ref_id = the gift id), player_cards +1
 *   C12 the old triggers (tutorial_done, pack_opened, dungeon_run, v1 hunt_hit) give the same recipients before and after B2
 *   L4  apply -> undo -> apply: md5(pg_get_functiondef) new -> base -> new
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MIG = read(args[0] || '../tcg-bot/supabase/evt2_event_triggers.sql');
const UNDO = read(args[1] || '../tcg-bot/supabase/evt2_event_triggers_undo.sql');
// The function text only (no GUARD, no CHECK block): a mutated copy must not stop at the md5 checks of the file.
const fnOnly = (s) => s.slice(s.indexOf('-- GUARD-END') + 12, s.indexOf('-- CHECK: both functions'));
const md5Of = (s, re) => (s.match(re) || [])[1];
const BASE_R = md5Of(UNDO, /event_recipients \(md5 ([0-9a-f]{32})\)/), BASE_S = md5Of(UNDO, /event_shape_errors \(md5 ([0-9a-f]{32})\)/);

const P = (n) => `tst_e2_${n}`;
const L = `timestamptz '2026-11-06 19:00:00+00'`, E = `timestamptz '2026-12-01 07:00:00+00'`;
const iso = (x) => `to_char((${x}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// opt: test-side mutations (C6b/C8b end, C9 start, C10 index, C11 admin claim)
const body = (fn, opt = {}) => String.raw`do $t$
declare res jsonb := '[]'; got jsonb; r jsonb; ok boolean; n int; wc bigint; oc bigint; hb bigint; g bigint; ewow bigint; eoot bigint; ec9 bigint; e10a bigint; e10b bigint;
  m_base_r text; m_base_s text; m_r text; m_s text; base jsonb; aft jsonb; before_q int; s0 timestamptz := ${L} - interval '2 days';
  endsx timestamptz := ${opt.ends || E};
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_e2_admin', true);
  -- L4 apply -> undo -> apply (the full files, with their guards and checks)
  execute $m$${UNDO}$m$;
  m_base_r := md5(replace(pg_get_functiondef('public.event_recipients(public.events, timestamp with time zone)'::regprocedure), chr(13), ''));
  m_base_s := md5(replace(pg_get_functiondef('public.event_shape_errors(text, jsonb, jsonb, jsonb)'::regprocedure), chr(13), ''));
  execute $m$${MIG}$m$;
  m_r := md5(replace(pg_get_functiondef('public.event_recipients(public.events, timestamp with time zone)'::regprocedure), chr(13), ''));
  m_s := md5(replace(pg_get_functiondef('public.event_shape_errors(text, jsonb, jsonb, jsonb)'::regprocedure), chr(13), ''));
  execute $m$${UNDO}$m$;
  ok := md5(replace(pg_get_functiondef('public.event_recipients(public.events, timestamp with time zone)'::regprocedure), chr(13), '')) = '${BASE_R}'
    and md5(replace(pg_get_functiondef('public.event_shape_errors(text, jsonb, jsonb, jsonb)'::regprocedure), chr(13), '')) = '${BASE_S}';
  execute $m$${MIG}$m$;
  res := res || jsonb_build_object('case', 'L4 apply -> undo -> apply: md5 base -> new -> base -> new', 'ok', ok and m_base_r = '${BASE_R}' and m_base_s = '${BASE_S}'
    and m_r <> m_base_r and m_s <> m_base_s
    and md5(replace(pg_get_functiondef('public.event_recipients(public.events, timestamp with time zone)'::regprocedure), chr(13), '')) = m_r
    and md5(replace(pg_get_functiondef('public.event_shape_errors(text, jsonb, jsonb, jsonb)'::regprocedure), chr(13), '')) = m_s,
    'got', jsonb_build_array(m_base_r, m_base_s, m_r, m_s));

  -- fixtures (members created 30 days before L)
  insert into players (id, username, created_at) select 'tst_e2_' || i, 'tst e2 ' || i, ${L} - interval '30 days' from generate_series(1, 40) i;
  select id into wc from cards where rarity = 'event' order by id limit 1;
  select id into oc from cards where rarity = 'event' order by id offset 1 limit 1;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Tst E2 Boss', 'Normal', '[]', '[]', 500000, 500000, ${E}) returning id into hb;

  -- C12 the recipients of the old triggers with the BASE functions (the undo text) ------------------------------------------
  execute $m$${fnOnly(UNDO.replace(/^[\s\S]*?-- GUARD-END/, '-- GUARD-END') + '\n-- CHECK: both functions')}$m$;
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id, created_at) values
    ('${P(30)}', 1, 'tutorial', 'tutorial', 'complete', s0 + interval '1 hour'), ('${P(31)}', 1, 'tutorial', 'tutorial', 'complete', s0 - interval '1 hour'),
    ('${P(32)}', -1, 'opened', 'open', 'tst_e2_o1', s0 + interval '2 hours'), ('${P(33)}', -1, 'opened', 'open', 'tst_e2_o2', s0 - interval '2 hours');
  insert into dungeon_runs (player_id, day, squad, state, started_at) values ('${P(34)}', game_day(s0), array[wc], '{}', s0 + interval '3 hours'),
    ('${P(35)}', game_day(s0) - 1, array[wc], '{}', s0 - interval '3 hours');
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) values (hb, '${P(36)}', wc, game_day(s0), 5, s0 + interval '4 hours'), (hb, '${P(37)}', wc, game_day(s0), 5, s0 - interval '4 hours');
  insert into hunt_combat_log (hunt_id, player_id, card_id, ts, outcome, damage) values (hb, '${P(38)}', wc, s0 + interval '5 hours', 'hit', 9), (hb, '${P(39)}', wc, s0 - interval '5 hours', 'hit', 9);
  select jsonb_agg(x.v order by x.i) into base from (
    select x.i, (select coalesce(jsonb_agg(y.member_id order by y.member_id), '[]')
                   from event_recipients(jsonb_populate_record(null::events, jsonb_build_object('id', null, 'key', 'tst_e2_x', 'kind', 'trigger', 'title', 'x', 'status', 'live',
                     'starts_at', s0, 'ends_at', s0 + interval '1 day', 'audience', '{"all": true}'::jsonb,
                     'rewards', '{"per_member": {"packs": 1}}'::jsonb, 'rules', jsonb_build_object('trigger', x.k), 'created_by', 'x')), s0 + interval '1 day') y
                  where y.member_id like 'tst_e2_%') v
      from (values (1, 'tutorial_done'), (2, 'pack_opened'), (3, 'dungeon_run'), (4, 'hunt_hit')) x(i, k)) x;
  execute $m$${fn}$m$;   -- B2 (or its mutation)
  select jsonb_agg(x.v order by x.i) into aft from (
    select x.i, (select coalesce(jsonb_agg(y.member_id order by y.member_id), '[]')
                   from event_recipients(jsonb_populate_record(null::events, jsonb_build_object('id', null, 'key', 'tst_e2_x', 'kind', 'trigger', 'title', 'x', 'status', 'live',
                     'starts_at', s0, 'ends_at', s0 + interval '1 day', 'audience', '{"all": true}'::jsonb,
                     'rewards', '{"per_member": {"packs": 1}}'::jsonb, 'rules', jsonb_build_object('trigger', x.k), 'created_by', 'x')), s0 + interval '1 day') y
                  where y.member_id like 'tst_e2_%') v
      from (values (1, 'tutorial_done'), (2, 'pack_opened'), (3, 'dungeon_run'), (4, 'hunt_hit')) x(i, k)) x;
  res := res || jsonb_build_object('case', 'C12 old triggers unchanged: tutorial_done, pack_opened, dungeon_run, v1 hunt_hit recipients before B2 = after B2', 'ok',
    base = aft and base = jsonb_build_array('["${P(30)}"]'::jsonb, '["${P(32)}"]'::jsonb, '["${P(34)}"]'::jsonb, '["${P(36)}", "${P(38)}"]'::jsonb), 'got', jsonb_build_array(base, aft));
  delete from pack_ledger where player_id like 'tst_e2_%'; delete from dungeon_runs where player_id like 'tst_e2_%';
  delete from hunt_hits where player_id like 'tst_e2_%'; delete from hunt_combat_log where player_id like 'tst_e2_%';

  -- the shape check: app_visit is a valid trigger, an unknown one gives the new text
  res := res || jsonb_build_object('case', 'B2a event_shape_errors: app_visit allowed; unknown trigger -> the new error text', 'ok',
    cardinality(event_shape_errors('trigger', '{"all": true}', jsonb_build_object('per_member', jsonb_build_object('card_id', wc)), '{"trigger": "app_visit"}')) = 0
    and event_shape_errors('trigger', '{"all": true}', jsonb_build_object('per_member', jsonb_build_object('card_id', wc)), '{"trigger": "login"}')
        = array['rules: trigger must be hunt_hit, tutorial_done, pack_opened, dungeon_run or app_visit']);

  -- the 2 events (as E10: admin_event_save + admin_event_status scheduled), audience everyone, [L, E) ------------------------
  r := admin_event_save(jsonb_build_object('key', 'tst_e2_wow', 'kind', 'trigger', 'title', 'The Forever Queue', 'starts_at', ${iso(L)}, 'ends_at', ${iso('endsx')},
    'audience', '{"all": true}'::jsonb, 'rules', '{"trigger": "app_visit"}'::jsonb, 'rewards', jsonb_build_object('per_member', jsonb_build_object('card_id', wc))), null, 'nathan', 'tst');
  ewow := (r->'event'->>'id')::bigint;
  r := admin_event_status(ewow, (select updated_at from events where id = ewow), 'nathan', 'scheduled', 'tst');
  r := admin_event_save(jsonb_build_object('key', 'tst_e2_oot', 'kind', 'trigger', 'title', 'Hand-Me-Down Hero', 'starts_at', ${iso(L)}, 'ends_at', ${iso('endsx')},
    'audience', '{"all": true}'::jsonb, 'rules', '{"trigger": "hunt_hit"}'::jsonb, 'rewards', jsonb_build_object('per_member', jsonb_build_object('card_id', oc))), null, 'nathan', 'tst');
  eoot := (r->'event'->>'id')::bigint;
  r := admin_event_status(eoot, (select updated_at from events where id = eoot), 'nathan', 'scheduled', 'tst');
  res := res || jsonb_build_object('case', 'setup: both events scheduled with starts_at L, ends_at E', 'ok',
    (select count(*) from events where id in (ewow, eoot) and status = 'scheduled' and starts_at = ${L} and ends_at = endsx) = 2, 'got', r);
  ${opt.dropIndex ? 'drop index gift_claims_event_once;' : ''}

  -- WoW visits (app_sessions)
  insert into app_sessions (player_id, started_at, last_seen_at) values
    ('${P(1)}', ${L} - interval '1 second', ${L} - interval '1 second'),                 -- C3 1 s before L
    ('${P(2)}', ${L}, ${L}), ('${P(3)}', ${L} + interval '1 second', ${L} + interval '1 second'),  -- C4 at L, L + 1 s
    ('${P(4)}', ${L} - interval '10 minutes', ${L} + interval '3 minutes'),               -- C5 A: started before L, continued
    ('${P(5)}', ${L} - interval '10 minutes', ${L} + interval '3 minutes'), ('${P(5)}', ${L} + interval '40 minutes', ${L} + interval '41 minutes'), -- C5 B
    ('${P(6)}', ${E} - interval '1 second', ${E} - interval '1 second'),                 -- C6 A: E - 1 s
    ('${P(7)}', ${E}, ${E}),                                                             -- C6 B: E
    ('${P(20)}', ${L} + interval '1 minute', ${L} + interval '2 minutes'), ('${P(20)}', ${L} + interval '2 hours', ${L} + interval '2 hours'),
    ('${P(20)}', ${L} + interval '3 days', ${L} + interval '3 days'), ('${P(20)}', ${E} - interval '1 hour', ${E} - interval '1 hour');  -- C10 4 visits
  -- OoT Hunt rows
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage, created_at) values
    (hb, '${P(8)}', wc, game_day(${L}), 5, ${L} + interval '1 second'),                  -- C7 v1 hit
    (hb, '${P(13)}', wc, game_day(${L}), 5, ${L} - interval '1 second'),                 -- C7 before L
    (hb, '${P(18)}', wc, game_day(${E}), 5, ${E} - interval '1 second'),                 -- C8 v1 hit E - 1 s
    (hb, '${P(19)}', wc, game_day(${E}), 5, ${E}),                                       -- C8 v1 hit E
    (hb, '${P(20)}', wc, game_day(${L}), 5, ${L} + interval '5 minutes');                -- C10
  insert into hunt_combat_log (hunt_id, player_id, card_id, ts, outcome, damage) values (hb, '${P(9)}', wc, ${L} + interval '1 second', 'hit', 9),
    (hb, '${P(20)}', wc, ${L} + interval '1 day', 'hit', 9);
  insert into combat_actions (mode, ref_id, player_id, card_id, kind, game_day, created_at) values
    ('hunt', hb, '${P(10)}', wc, 'support', game_day(${L}), ${L} + interval '1 second'),
    ('hunt', hb, '${P(15)}', wc, 'support', game_day(${L}), ${L} - interval '1 second'),
    ('dungeon', hb, '${P(21)}', wc, 'support', game_day(${L}), ${L} + interval '1 second');   -- not a Hunt
  insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, started_at, ended_at) values
    (hb, '${P(11)}', game_day(${L}), 'x', array[wc], '{}', 1, ${L} + interval '1 second', null),                          -- C7 v2 started
    (hb, '${P(12)}', game_day(${L}), 'x', array[wc], '{}', 1, ${L} - interval '60 seconds', ${L} + interval '60 seconds'), -- C7 v2 ended in window
    (hb, '${P(14)}', game_day(${L}), 'x', array[wc], '{}', 1, ${L} - interval '1 second', ${L} - interval '1 second'),    -- C7 before L
    (hb, '${P(16)}', game_day(${L}), 'x', array[wc], '{"practice_ended": true}', 1, ${L} + interval '1 second', ${L} + interval '2 seconds'), -- C7 practice
    (hb, '${P(17)}', game_day(${E}), 'x', array[wc], '{}', 1, ${E} - interval '1 second', null),                          -- C8 v2 E - 1 s
    (hb, '${P(22)}', game_day(${E}), 'x', array[wc], '{}', 1, ${E}, null);                                                -- C8 v2 E

  -- the ticks: L + 10 min (C3-C5, C7), 2 more ticks, then the end pay at E + 1 min (t1 = E)
  perform event_step(ewow, ${L} + interval '10 minutes'); perform event_step(eoot, ${L} + interval '10 minutes');
  select coalesce(jsonb_agg(player_id order by player_id), '[]') into got from gift_claims where event_id = ewow and player_id in ('${P(2)}', '${P(3)}');
  res := res || jsonb_build_object('case', 'C4 WoW: the first tick after L pays the visits at L and at L + 1 s (1 gift each)', 'ok',
    got = '["${P(2)}", "${P(3)}"]'::jsonb and (select count(*) from gift_claims where event_id = ewow and player_id in ('${P(2)}', '${P(3)}')) = 2, 'got', got);
  perform event_step(ewow, ${L} + interval '1 hour'); perform event_step(eoot, ${L} + interval '1 hour');
  perform event_step(ewow, ${L} + interval '4 days'); perform event_step(eoot, ${L} + interval '4 days');
  perform event_step(ewow, ${E} + interval '1 minute'); perform event_step(eoot, ${E} + interval '1 minute');
  select coalesce(jsonb_object_agg(player_id, c), '{}') into got from (select player_id, count(*) c from gift_claims where event_id = ewow and player_id like 'tst_e2_%' group by 1) x;
  res := res || jsonb_build_object('case', 'C3 WoW: a visit 1 s before L = no gift', 'ok', not got ? '${P(1)}', 'got', got);
  res := res || jsonb_build_object('case', 'C4 WoW: visits at L and L + 1 s = 1 gift each (after all ticks)', 'ok', got->>'${P(2)}' = '1' and got->>'${P(3)}' = '1', 'got', got);
  res := res || jsonb_build_object('case', 'C5 WoW: started before L, continued after L = no gift; its next visit after L = 1 gift', 'ok', not got ? '${P(4)}' and got->>'${P(5)}' = '1', 'got', got);
  res := res || jsonb_build_object('case', 'C6 WoW: E - 1 s = 1 gift, E = no gift', 'ok', got->>'${P(6)}' = '1' and not got ? '${P(7)}', 'got', got);
  res := res || jsonb_build_object('case', 'WoW: only the members with a qualifying visit get the card', 'ok',
    (select coalesce(jsonb_agg(k order by k), '[]') from jsonb_object_keys(got) k) = '["${P(2)}", "${P(20)}", "${P(3)}", "${P(5)}", "${P(6)}"]'::jsonb, 'got', got);
  select coalesce(jsonb_object_agg(player_id, c), '{}') into got from (select player_id, count(*) c from gift_claims where event_id = eoot and player_id like 'tst_e2_%' group by 1) x;
  res := res || jsonb_build_object('case', 'C7 OoT: v1 hit, combat log, combat_actions hunt, v2 started, v2 ended in window = 1 gift each', 'ok',
    got->>'${P(8)}' = '1' and got->>'${P(9)}' = '1' and got->>'${P(10)}' = '1' and got->>'${P(11)}' = '1' and got->>'${P(12)}' = '1', 'got', got);
  res := res || jsonb_build_object('case', 'C7 OoT: the 3 members at L - 1 s (v1 hit, v2 day, combat_actions) = no gift', 'ok',
    not (got ?| array['${P(13)}', '${P(14)}', '${P(15)}']), 'got', got);
  res := res || jsonb_build_object('case', 'C7 OoT: a tester practice day (practice_ended) at L + 1 s = no gift; a dungeon support tap = no gift', 'ok',
    not got ? '${P(16)}' and not got ? '${P(21)}', 'got', got);
  res := res || jsonb_build_object('case', 'C8 OoT: v2 day and v1 hit at E - 1 s = a gift; at E = no gift', 'ok',
    got->>'${P(17)}' = '1' and got->>'${P(18)}' = '1' and not got ? '${P(19)}' and not got ? '${P(22)}', 'got', got);
  res := res || jsonb_build_object('case', 'C10 once: 3 ticks + the end pay, 4 visits and 3 Hunt rows = 1 WoW gift + 1 OoT gift', 'ok',
    (select count(*) from gift_claims where event_id = ewow and player_id = '${P(20)}') = 1 and got->>'${P(20)}' = '1', 'got', got);
  res := res || jsonb_build_object('case', 'both events ended at the end pay', 'ok', (select count(*) from events where id in (ewow, eoot) and status = 'ended') = 2);

  -- C11 the ledger: Redeem of the WoW gift of P(2)
  select id into g from gift_claims where event_id = ewow and player_id = '${P(2)}' order by id limit 1;
  before_q := coalesce((select sum(quantity) from player_cards where player_id = '${P(2)}' and card_id = wc), 0);
  ${opt.adminClaim ? `update gift_claims set claimed_at = now() where id = g; perform add_card_to_player('${P(2)}', wc, 'admin');` : `r := claim_gift('${P(2)}', g);`}
  select coalesce(jsonb_agg(jsonb_build_array(amount, reason, ref_kind, ref_id = g::text)), '[]') into got from card_ledger where player_id = '${P(2)}' and card_id = wc;
  res := res || jsonb_build_object('case', 'C11 Redeem: 1 card_ledger row (reason event, ref_kind gift, ref_id = the gift id), player_cards +1', 'ok',
    got = '[[1, "event", "gift", true]]'::jsonb and coalesce((select sum(quantity) from player_cards where player_id = '${P(2)}' and card_id = wc), 0) = before_q + 1, 'got', got);

  -- C9 an event made 2 days after its start (the retroactive window, F8)
  insert into app_sessions (player_id, started_at, last_seen_at) values ('${P(23)}', now() - interval '2 days' + interval '1 hour', now() - interval '2 days' + interval '1 hour');
  r := admin_event_save(jsonb_build_object('key', 'tst_e2_c9', 'kind', 'trigger', 'title', 'Tst C9', 'starts_at', ${iso(opt.c9start || "now() - interval '2 days'")}, 'ends_at', ${iso("now() + interval '1 day'")},
    'audience', '{"all": true}'::jsonb, 'rules', '{"trigger": "app_visit"}'::jsonb, 'rewards', jsonb_build_object('per_member', jsonb_build_object('card_id', wc))), null, 'nathan', 'tst');
  ec9 := (r->'event'->>'id')::bigint;
  r := admin_event_status(ec9, (select updated_at from events where id = ec9), 'nathan', 'scheduled', 'tst');
  ok := r->>'ok' = 'true';
  perform event_step(ec9, now());
  res := res || jsonb_build_object('case', 'C9 retroactive: scheduled accepts a past start; the first tick pays the visit since the start (1 gift)', 'ok',
    ok and (select count(*) from gift_claims where event_id = ec9 and player_id = '${P(23)}') = 1, 'got', r);

  raise exception 'RESULTS %', res;
end $t$;`;

const run = async (fn, opt) => {
  const out = JSON.stringify(await q(body(fn, opt)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1500) };
  return { results: JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')) };
};
const id = (c) => c.split(' ')[0];
const show = (r, tag) => {
  if (r.error) { console.log(`FAIL ${tag}NO RESULTS: ${r.error}`); return 1; }
  let f = 0;
  for (const x of r.results) { if (!x.ok) f++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${tag}${x.case}${x.ok || x.got === undefined ? '' : ` got ${JSON.stringify(x.got)}`}`); }
  return f;
};

const FN = fnOnly(MIG);
console.log(`test-evt2-triggers: base md5 event_recipients ${BASE_R}, event_shape_errors ${BASE_S}`);
const base = await run(FN);
let fail = show(base, '');
console.log(fail ? `${fail} FAILED` : `PASS all ${base.results.length}`);

// Mutations (SPEC section 6): [id, the condition that must FAIL, B2 text from -> to | a test option]
const MUT = [
  ['C3', 'C3', "s.started_at >= t0 and s.started_at < t1", "s.started_at >= t0 - interval '1 minute' and s.started_at < t1"],
  ['C4', 'C4', "when 'app_visit' then exists (select 1 from app_sessions s where s.player_id = au.member_id and s.started_at >= t0 and s.started_at < t1)", "when 'app_visit' then false"],
  ['C5', 'C5', "s.started_at >= t0 and s.started_at < t1)", "((s.started_at >= t0 and s.started_at < t1) or (s.last_seen_at >= t0 and s.last_seen_at < t1)))"],
  ['C6a', 'C6', "s.started_at >= t0 and s.started_at < t1", "s.started_at >= t0 and s.started_at <= t1"],
  ['C6b', 'C6', null, null, { ends: "timestamptz '2026-12-01 06:59:00+00'" }],
  ['C7a', 'C7', "                         or exists (select 1 from hunt_v2_days v where v.player_id = au.member_id and not coalesce((v.state->>'practice_ended')::boolean, false)\n                                     and ((v.started_at >= t0 and v.started_at < t1) or (v.ended_at >= t0 and v.ended_at < t1)))\n", ''],
  ['C7b', 'C7', "                         or exists (select 1 from combat_actions a where a.player_id = au.member_id and a.mode = 'hunt' and a.created_at >= t0 and a.created_at < t1)\n", ''],
  ['C7c', 'C7', "((v.started_at >= t0 and v.started_at < t1) or (v.ended_at >= t0 and v.ended_at < t1))", "(v.day >= game_day(t0) and v.day <= game_day(t1))"],
  ['C7p', 'C7', " and not coalesce((v.state->>'practice_ended')::boolean, false)", ''],
  ['C8a', 'C8', "(v.started_at >= t0 and v.started_at < t1)", "(v.started_at >= t0 and v.started_at <= t1)"],
  ['C8b', 'C8', "h.created_at >= t0 and h.created_at < t1", "h.created_at >= t0 and h.created_at <= t1"],
  ['C8c', 'C8', null, null, { ends: "timestamptz '2026-12-01 06:59:00+00'" }],
  ['C9', 'C9', null, null, { c9start: 'now()' }],
  ['C10', 'C10', null, null, { dropIndex: true }],
  ['C11', 'C11', null, null, { adminClaim: true }],
  ['C12', 'C12', "l.reason = 'opened' and l.created_at >= t0 and l.created_at < t1)", "l.reason = 'opened' and l.created_at >= t0 - interval '1 day' and l.created_at < t1)"],
];
const want = process.env.MUTATE || '';
if (want) {
  let caught = 0, ran = 0;
  for (const [mid, cond, from, to, opt] of MUT) {
    if (want !== 'all' && want !== mid) continue;
    ran++;
    let fn = FN;
    if (from !== null) {
      if (fn.split(from).length !== 2) { console.log(`MUTATION ${mid} text not found once`); fail++; continue; }
      fn = fn.split(from).join(to);
    }
    const r = await run(fn, opt || {});
    console.log(`--- mutation ${mid} (expect ${cond} to FAIL)`);
    show(r, `[${mid}] `);
    const hit = !r.error && r.results.some((x) => !x.ok && id(x.case) === cond);
    if (hit) caught++; else fail++;
    console.log(`mutation ${mid}: ${hit ? `caught (${cond} FAIL)` : `NOT CAUGHT (${r.error ? 'error' : cond + ' passed'})`}`);
  }
  console.log(`mutations caught ${caught}/${ran}`);
  const again = await run(FN);
  const f2 = show(again, '[baseline again] ');
  fail += f2;
  console.log(f2 ? `baseline again: ${f2} FAILED` : `baseline again: PASS all ${again.results.length}`);
}
process.exitCode = fail ? 1 : 0;
