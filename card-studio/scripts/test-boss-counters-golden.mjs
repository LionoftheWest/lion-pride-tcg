/**
 * Golden test for tcg-bot/supabase/hunt_counter_balance.sql (the Hunt boss counter-move numbers move from code and
 * settings.hunt_boss_moves into balance boss_counters / boss_passives). Rolled back (the result comes back in the
 * exception), one test member, PRIVATE test bosses only (never the live boss row):
 *   node scripts/test-boss-counters-golden.mjs              GOLDEN: the old code (the function texts and the setting of
 *                                                           commit 514e1f0, db/schema/) and the file play the same seeded
 *                                                           fights; every result and the end state must be identical
 *   node scripts/test-boss-counters-golden.mjs --mutations  each balance value (every leaf of boss_counters and the 6
 *                                                           counter passive leaves of boss_passives) changed alone: the
 *                                                           fights that use it must change
 *   node scripts/test-boss-counters-golden.mjs --old        the baseline: the old code against itself with ONE number
 *                                                           changed in code (Groan waits 5, not 4): must FAIL
 * The fights (24 rounds each, a fixed seed, every support plays in turn, then an attack):
 *   real     the 12 model bosses with their real pools, shares and weights (2 seeds each)
 *   move     one private boss whose pool is one move (Crush: + Shatter, Nightshade: + Desync) at share 1 (2 seeds, 48 moves)
 *   passive  one private boss with no pool and one counter passive (plague, shatterer, dispeller, juggernaut; 2 seeds)
 * A fight runs in a subtransaction that is undone at its end, so each fight starts from the same state.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const repo = fileURLToPath(new URL('../../', import.meta.url));
const MUTS = process.argv.includes('--mutations'), OLDRUN = process.argv.includes('--old');

// The old code: the four function texts of the structure snapshot and the setting of hunt_boss_moves.sql at the
// commit before this file (514e1f0, the live state on 2026-10-07).
const BASE = '514e1f0';
const show = (p) => execFileSync('git', ['show', `${BASE}:${p}`], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
const fnText = (n) => { const s = show(`db/schema/functions/${n}.sql`); const i = s.indexOf('CREATE OR REPLACE FUNCTION'); return s.slice(i, s.indexOf('$function$;', i) + 11); };
const FNS = ['hunt_counter_act', 'hunt_counter_pick', 'hunt_attack', 'hunt_support'];
const oldClean = FNS.map(fnText).join('\n');
let oldFns = oldClean;
const oldCfg = show('tcg-bot/supabase/hunt_boss_moves.sql').match(/\$j\$(\{[\s\S]*?\})\$j\$/)[1];
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_counter_balance.sql', import.meta.url)), 'utf8')
  .replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const passDefaults = mig.match(/set value = '(\{"plague_x":[^']*\})'::jsonb \|\| value/)[1];
for (const s of [oldFns, oldCfg, mig]) if (/\$(m|t|f|o)\$/.test(s)) throw new Error('a text contains $m$, $t$, $f$ or $o$');
if (OLDRUN) {   // the baseline: one number changed in the OLD code must make the golden comparison fail
  const a = "perform hunt_counter_cd(p_hunt, p_player, p_day, 'heal', 4, p_round);";
  if (oldFns.split(a).length !== 2) throw new Error('--old: the Groan line is not in the old text');
  oldFns = oldFns.replace(a, a.replace(', 4,', ', 5,'));
}

const cfg = JSON.parse(oldCfg);
const BOSSES = Object.keys(cfg).filter((k) => k !== '_share');
const MOVES = BOSSES.flatMap((b) => cfg[b].moves.map((m) => m.key));
const SEEDS = [0.21, -0.63];
// fight = [mode, arg, seed]. A one-move pool, except: Crush needs a Shatter first; Nightshade every turn renews its
// rounds (a second move leaves gaps, so a changed number of rounds shows).
const POOL = { crush: 'shatter,crush', nightshade: 'nightshade,desync' };
const FIGHTS = [
  ...BOSSES.flatMap((b) => SEEDS.map((s) => ['real', b, s])),
  ...MOVES.flatMap((k) => SEEDS.map((s) => ['move', POOL[k] || k, s])),
  ...['plague', 'shatterer', 'dispeller', 'juggernaut'].flatMap((p) => SEEDS.map((s) => ['passive', p, s])),
];
const idx = (pred) => FIGHTS.map((f, i) => (pred(f) ? i + 1 : 0)).filter(Boolean);
const bossOf = (key) => BOSSES.find((b) => cfg[b].moves.some((m) => m.key === key));

// The mutations: every leaf of the balance values the file adds, and the fights that read it.
const MOVE_NUMS = JSON.parse(mig.match(/'moves', \$j\$(\{[\s\S]*?\})\$j\$::jsonb\)/)[1]);
const PASS = JSON.parse(passDefaults);
const bump = (v) => (Number.isInteger(v) ? v + 1 : v < 1 ? Math.round(v * 500) / 1000 : v + 0.5);
const MUTATIONS = [
  ['boss_counters', ['share'], cfg._share, idx(([m, a]) => m === 'real' && cfg[a].share === undefined)],
  ...BOSSES.filter((b) => cfg[b].share !== undefined).map((b) => ['boss_counters', ['boss_share', b], cfg[b].share, idx(([m, a]) => m === 'real' && a === b)]),
  ...MOVES.map((k) => ['boss_counters', ['weights', k], 1, idx(([m, a]) => m === 'real' && a === bossOf(k))]),
  ...Object.entries(MOVE_NUMS).flatMap(([k, o]) => Object.entries(o).map(([f, v]) => ['boss_counters', ['moves', k, f], v,
    // the one-move fights, and the real fights of its boss (Nightshade at share 1 renews its 3 rounds every turn)
    idx(([m, a]) => (m === 'move' && a.split(',').includes(k)) || (m === 'real' && a === bossOf(k)))])),
  ...Object.entries(PASS).map(([f, v]) => ['boss_passives', [f], v, idx(([m, a]) => m === 'passive' && f.startsWith(a))]),
].map(([key, path, v, fights]) => ({ key, path, v, to: key === 'boss_counters' && path[0] === 'weights' ? 3 : bump(v), fights }));
for (const m of MUTATIONS) if (!m.fights.length) throw new Error(`no fight for the mutation ${m.key}.${m.path.join('.')}`);

const P = 'tst_bcgold';
const fightFn = String.raw`
  create function pg_temp.fight(p_mode text, p_arg text, p_seed float, p_new boolean, c bigint[]) returns text language plpgsql as $f$
  declare v_out text := ''; h bigint; x bigint; r jsonb; tgt bigint; s bigint; k int; atk bigint; P text := '${P}';
    d date := (now() at time zone 'America/Denver')::date; v_name text; v_pool jsonb;
  begin
    begin
      v_name := case p_mode when 'real' then p_arg when 'move' then 'Golden Counter Boss' else 'Golden Passive Boss' end;
      if p_mode = 'move' then
        select jsonb_agg(jsonb_build_object('key', k2, 'name', k2) || case when p_new then '{}'::jsonb else '{"w": 1}'::jsonb end)
          into v_pool from unnest(string_to_array(p_arg, ',')) k2;
        if p_new then
          update settings set value = value || jsonb_build_object(v_name, jsonb_build_object('moves', v_pool)) where key = 'hunt_boss_moves';
          update balance set value = jsonb_set(value, array['boss_share', v_name], '1') where key = 'boss_counters';
        else
          update settings set value = value || jsonb_build_object(v_name, jsonb_build_object('share', 1, 'moves', v_pool)) where key = 'hunt_boss_moves';
        end if;
      end if;
      insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
        values (v_name, 'Normal', '[]', '[]',
                case when p_mode = 'passive' then jsonb_build_object('kind', p_arg, 'list', jsonb_build_array(jsonb_build_object('kind', p_arg))) else '{"list": []}'::jsonb end,
                9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
      perform hunt_state_round(h, P, d);
      foreach x in array c loop
        perform hunt_commit_card(h, P, x, d, case when x in (c[1], c[2]) then 300 else 60 end);
      end loop;
      update hunt_card_hp set hp_remaining = max_hp where hunt_id = h;
      update hunt_card_hp set max_hp = 300, hp_remaining = 300 where hunt_id = h and card_id in (c[1], c[2]);
      perform setseed(p_seed);
      for k in 1..24 loop
        s := c[3 + (k - 1) % 8];
        tgt := case when not coalesce((select downed from hunt_card_hp where hunt_id = h and card_id = c[1]), true) then c[1] else c[2] end;
        if p_mode = 'passive' and s = c[10] then update hunt_card_hp set dmg_debuff = 0.7 where hunt_id = h and card_id = tgt; end if;   -- a curse for the cleanse
        r := hunt_support(P, h, s, case when (select sb.ability->>'target' from cards cc join subjects sb on sb.id = cc.subject_id where cc.id = s) = 'ally' then tgt end);
        v_out := v_out || 'S' || k || ' ' || r::text || E'\n';
        atk := tgt;
        if (select downed from hunt_card_hp where hunt_id = h and card_id = atk) then exit; end if;
        r := hunt_attack(P, h, atk);
        if r->>'error' = 'stunned' and atk = c[1] then r := hunt_attack(P, h, c[2]); end if;
        v_out := v_out || 'A' || k || ' ' || r::text || E'\n';
      end loop;
      v_out := v_out || 'STATE ' || coalesce((select jsonb_build_object('r', round, 'en', boss_enrage, 'enu', enrage_until, 'wk', boss_weaken, 'wku', weaken_until,
                 'ex', boss_expose, 'exu', expose_until, 'st', stunned_until, 'marks', marks)::text from hunt_combat_state where hunt_id = h), '') || E'\n'
        || 'CARDS ' || coalesce((select jsonb_agg(jsonb_build_object('c', card_id, 'hp', hp_remaining, 'max', max_hp, 'down', downed, 'sh', shield, 'b', dmg_buff,
                 'd', dmg_debuff, 'cd', cd_until_round) order by card_id)::text from hunt_card_hp where hunt_id = h), '') || E'\n'
        || 'BOSS ' || (select hp_remaining from hunts where id = h);
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
    end;
    return v_out;
  end $f$;`;

// The block: the member, the cards, the fight function, then the given body. One frozen snapshot and one read plan
// (combat-golden.mjs: a Slam reads the card rows with no ORDER BY).
const block = (inner) => String.raw`set transaction isolation level repeatable read; set local enable_seqscan = off; set local enable_bitmapscan = off;
do $t$
declare c bigint[]; res text[] := '{}'; base text[] := '{}'; cand text[] := '{}'; out jsonb := '[]'; i int; j int; l1 text[]; l2 text[]; bad text := '';
  a1 bigint; a2 bigint; n int; changed int; v_old jsonb;
begin
  select min(cc.id) into a1 from cards cc join subjects s on s.id = cc.subject_id where s.type in ('Character', 'Creature') and cc.rarity = 'gold';
  select min(cc.id) into a2 from cards cc join subjects s on s.id = cc.subject_id where s.type in ('Character', 'Creature') and cc.rarity = 'gold' and cc.id > a1;
  c := array[a1, a2] || (select array_agg((select min(cc.id) from cards cc join subjects s on s.id = cc.subject_id where s.ability->>'effect' = e
                          and (e <> 'heal' or s.ability->>'target' = 'ally')) order by o) from unnest(array['heal','shield','empower','weaken','expose','stun','smite','cleanse']) with ordinality u(e, o));
  if array_length(c, 1) <> 10 or array_position(c, null) is not null then raise exception 'the cards: %', c; end if;
  insert into players (id, username) values ('${P}', 'tst boss counters golden');
  insert into player_cards (player_id, card_id, quantity) select '${P}', x, 1 from unnest(c) x;
  ${GATE(P)}
  update balance set value = '20' where key = 'daily_card_cap';
  ${fightFn}
${inner}
end $t$;`;
// p_new = the new code (the test pools go to balance boss_counters, not to the setting).
const runAll = (arr, ids, neu = arr !== 'base') => ids.map((i) => { const [m, a, s] = FIGHTS[i - 1];
  return `  ${arr}[${i}] := pg_temp.fight('${m}', $o$${a}$o$, ${s}, ${neu}, c);`; }).join('\n');
// The new code, with the values of the old code: the file (a saved boss_counters goes aside, so the file builds it
// from the old setting) and the 6 passive defaults of the file.
const installNew = String.raw`
  update balance set key = 'boss_counters_saved' where key = 'boss_counters';
  execute $m$${oldClean}$m$;   -- the old code as it was (the guard of the file needs it; --old changes the base only)
  execute $m$${mig}$m$;
  update balance set value = value || '${passDefaults}'::jsonb where key = 'boss_passives';`;
const installOld = String.raw`
  execute $m$${oldFns}$m$;
  update settings set value = $o$${oldCfg}$o$::jsonb where key = 'hunt_boss_moves';`;
const cmp = (a, b, label) => String.raw`
  for i in 1..${FIGHTS.length} loop
    if ${a}[i] is distinct from ${b}[i] then
      l1 := regexp_split_to_array(${a}[i], E'\n'); l2 := regexp_split_to_array(${b}[i], E'\n'); j := 1;
      while j < greatest(array_length(l1, 1), array_length(l2, 1)) and l1[j] is not distinct from l2[j] loop j := j + 1; end loop;
      bad := '${label} at fight ' || i || ' line ' || j || E'\nOLD: ' || left(coalesce(l1[j], ''), 1500) || E'\nNEW: ' || left(coalesce(l2[j], ''), 1500); exit;
    end if;
  end loop;`;
const parse = (txt) => {
  let msg = String(txt); try { msg = JSON.parse(txt).message || msg; } catch { /* the raw text */ }
  const m = msg.match(/RESULT:([\s\S]*?)(\nCONTEXT|$)/); return m ? m[1] : null;
};

const all = FIGHTS.map((_, i) => i + 1);
if (process.env.DUMP) {   // DUMP=<fight number>: print that fight of the new code (to read what a fight covers)
  const i = Number(process.env.DUMP);
  console.log(`fight ${i}: ${JSON.stringify(FIGHTS[i - 1])}`);
  console.log(parse(await q(block(String.raw`${installOld}
${installNew}
${runAll('res', [i])}
  raise exception 'RESULT:%', res[${i}];`))));
} else if (!MUTS) {
  // Three blocks (one block for all three runs passed the 60 s query limit): the old code, the old code again (the
  // fights are repeatable), the file. Each block returns the md5 of each fight and a few counts; the first differing
  // fight is then played again in both versions to show the first differing line.
  const t0 = Date.now();
  const sums = async (inst, arr, neu) => {
    const r = parse(await q(block(String.raw`${inst}
${runAll(arr, all, neu)}
  raise exception 'RESULT:%', jsonb_build_object('md5', (select jsonb_agg(md5(x) order by o) from unnest(${arr}) with ordinality u(x, o)),
    'lines', (select sum(array_length(regexp_split_to_array(x, E'\n'), 1)) from unnest(${arr}) x),
    'counters', (select count(*) from unnest(${arr}) x, regexp_matches(x, '"counter": "', 'g')),
    'countered', (select count(*) from unnest(${arr}) x, regexp_matches(x, '"countered": \[', 'g')))::text;`)));
    try { return JSON.parse(r); } catch { throw new Error('NO RESULT: ' + String(r).slice(0, 2000)); }
  };
  const base = await sums(installOld, 'base', false);
  const again = await sums(installOld, 'res', false);
  const cand = await sums(installOld + installNew, 'cand');
  const firstDiff = (a, b) => a.md5.findIndex((m, k) => m !== b.md5[k]) + 1;
  let bad = '';
  const show = async (i, label) => {
    const r = parse(await q(block(String.raw`${installOld}
${runAll('base', [i])}
${installNew}
${runAll('cand', [i])}
${cmp('base', 'cand', label)}
  raise exception 'RESULT:%', coalesce(nullif(bad, ''), 'no difference when played alone');`)));
    return r;
  };
  const rep = firstDiff(base, again);
  if (rep) bad = 'NOT REPEATABLE: the old code gives two answers at fight ' + rep + ' ' + JSON.stringify(FIGHTS[rep - 1]);
  else { const d = firstDiff(base, cand); if (d) bad = 'DIFF ' + JSON.stringify(FIGHTS[d - 1]) + ': ' + await show(d, 'DIFF'); }
  console.log(bad ? 'FAIL ' + bad.slice(0, 4000) : 'PASS ' + FIGHTS.length + ' fights (' + base.lines + ' lines, ' + base.counters + ' counter moves, '
    + base.countered + ' countered supports): the file gives the same fights as the old code, and the old code is repeatable');
  console.log('(' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  process.exitCode = bad ? 1 : 0;
} else {
  // One block per group of mutations: the file, the fights that the group reads, then each mutation alone.
  let caught = 0, missed = [];
  const groups = [];
  for (let i = 0; i < MUTATIONS.length; i += 12) groups.push(MUTATIONS.slice(i, i + 12));
  for (const g of groups) {
    const ids = [...new Set(g.flatMap((m) => m.fights))].sort((a, b) => a - b);
    const each = g.map((m, k) => {
      const path = `array[${m.path.map((p) => `$o$${p}$o$`).join(', ')}]`;
      return String.raw`
  update balance set value = jsonb_set(value, ${path}, '${m.to}'::jsonb) where key = '${m.key}';
${m.fights.map((i) => `  res[${i}] := pg_temp.fight('${FIGHTS[i - 1][0]}', $o$${FIGHTS[i - 1][1]}$o$, ${FIGHTS[i - 1][2]}, true, c);`).join('\n')}
  changed := (select count(*) from unnest(array[${m.fights.join(',')}]) f where res[f] is distinct from cand[f]);
  out := out || jsonb_build_object('m', ${k}, 'changed', changed, 'of', ${m.fights.length});
  update balance set value = jsonb_set(value, ${path}, '${JSON.stringify(m.v)}'::jsonb) where key = '${m.key}';`;
    }).join('\n');
    const txt = await q(block(String.raw`${installOld}
${installNew}
${runAll('cand', ids)}
${each}
  raise exception 'RESULT:%', out::text;`));
    const r = parse(txt);
    let arr = null; try { arr = JSON.parse(r); } catch { /* not JSON */ }
    if (!arr) { console.log('NO RESULT: ' + (r || txt).slice(0, 2000)); process.exitCode = 1; continue; }
    for (const x of arr) {
      const m = g[x.m]; const name = `${m.key}.${m.path.join('.')} ${JSON.stringify(m.v)} -> ${m.to}`;
      if (x.changed > 0) caught++; else missed.push(name);
      console.log(`${x.changed > 0 ? 'caught' : 'MISSED'}  ${name}: ${x.changed} of ${x.of} fights changed`);
    }
  }
  console.log(`${caught}/${MUTATIONS.length} balance values change the fights`);
  if (caught !== MUTATIONS.length) { console.log('missed: ' + missed.join(', ')); process.exitCode = 1; }
}
console.log('after:', await q(`select (select count(*) from players where id = '${P}') test_players, (select count(*) from hunts where name like 'Golden %') test_bosses, (select count(*) from balance where key = 'boss_counters_saved') saved`));
