/**
 * Acceptance test for tcg-bot/supabase/f3_elements_passives.sql (F-3 PR 2), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-elements-passives.mjs     must PASS (the file is applied twice)
 *   MUTATE=<name> ...                                                                           must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                              runs every mutation, one line each
 * It tests the file's text (MIG=<path> for another file), so it also passes before the file is applied (and after).
 * The old text of spawn_hunt and dungeon_make_foe (the reference copies pg_temp.ref_<name>) is the file's text with every edit of
 * test-elements-passives.edits.json put back (the edits that made the file from the live text of 2026-10-12). The old lists of
 * elements and passives are written in this file (OLD_* below): the oracle, copied from the live functions.
 * Invariants (docs/foundations.md F-3 item 1 and acceptance test 5, "no change in play"):
 *   1. Elements: element_aliases() gives exactly the 13 elements and the 43 words of the old VALUES list, with the same ord;
 *      card_element, element_of and combat_element_map give the old answers for every word, every pair of words, with the
 *      "trait:" prefix, upper case and spaces; the table equals the client copy tcg-activity/src/elements.js (the look, the order and
 *      the words: transitional, until the Activity reads GET /api/elements) and the card studio taxonomy (one recorded
 *      disagreement: none: the owner kept "spirit" out of the element words).
 *   2. Dungeon: the foe pool is the old 8 in the old order, element_weak_to is the old counter map (and NULL for the other 5);
 *      dungeon_make_foe gives the old foe (the same JSON) for 4 kinds x 5 floors x 3 rooms x 40 keys, and every foe element and
 *      every foe passive occurs.
 *   3. Boss: the pools (boss, counter, phase2, foe) and the 11 labels are the old ones; spawn_hunt gives the old boss (name, tier,
 *      weak and resist points, passive, HP, stats) for 90 seeds, and every passive occurs.
 *   4. The callers READ the tables: a new foe element and a new foe passive in the tables appear in dungeon_make_foe; a changed label
 *      appears in spawn_hunt.
 *   5. A bad row is refused (unknown counter, a word of another element, a word twice, an upper case or empty word, a key that is not
 *      its own word, a counter to itself, a foe element with no counter or no order, a second order, a bad color; a passive that is
 *      on no one, a counter passive on a foe, a phase 2 counter passive, params with no number in balance or a wrong shape).
 * The Hunt fights (hunt_attack phase 2 pool and labels) are covered by combat-golden.mjs (CANDIDATE=the file).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ELEMENTS as JS_LOOK, ELEMENT_ORDER as JS_ORDER } from '../../tcg-activity/src/elements.js';
import { ELEMENT_ALIAS as TAX_ALIAS } from './taxonomy.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_elements_passives.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \([\s\S]*?-- GUARD-END\n/, '');
const EDITS = JSON.parse(readFileSync(fileURLToPath(new URL('./test-elements-passives.edits.json', import.meta.url)), 'utf8'));
// Mutations: [an anchor in the file, the text to find after it, the text that replaces it]. Each breaks one mapping.
const MUT = {
  counter: ["('fire', 1, 'water')", "'water')", "'ice')"],                                       // the counter of fire
  dorder: ["('fire', 1, 'water')", "('fire', 1,", "('fire', 9,"],                                // the draw order of the foe pool
  dpool: ["('ice', 6, 'fire')", "('ice', 6, 'fire'),", ''],                                      // ice leaves the foe pool
  alias: ["array['metal','robot'", ",'steel']", "]"],                                            // a word is lost
  eord: ["('psychic',   'Psychic',   11", "11,", "20,"],                                         // the priority of psychic
  glyph: ["('water',     'Water',     2", "'💧'", "'💦'"],                                        // the look differs from elements.js
  label: ["('thorns',       'Thorns:", "comes back to your card'", "comes back'"],              // a label
  passord: ["('armored',      'Armored", " 1,  true, true,", " 20, true, true,"],               // the order of the passives (the random draw maps to another one)
  phase2: ["('flaming',      'Flaming", "true, true,  false, true,", "true, true,  false, false,"], // phase 2 pool
  counterflag: ["('juggernaut',   'Juggernaut", "true, false, true,  false", "true, false, false, false"], // juggernaut is no counter passive any more
  bossmain: ["create or replace function public.passives_for", "p.on_boss and not p.counter", "p.on_boss"], // the main pool takes the counter passives
  foecount: ["passives text[] := public.passives_for('foe');", "cardinality(els) = 0", "cardinality(els) = 99"], // the empty-table guard
  weakto: ["create or replace function public.element_weak_to", "e.weak_to from", "e.key from"], // the reader gives the wrong column
  label_fn: ["create or replace function public.passive_label", "p.label from", "p.key from"],   // the label reader
  cache: ["create trigger elements_cache_refresh", "after insert or update or delete", "after delete"],   // the cache is not rebuilt after a change
  spawn: ["v_main := passives_for('boss')", "passives_for('counter')", "passives_for('foe')"],   // spawn_hunt reads the wrong pool
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(12)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
const sectionOf = (src, name) => { const s = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); if (s < 0) throw new Error(`no ${name} in the file`); const e = src.indexOf('$function$;', s); return [s, e + 11]; };
// The reference copies: built from the UNMUTATED file.
const refs = ['spawn_hunt', 'dungeon_make_foe'].map((name) => {
  const [s, e] = sectionOf(mig, name); let txt = mig.slice(s, e);
  for (const [a, b] of EDITS[name]) { if (!txt.includes(b)) throw new Error(`${name}: the edit is not in the file: ${b.slice(0, 60)}`); txt = txt.replace(b, () => a); }
  return txt.replace(`public.${name}(`, `pg_temp.ref_${name}(`);
}).join('\n\n');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
if (['$m$', '$t$', '$j$'].some((x) => mig.includes(x) || refs.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $j$');

// The oracle: the old lists (db/schema of 2026-10-12: element_aliases, dungeon_make_foe, spawn_hunt, hunt_attack).
const OLD_ALIASES = [['fire', 'fire', 1], ['flame', 'fire', 1], ['burning', 'fire', 1], ['water', 'water', 2], ['aqua', 'water', 2], ['ocean', 'water', 2],
  ['lightning', 'lightning', 3], ['electric', 'lightning', 3], ['thunder', 'lightning', 3], ['ice', 'ice', 4], ['frost', 'ice', 4], ['frozen', 'ice', 4],
  ['nature', 'nature', 5], ['grass', 'nature', 5], ['plant', 'nature', 5], ['wood', 'nature', 5], ['earth', 'earth', 6], ['rock', 'earth', 6], ['stone', 'earth', 6], ['ground', 'earth', 6],
  ['air', 'air', 7], ['wind', 'air', 7], ['flying', 'air', 7], ['shadow', 'shadow', 8], ['dark', 'shadow', 8], ['ghost', 'shadow', 8],
  ['light', 'light', 9], ['holy', 'light', 9], ['radiant', 'light', 9], ['arcane', 'arcane', 10], ['magic', 'arcane', 10], ['fairy', 'arcane', 10], ['mystic', 'arcane', 10],
  ['psychic', 'psychic', 11], ['psi', 'psychic', 11], ['toxic', 'toxic', 12], ['poison', 'toxic', 12], ['venom', 'toxic', 12],
  ['metal', 'metal', 13], ['robot', 'metal', 13], ['mechanical', 'metal', 13], ['tech', 'metal', 13], ['steel', 'metal', 13]];
const OLD_FOE_ELS = ['fire', 'water', 'lightning', 'earth', 'nature', 'ice', 'shadow', 'light'];
const OLD_COUNTER = { fire: 'water', water: 'lightning', lightning: 'earth', earth: 'nature', nature: 'fire', ice: 'fire', shadow: 'light', light: 'shadow' };
const OLD_MAIN = ['armored', 'shrouded', 'flaming', 'volatile', 'regenerating', 'thorns', 'frenzied'];
const OLD_COUNTER_P = ['plague', 'shatterer', 'dispeller', 'juggernaut'];
const OLD_LABELS = { armored: 'Armored: melee attackers deal less', shrouded: 'Shrouded: attacks miss more often', flaming: 'Flaming: burns the attacking card',
  volatile: 'Volatile: counterattacks hit harder', regenerating: 'Regenerating: heals a little every turn', thorns: 'Thorns: part of your damage comes back to your card',
  frenzied: 'Frenzied: hits harder as it loses HP', plague: 'Plague: heals and cleanse barely work', shatterer: 'Shatterer: shields and smite barely work',
  dispeller: 'Dispeller: empower and expose barely work', juggernaut: 'Juggernaut: weaken and stun barely work' };
// The client copy: the words of elements.js (its ELEMENT_ALIAS is not exported: read from the source) and the taxonomy of the card studio.
const jsSrc = readFileSync(fileURLToPath(new URL('../../tcg-activity/src/elements.js', import.meta.url)), 'utf8');
const aliasBlock = jsSrc.slice(jsSrc.indexOf('const ELEMENT_ALIAS = {'), jsSrc.indexOf('};', jsSrc.indexOf('const ELEMENT_ALIAS = {')));
const JS_ALIAS = Object.fromEntries([...aliasBlock.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
const JS_WORDS = JSON.stringify(JS_ALIAS), JS_LOOK_J = JSON.stringify(JS_LOOK), JS_ORDER_J = JSON.stringify(JS_ORDER), TAX_J = JSON.stringify(TAX_ALIAS);
const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;

const body = String.raw`do $t$
declare bad text := ''; r jsonb; r2 jsonb; i int; k int; n int; fl int; rm int; kd text; x text; y text; ids bigint[] := '{}'; h bigint; seen jsonb;
  tags text[]; w text[]; ws text[];
begin
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent (the seed runs only into an empty table)
  execute $m$${refs}$m$;
  -- The owner's decisions (f3_elements_decisions.sql) came later: put the data back to the state of this refactor, so that this test still proves the
  -- refactor (no change in play) and does not depend on which of the two files is applied.
  update elements set dungeon_foe = false, dungeon_ord = null, weak_to = null where key in ('air', 'arcane', 'psychic', 'toxic', 'metal');
  if to_regclass('public.element_counters') is not null then delete from element_counters; end if;
  update elements set weak_to = null where key = 'physical';
  delete from elements where key = 'physical';
  -- the oracle as tables
  create temp table old_alias (alias text, element text, ord int) on commit drop;
  insert into old_alias select (v->>0), (v->>1), (v->>2)::int from jsonb_array_elements(${lit(OLD_ALIASES)}) v;
  create function pg_temp.ref_card_element(p_tags text[]) returns text language sql as $f$
    select a.element from unnest(coalesce(p_tags, '{}'::text[])) t join old_alias a on a.alias = lower(trim(regexp_replace(t, '^trait:', '', 'i'))) order by a.ord limit 1; $f$;
  create function pg_temp.ref_element_of(p_tag text) returns text language sql as $f$
    select a.element from old_alias a where a.alias = lower(trim(regexp_replace(p_tag, '^trait:', '', 'i'))); $f$;

  -- ===== 1. Elements: the same words, order and answers.
  select count(*) into n from old_alias; if n <> 43 then raise exception 'RESULT:FAIL the test oracle has % words, not 43', n; end if;
  if (select count(*) from elements) <> 13 then bad := bad || format('1: the elements table has %s rows, not 13; ', (select count(*) from elements)); end if;
  if exists (select * from element_aliases() except select * from old_alias) or exists (select * from old_alias except select * from element_aliases()) then
    bad := bad || '1: element_aliases() differs from the old list; ';
  end if;
  if (select count(*) from element_aliases()) <> 43 then bad := bad || '1: element_aliases() has not 43 rows; '; end if;
  n := 0;
  for x in select alias from old_alias loop
    foreach y in array array[x, upper(x), ' ' || x || ' ', 'trait:' || x, 'TRAIT:' || upper(x)] loop
      if element_of(y) is distinct from pg_temp.ref_element_of(y) or element_of(y) is null then n := n + 1; end if;
      if card_element(array[y]) is distinct from pg_temp.ref_card_element(array[y]) then n := n + 1; end if;
    end loop;
  end loop;
  if n > 0 then bad := bad || format('1: element_of / card_element differ from the old answer %s times for single words; ', n); end if;
  -- every pair of words (the priority ord decides), and noise words
  select array_agg(alias order by alias) into w from old_alias; n := 0;
  for i in 1 .. array_length(w, 1) loop for k in i .. array_length(w, 1) loop
    tags := array['origin:smash', 'trait:' || w[i], 'trait:melee', w[k]];
    if card_element(tags) is distinct from pg_temp.ref_card_element(tags) or card_element(tags) is null then n := n + 1; end if;
  end loop; end loop;
  if n > 0 then bad := bad || format('1: card_element differs from the old answer for %s pairs of words; ', n); end if;
  if card_element(array['trait:melee', 'origin:x']) is not null or element_of('nothing') is not null or card_element(null) is not null then bad := bad || '1: a non-element word gave an element; '; end if;
  r := combat_element_map();
  if r->'canon' is distinct from (select jsonb_agg(distinct element) from old_alias)
     or r->'alias' is distinct from (select jsonb_object_agg(alias, jsonb_build_array(element, ord)) from old_alias) then bad := bad || '1: combat_element_map differs from the old map; '; end if;
  -- combat_card_facts: the element, the list and the kinds of some tag sets
  for i in 1 .. 60 loop
    tags := array['origin:smash', 'trait:' || w[1 + (i * 7) % array_length(w, 1)], 'trait:' || w[1 + (i * 11) % array_length(w, 1)], 'trait:melee', 'trait:beast'];
    r := combat_card_facts(tags, array['trait:melee']);
    if r->>'elem' is distinct from pg_temp.ref_card_element(tags) then bad := bad || format('1: combat_card_facts elem for %s; ', tags); exit; end if;
    if (select coalesce(jsonb_agg(distinct jx.v), '[]') from jsonb_array_elements_text(r->'els') jx(v))
       is distinct from (select coalesce(jsonb_agg(distinct pg_temp.ref_element_of(t)), '[]') from unnest(tags) t where pg_temp.ref_element_of(t) is not null) then
      bad := bad || format('1: combat_card_facts els for %s; ', tags); exit;
    end if;
    if r->'kinds' is distinct from (select coalesce(jsonb_agg(t order by o), '[]') from unnest(tags) with ordinality u(t, o)
                                      where t like 'trait:%' and substr(t, 7) not in (select distinct element from old_alias)) then
      bad := bad || format('1: combat_card_facts kinds for %s: %s; ', tags, r->'kinds'); exit;
    end if;
  end loop;
  -- the client copy (elements.js): the look, the order and the words
  seen := ${lit(JSON.parse(JS_LOOK_J))};
  r := ${lit(JSON.parse(JS_ORDER_J))};
  for i in 0 .. jsonb_array_length(r) - 1 loop
    if not exists (select 1 from elements e where e.key = r->>i and e.ord = i + 1 and e.name = seen->(r->>i)->>'name' and e.glyph = seen->(r->>i)->>'glyph'
                     and e.color = seen->(r->>i)->>'color' and e.color2 = seen->(r->>i)->>'color2') then bad := bad || format('1: elements.js differs from the table for %s; ', r->>i); end if;
  end loop;
  if jsonb_array_length(r) <> (select count(*) from elements) then bad := bad || '1: elements.js has another number of elements; '; end if;
  r := ${lit(JSON.parse(JS_WORDS))};
  if exists (select 1 from jsonb_each_text(r) j where not exists (select 1 from element_aliases() a where a.alias = j.key and a.element = j.value))
     or (select count(*) from jsonb_object_keys(r)) <> (select count(*) from element_aliases()) then bad := bad || '1: the words of elements.js differ from the table; '; end if;
  -- the card studio taxonomy: the table plus the one recorded disagreement
  r := ${lit(JSON.parse(TAX_J))};
  if (select jsonb_object_agg(a.alias, a.element) from element_aliases() a) is distinct from r then
    bad := bad || '1: card-studio/scripts/taxonomy.mjs ELEMENT_ALIAS is not the table: ' || r::text || '; ';
  end if;

  -- ===== 2. The Dungeon: the pool, the counter map and the foes.
  if dungeon_foe_elements() <> ${`array[${OLD_FOE_ELS.map((e) => `'${e}'`).join(',')}]`} then bad := bad || '2: the foe pool or its order differs: ' || dungeon_foe_elements()::text || '; '; end if;
  r := ${lit(OLD_COUNTER)};
  for x in select key from elements loop
    if element_weak_to(x) is distinct from (r->>x) then bad := bad || format('2: element_weak_to(%s) = %s, the old counter %s; ', x, element_weak_to(x), r->>x); end if;
  end loop;
  seen := '{}'; n := 0;
  foreach kd in array array['fight', 'elite', 'miniboss', 'guardian'] loop
    for fl in 1 .. 5 loop for rm in 1 .. 3 loop for i in 1 .. 40 loop
      x := 'tst_ep|' || kd || '|' || fl || '|' || rm || '|' || i;
      r := dungeon_make_foe(x, fl, rm, kd);
      if r is distinct from pg_temp.ref_dungeon_make_foe(x, fl, rm, kd) then n := n + 1; if n <= 2 then bad := bad || format('2: dungeon_make_foe(%s) %s, the old %s; ', x, r, pg_temp.ref_dungeon_make_foe(x, fl, rm, kd)); end if; end if;
      seen := seen || jsonb_build_object('e:' || (r->>'element'), true);
      for y in select jsonb_array_elements_text(r->'passives') loop seen := seen || jsonb_build_object('p:' || y, true); end loop;
    end loop; end loop; end loop;
  end loop;
  if n > 0 then bad := bad || format('2: dungeon_make_foe differs from the old foe %s times; ', n); end if;
  foreach x in array array['e:fire', 'e:water', 'e:lightning', 'e:earth', 'e:nature', 'e:ice', 'e:shadow', 'e:light', 'p:armored', 'p:shrouded', 'p:flaming', 'p:volatile', 'p:regenerating', 'p:thorns', 'p:frenzied'] loop
    if not seen ? x then bad := bad || format('2: the test never made a foe with %s; ', x); end if;
  end loop;
  if (select count(*) from jsonb_object_keys(seen)) <> 15 then bad := bad || '2: a foe had an element or passive outside the old lists: ' || seen::text || '; '; end if;

  -- ===== 3. The boss: the pools, the labels and spawn_hunt.
  if passives_for('boss') <> ${`array[${OLD_MAIN.map((e) => `'${e}'`).join(',')}]`} or passives_for('foe') <> passives_for('boss') or passives_for('phase2') <> passives_for('boss')
     or passives_for('counter') <> ${`array[${OLD_COUNTER_P.map((e) => `'${e}'`).join(',')}]`} then
    bad := bad || '3: a passive pool differs from the old list: ' || jsonb_build_object('boss', passives_for('boss'), 'counter', passives_for('counter'), 'phase2', passives_for('phase2'), 'foe', passives_for('foe'))::text || '; ';
  end if;
  r := ${lit(OLD_LABELS)};
  if (select count(*) from passives) <> 11 then bad := bad || '3: the passives table has not 11 rows; '; end if;
  for x in select jsonb_object_keys(r) loop
    if passive_label(x) is distinct from r->>x then bad := bad || format('3: passive_label(%s) = %s; ', x, passive_label(x)); end if;
  end loop;
  -- every number a passive names is in balance (the trigger checks it on write; here on the seed)
  if exists (select 1 from passives p, jsonb_array_elements_text(p.params->'keys') l where not (balance_get(p.params->>'balance') ? l)) then bad := bad || '3: a passive names a number that balance has not; '; end if;
  seen := '{}'; n := 0;
  for i in 1 .. 90 loop
    kd := (array['Normal', 'Heroic', 'Mythic', null])[1 + i % 4];
    perform setseed((i % 45 + 1) / 50.0 - 0.5);
    h := spawn_hunt(3, kd);
    select jsonb_build_object('name', name, 'tier', tier, 'weak', weak_points, 'resist', resist_points, 'passive', passive, 'hp', hp_max, 'hp_left', hp_remaining, 'share', hp_share, 'stats', stats) into r from hunts where id = h;
    delete from hunts where id = h;
    perform setseed((i % 45 + 1) / 50.0 - 0.5);
    h := pg_temp.ref_spawn_hunt(3, kd);
    select jsonb_build_object('name', name, 'tier', tier, 'weak', weak_points, 'resist', resist_points, 'passive', passive, 'hp', hp_max, 'hp_left', hp_remaining, 'share', hp_share, 'stats', stats) into r2 from hunts where id = h;
    delete from hunts where id = h;
    if r is distinct from r2 then n := n + 1; if n <= 2 then bad := bad || format('3: spawn_hunt seed %s %s, the old %s; ', i, r, r2); end if; end if;
    for y in select e->>'kind' from jsonb_array_elements(r->'passive'->'list') e loop seen := seen || jsonb_build_object(y, true); end loop;
  end loop;
  if n > 0 then bad := bad || format('3: spawn_hunt differs from the old boss %s times; ', n); end if;
  if (select count(*) from jsonb_object_keys(seen)) <> 11 then bad := bad || '3: the 90 spawns did not show all 11 passives: ' || seen::text || '; '; end if;

  -- ===== 4. The callers read the tables.
  insert into elements (key, name, ord, aliases, glyph, color, color2, weak_to, dungeon_foe, dungeon_ord) values ('tstel', 'Tstel', 40, array['tstel', 'tstword'], 'T', '#010203', '#040506', 'fire', true, 40);
  insert into passives (key, label, ord, on_boss, on_foe, params) values ('tstpass', 'Tstpass: a test passive', 40, true, true, '{"balance": "boss_passives", "keys": ["thorns"]}');
  seen := '{}';
  for i in 1 .. 300 loop
    r := dungeon_make_foe('tst_ep|new|' || i, 2, 1, 'elite');
    seen := seen || jsonb_build_object('e:' || (r->>'element'), true);
    if r->>'element' = 'tstel' and r->'weak'->0->>'value' <> 'trait:fire' then bad := bad || '4: the new element has not its counter in the foe; '; end if;
    for y in select jsonb_array_elements_text(r->'passives') loop seen := seen || jsonb_build_object('p:' || y, true); end loop;
  end loop;
  if not seen ? 'e:tstel' or not seen ? 'p:tstpass' then bad := bad || '4: a new foe element or passive in the tables never reached dungeon_make_foe; '; end if;
  if card_element(array['trait:tstword']) is distinct from 'tstel' then bad := bad || '4: a new element word is not read by card_element; '; end if;
  if not (combat_element_map()->'alias' ? 'tstword') or combat_card_facts(array['trait:tstword'], '{}')->>'elem' is distinct from 'tstel' then bad := bad || '4: a new element word is not in combat_element_map / combat_card_facts (the cache); '; end if;
  update passives set label = 'Armored: changed' where key = 'armored';
  n := 0;
  for i in 1 .. 40 loop
    perform setseed(i / 100.0); h := spawn_hunt(3, 'Mythic');
    if exists (select 1 from hunts where id = h and passive->'list' @> '[{"kind": "armored", "label": "Armored: changed"}]') then n := n + 1; end if;
    delete from hunts where id = h;
  end loop;
  if n = 0 then bad := bad || '4: a changed label never reached spawn_hunt; '; end if;

  -- ===== 5. A bad row is refused.
  create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $f$
  begin begin execute p_sql; exception when others then return true; end; return false; end $f$;
  foreach x in array array[
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2, weak_to) values ('tstb1', 'B', 20, array['tstb1'], 'x', '#000000', '#000000', 'nowhere')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstb2', 'B', 21, array['tstb2', 'flame'], 'x', '#000000', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstb3', 'B', 22, array['tstb3', 'tstb3'], 'x', '#000000', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstb4', 'B', 23, array['tstb4', 'Upper'], 'x', '#000000', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstb5', 'B', 24, array['tstb5', ''], 'x', '#000000', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstb6', 'B', 25, array['other'], 'x', '#000000', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2, weak_to) values ('tstb7', 'B', 26, array['tstb7'], 'x', '#000000', '#000000', 'tstb7')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2, dungeon_foe, dungeon_ord) values ('tstb8', 'B', 27, array['tstb8'], 'x', '#000000', '#000000', true, 10)$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2, weak_to, dungeon_foe) values ('tstb9', 'B', 28, array['tstb9'], 'x', '#000000', '#000000', 'fire', true)$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2, weak_to, dungeon_foe, dungeon_ord) values ('tstc1', 'B', 29, array['tstc1'], 'x', '#000000', '#000000', 'fire', true, 1)$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstc2', 'B', 30, array['tstc2'], 'x', 'red', '#000000')$j$,
    $j$insert into elements (key, name, ord, aliases, glyph, color, color2) values ('tstc3', 'B', 1, array['tstc3'], 'x', '#000000', '#000000')$j$,
    $j$update elements set aliases = aliases || array['aqua'] where key = 'fire'$j$,
    $j$insert into passives (key, label, ord, on_foe, counter, params) values ('tstp1', 'P', 20, true, true, '{}')$j$,
    $j$insert into passives (key, label, ord, params) values ('tstp2', 'P', 21, '{}')$j$,
    $j$insert into passives (key, label, ord, on_boss, counter, phase2) values ('tstp3', 'P', 22, true, true, true)$j$,
    $j$insert into passives (key, label, ord, on_boss, params) values ('tstp4', 'P', 23, true, '{"balance": "boss_passives", "keys": ["no_such_number"]}')$j$,
    $j$insert into passives (key, label, ord, on_boss, params) values ('tstp5', 'P', 24, true, '{"balance": "no_such_row", "keys": ["thorns"]}')$j$,
    $j$insert into passives (key, label, ord, on_boss, params) values ('tstp6', 'P', 25, true, '{"thorns": 1}')$j$,
    $j$insert into passives (key, label, ord, on_boss) values ('Bad Key', 'P', 26, true)$j$,
    $j$insert into passives (key, label, ord, on_boss) values ('tstp7', 'P', 1, true)$j$,
    $j$select passives_for('nothing')$j$
  ] loop
    n := n + 1;
    if not pg_temp.refused(x) then bad := bad || format('5: a bad row was NOT refused: %s; ', left(x, 90)); end if;
  end loop;

  -- an empty pool is an error, never a silent default (dungeon_make_foe)
  update elements set dungeon_foe = false, dungeon_ord = null;
  if not pg_temp.refused($j$select dungeon_make_foe('tst_ep|empty', 1, 1, 'elite')$j$) then bad := bad || '5: dungeon_make_foe made a foe with no foe element in the table; '; end if;
  update elements set dungeon_foe = true, dungeon_ord = 1 where key = 'fire';
  update passives set on_foe = false;
  if not pg_temp.refused($j$select dungeon_make_foe('tst_ep|empty', 1, 1, 'elite')$j$) then bad := bad || '5: dungeon_make_foe made a foe with no foe passive in the table; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
