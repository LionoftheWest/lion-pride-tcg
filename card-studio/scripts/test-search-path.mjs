/**
 * Acceptance test for tcg-bot/supabase/fix_search_path.sql. Rolled back (the result comes back in the exception).
 *   node scripts/test-search-path.mjs              the migration file, executed inside the block
 *   node scripts/test-search-path.mjs --old        the database as it is (the baseline: it must FAIL before the migration)
 *   node scripts/test-search-path.mjs --mutations  each mutation must make at least one case FAIL
 * Invariants:
 *   P1 after the file, no public function is without a fixed search_path; the 16 have search_path=public
 *   P2 each of the 16 gives the same result as before the file (same seeded random()), and the same result when the
 *      caller has an empty search_path
 *   P3 a re-run of the file changes nothing (same md5 of each function)
 *   P4 a re-run of each source file that creates one of these functions either is refused (its guard) or keeps
 *      every search_path fixed (the files carry the SET line; balance_table.sql's guard accepts the new md5)
 *   P5 (no database) each "create function" in tcg-bot/supabase/*.sql carries a search_path
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const OLD = process.argv.includes('--old');
const DIR = fileURLToPath(new URL('../../tcg-bot/supabase/', import.meta.url));
const read = (f) => readFileSync(DIR + f, 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = read('fix_search_path.sql');
// The files that create one of the 16 (P4), and the 5 of audit_fixes_2026_10_03.sql.
const RERUN = ['balance_table.sql', 'combat_core.sql', 'dungeon.sql', 'dungeon_v2.sql', 'gauntlet.sql', 'hunt_boss_moves.sql',
  'one_source_rules.sql', 'ascension.sql', 'ascension_cost_v3.sql', 'ascension_cp_v2.sql', 'card_power_fix.sql', 'card_tags.sql',
  'event_cards.sql', 'hall_auctions.sql', 'stat_points.sql'];
const files = Object.fromEntries(RERUN.map((f) => [f, read(f)]));
for (const [f, s] of Object.entries({ 'fix_search_path.sql': src, ...files })) if (/\$(m|r|mq|t)\$/.test(s)) throw new Error(`${f} contains $m$, $r$, $mq$ or $t$`);

// P5: a static scan. The header of each "create function" (up to "as $tag$") or its tail (after the body) names a search_path.
function staticScan(override = {}) {
  const missing = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql'))) {
    const s = override[f] ?? readFileSync(DIR + f, 'utf8').replace(/\r/g, '');
    const re = /create\s+(or\s+replace\s+)?function\s+("?public"?\.)?"?([a-z_0-9]+)"?\s*\(/gi;
    let m;
    while ((m = re.exec(s))) {
      const rest = s.slice(m.index);
      const a = rest.search(/\bas\s+\$[a-z_]*\$/i);
      if (a < 0) { missing.push(`${f}: ${m[3]} (no body found)`); continue; }
      if (/search_path/i.test(rest.slice(0, a))) continue;
      const tag = rest.slice(a).match(/\$[a-z_]*\$/i)[0];
      const b0 = rest.indexOf(tag, a), b1 = rest.indexOf(tag, b0 + tag.length);
      const tail = rest.slice(b1 + tag.length, rest.indexOf(';', b1 + tag.length) + 1);
      if (!/search_path/i.test(tail)) missing.push(`${f}: ${m[3]}`);
    }
  }
  return missing;
}

// Each of the 16 with fixed arguments. random() is seeded before each call, so the volatile ones repeat.
const CALLS = {
  combat_absorb: 'combat_absorb(10, 4)',
  combat_absorb2: 'combat_absorb(3, 9)',
  combat_aff_scale: 'combat_aff_scale(3)',
  combat_area_roll: 'combat_area_roll(100, 1, 1)',
  combat_burn: 'combat_burn(100)',
  combat_lifesteal: 'combat_lifesteal(100, 0.2, 500)',
  combat_regen: 'combat_regen(1000)',
  combat_stun_immune: 'combat_stun_immune(5, 3)',
  combat_support_value: "combat_support_value('empower', 0.2, 1, 500)",
  combat_support_value2: "combat_support_value('heal', 40, 1.2, 500)",
  combat_thorns: 'combat_thorns(100)',
  dungeon_day: 'dungeon_day()',
  dungeon_pick: `dungeon_pick('{"a":1,"b":3}', 0.5)`,
  dungeon_rand: "dungeon_rand('2026-10-07|f1|r2')",
  dungeon_rules: 'dungeon_rules()',
  dungeon_txt: `dungeon_txt('["a","b"]')`,
  gauntlet_week: "gauntlet_week('2026-10-07')",
  hunt_mark_on: `hunt_mark_on('{"stun":{"until":5}}', 'stun', 3)`,
};
const callAll = (into) => Object.entries(CALLS).map(([k, c]) =>
  `perform setseed(0.42); ${into} := ${into} || jsonb_build_object('${k}', to_jsonb(public.${c}));`).join('\n  ');
const SIXTEEN = ['combat_absorb', 'combat_aff_scale', 'combat_area_roll', 'combat_burn', 'combat_lifesteal', 'combat_regen',
  'combat_stun_immune', 'combat_support_value', 'combat_thorns', 'dungeon_day', 'dungeon_pick', 'dungeon_rand', 'dungeon_rules',
  'dungeon_txt', 'gauntlet_week', 'hunt_mark_on'];
const NAMES = `array['${SIXTEEN.join("','")}']`;

const body = (mig, reruns) => String.raw`do $t$
declare res jsonb := '[]'; before jsonb := '{}'; after jsonb := '{}'; empty jsonb := '{}'; md1 jsonb; md2 jsonb; n int; v text; ok boolean;
begin
  ${callAll('before')}
  begin
    ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  exception when others then res := res || jsonb_build_object('case', 'the file runs', 'ok', false, 'error', sqlerrm); end;

  -- P1
  select count(*), string_agg(p.oid::regprocedure::text, ', ') into n, v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
  res := res || jsonb_build_object('case', 'P1 no public function without a fixed search_path', 'ok', n = 0, 'missing', v);
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${NAMES})
     and p.proconfig = array['search_path=public'];
  res := res || jsonb_build_object('case', 'P1 the 16 functions have search_path=public', 'ok', n = 16, 'n', n);

  -- P2
  ${callAll('after')}
  res := res || jsonb_build_object('case', 'P2 the 16 give the same results as before the file', 'ok', after = before, 'before', before, 'after', after);
  begin
    perform set_config('search_path', '', true);
    ${callAll('empty')}
    perform set_config('search_path', 'public', true);
    res := res || jsonb_build_object('case', 'P2 the same results when the caller has an empty search_path', 'ok', empty = before, 'empty', empty);
  exception when others then
    perform set_config('search_path', 'public', true);
    res := res || jsonb_build_object('case', 'P2 the same results when the caller has an empty search_path', 'ok', false, 'error', sqlerrm);
  end;

  -- P3
  select jsonb_object_agg(p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into md1
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${NAMES});
  begin
    ${mig ? `execute $m$${mig}$m$;` : 'null;'}
    select jsonb_object_agg(p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) into md2
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${NAMES});
    res := res || jsonb_build_object('case', 'P3 a re-run of the file changes nothing', 'ok', md1 = md2);
  exception when others then res := res || jsonb_build_object('case', 'P3 a re-run of the file changes nothing', 'ok', false, 'error', sqlerrm); end;
  res := res || jsonb_build_object('case', 'info: md5 after the file', 'ok', true, 'md5', md1);

  -- P4: each source file in its own sub-block, undone by the raise at its end (or refused by its guard).
  ${reruns.map(([f, s]) => String.raw`begin
    execute $r$${s}$r$;
    select count(*), string_agg(p.oid::regprocedure::text, ', ') into n, v from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) x where x like 'search_path=%');
    select jsonb_object_agg(p.oid::regprocedure::text, md5(replace(pg_get_functiondef(p.oid), chr(13), ''))) = md1 into ok
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(${NAMES});
    raise exception 'RERUN-DONE %|%|%', n, ok, coalesce(v, '');
  exception when others then
    if sqlerrm like 'RERUN-DONE %' then
      ok := split_part(substr(sqlerrm, 12), '|', 1) = '0'${f === 'balance_table.sql' ? " and split_part(sqlerrm, '|', 2) = 't'" : ''};
      res := res || jsonb_build_object('case', 'P4 a re-run of ${f} keeps every search_path fixed${f === 'balance_table.sql' ? ' (and the same md5 as after the file)' : ''}', 'ok', ok, 'ran', true, 'same16', split_part(sqlerrm, '|', 2), 'missing', split_part(sqlerrm, '|', 3));
    else
      res := res || jsonb_build_object('case', 'P4 a re-run of ${f} keeps every search_path fixed', 'ok', true, 'refused', sqlerrm);
    end if;
  end;`).join('\n  ')}

  raise exception 'RESULTS %', res;
end $t$;`;

const MUTATIONS = {
  'P1 one alter line is missing': ['fix', 'alter function public.hunt_mark_on(jsonb, text, integer) set search_path = public;\n', ''],
  'P4 balance_table.sql creates combat_thorns without the SET line': ['balance_table.sql',
    `CREATE OR REPLACE FUNCTION "public"."combat_thorns"("p_dmg" integer) RETURNS integer\n    LANGUAGE "sql" STABLE\n    SET "search_path" TO 'public'\n`,
    `CREATE OR REPLACE FUNCTION "public"."combat_thorns"("p_dmg" integer) RETURNS integer\n    LANGUAGE "sql" STABLE\n`],
  'P5 dungeon.sql creates dungeon_rand without the SET line': ['dungeon.sql',
    'returns numeric language sql immutable set search_path = public as $$', 'returns numeric language sql immutable as $$'],
};

const runOnce = async (mig, reruns) => {
  const out = await q(body(mig, reruns));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 2000) };
  return { results: JSON.parse(m[1]) };
};
const report = (results) => {
  let fail = 0;
  for (const r of results) {
    if (!r.ok) fail++;
    const extra = r.ok ? (r.refused ? `  (refused: ${r.refused.slice(0, 90)})` : r.ran ? '  (ran)' : '') : '  ' + JSON.stringify(r).slice(0, 900);
    if (r.case.startsWith('info:')) { if (process.argv.includes('--md5')) console.log(JSON.stringify(r.md5, null, 1)); continue; }
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${extra}`);
  }
  return fail;
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [where, a, b]] of Object.entries(MUTATIONS)) {
    const target = where === 'fix' ? src : files[where];
    if (target.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const mig = where === 'fix' ? src.replace(a, () => b) : src;
    const reruns = Object.entries(files).map(([f, s]) => [f, f === where ? s.replace(a, () => b) : s]);
    const { results, raw } = await runOnce(mig, reruns);
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (where !== 'fix' && staticScan({ [where]: files[where].replace(a, () => b) }).length) failed.push('P5 the static scan');
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0]}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const missing = staticScan();
  const { results, raw } = await runOnce(OLD ? '' : src, Object.entries(files));
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  results.push({ case: 'P5 each create function in tcg-bot/supabase/*.sql carries a search_path', ok: missing.length === 0, missing });
  const fail = report(results);
  console.log(`${OLD ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length - 1} FAILED` : `PASS all ${results.length - 1}`}`);
  process.exitCode = fail ? 1 : 0;
}
