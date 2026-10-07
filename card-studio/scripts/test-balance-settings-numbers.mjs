/**
 * Acceptance test for tcg-bot/supabase/balance_settings_numbers.sql (the Dungeon, Gauntlet and unlock-gate numbers move
 * from settings and from code into public.balance). Rolled back (the result comes back in the exception), test members
 * only, private dungeon_runs rows, days and weeks in 2031 (never a live day, never the Hunt):
 *   node scripts/test-balance-settings-numbers.mjs          the migration file, executed inside the block
 *   node scripts/test-balance-settings-numbers.mjs --old    the database as it is (before the migration: FAILS)
 *   MUTATE=<name> node scripts/test-balance-settings-numbers.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - the SAME results: the old and the new functions on the same random seeds give the same jsonb (dungeon_rules,
 *     dungeon_make_foe, dungeon_generate, gauntlet_generate + gauntlet_squad, gauntlet_pool, dungeon_view, gauntlet_view,
 *     dungeon_start, dungeon_enter rest, dungeon_after_kill, dungeon_loot, dungeon_chest_rarity, dungeon_attack round cap,
 *     adventure_gate). It compares with the database before the file, so run it BEFORE the file is applied;
 *   - the balance values are the old settings values (and the old code values of dungeon_rules);
 *   - each number is READ from balance: a changed balance value changes the result by the formula;
 *   - one source: settings.dungeon = {enabled, salt}, settings.gauntlet = {enabled}, no settings.adventure_gate, no
 *     dungeon_rewards.shards_room; a value put back into settings changes nothing; no function reads a removed leaf;
 *     no Dungeon / Gauntlet function keeps a coalesce copy of a balance value;
 *   - a missing number fails loudly (balance_num raises), never a silent copy;
 *   - balance_check_settings refuses a wrong shape and accepts a right one.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation, GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/balance_settings_numbers.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '').replace(/\r\n/g, '\n');
if (mig.includes('$m$') || mig.includes('$t$') || mig.includes('$d$')) throw new Error('the migration must not contain $m$, $t$ or $d$');

const GW = `'{"fight":38,"horde":12,"elite":10,"miniboss":7,"treasure":11,"rest":8,"choice":14}'::jsonb`;
const FN_MUT = {
  foelit: ['public.dungeon_make_foe(text,integer,integer,text)', "balance_num('dungeon', 'foe_mult', p_kind, 'hp')", '1.9'],
  growthlit: ['public.dungeon_make_foe(text,integer,integer,text)', "power(balance_num('dungeon', 'hp_growth'), p_floor - 1)", 'power(1.42, p_floor - 1)'],
  roomlit: ['public.dungeon_generate(date)', "balance_get('dungeon')->'room_weights'", GW],
  floorslit: ['public.dungeon_generate(date)', "balance_num('dungeon', 'floors')::int", '30'],
  gweightslit: ['public.gauntlet_generate(date)', "balance_get('gauntlet')->'room_weights'", "balance_get('dungeon')->'room_weights'"],
  gbudgetlit: ['public.gauntlet_squad(date)', "balance_num('gauntlet', 'budget')::int", '12'],
  costlit: ['public.gauntlet_pool()', "balance_num('dungeon', 'cost', c.rarity::text)::int", '1'],
  startcost: ['public.dungeon_start(text,bigint[])', "balance_num('dungeon', 'cost', c->>'rarity')::int", '1'],
  squadlit: ['public.dungeon_start(text,bigint[])', "balance_num('dungeon', 'squad')::int", '5'],
  viewcap: ['public.dungeon_view(text)', "balance_num('dungeon_rewards', 'run_shards_cap')::int", '300'],
  restlit: ['public.dungeon_enter(jsonb,jsonb,integer,integer)', "balance_num('dungeon', 'rest_heal')", '0.4'],
  caplit: ['public.dungeon_attack(text,bigint,integer,text)', "balance_num('dungeon', 'round_cap')::int", '40'],
  killlit: ['public.dungeon_after_kill(dungeon_runs,jsonb)', "balance_num('dungeon_rewards', 'loot_chance')", '0.06'],
  lootcap: ['public.dungeon_loot(jsonb,integer,bigint)', "balance_num('dungeon_rewards', 'run_shards_cap')::int", '300'],
  chestlit: ['public.dungeon_chest_rarity(integer)', "balance_get('dungeon_rewards')->'chest_rarity'->(least(5, greatest(1, p_tier)))::text", "'[100,0,0]'::jsonb"],
  rulelit: ['public.dungeon_rules()', "balance_num('dungeon', 'rules', 'boost') boost", '0.25 boost'],
  gatelit: ['public.adventure_gate(text)', "balance_num('adventure_gate', 'attackers')::int need", '8 need'],
  cfgmerge: ['public.dungeon_cfg()', " || balance_get('dungeon') ", ' '],
  gcfgmerge: ['public.gauntlet_cfg()', " || balance_get('gauntlet')", ''],
};
const SQL_MUT = {
  noshape: 'drop trigger balance_check_settings on public.balance;',
  keepleaf: `update settings set value = value || '{"squad": 5}' where key = 'dungeon';`,
};
const MUT = process.env.MUTATE && SQL_MUT[process.env.MUTATE] ? (console.log(`MUTATE=${process.env.MUTATE}`), SQL_MUT[process.env.MUTATE]) : mutation(FN_MUT);

const P = 'tst_bsn';
// Each case runs in its own subtransaction and undoes its changes at the end (tst_undo); the result stays.
const kase = (name, body) => `
  begin
${body}
    raise exception 'tst_undo';
  exception when others then
    if sqlerrm <> 'tst_undo' then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm); end if;
  end;`;
const done = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
const setb = (key, path, val) => `update balance set value = jsonb_set(value, '{${path}}', '${val}'::jsonb) where key = '${key}';`;
// The golden calls: the same text runs before the file (g_*) and after it.
const FOES = `(select jsonb_agg(dungeon_make_foe('tst|' || fk || '|' || fi, ff, fr, fk) order by fk, ff, fr, fi)
   from unnest(array['fight', 'horde', 'elite', 'miniboss', 'guardian']) fk, unnest(array[1, 5, 30]) ff, unnest(array[1, 3, 5]) fr, generate_series(1, 3) fi)`;
const GEN = `pg_temp.gen()`;
const POOL = `(select jsonb_agg(to_jsonb(p) order by p.id) from gauntlet_pool() p)`;
const CHEST = `(select jsonb_agg(pg_temp.chest(ct, cs) order by ct, cs) from generate_series(1, 5) ct, generate_series(1, 60) cs)`;
const AFTER = `pg_temp.after()`;
const REST = `dungeon_enter(rest_st, '[[{"type":"rest","foes":[]}]]'::jsonb, 1, 1)`;
const LOOT = `jsonb_build_array(dungeon_loot('{"bank":{"shards":290,"cards":[]},"pend":{"shards":5,"cards":[]}}', 20, null),
   dungeon_loot('{"bank":{"shards":10,"cards":[]},"pend":{"shards":0,"cards":[]}}', 40, 7), dungeon_loot('{}', 999, null))`;
const GATES = `jsonb_build_array(adventure_gate('${P}_a'), adventure_gate('${P}_b'))`;

const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; ok boolean; n int; i int; s int; x jsonb; rr dungeon_runs;
  five bigint[]; four bigint[]; golds bigint[]; v_day date := dungeon_day(); every jsonb; bud9 jsonb; rest_st jsonb; s0 jsonb;
  g_rules jsonb; g_foes jsonb; g_gen jsonb; g_pool jsonb; g_view jsonb; g_view9 jsonb; g_gview jsonb; g_start jsonb; g_rest jsonb;
  g_after jsonb; g_loot jsonb; g_chest jsonb; g_cap jsonb; g_gates jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  -- The values: settings.dungeon before the file (the proof that the file copies them), else the live values of
  -- 2026-10-07 (after the file the settings row has none; a later tune of balance dungeon must update these).
  s0 := '{"cost":{"gold":5,"event":4,"promo":3,"normal":1,"full_art":4,"secret_rare":3,"illustrated_rare":2},"squad":5,"budget":12,"floors":30,
         "round_cap":40,"hp_growth":1.42,"atk_growth":1.22,"room_growth":0.06,"rest_heal":0.40,"rest_revive":0.25,
         "elite":{"hp":1.9,"atk":1.3},"horde":{"hp":0.6,"atk":0.75},"miniboss":{"hp":2.6,"atk":1.45},"guardian":{"hp":4.0,"atk":1.7},
         "room_weights":{"rest":8,"elite":10,"fight":38,"horde":12,"choice":14,"miniboss":7,"treasure":11}}'::jsonb
        || coalesce((select value from settings where key = 'dungeon'), '{}');
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b');
  ${GATE(`${P}_a`)}
  -- three Gold attackers (cost 5 each: a squad over the budget)
  insert into player_cards (player_id, card_id, quantity)
    select '${P}_a', c.id, 1 from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity = 'gold' order by c.id limit 3;
  five := array(select card_id from player_cards pc join cards c on c.id = pc.card_id where pc.player_id = '${P}_a' and c.rarity = 'normal' order by card_id limit 5);
  four := five[1:4];
  golds := array(select card_id from player_cards pc join cards c on c.id = pc.card_id where pc.player_id = '${P}_a' and c.rarity = 'gold' order by card_id) || five[1:2];
  -- Today's dungeon with a known rule: "Everything goes" (no budget of its own), and the "budget" rule.
  perform dungeon_generate(v_day);
  every := (select e from jsonb_array_elements(dungeon_rules()) e where e->>'name' = 'Everything goes');
  bud9 := (select e from jsonb_array_elements(dungeon_rules()) e where e ? 'budget');
  update dungeon_days set rule = every where day = v_day;
  insert into dungeon_runs (player_id, day, squad, state, floor, room) values ('${P}_b', v_day, '{}', '{}', 3, 2);
  rest_st := '{"cards":{"1":{"hp":10,"max":100,"down":false},"2":{"hp":0,"max":80,"down":true},"3":{"hp":95,"max":100,"down":false}}}';

  -- Days and weeks in 2031: built, compared, removed (gen); the run starts (start).
  create function pg_temp.gen() returns jsonb language plpgsql as $d$
  declare v jsonb := '[]'; d date; w date;
  begin
    foreach d in array array['2031-01-01', '2031-01-02', '2031-01-03']::date[] loop
      v := v || jsonb_build_array(dungeon_generate(d) - 'created_at'); delete from dungeon_days where day = d;
    end loop;
    foreach w in array array[gauntlet_week('2031-01-08'), gauntlet_week('2031-01-15')] loop
      v := v || jsonb_build_array(to_jsonb(gauntlet_generate(w)) - 'created_at', gauntlet_squad(w)); delete from gauntlet_weeks where week = w;
    end loop;
    return v;
  end $d$;
  create function pg_temp.start(p_five bigint[], p_four bigint[], p_golds bigint[]) returns jsonb language plpgsql as $d$
  declare v jsonb; c bigint;
  begin
    v := jsonb_build_array(dungeon_start('${P}_a', p_four), dungeon_start('${P}_a', p_golds));
    v := v || jsonb_build_array(dungeon_start('${P}_a', p_five) - 'run');
    -- the round cap: round 40 of a fight
    update dungeon_runs set state = jsonb_set(state, '{round}', '40') where player_id = '${P}_a' and day = dungeon_day() and mode = 'daily';
    v := v || jsonb_build_array(dungeon_attack('${P}_a', p_five[1], 0));
    delete from dungeon_runs where player_id = '${P}_a';
    return v;
  end $d$;
  create function pg_temp.chest(p_t int, p_s int) returns text language plpgsql as $d$
  begin perform setseed(p_s / 61.0); return dungeon_chest_rarity(p_t); end $d$;
  create function pg_temp.after() returns jsonb language plpgsql as $d$
  declare v jsonb := '[]'; r dungeon_runs; s int; st jsonb; f int;
  begin
    foreach f in array array[1, 7] loop
      update dungeon_runs set floor = f where player_id = '${P}_b';
      select * into r from dungeon_runs where player_id = '${P}_b';
      for s in 1..25 loop
        foreach st in array array['{"room_type":"fight","foes":[{"hp":0}],"cards":{}}', '{"room_type":"guardian","foes":[{"hp":0}],"pend":{"shards":4,"cards":[]},"cards":{}}',
                                  '{"room_type":"fight","foes":[{"hp":3}],"cards":{}}', '{"mode":"gauntlet","room_type":"fight","foes":[{"hp":0}],"cards":{}}']::jsonb[] loop
          perform setseed(s / 26.0); v := v || jsonb_build_array(dungeon_after_kill(r, st));
        end loop;
      end loop;
    end loop;
    update dungeon_runs set floor = 3 where player_id = '${P}_b';   -- as before (the day's board shows it)
    return v;
  end $d$;

  -- The golden values of the database BEFORE the file (the old code), on fixed seeds.
  g_rules := dungeon_rules(); g_foes := ${FOES}; g_gen := ${GEN}; g_pool := ${POOL};
  g_view := dungeon_view('${P}_a');
  update dungeon_days set rule = bud9 where day = v_day; g_view9 := dungeon_view('${P}_a'); update dungeon_days set rule = every where day = v_day;
  g_gview := gauntlet_view('${P}_a');
  g_start := pg_temp.start(five, four, golds);
  g_rest := ${REST}; g_after := ${AFTER}; g_loot := ${LOOT}; g_chest := ${CHEST}; g_gates := ${GATES};

  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}

${kase('(b) the same results: rules, foes, days, weeks, squads, pool, views, start, rest, kills, loot, chests, gate', `
    r := jsonb_build_object('rules', dungeon_rules() = g_rules, 'foes', ${FOES} = g_foes, 'gen', ${GEN} = g_gen, 'pool', ${POOL} = g_pool,
      'view', dungeon_view('${P}_a') = g_view, 'gview', gauntlet_view('${P}_a') = g_gview, 'start', pg_temp.start(five, four, golds) = g_start,
      'rest', ${REST} = g_rest, 'after', ${AFTER} = g_after, 'loot', ${LOOT} = g_loot, 'chest', ${CHEST} = g_chest, 'gates', ${GATES} = g_gates);
    x := dungeon_view('${P}_a');
    r := r || jsonb_build_object('view_diff', (select coalesce(jsonb_agg(e.key), '[]') from jsonb_each(x) e where e.value is distinct from g_view->e.key));
    update dungeon_days set rule = bud9 where day = v_day;
    r := r || jsonb_build_object('view9', dungeon_view('${P}_a') = g_view9);
    ${done('(b) the same results: rules, foes, days, weeks, squads, pool, views, start, rest, kills, loot, chests, gate', `not exists (select 1 from jsonb_each(r - 'view_diff') e where e.value <> 'true')
      and (g_start->1->>'error') = 'budget' and (g_start->0->>'error') = 'squad_size' and (g_start->2->>'ok')::boolean and (g_start->3->>'error') = 'round_cap'
      and (g_view->>'budget')::int = 12 and (g_view9->>'budget')::int = 9 and jsonb_array_length(g_gen->0->'floors') = 30
      and (select count(distinct e) from jsonb_array_elements(g_chest) e) = 3 and (g_gates->0->>'ok')::boolean and not (g_gates->1->>'ok')::boolean`, ", 'same', r")}`)}
${kase('(a) the balance values are the old settings values and the old code values', `
    x := balance_get('dungeon');
    ${done('(a) the balance values are the old settings values and the old code values', `x->'cost' = s0->'cost' and x->'squad' = s0->'squad' and x->'budget' = s0->'budget'
      and x->'floors' = s0->'floors' and x->'round_cap' = s0->'round_cap' and x->'hp_growth' = s0->'hp_growth' and x->'atk_growth' = s0->'atk_growth'
      and x->'room_growth' = s0->'room_growth' and x->'rest_heal' = s0->'rest_heal' and x->'rest_revive' = s0->'rest_revive' and x->'room_weights' = s0->'room_weights'
      and x->'foe_mult' = jsonb_build_object('fight', '{"hp":1,"atk":1}'::jsonb, 'horde', s0->'horde', 'elite', s0->'elite', 'miniboss', s0->'miniboss', 'guardian', s0->'guardian')
      and x->'rules' = '{"boost":0.25,"budget":9}' and (x->>'squad')::int = 5 and (x->>'budget')::int = 12
      and balance_get('gauntlet') = '{"budget":12,"room_weights":{"fight":40,"horde":14,"elite":12,"miniboss":8,"rest":10,"choice":16}}'
      and balance_get('adventure_gate') = '{"attackers":8}'
      and (select count(*) from balance where key in ('dungeon', 'gauntlet', 'adventure_gate') and length(note) > 100) = 3`, ", 'dungeon', x")}`)}
${kase('reads balance: the foe growth, the room growth and each kind multiplier (dungeon_make_foe = the formula)', `
    update balance set value = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(value, '{hp_growth}', '1.5'), '{atk_growth}', '1.3'), '{room_growth}', '0.1'),
      '{foe_mult,elite}', '{"hp":2.5,"atk":1.6}'), '{foe_mult,fight}', '{"hp":1.1,"atk":0.9}') where key = 'dungeon';
    -- floor 3, room 2: HP = base x 1.5^2 x (1 + 0.1 x 1) x kind hp; attack = base x 1.3^2 x kind atk
    r := dungeon_make_foe('tst|e|1', 3, 2, 'elite');
    r2 := dungeon_make_foe('tst|f|1', 3, 2, 'fight');
    ${done('reads balance: the foe growth, the room growth and each kind multiplier (dungeon_make_foe = the formula)', `(r->>'hp')::numeric = round((select m.hp from dungeon_monsters m where m.key = r->>'key') * power(1.5, 2) * 1.1 * 2.5)
      and (r->>'atk')::numeric = greatest(1, round((select m.atk from dungeon_monsters m where m.key = r->>'key') * power(1.3, 2) * 1.6))
      and (r2->>'hp')::numeric = round((select m.hp from dungeon_monsters m where m.key = r2->>'key') * power(1.5, 2) * 1.1 * 1.1)
      and (r2->>'atk')::numeric = greatest(1, round((select m.atk from dungeon_monsters m where m.key = r2->>'key') * power(1.3, 2) * 0.9))
      and ${FOES} <> g_foes`, ", 'elite', r, 'fight', r2")}`)}
${kase('reads balance: the floors and the room weights of a day and of a Gauntlet week', `
    ${setb('dungeon', 'floors', '3')}
    ${setb('dungeon', 'room_weights', '{"fight":0,"horde":0,"elite":0,"miniboss":0,"treasure":0,"rest":1,"choice":0}')}
    ${setb('gauntlet', 'room_weights', '{"fight":0,"horde":0,"elite":0,"miniboss":0,"rest":0,"choice":1}')}
    x := dungeon_generate('2031-02-01');
    r := to_jsonb(gauntlet_generate(gauntlet_week('2031-02-12')));
    ${done('reads balance: the floors and the room weights of a day and of a Gauntlet week', `jsonb_array_length(x->'floors') = 3 and jsonb_array_length(r->'floors') = 3
      and (select bool_and(rm->>'type' = case ri when 1 then 'fight' when 5 then 'guardian' else 'rest' end) from jsonb_array_elements(x->'floors') fl, jsonb_array_elements(fl) with ordinality a(rm, ri))
      and (select bool_and(rm->>'type' = case ri when 1 then 'fight' when 5 then 'guardian' else 'choice' end) from jsonb_array_elements(r->'floors') fl, jsonb_array_elements(fl) with ordinality a(rm, ri))`)}`)}
${kase('reads balance: the squad size, the budget and the costs (dungeon_start, dungeon_view, gauntlet_pool, gauntlet_view)', `
    ${setb('dungeon', 'squad', '4')}
    r := dungeon_start('${P}_a', five);
    ok := r->>'error' = 'squad_size' and (r->>'need')::int = 4 and (dungeon_view('${P}_a')->>'squad')::int = 4;
    ${setb('dungeon', 'squad', '5')}
    ${setb('dungeon', 'cost,normal', '3')}
    ${setb('dungeon', 'budget', '14')}
    r := dungeon_start('${P}_a', five);
    x := dungeon_view('${P}_a');
    ok := ok and r->>'error' = 'budget' and (r->>'cost')::int = 15 and (r->>'budget')::int = 14 and (x->>'budget')::int = 14
      and (x->'cost'->>'normal')::int = 3
      and (select bool_and((c->>'cost')::int = case c->>'rarity' when 'normal' then 3 when 'gold' then 5 else (c->>'cost')::int end) from jsonb_array_elements(x->'mine') c)
      and (select bool_and(p.cost = 3) from gauntlet_pool() p join cards c on c.id = p.id where c.rarity = 'normal');
    ${setb('dungeon', 'cost,normal', '1')}
    r2 := gauntlet_squad(gauntlet_week('2031-03-05'));   -- budget 12: the squad costs 12 (the score wants the whole budget)
    ${setb('gauntlet', 'budget', '11')}
    r := gauntlet_squad(gauntlet_week('2031-03-05'));
    ${done('reads balance: the squad size, the budget and the costs (dungeon_start, dungeon_view, gauntlet_pool, gauntlet_view)', `ok and (r2->>'cost')::int = 12 and (r->>'cost')::int <= 11
      and (gauntlet_view('${P}_a')->>'budget')::int = 11`, ", 'squad', r, 'squad12', r2")}`)}
${kase('reads balance: the daily rule numbers (dungeon_rules: the boost and the small budget, in the names too)', `
    ${setb('dungeon', 'rules', '{"boost":0.5,"budget":7}')}
    r := dungeon_rules();
    ${done('reads balance: the daily rule numbers (dungeon_rules: the boost and the small budget, in the names too)', `jsonb_array_length(r) = jsonb_array_length(g_rules)
      and (select count(*) from jsonb_array_elements(r) e where (e->>'boost')::numeric = 0.5 and e->>'name' ~ ' deal \\+50%$') = 3
      and exists (select 1 from jsonb_array_elements(r) e where (e->>'budget')::int = 7 and e->>'name' = 'A budget of 7')
      and exists (select 1 from jsonb_array_elements(g_rules) e where e->>'name' = 'Fire cards deal +25%')
      and exists (select 1 from jsonb_array_elements(g_rules) e where e->>'name' = 'A budget of 9')`, ", 'rules', r")}`)}
${kase('reads balance: the rest room heal and revive, the round cap, the gate', `
    ${setb('dungeon', 'rest_heal', '0.5')}
    ${setb('dungeon', 'rest_revive', '0.1')}
    r := ${REST}->'cards';
    ok := (r->'1'->>'hp')::int = 60 and (r->'2'->>'hp')::int = 8 and not (r->'2'->>'down')::boolean and (r->'3'->>'hp')::int = 100;
    ${setb('dungeon', 'round_cap', '41')}
    r2 := pg_temp.start(five, four, golds);
    ok := ok and r2->3->>'error' is distinct from 'round_cap';
    ${setb('adventure_gate', 'attackers', '0')}
    ok := ok and (adventure_gate('${P}_b')->>'ok')::boolean and (adventure_gate('${P}_b')->>'need')::int = 0;
    ${setb('adventure_gate', 'attackers', '12')}
    ${done('reads balance: the rest room heal and revive, the round cap, the gate', `ok and not (adventure_gate('${P}_a')->>'ok')::boolean and (adventure_gate('${P}_a')->>'need')::int = 12`, ", 'rest', r, 'attack', r2->3")}`)}
${kase('reads balance: the kill loot, the floor Shards, the run cap and the chest odds (dungeon_rewards)', `
    ${setb('dungeon_rewards', 'loot_chance', '1')}
    ${setb('dungeon_rewards', 'shards_kill', '7')}
    ${setb('dungeon_rewards', 'floor_shards', '20')}
    select * into rr from dungeon_runs where player_id = '${P}_b';
    r := dungeon_after_kill(rr, '{"room_type":"guardian","foes":[{"hp":0}],"pend":{"shards":0,"cards":[]},"cards":{}}');
    ok := (r->>'shards')::int = 7 and r->>'card' is not null and (r->'state'->'bank'->>'shards')::int = 7 + 20 * rr.floor;
    ${setb('dungeon_rewards', 'run_shards_cap', '50')}
    ok := ok and (dungeon_loot('{}', 999, null)->'pend'->>'shards')::int = 50 and (dungeon_view('${P}_a')->>'cap')::int = 50;
    ${setb('dungeon_rewards', 'chest_rarity,1', '[0,0,1]')}
    ${done('reads balance: the kill loot, the floor Shards, the run cap and the chest odds (dungeon_rewards)', `ok and (select bool_and(pg_temp.chest(1, gs) = 'secret_rare') from generate_series(1, 30) gs)`, ", 'kill', r - 'state'")}`)}
${kase('one source: settings keeps only the flags and the salt; a value put back into settings changes nothing', `
    ok := (select array_agg(k order by k) from settings, jsonb_object_keys(value) k where key = 'dungeon') = '{enabled,salt}'
      and (select array_agg(k order by k) from settings, jsonb_object_keys(value) k where key = 'gauntlet') = '{enabled}'
      and not exists (select 1 from settings where key = 'adventure_gate')
      and not (balance_get('dungeon_rewards') ? 'shards_room')
      and dungeon_cfg()->'cost' = balance_get('dungeon')->'cost' and dungeon_cfg() ? 'enabled' and dungeon_cfg() ? 'salt' and dungeon_cfg() ? 'shards_kill'
      and gauntlet_cfg()->'budget' = balance_get('gauntlet')->'budget' and gauntlet_cfg() ? 'enabled';
    update settings set value = value || '{"squad":3,"budget":2,"floors":2,"cost":{"normal":9},"elite":{"hp":9,"atk":9},"hp_growth":3,"room_weights":{"rest":1}}' where key = 'dungeon';
    update settings set value = value || '{"budget":2,"room_weights":{"rest":1}}' where key = 'gauntlet';
    insert into settings (key, value) values ('adventure_gate', '{"attackers":99}');
    ${done('one source: settings keeps only the flags and the salt; a value put back into settings changes nothing', `ok and ${FOES} = g_foes and ${GEN} = g_gen
      and (dungeon_view('${P}_a')->>'squad')::int = 5 and (dungeon_view('${P}_a')->>'budget')::int = 12 and (adventure_gate('${P}_a')->>'ok')::boolean
      and (gauntlet_view('${P}_a')->>'budget')::int = 12`)}`)}
${kase('no function reads a removed leaf, no Dungeon / Gauntlet function keeps a coalesce copy of a balance value', `
    select count(*), coalesce(jsonb_agg(p.proname), '[]') into n, x from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.prosrc ~ $x$(cfg|gc|dungeon_cfg[(][)]|gauntlet_cfg[(][)])[[:space:]]*->>?[[:space:]]*'(heal|run_buff|hp_floor|hp_room|atk_floor|attackers|supports|shards_room)'$x$
            or p.prosrc ~ $x$settings where key = 'adventure_gate'$x$ or p.prosrc ~ 'shards_room');
    select count(*) into i from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(dungeon|gauntlet|adventure)'
       and p.prosrc ~ $x$coalesce[(][(]?(cfg|gc|dungeon_cfg[(][)]|gauntlet_cfg[(][)])[[:space:]]*->>?[[:space:]]*'(?!enabled|salt)$x$;
    ${done('no function reads a removed leaf, no Dungeon / Gauntlet function keeps a coalesce copy of a balance value', 'n = 0 and i = 0', ", 'readers', x, 'copies', i")}`)}
${kase('a missing number fails loudly (balance_num), never a silent copy', `
    alter table balance disable trigger balance_check;
    alter table balance disable trigger balance_check_settings;
    update balance set value = value - 'squad' #- '{foe_mult,elite}' where key = 'dungeon';
    update balance set value = value - 'budget' where key = 'gauntlet';
    n := 0;
    begin perform dungeon_view('${P}_a'); exception when others then if sqlerrm = 'balance: no number at dungeon.squad' then n := n + 1; end if; end;
    begin perform dungeon_make_foe('tst|e|1', 3, 2, 'elite'); exception when others then if sqlerrm = 'balance: no number at dungeon.foe_mult.elite.hp' then n := n + 1; end if; end;
    begin perform gauntlet_squad(gauntlet_week('2031-04-02')); exception when others then if sqlerrm = 'balance: no number at gauntlet.budget' then n := n + 1; end if; end;
    ${done('a missing number fails loudly (balance_num), never a silent copy', 'n = 3', ", 'loud', n")}`)}
${kase('balance_check_settings refuses a wrong shape and accepts a right one', `
    n := 0;
    -- (balance_check refuses a lost leaf, a new type or a negative number first: these values pass it)
    for x in select e from jsonb_array_elements('[["dungeon", "squad", 0], ["dungeon", "budget", 4.5], ["dungeon", "floors", 0], ["dungeon", "round_cap", 0.5],
        ["dungeon", "cost,normal", 0], ["dungeon", "cost,gold", 2.5], ["dungeon", "foe_mult,elite,hp", 0], ["dungeon", "hp_growth", 0], ["dungeon", "rest_heal", 1.5],
        ["dungeon", "rest_revive", 0], ["dungeon", "rules,budget", 0], ["dungeon", "room_weights", {"fight":0,"horde":0,"elite":0,"miniboss":0,"treasure":0,"rest":0,"choice":0}],
        ["dungeon", "room_weights,boss", 5], ["gauntlet", "budget", 0], ["gauntlet", "room_weights,treasure", 3], ["adventure_gate", "attackers", 8.5],
        ["dungeon_rewards", "chest_rarity,3", [0,0,0]]]'::jsonb) e loop
      begin
        update balance set value = jsonb_set(value, ('{' || (x->>1) || '}')::text[], x->2) where key = x->>0;
      exception when others then
        if sqlerrm ~ '^balance (dungeon|gauntlet|adventure_gate|dungeon_rewards): ' then n := n + 1; else res := res || jsonb_build_object('other', sqlerrm); end if;
      end;
    end loop;
    ok := true;
    begin
      update balance set value = jsonb_set(jsonb_set(value, '{squad}', '6'), '{room_weights,fight}', '50') where key = 'dungeon';
      update balance set value = jsonb_set(value, '{budget}', '10') where key = 'gauntlet';
      update balance set value = jsonb_set(value, '{chest_rarity,3}', '[50,40,10]') where key = 'dungeon_rewards';
    exception when others then ok := false; res := res || jsonb_build_object('right', sqlerrm); end;
    ${done('balance_check_settings refuses a wrong shape and accepts a right one', 'ok and n = 17', ", 'refused', n")}`)}
  raise exception 'RESULT:%', res::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = msg.match(/RESULT:(\[.*\])/);
if (!m) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const res = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let fails = 0;
  for (const r of res) { if (!r.case) { console.log('NOTE', JSON.stringify(r).slice(0, 300)); continue; } if (!r.ok) fails += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 600)}`); }
  const n = res.filter((r) => r.case).length;
  console.log(`\n${OLD ? 'BASELINE (--old) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${n - fails}/${n} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
