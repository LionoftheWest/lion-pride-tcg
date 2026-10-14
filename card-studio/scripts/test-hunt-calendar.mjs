/**
 * Acceptance test for tcg-bot/supabase/hunt_calendar.sql (F-1 PR 2), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-calendar.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                        must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                           runs every mutation and prints one line each
 * Invariants (docs/foundations.md F-1 items 3 and 4, acceptance tests 3 and 5, the moved end, the change of daylight saving time):
 *   1. The seed: the template Weekly Hunt (kind hunt, 4 days 2 hours) and the repeat weekly_hunt (Thursday 15:00 America/Denver);
 *      every row it makes starts Thursday 15:00 and ends Monday 17:00 on the Denver clock, also across a DST change (fall and
 *      spring). An active boss from the old job becomes a live Hunt event (adopted), linked by hunts.event_id.
 *   2. The fixed jobs hunt-*-mt are gone, weekly_boss_tick and close_weekly_boss are gone, the job event-repeats exists;
 *      next_hunt_spawn is the start of the next scheduled Hunt event.
 *   3. Three Hunt events in one week spawn three bosses (tier from rules.tier), one each (never again, also after a defeat).
 *      Each closes at its own end; a live edit of the end moves closes_at (earlier and later); the boss is not closed at the old
 *      end; each reward pays once (pack_ledger hunt_reward, once per member and boss), also after more ticks and close_due_hunts.
 *      An overlap of two Hunt events is refused. A cancel closes the boss.
 *   4. The nudge: once, 6 hours before the end; none in a window of 6 hours or less. The daily raid board posts for an event boss.
 *   5. A repeat makes the next 4 weeks (idempotent); a change to one week leaves the template and the other weeks the same; a
 *      cancelled week is not made again; a later fill adds the next week only. An unknown time zone is refused.
 *   6. A Hunt event with rewards, another audience or a bad tier is refused; event_pay never pays a Hunt. 7. RLS and grants.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/hunt_calendar.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
// The guard checks the database it runs on; inside the test the file runs twice, so it is not part of what is tested.
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  nospawn: ["return jsonb_build_object('spawn', spawn_weekly_boss(p_e.ends_at, p_e.id, p_e.rules->>'tier'));", 'return null;'],
  nolink: ['update hunts set closes_at = v_close, event_id = p_event_id where id = v_new;', 'update hunts set closes_at = v_close where id = v_new;'],
  notier: ["spawn_weekly_boss(p_e.ends_at, p_e.id, p_e.rules->>'tier')", 'spawn_weekly_boss(p_e.ends_at, p_e.id, null)'],
  respawn: ['select * into h from hunts where event_id = p_e.id;', "select * into h from hunts where event_id = p_e.id and status = 'active';"],
  noclosesync: ["update hunts set closes_at = new.ends_at where event_id = new.id and status = 'active';", 'null;'],
  noclose: ["perform close_hunt(h.id) from hunts h where h.event_id = new.id and h.status = 'active';", 'null;'],
  nooverlap: ["x.status in ('scheduled', 'live') and x.starts_at < p_e.ends_at and x.ends_at > p_e.starts_at", 'false'],
  dst: ['en := ((d + r.at_time) + t.default_length) at time zone r.tz;', 'en := s + t.default_length;'],
  dststart: ['s := (d + r.at_time) at time zone r.tz;', "s := (d + r.at_time) at time zone 'America/Phoenix';"],
  refill: ['continue when exists (select 1 from events x where x.key = v_key);', ''],
  weeks: ['exit when s > p_now + make_interval(days => 7 * r.weeks_ahead);', 'exit when s > p_now + make_interval(days => 7 * r.weeks_ahead - 7);'],
  nonudge: ["if h.status = 'active' and p_now >= p_e.ends_at - c_nudge", "if false and p_now >= p_e.ends_at - c_nudge"],
  nudgeonce: ["\n     and not exists (select 1 from hunt_events x where x.hunt_id = h.id and x.kind = 'nudge') then", ' then'],
  nudgeshort: [' and p_e.ends_at - c_nudge > p_e.starts_at', ''],
  cron: ["perform cron.unschedule(j.jobname) from cron.job j where j.jobname in ('hunt-spawn-mt', 'hunt-nudge-mt', 'hunt-close-mt-mdt', 'hunt-close-mt-mst');", ''],
  dropold: ['drop function if exists public.close_weekly_boss();', ''],
  nextspawn: ["select min(starts_at) from events where kind = 'hunt' and status = 'scheduled';", 'select hunt_next_mt(4, 15, now());'],
  adopt: ['if v_id is not null then update hunts set event_id = v_id where id = h.id; end if;', ''],
  payhunt: ["if e.kind in ('launch_cards', 'modifier', 'hunt') then", "if e.kind in ('launch_cards', 'modifier') then"],
  huntrewards: ["if p_rewards <> '{}'::jsonb then e := e || 'rewards: a Hunt pays", "if false then e := e || 'rewards: a Hunt pays"],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(12)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const A = 'tst_hunt_cal_admin';
const body = String.raw`do $t$
declare bad text := ''; T timestamptz := date_trunc('second', now()); r jsonb; j record; n int; s text;
  h0 bigint; e0 bigint; rid bigint; tpl bigint; e1 bigint; e2 bigint; e3 bigint; e4 bigint; e5 bigint; b1 bigint; b2 bigint; b3 bigint; b4 bigint; b5 bigint;
  c1 bigint; card bigint := (select id from cards order by id limit 1); w jsonb; w2 jsonb; ids bigint[];
begin
  -- The live state that the file changes: the 4 fixed Hunt jobs and the 2 old functions (the local copy may have neither).
  perform cron.schedule(x, '0 21 * * 4', 'select 1') from unnest(array['hunt-spawn-mt', 'hunt-nudge-mt', 'hunt-close-mt-mdt', 'hunt-close-mt-mst']) x;
  if to_regprocedure('public.close_weekly_boss()') is null then execute 'create function public.close_weekly_boss() returns jsonb language sql as ''select null::jsonb'''; end if;
  -- An active boss from the old job (no event): the file adopts it.
  perform close_hunt(id) from hunts where status = 'active';
  h0 := spawn_hunt(7);
  update hunts set closes_at = T + interval '1 hour' where id = h0;
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent
  perform set_config('balance.by', '${A}', true);

  -- 1. The seed and the adopted boss.
  select id into tpl from event_templates where name = 'Weekly Hunt' and kind = 'hunt' and default_length = interval '4 days 2 hours' and rules = '{}' and rewards = '{}';
  select id into rid from event_repeats where key_prefix = 'weekly_hunt' and template_id = tpl and weekday = 4 and at_time = time '15:00' and tz = 'America/Denver' and weeks_ahead = 4 and active;
  if tpl is null or rid is null then raise exception 'RESULT:FAIL 1: the seed template or repeat is missing or wrong'; end if;
  select event_id into e0 from hunts where id = h0;
  if e0 is null or not exists (select 1 from events where id = e0 and kind = 'hunt' and status = 'live' and key = 'hunt_' || h0 and ends_at = T + interval '1 hour' and repeat_id = rid) then
    bad := bad || '1: the active boss was not adopted as a live Hunt event; ';
  end if;
  select count(*) into n from events where repeat_id = rid and status = 'scheduled' and starts_at > T;
  if n not between 3 and 4 then bad := bad || format('1: the fill at now made %s weekly rows, not 4; ', n); end if;
  if exists (select 1 from events where repeat_id = rid and status = 'scheduled' and starts_at > T
               and not (extract(isodow from starts_at at time zone 'America/Denver') = 4 and (starts_at at time zone 'America/Denver')::time = time '15:00'
                        and extract(isodow from ends_at at time zone 'America/Denver') = 1 and (ends_at at time zone 'America/Denver')::time = time '17:00')) then
    bad := bad || '1: a weekly row is not Thursday 15:00 to Monday 17:00 Denver; ';
  end if;
  -- the change of daylight saving time (2030-11-03 and 2030-03-10)
  r := event_repeats_fill('2030-10-25 12:00+00');
  if (select count(*) from events where repeat_id = rid and key like 'weekly\_hunt\_2030%') <> 4 then bad := bad || '1: the fall fill did not make 4 rows: ' || (r->'rows')::text || '; '; end if;
  if not exists (select 1 from events where key = 'weekly_hunt_20301031' and starts_at = '2030-10-31 21:00+00' and ends_at = '2030-11-05 00:00+00' and status = 'scheduled' and kind = 'hunt')
     or not exists (select 1 from events where key = 'weekly_hunt_20301107' and starts_at = '2030-11-07 22:00+00' and ends_at = '2030-11-12 00:00+00') then
    bad := bad || '1: fall DST: ' || coalesce((select jsonb_agg(jsonb_build_array(key, starts_at, ends_at) order by key) from events where key in ('weekly_hunt_20301031', 'weekly_hunt_20301107'))::text, 'none') || '; ';
  end if;
  r := event_repeats_fill('2030-03-04 12:00+00');
  if not exists (select 1 from events where key = 'weekly_hunt_20300307' and starts_at = '2030-03-07 22:00+00' and ends_at = '2030-03-11 23:00+00') then
    bad := bad || '1: spring DST: ' || coalesce((select jsonb_build_array(starts_at, ends_at) from events where key = 'weekly_hunt_20300307')::text, 'none') || '; ';
  end if;

  -- 2. The jobs and the removed functions.
  if exists (select 1 from cron.job where jobname in ('hunt-spawn-mt', 'hunt-nudge-mt', 'hunt-close-mt-mdt', 'hunt-close-mt-mst')) then bad := bad || '2: a fixed hunt-*-mt job is still there; '; end if;
  if not exists (select 1 from cron.job where jobname = 'event-repeats' and schedule = '17 * * * *' and command = 'select public.event_repeats_fill();' and active) then bad := bad || '2: no job event-repeats; '; end if;
  if to_regprocedure('public.weekly_boss_tick(text)') is not null or to_regprocedure('public.close_weekly_boss()') is not null then bad := bad || '2: weekly_boss_tick or close_weekly_boss still exists; '; end if;

  -- 3. Three Hunt events in one week. Nothing else may run a boss during the test.
  update events set status = 'cancelled', ended_at = T where kind = 'hunt' and status in ('scheduled', 'live') and starts_at < T + interval '30 days';
  if not exists (select 1 from hunts where id = h0 and status = 'expired' and settled_at is not null) then bad := bad || '3: the cancel of a live Hunt event did not close its boss; '; end if;
  perform close_hunt(id) from hunts where status = 'active';
  insert into players (id, username) values ('tst_hc_1', 'hc1'), ('tst_hc_2', 'hc2') on conflict do nothing;
  create function pg_temp.tst_hunt(p_key text, p_s timestamptz, p_e timestamptz, p_tier text) returns bigint language plpgsql as $f$
  declare r jsonb; v bigint;
  begin
    r := admin_event_save(jsonb_build_object('key', p_key, 'kind', 'hunt', 'title', 'Boss ' || p_key, 'starts_at', p_s, 'ends_at', p_e, 'audience', '{"all": true}'::jsonb,
           'rules', case when p_tier is null then '{}'::jsonb else jsonb_build_object('tier', p_tier) end), null, '${A}', null);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 3: the Hunt event % was refused: %', p_key, r; end if;
    v := (r->'event'->>'id')::bigint;
    r := admin_event_schedule(v, (select updated_at from events where id = v), '${A}', true);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 3: the Hunt event % was not scheduled: %', p_key, r; end if;
    return v;
  end $f$;
  e1 := pg_temp.tst_hunt('tst_hc_e1', T - interval '1 minute', T + interval '1 hour', 'Normal');
  e2 := pg_temp.tst_hunt('tst_hc_e2', T + interval '1 hour', T + interval '2 hours', 'Heroic');
  e3 := pg_temp.tst_hunt('tst_hc_e3', T + interval '3 hours', T + interval '4 hours', 'Mythic');
  if next_hunt_spawn() is distinct from T - interval '1 minute' then bad := bad || format('2: next_hunt_spawn = %s, not the next Hunt event start; ', next_hunt_spawn()); end if;
  r := admin_event_save(jsonb_build_object('key', 'tst_hc_bad', 'kind', 'hunt', 'title', 'Overlap', 'starts_at', T + interval '30 minutes', 'ends_at', T + interval '90 minutes'), null, '${A}', null);
  if coalesce((r->>'ok')::boolean, true) or not (r->'errors') ? 'the Hunt overlaps another Hunt event (one boss at a time)' then bad := bad || '3: an overlapping Hunt event was accepted: ' || r::text || '; '; end if;

  perform event_tick(T);
  select id into b1 from hunts where event_id = e1;
  if b1 is null or (select status from events where id = e1) <> 'live' then raise exception 'RESULT:FAIL 3: the start did not spawn the boss of event 1 (%)', bad; end if;
  if not exists (select 1 from hunts where id = b1 and status = 'active' and closes_at = T + interval '1 hour' and tier = 'Normal') then bad := bad || '3: boss 1 closes_at or tier; '; end if;
  if (select count(*) from hunt_events where hunt_id = b1 and kind = 'spawn') <> 1 then bad := bad || '3: boss 1 spawn post; '; end if;
  perform event_tick(T + interval '1 minute');
  if (select count(*) from hunts where event_id = e1) <> 1 or (select count(*) from hunts where status = 'active') <> 1 then bad := bad || '3: a second tick spawned again; '; end if;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (b1, 'tst_hc_1', card, current_date, 500), (b1, 'tst_hc_2', card, current_date, 300);
  -- the moved end, earlier
  r := admin_event_save(jsonb_build_object('id', e1, 'ends_at', T + interval '50 minutes'), (select updated_at from events where id = e1), '${A}', 'shorter');
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || '3: the live end edit was refused ' || r::text || '; '; end if;
  if (select closes_at from hunts where id = b1) <> T + interval '50 minutes' then bad := bad || '3: an earlier end did not move closes_at; '; end if;
  perform event_tick(T + interval '49 minutes');
  if (select status from hunts where id = b1) <> 'active' then bad := bad || '3: boss 1 closed before its end; '; end if;
  perform event_tick(T + interval '50 minutes 1 second');
  if not exists (select 1 from hunts where id = b1 and status = 'expired' and settled_at is not null) or (select status from events where id = e1) <> 'ended' then bad := bad || '3: boss 1 did not close at its end; '; end if;
  -- event 2: the moved end, later; not closed at the old end
  perform event_tick(T + interval '1 hour 1 second');
  select id into b2 from hunts where event_id = e2;
  if b2 is null or not exists (select 1 from hunts where id = b2 and status = 'active' and closes_at = T + interval '2 hours' and tier = 'Heroic') then raise exception 'RESULT:FAIL 3: boss 2 (%)', bad; end if;
  r := admin_event_save(jsonb_build_object('id', e2, 'ends_at', T + interval '3 hours 30 minutes'), (select updated_at from events where id = e2), '${A}', null);
  if coalesce((r->>'ok')::boolean, true) then bad := bad || '3: a live end that overlaps the next Hunt was accepted; '; end if;
  r := admin_event_save(jsonb_build_object('id', e2, 'ends_at', T + interval '2 hours 30 minutes'), (select updated_at from events where id = e2), '${A}', 'longer');
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || '3: the later end was refused ' || r::text || '; '; end if;
  if (select closes_at from hunts where id = b2) <> T + interval '2 hours 30 minutes' then bad := bad || '3: a later end did not move closes_at; '; end if;
  perform event_tick(T + interval '2 hours 1 second');
  if (select status from hunts where id = b2) <> 'active' or (select status from events where id = e2) <> 'live' then bad := bad || '3: boss 2 closed at its OLD end; '; end if;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (b2, 'tst_hc_1', card, current_date, 200);
  perform event_tick(T + interval '2 hours 30 minutes 1 second');
  if not exists (select 1 from hunts where id = b2 and status = 'expired' and settled_at is not null) then bad := bad || '3: boss 2 did not close at its new end; '; end if;
  -- event 3: a defeated boss is never spawned again, and is not paid again at the end
  perform event_tick(T + interval '3 hours 1 second');
  select id into b3 from hunts where event_id = e3;
  if b3 is null or (select tier from hunts where id = b3) <> 'Mythic' then raise exception 'RESULT:FAIL 3: boss 3 (%)', bad; end if;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (b3, 'tst_hc_2', card, current_date, 900);
  update hunts set status = 'defeated', hp_remaining = 0, defeated_at = now() where id = b3;
  perform settle_hunt(b3);
  perform event_tick(T + interval '3 hours 2 minutes');
  if (select count(*) from hunts where event_id = e3) <> 1 or exists (select 1 from hunts where status = 'active') then bad := bad || '3: a boss was spawned again after the defeat; '; end if;
  perform event_tick(T + interval '4 hours 1 second');
  perform event_tick(T + interval '4 hours 30 minutes');
  perform close_due_hunts();
  if (select status from events where id = e3) <> 'ended' or (select status from hunts where id = b3) <> 'defeated' then bad := bad || '3: event 3 end; '; end if;
  if (select count(distinct id) from hunts where event_id in (e1, e2, e3)) <> 3 then bad := bad || '3: not three bosses; '; end if;
  if (select jsonb_agg(closes_at order by id) from hunts where id in (b1, b2, b3)) <> jsonb_build_array(T + interval '50 minutes', T + interval '2 hours 30 minutes', T + interval '4 hours') then
    bad := bad || '3: each boss does not close at its own end: ' || (select jsonb_agg(closes_at order by id) from hunts where id in (b1, b2, b3))::text || '; ';
  end if;
  select jsonb_object_agg(ref_id || ':' || player_id, c) into w from (select ref_id, player_id, count(*) c from pack_ledger
     where reason = 'hunt_reward' and ref_kind = 'hunt' and ref_id in (b1::text, b2::text, b3::text) group by 1, 2) x;
  if w is distinct from jsonb_build_object(b1 || ':tst_hc_1', 1, b1 || ':tst_hc_2', 1, b2 || ':tst_hc_1', 1, b3 || ':tst_hc_2', 1) then bad := bad || '3: the rewards did not pay once each: ' || coalesce(w::text, 'none') || '; '; end if;
  if (select count(*) from hunt_events where hunt_id in (b1, b2) and kind = 'expired') <> 2 then bad := bad || '3: the expired posts; '; end if;

  -- 4. The nudge (6 hours before the end, once) and the daily raid board.
  e4 := pg_temp.tst_hunt('tst_hc_e4', T + interval '5 hours', T + interval '13 hours', 'Mythic');
  e5 := pg_temp.tst_hunt('tst_hc_e5', T + interval '13 hours', T + interval '16 hours', 'Heroic');
  perform event_tick(T + interval '5 hours 1 second');
  select id into b4 from hunts where event_id = e4;
  if b4 is null or (select tier from hunts where id = b4) <> 'Mythic' then raise exception 'RESULT:FAIL 4: boss 4 (%)', bad; end if;
  perform event_tick(T + interval '6 hours 59 minutes');
  if (select count(*) from hunt_events where hunt_id = b4 and kind = 'nudge') <> 0 then bad := bad || '4: the nudge came before 6 hours to the end; '; end if;
  perform event_tick(T + interval '7 hours 1 second');
  perform event_tick(T + interval '8 hours');
  if (select count(*) from hunt_events where hunt_id = b4 and kind = 'nudge' and (payload->>'closes_at')::timestamptz = T + interval '13 hours') <> 1 then
    bad := bad || format('4: %s nudge posts for boss 4, not 1; ', (select count(*) from hunt_events where hunt_id = b4 and kind = 'nudge'));
  end if;
  perform event_tick(T + interval '13 hours 1 second');
  select id into b5 from hunts where event_id = e5;
  if b5 is null or (select status from hunts where id = b4) <> 'expired' or (select tier from hunts where id = b5) <> 'Heroic' then raise exception 'RESULT:FAIL 4: boss 5 (%)', bad; end if;
  perform event_tick(T + interval '15 hours');
  if (select count(*) from hunt_events where hunt_id = b5 and kind = 'nudge') <> 0 then bad := bad || '4: a 3-hour Hunt got a nudge; '; end if;
  -- (the call first: in one OR expression the EXISTS subquery can run before the function writes its row)
  if not daily_raid_board('2030-01-02 13:00+00') then bad := bad || '4: the daily raid board returned false; '; end if;
  if not exists (select 1 from hunt_events where hunt_id = b5 and kind = 'leaderboard') then
    bad := bad || format('4: the daily raid board did not post for the event boss (active %s, b5 %s); ', (select jsonb_agg(id) from hunts where status = 'active'), b5);
  end if;

  -- 5. A repeat (a modifier template): the next 4 weeks; a change to one week; a cancelled week; idempotent.
  insert into event_templates (name, kind, description, vars, default_length, created_by) values ('tst_hc_tpl', 'modifier', 'x', '{"pack_earn_mult": 2}', interval '1 day', '${A}') returning id into tpl;
  insert into event_repeats (template_id, key_prefix, weekday, at_time, tz, weeks_ahead, created_by) values (tpl, 'tst_hc_rep', 6, time '10:00', 'America/Denver', 4, '${A}') returning id into rid;
  r := event_repeats_fill('2031-01-01 12:00+00');
  select array_agg(id order by starts_at) into ids from events where repeat_id = rid;
  if (select jsonb_agg(key order by starts_at) from events where repeat_id = rid) is distinct from '["tst_hc_rep_20310104", "tst_hc_rep_20310111", "tst_hc_rep_20310118", "tst_hc_rep_20310125"]'::jsonb
     or (select count(*) from events where repeat_id = rid and status = 'scheduled' and template_id = tpl and kind = 'modifier' and vars = '{"pack_earn_mult": 2}'
           and (starts_at at time zone 'America/Denver')::time = time '10:00' and ends_at - starts_at = interval '1 day' and title = 'tst_hc_tpl') <> 4 then
    bad := bad || '5: the repeat did not make the next 4 weeks: ' || coalesce((select jsonb_agg(jsonb_build_array(key, starts_at)) from events where repeat_id = rid)::text, 'none') || '; ';
  end if;
  r := event_repeats_fill('2031-01-01 13:00+00');
  if (select count(*) from events where repeat_id = rid) <> 4 then bad := bad || '5: a second fill made rows again; '; end if;
  if cardinality(ids) = 4 then
    select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) into w from events x where x.id in (ids[1], ids[3], ids[4]);
    select to_jsonb(x) - 'updated_at' into w2 from event_templates x where x.id = tpl;
    r := admin_event_save(jsonb_build_object('id', ids[2], 'title', 'Week two', 'vars', '{"pack_earn_mult": 3}'::jsonb, 'ends_at', '2031-01-12 20:00+00'), (select updated_at from events where id = ids[2]), '${A}', null);
    if not coalesce((r->>'ok')::boolean, false) then bad := bad || '5: the edit of one week was refused ' || r::text || '; '; end if;
    if (select vars from events where id = ids[2]) <> '{"pack_earn_mult": 3}' then bad := bad || '5: the edit did not apply; '; end if;
    if (select jsonb_agg(to_jsonb(x) - 'updated_at' order by x.id) from events x where x.id in (ids[1], ids[3], ids[4])) <> w then bad := bad || '5: the edit changed another week; '; end if;
    if (select to_jsonb(x) - 'updated_at' from event_templates x where x.id = tpl) <> w2 then bad := bad || '5: the edit changed the template; '; end if;
    r := admin_event_cancel(ids[3], (select updated_at from events where id = ids[3]), '${A}', null);
    r := event_repeats_fill('2031-01-08 12:00+00');
    if (select jsonb_agg(key || ':' || status order by starts_at) from events where repeat_id = rid) is distinct from
       '["tst_hc_rep_20310104:scheduled", "tst_hc_rep_20310111:scheduled", "tst_hc_rep_20310118:cancelled", "tst_hc_rep_20310125:scheduled", "tst_hc_rep_20310201:scheduled"]'::jsonb then
      bad := bad || '5: after a cancel and a later fill: ' || (select jsonb_agg(key || ':' || status order by starts_at) from events where repeat_id = rid)::text || '; ';
    end if;
  end if;
  begin
    insert into event_repeats (template_id, key_prefix, weekday, at_time, tz, created_by) values (tpl, 'tst_hc_tz', 1, time '09:00', 'Mars/Olympus', '${A}');
    bad := bad || '5: an unknown time zone was accepted; ';
  exception when invalid_parameter_value then null; end;

  -- 6. Refusals.
  for j in select * from (values
    ('{"per_member": {"packs": 1}}'::jsonb, '{"all": true}'::jsonb, '{}'::jsonb, 'rewards: a Hunt pays the Hunt prizes (balance hunt_prizes), so rewards must be {}'),
    ('{}'::jsonb, '{"tutorial_done": true}'::jsonb, '{}'::jsonb, 'audience: a Hunt is for everyone (audience must be {"all": true})'),
    ('{}'::jsonb, '{"all": true}'::jsonb, '{"tier": "Legendary"}'::jsonb, 'rules: tier must be Normal, Heroic or Mythic (no tier = a random tier)'),
    ('{}'::jsonb, '{"all": true}'::jsonb, '{"trigger": "hunt_hit"}'::jsonb, 'rules: unknown key trigger for a hunt event')
  ) x(rewards, audience, rules, err) loop
    r := admin_event_save(jsonb_build_object('key', 'tst_hc_refuse', 'kind', 'hunt', 'title', 'Bad', 'starts_at', '2032-01-01T00:00:00Z', 'ends_at', '2032-01-02T00:00:00Z',
           'rewards', j.rewards, 'audience', j.audience, 'rules', j.rules), null, '${A}', null);
    if coalesce((r->>'ok')::boolean, true) or not (r->'errors') ? j.err then bad := bad || format('6: not refused with "%s": %s; ', j.err, r->'errors'); end if;
  end loop;
  if (event_pay(e1, 'end', T)->>'error') is distinct from 'not_paid_here' then bad := bad || '6: event_pay pays a Hunt; '; end if;

  -- 7. RLS and grants.
  if not (select relrowsecurity from pg_class where oid = 'public.event_repeats'::regclass) or has_table_privilege('anon', 'public.event_repeats', 'select')
     or has_table_privilege('authenticated', 'public.event_repeats', 'select') then bad := bad || '7: event_repeats RLS or grants; '; end if;
  for j in select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('spawn_weekly_boss', 'nudge_hunt', 'event_hunt_step', 'event_repeats_fill', 'next_hunt_spawn') loop
    if has_function_privilege('anon', j.f, 'execute') or has_function_privilege('authenticated', j.f, 'execute') or not has_function_privilege('service_role', j.f, 'execute') then
      bad := bad || format('7: grants of %s; ', j.f);
    end if;
  end loop;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
