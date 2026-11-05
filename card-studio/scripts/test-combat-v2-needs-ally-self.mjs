import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/combat_v2_needs_ally_self.sql (R1b-FIX, 2026-11-05): gauntlet_v2_needs_ally must use the engine
 * rule for a block with "self": true (an attacker quicken: the card Quickens itself, no ally pick). NO lasting change: one DO block,
 * undone by its final RAISE.
 *   LOCALDB=1 LOCALDB_ENV=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-needs-ally-self.mjs   must PASS
 *   APPLY=0 ...    checks the function AS IT IS in the database (no file run): FAILS on the R1b text (S2 "Time Skip"), PASSES after the file
 *   MUTATE=<name>  must FAIL, for every name in MUT below
 *   MUTATE=all     the baseline (must PASS), then every mutation (each must FAIL its named case)
 * Cases:
 *   N1 two-way, on every card with a usable ability_v2: the engine probe (combat_v2_card_act with no opts.ally) raises "needs opts.ally"
 *      exactly when gauntlet_v2_needs_ally is true (a gated ally block may be marked true when the engine does not ask: G1.17 b rule)
 *   N2 every card with a "self": true block is marked false, and there is at least one such card
 *   N3 the fix changes only cards with a "self" block: every other card has the R1b mark (the R1b text as a pg_temp copy); counts > 0
 *   N4 the premise of the rule: every block with "self" is a quicken of an attacker card (else "self" is not the engine rule)
 *   N5 the function after the file: md5, IMMUTABLE, search_path, the grants of before (service_role only), the [combat] comment
 *   N6 the file runs twice (no change), its guard refuses another text, the undo file gives back the R1b md5 and comment
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-needs-ally-self.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let FIX = read('../../tcg-bot/supabase/combat_v2_needs_ally_self.sql');
let UNDO = read('../../tcg-bot/supabase/combat_v2_needs_ally_self_undo.sql');
const R1B = read('../../tcg-bot/supabase/combat_v2_gauntlet_run.sql');
const APPLY = process.env.APPLY !== '0';
const MD5_FIX = 'dcf9568f280773d384762c99bb2b2d2f';
const MD5_R1B = 'fd42f176eddb061f541ac416a6b48c0b';

// the R1b text of the function, as a pg_temp copy (the old mark of N3)
const i0 = R1B.indexOf('create or replace function public.gauntlet_v2_needs_ally(');
const OLD_FN = R1B.slice(i0, R1B.indexOf('$fn$;', i0) + 5).replace('create or replace function public.gauntlet_v2_needs_ally(', 'create function pg_temp.r1b_mark(');
if (!OLD_FN.startsWith('create function pg_temp.r1b_mark(')) throw new Error('the R1b text of gauntlet_v2_needs_ally was not found');

// ---------------------------------------------------------------------------------------------------------- the mutations
const SELF = "\n                          and x->'self' is distinct from 'true'::jsonb";
const MUT = {
  no_self_clause: { file: 'FIX', a: SELF, b: '', want: 'N1' },                                         // the R1b rule again
  self_any_quicken: { file: 'FIX', a: "x->'self' is distinct from 'true'::jsonb", b: "x->>'k' <> 'quicken'", want: 'N3' }, // too wide
  plant_support_self: { data: true, want: 'N4' },                                                       // a support quicken with self: the engine asks
  guard_open: { file: 'FIX', a: "if m not in ('fd42f176eddb061f541ac416a6b48c0b', 'dcf9568f280773d384762c99bb2b2d2f') then", b: 'if false then', want: 'N6' },
  grant_anon: { file: 'FIX', a: 'grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role;', b: 'grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role, anon;', want: 'N5' },
  stable_not_immutable: { file: 'FIX', a: 'language sql immutable set search_path', b: 'language sql stable set search_path', want: 'N5' },
  undo_keeps_fix: { file: 'UNDO', a: "  -- is not most_hurt or strongest asks for opts.ally\n", b: "  -- is not most_hurt or strongest asks for opts.ally (undo)\n", want: 'N6' },
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]),
    { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const bok = base.status === 0 && /^PASS/.test(bl);
  if (!bok) ok = false;
  console.log(`baseline (no mutation)        ${bok ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (!bok) console.log(((base.stdout || '') + (base.stderr || '')).slice(0, 3000));
  for (const [name, m] of Object.entries(MUT)) {
    const r = runOne(name);
    const lines = (r.stdout || '').split(/\r?\n/);
    const hit = lines.find((l) => l.startsWith(`FAIL ${m.want} `));
    const crashed = lines.some((l) => /the test block raised/.test(l));
    const caught = r.status !== 0 && !!hit && !crashed;
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  [${m.want}]  ${(hit || lines.find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 200)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL (a red baseline or a mutation not caught)');
  process.exit(ok ? 0 : 1);
}
let PLANT = false;
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  if (m.data) PLANT = true;
  else {
    const src = m.file === 'FIX' ? FIX : UNDO;
    if (src.split(m.a).length - 1 !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match ${m.file} exactly once`);
    if (m.file === 'FIX') FIX = src.split(m.a).join(m.b); else UNDO = src.split(m.a).join(m.b);
  }
}
for (const t of [FIX, UNDO, OLD_FN]) if (['$m$', '$t$', '$u$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $u$');

// ---------------------------------------------------------------------------------------------------------- the block
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = `md5(replace(pg_get_functiondef('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure), chr(13), ''))`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
// the file again after the undo (a function: an EXECUTE inside the add() expression)
const REAPPLY = String.raw`create function pg_temp.reapply() returns boolean language plpgsql as $r$
begin execute $m$${FIX}$m$; return ${MD5} = ${lit(MD5_FIX)}; exception when others then return false; end $r$;`;
const SQL = String.raw`do $t$
declare res jsonb := '[]'; wk date; fl jsonb; b jsonb; x jsonb; s2 jsonb; o jsonb := '{}'; bad jsonb := '[]'; bad3 jsonb := '[]'; ok boolean; ok2 boolean;
  old boolean; hs boolean; msg text; t text; c record; acl_a text; acl_b text; m_a text; selfc jsonb := '[]'; selfbad jsonb := '[]'; prem jsonb;
begin
  ${OLD_FN}
  ${APPLY ? `execute ${lit(REAPPLY)};` : ""}
  acl_a := (select coalesce(proacl::text, '') from pg_proc where oid = 'public.gauntlet_v2_needs_ally(jsonb)'::regprocedure);
  m_a := ${MD5};
  ${PLANT ? `-- MUTATION plant_support_self: one support card's plain quicken gets "self": true (the trigger subjects_ability_v2_check refuses it, so it is
  -- off inside this rolled-back block; the engine asks an ally for it)
  alter table subjects disable trigger subjects_ability_v2_check;
  update subjects s set ability_v2 = jsonb_set(s.ability_v2, array['blocks', (q.oo - 1)::text, 'self'], 'true'::jsonb)
    from (select s1.id, z.oo from subjects s1 join roles r on r.key = s1.ability_v2->>'role', jsonb_array_elements(s1.ability_v2->'blocks') with ordinality z(bk, oo)
           where r.class = 'support' and z.bk->>'k' = 'quicken' and not z.bk ? 'all' and not z.bk ? 'to' order by s1.id limit 1) q where s.id = q.id;` : ''}
  ${APPLY ? `execute $m$${FIX}$m$;` : '-- APPLY=0: the function as it is'}
  wk := gauntlet_week(dungeon_day());
  perform gauntlet_generate(wk);
  fl := (select floors from gauntlet_weeks where week = wk);
  b := combat_v2_enemy_numbers();
  for c in select cd.id, s0.id sid, s0.ability_v2 ab from cards cd join subjects s0 on s0.id = cd.subject_id
            where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array' and exists (select 1 from roles ro where ro.key = s0.ability_v2->>'role') order by cd.id loop
    x := combat_v2_card_unit(c.id) || '{"charge": 99, "meter": 0}'::jsonb;
    ok := gauntlet_v2_needs_ally(x->'active'->'blocks');
    old := pg_temp.r1b_mark(x->'active'->'blocks');
    hs := exists (select 1 from jsonb_array_elements(x->'active'->'blocks') z where z ? 'self');
    s2 := jsonb_build_object('v', 2, 'mode', 'gauntlet', 'round', 0, 'clock', 0, 'squad', jsonb_build_array(c.id), 'cards', jsonb_build_object(c.id::text, x),
      'enemies', jsonb_build_array((gauntlet_v2_foes(fl->0->0->'foes', 1, 1, b)->0) || '{"meter": 0}'::jsonb), 'marks', '{}'::jsonb,
      'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
    msg := null;
    begin
      perform combat_v2_card_act(s2, jsonb_build_object('side', 'card', 'id', c.id), jsonb_build_object('use', true, 'target', '{"side": "enemy", "id": 0}'::jsonb,
        'draws', (select jsonb_agg(0.5) from generate_series(1, 200))), b);
    exception when others then msg := sqlerrm;
    end;
    ok2 := position('needs opts.ally' in coalesce(msg, '')) > 0;
    -- a gated ally block (an ally block followed by a block whose kind has attach gate): the mark may be true when the engine does not ask
    t := case when exists (select 1 from jsonb_array_elements(x->'active'->'blocks') with ordinality q(bk, oo) where pg_temp.r1b_mark(jsonb_build_array(q.bk))
                and b->'blocks'->(x->'active'->'blocks'->(oo::int)->>'k')->>'attach' = 'gate') then 'gated' else 'plain' end;
    if (t = 'plain' and ok is distinct from ok2) or (t = 'gated' and ok2 and not ok) or (msg is not null and not ok2) then
      bad := bad || jsonb_build_object('card', c.id, 'subject', c.sid, 'mark', ok, 'probe', msg);
    end if;
    if hs then selfc := selfc || jsonb_build_object('card', c.id, 'subject', c.sid, 'mark', ok, 'class', x->>'class'); if ok is distinct from false then selfbad := selfbad || to_jsonb(c.id); end if;
    elsif ok is distinct from old then bad3 := bad3 || jsonb_build_object('card', c.id, 'mark', ok, 'r1b', old);
    end if;
    o := jsonb_set(o, array[case when ok then 'true_' else 'false_' end || (x->>'class')], to_jsonb(coalesce((o->>(case when ok then 'true_' else 'false_' end || (x->>'class')))::int, 0) + 1));
  end loop;
  ${add('N1 two-way: the engine probe asks for opts.ally exactly when gauntlet_v2_needs_ally is true (every card with a usable ability_v2; a gated block may be marked true)',
    `bad = '[]'::jsonb`, "jsonb_build_object('bad', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad) z limit 5) q), 'n_bad', jsonb_array_length(bad), 'counts', o)")}
  ${add('N2 every card with a "self": true block is marked false (at least one such card: S2 Time Skip)', `jsonb_array_length(selfc) > 0 and selfbad = '[]'::jsonb`, 'selfc')}
  ${add('N3 only cards with a "self" block change: every other card has the R1b mark; counts > 0 of true_support, false_support, false_attacker',
    `bad3 = '[]'::jsonb and (o->>'true_support')::int > 0 and (o->>'false_support')::int > 0 and (o->>'false_attacker')::int > 0`,
    "jsonb_build_object('bad', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad3) z limit 5) q), 'counts', o)")}
  prem := (select coalesce(jsonb_agg(jsonb_build_object('subject', s.id, 'k', z->>'k', 'class', r.class)), '[]') from subjects s join roles r on r.key = s.ability_v2->>'role',
             jsonb_array_elements(s.ability_v2->'blocks') z where z ? 'self' and not (z->>'k' = 'quicken' and r.class = 'attacker' and z->'self' = 'true'::jsonb));
  ${add('N4 the premise: every ability_v2 block with "self" is a quicken with self true on an attacker (the attacker branch of the engine never asks for an ally)', `prem = '[]'::jsonb`, 'prem')}
  ${APPLY ? `
  acl_b := (select coalesce(proacl::text, '') from pg_proc where oid = 'public.gauntlet_v2_needs_ally(jsonb)'::regprocedure);
  ${add('N5 after the file: md5 = the fix text, IMMUTABLE, search_path=public, the ACL of before, no execute for anon/authenticated, execute for service_role, a [combat] comment that names the fix file',
    `${MD5} = ${lit(MD5_FIX)} and acl_b = acl_a
     and (select p.provolatile = 'i' and 'search_path=public' = any(p.proconfig) from pg_proc p where p.oid = 'public.gauntlet_v2_needs_ally(jsonb)'::regprocedure)
     and not has_function_privilege('anon', 'public.gauntlet_v2_needs_ally(jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.gauntlet_v2_needs_ally(jsonb)', 'execute')
     and has_function_privilege('service_role', 'public.gauntlet_v2_needs_ally(jsonb)', 'execute')
     and obj_description('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure, 'pg_proc') like '[combat]%combat_v2_needs_ally_self.sql%combat_v2_gauntlet_run.sql.'`,
    `jsonb_build_object('md5_before', m_a, 'md5', ${MD5}, 'acl_before', acl_a, 'acl', acl_b)`)}
  -- N6 idempotent, the guard, the undo
  msg := null;
  begin execute $m$${FIX}$m$; exception when others then msg := sqlerrm; end;
  ok := msg is null and ${MD5} = ${lit(MD5_FIX)};
  msg := null;
  begin
    execute replace(pg_get_functiondef('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure), 'select coalesce', 'select /* changed by someone else */ coalesce');
    execute $m$${FIX}$m$;
    msg := 'accepted';
    raise exception 'nas_rollback';
  exception when others then if sqlerrm <> 'nas_rollback' then msg := sqlerrm; end if;
  end;
  ok2 := position('changed since this file was built' in coalesce(msg, '')) > 0;
  t := msg;
  msg := null;
  begin execute $u$${UNDO}$u$; exception when others then msg := sqlerrm; end;
  ${add('N6 the file runs a second time with no change; its guard refuses another text; the undo gives the R1b md5 and the R1b comment, the same ACL; the file applies again after the undo',
    `ok and ok2 and msg is null and ${MD5} = ${lit(MD5_R1B)} and (select coalesce(proacl::text, '') from pg_proc where oid = 'public.gauntlet_v2_needs_ally(jsonb)'::regprocedure) = acl_a
     and obj_description('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure, 'pg_proc') like '[combat] Combat v2 Gauntlet (20.15 R1b): true when%' and obj_description('public.gauntlet_v2_needs_ally(jsonb)'::regprocedure, 'pg_proc') not like '%R1b-FIX%'
     and pg_temp.reapply()`,
    `jsonb_build_object('second_run', ok, 'guard', t, 'undo_error', msg, 'md5_after_undo', ${MD5})`)}` : ''}
  raise exception 'RESULT:%', res::text;
end $t$;`;

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
let rows = null;
try { rows = JSON.parse(await runBlock(SQL)); }
catch (e) { say(false, 'the test block raised (the file did not apply?)', String(e.message).slice(0, 1500)); }
if (rows) for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 1200)); }
if (rows) { const n1 = rows.find((r) => r.case.startsWith('N1')); if (n1) console.log(`     counts: ${JSON.stringify(n1.got.counts)}`); }
console.log(fail === 0 && total > 0 ? `PASS ${total}/${total} (APPLY=${APPLY ? 1 : 0}${process.env.MUTATE ? ', MUTATE=' + process.env.MUTATE : ''})` : `FAILED ${fail} of ${total}`);
process.exit(fail === 0 && total > 0 ? 0 : 1);
