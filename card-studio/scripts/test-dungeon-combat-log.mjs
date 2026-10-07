/**
 * Acceptance test for dungeon_combat_log.sql (every Dungeon and Gauntlet HP change writes one combat_actions row).
 * One DO block, rolled back (the final RAISE), fake members, fixed random seeds (setseed):
 *   node scripts/test-dungeon-combat-log.mjs              the migration file (+ admin_read.sql), executed inside the block
 *   node scripts/test-dungeon-combat-log.mjs --old        the database as it is (the baseline: it must FAIL before the migration)
 *   node scripts/test-dungeon-combat-log.mjs --mutations  each mutation must make at least one case FAIL
 * Run it on the local copy: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-dungeon-combat-log.mjs
 *
 * GOLDEN (G1): the same scripted runs (4 daily, 2 Gauntlet; attacks, supports, room rewards, doors, rests, crafted foes
 * with poison, Slam, Drain, Cataclysm, thorns, burn and regeneration) are played twice on the same seeds: with the
 * functions as they were before this file (git 95cf127, the live text) and with the file. Every function result, the
 * final run row and the dungeon_log rows must be IDENTICAL: the log must not change the game.
 * Invariants:
 *   L1 the runs play (both modes) and write rows
 *   L2 one attack row per attack that worked, one support row per support play that worked, none for a refused one
 *   L3 an attack row: result.dmg = the attack's damage, value = the HP the foe lost, outcome the same
 *   L4 mode dungeon / gauntlet, ref_id = the run, player_id = the member, game_day = the run day
 *   L5 dungeon_damage_reconcile: every card and every foe of every run has unexplained 0
 *   L6 every kind of HP change is logged at least once (attack, lifesteal, heal, smite, enemy hit, area, poison, thorns,
 *      burn, foe heal, room reward or rest)
 *   L7 the reconcile sees a card HP change with no row, and a missing attack row
 *   L8 admin_health dungeon_runs: the runs after the file, 0 unexplained
 *   L9 admin_read.sql: a Dungeon support play does not count as Hunt activity
 *   R1 a re-run of the files that carry the same function text leaves the md5s and the kind check identical
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const SUP = new URL('../../tcg-bot/supabase/', import.meta.url);
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const file = (n) => strip(readFileSync(fileURLToPath(new URL(n, SUP)), 'utf8'));
const src = file('dungeon_combat_log.sql');
const adminSrc = file('admin_read.sql');
const RERUN = ['gauntlet.sql', 'balance_settings_numbers.sql', 'balance_dungeon_numbers.sql', 'balance_table.sql', 'damage_log.sql', 'admin_read.sql', 'dungeon_combat_log.sql'].map(file);
// The functions BEFORE this file: the live text of 2026-10-07 (the schema snapshot at git 95cf127).
const repo = fileURLToPath(new URL('../../', import.meta.url));
const OLD = ['dungeon_attack', 'dungeon_support', 'dungeon_enemy_turn', 'dungeon_choose'].map((n) => {
  const s = execFileSync('git', ['show', `95cf127:db/schema/functions/${n}.sql`], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
  const a = s.indexOf('CREATE OR REPLACE FUNCTION'), b = s.indexOf('$function$;', a);
  return s.slice(a, b + '$function$;'.length);
}).join('\n');
for (const s of [src, adminSrc, OLD, ...RERUN]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$f$')) throw new Error('a file contains $m$, $t$ or $f$');

// One mutation per mechanism. [file, text, replacement]: 'mig' = dungeon_combat_log.sql, 'admin' = admin_read.sql, 'both' = the two (admin_health).
const MUTATIONS = {
  'attack value = the hit, not the HP lost': ['mig', "'foe', 'dmg', v_fh0 - (f->>'hp')::int, f,", "'foe', 'dmg', v_dmg, f,"],
  'the enemy events are not written': ['mig', "    v_log := v_log || coalesce(et->'hp_log', '[]'::jsonb);\n", ''],
  'poison logs 0': ['mig', "'card', 'dmg', v_h0 - (c->>'hp')::int, c, jsonb_build_object('raw', p)", "'card', 'dmg', 0, c, jsonb_build_object('raw', p)"],
  'an enemy hit logs 0': ["mig", "v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int, c,\n        jsonb_build_object('raw', (act->>'dmg')::int", "v_round, 'card', 'dmg', 0, c,\n        jsonb_build_object('raw', (act->>'dmg')::int"],
  'an area hit logs 0': ['mig', "'area', null, k::bigint, i, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int", "'area', null, k::bigint, i, v_round, 'card', 'dmg', 0"],
  'a foe heal logs 0': ['mig', "'foe', 'heal', (f->>'hp')::int - v_h0, f,", "'foe', 'heal', 0, f,"],
  'thorns logs 0': ['mig', "'thorns', null, p_attacker, p_attacked, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int", "'thorns', null, p_attacker, p_attacked, v_round, 'card', 'dmg', 0"],
  'burn logs 0': ['mig', "'burn', null, p_attacker, p_attacked, v_round, 'card', 'dmg', v_h0 - (c->>'hp')::int", "'burn', null, p_attacker, p_attacked, v_round, 'card', 'dmg', 0"],
  'lifesteal logs 0': ['mig', "least(v_maxhp, (c->>'hp')::int + v_heal) - (c->>'hp')::int, st->'cards'", "0, st->'cards'"],
  'a support heal logs 0': ['mig', "      (tc->>'hp')::int - (st->'cards'->p_target_card::text->>'hp')::int, tc,\n", '      0, tc,\n'],
  'a smite logs 0': ['mig', "      (st->'foes'->v_t->>'hp')::int - (f->>'hp')::int, f,\n", '      0, f,\n'],
  'a support play is not kind support': ['mig', "v_log := dungeon_hp_event('support', v_eff, p_card, p_target_card,", "v_log := dungeon_hp_event('effect', v_eff, p_card, p_target_card,"],
  'no room reward rows': ['mig', "dungeon_hp_changes(r.state, v_mid, 'reward_' || (o->>'kind'), r.floor, r.room) || ", ''],
  'no rest rows': ['mig', " || dungeon_hp_changes(v_mid, st, 'rest', v_f, v_r));", ');'],
  'every row is mode dungeon': ['mig', "case when p_run.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end, p_run.id", "'dungeon', p_run.id"],
  'the reconcile skips card heals': ['mig', "filter (where a.result->>'dir' = 'heal') as h\n      from a where a.result->>'side' = 'card'", "filter (where false) as h\n      from a where a.result->>'side' = 'card'"],
  'the reconcile keeps an earlier foe alive': ['mig', 'coalesce(fs.mx, fl.mx, 0) - coalesce(fs.hp, 0)', 'coalesce(fs.mx, fl.mx, 0) - coalesce(fs.hp, fl.mx, 0)'],
  'the reconcile hides a difference': ['mig', "         ((coalesce(cs.mx, 0) - coalesce(cs.hp, 0)) - (coalesce(cl.d, 0) - coalesce(cl.h, 0)))::bigint", '         0::bigint'],
  'admin_health has no dungeon_runs': ['both', "    'dungeon_runs', (select", "    'dungeon_runs_x', (select"],
  'GAME: a hit takes 1 HP more (golden)': ['mig', "  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg));\n  st := jsonb_set(st, array['foes', v_t::text], f);\n  -- The attack row", "  f := f || jsonb_build_object('hp', greatest(0, (f->>'hp')::int - v_dmg - 1));\n  st := jsonb_set(st, array['foes', v_t::text], f);\n  -- The attack row"],
  'GAME: one more random() call (golden)': ['mig', "  st := st || jsonb_build_object('round', v_round);\n", "  st := st || jsonb_build_object('round', v_round); perform random();\n"],
  'admin: a Dungeon support counts as Hunt activity': ['admin', "where a.mode = 'hunt' and a.kind = 'support' and a.created_at >= b.t0", "where a.kind = 'support' and a.created_at >= b.t0"],
};

const P = 'tst_dgl_';
const body = (mig, admin, rerun) => String.raw`do $t$
declare res jsonb := '[]'; base jsonb := '[]'; cand jsonb := '[]'; sc jsonb; o jsonb; v_day date; i int; n int; k int; bad text; rec record;
  atk bigint[]; ls bigint; sups jsonb; v_md5 jsonb; v_md5b jsonb; runs bigint[]; v_run bigint; ok boolean; h jsonb;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- The Dungeon and the Gauntlet on (rolled back), today's dungeon with no squad rule.
  update settings set value = value || '{"enabled": true}' where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  perform dungeon_generate(v_day);
  update dungeon_days set rule = '{}'::jsonb where day = v_day;
  -- The cards: one lifesteal attacker, attackers for the gate, one support card of each effect (the lowest normal id).
  select min(c.id) into ls from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and s.ability->>'effect' = 'lifesteal';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id <> ls order by c.id limit 9) x;
  select jsonb_object_agg(e, id) into sups from (select s.ability->>'effect' e, min(c.id) id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by 1) x;
  for i in 1..6 loop
    insert into players (id, username) values ('${P}' || i, 'tst dgl ' || i);
    insert into player_cards (player_id, card_id, quantity)
      select '${P}' || i, x, 1 from unnest(array[ls] || atk || array(select (v #>> '{}')::bigint from jsonb_each(sups) e(k2, v))) x;
  end loop;
  -- The scenarios: [player, mode, seed, squad (daily), crafted foes in room 1].
  sc := jsonb_build_array(
    jsonb_build_array('${P}1', 'daily', 0.11, jsonb_build_array(ls, atk[1], atk[2], sups->'heal', sups->'smite'), true),
    jsonb_build_array('${P}2', 'daily', 0.37, jsonb_build_array(ls, atk[3], atk[4], sups->'shield', sups->'stun'), false),
    jsonb_build_array('${P}3', 'daily', -0.42, jsonb_build_array(ls, atk[5], atk[6], sups->'empower', sups->'weaken'), true),
    jsonb_build_array('${P}4', 'daily', 0.73, jsonb_build_array(ls, atk[7], atk[8], sups->'expose', sups->'cleanse'), false),
    jsonb_build_array('${P}5', 'gauntlet', 0.21, '[]'::jsonb, false),
    jsonb_build_array('${P}6', 'gauntlet', -0.66, '[]'::jsonb, true));

  -- One scripted run: a support play on even rounds, an attack with the first attacker that can, else a room pick.
  create function pg_temp.dgl_play(p_player text, p_mode text, p_seed float8, p_squad bigint[], p_craft boolean) returns jsonb
  language plpgsql as $f$
  declare out jsonb := '[]'; r jsonb; st jsonb; i int; c bigint; a bigint[]; s bigint[]; ok boolean; v_run bigint;
  begin
    perform setseed(p_seed);
    if p_mode = 'gauntlet' then r := gauntlet_start(p_player); else r := dungeon_start(p_player, p_squad); end if;
    out := out || jsonb_build_array(r);
    if not coalesce((r->>'ok')::boolean, false) then return out; end if;
    v_run := (r->>'run')::bigint;
    if p_craft then   -- room 1: poison, Slam and Drain moves, a Cataclysm cycle, thorns, flaming and regenerating
      update dungeon_runs set state = jsonb_set(state, '{foes}', (select jsonb_agg(f || '{"passives": ["thorns", "flaming", "regenerating"], "charge": true,
          "moves": [{"w": 2, "kind": "poison", "name": "Venom"}, {"w": 2, "kind": "slam", "name": "Stomp"}, {"w": 1, "kind": "drain", "name": "Leech"}, {"w": 1, "kind": "strike", "name": "Hit"}]}'::jsonb
          order by ord) from jsonb_array_elements(state->'foes') with ordinality e(f, ord)))
        where id = v_run;
    end if;
    select array_agg(key::bigint order by key::bigint) filter (where not coalesce((value->>'sup')::boolean, false)),
           array_agg(key::bigint order by key::bigint) filter (where coalesce((value->>'sup')::boolean, false))
      into a, s from dungeon_runs, jsonb_each(state->'cards') where id = v_run;
    for i in 1..260 loop
      select state into st from dungeon_runs where id = v_run;
      exit when (select status from dungeon_runs where id = v_run) <> 'active';
      if st->>'phase' = 'fight' then
        if (st->>'round')::int % 2 = 0 and s is not null then
          foreach c in array s loop
            r := dungeon_support(p_player, c, a[1 + (i % array_length(a, 1))], i % 2, p_mode);
            out := out || jsonb_build_array(jsonb_build_object('support', c) || r);
            exit when coalesce((r->>'ok')::boolean, false);
          end loop;
          select state into st from dungeon_runs where id = v_run;
          continue when st->>'phase' <> 'fight' or (select status from dungeon_runs where id = v_run) <> 'active';
        end if;
        ok := false;
        foreach c in array a loop
          r := dungeon_attack(p_player, c, i % 3, p_mode);
          if coalesce((r->>'ok')::boolean, false) then out := out || jsonb_build_array(jsonb_build_object('attack', c) || r); ok := true; exit; end if;
        end loop;
        if not ok then out := out || jsonb_build_array(r); exit; end if;
      else
        r := dungeon_choose(p_player, i % greatest(1, jsonb_array_length(coalesce(st->'offers', '[]'::jsonb))), p_mode);
        out := out || jsonb_build_array(jsonb_build_object('choose', true) || r);
        exit when not coalesce((r->>'ok')::boolean, false);
      end if;
    end loop;
    return out || jsonb_build_array((select to_jsonb(d) from dungeon_runs d where d.id = v_run),
      (select jsonb_agg(jsonb_build_array(l.n, l.action, l.result) order by l.n) from dungeon_log l where l.run_id = v_run));
  end $f$;

  -- 1. GOLDEN base: the functions BEFORE this file, on the same seeds and the same run ids. Rolled back (the sub-block).
  ${mig ? `begin
    execute $m$${OLD}$m$;
    alter table dungeon_runs alter column id restart with 880000001;
    for i in 0..jsonb_array_length(sc) - 1 loop
      base := base || jsonb_build_array(pg_temp.dgl_play(sc->i->>0, sc->i->>1, (sc->i->>2)::float8,
        array(select (x #>> '{}')::bigint from jsonb_array_elements(sc->i->3) x), (sc->i->>4)::boolean));
    end loop;
    raise exception 'GOLDEN_BASE_DONE';
  exception when others then
    if sqlerrm <> 'GOLDEN_BASE_DONE' then raise; end if;
  end;` : '-- --old: no golden base'}

  -- 2. The file (and admin_read.sql, the same PR), then the same runs with the log.
  ${mig ? `execute $m$${mig}$m$;
  execute $m$${admin}$m$;` : '-- the database as it is'}
  insert into schema_migrations (file, sha256) values ('dungeon_combat_log.sql', 'test');
  alter table dungeon_runs alter column id restart with 880000001;
  for i in 0..jsonb_array_length(sc) - 1 loop
    cand := cand || jsonb_build_array(pg_temp.dgl_play(sc->i->>0, sc->i->>1, (sc->i->>2)::float8,
      array(select (x #>> '{}')::bigint from jsonb_array_elements(sc->i->3) x), (sc->i->>4)::boolean));
  end loop;
  select array_agg(id order by id) into runs from dungeon_runs where player_id like '${P}%' and day = v_day;

  -- G1 golden
  bad := '';
  ${mig ? `for i in 0..jsonb_array_length(sc) - 1 loop
    if base->i is distinct from cand->i then
      select coalesce(min(j), -1) into k from generate_series(0, greatest(jsonb_array_length(base->i), jsonb_array_length(cand->i)) - 1) j
        where base->i->j is distinct from cand->i->j;
      bad := bad || 'scenario ' || i || ' differs at step ' || k || ' (' || left(coalesce((base->i->k)::text, 'none'), 160) || ' vs ' || left(coalesce((cand->i->k)::text, 'none'), 160) || '); ';
    end if;
  end loop;` : "bad := 'no golden base (--old)';"}
  res := res || jsonb_build_object('case', 'G1 golden: 6 seeded runs give IDENTICAL results, run rows and dungeon_log before and after', 'ok', bad = '', 'diff', bad,
    'steps', (select jsonb_agg(jsonb_array_length(x)) from jsonb_array_elements(cand) x));

  -- L1 the runs play and write rows (both modes)
  select count(*) into n from combat_actions where ref_id = any(runs) and mode in ('dungeon', 'gauntlet');
  res := res || jsonb_build_object('case', 'L1 6 runs (4 daily, 2 Gauntlet) played and wrote rows', 'ok',
    coalesce(cardinality(runs) = 6 and n > 50 and (select count(distinct mode) from combat_actions where ref_id = any(runs)) = 2, false), 'runs', cardinality(runs), 'rows', n);

  -- L2 one attack row per attack that worked; one support row per support that worked (none for a refused play)
  bad := '';
  foreach v_run in array coalesce(runs, '{}') loop
    select x into o from jsonb_array_elements(cand) x where (x->-2->>'id')::bigint = v_run;
    select count(*) filter (where e ? 'attack' and (e->>'ok')::boolean), count(*) filter (where e ? 'support' and (e->>'ok')::boolean)
      into n, k from jsonb_array_elements(o) e;
    if n <> (select count(*) from combat_actions where ref_id = v_run and kind = 'attack')
       or k <> (select count(*) from combat_actions where ref_id = v_run and kind = 'support') then
      bad := bad || v_run || ': attacks ' || n || '/' || (select count(*) from combat_actions where ref_id = v_run and kind = 'attack')
        || ' supports ' || k || '/' || (select count(*) from combat_actions where ref_id = v_run and kind = 'support') || '; ';
    end if;
  end loop;
  res := res || jsonb_build_object('case', 'L2 one attack row per attack and one support row per support play that worked', 'ok', bad = '' and runs is not null, 'bad', bad);

  -- L3 the attack rows match the attack results, in order
  bad := '';
  foreach v_run in array coalesce(runs, '{}') loop
    select x into o from jsonb_array_elements(cand) x where (x->-2->>'id')::bigint = v_run;
    for rec in
      with ar as (select e, row_number() over (order by ord) rn from jsonb_array_elements(o) with ordinality t(e, ord) where e ? 'attack' and (e->>'ok')::boolean),
           cr as (select a.*, row_number() over (order by a.id) rn from combat_actions a where a.ref_id = v_run and a.kind = 'attack')
      select ar.e, cr.card_id, cr.target_foe, cr.result from ar full join cr on cr.rn = ar.rn
    loop
      if rec.card_id is distinct from (rec.e->>'attack')::bigint or rec.target_foe is distinct from (rec.e->>'target')::int
         or (rec.result->>'dmg')::int is distinct from (rec.e->>'damage')::int or rec.result->>'outcome' is distinct from rec.e->>'outcome'
         or (rec.result->>'value')::int > (rec.result->>'dmg')::int or (rec.result->>'value')::int < 0
         or ((rec.result->>'hp_after')::int > 0 and (rec.result->>'value')::int <> (rec.result->>'dmg')::int) then
        bad := bad || v_run || ': ' || left(coalesce(rec.e::text, 'no result'), 120) || ' vs ' || left(coalesce(rec.result::text, 'no row'), 200) || '; ';
        exit;
      end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'L3 each attack row = its attack (card, foe, dmg, outcome); value = the HP lost', 'ok', bad = '' and runs is not null, 'bad', left(bad, 800));

  -- L4 mode, ref, member, day
  select count(*) into n from combat_actions a join dungeon_runs r on r.id = a.ref_id
   where a.ref_id = any(runs) and (a.mode <> case when r.mode = 'gauntlet' then 'gauntlet' else 'dungeon' end
     or a.player_id <> r.player_id or a.game_day <> r.day or (a.result->>'floor') is null or (a.result->>'room') is null);
  res := res || jsonb_build_object('case', 'L4 every row: mode = the run mode, player = the member, game_day = the run day, floor and room', 'ok',
    coalesce(n = 0 and runs is not null and exists (select 1 from combat_actions where ref_id = any(runs)), false), 'bad_rows', n);

  -- L5 the reconcile: 0 unexplained on every card and foe of every run
  bad := '';
  foreach v_run in array coalesce(runs, '{}') loop
    select count(*) filter (where unexplained <> 0), count(*) filter (where side = 'card'), count(*) filter (where side = 'foe')
      into n, k, i from dungeon_damage_reconcile(v_run);
    if n <> 0 or k <> 5 or i < 1 then bad := bad || v_run || ': unexplained rows ' || n || ', cards ' || k || ', foes ' || i || ' '
      || left((select jsonb_agg(to_jsonb(x))::text from dungeon_damage_reconcile(v_run) x where x.unexplained <> 0), 300) || '; '; end if;
  end loop;
  res := res || jsonb_build_object('case', 'L5 dungeon_damage_reconcile: unexplained 0 for every card and foe of the 6 runs', 'ok', bad = '' and runs is not null, 'bad', left(bad, 1200));

  -- L6 coverage: every kind of HP change appears at least once
  select coalesce(string_agg(w, ', '), '') into bad from unnest(array['attack', 'lifesteal', 'support heal', 'support smite', 'enemy hit', 'area', 'poison', 'thorns', 'burn', 'foe heal', 'reward or rest']) w
   where not exists (select 1 from combat_actions a where a.ref_id = any(runs) and (a.result->>'value')::int > 0 and case w
     when 'attack' then a.kind = 'attack' when 'lifesteal' then a.effect = 'lifesteal' when 'support heal' then a.kind = 'support' and a.effect = 'heal'
     when 'support smite' then a.kind = 'support' and a.effect = 'smite'
     when 'enemy hit' then a.kind = 'enemy' and a.effect not in ('area', 'poison', 'thorns', 'burn', 'heal')
     when 'area' then a.effect = 'area' when 'poison' then a.effect = 'poison' when 'thorns' then a.effect = 'thorns' when 'burn' then a.effect = 'burn'
     when 'foe heal' then a.kind = 'enemy' and a.effect = 'heal' and a.result->>'side' = 'foe'
     else a.kind = 'effect' and (a.effect like 'reward_%' or a.effect = 'rest') end);
  res := res || jsonb_build_object('case', 'L6 every kind of HP change is logged (attack, lifesteal, heal, smite, enemy hit, area, poison, thorns, burn, foe heal, reward/rest)',
    'ok', bad = '' and runs is not null, 'missing', bad,
    'effects', (select jsonb_object_agg(kind || ':' || coalesce(effect, '-'), c) from (select kind, effect, count(*) c from combat_actions where ref_id = any(runs) group by 1, 2) x));

  -- L8 admin_health (before L7 breaks a run)
  h := admin_health()->'dungeon_runs';
  res := res || jsonb_build_object('case', 'L8 admin_health dungeon_runs: the runs after the file, 0 unexplained', 'ok',
    coalesce(jsonb_array_length(h) >= 5 and not exists (select 1 from jsonb_array_elements(h) e where (e->>'unexplained')::int <> 0 or (e->>'rows_unexplained')::int <> 0)
             and exists (select 1 from jsonb_array_elements(h) e where (e->>'run')::bigint = any(runs)), false), 'dungeon_runs', h);

  -- L9 admin_read.sql: a Dungeon support play is not Hunt activity
  select count(*) filter (where source = 'hunt'), count(*) filter (where source in ('dungeon', 'gauntlet')) into n, k
    from admin_active_days(v_day - 1, v_day + 1) where player_id like '${P}%';
  res := res || jsonb_build_object('case', 'L9 admin_active_days: the test members have Dungeon days and no Hunt day', 'ok',
    coalesce(n = 0 and k > 0 and exists (select 1 from combat_actions where ref_id = any(runs) and kind = 'support'), false), 'hunt', n, 'dungeon', k);

  -- L7 the reconcile sees what is not logged: a card loses 7 HP with no row; an attack row disappears
  -- (a run that still has a card with 7 HP or more: a fallen squad has none)
  select d.id, min(e.key) into v_run, bad from dungeon_runs d, jsonb_each(d.state->'cards') e
   where d.id = any(runs) and (e.value->>'hp')::int >= 7 group by d.id order by d.id limit 1;
  update dungeon_runs set state = jsonb_set(state, array['cards', bad, 'hp'], to_jsonb((state->'cards'->bad->>'hp')::int - 7)) where id = v_run;
  select count(*) into n from dungeon_damage_reconcile(v_run) where side = 'card' and unexplained = 7;
  delete from combat_actions where id = (select min(id) from combat_actions where ref_id = runs[2] and kind = 'attack' and (result->>'value')::int > 0);
  select count(*) into k from dungeon_damage_reconcile(runs[2]) where side = 'foe' and unexplained <> 0;
  res := res || jsonb_build_object('case', 'L7 the reconcile shows a card HP change with no row (7) and a deleted attack row', 'ok', coalesce(n = 1 and k = 1, false), 'card', n, 'foe', k);

  -- R1 a re-run of every file that carries the same text keeps the md5s and the kind check
  ${rerun ? `select jsonb_object_agg(p.proname, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into v_md5 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('dungeon_attack', 'dungeon_support', 'dungeon_enemy_turn', 'dungeon_choose', 'admin_health',
      'dungeon_damage_reconcile', 'dungeon_combat_log', 'dungeon_hp_event', 'dungeon_hp_changes');
  begin
    ${RERUN.map((s) => `execute $m$${s}$m$;`).join('\n    ')}
    select jsonb_object_agg(p.proname, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into v_md5b from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('dungeon_attack', 'dungeon_support', 'dungeon_enemy_turn', 'dungeon_choose', 'admin_health',
        'dungeon_damage_reconcile', 'dungeon_combat_log', 'dungeon_hp_event', 'dungeon_hp_changes');
    ok := v_md5 = v_md5b and pg_get_constraintdef((select oid from pg_constraint where conname = 'combat_actions_kind_check')) like '%enemy%';
    res := res || jsonb_build_object('case', 'R1 a re-run of the 7 files keeps the 9 function md5s and the kind enemy', 'ok', ok, 'before', v_md5, 'after', v_md5b);
  exception when others then
    res := res || jsonb_build_object('case', 'R1 a re-run of the 7 files keeps the 9 function md5s and the kind enemy', 'ok', false, 'error', sqlerrm);
  end;` : '-- R1 skipped (mutations)'}

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig, admin, rerun) => {
  const out = await q(body(mig, admin, rerun));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [where, a, b]] of Object.entries(MUTATIONS)) {
    const files = (where === 'both' ? ['mig', 'admin'] : [where]).map((w) => (w === 'mig' ? src : adminSrc));
    if (files.some((f) => f.split(a).length !== 2)) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const mut = (w, f) => (where === w || where === 'both' ? f.replace(a, () => b) : f);
    const { results, raw } = await runOnce(mut('mig', src), mut('admin', adminSrc), false);
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0].slice(0, 90)}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(old ? '' : src, old ? '' : adminSrc, !old);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 900)}`); }
  const g = results.find((r) => r.case.startsWith('G1')); if (g?.steps) console.log(`  steps per run: ${JSON.stringify(g.steps)}`);
  const c = results.find((r) => r.case.startsWith('L6')); if (c?.effects) console.log(`  rows by kind:effect: ${JSON.stringify(c.effects)}`);
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
