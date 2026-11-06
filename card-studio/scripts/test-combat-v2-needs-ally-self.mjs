import './localdb-guard.mjs';
/**
 * Acceptance test for the R1b-FIX files (2026-11-05):
 *   tcg-bot/supabase/combat_v2_needs_ally_self.sql          gauntlet_v2_needs_ally (part 1, the R1b helper)
 *   tcg-bot/supabase/combat_v2_needs_ally_self_dungeon.sql  dungeon_v2_needs_ally  (part 2, the R2a helper, the same rule)
 * Each helper must use the engine rule for a block with "self": true (an attacker quicken: the card Quickens itself, no ally pick).
 * NO lasting change: one DO block, undone by its final RAISE.
 *   LOCALDB=1 LOCALDB_ENV=... node --import ./scripts/localdb-preload.mjs scripts/test-combat-v2-needs-ally-self.mjs   must PASS
 *   APPLY=0 ...    checks the functions AS THEY ARE in the database (no file run): FAILS on the old texts (S2 "Time Skip"), PASSES after the files
 *   MUTATE=<name>  must FAIL, for every name in MUT below
 *   MUTATE=all     the baseline (must PASS), then every mutation (each must FAIL its named case)
 * Cases (N<k> = the Gauntlet helper, N<k>d = the Dungeon helper):
 *   N1/N1d two-way, on every card with a usable ability_v2: the engine probe (combat_v2_card_act with no opts.ally) raises "needs opts.ally"
 *      exactly when the helper is true (a gated ally block may be marked true when the engine does not ask: G1.17 b rule)
 *   N2/N2d every card with a "self": true block is marked false, and there is at least one such card
 *   N3/N3d only cards with a "self" block change: every other card has the old mark (the old text as a pg_temp copy); counts > 0
 *   N4 the premise of the rule: every block with "self" is a quicken of an attacker card (else "self" is not the engine rule)
 *   N5/N5d the function after its file: md5, IMMUTABLE, search_path, the grants of before (service_role only), the [combat] comment
 *   N6/N6d the file runs twice (no change), its guard refuses another text, its undo gives back the old md5 and comment, the file applies again
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-combat-v2-needs-ally-self.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const SUP = '../../tcg-bot/supabase/';
const H = {
  g: { fn: 'gauntlet_v2_needs_ally', sfx: '', fix: read(SUP + 'combat_v2_needs_ally_self.sql'), undo: read(SUP + 'combat_v2_needs_ally_self_undo.sql'),
       oldFile: 'combat_v2_gauntlet_run.sql', md5Fix: 'dcf9568f280773d384762c99bb2b2d2f', md5Old: 'fd42f176eddb061f541ac416a6b48c0b',
       oldComment: '[combat] Combat v2 Gauntlet (20.15 R1b): true when%', fixName: 'combat_v2_needs_ally_self.sql', fileName: 'combat_v2_gauntlet_run.sql' },
  d: { fn: 'dungeon_v2_needs_ally', sfx: 'd', fix: read(SUP + 'combat_v2_needs_ally_self_dungeon.sql'), undo: read(SUP + 'combat_v2_needs_ally_self_dungeon_undo.sql'),
       oldFile: 'combat_v2_dungeon_run.sql', md5Fix: '3578f0810a65c3b21f69dc0a116352f6', md5Old: 'f6a36c42df0a3d677210b02efdf1d619',
       oldComment: '[combat] Combat v2 Dungeon (20.19 R2): true when%', fixName: 'combat_v2_needs_ally_self_dungeon.sql', fileName: 'combat_v2_dungeon_run.sql' },
};
const APPLY = process.env.APPLY !== '0';
// the old text of each helper, as a pg_temp copy (the old mark of N3)
for (const [k, h] of Object.entries(H)) {
  const src = read(SUP + h.oldFile);
  const i0 = src.indexOf(`create or replace function public.${h.fn}(`);
  if (i0 < 0) throw new Error(`the old text of ${h.fn} was not found in ${h.oldFile}`);
  h.oldFn = src.slice(i0, src.indexOf('$fn$;', i0) + 5).replace(`create or replace function public.${h.fn}(`, `create function pg_temp.old_${k}(`);
}

// ---------------------------------------------------------------------------------------------------------- the mutations
const SELF = "\n                          and x->'self' is distinct from 'true'::jsonb";
const guardLine = (h) => `if m not in ('${h.md5Old}', '${h.md5Fix}') then`;
const MUT = {
  no_self_clause: { h: 'g', file: 'fix', a: SELF, b: '', want: 'N1' },                                   // the R1b rule again
  self_any_quicken: { h: 'g', file: 'fix', a: "x->'self' is distinct from 'true'::jsonb", b: "x->>'k' <> 'quicken'", want: 'N3' }, // too wide
  plant_support_self: { data: true, want: 'N4' },                                                         // a support quicken with self: the engine asks
  guard_open: { h: 'g', file: 'fix', a: guardLine(H.g), b: 'if false then', want: 'N6' },
  grant_anon: { h: 'g', file: 'fix', a: 'grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role;', b: 'grant execute on function public.gauntlet_v2_needs_ally(jsonb) to service_role, anon;', want: 'N5' },
  stable_not_immutable: { h: 'g', file: 'fix', a: 'language sql immutable set search_path', b: 'language sql stable set search_path', want: 'N5' },
  undo_keeps_fix: { h: 'g', file: 'undo', a: "  -- is not most_hurt or strongest asks for opts.ally\n", b: "  -- is not most_hurt or strongest asks for opts.ally (undo)\n", want: 'N6' },
  d_no_self_clause: { h: 'd', file: 'fix', a: SELF, b: '', want: 'N1d' },                               // the R2a rule again
  d_self_any_quicken: { h: 'd', file: 'fix', a: "x->'self' is distinct from 'true'::jsonb", b: "x->>'k' <> 'quicken'", want: 'N3d' },
  d_guard_open: { h: 'd', file: 'fix', a: guardLine(H.d), b: 'if false then', want: 'N6d' },
  d_grant_anon: { h: 'd', file: 'fix', a: 'grant execute on function public.dungeon_v2_needs_ally(jsonb) to service_role;', b: 'grant execute on function public.dungeon_v2_needs_ally(jsonb) to service_role, anon;', want: 'N5d' },
  d_stable_not_immutable: { h: 'd', file: 'fix', a: 'language sql immutable set search_path', b: 'language sql stable set search_path', want: 'N5d' },
  d_undo_keeps_fix: { h: 'd', file: 'undo', a: "  -- all) whose \"to\" is not most_hurt or strongest asks for opts.ally\n", b: "  -- all) whose \"to\" is not most_hurt or strongest asks for opts.ally (undo)\n", want: 'N6d' },
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  const runOne = (name) => spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]),
    { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
  const base = runOne('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  const bok = base.status === 0 && /^PASS/.test(bl);
  if (!bok) ok = false;
  console.log(`baseline (no mutation)          ${bok ? 'PASS' : 'FAIL'}  ${bl.slice(0, 150)}`);
  if (!bok) console.log(((base.stdout || '') + (base.stderr || '')).slice(0, 3000));
  for (const [name, m] of Object.entries(MUT)) {
    const r = runOne(name);
    const lines = (r.stdout || '').split(/\r?\n/);
    const hit = lines.find((l) => l.startsWith(`FAIL ${m.want} `));
    const crashed = lines.some((l) => /the test block raised/.test(l));
    const caught = r.status !== 0 && !!hit && !crashed;
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(24)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  [${m.want}]  ${(hit || lines.find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '').slice(0, 200)}`);
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
    const src = H[m.h][m.file];
    if (src.split(m.a).length - 1 !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match ${m.h}.${m.file} exactly once`);
    H[m.h][m.file] = src.split(m.a).join(m.b);
  }
}
for (const h of Object.values(H)) for (const t of [h.fix, h.undo, h.oldFn]) if (['$m$', '$t$', '$u$', '$r$'].some((x) => t.includes(x))) throw new Error('the SQL must not contain $m$, $t$, $u$ or $r$');

// ---------------------------------------------------------------------------------------------------------- the block
const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const MD5 = (h) => `md5(replace(pg_get_functiondef('public.${h.fn}(jsonb)'::regprocedure), chr(13), ''))`;
const ACL = (h) => `(select coalesce(proacl::text, '') from pg_proc where oid = 'public.${h.fn}(jsonb)'::regprocedure)`;
const CMT = (h) => `obj_description('public.${h.fn}(jsonb)'::regprocedure, 'pg_proc')`;
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;
// the file again after the undo (a function: an EXECUTE inside the add() expression)
const reapply = (k, h) => String.raw`create function pg_temp.reapply_${k}() returns boolean language plpgsql as $r$
begin execute $m$${h.fix}$m$; return ${MD5(h)} = ${lit(h.md5Fix)}; exception when others then return false; end $r$;`;
const after = (k, h) => String.raw`
  ${add(`N5${h.sfx} after ${h.fixName}: md5 = the fix text, IMMUTABLE, search_path=public, the ACL of before, no execute for anon/authenticated, execute for service_role, a [combat] comment that names the fix file`,
    `${MD5(h)} = ${lit(h.md5Fix)} and ${ACL(h)} = acl_${k}
     and (select p.provolatile = 'i' and 'search_path=public' = any(p.proconfig) from pg_proc p where p.oid = 'public.${h.fn}(jsonb)'::regprocedure)
     and not has_function_privilege('anon', 'public.${h.fn}(jsonb)', 'execute') and not has_function_privilege('authenticated', 'public.${h.fn}(jsonb)', 'execute')
     and has_function_privilege('service_role', 'public.${h.fn}(jsonb)', 'execute')
     and ${CMT(h)} like '[combat]%${h.fixName}%${h.fileName}.'`,
    `jsonb_build_object('md5', ${MD5(h)}, 'acl_before', acl_${k}, 'acl', ${ACL(h)})`)}
  msg := null;
  begin execute $m$${h.fix}$m$; exception when others then msg := sqlerrm; end;
  ok := msg is null and ${MD5(h)} = ${lit(h.md5Fix)};
  msg := null;
  begin
    execute replace(pg_get_functiondef('public.${h.fn}(jsonb)'::regprocedure), 'select coalesce', 'select /* changed by someone else */ coalesce');
    execute $m$${h.fix}$m$;
    msg := 'accepted';
    raise exception 'nas_rollback';
  exception when others then if sqlerrm <> 'nas_rollback' then msg := sqlerrm; end if;
  end;
  ok2 := position('changed since this file was built' in coalesce(msg, '')) > 0;
  t := msg;
  msg := null;
  begin execute $m$${h.undo}$m$; exception when others then msg := sqlerrm; end;
  ${add(`N6${h.sfx} ${h.fixName} runs a second time with no change; its guard refuses another text; its undo gives the old md5 and the old comment, the same ACL; the file applies again after the undo`,
    `ok and ok2 and msg is null and ${MD5(h)} = ${lit(h.md5Old)} and ${ACL(h)} = acl_${k}
     and ${CMT(h)} like ${lit(h.oldComment)} and ${CMT(h)} not like '%R1b-FIX%' and pg_temp.reapply_${k}()`,
    `jsonb_build_object('second_run', ok, 'guard', t, 'undo_error', msg, 'md5_after_undo', ${MD5(h)})`)}`;
const perHelper = (k, h, label) => String.raw`
  ${add(`N1${h.sfx} two-way (${label}): the engine probe asks for opts.ally exactly when ${h.fn} is true (every card with a usable ability_v2; a gated block may be marked true)`,
    `bad_${k} = '[]'::jsonb`, `jsonb_build_object('bad', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad_${k}) z limit 5) q), 'n_bad', jsonb_array_length(bad_${k}), 'counts', o_${k})`)}
  ${add(`N2${h.sfx} (${label}) every card with a "self": true block is marked false by ${h.fn} (at least one such card: S2 Time Skip)`,
    `jsonb_array_length(selfc) > 0 and selfbad_${k} = '[]'::jsonb`, `jsonb_build_object('self_cards', selfc, 'marked_true', selfbad_${k})`)}
  ${add(`N3${h.sfx} (${label}) only cards with a "self" block change: every other card has the old mark of ${h.fn}; counts > 0 of true_support, false_support, false_attacker`,
    `bad3_${k} = '[]'::jsonb and (o_${k}->>'true_support')::int > 0 and (o_${k}->>'false_support')::int > 0 and (o_${k}->>'false_attacker')::int > 0`,
    `jsonb_build_object('bad', (select jsonb_agg(z) from (select z from jsonb_array_elements(bad3_${k}) z limit 5) q), 'counts', o_${k})`)}`;
const cnt = (k) => `o_${k} := jsonb_set(o_${k}, array[case when m_${k} then 'true_' else 'false_' end || (x->>'class')], to_jsonb(coalesce((o_${k}->>(case when m_${k} then 'true_' else 'false_' end || (x->>'class')))::int, 0) + 1));`;
const check = (k) => `
    if (gt_${k} = 'plain' and m_${k} is distinct from ok2) or (gt_${k} = 'gated' and ok2 and not m_${k}) or (msg is not null and not ok2) then
      bad_${k} := bad_${k} || jsonb_build_object('card', c.id, 'subject', c.sid, 'mark', m_${k}, 'probe', msg);
    end if;
    if hs then if m_${k} is distinct from false then selfbad_${k} := selfbad_${k} || to_jsonb(c.id); end if;
    elsif m_${k} is distinct from old_${k} then bad3_${k} := bad3_${k} || jsonb_build_object('card', c.id, 'mark', m_${k}, 'old', old_${k});
    end if;
    ${cnt(k)}`;
const gated = (k) => `gt_${k} := case when exists (select 1 from jsonb_array_elements(x->'active'->'blocks') with ordinality q(bk, oo) where pg_temp.old_${k}(jsonb_build_array(q.bk))
                and b->'blocks'->(x->'active'->'blocks'->(oo::int)->>'k')->>'attach' = 'gate') then 'gated' else 'plain' end;`;
const V = (k) => `m_${k} boolean; old_${k} boolean; gt_${k} text; o_${k} jsonb := '{}'; bad_${k} jsonb := '[]'; bad3_${k} jsonb := '[]'; selfbad_${k} jsonb := '[]'; acl_${k} text;`;

const SQL = String.raw`do $t$
declare res jsonb := '[]'; wk date; fl jsonb; b jsonb; x jsonb; s2 jsonb; ok boolean; ok2 boolean; hs boolean; msg text; t text; c record;
  selfc jsonb := '[]'; prem jsonb; ${V('g')} ${V('d')}
begin
  ${H.g.oldFn}
  ${H.d.oldFn}
  ${APPLY ? `execute ${lit(reapply('g', H.g))}; execute ${lit(reapply('d', H.d))};` : ''}
  acl_g := ${ACL(H.g)}; acl_d := ${ACL(H.d)};
  ${PLANT ? `-- MUTATION plant_support_self: one support card's plain quicken gets "self": true (the trigger subjects_ability_v2_check refuses it, so it is
  -- off inside this rolled-back block; the engine asks an ally for it)
  alter table subjects disable trigger subjects_ability_v2_check;
  update subjects s set ability_v2 = jsonb_set(s.ability_v2, array['blocks', (q.oo - 1)::text, 'self'], 'true'::jsonb)
    from (select s1.id, z.oo from subjects s1 join roles r on r.key = s1.ability_v2->>'role', jsonb_array_elements(s1.ability_v2->'blocks') with ordinality z(bk, oo)
           where r.class = 'support' and z.bk->>'k' = 'quicken' and not z.bk ? 'all' and not z.bk ? 'to' order by s1.id limit 1) q where s.id = q.id;` : ''}
  ${APPLY ? `execute $m$${H.g.fix}$m$;\n  execute $m$${H.d.fix}$m$;` : '-- APPLY=0: the functions as they are'}
  wk := gauntlet_week(dungeon_day());
  perform gauntlet_generate(wk);
  fl := (select floors from gauntlet_weeks where week = wk);
  b := combat_v2_enemy_numbers();
  for c in select cd.id, s0.id sid, s0.ability_v2 ab from cards cd join subjects s0 on s0.id = cd.subject_id
            where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array' and exists (select 1 from roles ro where ro.key = s0.ability_v2->>'role') order by cd.id loop
    x := combat_v2_card_unit(c.id) || '{"charge": 99, "meter": 0}'::jsonb;
    m_g := gauntlet_v2_needs_ally(x->'active'->'blocks'); old_g := pg_temp.old_g(x->'active'->'blocks');
    m_d := dungeon_v2_needs_ally(x->'active'->'blocks'); old_d := pg_temp.old_d(x->'active'->'blocks');
    hs := exists (select 1 from jsonb_array_elements(x->'active'->'blocks') z where z ? 'self');
    if hs then selfc := selfc || jsonb_build_object('card', c.id, 'subject', c.sid, 'class', x->>'class'); end if;
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
    ${gated('g')}
    ${gated('d')}
    ${check('g')}
    ${check('d')}
  end loop;
  ${perHelper('g', H.g, 'Gauntlet')}
  ${perHelper('d', H.d, 'Dungeon')}
  prem := (select coalesce(jsonb_agg(jsonb_build_object('subject', s.id, 'k', z->>'k', 'class', r.class)), '[]') from subjects s join roles r on r.key = s.ability_v2->>'role',
             jsonb_array_elements(s.ability_v2->'blocks') z where z ? 'self' and not (z->>'k' = 'quicken' and r.class = 'attacker' and z->'self' = 'true'::jsonb));
  ${add('N4 the premise: every ability_v2 block with "self" is a quicken with self true on an attacker (the attacker branch of the engine never asks for an ally)', `prem = '[]'::jsonb`, 'prem')}
  ${APPLY ? after('g', H.g) + after('d', H.d) : ''}
  raise exception 'RESULT:%', res::text;
end $t$;`;

let fail = 0, total = 0;
const say = (ok, name, extra = '') => { total++; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); };
let rows = null;
try { rows = JSON.parse(await runBlock(SQL)); }
catch (e) { say(false, 'the test block raised (the file did not apply?)', String(e.message).slice(0, 1500)); }
if (rows) for (const r of rows) { const { case: name, ok, ...rest } = r; say(ok, name, JSON.stringify(rest).slice(0, 1200)); }
if (rows) for (const s of ['N1 ', 'N1d ']) { const n1 = rows.find((r) => r.case.startsWith(s)); if (n1) console.log(`     counts ${s.trim()}: ${JSON.stringify(n1.got.counts)}`); }
console.log(fail === 0 && total > 0 ? `PASS ${total}/${total} (APPLY=${APPLY ? 1 : 0}${process.env.MUTATE ? ', MUTATE=' + process.env.MUTATE : ''})` : `FAILED ${fail} of ${total}`);
process.exit(fail === 0 && total > 0 ? 0 : 1);
