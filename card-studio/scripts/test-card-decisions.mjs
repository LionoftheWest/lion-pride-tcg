/**
 * Acceptance test for tcg-bot/supabase/card_decisions.sql (Nathan's decisions, 2026-10-07). Rolled back (the result
 * comes back in the exception), test members only, on a PRIVATE test boss row (never the live boss):
 *   node scripts/test-card-decisions.mjs              the migration file, executed inside the block
 *   node scripts/test-card-decisions.mjs --old        the database as it is (the baseline: it must FAIL before the file)
 *   node scripts/test-card-decisions.mjs --mutations  each mutation of the file must make at least one case FAIL
 * Invariants:
 *   T1 every subject has a type (252 = Item), a subject with no type is refused, and a no-type card cannot attack
 *   T2 one rarity order: rarity_rank = shared/rarity-rank.json for every rarity, and playing_today picks the best new
 *      card by it (an Event beats a Secret Rare, a Promo beats an Illustrated Rare)
 *   T3 one element list: every alias of the client (tcg-activity/src/elements.js) maps to the same element in SQL, the
 *      order is the same, every subject gets the same element in SQL and in the client, and ach_has_element agrees;
 *      subject 104 (trait robot) is a Metal card in combat: a Metal attacker with it in the squad gets the Metal
 *      synergy (3 cards), and the trait synergy is the same as before
 *   T4 every pack_ledger row has ref_kind + ref_id: a row without a ref is refused by pack_ledger_ref_check
 *   T5 a re-run of the file (and of balance_table.sql, which pins combat_squad) changes nothing
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const OLD = process.argv.includes('--old');
const src = readFileSync(root('tcg-bot/supabase/card_decisions.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const balanceTable = readFileSync(root('tcg-bot/supabase/balance_table.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
for (const s of [src, balanceTable]) if (s.includes("$m$") || s.includes("$cdt$")) throw new Error('a migration must not contain $m$');
const GOLDEN = JSON.parse(readFileSync(root('shared/rarity-rank.json'), 'utf8')).rank;

// The client copy of the element rule (read only: another session owns tcg-activity/src/).
const elementsPath = root('tcg-activity/src/elements.js');
const { cardElement, ELEMENT_ORDER } = await import(pathToFileURL(elementsPath).href);
const aliasBlock = readFileSync(elementsPath, 'utf8').match(/const ELEMENT_ALIAS = \{([\s\S]*?)\};/)[1];
const CLIENT_ALIAS = Object.fromEntries([...aliasBlock.matchAll(/([a-z]+): '([a-z]+)'/g)].map((m) => [m[1], m[2]]));

// One mutation per mechanism: a text of the file and its broken form.
const MUTATIONS = {
  'T3 no robot alias': ["('metal', 'metal', 13), ('robot', 'metal', 13),", "('metal', 'metal', 13),"],
  'T3 others matched by exact name': ['where exists (select 1 from jsonb_array_elements_text(o) t where public.element_of(t) = v_elem);', "where o ? ('trait:' || v_elem);"],
  'T3 the highest ord wins': ['   order by a.ord limit 1;', '   order by a.ord desc limit 1;'],
  'T3 the trait synergy skips the aliases too': ["tg not in (select 'trait:' || a.element from public.element_aliases() a)", "tg not in (select 'trait:' || a.alias from public.element_aliases() a)"],
  'T2 playing_today keeps its own order': ['order by public.rarity_rank(c.rarity::text) desc, pc.first_obtained_at desc', "order by case c.rarity::text when 'gold' then 4 when 'full_art' then 3 when 'secret_rare' then 2 when 'illustrated_rare' then 1 else 0 end desc, pc.first_obtained_at desc"],
  'T1 no NOT NULL': ['alter table public.subjects alter column type set not null;', ''],
  'T4 no ref check': ['alter table public.pack_ledger add constraint pack_ledger_ref_check check (ref_kind is not null and ref_id is not null);', 'null;'],
};

const P = 'tst_cd_a', B = 'tst_cd_b', C = 'tst_cd_c';
const body = (mig, rerun) => String.raw`do $cdt$
declare res jsonb := '[]'; data jsonb := '{}'; h bigint; r jsonb; r1 jsonb; r2 jsonb; r3 jsonb; ok boolean; m1 text; m2 text;
  rob bigint := 39; mega bigint := 123; red bigint := 82; deez bigint; c1 bigint; c2 bigint; pr bigint; sid bigint; err text;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}', 'tst cd a'), ('${B}', 'tst cd b'), ('${C}', 'tst cd c');

  -- T1 the type ------------------------------------------------------------------------------------------
  res := res || jsonb_build_object('case', 'T1 subject 252 (DEEZ NUTZ) is an Item, and no subject has no type', 'ok',
    (select type from subjects where id = 252) is not distinct from 'Item' and not exists (select 1 from subjects where type is null),
    'nulls', (select jsonb_agg(id) from subjects where type is null));
  begin
    insert into subjects (key, name) values ('tst-cd-notype', 'tst no type');
    ok := false; err := 'accepted';
  exception when not_null_violation then ok := true; err := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'T1 a new subject with no type is refused (NOT NULL)', 'ok', ok, 'err', err);

  -- A private boss and a squad: Rob (metal, robot), Megaman (metal, robot), Redstone Machine (Item, trait robot only)
  -- and DEEZ NUTZ (Item).
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Card Decisions Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into h;
  select id into deez from cards where subject_id = 252 and rarity = 'normal';
  insert into player_cards (player_id, card_id, quantity) select '${P}', x, 1 from unnest(array[rob, mega, red, deez]) x;
  ${GATE(P)}
  r := lock_hunt_squad('${P}', h, array[rob, mega, red, deez]);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'squad lock refused: %', r; end if;
  r := hunt_attack('${P}', h, deez);
  res := res || jsonb_build_object('case', 'T1 a DEEZ NUTZ card (Item) cannot attack', 'ok', r->>'error' is not distinct from 'not_attacker', 'r', r);

  -- T3 subject 104 in combat ----------------------------------------------------------------------------
  perform setseed(0.42);   -- a fixed fight: the boss turn could knock Megaman out, and the heal then failed (target_downed)
  r1 := hunt_attack('${P}', h, mega);                 -- Megaman fights (it is in the fight now)
  r2 := hunt_support('${P}', h, red, mega);           -- the Redstone Machine heals Megaman (it is in the fight now)
  r3 := hunt_attack('${P}', h, rob);                  -- Rob: the other cards of the fight are Megaman + the Machine
  res := res || jsonb_build_object('case', 'T3 subject 104 (trait robot) counts as Metal: Rob gets the Metal synergy of 3 cards', 'ok',
    coalesce((r1->>'ok')::boolean and (r2->>'ok')::boolean and r3->'synergy' = '{"element": "metal", "count": 3}'::jsonb, false),
    'attack1', r1->>'error', 'support', r2->>'error', 'synergy', r3->'synergy', 'r3', r3);
  begin
    r := combat_squad((select tag_slugs from subjects where id = 104), true, '[]'::jsonb, '[]'::jsonb);
    res := res || jsonb_build_object('case', 'T3 combat_squad: the element of subject 104 is metal', 'ok', r->>'elem' is not distinct from 'metal', 'r', r);
    -- The trait synergy is as before: Rob shares 'robot' with both (3 cards = trait_small), and the element synergy
    -- is now metal x 3 (element_small): synmult = element_small x trait_small.
    r := combat_squad((select tag_slugs from subjects where id = 40), true,
           (select jsonb_agg(to_jsonb(tag_slugs)) from subjects where id in (127, 104)), '[]'::jsonb);
    res := res || jsonb_build_object('case', 'T3 the trait synergy is unchanged: Rob + Megaman + Machine = element_small x trait_small', 'ok',
      (r->>'synmult')::numeric = least(balance_num('combat', 'syn_cap'), balance_num('combat', 'element_small') * balance_num('combat', 'trait_small')), 'r', r);
  exception when others then res := res || jsonb_build_object('case', 'T3 combat_squad', 'ok', false, 'err', sqlerrm);
  end;
  -- The data for the client comparison (in Node): the SQL alias list and the element of every subject.
  begin
    data := jsonb_build_object(
      'aliases', (select jsonb_agg(jsonb_build_array(a.alias, a.element, a.ord) order by a.ord, a.alias) from element_aliases() a),
      'of', (select jsonb_object_agg(x, element_of(x)) from unnest(string_to_array('${Object.keys(CLIENT_ALIAS).join(',')}', ',')) x),
      'slug', jsonb_build_object('trait:robot', element_of('trait:robot'), 'origin:fire', element_of('origin:fire'), 'Robot', element_of(' Robot ')),
      'subjects', (select jsonb_agg(jsonb_build_array(s.id, s.tags, card_element(s.tag_slugs), ach_has_element(s.tags)) order by s.id) from subjects s));
  exception when others then data := jsonb_build_object('error', sqlerrm);
  end;

  -- T2 the rarity order ---------------------------------------------------------------------------------
  begin
    res := res || jsonb_build_object('case', 'T2 rarity_rank = shared/rarity-rank.json for every rarity of the enum', 'ok',
      (select bool_and(rarity_rank(e::text) is not distinct from ('${JSON.stringify(GOLDEN)}'::jsonb->>e::text)::int) from unnest(enum_range(null::card_rarity)) e)
      and (select count(*) from jsonb_object_keys('${JSON.stringify(GOLDEN)}'::jsonb)) = cardinality(enum_range(null::card_rarity)),
      'sql', (select jsonb_object_agg(e::text, rarity_rank(e::text)) from unnest(enum_range(null::card_rarity)) e));
  end;
  select id into c1 from cards where rarity = 'event' order by id limit 1;
  select id into c2 from cards where rarity = 'secret_rare' order by id limit 1;
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values ('${B}', c1, 1, now() - interval '1 minute'), ('${B}', c2, 1, now());
  r := playing_today('${B}');
  res := res || jsonb_build_object('case', 'T2 playing_today: an Event beats a newer Secret Rare', 'ok', (r->'best'->>'id')::bigint is not distinct from c1, 'best', r->'best');
  insert into subjects (key, name, type) values ('tst-cd-promo', 'tst promo', 'Moment') returning id into sid;
  insert into cards (subject_id, name, rarity) values (sid, 'tst Promo', 'promo') returning id into pr;
  select id into c2 from cards where rarity = 'illustrated_rare' order by id limit 1;
  insert into player_cards (player_id, card_id, quantity, first_obtained_at) values ('${C}', pr, 1, now() - interval '1 minute'), ('${C}', c2, 1, now());
  r := playing_today('${C}');
  res := res || jsonb_build_object('case', 'T2 playing_today: a Promo beats a newer Illustrated Rare', 'ok', (r->'best'->>'id')::bigint is not distinct from pr, 'best', r->'best');

  -- T4 the pack ref --------------------------------------------------------------------------------------
  res := res || jsonb_build_object('case', 'T4 pack_ledger_ref_check exists, is validated, and 0 rows break it', 'ok',
    exists (select 1 from pg_constraint where conrelid = 'public.pack_ledger'::regclass and conname = 'pack_ledger_ref_check' and convalidated)
    and not exists (select 1 from pack_ledger where ref_kind is null or ref_id is null));
  begin
    insert into pack_ledger (player_id, amount, reason) values ('${P}', 1, 'admin');
    ok := false; err := 'accepted';
  exception when check_violation then ok := sqlerrm like '%pack_ledger_ref_check%'; err := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'T4 a pack row with no ref is refused by pack_ledger_ref_check', 'ok', ok, 'err', err);
  begin
    perform grant_packs('${P}', 1, 'admin', null);
    ok := false; err := 'accepted';
  exception when check_violation then ok := sqlerrm like '%pack_ledger_ref_check%'; err := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'T4 grant_packs with no ref is refused too', 'ok', ok, 'err', err);
  begin
    perform grant_packs('${P}', 1, 'admin', null, 'test', 'card-decisions');
    ok := true; err := null;
  exception when others then ok := false; err := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'T4 a pack row with a ref is accepted', 'ok', ok, 'err', err);

  -- T5 a re-run changes nothing -------------------------------------------------------------------------
  ${rerun ? String.raw`select md5(string_agg(md5(replace(pg_get_functiondef(p.oid), chr(13), '')), ',' order by p.proname)) into m1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_squad', 'ach_has_element', 'playing_today', 'element_aliases', 'element_of', 'card_element');
  execute $m$${mig}$m$;
  execute $m$${balanceTable}$m$;
  select md5(string_agg(md5(replace(pg_get_functiondef(p.oid), chr(13), '')), ',' order by p.proname)) into m2 from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('combat_squad', 'ach_has_element', 'playing_today', 'element_aliases', 'element_of', 'card_element');
  res := res || jsonb_build_object('case', 'T5 a re-run of the file and of balance_table.sql leaves the 6 functions identical', 'ok', m1 = m2);` : '-- (no re-run)'}

  raise exception 'RESULTS %', jsonb_build_object('res', res, 'data', data);
end $cdt$;`;

async function run(mig, rerun) {
  const out = await q(body(mig, rerun));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = String(msg).match(/RESULTS (\{.*\})/);   // one line: jsonb text has no newline
  if (!m) return { error: String(msg).slice(0, 2000) };
  const j = JSON.parse(m[1]);
  const results = j.res;
  const d = j.data || {};
  // Node side: the client copy against SQL.
  if (d.error || !d.aliases) {
    results.push({ case: 'T3 the SQL element list exists', ok: false, err: d.error });
  } else {
    const sqlMap = Object.fromEntries(d.aliases.map(([a, e]) => [a, e]));
    const badAlias = Object.entries(CLIENT_ALIAS).filter(([a, e]) => sqlMap[a] !== e || d.of[a] !== e || cardElement([a]) !== e);
    const extra = Object.keys(sqlMap).filter((a) => !(a in CLIENT_ALIAS));
    results.push({ case: `T3 every client alias (${Object.keys(CLIENT_ALIAS).length}) maps to the same element in SQL, and SQL has no other alias`, ok: badAlias.length === 0 && extra.length === 0 && Object.keys(CLIENT_ALIAS).length >= 43, badAlias, extra });
    const sqlOrder = [...new Map(d.aliases.map(([, e, o]) => [e, o])).entries()].sort((x, y) => x[1] - y[1]).map(([e]) => e);
    results.push({ case: 'T3 the element order is the client ELEMENT_ORDER', ok: JSON.stringify(sqlOrder) === JSON.stringify(ELEMENT_ORDER), sqlOrder });
    results.push({ case: 'T3 element_of reads trait slugs and bare traits, and no other facet', ok: d.slug['trait:robot'] === 'metal' && d.slug['origin:fire'] === null && d.slug.Robot === 'metal', slug: d.slug });
    const badSub = d.subjects.filter(([, tags, el, ach]) => (cardElement(tags) ?? null) !== el || (cardElement(tags) !== null) !== ach);
    results.push({ case: `T3 every subject (${d.subjects.length}) has the same element in SQL (card_element) and in the client (cardElement), and ach_has_element agrees`, ok: badSub.length === 0 && d.subjects.length > 100, bad: badSub.slice(0, 5) });
    const s104 = d.subjects.find(([id]) => id === 104);
    results.push({ case: 'T3 subject 104 (trait robot) is metal in SQL and in the client', ok: s104 && s104[2] === 'metal' && cardElement(s104[1]) === 'metal', s104 });
  }
  return { results };
}

const print = (results) => {
  let fail = 0;
  for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`); }
  return fail;
};

if (process.argv.includes('--mutations')) {
  let caught = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": its text is not in the file once`); process.exitCode = 1; continue; }
    const r = await run(src.replace(a, () => b), false);
    const failed = r.error ? ['(the block failed: ' + r.error.slice(0, 160) + ')'] : r.results.filter((x) => !x.ok).map((x) => x.case);
    if (failed.length) caught++;
    console.log(`${failed.length ? 'caught' : 'MISSED'}  ${name}: ${failed.slice(0, 3).join(' | ')}`);
  }
  console.log(`${caught}/${Object.keys(MUTATIONS).length} mutations caught`);
  if (caught !== Object.keys(MUTATIONS).length) process.exitCode = 1;
} else {
  const r = await run(OLD ? '' : src, !OLD);
  if (r.error) { console.log('NO RESULTS:', r.error); process.exit(1); }
  const fail = print(r.results);
  console.log(fail ? `${fail} of ${r.results.length} FAILED` : `PASS all ${r.results.length}`);
  process.exitCode = fail ? 1 : 0;
}
console.log('after:', await q(`select (select count(*) from players where id like 'tst_cd_%') test_players, (select count(*) from hunts where name = 'Test Card Decisions Boss') test_bosses`));
