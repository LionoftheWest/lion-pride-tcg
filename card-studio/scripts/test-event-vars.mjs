/**
 * Acceptance test for tcg-bot/supabase/event_vars.sql (F-1 PR 1), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-event-vars.mjs     must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                     must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                        runs every mutation and prints one line each
 *   ... scripts/test-event-vars.mjs --live    the same cases on the database as it is (without the file)
 * Invariants (docs/foundations.md F-1, acceptance tests 1, 2, 6, 7, 8 for the SQL part):
 *   1. No live event: every game_var equals its balance value (a factor variable is 1); game_pull_rates equals balance pulls.
 *   2. A live modifier pull_rare_mult = 2: the non-normal rates double, the rates still add up to 1; after the end (End now,
 *      or the time past ends_at) the value is the balance value again. A modifier is never paid (event_pay, event_recipients).
 *   3. Live events combine: multiply (1.5 x 2 = 3), the combined part is kept inside the limits (1.5 x 4 = 6 -> 5); max takes the
 *      largest value; a whole variable is rounded.
 *   4. A value outside the limits, an unknown key, a fraction for a whole variable, a modifier with no vars or with rewards, and a
 *      bad theme are refused by admin_event_save; a direct insert with a bad vars is refused (the trigger).
 *   5. A live event changes its vars (2 -> 4) and its theme; event_log records the old and new vars; its start and kind stay locked.
 *   6. Save as template, then two events from it: a change to one event leaves the template and the other event the same;
 *      template_id is set; a template edit leaves the events the same.
 *   7. The job event-tick runs every minute and calls event_tick. 8. RLS and the grants (anon / authenticated get nothing).
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

const live = process.argv.includes('--live');
let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/event_vars.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
// The guard checks the database it runs on; inside the test the file runs twice, so it is not part of what is tested.
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  nolive: ["where e.status = 'live' and e.vars", "where e.status <> 'cancelled' and e.vars"],   // an ended event still changes the game
  nowindow: [' and e.ends_at > p_now', ''],                                                    // the window end is not read
  noclamp: ['acc := least(greatest(acc, v.min_value), v.max_value);', 'acc := acc;'],
  sum: ["when v.combine = 'multiply' then acc * x", "when v.combine = 'multiply' then acc + x"],
  nolimits: ['if n < v.min_value or n > v.max_value then', 'if false then'],
  unknown: ["if not found then e := e || format('vars: %s is not a variable (event_vars)', k); continue; end if;", 'if false then continue; end if;'],
  notrigger: ['create trigger events_vars_check before insert or update of kind, vars on public.events for each row execute function public.events_vars_check();', ''],
  livelock: ['(c.key, c.kind, c.starts_at, c.audience, c.rewards, c.rules) is distinct from (e.key, e.kind, e.starts_at, e.audience, e.rewards, e.rules)',
    '(c.key, c.kind, c.starts_at, c.audience, c.rewards, c.rules, c.vars) is distinct from (e.key, e.kind, e.starts_at, e.audience, e.rewards, e.rules, e.vars)'],
  livestart: ['(c.key, c.kind, c.starts_at, c.audience, c.rewards, c.rules) is distinct from (e.key, e.kind, e.starts_at, e.audience, e.rewards, e.rules)',
    '(c.key, c.kind, c.audience, c.rewards, c.rules) is distinct from (e.key, e.kind, e.audience, e.rewards, e.rules)'],
  novarsupdate: ['rules = c.rules, vars = c.vars, theme = c.theme\n     where id = v_id', 'rules = c.rules, theme = c.theme\n     where id = v_id'],
  paymod: ["if e.kind in ('launch_cards', 'modifier') then return", "if e.kind = 'launch_cards' then return"],
  rates: ["'normal', 1 - s)", "'normal', (p->'rates'->>'normal')::numeric)"],
  whole: ['return case when v.whole then round(x) else x end;', 'return x;'],
  theme: ["(p_theme->>'color') !~ '^#[0-9A-Fa-f]{6}$'", "(p_theme->>'color') !~ '.*'"],
  tplid: ["'vars', t.vars, 'theme', t.theme, 'template_id', t.id)", "'vars', t.vars, 'theme', t.theme)"],
  cron: ["perform cron.schedule('event-tick', '* * * * *'", "perform cron.schedule('event-tick', '*/10 * * * *'"],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(13)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
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

const A = 'tst_ev_vars_admin';
const body = String.raw`do $t$
declare bad text := ''; T timestamptz := date_trunc('second', now()); r jsonb; r2 jsonb; ev bigint; ev2 bigint; ev3 bigint; up timestamptz; v record;
  base jsonb; rates jsonb; s numeric; tp bigint; tp_before jsonb; e1 bigint; e2 bigint; e2_before jsonb; n int; j record;
begin
  -- hunt_calendar.sql (F-1 PR 2) added the kind hunt, which this file does not know (it adds the kinds check again): the Hunt
  -- events leave inside this test (rolled back).
  if ${live ? 'false' : 'true'} and to_regclass('public.event_repeats') is not null then
    execute 'update hunts set event_id = null where event_id is not null';
    delete from event_log where event_id in (select id from events where kind = 'hunt');
    delete from events where kind = 'hunt';
  end if;
  ${live ? '-- the database as it is' : 'execute $m$' + mig + '$m$;\n  execute $m$' + mig + '$m$; -- two times: idempotent'}
  perform set_config('balance.by', '${A}', true);
  -- No other event may change a variable during the test.
  update events set status = 'cancelled', ended_at = T where status in ('scheduled', 'live') and vars <> '{}'::jsonb;

  -- 1. No live event: game_var = balance.
  for v in select * from event_vars loop
    if game_var(v.key) is distinct from (case when v.balance_path is null then 1 else balance_num(v.balance_key, variadic v.balance_path) end) then
      bad := bad || format('1: game_var(%s) = %s is not the balance value; ', v.key, game_var(v.key));
    end if;
  end loop;
  if (select count(*) from event_vars) < 8 or game_vars() is null or (select count(*) from jsonb_object_keys(game_vars())) <> (select count(*) from event_vars) then bad := bad || '1: game_vars does not list every variable; '; end if;
  if game_var('pack_earn_mult') <> (balance_get('pack_earn_multiplier') #>> '{}')::numeric or game_var('daily_shards') <> balance_num('daily', 'shards') then bad := bad || '1: pack_earn_mult or daily_shards; '; end if;
  base := balance_get('pulls');
  rates := game_pull_rates()->'rates';
  if exists (select 1 from jsonb_each(base->'rates') b where (rates->>b.key)::numeric is distinct from (b.value #>> '{}')::numeric) then bad := bad || '1: game_pull_rates is not balance pulls: ' || rates::text || '; '; end if;

  -- 2. A live modifier pull_rare_mult = 2.
  r := admin_event_save(jsonb_build_object('key', 'tst_vars_mod', 'kind', 'modifier', 'title', 'Double rares', 'starts_at', T - interval '1 minute',
         'ends_at', T + interval '1 hour', 'audience', '{"all": true}'::jsonb, 'vars', '{"pull_rare_mult": 2}'::jsonb, 'theme', '{"name": "Rare rush", "color": "#AA22CC"}'::jsonb), null, '${A}', null);
  if not (r->>'ok')::boolean then raise exception 'RESULT:FAIL 2: the modifier was refused: %', r; end if;
  ev := (r->'event'->>'id')::bigint;
  if game_var('pull_rare_mult') <> 1 then bad := bad || '2: a draft changes the game; '; end if;
  r := admin_event_schedule(ev, (select updated_at from events where id = ev), '${A}', true);
  if not (r->>'ok')::boolean then bad := bad || '2: schedule refused ' || r::text || '; '; end if;
  r := event_tick(T);
  if (select status from events where id = ev) <> 'live' then bad := bad || '2: the tick did not start it; '; end if;
  if game_var('pull_rare_mult') <> 2 then bad := bad || format('2: live pull_rare_mult = %s, not 2; ', game_var('pull_rare_mult')); end if;
  rates := game_pull_rates()->'rates';
  select sum((x.value #>> '{}')::numeric) into s from jsonb_each(rates) x;
  if s <> 1 then bad := bad || format('2: the rates add up to %s; ', s); end if;
  if exists (select 1 from jsonb_each(base->'rates') b where b.key <> 'normal' and (rates->>b.key)::numeric <> 2 * (b.value #>> '{}')::numeric) then bad := bad || '2: a rare rate did not double: ' || rates::text || '; '; end if;
  if (rates->>'normal')::numeric >= (base->'rates'->>'normal')::numeric then bad := bad || '2: normal did not go down; '; end if;
  -- the window: after ends_at the value is the base again, even before the tick ends the event
  if game_var('pull_rare_mult', T + interval '2 hours') <> 1 then bad := bad || '2: the value stays after ends_at; '; end if;
  -- never paid
  if (event_pay(ev, 'start', T)->>'error') is distinct from 'not_paid_here' then bad := bad || '2: event_pay pays a modifier; '; end if;
  if exists (select 1 from event_recipients((select x from events x where x.id = ev), T)) then bad := bad || '2: event_recipients has rows for a modifier; '; end if;

  -- 5. A live edit: vars 2 -> 4 (then 3), theme; start and kind stay locked; event_log records it.
  r := admin_event_save(jsonb_build_object('id', ev, 'vars', '{"pull_rare_mult": 4}'::jsonb, 'theme', '{"name": "Rare rush+", "color": "#AA22CC"}'::jsonb),
         (select updated_at from events where id = ev), '${A}', 'tune');
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || '5: the live vars edit was refused ' || r::text || '; '; end if;
  if game_var('pull_rare_mult') <> 4 then bad := bad || format('5: after the edit pull_rare_mult = %s, not 4; ', game_var('pull_rare_mult')); end if;
  if not exists (select 1 from event_log l where l.event_id = ev and l.action = 'edit' and l.old->'vars' = '{"pull_rare_mult": 2}' and l.new->'vars' = '{"pull_rare_mult": 4}'
                 and l.new->'theme'->>'name' = 'Rare rush+' and l.actor = '${A}') then bad := bad || '5: event_log has no row with the old and new vars; '; end if;
  r := admin_event_save(jsonb_build_object('id', ev, 'starts_at', T - interval '2 minutes'), (select updated_at from events where id = ev), '${A}', null);
  if (r->>'error') is distinct from 'locked' then bad := bad || '5: a live start change was not refused ' || r::text || '; '; end if;
  r := admin_event_save(jsonb_build_object('id', ev, 'kind', 'drop'), (select updated_at from events where id = ev), '${A}', null);
  if (r->>'error') is distinct from 'locked' then bad := bad || '5: a live kind change was not refused; '; end if;
  r := admin_event_save(jsonb_build_object('id', ev, 'vars', '{"pull_rare_mult": 1.5}'::jsonb), (select updated_at from events where id = ev), '${A}', null);

  -- 3. Combine: a second live modifier 2 -> 1.5 x 2 = 3; then 4 -> 6, kept at the limit 5. max and whole.
  r := admin_event_save(jsonb_build_object('key', 'tst_vars_mod2', 'kind', 'modifier', 'title', 'More rares', 'starts_at', T - interval '1 minute',
         'ends_at', T + interval '1 hour', 'vars', '{"pull_rare_mult": 2, "daily_cap": 9, "daily_shards": 1.33}'::jsonb), null, '${A}', null);
  ev2 := (r->'event'->>'id')::bigint;
  if ev2 is null then raise exception 'RESULT:FAIL 3: the second modifier was refused: %', r; end if;
  r := admin_event_save(jsonb_build_object('key', 'tst_vars_mod3', 'kind', 'modifier', 'title', 'Cap', 'starts_at', T - interval '1 minute',
         'ends_at', T + interval '1 hour', 'vars', '{"daily_cap": 12}'::jsonb), null, '${A}', null);
  ev3 := (r->'event'->>'id')::bigint;
  if ev3 is null then raise exception 'RESULT:FAIL 3: the third modifier was refused: %', r; end if;
  perform admin_event_schedule(ev2, (select updated_at from events where id = ev2), '${A}', true);
  perform admin_event_schedule(ev3, (select updated_at from events where id = ev3), '${A}', true);
  perform event_tick(T);
  if game_var('pull_rare_mult') <> 3 then bad := bad || format('3: 1.5 x 2 gave %s, not 3; ', game_var('pull_rare_mult')); end if;
  if game_var('daily_cap') <> greatest(balance_num('daily', 'cap'), 12) then bad := bad || format('3: max of 9 and 12 gave %s; ', game_var('daily_cap')); end if;
  if game_var('daily_shards') <> round(balance_num('daily', 'shards') * 1.33) then bad := bad || format('3: daily_shards x 1.33 gave %s (not rounded); ', game_var('daily_shards')); end if;
  r := admin_event_save(jsonb_build_object('id', ev2, 'vars', '{"pull_rare_mult": 4, "daily_cap": 9, "daily_shards": 1.33}'::jsonb), (select updated_at from events where id = ev2), '${A}', null);
  if game_var('pull_rare_mult') <> 5 then bad := bad || format('3: 1.5 x 4 gave %s, not the limit 5; ', game_var('pull_rare_mult')); end if;
  select sum((x.value #>> '{}')::numeric) into s from jsonb_each(game_pull_rates()->'rates') x;
  if s <> 1 then bad := bad || format('3: at the limit the rates add up to %s; ', s); end if;
  -- End now: every modifier ends, the values are the balance values again.
  perform admin_event_end_now(ev, (select updated_at from events where id = ev), '${A}', null);
  perform admin_event_end_now(ev2, (select updated_at from events where id = ev2), '${A}', null);
  perform admin_event_end_now(ev3, (select updated_at from events where id = ev3), '${A}', null);
  if game_var('pull_rare_mult') <> 1 or game_var('daily_cap') <> balance_num('daily', 'cap') or game_var('daily_shards') <> balance_num('daily', 'shards') then
    bad := bad || format('2: after the end pull_rare_mult = %s, daily_cap = %s; ', game_var('pull_rare_mult'), game_var('daily_cap'));
  end if;
  rates := game_pull_rates()->'rates';
  if exists (select 1 from jsonb_each(base->'rates') b where (rates->>b.key)::numeric is distinct from (b.value #>> '{}')::numeric) then bad := bad || '2: the rates did not return after the end; '; end if;
  if exists (select 1 from gift_claims g where g.event_id in (ev, ev2, ev3)) or exists (select 1 from event_payouts p where p.event_id in (ev, ev2, ev3)) then bad := bad || '2: a modifier paid something; '; end if;

  -- 4. Refusals.
  for j in select * from (values
    ('{"pull_rare_mult": 6}'::jsonb, '{}'::jsonb, 'vars: pull_rare_mult must be from 0.5 to 5'),
    ('{"pull_rare_mult": 0.1}'::jsonb, '{}'::jsonb, 'vars: pull_rare_mult must be from 0.5 to 5'),
    ('{"nope_var": 2}'::jsonb, '{}'::jsonb, 'vars: nope_var is not a variable (event_vars)'),
    ('{"pull_rare_mult": "2"}'::jsonb, '{}'::jsonb, 'vars: pull_rare_mult must be a number'),
    ('{"daily_cap": 7.5}'::jsonb, '{}'::jsonb, 'vars: daily_cap must be a whole number'),
    ('{}'::jsonb, '{}'::jsonb, 'vars: a modifier event changes at least one variable'),
    ('{"pull_rare_mult": 2}'::jsonb, '{"color": "purple"}'::jsonb, 'theme: color must be #RRGGBB'),
    ('{"pull_rare_mult": 2}'::jsonb, '{"music": "x"}'::jsonb, 'theme: unknown key music')
  ) x(vars, theme, err) loop
    r := admin_event_save(jsonb_build_object('key', 'tst_vars_bad', 'kind', 'modifier', 'title', 'Bad', 'starts_at', T, 'ends_at', T + interval '1 hour',
           'vars', j.vars::jsonb, 'theme', j.theme::jsonb), null, '${A}', null);
    if coalesce((r->>'ok')::boolean, true) or not (r->'errors') ? j.err then bad := bad || format('4: %s %s not refused with "%s": %s; ', j.vars, j.theme, j.err, r->'errors'); end if;
  end loop;
  r := admin_event_save(jsonb_build_object('key', 'tst_vars_bad', 'kind', 'modifier', 'title', 'Bad', 'starts_at', T, 'ends_at', T + interval '1 hour',
         'vars', '{"pull_rare_mult": 2}'::jsonb, 'rewards', '{"per_member": {"packs": 1}}'::jsonb), null, '${A}', null);
  if coalesce((r->>'ok')::boolean, true) or not (r->'errors') ? 'rewards: a modifier event gives no rewards (rewards must be {})' then bad := bad || '4: a modifier with rewards; '; end if;
  begin
    insert into events (key, kind, title, starts_at, ends_at, vars, created_by) values ('tst_vars_raw', 'modifier', 'Raw', T, T + interval '1 hour', '{"pull_rare_mult": 50}'::jsonb, '${A}');
    bad := bad || '4: a direct insert with pull_rare_mult 50 was accepted; ';
  exception when check_violation then null; end;
  begin
    insert into events (key, kind, title, starts_at, ends_at, vars, rewards, created_by) values ('tst_vars_raw2', 'drop', 'Raw', T, T + interval '1 hour', '{"bogus": 1}'::jsonb, '{"per_member": {"packs": 1}}'::jsonb, '${A}');
    bad := bad || '4: a direct insert with an unknown key was accepted; ';
  exception when check_violation then null; end;
  if event_shape_errors('party', '{"all": true}'::jsonb, '{}'::jsonb, '{}'::jsonb) <> array['kind must be drop, trigger, rank, modifier or launch_cards'] then bad := bad || '4: the kind list; '; end if;

  -- 6. The library: save as template, two events from it, edit one.
  r := admin_event_save(jsonb_build_object('key', 'tst_vars_week', 'kind', 'drop', 'title', 'Community Week', 'starts_at', T + interval '1 day',
         'ends_at', T + interval '8 days', 'audience', '{"all": true}'::jsonb, 'rewards', '{"per_member": {"packs": 2}}'::jsonb, 'vars', '{"pack_earn_mult": 2}'::jsonb,
         'theme', '{"name": "Community Week", "color": "#3366FF", "banner": "Bring a friend"}'::jsonb), null, '${A}', null);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 6: the source event was refused: %', r; end if;
  r := admin_event_template_from_event((r->'event'->>'id')::bigint, 'Community Week', '${A}', null);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'RESULT:FAIL 6: save as template refused: %', r; end if;
  tp := (r->'template'->>'id')::bigint;
  select to_jsonb(x) - 'updated_at' into tp_before from event_templates x where id = tp;
  if (tp_before->>'default_length') <> '7 days' or tp_before->'vars' <> '{"pack_earn_mult": 2}' or tp_before->'theme'->>'banner' <> 'Bring a friend' then bad := bad || '6: the template is not the event: ' || tp_before::text || '; '; end if;
  r := admin_event_from_template(tp, 'tst_vars_week_1', T + interval '10 days', '${A}', null, null);
  e1 := (r->'event'->>'id')::bigint;
  r2 := admin_event_from_template(tp, 'tst_vars_week_2', T + interval '17 days', '${A}', 'Community Week 2', null);
  e2 := (r2->'event'->>'id')::bigint;
  if e1 is null or e2 is null then raise exception 'RESULT:FAIL 6: an event from the template was refused: % %', r, r2; end if;
  if (select count(*) from events where template_id = tp and id in (e1, e2) and status = 'draft' and kind = 'drop' and vars = '{"pack_earn_mult": 2}'
        and ends_at - starts_at = interval '7 days' and rewards = '{"per_member": {"packs": 2}}'::jsonb) <> 2 then bad := bad || '6: the events are not copies with template_id; '; end if;
  if (select title from events where id = e1) <> 'Community Week' or (select title from events where id = e2) <> 'Community Week 2' then bad := bad || '6: the titles; '; end if;
  select to_jsonb(x) - 'updated_at' into e2_before from events x where id = e2;
  r := admin_event_save(jsonb_build_object('id', e1, 'title', 'Community Week 1', 'vars', '{"pack_earn_mult": 3}'::jsonb, 'rewards', '{"per_member": {"packs": 5}}'::jsonb),
         (select updated_at from events where id = e1), '${A}', null);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || '6: the edit of one entry was refused ' || r::text || '; '; end if;
  if (select vars from events where id = e1) <> '{"pack_earn_mult": 3}' then bad := bad || '6: the edit did not apply; '; end if;
  if (select to_jsonb(x) - 'updated_at' from event_templates x where id = tp) <> tp_before then bad := bad || '6: the edit changed the template; '; end if;
  if (select to_jsonb(x) - 'updated_at' from events x where id = e2) <> e2_before then bad := bad || '6: the edit changed the other entry; '; end if;
  r := admin_event_template_save(jsonb_build_object('id', tp, 'vars', '{"pack_earn_mult": 1.5}'::jsonb), (select updated_at from event_templates where id = tp), '${A}', null);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || '6: the template edit was refused ' || r::text || '; '; end if;
  if (select to_jsonb(x) - 'updated_at' from events x where id = e2) <> e2_before then bad := bad || '6: a template edit changed an event; '; end if;
  r := admin_event_save(jsonb_build_object('id', e2, 'template_id', null), (select updated_at from events where id = e2), '${A}', null);
  if (r->>'error') is distinct from 'locked' then bad := bad || '6: template_id changed after the event was made; '; end if;
  r := admin_event_template_save(jsonb_build_object('name', 'Bad tpl', 'kind', 'modifier', 'default_length', '1 day', 'vars', '{"pull_rare_mult": 9}'::jsonb), null, '${A}', null);
  if coalesce((r->>'ok')::boolean, true) then bad := bad || '6: a template with an out-of-limit var was accepted; '; end if;
  if ((admin_event_templates()->'rows') @> jsonb_build_array(jsonb_build_object('id', tp, 'events', 2))) is not true then bad := bad || '6: admin_event_templates count; '; end if;

  -- 7. The job.
  select * into j from cron.job where jobname = 'event-tick';
  if j.jobid is null then bad := bad || '7: no cron job event-tick; ';
  elsif j.schedule <> '* * * * *' or j.command not like '%event_tick()%' or not j.active then bad := bad || format('7: cron job %s %s; ', j.schedule, j.command); end if;

  -- 8. RLS and grants.
  if exists (select 1 from pg_class c where c.oid in ('public.event_vars'::regclass, 'public.event_templates'::regclass) and not c.relrowsecurity) then bad := bad || '8: RLS off; '; end if;
  if has_table_privilege('anon', 'public.event_vars', 'select') or has_table_privilege('authenticated', 'public.event_templates', 'select') then bad := bad || '8: table grants; '; end if;
  for j in select p.oid::regprocedure::text as f from pg_proc p where p.pronamespace = 'public'::regnamespace
            and p.proname in ('game_var', 'game_vars', 'game_pull_rates', 'event_vars_errors', 'event_theme_errors', 'event_template_errors', 'admin_event_templates',
                              'admin_event_template_save', 'admin_event_template_from_event', 'admin_event_from_template', 'event_shape_errors') loop
    if has_function_privilege('anon', j.f, 'execute') or has_function_privilege('authenticated', j.f, 'execute') or not has_function_privilege('service_role', j.f, 'execute') then
      bad := bad || format('8: grants of %s; ', j.f);
    end if;
  end loop;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
