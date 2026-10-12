/**
 * Acceptance test for tcg-bot/supabase/f3_elements_decisions.sql (the owner's answers, 2026-10-12), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-elements-decisions.mjs      must PASS (the file is applied twice)
 *   REPORT=1 ...                                                                                  prints the Dungeon foe elements before and after
 *   MUTATE=<name> ...                                                                             must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                                runs every mutation, one line each
 * The data is first put back to the state of the refactor (f3_elements_passives.sql, tested by test-elements-passives.mjs), so the test
 * passes whether or not the decisions file is applied on the local copy.
 * Invariants:
 *   1. The Dungeon foe pool is all 13 elements: the old 8 in their old order, then air, arcane, psychic, toxic, metal. The old 8 keep their
 *      counters. The 5 new counters are the ones that the owner approved: air by lightning, arcane by metal, psychic by shadow,
 *      toxic by earth, metal by fire. Every foe has its element's counter as its first weakness. All 13 elements occur in 6000 foes.
 *   2. physical is a row: ord 14, the word "physical", the look of the client (glyph and colors of attack-fx.js and tokens.js), no counter,
 *      NOT in the Dungeon pool (no foe is physical). card_element of its word is physical, with the lowest priority.
 *   3. "spirit" is not an element word (the owner: keep it as Shadow in the game, so the studio does not map it): element_of('spirit') is NULL,
 *      the studio taxonomy has no spirit mapping, and a card with the traits water, lightning, spirit has the element water before and after.
 *   4. The rest does not change: the file changes only elements and element_counters (the old words and looks stay).
 *   5. Everything counters each other: element_counters has the 19 approved pairs (the 6 last ones approved by Nathan, 2026-10-12); every one of the 14 elements is beaten by
 *      and beats at least one element (element_counter_gaps is empty); the primary counters (weak_to) are in the table; a bad pair is refused.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ELEMENT_ALIAS as TAX_ALIAS } from './taxonomy.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/notify pgrst[^\n]*\n/g, '').replace(/-- GUARD \([\s\S]*?-- GUARD-END\n/, '');
const mig1 = strip(rd('../../tcg-bot/supabase/f3_elements_passives.sql'));
let mig2 = strip(rd('../../tcg-bot/supabase/f3_elements_decisions.sql'));
const MUT = {
  air: ["('air', 9, 'lightning')", "'lightning')", "'ice')"],                  // a proposed counter
  metal: ["('metal', 13, 'fire')", "('metal', 13, 'fire')", "('metal', 13, 'fire') /* x */"],   // placeholder replaced below
  pool: ["('toxic', 12, 'earth')", "('toxic', 12, 'earth'),", ''],           // toxic is not in the pool
  order: ["('arcane', 10, 'metal')", "('arcane', 10,", "('arcane', 11,"],    // the order of the new elements (psychic is 11: a duplicate order is refused)
  physglyph: ["('physical', 'Physical', 14", "'💥'", "'x'"],                // the look of physical
  physpool: ["('physical', 'Physical', 14", "'#ffffff')", "'#ffffff', 'fire', true, 14)"],   // physical is in the pool: columns do not fit
  nobeater: ["('psychic', 'physical', false), ", "('psychic', 'physical', false), ", ''],   // nothing beats physical
  approved: ["('lightning', 'air', false)", "false)", "true)"],   // an approved pair is marked as a proposal
  physalias: ["('physical', 'Physical', 14", "array['physical']", "array['physical', 'spirit']"],   // a spirit word
};
delete MUT.metal; delete MUT.physpool;
MUT.physpool = ["on conflict (key) do nothing;", "on conflict (key) do nothing;", "on conflict (key) do nothing;\n  update public.elements set dungeon_foe = true, dungeon_ord = 14, weak_to = 'fire' where key = 'physical';"];   // physical enters the pool
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
  const s = m && mig2.indexOf(m[0]); const i = s >= 0 ? mig2.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the file`);
  mig2 = mig2.slice(0, i) + m[2] + mig2.slice(i + m[1].length);
}
if (['$m$', '$t$', '$j$'].some((x) => mig1.includes(x) || mig2.includes(x))) throw new Error('the files must not contain $m$, $t$ or $j$');

// The client look of physical (attack-fx.js, tokens.js): read from the source, so the table follows the client.
const fx = rd('../../tcg-activity/src/attack-fx.js').match(/physical: \{ c: 0x([0-9a-f]{6}), c2: 0x([0-9a-f]{6}), glyph: '([^']+)'/);
const tok = rd('../../tcg-activity/src/tokens.js').match(/"element-physical": "(#[0-9A-Fa-f]{6})"/);
if (!fx || !tok) throw new Error('the physical look was not found in attack-fx.js or tokens.js');
const PHYS = { glyph: fx[3], color: tok[1].toLowerCase(), color2: '#' + fx[2] };
const PROPOSALS = [['air', 'toxic'], ['arcane', 'psychic'], ['ice', 'nature'], ['physical', 'arcane'], ['psychic', 'physical'], ['toxic', 'water']];   // approved by Nathan, 2026-10-12 (sorted by beater, target)
const NEW5 = ['air', 'arcane', 'psychic', 'toxic', 'metal'];
const POOL13 = ['fire', 'water', 'lightning', 'earth', 'nature', 'ice', 'shadow', 'light', ...NEW5];
const COUNTER = { fire: 'water', water: 'lightning', lightning: 'earth', earth: 'nature', nature: 'fire', ice: 'fire', shadow: 'light', light: 'shadow', air: 'lightning', arcane: 'metal', psychic: 'shadow', toxic: 'earth', metal: 'fire' };
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const arr = (a) => `array[${a.map((e) => `'${e}'`).join(',')}]`;

const body = String.raw`do $t$
declare bad text := ''; r jsonb; before jsonb; after jsonb; i int; fl int; rm int; kd text; x text; n int; c jsonb := ${lit(COUNTER)}; ph jsonb := ${lit(PHYS)}; tax jsonb := ${lit(TAX_ALIAS)};
  e_before text; e_after text;
begin
  create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $f$ begin begin execute p_sql; exception when others then return true; end; return false; end $f$;
  execute $m$${mig1}$m$;
  create function pg_temp.dist() returns jsonb language plpgsql as $f$
  declare out jsonb; begin
    select coalesce(jsonb_object_agg(e, n), '{}') into out from (
      select dungeon_make_foe('tst_ed|' || kd || '|' || fl || '|' || rm || '|' || i, fl, rm, kd)->>'element' e, count(*) n
        from unnest(array['fight', 'elite', 'miniboss', 'guardian']) kd, generate_series(1, 5) fl, generate_series(1, 3) rm, generate_series(1, 100) i group by 1) z;
    return out; end $f$;
  -- the state of the refactor
  update elements set dungeon_foe = false, dungeon_ord = null, weak_to = null where key in ('air', 'arcane', 'psychic', 'toxic', 'metal');
  if to_regclass('public.element_counters') is not null then delete from element_counters; end if;
  update elements set weak_to = null where key = 'physical';
  delete from elements where key = 'physical';
  before := pg_temp.dist();
  e_before := card_element(array['water', 'lightning', 'spirit']);
  execute $m$${mig2}$m$;
  execute $m$${mig2}$m$; -- two times: idempotent
  after := pg_temp.dist();
  e_after := card_element(array['water', 'lightning', 'spirit']);
  ${process.env.REPORT ? "raise exception 'RESULT:%', jsonb_build_object('before', before, 'after', after, 'spirit_before', e_before, 'spirit_after', e_after)::text;" : ''}

  -- ===== 1. The Dungeon pool of 13 and the counters.
  if dungeon_foe_elements() <> ${arr(POOL13)} then bad := bad || '1: the pool is ' || dungeon_foe_elements()::text || '; '; end if;
  for x in select key from elements where key <> 'physical' loop
    if element_weak_to(x) is distinct from (c->>x) then bad := bad || format('1: element_weak_to(%s) = %s, expected %s; ', x, element_weak_to(x), c->>x); end if;
  end loop;
  if (select count(*) from elements) <> 14 then bad := bad || '1: the elements table has not 14 rows; '; end if;
  n := 0;
  for kd in select unnest(array['fight', 'elite', 'miniboss', 'guardian']) loop for fl in 1 .. 5 loop for rm in 1 .. 3 loop for i in 1 .. 100 loop
    r := dungeon_make_foe('tst_ed|' || kd || '|' || fl || '|' || rm || '|' || i, fl, rm, kd);
    if r->'weak'->0->>'value' is distinct from 'trait:' || (c->>(r->>'element')) or r->'resist'->0->>'value' is distinct from 'trait:' || (r->>'element') then n := n + 1; end if;
  end loop; end loop; end loop; end loop;
  if n > 0 then bad := bad || format('1: %s foes have a weakness that is not the counter of their element; ', n); end if;
  if (select count(*) from jsonb_object_keys(after)) <> 13 or after ? 'physical' then bad := bad || '1: the foe elements are not exactly the 13: ' || after::text || '; '; end if;
  if (select count(*) from jsonb_object_keys(before)) <> 8 then bad := bad || '1: before the file the foe pool had not 8 elements: ' || before::text || '; '; end if;

  -- ===== 2. physical.
  if not exists (select 1 from elements e where e.key = 'physical' and e.ord = 14 and e.aliases = array['physical'] and e.weak_to = 'psychic' and not e.dungeon_foe and e.dungeon_ord is null
                   and e.glyph = ph->>'glyph' and e.color = ph->>'color' and e.color2 = ph->>'color2') then
    bad := bad || '2: the physical row is not as the client look: ' || coalesce((select to_jsonb(e)::text from elements e where key = 'physical'), 'no row') || ' ' || ph::text || '; ';
  end if;
  if card_element(array['physical']) is distinct from 'physical' or card_element(array['physical', 'water']) is distinct from 'water' or card_element(array['trait:Physical']) is distinct from 'physical' then
    bad := bad || '2: card_element of physical; ';
  end if;

  -- ===== 3. spirit.
  if element_of('spirit') is not null or element_of('trait:spirit') is not null then bad := bad || '3: spirit is an element word; '; end if;
  if tax ? 'spirit' then bad := bad || '3: the studio taxonomy still maps spirit; '; end if;
  if e_before is distinct from 'water' or e_after is distinct from 'water' then bad := bad || format('3: the element of water, lightning, spirit is %s before and %s after (expected water both); ', e_before, e_after); end if;

  -- ===== 4. The 13 elements keep their words and looks (the file only adds).
  if (select count(*) from element_aliases() where element <> 'physical') <> 43 then bad := bad || '4: the old words changed; '; end if;

  -- ===== 5. Everything counters each other (element_counters).
  if exists (select 1 from element_counter_gaps()) then bad := bad || '5: gaps: ' || (select string_agg(element || ' ' || problem, ', ') from element_counter_gaps()) || '; '; end if;
  if (select count(*) from element_counters) <> 19 or (select count(*) from element_counters where proposal) <> 0 then bad := bad || '5: element_counters has not 19 approved pairs (proposal = false); '; end if;
  if exists (select 1 from elements e where e.key <> 'physical' and not exists (select 1 from element_counters c where c.beater = e.weak_to and c.target = e.key and not c.proposal)) then
    bad := bad || '5: a primary counter (weak_to) of the old 8 or the owner 5 is not an approved pair; ';
  end if;
  if (select jsonb_agg(array[beater, target] order by beater, target) from element_counters where (beater, target) in (('ice', 'nature'), ('air', 'toxic'), ('arcane', 'psychic'), ('psychic', 'physical'), ('toxic', 'water'), ('physical', 'arcane')) and not proposal) is distinct from ${lit(PROPOSALS)} then
    bad := bad || '5: the 6 approved pairs differ: ' || (select jsonb_agg(array[beater, target] order by beater, target) from element_counters where not proposal and (beater, target) in (('ice', 'nature'), ('air', 'toxic'), ('arcane', 'psychic'), ('psychic', 'physical'), ('toxic', 'water'), ('physical', 'arcane')))::text || '; ';
  end if;
  if exists (select 1 from elements e where (select count(*) from element_counters c where c.target = e.key) < 1 or (select count(*) from element_counters c where c.beater = e.key) < 1) then bad := bad || '5: an element is beaten by or beats nobody; '; end if;
  -- a bad pair is refused (an element against itself, a pair twice, an unknown element)
  if not (pg_temp.refused($j$insert into element_counters (beater, target) values ('fire', 'fire')$j$) and pg_temp.refused($j$insert into element_counters (beater, target) values ('water', 'fire')$j$)
          and pg_temp.refused($j$insert into element_counters (beater, target) values ('nowhere', 'fire')$j$)) then bad := bad || '5: a bad pair was not refused; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?|\{[\s\S]*?\})(\nCONTEXT|\\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && (m[1] === 'PASS' || process.env.REPORT) ? 0 : 1);
