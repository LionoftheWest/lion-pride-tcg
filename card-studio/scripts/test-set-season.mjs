/**
 * Acceptance test for tcg-bot/supabase/set_season_one_set.sql (F-2 fix, 2026-10-12): one set per season in admin_set_save.
 * The defect (live, admin_actions id 2): a studio save of S2 changed its season 2 -> 1, the season of S1. cards_set_rules gives a
 * card with no set_id the ONE set of its season, so every such insert failed ("the season null has 2 sets").
 * Rolled back (the result comes back in the exception), test rows only:
 *   node scripts/test-set-season.mjs          the migration file, executed inside the block
 *   node scripts/test-set-season.mjs --live   the database as it is (after the migration is applied)
 *   node scripts/test-set-season.mjs --old    the database before the migration: FAILS
 *   MUTATE=<name> node scripts/test-set-season.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - a create or an edit with a season that another set uses is refused (LP400 "season N is already used by set X"),
 *     and nothing is written;
 *   - a create with a free season works; a later card with no set_id still gets the one set of its season;
 *   - a rename keeps the season (the season sent again, or not sent);
 *   - a rename of a set that shares its season already (made before this rule) still works.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old'), LIVE = process.argv.includes('--live');

const mig = OLD || LIVE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/set_season_one_set.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '').replace(/-- GUARD \([^)]*\)[\s\S]*?-- GUARD-END\r?\n/, '');   // the guard checks the live text: a later file (d191_pack_color_check.sql) changed it
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');

const FN = 'public.admin_set_save(text,jsonb,jsonb,text)';
const MUT = mutation({
  // no season check at all (the live function before this file)
  nocheck: [FN, 'if v_create or v_new.season is distinct from v_old.season then', 'if false then'],
  // the check on every save: a rename of a set that already shares its season is refused
  alwayscheck: [FN, 'if v_create or v_new.season is distinct from v_old.season then', 'if true then'],
  // the check on a create only: an edit can still move a set into a used season (the live defect)
  createonly: [FN, 'if v_create or v_new.season is distinct from v_old.season then', 'if v_create then'],
});

const P = 'tst_sseason';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', false, 'r', sqlerrm);
  end;`;
const got = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
// The save must be refused with LP400 and a message that names the season and the set that has it.
const refused = (call, season, other) => `begin ${call}; ok := false; err := 'accepted';
    exception when sqlstate 'LP400' then err := sqlerrm; ok := sqlerrm like 'admin: season ${season} is already used by set ${other}.%'; end;`;

const body = String.raw`do $t$
declare res jsonb := '[]'; ok boolean; err text; v jsonb; fields jsonb; free int; s1_season int; n int; aid0 bigint; subj bigint; x bigint;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  select season into strict s1_season from card_sets where id = 'S1';
  select coalesce(max(season), 0) + 1 into free from card_sets;
  select coalesce(max(id), 0) into aid0 from admin_actions;
${kase('a new set with the season of S1 is refused (LP400 "season N is already used by set S1") and nothing is written', `
    ${refused(`perform admin_set_save('tester', jsonb_build_object('id', 'TSA', 'name', 'Season test A', 'code', 'TSA', 'pack_color', '#22aa66', 'season', s1_season), null, 'test')`, "' || s1_season || '", 'S1')}
    ${got('a new set with the season of S1 is refused (LP400 "season N is already used by set S1") and nothing is written',
      `ok and not exists (select 1 from card_sets where id = 'TSA') and not exists (select 1 from admin_actions where id > aid0)`, ", 'err', err")}`)}
${kase('a new set with a free season works, and a card with no set_id still gets S1 (season 1 has one set)', `
    v := admin_set_save('tester', jsonb_build_object('id', 'TSA', 'name', 'Season test A', 'code', 'TSA', 'pack_color', '#22aa66', 'season', free), null, 'test');
    insert into subjects (key, name, type, tags) values ('${P}_subj', 'Season test subject', 'Item', '{"class": "attacker"}') returning id into subj;
    insert into cards (subject_id, name, rarity) values (subj, 'tst no set', 'normal') returning id into x;
    ${got('a new set with a free season works, and a card with no set_id still gets S1 (season 1 has one set)',
      `(v->'set'->>'season')::int = free and (select season from card_sets where id = 'TSA') = free
       and (select set_id = 'S1' and season = 'Season ' || s1_season from cards where id = x)`, ", 'v', v")}`)}
${kase('a rename keeps the season: the full form (season sent again) and a save with no season', `
    select admin_set_fields(s) into fields from card_sets s where id = 'TSA';
    v := admin_set_save('tester', fields || '{"name": "Season test renamed", "code": "TSRN"}', fields, 'test');
    fields := v->'set';
    v := admin_set_save('tester', '{"id": "TSA", "name": "Season test renamed 2"}', fields, 'test');
    ${got('a rename keeps the season: the full form (season sent again) and a save with no season',
      `(select name = 'Season test renamed 2' and code = 'TSRN' and season = free from card_sets where id = 'TSA')`, ", 'v', v")}`)}
${kase('an edit that moves a set into the season of S1 is refused, and the set keeps its season', `
    select admin_set_fields(s) into fields from card_sets s where id = 'TSA';
    ${refused(`perform admin_set_save('tester', fields || jsonb_build_object('name', 'Season test renamed 3', 'season', s1_season), fields, 'test')`, "' || s1_season || '", 'S1')}
    ${got('an edit that moves a set into the season of S1 is refused, and the set keeps its season',
      `ok and (select name = 'Season test renamed 2' and season = free from card_sets where id = 'TSA')`, ", 'err', err")}`)}
${kase('an edit to another free season works', `
    select admin_set_fields(s) into fields from card_sets s where id = 'TSA';
    v := admin_set_save('tester', fields || jsonb_build_object('season', free + 1), fields, 'test');
    ${got('an edit to another free season works', `(select season = free + 1 from card_sets where id = 'TSA')`, ", 'v', v")}`)}
${kase('a set that already shares its season (made before this rule) can still be renamed; a second new set in that season is refused', `
    insert into card_sets (id, name, code, season, pullable, sort, pack_color) values ('TSB', 'Season test B', 'TSB', free + 1, false, 99, '#334455');
    select admin_set_fields(s) into fields from card_sets s where id = 'TSB';
    v := admin_set_save('tester', fields || '{"name": "Season test B2"}', fields, 'test');
    ${refused(`perform admin_set_save('tester', jsonb_build_object('id', 'TSC', 'name', 'Season test C', 'code', 'TSC', 'pack_color', '#22aa66', 'season', free + 1), null, 'test')`, "' || (free + 1) || '", 'TSA')}
    ${got('a set that already shares its season (made before this rule) can still be renamed; a second new set in that season is refused',
      `ok and (select name = 'Season test B2' and season = free + 1 from card_sets where id = 'TSB')`, ", 'err', err")}`)}
  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 900)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x).slice(0, 500)}`); }
  console.log(bad ? `${bad} of ${rows.length} FAILED` : `PASS all ${rows.length}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select (select count(*) from card_sets where id in ('TSA', 'TSB', 'TSC')) + (select count(*) from subjects where key like '${P}%') as n`);
console.log('after (nothing stays):', JSON.stringify(left));
