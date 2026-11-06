import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/hunt_v2_view_boss_max.sql (HUNT-HEADER-V2, member report 2026-11-06: the Hunt header showed the
 * shared boss on the v1 scale, 60264 / 80000, while the member fights a private v2 copy, max 36244).
 * Invariant: hunt_v2_view.boss_max = the max HP of the boss that hunt_v2_start makes for the same Hunt (combat_v2_hunt_boss, one source);
 * every other key of the view is unchanged; the guard refuses a changed live text; the undo restores the R3-ON text (md5).
 * ONE DO block, undone by its final RAISE (no lasting change). It puts the R3-ON text back first (the undo file), so it passes before
 * and after the apply.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-v2-view-boss-max.mjs      must PASS
 *   MUTATE=<name> ...   must FAIL;   MUTATE=all ...   the baseline, then every mutation (each must FAIL)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-hunt-v2-view-boss-max.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = read('../../tcg-bot/supabase/hunt_v2_view_boss_max.sql');
const UNDO = read('../../tcg-bot/supabase/hunt_v2_view_boss_max_undo.sql');
const R3ON_MD5 = '44ada58cd6bcc7b6ed02606810d7fbb8';

const MAXLINE = "    'boss_max', case when v_key is not null then (combat_v2_hunt_boss(h.tier, v_key)->>'max')::numeric\n";
const MUT = {
  max_missing: [/ {4}-- HUNT-HEADER-V2[^\n]*\n {4}'boss_max'[^\n]*\n[^\n]*\n/, ''],
  max_v1_scale: [MAXLINE, "    'boss_max', case when v_key is not null then h.hp_max::numeric\n"],
  max_second_calc: [MAXLINE, "    'boss_max', case when v_key is not null then (combat_v2_enemy_numbers()->'v2_enemy'->'hunt'->h.tier->>'hp')::numeric\n"],
  max_wrong_tier: [MAXLINE, "    'boss_max', case when v_key is not null then (combat_v2_hunt_boss('Normal', v_key)->>'max')::numeric\n"],
  hunt_shape_changed: ["              'live_frac', h.hp_remaining::numeric / h.hp_max) end,\n    'boss',", "              'live_frac', h.hp_remaining::numeric / h.hp_max, 'max', 1) end,\n    'boss',"],
  guard_missing: [/do \$g\$\n[\s\S]*?-- GUARD-END\n/, ''],
};

if (process.env.MUTATE === 'all') {
  const run = (m) => spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env: { ...process.env, MUTATE: m }, encoding: 'utf8' });
  const base = run('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  let ok = base.status === 0;
  console.log(`baseline (no mutation)   ${ok ? 'PASS' : 'FAIL'}  ${bl}`);
  if (!ok) console.log(base.stdout, base.stderr);
  for (const n of Object.keys(MUT)) {
    const r = run(n);
    const caught = r.status !== 0 && /FAILED/.test(r.stdout || '');
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${why.slice(0, 160)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE]; if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  const [a, b] = m;
  const n = a instanceof RegExp ? (mig.match(new RegExp(a.source, 'g')) || []).length : mig.split(a).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match exactly once (${n})`);
  mig = a instanceof RegExp ? mig.replace(a, b) : mig.split(a).join(b);
}
for (const s of [mig, UNDO]) if (['$m$', '$t$', '$x$'].some((x) => s.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $x$');

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const P = lit('9000000000000043001'), TST = lit('9000000000000043002');
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;

const SQL = String.raw`do $t$
#variable_conflict use_column
declare res jsonb := '[]'; o0 jsonb; o jsonb; o2 jsonb; a jsonb; bk text; bn text; hid bigint; sq bigint[]; mx numeric; m0 text; m1 text; m2 text; msg text;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_hhv2_admin', true);
  -- the world: one active Hunt of a v2 boss (Heroic, the shared row on the v1 scale: 60264 / 80000 as the report), the flag ON, one member
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x order by x.ord limit 1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 60264, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  insert into players (id, username) values (${P}, 'tst hhv2'), (${TST}, 'tst hhv2 t');
  sq := array(select c.id from cards c join subjects s on s.id = c.subject_id
               where jsonb_typeof(s.ability_v2) = 'object' and jsonb_typeof(s.ability_v2->'blocks') = 'array'
                 and exists (select 1 from roles x where x.key = s.ability_v2->>'role') and s.type in ('Character', 'Creature') order by c.id limit 4);
  insert into player_cards (player_id, card_id, quantity) select ${P}, z, 1 from unnest(sq) z on conflict do nothing;
  update balance set value = jsonb_set(jsonb_set(value, '{testers}', jsonb_build_array(${TST})), '{hunt}', 'true') where key = 'combat_v2';
  -- the R3-ON text first (the undo file), its answer, then this file
  execute $m$${UNDO}$m$;
  m0 := md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), ''));
  o0 := hunt_v2_view(${P});
  execute $m$${mig}$m$;
  m1 := md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), ''));
  o := hunt_v2_view(${P});
  ${add('BM0 the undo file puts back the exact R3-ON text (md5)', `m0 = ${lit(R3ON_MD5)}`, 'to_jsonb(m0)')}
  ${add('BM1 boss_max = combat_v2_hunt_boss(tier, key).max of this Hunt (the fight source), > 0, not the v1 hp_max',
    `(o->>'boss_max')::numeric = (combat_v2_hunt_boss('Heroic', bk)->>'max')::numeric and (o->>'boss_max')::numeric > 0 and (o->>'boss_max')::numeric <> 80000`,
    `jsonb_build_object('boss_max', o->'boss_max', 'fn', combat_v2_hunt_boss('Heroic', bk)->'max')`)}
  ${add('BM2 every other key of the view is unchanged (the answer minus boss_max = the R3-ON answer)', `(o - 'boss_max') = o0`,
    `jsonb_build_object('new', o - 'boss_max', 'old', o0)`)}
  -- BM3 the fight: hunt_v2_start makes the boss with this max (the private copy), and the view of the active day keeps the same boss_max
  a := hunt_v2_start(${P}, sq);
  mx := ((select state from hunt_v2_days where player_id = ${P} and hunt_id = hid)->'fight'->'enemies'->0->>'max')::numeric;
  o2 := hunt_v2_view(${P});
  ${add('BM3 boss_max = the max of the boss in the fight that hunt_v2_start made (enemies[0].max), before and during the day',
    `(a->>'ok')::boolean and mx = (o->>'boss_max')::numeric and (o2->>'boss_max')::numeric = mx`,
    `jsonb_build_object('start', a->'error', 'fight_max', mx, 'view', o->'boss_max', 'view_active', o2->'boss_max')`)}
  ${add('BM4 the active day: the hunt object of the view = the hunt object of hunt_v2_out (R3-ON-FIX HL4 still holds)',
    `o2->'hunt' = hunt_v2_out(hid, ${P}, hunt_v2_today(), '{}'::jsonb)->'hunt'`, `jsonb_build_object('view', o2->'hunt')`)}
  -- BM5 no active Hunt, flag ON, not a tester: no v2 boss, boss_max null
  update hunts set status = 'expired' where id = hid;
  o := hunt_v2_view(${TST} || 'x');
  ${add('BM5 no active Hunt (not a tester): boss_max is null', `o ? 'boss_max' and jsonb_typeof(o->'boss_max') = 'null'`, 'o')}
  -- BM6 flag OFF, a tester, no active Hunt: the boss of the practice = the newest ended Hunt, boss_max = its max
  update balance set value = jsonb_set(value, '{hunt}', 'false') where key = 'combat_v2';
  o := hunt_v2_view(${TST});
  ${add('BM6 a tester with no active Hunt (flag OFF): boss_max = the max of the newest ended Hunt boss',
    `(o->>'boss_max')::numeric = (combat_v2_hunt_boss((select tier from hunts order by opens_at desc limit 1), hunt_v2_boss_key((select name from hunts order by opens_at desc limit 1)))->>'max')::numeric`,
    `jsonb_build_object('boss_max', o->'boss_max', 'boss', o->'boss'->'key')`)}
  -- BM7 the guard refuses a changed live text; the undo restores R3-ON
  begin
    execute 'comment on function public.hunt_v2_view(text) is null';
    execute replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), 'perform hunt_v2_abandon(p_player, v_day);', 'perform hunt_v2_abandon(p_player, v_day); -- changed');
    msg := '';
    begin execute $m$${mig}$m$; exception when others then msg := sqlerrm; end;
    ${add('BM7 the guard refuses a changed live hunt_v2_view', `msg like '%changed since this file was built%'`, 'to_jsonb(msg)')}
    raise exception 'hhv2_rollback';
  exception when others then if sqlerrm <> 'hhv2_rollback' then res := res || jsonb_build_object('case', 'BM7 raised', 'ok', false, 'got', to_jsonb(sqlerrm)); end if;
  end;
  msg := '';
  begin
    execute $m$${mig}$m$;
    m1 := md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), ''));
    execute $m$${UNDO}$m$;
    m2 := md5(replace(pg_get_functiondef('public.hunt_v2_view(text)'::regprocedure), chr(13), ''));
  exception when others then msg := sqlerrm;
  end;
  ${add('BM8 a second run of this file is accepted (its guard knows its own md5); the undo after it restores the R3-ON md5', `msg = '' and m2 = ${lit(R3ON_MD5)}`, 'jsonb_build_object(\'new\', m1, \'undo\', m2, \'err\', msg)')}
  raise exception 'RESULT:%', jsonb_build_object('rows', res, 'new_md5', m1)::text;
end $t$;`;

const out = JSON.parse(await runBlock(SQL));
let fail = 0;
for (const r of out.rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : `  got ${JSON.stringify(r.got).slice(0, 600)}`}`); }
console.log(`new md5 of hunt_v2_view: ${out.new_md5}`);
console.log(fail ? `FAILED ${fail} of ${out.rows.length}` : `PASS all ${out.rows.length}`);
process.exit(fail ? 1 : 0);
