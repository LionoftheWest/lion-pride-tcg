/**
 * Acceptance test for tcg-bot/supabase/balance_table.sql (the ONE balance table + Option C), with NO
 * lasting change: one DO block, rolled back by its final exception.
 *   node scripts/test-balance-table.mjs          (run it on the LOCAL copy: LOCALDB=1 + localdb-preload.mjs)
 *   node scripts/test-balance-table.mjs --old    the baseline: the same checks WITHOUT the migration (must FAIL)
 * Checks:
 *  1. Option C: card power and combat power use the star table per rarity (0 to 5 stars).
 *  2. Gold 5 stars is the strongest single card (every subject cp_mod, with and without points).
 *  3. A change to one balance value changes card_combat at once (no migration), and balance_log has it.
 *  4. The guard: a key cannot be deleted, a value cannot lose a number or go negative, stars keep 6 values.
 *  5. anon / authenticated cannot read or write balance / balance_log; RLS is on.
 *  6. card_power is STABLE; the old settings rows are gone; a missing key fails closed.
 *  7. What the Activity reads: card_powers() = card_power / card_combat for every owned copy and every catalog
 *     card, collection_power_all() = my_collection_power for every member (the Activity computes no CP).
 *  8. NO-CHANGE (only before the migration is applied): with the balance values set to the OLD numbers,
 *     card_power, the collection powers, card_combat, hunt_attack, hunt_support, spawn_hunt and
 *     play_card_effect return exactly what the old functions returned (fixed random seeds).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OLD = process.argv.includes('--old');
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/balance_table.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '').replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
// 2026-10-09: the live-version guard of this old file is left out. hunt_random_target.sql replaced hunt_attack, so the guard
// refuses the file on a current database (as designed). The test checks what the file DOES, inside the rolled-back block.
if (mig.includes('$m$') || mig.includes('$r$')) throw new Error('the migration must not contain $m$ or $r$');

// Option C (Nathan 2026-10-03), written here on purpose: the test checks the table against the decision.
const C = { normal: [1, 3, 4.5, 5.75, 7, 8], illustrated_rare: [1, 2.2, 3.2, 4.0, 4.8, 5.5], secret_rare: [1, 1.7, 2.2, 2.7, 3.1, 3.5],
  full_art: [1, 1.4, 1.7, 2.0, 2.25, 2.5], event: [1, 1.4, 1.7, 2.0, 2.25, 2.5], gold: [1, 1.15, 1.27, 1.38, 1.49, 1.6] };
const BASE = { normal: 10, illustrated_rare: 20, secret_rare: 40, full_art: 75, event: 75, gold: 140 };
const RAR = Object.keys(C);
const OLD_COLL = JSON.stringify(Object.fromEntries([...RAR, 'promo'].map((r) => [r, [1, 1.25, 1.5, 1.75, 2, 2.5]])));
const OLD_COMBAT = JSON.stringify(Object.fromEntries([...RAR, 'promo'].map((r) => [r, [1, 1.08, 1.16, 1.24, 1.32, 1.40]])));

// The fights and plays of the no-change check: the same code runs on the old and on the new functions.
const SCENARIO = String.raw`
  -- 6 attackers (abilities, tags, mixed stars / points) + 8 supports (one per effect), owned by tst_bal.
  insert into players (id, username) values ('tst_bal', 'tst bal'), ('tst_bal2', 'tst bal2'), ('tst_balt', 'tst balt');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select 'tst_bal', id, 1, (row_number() over (order by id)) % 6, case when (row_number() over (order by id)) % 2 = 0 then '{"attack":3,"precision":2}'::jsonb else '{}'::jsonb end
      from unnest(v_atk) id;
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) select 'tst_bal', id, 1, 2, '{"potency":3}' from unnest(v_sup) id;
  v_b := 0;
  foreach v_pl in array array['["armored","volatile","frenzied"]', '["shrouded","thorns","flaming"]', '["regenerating","armored"]', '["frenzied","flaming","volatile"]', '["thorns"]'] loop
    v_b := v_b + 1;
    insert into player_effects (player_id, primitive, amount, duration_s, options, starts_at)
      values ('tst_bal', 'rally', 25, null, '{}', now() - interval '1 minute'), ('tst_bal', 'butterfingers', 15, null, '{}', now() - interval '1 minute'),
             ('tst_bal', 'mend', 40, null, '{}', now() - interval '1 minute');
    insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, passive, hp_share, stats)
      values ('Bal Test', 'Heroic', v_weak, v_resist, 2500, 2500, now() + interval '1 day',
              jsonb_build_object('kind', v_pl::jsonb->>0, 'list', (select jsonb_agg(jsonb_build_object('kind', k)) from jsonb_array_elements_text(v_pl::jsonb) k)),
              250, null) returning id into v_h;
    -- the locked squad of the day (hunt_squads.sql / adventure_gate.sql): the 6 attackers + this boss's 2 supports
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids)
      values (v_h, 'tst_bal', (now() at time zone 'America/Denver')::date,
              v_atk || array[v_sup[1 + ((v_b - 1) * 2) % cardinality(v_sup)], v_sup[1 + ((v_b - 1) * 2 + 1) % cardinality(v_sup)]]);
    perform setseed(0.37);
    for v_i in 1..70 loop
      if v_i % 4 = 2 then
        v_c := v_sup[1 + ((v_b - 1) * 2 + (v_i / 4) % 2) % cardinality(v_sup)];
        -- an ally effect goes to an attacker that has the support's affinity tag (the matched bonus), else the first
        v_tg := coalesce((select a.id from unnest(v_atk) a(id) join cards c on c.id = a.id join subjects s on s.id = c.subject_id
                           where (select s2.ability->>'affinity' from cards c2 join subjects s2 on s2.id = c2.subject_id where c2.id = v_c) = any(s.tag_slugs) limit 1), v_atk[1]);
        v_res := v_res || jsonb_build_array(hunt_support('tst_bal', v_h, v_c, v_tg));
      end if;
      v_r := null;
      for v_c in select unnest(v_atk) loop
        v_r := hunt_attack('tst_bal', v_h, v_c);
        exit when coalesce(v_r->>'error', '') not in ('stunned', 'downed');
      end loop;
      v_res := v_res || jsonb_build_array(v_r);
      exit when v_r->>'error' is not null or coalesce((v_r->>'defeated')::boolean, false);
    end loop;
    delete from hunt_card_hp where player_id = 'tst_bal'; delete from hunt_combat_state where player_id = 'tst_bal';
  end loop;
  -- the Dungeon move pool (combat_pool_act): every move kind, charge rounds, stuns, rage
  perform setseed(0.21);
  for v_i in 1..300 loop
    v_res := v_res || jsonb_build_array(combat_pool_act(50 + v_i % 7, 1 + (v_i % 3) * 0.2, v_i % 13, case when v_i % 17 = 0 then v_i % 13 else 0 end,
      (v_i % 10) / 10.0, 400, '[{"name":"A","kind":"heavy","w":1},{"name":"B","kind":"flurry","w":1},{"name":"C","kind":"slam","w":1},{"name":"D","kind":"drain","w":1},{"name":"E","kind":"stun","w":1},{"name":"F","kind":"poison","w":1},{"name":"G","kind":"regenerate","w":1},{"name":"H","kind":"guard","w":1},{"name":"I","kind":"strike","w":1}]', v_i % 2 = 0));
  end loop;
  for v_i in 1..6 loop
    perform setseed(v_i / 10.0);
    v_h := spawn_hunt(3);
    v_res := v_res || (select jsonb_build_array(jsonb_build_object('name', name, 'tier', tier, 'weak', weak_points, 'resist', resist_points,
      'passive', passive, 'hp', hp_max, 'share', hp_share, 'stats', stats)) from hunts where id = v_h);
  end loop;
  foreach v_c in array v_fx loop
    insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values ('tst_bal2', v_c, 1, 3, '{"potency":2,"haste":3}')
      on conflict (player_id, card_id) do nothing;
    v_r := play_card_effect('tst_bal2', v_c, 'tst_balt');
    v_res := v_res || jsonb_build_array(v_r - 'play_id');
  end loop;`;

const body = String.raw`do $t$
declare
  res jsonb := '[]'; r jsonb; ok boolean; bad text; n int; v numeric; a int; rar text; m numeric; pre boolean;
  v_atk bigint[]; v_sup bigint[]; v_fx bigint[]; v_b int; v_tg bigint; v_weak jsonb; v_resist jsonb; v_pl text; v_h bigint; v_i int; v_c bigint; v_r jsonb;
  v_res jsonb; old_pow jsonb; old_cmb jsonb; old_fight jsonb; new_pow jsonb; new_cmb jsonb; new_fight jsonb; 
  g_min int; o_max int; o_who text; lid bigint; e text;
begin
  pre := to_regclass('public.balance') is null;
  -- Fixtures (real cards): attackers with an attack ability or tags, two supports, three effect cards.
  -- one support per effect (8), the empower / heal / shield ones first
  select array_agg(id order by ord) into v_sup from (select distinct on (s.ability->>'effect') c.id,
      array_position(array['empower','weaken','heal','expose','shield','stun','smite','cleanse'], s.ability->>'effect') ord
    from cards c join subjects s on s.id = c.subject_id where s.ability->>'kind' = 'support' order by s.ability->>'effect', c.id) x;
  -- 6 attackers: 2 that carry the affinity tag of the empower / weaken / heal support (the matched bonus), then abilities or tags
  select array_agg(distinct id) into v_atk from (
    (select distinct on (sp.id) c.id from unnest(v_sup[1:3]) sp(id) join cards cs on cs.id = sp.id join subjects ss on ss.id = cs.subject_id
       join subjects s on (ss.ability->>'affinity') = any(s.tag_slugs) join cards c on c.subject_id = s.id
      where s.type in ('Character','Creature') and c.rarity::text <> 'event' order by sp.id, c.id limit 2)
    union all
    (select c.id from cards c join subjects s on s.id = c.subject_id
      where s.type in ('Character','Creature') and c.rarity::text in ('normal','illustrated_rare','secret_rare','full_art','gold')
        and (s.ability->>'kind' = 'attack' or cardinality(s.tag_slugs) > 2) order by c.id limit 5)) x;
  v_atk := v_atk[1:6];
  -- 3 boon / prank cards, a Gold one where it exists (the effect tier)
  select array_agg(id) into v_fx from (select distinct on (s.effect->>'primitive') c.id from cards c join subjects s on s.id = c.subject_id
    where s.effect->>'primitive' in ('rally','mend','butterfingers') order by s.effect->>'primitive', (c.rarity::text = 'gold') desc, c.id) x;
  select jsonb_agg(jsonb_build_object('kind','tag','value',t)) into v_weak from (select unnest(s.tag_slugs) t from cards c join subjects s on s.id = c.subject_id where c.id = v_atk[1] limit 1) x;
  select jsonb_agg(jsonb_build_object('kind','tag','value',t)) into v_resist from (select unnest(s.tag_slugs) t from cards c join subjects s on s.id = c.subject_id where c.id = v_atk[2] offset 1 limit 1) x;

  -- 8a. The OLD answers (only before the migration is applied; each run is rolled back by its own block).
  if pre and ${!OLD} then
    select jsonb_object_agg(rr || ':' || aa || ':' || mm, card_power(rr, aa, mm)) into old_pow
      from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold','promo']) rr, generate_series(0,5) aa,
           unnest(array[0.92,0.94,0.95,0.97,0.99,1.0,1.05,1.06]) mm;
    old_pow := old_pow || jsonb_build_object('coll', (select jsonb_object_agg(id, my_collection_power(id)) from (select id from players order by id limit 40) p),
      'top', (select jsonb_agg(to_jsonb(x)) from top_collection_power(100) x), 'dep', deployable_power(),
      'cost', (select jsonb_object_agg(rr || aa, ascend_cost(rr, aa)) from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold','promo']) rr, generate_series(0,5) aa));
    select jsonb_object_agg(rr || ':' || aa || ':' || mm || ':' || pp, card_combat(rr, aa, mm, pp::jsonb)) into old_cmb
      from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold']) rr, generate_series(0,5) aa,
           unnest(array[0.92,1.0,1.06]) mm, unnest(array['{}','{"attack":15}','{"vitality":7,"precision":5,"potency":2,"haste":1}']) pp;
    begin
      v_res := '[]';
      ${SCENARIO}
      old_fight := v_res;
      raise exception 'rollback-old';
    exception when others then
      if sqlerrm <> 'rollback-old' then old_fight := jsonb_build_object('error', sqlerrm); end if;
    end;
  end if;

  ${OLD ? '-- --old: no migration' : '-- The migration.\n  execute $m$' + mig + '$m$;'}

  -- 8b. The NEW answers with the OLD numbers in the table: they must be the same.
  if pre and ${!OLD} then
    update balance set value = '${OLD_COLL}'::jsonb where key = 'stars';
    select jsonb_object_agg(rr || ':' || aa || ':' || mm, card_power(rr, aa, mm)) into new_pow
      from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold','promo']) rr, generate_series(0,5) aa,
           unnest(array[0.92,0.94,0.95,0.97,0.99,1.0,1.05,1.06]) mm;
    new_pow := new_pow || jsonb_build_object('coll', (select jsonb_object_agg(id, my_collection_power(id)) from (select id from players order by id limit 40) p),
      'top', (select jsonb_agg(to_jsonb(x)) from top_collection_power(100) x), 'dep', deployable_power(),
      'cost', (select jsonb_object_agg(rr || aa, ascend_cost(rr, aa)) from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold','promo']) rr, generate_series(0,5) aa));
    res := res || jsonb_build_object('case', 'no change: old star values -> card_power x 336, ascend_cost x 42, my_collection_power x 40, top_collection_power, deployable_power = the old functions',
      'ok', new_pow = old_pow, 'diff', (select jsonb_object_agg(k, jsonb_build_array(old_pow->k, new_pow->k)) from jsonb_object_keys(old_pow) k where old_pow->k is distinct from new_pow->k));
    update balance set value = '${OLD_COMBAT}'::jsonb where key = 'stars';
    select jsonb_object_agg(rr || ':' || aa || ':' || mm || ':' || pp, card_combat(rr, aa, mm, pp::jsonb)) into new_cmb
      from unnest(array['normal','illustrated_rare','secret_rare','full_art','event','gold']) rr, generate_series(0,5) aa,
           unnest(array[0.92,1.0,1.06]) mm, unnest(array['{}','{"attack":15}','{"vitality":7,"precision":5,"potency":2,"haste":1}']) pp;
    res := res || jsonb_build_object('case', 'no change: the old 1 + 0.08 x stars -> card_combat x 324 = the old function', 'ok', new_cmb = old_cmb,
      'diff', (select jsonb_object_agg(k, jsonb_build_array(old_cmb->k, new_cmb->k)) from jsonb_object_keys(old_cmb) k where old_cmb->k is distinct from new_cmb->k));
    ${process.env.BAL_MUTATE || ''} -- BAL_MUTATE: a mutation to prove that this check fails (see the PR)
    begin
      v_res := '[]';
      ${SCENARIO}
      new_fight := v_res;
      raise exception 'rollback-new';
    exception when others then
      if sqlerrm <> 'rollback-new' then new_fight := jsonb_build_object('error', sqlerrm); end if;
    end;
    res := res || jsonb_build_object('case', 'no change: ' || (case when jsonb_typeof(old_fight) = 'array' then jsonb_array_length(old_fight) else 0 end) || ' hunt_attack / hunt_support results (5 bosses, all passives, rally + butterfingers + mend), 300 Dungeon monster moves (combat_pool_act), 6 spawn_hunt, 3 play_card_effect = the old functions, same seeds',
      'ok', old_fight = new_fight and (case when jsonb_typeof(old_fight) = 'array' then jsonb_array_length(old_fight) > 50 else false end),
      'detail', (select format('%s attacks, %s damage, %s crits, %s blocks, %s misses, %s boss moves, %s supports ok, %s plays ok', count(*) filter (where x ? 'damage'),
          sum((x->>'damage')::int), count(*) filter (where (x->>'crit')::boolean), count(*) filter (where x->>'outcome' = 'blocked'),
          count(*) filter (where x->>'outcome' = 'miss'), count(*) filter (where x->'boss_action' is not null and x->'boss_action' <> 'null'),
          count(*) filter (where x ? 'effect' and (x->>'ok')::boolean), count(*) filter (where x ? 'primitive' and (x->>'ok')::boolean))
        from jsonb_array_elements(case when jsonb_typeof(old_fight) = 'array' then old_fight else '[]' end) x),
      'first_diff', (select jsonb_build_array(i, old_fight->i, new_fight->i) from generate_series(0, greatest(case when jsonb_typeof(old_fight) = 'array' then jsonb_array_length(old_fight) else 0 end, 1) - 1) i
                      where old_fight->i is distinct from new_fight->i limit 1),
      'old_error', case when jsonb_typeof(old_fight) = 'object' then old_fight end, 'new_error', case when jsonb_typeof(new_fight) = 'object' then new_fight end);
    update balance set value = '${JSON.stringify({ ...C, promo: C.normal })}'::jsonb where key = 'stars';
  elsif not pre then
    res := res || jsonb_build_object('case', 'no change: SKIPPED (the migration is already applied here; run on a fresh copy)', 'ok', true, 'skipped', true);
  end if;

  -- 1. Option C.
  begin
    ok := true; bad := '';
    foreach rar in array array['normal','illustrated_rare','secret_rare','full_art','event','gold'] loop
      for a in 0..5 loop
        v := (('${JSON.stringify(C)}'::jsonb)->rar->>a)::numeric;
        if card_power(rar, a, 1.0) <> round((('${JSON.stringify(BASE)}'::jsonb)->>rar)::numeric * v)
           or (card_combat(rar, a, 1.0, '{}')->>'cp')::int <> round((('${JSON.stringify(BASE)}'::jsonb)->>rar)::numeric * v)
           or (card_combat(rar, a, 1.0, '{"attack":15}')->>'cp')::int <> round((('${JSON.stringify(BASE)}'::jsonb)->>rar)::numeric * v * 1.75) then
          ok := false; bad := bad || rar || a || ' ';
        end if;
      end loop;
    end loop;
    res := res || jsonb_build_object('case', 'Option C: card_power and card_combat (0 / 15 Attack) = base x C[rarity][star] for 6 rarities x 6 stars', 'ok', ok, 'bad', bad,
      'normal5', card_power('normal', 5, 1.0), 'gold0', card_power('gold', 0, 1.0), 'gold5', card_power('gold', 5, 1.0));
  exception when others then res := res || jsonb_build_object('case', 'Option C values', 'ok', false, 'error', sqlerrm); end;

  -- 2. Gold 5 stars is the strongest single card (every real subject cp_mod, the same points).
  begin
    ok := true; bad := '';
    foreach e in array array['{}', '{"attack":15}', '{"vitality":15}'] loop
      select min((card_combat('gold', 5, coalesce(s.cp_mod, 1), e::jsonb)->>'cp')::int) into g_min from subjects s;
      select max((card_combat(r2, a2, coalesce(s.cp_mod, 1), e::jsonb)->>'cp')::int) into o_max
        from subjects s, unnest(array['normal','illustrated_rare','secret_rare','full_art','event']) r2, generate_series(0,5) a2;
      -- and for one subject, each star is stronger than the one before (gold 5 > gold 4 > ...).
      select count(*) into n from subjects s, generate_series(0,4) a2
        where (card_combat('gold', a2, coalesce(s.cp_mod, 1), e::jsonb)->>'cp')::int >= (card_combat('gold', a2 + 1, coalesce(s.cp_mod, 1), e::jsonb)->>'cp')::int;
      if not (g_min > o_max and n = 0) then ok := false; end if;
      bad := bad || format('%s: weakest gold 5* %s > strongest other card %s, stars not rising %s; ', e, g_min, o_max, n);
    end loop;
    res := res || jsonb_build_object('case', 'Gold 5 stars beats every non-Gold card (any subject cp_mod 0.92-1.06, any star, the same points); each Gold star beats the one before', 'ok', ok, 'detail', bad);
  exception when others then res := res || jsonb_build_object('case', 'Gold 5 stars strongest', 'ok', false, 'error', sqlerrm); end;

  -- 3. A value change acts at once, and balance_log has it (who + old + new).
  begin
    perform set_config('balance.by', 'test-balance-table', true);
    update balance set value = jsonb_set(value, '{normal,5}', '9') where key = 'stars';
    select id into lid from balance_log where key = 'stars' order by id desc limit 1;
    res := res || jsonb_build_object('case', 'stars.normal.5 = 9 -> card_combat(normal 5*) = 90 at once; balance_log row (old 8, new 9, by test-balance-table)', 'ok',
      (card_combat('normal', 5, 1.0, '{}')->>'cp')::int = 90 and card_power('normal', 5, 1.0) = 90
      and (select (old_value->'normal'->>5)::numeric = 8 and (new_value->'normal'->>5)::numeric = 9 and changed_by = 'test-balance-table' and op = 'update' from balance_log where id = lid)
      and (select updated_by = 'test-balance-table' from balance where key = 'stars'),
      'cp', card_combat('normal', 5, 1.0, '{}')->'cp');
    update balance set value = jsonb_set(value, '{normal,5}', '8') where key = 'stars';
    update balance set value = jsonb_set(value, '{Heroic}', '50000') where key = 'boss_hp';
    perform setseed(0.5);
    v_h := spawn_hunt(3);
    res := res || jsonb_build_object('case', 'boss_hp.Heroic = 50000 -> a spawn takes the HP of its tier from the table at once', 'ok',
      (select hp_max = balance_num('boss_hp', tier) from hunts where id = v_h), 'hp', (select jsonb_build_array(tier, hp_max) from hunts where id = v_h));
  exception when others then res := res || jsonb_build_object('case', 'a change acts at once + balance_log', 'ok', false, 'error', sqlerrm); end;

  -- 4. The guard.
  begin
    ok := true; bad := '';
    begin delete from balance where key = 'combat'; ok := false; bad := bad || 'delete passed; '; exception when others then null; end;
    begin update balance set value = value - 'crit' where key = 'combat'; ok := false; bad := bad || 'a lost key passed; '; exception when others then null; end;
    begin update balance set value = jsonb_set(value, '{crit}', '"0.1"') where key = 'combat'; ok := false; bad := bad || 'a string passed; '; exception when others then null; end;
    begin update balance set value = jsonb_set(value, '{miss}', '-0.1') where key = 'combat'; ok := false; bad := bad || 'a negative passed; '; exception when others then null; end;
    begin update balance set value = jsonb_set(value, '{gold}', '[1,1.1,1.2]') where key = 'stars'; ok := false; bad := bad || '3 stars passed; '; exception when others then null; end;
    begin update balance set value = jsonb_set(value, '{gold,0}', '0') where key = 'stars'; ok := false; bad := bad || 'a 0 star value passed; '; exception when others then null; end;
    begin update balance set value = jsonb_set(value, '{crit}', '0.12') where key = 'combat'; exception when others then ok := false; bad := bad || 'a good change refused: ' || sqlerrm; end;
    res := res || jsonb_build_object('case', 'guard: delete / lost key / string / negative / 3 stars / 0 refused; a good change passes', 'ok', ok, 'bad', bad);
  exception when others then res := res || jsonb_build_object('case', 'guard', 'ok', false, 'error', sqlerrm); end;

  -- 5. The public API roles.
  begin
    res := res || jsonb_build_object('case', 'anon + authenticated: no read / write on balance + balance_log, no execute on balance_get; RLS on', 'ok',
      not has_table_privilege('anon', 'public.balance', 'SELECT') and not has_table_privilege('authenticated', 'public.balance', 'SELECT')
      and not has_table_privilege('anon', 'public.balance', 'INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'public.balance', 'INSERT,UPDATE,DELETE')
      and not has_table_privilege('anon', 'public.balance_log', 'SELECT,INSERT,UPDATE,DELETE') and not has_table_privilege('authenticated', 'public.balance_log', 'SELECT,INSERT,UPDATE,DELETE')
      and not has_function_privilege('anon', 'public.balance_get(text)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.balance_get(text)', 'EXECUTE')
      and (select relrowsecurity from pg_class where oid = 'public.balance'::regclass) and (select relrowsecurity from pg_class where oid = 'public.balance_log'::regclass));
  exception when others then res := res || jsonb_build_object('case', 'API roles', 'ok', false, 'error', sqlerrm); end;

  -- 6. STABLE, the old settings rows gone, fail closed.
  begin
    res := res || jsonb_build_object('case', 'card_power + card_max_hp STABLE; the 9 old settings rows gone; stat_cfg() = balance stat_points (no star key)', 'ok',
      (select provolatile from pg_proc where oid = 'public.card_power(text,integer,numeric)'::regprocedure) = 's'
      and (select provolatile from pg_proc where oid = 'public.card_max_hp(integer)'::regprocedure) = 's'
      and not exists (select 1 from settings where key in ('stat_points','hunt_atk','hunt_hp','hunt_boss_stats','hunt_round_cap','hunt_daily_card_cap','card_effect_tiers','card_effect_ascension','card_effect_cooldown_scale'))
      and stat_cfg() = balance_get('stat_points') and not stat_cfg() ? 'star');
    begin perform balance_get('no_such_key'); ok := false; exception when others then ok := sqlerrm like 'balance: no value%'; end;
    res := res || jsonb_build_object('case', 'fail closed: a missing key raises', 'ok', ok);
  exception when others then res := res || jsonb_build_object('case', 'STABLE / settings / fail closed', 'ok', false, 'error', sqlerrm); end;

  -- 7. What the Activity reads (it computes no CP): card_powers and collection_power_all.
  begin
    select count(*) into n from (select p.id, card_powers(p.id) cp from players p order by p.id limit 60) m
      join player_cards pc on pc.player_id = m.id and pc.quantity > 0 join cards c on c.id = pc.card_id left join subjects s on s.id = c.subject_id
      where (m.cp->(pc.card_id::text)) is distinct from
            (card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points) || jsonb_build_object('power', card_power(c.rarity::text, pc.ascension, s.cp_mod)));
    select count(*) into a from (select card_powers(null) cp) b, cards c left join subjects s on s.id = c.subject_id
      where (b.cp->(c.id::text)) is distinct from jsonb_build_object('power', card_power(c.rarity::text, 0, s.cp_mod), 'hp', card_max_hp(card_power(c.rarity::text, 0, s.cp_mod)));
    select count(*) into v_i from collection_power_all() x where x.power <> my_collection_power(x.player_id);
    res := res || jsonb_build_object('case', 'the Activity reads SQL: card_powers(member) = card_combat + card_power for every copy of 60 members, card_powers(null) = 0-star power + HP for every card, collection_power_all = my_collection_power for every member',
      'ok', n = 0 and a = 0 and v_i = 0 and (select count(*) from collection_power_all()) = (select count(distinct player_id) from player_cards where quantity >= 1), 'bad_copies', n, 'bad_catalog', a, 'bad_members', v_i);
  exception when others then res := res || jsonb_build_object('case', 'card_powers / collection_power_all', 'ok', false, 'error', sqlerrm); end;

  raise exception 'RES %', jsonb_build_object('res', res, 'pre', pre);
end $t$;`;

const out = await q(body);
const msg = out.message || out.error || JSON.stringify(out);
const mm = msg.match(/RES (\{.*\})/s);
if (!mm) { console.log('FAIL the block did not finish:', msg.slice(0, 1500)); process.exit(1); }
const R = JSON.parse(mm[1]);
const rows = R.res;

let fails = 0;
console.log(OLD ? 'BASELINE (--old: without balance_table.sql) - these checks must FAIL\n' : `balance_table.sql${R.pre ? ' (fresh copy: the no-change checks run)' : ''}\n`);
for (const r of rows) {
  if (!r.ok) fails += 1;
  const extra = { ...r }; delete extra.case; delete extra.ok;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${!r.ok || r.skipped ? '  ' + JSON.stringify(extra).slice(0, 600) : ''}`);
  if (r.ok && r.detail) console.log(`     ${r.detail}`);
}
console.log(`\nFAILS ${fails} of ${rows.length}`);
process.exitCode = OLD ? (fails > 0 ? 0 : 1) : (fails ? 1 : 0);
