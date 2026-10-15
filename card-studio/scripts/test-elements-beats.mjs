import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/f3_elements_beats.sql (elements_list returns the counter pairs), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-elements-beats.mjs      must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                          must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                             runs every mutation, one line each
 * Invariants (the expected values are in THIS file: the ORDER of the 14 elements and the 19 approved pairs of Nathan, not read from the table):
 *   1. elements_list() returns 14 rows in the order of elements.ord, each with the old fields (key, name, ord, aliases, glyph, color, color2, weak_to, dungeon_foe) unchanged
 *      and two new arrays, beats and beaten_by.
 *   2. beats and beaten_by are exactly the 19 approved pairs, each list in the order of elements.ord; a beats b exactly when b has a in beaten_by.
 *   3. A pair with proposal = true is not returned. An element with no pair gets [] (never NULL).
 *   4. Every one of the 14 elements beats one and is beaten by one (the F-3 rule: everything counters each other).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_elements_beats.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  proposal: ['where c.beater = e.key and not c.proposal', 'where c.beater = e.key'],
  proposal2: ['where c.target = e.key and not c.proposal', 'where c.target = e.key'],
  swap: ['where c.beater = e.key and not c.proposal)', 'where c.target = e.key and not c.proposal)'],
  order: ['order by t.ord', 'order by t.key'],
  order2: ['order by b.ord', 'order by b.key'],
  nulls: ["'beats', (select coalesce(jsonb_agg(c.target order by t.ord), '[]'::jsonb)", "'beats', (select jsonb_agg(c.target order by t.ord)"],
  nobeaten: ["'beaten_by', (select", "'beaten_by_x', (select"],
  dropweak: ["'weak_to', e.weak_to, ", ''],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(10)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

// The order of the elements (elements.ord) and the 19 approved pairs [beater, target] (f3_elements_decisions.sql, Nathan 2026-10-11 and 2026-10-12).
const ORD = ['fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'air', 'shadow', 'light', 'arcane', 'psychic', 'toxic', 'metal', 'physical'];
const PAIRS = [['water', 'fire'], ['lightning', 'water'], ['earth', 'lightning'], ['nature', 'earth'], ['fire', 'nature'], ['fire', 'ice'], ['light', 'shadow'], ['shadow', 'light'],
  ['lightning', 'air'], ['metal', 'arcane'], ['shadow', 'psychic'], ['earth', 'toxic'], ['fire', 'metal'],
  ['ice', 'nature'], ['air', 'toxic'], ['arcane', 'psychic'], ['psychic', 'physical'], ['toxic', 'water'], ['physical', 'arcane']];
const by = (i, j) => Object.fromEntries(ORD.map((e) => [e, ORD.filter((o) => PAIRS.some((p) => p[i] === e && p[j] === o))]));
const BEATS = by(0, 1), BEATEN = by(1, 0);
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

const body = String.raw`do $t$
declare bad text := ''; r jsonb; e jsonb; ord text[] := ${`array[${ORD.map((x) => `'${x}'`).join(',')}]`}; beats jsonb := ${lit(BEATS)}; beaten jsonb := ${lit(BEATEN)}; i int; old jsonb;
begin
  -- the old shape: the 9 fields of the list before the file
  select jsonb_agg(jsonb_build_object('key', x.key, 'name', x.name, 'ord', x.ord, 'aliases', to_jsonb(x.aliases), 'glyph', x.glyph, 'color', x.color, 'color2', x.color2,
           'weak_to', x.weak_to, 'dungeon_foe', x.dungeon_foe) order by x.ord) into old from elements x;
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent
  r := elements_list();
  -- ===== 1. 14 rows in the order of elements.ord, old fields unchanged, two new arrays.
  if jsonb_typeof(r) <> 'array' or jsonb_array_length(r) <> 14 then bad := bad || '1: not 14 rows; '; end if;
  for i in 0 .. least(13, jsonb_array_length(r) - 1) loop
    e := r->i;
    if e->>'key' is distinct from ord[i + 1] then bad := bad || format('1: row %s is %s, expected %s; ', i, e->>'key', ord[i + 1]); end if;
    if (e - 'beats' - 'beaten_by') is distinct from old->i then bad := bad || format('1: the old fields of %s changed: %s; ', e->>'key', (e - 'beats' - 'beaten_by')::text); end if;
    if jsonb_typeof(e->'beats') is distinct from 'array' or jsonb_typeof(e->'beaten_by') is distinct from 'array' then bad := bad || format('1: %s has no beats / beaten_by array; ', e->>'key'); end if;
    -- ===== 2. exactly the 19 approved pairs, in the order of ord.
    if e->'beats' is distinct from beats->(e->>'key') then bad := bad || format('2: %s beats %s, expected %s; ', e->>'key', e->'beats', beats->(e->>'key')); end if;
    if e->'beaten_by' is distinct from beaten->(e->>'key') then bad := bad || format('2: %s beaten_by %s, expected %s; ', e->>'key', e->'beaten_by', beaten->(e->>'key')); end if;
    -- ===== 4. every element beats one and is beaten by one.
    if jsonb_array_length(coalesce(e->'beats', '[]')) < 1 or jsonb_array_length(coalesce(e->'beaten_by', '[]')) < 1 then bad := bad || format('4: %s beats or is beaten by nobody; ', e->>'key'); end if;
  end loop;
  -- both lists say the same: a beats b exactly when b has a in beaten_by
  if exists (select 1 from jsonb_array_elements(r) a, jsonb_array_elements_text(a->'beats') b
              where not exists (select 1 from jsonb_array_elements(r) x where x->>'key' = b and x->'beaten_by' ? (a->>'key'))) then bad := bad || '2: a beats list and a beaten_by list disagree; '; end if;
  -- ===== 3. a proposal is not returned. Two new proposals.
  insert into element_counters (beater, target, proposal) values ('air', 'fire', true), ('ice', 'metal', true);
  r := elements_list();
  if exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'air' and x->'beats' ? 'fire') or exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'fire' and x->'beaten_by' ? 'air')
     or exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'ice' and x->'beats' ? 'metal') or exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'metal' and x->'beaten_by' ? 'ice') then
    bad := bad || '3: a proposal pair is returned; ';
  end if;
  -- the same pair, approved, is returned (in the order of ord: fire before toxic, water before air)
  update element_counters set proposal = false where beater = 'air' and target = 'fire';
  r := elements_list();
  if not exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'air' and x->'beats' = '["fire", "toxic"]'::jsonb) or not exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'fire' and x->'beaten_by' = '["water", "air"]'::jsonb) then
    bad := bad || '3: an approved new pair is not returned in the order of ord: ' || (select x->>'beats' from jsonb_array_elements(r) x where x->>'key' = 'air') || '; ';
  end if;
  -- an element with no pair: [] and never NULL (the pairs of physical removed)
  delete from element_counters where beater = 'physical' or target = 'physical';
  r := elements_list();
  if not exists (select 1 from jsonb_array_elements(r) x where x->>'key' = 'physical' and x->'beats' = '[]'::jsonb and x->'beaten_by' = '[]'::jsonb) then
    bad := bad || '3: an element with no pair has no empty lists: ' || (select x::text from jsonb_array_elements(r) x where x->>'key' = 'physical') || '; ';
  end if;
  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|\\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
