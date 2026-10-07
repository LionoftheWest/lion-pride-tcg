/**
 * Acceptance test for tcg-bot/supabase/balance_dungeon_numbers.sql (the Dungeon chest, door and room-reward numbers,
 * the tier odds and the boss HP estimate move from code into public.balance). Rolled back (the result comes back in
 * the exception), test members only, a private dungeon_runs row (never the Hunt boss row):
 *   node scripts/test-balance-dungeon-numbers.mjs          the migration file, executed inside the block
 *   node scripts/test-balance-dungeon-numbers.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-balance-dungeon-numbers.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - the SAME numbers come out: (a) the literal values of the old code, tier by tier (the chest Shards and card chance,
 *     the rare door chest, every room reward amount and least tier); (b) the old and the new functions on the same
 *     random seeds give the same jsonb (dungeon_tier, dungeon_enter treasure, dungeon_offers, dungeon_choose door,
 *     roster_stats boss_hp). (b) compares with the database before the file, so run it BEFORE the file is applied;
 *   - each number is READ from balance: a changed balance value changes the result;
 *   - one source: settings.dungeon has no tier_weights, and a value put there changes nothing;
 *   - roster_stats and roster_snapshot give the same boss HP estimate (balance boss_hp_estimate);
 *   - balance_check_dungeon refuses a wrong shape.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/balance_dungeon_numbers.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$t$') || mig.includes('$d$')) throw new Error('the migration must not contain $m$, $t$ or $d$');

const FN_MUT = {
  chestlit: ['public.dungeon_enter(jsonb,jsonb,integer,integer)', "balance_num('dungeon_rewards', 'chest', 'shards', (t - 1)::text)", '(array[15, 25, 40, 65, 110])[t]'],
  chestfloor: ['public.dungeon_enter(jsonb,jsonb,integer,integer)', "balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * p_floor", "balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * (p_floor + 1)"],
  chancelit: ['public.dungeon_enter(jsonb,jsonb,integer,integer)', "balance_num('dungeon_rewards', 'chest', 'card_chance', (t - 1)::text)", '(array[0, 0.35, 0.6, 1, 1])[t]'],
  gamblelit: ['public.dungeon_choose(text,integer,text)', "balance_num('dungeon_rewards', 'door', 'gamble_rare')", '0.5'],
  raretier: ['public.dungeon_choose(text,integer,text)', "v_t := balance_num('dungeon_rewards', 'door', 'rare_tier')::int;", 'v_t := 4;'],
  rareshards: ['public.dungeon_choose(text,integer,text)', "'shards', (v_t - 1)::text)", "'shards', least(v_t, 4)::text)"],
  offerlit: ['public.dungeon_offers(jsonb,integer)', "when k in ('heal', 'buff', 'ward', 'revive') then", "when k = 'heal' then (array[0.25, 0.35, 0.5, 0.75, 1.0])[t] when k in ('buff', 'ward', 'revive') then"],
  offershift: ['public.dungeon_offers(jsonb,integer)', "'offers', 'shards', (t - 1)::text)", "'offers', 'shards', least(t, 4)::text)"],
  mintier: ['public.dungeon_offers(jsonb,integer)', "t < balance_num('dungeon_rewards', 'offers', 'min_tier', k)", 't < 2'],
  tierlit: ['public.dungeon_tier(double precision)', "balance_get('dungeon_rewards')->'tier_weights'", "'[60,25,10,4,1]'::jsonb"],
  snapown: ['public.roster_snapshot()', "(v_hp->>'Mythic')::bigint", 'greatest(500, round(v_dep * 22))'],
  estlit: ['public.roster_boss_hp(bigint)', "balance_num('boss_hp_estimate', 'floor')", '500'],
};
const SQL_MUT = {
  noshape: 'drop trigger balance_check_dungeon on public.balance;',
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_bdn';
// Each case runs in its own subtransaction and undoes its balance / settings changes at the end (tst_undo);
// the result stays (a variable is not rolled back).
const kase = (name, body) => `
  begin
${body}
    raise exception 'tst_undo';
  exception when others then
    if sqlerrm <> 'tst_undo' then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm); end if;
  end;`;
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
// Set one leaf of balance dungeon_rewards (the old value comes back after each case).
const setb = (path, val) => `update balance set value = jsonb_set(value, '{${path}}', '${val}'::jsonb) where key = 'dungeon_rewards';`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; ok boolean; n int; n2 int; i int; s int; f int; tt int; x jsonb; run bigint;
  fl jsonb; st0 jsonb; stdoor jsonb; dep bigint; snap bigint;
  g_tier jsonb := '[]'; g_chest jsonb := '[]'; g_offers jsonb := '[]'; g_door jsonb := '[]'; g_est jsonb;
  hot jsonb := '{"1":[1,0,0,0,0],"2":[0,1,0,0,0],"3":[0,0,1,0,0],"4":[0,0,0,1,0],"5":[0,0,0,0,1]}';
  states jsonb := '[{"cards":{}}, {"cards":{"1":{"down":true}}}, {"mode":"gauntlet","cards":{"1":{"down":true}}}, {"last_pick":"buff","cards":{"1":{"down":true}}}, {"heal_floor":12,"cards":{"1":{"down":true}}}]';
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  insert into players (id, username) values ('${P}_a', 'tst a');
  perform dungeon_generate(dungeon_day());
  fl := (select jsonb_agg('[{"type":"treasure","foes":[]}]'::jsonb) from generate_series(1, 30));
  st0 := '{"cards":{},"buff":1,"bank":{"shards":0,"cards":[]},"pend":{"shards":0,"cards":[]}}';
  stdoor := st0 || '{"phase":"path","offers":[{"kind":"door","to":"gamble"}]}';
  insert into dungeon_runs (player_id, day, squad, state, floor, room) values ('${P}_a', dungeon_day(), '{}', stdoor, 1, 2) returning id into run;
  -- A private door run: the same pick on the same seed, at floor f.
  create function pg_temp.door(p_run bigint, p_st jsonb, p_f int, p_seed float8) returns jsonb language plpgsql as $d$
  begin
    update dungeon_runs set state = p_st, floor = p_f, room = 2, status = 'active' where id = p_run;
    perform setseed(p_seed);
    return dungeon_choose('${P}_a', 0);
  end $d$;

  -- (b) The golden values of the database BEFORE the file (the old code), on fixed seeds.
  for i in 0..1000 loop g_tier := g_tier || to_jsonb(dungeon_tier(i / 1000.0)); end loop;
  foreach f in array array[1, 7, 30] loop for s in 1..60 loop
    perform setseed(s / 61.0);
    g_chest := g_chest || jsonb_build_array(dungeon_enter(st0, fl, f, 1));
  end loop; end loop;
  for x in select e from jsonb_array_elements(states) e loop foreach f in array array[1, 12, 30] loop for s in 1..40 loop
    perform setseed(s / 41.0);
    g_offers := g_offers || jsonb_build_array(dungeon_offers(x, f));
  end loop; end loop; end loop;
  foreach f in array array[1, 9] loop for s in 1..40 loop
    g_door := g_door || jsonb_build_array(pg_temp.door(run, stdoor, f, s / 41.0));
  end loop; end loop;
  g_est := roster_stats()->'boss_hp';

  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}

${kase('(b) dungeon_tier: the same tier for 1001 numbers from 0 to 1', `
    r := '[]'; for i in 0..1000 loop r := r || to_jsonb(dungeon_tier(i / 1000.0)); end loop;
    ${done('(b) dungeon_tier: the same tier for 1001 numbers from 0 to 1', 'r = g_tier and (select count(distinct e) from jsonb_array_elements(r) e) = 5')}`)}
${kase('(b) a treasure room: the same chest (tier, Shards, card) and state on 180 seeds and floors', `
    r := '[]';
    foreach f in array array[1, 7, 30] loop for s in 1..60 loop perform setseed(s / 61.0); r := r || jsonb_build_array(dungeon_enter(st0, fl, f, 1)); end loop; end loop;
    ${done('(b) a treasure room: the same chest (tier, Shards, card) and state on 180 seeds and floors', `r = g_chest
      and (select count(distinct e->'chest'->>'tier') from jsonb_array_elements(r) e) >= 4
      and exists (select 1 from jsonb_array_elements(r) e where e->'chest'->>'card' is not null)
      and exists (select 1 from jsonb_array_elements(r) e where e->'chest'->>'card' is null)`)}`)}
${kase('(b) the room rewards: the same offers on 600 seeds, states and floors', `
    r := '[]';
    for x in select e from jsonb_array_elements(states) e loop foreach f in array array[1, 12, 30] loop for s in 1..40 loop
      perform setseed(s / 41.0); r := r || jsonb_build_array(dungeon_offers(x, f));
    end loop; end loop; end loop;
    ${done('(b) the room rewards: the same offers on 600 seeds, states and floors', `r = g_offers
      and (select count(distinct o->>'kind') from jsonb_array_elements(r) e, jsonb_array_elements(e) o) = 7`)}`)}
${kase('(b) the dark door: the same result (rare chest or ambush) on 80 seeds and floors', `
    r := '[]';
    foreach f in array array[1, 9] loop for s in 1..40 loop r := r || jsonb_build_array(pg_temp.door(run, stdoor, f, s / 41.0)); end loop; end loop;
    ${done('(b) the dark door: the same result (rare chest or ambush) on 80 seeds and floors', `r = g_door
      and exists (select 1 from jsonb_array_elements(r) e where e->>'door' = 'treasure_rare')
      and exists (select 1 from jsonb_array_elements(r) e where e->>'door' = 'elite')`)}`)}
${kase('(b) roster_stats: the same boss HP estimate (x 8 / 12 / 15)', `
    dep := deployable_power();
    ${done('(b) roster_stats: the same boss HP estimate (x 8 / 12 / 15)', `roster_stats()->'boss_hp' = g_est
      and (g_est->>'Normal')::numeric = greatest(500, round(dep * 8)) and (g_est->>'Mythic')::numeric = greatest(500, round(dep * 15))`, ", 'est', g_est")}`)}
${kase('(a) a chest of each tier: Shards [15,25,40,65,110] + 3 per floor, card chance [0,0.35,0.6,1,1]', `
    ok := true;
    for tt in 1..5 loop
      update balance set value = jsonb_set(value, '{tier_weights}', hot->(tt::text)) where key = 'dungeon_rewards';
      n := 0;
      foreach f in array array[1, 10, 30] loop for s in 1..40 loop
        perform setseed(s / 41.0); r := dungeon_enter(st0, fl, f, 1)->'chest';
        ok := ok and (r->>'tier')::int = tt and (r->>'shards')::int = (array[15, 25, 40, 65, 110])[tt] + 3 * f;
        if r->>'card' is not null then n := n + 1; end if;
      end loop; end loop;
      ok := ok and case tt when 1 then n = 0 when 2 then n between 20 and 70 when 3 then n between 50 and 95 else n = 120 end;
    end loop;
    ${done('(a) a chest of each tier: Shards [15,25,40,65,110] + 3 per floor, card chance [0,0.35,0.6,1,1]', 'ok')}`)}
${kase('(a) the room rewards of each tier: the old amounts, Shards + 2 per floor, reset from tier 3, revive from tier 2', `
    ok := true;
    for tt in 1..5 loop
      update balance set value = jsonb_set(value, '{tier_weights}', hot->(tt::text)) where key = 'dungeon_rewards';
      n := 0; n2 := 0;
      foreach f in array array[1, 10] loop for s in 1..40 loop
        perform setseed(s / 41.0);
        for x in select o from jsonb_array_elements(dungeon_offers('{"cards":{"1":{"down":true}}}', f)) o loop
          ok := ok and (x->>'tier')::int = tt and (x->>'amount')::numeric = case x->>'kind'
            when 'heal' then (array[0.25, 0.35, 0.5, 0.75, 1.0])[tt] when 'buff' then (array[0.05, 0.08, 0.12, 0.18, 0.25])[tt]
            when 'shards' then (array[8, 15, 25, 40, 70])[tt] + 2 * f when 'ward' then (array[0.1, 0.15, 0.2, 0.3, 0.4])[tt]
            when 'revive' then (array[0.3, 0.3, 0.4, 0.6, 1.0])[tt] else 0 end;
          if x->>'kind' = 'reset' then n := n + 1; end if;
          if x->>'kind' = 'revive' then n2 := n2 + 1; end if;
        end loop;
      end loop; end loop;
      ok := ok and (n > 0) = (tt >= 3) and (n2 > 0) = (tt >= 2);
    end loop;
    ${done('(a) the room rewards of each tier: the old amounts, Shards + 2 per floor, reset from tier 3, revive from tier 2', 'ok')}`)}
${kase('(a) the dark door: a rare chest is a tier 4 chest (65 + 3 per floor), about half of the doors', `
    n := 0; ok := true;
    foreach f in array array[1, 9] loop for s in 1..100 loop
      r := pg_temp.door(run, stdoor, f, s / 101.0);
      if r->>'door' = 'treasure_rare' then
        n := n + 1;
        ok := ok and (r->'state'->'chest'->>'tier')::int = 4 and (r->'state'->'chest'->>'shards')::int = 65 + 3 * f and (r->'state'->'pend'->>'shards')::int = 65 + 3 * f;
      end if;
    end loop; end loop;
    ${done('(a) the dark door: a rare chest is a tier 4 chest (65 + 3 per floor), about half of the doors', 'ok and n between 70 and 130', ", 'rare', n")}`)}
${kase('reads balance: the chest Shards, the Shards per floor and the card chance', `
    ${setb('chest,shards', '[16,26,41,66,111]')}
    ${setb('chest,shards_per_floor', '4')}
    ${setb('chest,card_chance', '[0,0,0,0,0]')}
    ok := true;
    foreach f in array array[1, 7, 30] loop for s in 1..60 loop
      perform setseed(s / 61.0); r := dungeon_enter(st0, fl, f, 1)->'chest';
      x := g_chest->((case f when 1 then 0 when 7 then 1 else 2 end) * 60 + s - 1)->'chest';
      ok := ok and (r->>'tier') = (x->>'tier') and (r->>'shards')::int = (x->>'shards')::int + 1 + f and r->>'card' is null;
    end loop; end loop;
    ${done('reads balance: the chest Shards, the Shards per floor and the card chance', 'ok')}`)}
${kase('reads balance: the dark door odds (gamble_rare 1 / 0) and the rare chest tier (rare_tier 5)', `
    ${setb('door,gamble_rare', '1')}
    ok := (select bool_and(pg_temp.door(run, stdoor, 1, gs / 21.0)->>'door' = 'treasure_rare') from generate_series(1, 20) gs);
    ${setb('door,gamble_rare', '0')}
    ok := ok and (select bool_and(pg_temp.door(run, stdoor, 1, gs / 21.0)->>'door' = 'elite') from generate_series(1, 20) gs);
    ${setb('door,gamble_rare', '1')}
    ${setb('door,rare_tier', '5')}
    r := pg_temp.door(run, stdoor, 9, 0.3);
    ${done('reads balance: the dark door odds (gamble_rare 1 / 0) and the rare chest tier (rare_tier 5)', `ok and (r->'state'->'chest'->>'tier')::int = 5 and (r->'state'->'chest'->>'shards')::int = 110 + 27`, ", 'r', r->'state'->'chest'")}`)}
${kase('reads balance: the room reward amounts, the Shards per floor and the least tiers', `
    ${setb('offers,heal', '[0.26,0.36,0.51,0.76,1.01]')}
    ${setb('offers,buff', '[0.06,0.09,0.13,0.19,0.26]')}
    ${setb('offers,ward', '[0.11,0.16,0.21,0.31,0.41]')}
    ${setb('offers,revive', '[0.31,0.31,0.41,0.61,1.01]')}
    ${setb('offers,shards', '[9,16,26,41,71]')}
    ${setb('offers,shards_per_floor', '3')}
    ok := true;
    for i in 0..jsonb_array_length(g_offers) - 1 loop
      exit when i >= 360;
      x := states->(i / 120); f := (array[1, 12, 30])[(i % 120) / 40 + 1]; s := i % 40 + 1;
      perform setseed(s / 41.0); r := dungeon_offers(x, f);
      ok := ok and (select bool_and((o->>'kind') = (g->>'kind') and (o->>'tier') = (g->>'tier')
               and (o->>'amount')::numeric = (g->>'amount')::numeric + case when o->>'kind' in ('heal', 'buff', 'ward', 'revive') then 0.01 when o->>'kind' = 'shards' then 1 + f else 0 end)
              from jsonb_array_elements(r) with ordinality a(o, k) join jsonb_array_elements(g_offers->i) with ordinality b(g, k2) on k = k2);
    end loop;
    -- the least tiers: reset and revive from tier 1
    update balance set value = jsonb_set(jsonb_set(value, '{offers,min_tier,reset}', '1'), '{tier_weights}', hot->'1') where key = 'dungeon_rewards';
    n := 0;
    for s in 1..40 loop perform setseed(s / 41.0); n := n + (select count(*) from jsonb_array_elements(dungeon_offers('{"cards":{"1":{"down":true}}}', 1)) o where o->>'kind' = 'reset'); end loop;
    ${setb('offers,min_tier,revive', '1')}
    n2 := 0;
    for s in 1..40 loop perform setseed(s / 41.0); n2 := n2 + (select count(*) from jsonb_array_elements(dungeon_offers('{"cards":{"1":{"down":true}}}', 1)) o where o->>'kind' = 'revive'); end loop;
    ${done('reads balance: the room reward amounts, the Shards per floor and the least tiers', 'ok and n > 0 and n2 > 0', ", 'reset', n, 'revive', n2")}`)}
${kase('reads balance: the tier odds; one source (settings.dungeon has no tier_weights, a value there changes nothing)', `
    ok := not exists (select 1 from settings where key = 'dungeon' and value ? 'tier_weights');
    update settings set value = value || '{"tier_weights":[1,0,0,0,0]}' where key = 'dungeon';
    ok := ok and (select bool_and(dungeon_tier(gs / 100.0) = (g_tier->>(gs * 10))::int) from generate_series(0, 100) gs);
    update settings set value = value - 'tier_weights' where key = 'dungeon';
    update balance set value = jsonb_set(value, '{tier_weights}', '[0,0,0,0,1]') where key = 'dungeon_rewards';
    ${done('reads balance: the tier odds; one source (settings.dungeon has no tier_weights, a value there changes nothing)', 'ok and dungeon_tier(0.01) = 5 and dungeon_tier(0.99) = 5')}`)}
${kase('roster_stats and roster_snapshot give the same boss HP estimate', `
    dep := deployable_power();
    snap := roster_snapshot();
    r := (select jsonb_build_object('Normal', boss_hp_normal, 'Heroic', boss_hp_heroic, 'Mythic', boss_hp_mythic) from roster_power_history where id = snap);
    ${done('roster_stats and roster_snapshot give the same boss HP estimate', `dep > 100 and r = roster_stats()->'boss_hp'`, ", 'snapshot', r, 'stats', roster_stats()->'boss_hp'")}`)}
${kase('reads balance: roster_stats and roster_snapshot use boss_hp_estimate (roster_boss_hp)', `
    dep := deployable_power();
    update balance set value = '{"floor":7,"Normal":1,"Heroic":2,"Mythic":20}' where key = 'boss_hp_estimate';
    snap := roster_snapshot();
    r := roster_stats()->'boss_hp';
    ${done('reads balance: roster_stats and roster_snapshot use boss_hp_estimate (roster_boss_hp)', `dep > 100
      and (r->>'Mythic')::numeric = dep * 20 and (r->>'Normal')::numeric = greatest(7, dep)
      and (select boss_hp_mythic = dep * 20 and boss_hp_normal = greatest(7, dep) from roster_power_history where id = snap)
      and roster_boss_hp(0) = '{"Normal":7,"Heroic":7,"Mythic":7}'`, ", 'dep', dep, 'r', r")}`)}
${kase('balance_check_dungeon refuses a wrong shape and accepts a right one', `
    n := 0;
    -- (balance_check refuses a lost leaf or a new type first: these values pass it, only balance_check_dungeon refuses them)
    for x in select e from jsonb_array_elements('[["tier_weights", [60,25,10,4,1,1]], ["tier_weights", [0,0,0,0,0]], ["chest,card_chance,4", 1.5],
        ["chest,shards,4", 110.5], ["offers,shards_per_floor", 2.5], ["door,rare_tier", 6], ["offers,min_tier,reset", 0],
        ["offers,heal", [0.25,0.35,0.5,0.75,1.0,1.0]], ["door,gamble_rare", 1.2]]'::jsonb) e loop
      begin
        update balance set value = jsonb_set(value, ('{' || (x->>0) || '}')::text[], x->1) where key = 'dungeon_rewards';
      exception when others then
        if sqlerrm ~ '^balance dungeon_rewards: .*(must be 5 numbers|must add up to more than 0|whole numbers|at most 1[)]|must be a tier)' then n := n + 1; end if;
      end;
    end loop;
    ok := true;
    begin ${setb('offers,heal', '[0.2,0.3,0.4,0.5,0.6]')} exception when others then ok := false; end;
    ${done('balance_check_dungeon refuses a wrong shape and accepts a right one', 'ok and n = 9', ", 'refused', n")}`)}
  raise exception 'RESULT:%', res::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = msg.match(/RESULT:(\[.*\])/);
if (!m) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const res = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let fails = 0;
  for (const r of res) { if (!r.ok) fails += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 400)}`); }
  console.log(`\n${OLD ? 'BASELINE (--old) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
