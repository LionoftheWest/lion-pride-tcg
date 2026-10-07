/**
 * Acceptance test for tcg-bot/supabase/card_sets.sql (D-80 to D-84). Rolled back (the result comes back in
 * the exception), test rows only:
 *   node scripts/test-card-sets.mjs          the migration file, executed inside the block
 *   node scripts/test-card-sets.mjs --live   the database as it is (after the migration is applied)
 *   node scripts/test-card-sets.mjs --old    the database before the migration: FAILS
 *   MUTATE=<name> node scripts/test-card-sets.mjs   one broken mechanism: must FAIL
 * Invariants:
 *   - the stored set numbers are the numbers the browser shows today (ui-v2.js mergedCards, run here on
 *     the catalog order of the API), for every card: 0 differences;
 *   - set numbers are unique, fixed, never given twice, and a second run of the file changes none;
 *   - cards.season always equals the set name;
 *   - an open with a set takes only cards of that set, only from a pullable set, and the ledger records it;
 *   - an open with no set is unchanged (3-argument open_packs; draw_pool = the old pool while S1 is the only set);
 *   - the reward draws (dungeon_card_of, shop_pick_stock) give cards of every pullable
 *     set and never of a set that is not pullable;
 *   - pullable_sets() lists the pullable sets with their counts, in one SQL statement for any number of sets;
 *   - D-85 last_set = the set the member opened last (still pullable), else the newest pullable set;
 *   - D-86 a set's cover is a card of that set (another set's card is refused; the cover cannot move set);
 *   - D-89 is_new only on the newest pullable set, and only when there are 2 or more;
 *   - D-90 pack_color is required and #rrggbb (S1 = #ff8d4d), pack_art_url is returned.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old'), LIVE = process.argv.includes('--live');

// The browser's own numbering code (tcg-activity/src/ui-v2.js mergedCards), taken from the file, so this test
// follows any change to it.
const uiSrc = readFileSync(fileURLToPath(new URL('../../tcg-activity/src/ui-v2.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const mergedSrc = uiSrc.match(/export function mergedCards\([\s\S]*?\n}\n/)?.[0];
if (!mergedSrc) throw new Error('mergedCards not found in ui-v2.js');
const browserNumbers = (catalog) => new Function('ctx', `${mergedSrc.replace('export ', '')}\nreturn mergedCards();`)(
  { cache: { catalog: { cards: catalog }, collection: { cards: [] } } });

// Mutations: a migration text change (before it runs), function changes (fixtures.mjs) and SQL changes.
const MIG_MUT = { backfillorder: ['over (partition by c.set_id order by c.id)', 'over (partition by c.set_id order by c.name)'] };
let mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/card_sets.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');
const FN_MUT = {
  opennosetcheck: ['public.open_packs(text,bigint[],integer,text)', 'd.id = x.id and d.set_id = p_set', 'd.id = x.id'],
  opennopullable: ['public.open_packs(text,bigint[],integer,text)', 'where id = p_set and pullable)', 'where id = p_set)'],
  ledgernoset: ['public.open_packs(text,bigint[],integer,text)', "'open', v_open, p_set", "'open', v_open, null"],
  dungeonold: ['public.dungeon_card_of(text)', 'from draw_pool where', "from cards where source::text = 'draw' and in_draw_pool and"],
  shopold: ['public.shop_pick_stock(date)', 'from draw_pool c', 'from cards c'],
  numberreuse: ['public.cards_set_rules()', 'update card_sets set last_number = last_number + 1 where id = new.set_id returning last_number into new.set_number;',
    'select coalesce(max(set_number), 0) + 1 into new.set_number from cards where set_id = new.set_id;'],
  numberedit: ['public.cards_set_rules()', "raise exception 'cards: the set number of card % is fixed (% -> %)', old.id, old.set_number, new.set_number using errcode = 'check_violation';", 'null;'],
  seasondrift: ['public.cards_set_rules()', 'new.season := coalesce((select name from card_sets where id = new.set_id), new.season);', 'null;'],
  setsall: ['public.pullable_sets(text)', 'with s as (select * from card_sets where pullable)', 'with s as (select * from card_sets)'],
  lastsetnowrite: ['public.open_packs(text,bigint[],integer,text)', ', last_open_set = p_set where', ' where'],
  lastsetnofallback: ['public.pullable_sets(text)', '(select id from newest)));', 'null));'],
  isnewall: ['public.pullable_sets(text)', "'is_new', s.id = (select id from newest) and (select count(*) from s) > 1", "'is_new', s.id = (select id from newest)"],
  open3changed: ['public.open_packs(text,bigint[],integer)', 'if v_n <= 0 then return 0; end if;', 'if v_n <= 0 then return 0; end if; -- changed'],
};
const SQL_MUT = {
  covernofk: 'alter table card_sets drop constraint card_sets_cover_in_set;',
  colornocheck: 'alter table card_sets drop constraint card_sets_pack_color_hex;',
  poolnopullable: `create or replace view public.draw_pool with (security_invoker = true) as
    select c.id, c.subject_id, c.name, c.rarity, c.source, c.image_url, c.artist_credit, c.lore, c.set_id, c.set_number
      from public.cards c join public.card_sets s on s.id = c.set_id where c.in_draw_pool and c.source::text = 'draw';`,
};
let MUT = '';
if (process.env.MUTATE && MIG_MUT[process.env.MUTATE]) {
  const [a, b] = MIG_MUT[process.env.MUTATE];
  if (!mig.includes(a)) throw new Error(`MUTATION ${process.env.MUTATE} does not match`);
  console.log(`MUTATE=${process.env.MUTATE}: the migration text`); mig = mig.replace(a, b);
} else if (process.env.MUTATE && SQL_MUT[process.env.MUTATE]) { console.log(`MUTATE=${process.env.MUTATE}`); MUT = SQL_MUT[process.env.MUTATE]; }
else MUT = mutation(FN_MUT);

const P = 'tst_cset';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const got = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;

const body = String.raw`do $t$
declare res jsonb := '[]'; ok boolean; n int; m int; x bigint; y bigint; cs bigint[]; s1 bigint[]; v jsonb; w jsonb; subj bigint;
  before jsonb; after jsonb; again jsonb; seen text[]; d date; s1_alone_new boolean;
begin
  -- The catalog as /api/catalog gives it to the browser today (every card, ordered by id, season || 'Season 1').
  select jsonb_agg(jsonb_build_object('id', id, 'season', coalesce(nullif(season, ''), 'Season 1')) order by id) into before from cards;
  ${mig && !LIVE ? 'execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${OLD ? '' : `select jsonb_agg(jsonb_build_object('id', c.id, 'set_id', c.set_id, 'code', s.code, 'n', c.set_number, 'season', c.season) order by c.id) into after
    from cards c join card_sets s on s.id = c.set_id;`}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b'), ('${P}_c', 'tst c');
  -- Before any test set: with S1 the only set, draw_pool is exactly the old pool (the no-set state is unchanged).
${kase('no set: draw_pool = the old pool (in_draw_pool and source draw) while S1 is the only set', `
    select count(*) into n from (select id from cards where in_draw_pool and source::text = 'draw' except select id from draw_pool) z;
    select count(*) into m from (select id from draw_pool except select id from cards where in_draw_pool and source::text = 'draw') z;
    ${got('no set: draw_pool = the old pool (in_draw_pool and source draw) while S1 is the only set', 'n = 0 and m = 0 and (select count(*) from draw_pool) > 0', ", 'missing', n, 'extra', m")}`)}
${kase('a second run of the file changes no set, number or season', `
    ${mig ? 'execute $m$' + mig + '$m$;' : ''}
    select jsonb_agg(jsonb_build_object('id', c.id, 'set_id', c.set_id, 'code', s.code, 'n', c.set_number, 'season', c.season) order by c.id) into again
      from cards c join card_sets s on s.id = c.set_id;
    ${got('a second run of the file changes no set, number or season', 'again = after')}`)}
  -- The mutation goes in after the second run (that run would put the file's functions back).
  ${MUT}
  -- D-89 with S1 the only set: no set is "new" (read before the test sets exist).
  begin s1_alone_new := coalesce((select bool_or((e->>'is_new')::boolean) from jsonb_array_elements(pullable_sets('${P}_c')->'sets') e), true);
  exception when others then s1_alone_new := null; end;
  -- Test sets: TS2 pullable, TS9 not pullable; 60 cards each (40 normal, 10 illustrated rare, 10 secret rare).
  insert into subjects (key, name) values ('${P}_subj', 'Test set subject') returning id into subj;
  insert into card_sets (id, name, code, pullable, sort, released_at, pack_color) values ('TS2', 'Test Set 2', 'TS2', true, 2, now(), '#22aa66'), ('TS9', 'Test Set 9', 'TS9', false, 9, now(), '#999999');
  insert into cards (subject_id, name, rarity, set_id)
    select subj, 'tst ' || st || ' ' || i, (case when i <= 40 then 'normal' when i <= 50 then 'illustrated_rare' else 'secret_rare' end)::card_rarity, st
      from unnest(array['TS2', 'TS9']) st, generate_series(1, 60) i order by st, i;
${kase('a new set numbers its cards 1..n in insert order, and season = the set name', `
    ${got('a new set numbers its cards 1..n in insert order, and season = the set name', `
      (select array_agg(set_number order by id) from cards where set_id = 'TS2') = (select array_agg(i) from generate_series(1, 60) i)
      and not exists (select 1 from cards c join card_sets s on s.id = c.set_id where c.season is distinct from s.name)
      and (select last_number from card_sets where id = 'TS2') = 60`)}`)}
${kase('a new S1 card gets the next S1 number; a deleted number is never given again', `
    select max(set_number) into n from cards where set_id = 'S1';
    insert into cards (subject_id, name, rarity, set_id) values (subj, 'tst new s1', 'normal', 'S1') returning id into x;
    delete from cards where id = x;
    insert into cards (subject_id, name, rarity, set_id) values (subj, 'tst new s1 b', 'normal', 'S1') returning id into y;
    ${got('a new S1 card gets the next S1 number; a deleted number is never given again', `(select set_number from cards where id = y) = n + 2`, ", 'max_before', n, 'got', (select set_number from cards where id = y)")}`)}
${kase('an insert with only a season gets that set; an unknown season is refused', `
    insert into cards (subject_id, name, rarity, season) values (subj, 'tst by season', 'normal', 'Test Set 2') returning id into x;
    begin insert into cards (subject_id, name, rarity, season) values (subj, 'tst bad season', 'normal', 'Nope Season'); ok := false;
    exception when check_violation then ok := true; end;
    ${got('an insert with only a season gets that set; an unknown season is refused', `ok and (select set_id = 'TS2' and set_number = 61 from cards where id = x)`)}`)}
${kase('a set number is fixed: an edit of the card keeps it, a direct change is refused, a season write alone changes nothing', `
    select id, set_number into x, n from cards where set_id = 'S1' order by id limit 1;
    update cards set name = name, lore = coalesce(lore, '') where id = x;
    update cards set season = 'Something else' where id = x;
    begin update cards set set_number = set_number + 1000 where id = x; ok := false; exception when check_violation then ok := true; end;
    ${got('a set number is fixed: an edit of the card keeps it, a direct change is refused, a season write alone changes nothing', `ok and (select set_number = n and season = 'Season 1' from cards where id = x)`)}`)}
${kase('set numbers are unique in a set (the constraint holds without the trigger)', `
    select array_agg(id order by id) into cs from (select id from cards where set_id = 'TS2' order by id limit 2) z;
    alter table cards disable trigger cards_set_rules;
    begin update cards set set_number = (select set_number from cards where id = cs[1]) where id = cs[2]; ok := false;
    exception when unique_violation then ok := true; end;
    alter table cards enable trigger cards_set_rules;
    ${got('set numbers are unique in a set (the constraint holds without the trigger)', 'ok and not exists (select 1 from cards group by set_id, set_number having count(*) > 1)')}`)}
${kase('open with set TS2: only TS2 cards, the ledger row records TS2 and keeps the open ref', `
    perform grant_packs('${P}_a', 3, 'admin', null, 'admin', 'card sets test');
    select array_agg(id) into cs from (select id from cards where set_id = 'TS2' and rarity = 'normal' order by id limit 5) z;
    n := open_packs('${P}_a', cs, 5, 'TS2');
    ${got('open with set TS2: only TS2 cards, the ledger row records TS2 and keeps the open ref', `n = 1
      and (select sum(quantity) from player_cards where player_id = '${P}_a') = 5
      and not exists (select 1 from player_cards pc join cards c on c.id = pc.card_id where pc.player_id = '${P}_a' and c.set_id <> 'TS2')
      and exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'opened' and amount = -1 and set_id = 'TS2' and ref_kind = 'open' and ref_id is not null)
      and (select pack_balance from players where id = '${P}_a') = 2`, ", 'n', n")}`)}
${kase('open with set TS2 and a card of another set: refused, nothing changes', `
    select array_agg(id) into cs from (select id from cards where set_id = 'TS2' and rarity = 'normal' order by id limit 4) z;
    cs := cs || (select id from draw_pool where set_id = 'S1' order by id limit 1);
    begin n := open_packs('${P}_a', cs, 5, 'TS2'); ok := false; exception when others then ok := sqlerrm like 'open_packs: a card is not in the draw pool%'; end;
    ${got('open with set TS2 and a card of another set: refused, nothing changes', `ok and (select pack_balance from players where id = '${P}_a') = 2`)}`)}
${kase('open with a set that is not pullable (TS9) or unknown: refused with set_not_pullable', `
    select array_agg(id) into cs from (select id from cards where set_id = 'TS9' and rarity = 'normal' order by id limit 5) z;
    begin n := open_packs('${P}_a', cs, 5, 'TS9'); ok := false; exception when others then ok := sqlerrm like 'set_not_pullable%'; end;
    if ok then begin n := open_packs('${P}_a', cs, 5, 'NOPE'); ok := false; exception when others then ok := sqlerrm like 'set_not_pullable%'; end; end if;
    ${got('open with a set that is not pullable (TS9) or unknown: refused with set_not_pullable', `ok and (select pack_balance from players where id = '${P}_a') = 2`)}`)}
${kase('open with no set (3 arguments): as before, the ledger row has no set', `
    select array_agg(id) into cs from (select id from draw_pool where set_id = 'S1' order by id limit 5) z;
    n := open_packs('${P}_a', cs, 5);
    ${got('open with no set (3 arguments): as before, the ledger row has no set', `n = 1 and (select pack_balance from players where id = '${P}_a') = 1
      and exists (select 1 from pack_ledger where player_id = '${P}_a' and reason = 'opened' and set_id is null and ref_kind = 'open')`)}`)}
${kase('open with no set is byte-identical: open_packs(text, bigint[], integer) has the md5 of pack_ledger_strict.sql', `
    ${got('open with no set is byte-identical: open_packs(text, bigint[], integer) has the md5 of pack_ledger_strict.sql',
      "md5(replace(pg_get_functiondef('public.open_packs(text,bigint[],integer)'::regprocedure), chr(13), '')) = '78cb45be91d898fa0b3dcbde7c8dcd10'")}`)}
${kase('no set = every pullable set: draw_pool has S1 and TS2 cards, no TS9 card', `
    ${got('no set = every pullable set: draw_pool has S1 and TS2 cards, no TS9 card', `exists (select 1 from draw_pool where set_id = 'S1') and (select count(*) from draw_pool where set_id = 'TS2') = 61
      and not exists (select 1 from draw_pool where set_id = 'TS9')`)}`)}
${kase('dungeon_card_of (Dungeon chests and loot, Dungeon and Gauntlet prizes): S1 and TS2 cards, never TS9', `
    seen := '{}';
    for n in 1..400 loop x := dungeon_card_of('normal'); seen := seen || (select set_id from cards where id = x); end loop;
    select array_agg(distinct s) into seen from unnest(seen) s;
    ${got('dungeon_card_of (Dungeon chests and loot, Dungeon and Gauntlet prizes): S1 and TS2 cards, never TS9', `'S1' = any(seen) and 'TS2' = any(seen) and not 'TS9' = any(seen)`, ", 'sets', to_jsonb(seen)")}`)}
${kase('shop_pick_stock (the Shop): S1 and TS2 cards over 30 days, never TS9', `
    for d in select generate_series(date '2099-01-01', date '2099-01-30', interval '1 day')::date loop perform shop_pick_stock(d); end loop;
    select array_agg(distinct c.set_id) into seen from shop_stock s join cards c on c.id = s.card_id where s.day between '2099-01-01' and '2099-01-30';
    ${got('shop_pick_stock (the Shop): S1 and TS2 cards over 30 days, never TS9', `'S1' = any(seen) and 'TS2' = any(seen) and not 'TS9' = any(seen)`, ", 'sets', to_jsonb(seen)")}`)}
${kase('pullable_sets: S1 and TS2 (not TS9), the card counts of the draw pool, the owned counts', `
    insert into player_cards (player_id, card_id, quantity) select '${P}_c', id, 2 from cards where set_id = 'TS2' order by id limit 3;
    v := pullable_sets('${P}_c')->'sets';
    select jsonb_agg(e->>'id') into w from jsonb_array_elements(v) e;
    ${got('pullable_sets: S1 and TS2 (not TS9), the card counts of the draw pool, the owned counts', `w @> '["S1", "TS2"]' and not w @> '["TS9"]'
      and (select (e->>'cards')::int = 61 and (e->>'owned')::int = 3 and e->>'code' = 'TS2' and e->>'name' = 'Test Set 2' from jsonb_array_elements(v) e where e->>'id' = 'TS2')
      and (select (e->>'cards')::int = (select count(*) from draw_pool where set_id = 'S1') and (e->>'owned')::int = 0 from jsonb_array_elements(v) e where e->>'id' = 'S1')`, ", 'v', v")}`)}
${kase('D-85 last_set: the set the member opened last; first visit = the newest pullable set; a set no longer pullable falls back to the newest', `
    -- a opened TS2 (above), then with no set (3 arguments: last_open_set unchanged). c never opened with a set.
    -- TS3 is released after TS2, so TS3 is the newest pullable set.
    insert into card_sets (id, name, code, pullable, sort, released_at, pack_color) values ('TS3', 'Test Set 3', 'TS3', true, 3, now() + interval '1 day', '#3366cc');
    ok := pullable_sets('${P}_a')->>'last_set' = 'TS2' and pullable_sets('${P}_c')->>'last_set' = 'TS3'
      and (select last_open_set from players where id = '${P}_a') = 'TS2';
    update card_sets set pullable = false where id = 'TS2';
    ok := ok and pullable_sets('${P}_a')->>'last_set' = 'TS3';
    update card_sets set pullable = true where id = 'TS2';
    ${got('D-85 last_set: the set the member opened last; first visit = the newest pullable set; a set no longer pullable falls back to the newest', 'ok', ", 'a', pullable_sets('" + P + "_a')->'last_set', 'c', pullable_sets('" + P + "_c')->'last_set'")}`)}
${kase('D-89 is_new: only the newest pullable set (TS3); with S1 alone no set is new', `
    v := pullable_sets('${P}_c')->'sets';
    ok := (select jsonb_agg(e->>'id') from jsonb_array_elements(v) e where (e->>'is_new')::boolean) = '["TS3"]'
      and (select count(*) from jsonb_array_elements(v) e where e->>'released_at' is not null) >= 2;
    ${got('D-89 is_new: only the newest pullable set (TS3); with S1 alone no set is new', 'ok and s1_alone_new = false', ", 'v', v")}`)}
${kase('D-86 cover: a card of the set itself; a card of another set is refused, the cover card cannot move set; the image URL is returned', `
    select id into x from cards where set_id = 'TS2' order by id limit 1;
    update cards set image_url = 'https://example.test/tst-cover.png' where id = x;
    begin update card_sets set cover_card_id = (select min(id) from cards where set_id = 'S1') where id = 'TS2'; ok := false;
    exception when foreign_key_violation then ok := true; end;
    update card_sets set cover_card_id = x where id = 'TS2';
    if ok then begin update cards set set_id = 'S1' where id = x; ok := false; exception when foreign_key_violation then ok := true; end; end if;
    v := pullable_sets('${P}_c')->'sets';
    ${got('D-86 cover: a card of the set itself; a card of another set is refused, the cover card cannot move set; the image URL is returned', `ok
      and (select (e->>'cover_card_id')::bigint = x and e->>'cover_image_url' = 'https://example.test/tst-cover.png' from jsonb_array_elements(v) e where e->>'id' = 'TS2')
      and (select (e->>'cover_card_id')::bigint = 32 and e->>'cover_image_url' is not null from jsonb_array_elements(v) e where e->>'id' = 'S1')`, ", 'v', v")}`)}
${kase('D-90 pack color: S1 = #ff8d4d (pack_still.png); a bad color or no color is refused; pack_color and pack_art_url are returned', `
    begin insert into card_sets (id, name, code, pack_color) values ('TSX', 'Test X', 'TSX', '#FFF'); ok := false; exception when check_violation then ok := true; end;
    if ok then begin insert into card_sets (id, name, code) values ('TSY', 'Test Y', 'TSY'); ok := false; exception when not_null_violation then ok := true; end; end if;
    update card_sets set pack_art_url = 'https://example.test/ts3-pack.webp' where id = 'TS3';
    v := pullable_sets('${P}_c')->'sets';
    ${got('D-90 pack color: S1 = #ff8d4d (pack_still.png); a bad color or no color is refused; pack_color and pack_art_url are returned', `ok
      and (select e->>'pack_color' = '#ff8d4d' and e->'pack_art_url' = 'null'::jsonb from jsonb_array_elements(v) e where e->>'id' = 'S1')
      and (select e->>'pack_color' = '#3366cc' and e->>'pack_art_url' = 'https://example.test/ts3-pack.webp' from jsonb_array_elements(v) e where e->>'id' = 'TS3')`, ", 'v', v")}`)}
${kase('D-90 many sets: one SQL statement (no loop per set) lists 300 more sets', `
    insert into card_sets (id, name, code, pack_color, sort) select 'M' || i, 'Many ' || i, 'M' || i, '#112233', 100 + i from generate_series(1, 300) i;
    n := jsonb_array_length(pullable_sets('${P}_c')->'sets');
    ${got('D-90 many sets: one SQL statement (no loop per set) lists 300 more sets', `n = 303
      and (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang where p.oid = 'public.pullable_sets(text)'::regprocedure) = 'sql'`, ", 'n', n")}`)}
  raise exception 'RESULT:%', jsonb_build_object('res', res, 'before', before, 'after', after)::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const m = String(out?.message ?? msg).match(/RESULT:({.*})/);
if (!m) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const r = JSON.parse(m[1]);
  const res = r.res;
  // The backfill: the number the browser computes today = the stored number, for every card.
  if (OLD || !r.after) res.unshift({ case: 'the stored numbers = the browser numbers (ui-v2.js mergedCards) for every card', ok: false, r: 'no set_number' });
  else {
    const shown = browserNumbers(r.before);
    const stored = new Map(r.after.map((a) => [a.id, a]));
    const diff = shown.filter((c) => { const a = stored.get(c.id); return !a || a.n !== c.num || a.season !== c.season; });
    res.unshift({ case: `the stored numbers = the browser numbers (ui-v2.js mergedCards) for every card (${shown.length} cards, ${diff.length} differences)`,
      ok: diff.length === 0 && shown.length === r.after.length && shown.length > 0, r: diff.slice(0, 5).map((c) => ({ id: c.id, browser: c.num, stored: stored.get(c.id)?.n })) });
    const sample = [shown[0], shown[shown.length - 1]].map((c) => `${stored.get(c.id).code} · #${String(stored.get(c.id).n).padStart(3, '0')} (browser #${String(c.num).padStart(3, '0')})`);
    console.log(`sample: first ${sample[0]}, last ${sample[1]}`);
  }
  let fails = 0;
  for (const x of res) { if (!x.ok) fails += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x).slice(0, 400)}`); }
  console.log(`\n${OLD ? 'BASELINE (--old) ' : LIVE ? '(--live) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
