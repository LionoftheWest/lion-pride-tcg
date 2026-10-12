/**
 * Acceptance test for tcg-bot/supabase/set_pools.sql (F-2 PR 2, docs/foundations.md F-2 item 5). Rolled back (the
 * result comes back in the exception), test rows only:
 *   node scripts/test-set-pools.mjs          the migration file, executed inside the block
 *   node scripts/test-set-pools.mjs --live   the database as it is (after the migration is applied)
 *   node scripts/test-set-pools.mjs --old    the database before the migration: FAILS
 *   MUTATE=<name> node scripts/test-set-pools.mjs   one broken mechanism: must FAIL
 * Invariants (the F-2 acceptance test on the local copy):
 *   - with S1 the only set and no pool rows, nothing changes: draw_pool has the same cards, the S1 pool is the
 *     same, pullable_sets, ach_tag_badges and a seeded spawn_hunt give the same result as before the file;
 *   - a new set "S2 test" (admin_set_save, logged) with its own cards: a pack of S2T gives only S2T cards;
 *   - five S1 cards added to the S2T pool (admin_set_pool): the S2T pool has them with their S1 set_id and
 *     numbers, an S2T open accepts them, the S1 pool and every S1 number are unchanged;
 *   - a set that includes S1 and S2T can give every card of both, each card once;
 *   - draw_pool (every pullable set: the pack with no set, Dungeon, Shop) has each card once;
 *   - a cycle of includes, a self include and a home card in its own pool are refused;
 *   - a set that is not pullable gives nothing: not in packs, not in boss tags, not in the tag badges;
 *   - admin_set_save refuses a stale edit (LP409) and turning off the last pullable set (LP400).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old'), LIVE = process.argv.includes('--live');

let mig = OLD || LIVE ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/set_pools.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');
// f3_elements_passives.sql (F-3 PR 2) made a newer spawn_hunt, so the guard of this file refuses it (the file is in SUPERSEDED.md).
// The test puts the spawn_hunt text that this file itself makes in place first (inside the rolled-back block), so the file runs as it did.
// f2_set_not_season.sql (F-2 PR 4) made a newer ach_tag_badges too: this file's own text of it goes in first, as for spawn_hunt.
const own = (name) => { const a = mig.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); if (a < 0) throw new Error(`no ${name} in set_pools.sql`); return mig.slice(a, mig.indexOf('$function$;', mig.indexOf('AS $function$', a)) + 11); };
const SPAWN = mig ? own('spawn_hunt') + String.fromCharCode(10) + own('ach_tag_badges') : '';
if (SPAWN.includes('$p$')) throw new Error('the function text contains $p$');

// The set_draw_pool text with one part removed (SQL_MUT below).
const POOL = (members) => `create or replace view public.set_draw_pool with (security_invoker = true) as
  with recursive reach (pool_set_id, src_set_id) as (
    select s.id, s.id from public.card_sets s where s.pullable
    union
    select r.pool_set_id, i.included_set_id from reach r join public.set_includes i on i.set_id = r.src_set_id),
  members (pool_set_id, card_id) as (${members})
  select m.pool_set_id, c.id, c.subject_id, c.name, c.rarity, c.source, c.image_url, c.artist_credit, c.lore, c.set_id, c.set_number
    from members m join public.cards c on c.id = m.card_id where c.in_draw_pool and c.source::text = 'draw';`;
const SQL_MUT = {
  nopool: POOL('select r.pool_set_id, c.id from reach r join public.cards c on c.set_id = r.src_set_id'),
  noinclude: POOL(`select s.id, c.id from public.card_sets s join public.cards c on c.set_id = s.id where s.pullable
    union select p.set_id, p.card_id from public.set_pool p join public.card_sets s on s.id = p.set_id where s.pullable`),
  drawdup: `create or replace view public.draw_pool with (security_invoker = true) as
    select p.id, p.subject_id, p.name, p.rarity, p.source, p.image_url, p.artist_credit, p.lore, p.set_id, p.set_number from public.set_draw_pool p;`,
  nocycle: 'drop trigger set_includes_rules on public.set_includes;',
  nohomecheck: 'drop trigger set_pool_rules on public.set_pool;',
};
const FN_MUT = {
  openhome: ['public.open_packs(text,bigint[],integer,text)', 'd.id = x.id and d.pool_set_id = p_set', 'd.id = x.id and d.set_id = p_set'],
  psetshome: ['public.pullable_sets(text)', 'select pool_set_id as set_id, count(*) as cards from set_draw_pool group by pool_set_id', 'select set_id, count(*) as cards from draw_pool group by set_id'],
  badgesold: ['public.ach_tag_badges(text)', 'where c.id in (select id from draw_pool) and', 'where c.in_draw_pool and'],
  spawnold: ['public.spawn_hunt(integer,text)', 'exists (select 1 from draw_pool c where c.subject_id = s.id)', 'exists (select 1 from cards c where c.subject_id = s.id and c.in_draw_pool)'],
  savenostale: ['public.admin_set_save(text,jsonb,jsonb,text)', 'if not v_create and admin_set_fields(v_old) is distinct from p_before then', 'if false then'],
  lastpullable: ['public.admin_set_save(text,jsonb,jsonb,text)', 'if not v_new.pullable and not exists (select 1 from card_sets where id <> v_id and pullable) then', 'if false then'],
  // The old rule of the first amend: any http:// address (a live set could point at http://evil.example).
  httpany: ['public.admin_set_save(text,jsonb,jsonb,text)', String.raw`'^(https://[^[:space:]/]+(/[^[:space:]]*)?|http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?/[^[:space:]]*)$'`, String.raw`'^https?://[^[:space:]]+$'`],
  poolnolog: ['public.admin_set_pool(text,text,bigint[],boolean,text)', "v_aid := admin_log_action(p_actor, case when p_add then 'set_pool_add' else 'set_pool_remove' end, 'card_set', p_set,", 'v_aid := 0; perform (null::text, null::text,'],
};
let MUT = '';
if (process.env.MUTATE && SQL_MUT[process.env.MUTATE]) { console.log(`MUTATE=${process.env.MUTATE}`); MUT = SQL_MUT[process.env.MUTATE]; }
else MUT = mutation(FN_MUT);

const P = 'tst_spool';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', false, 'r', sqlerrm);
  end;`;
const got = (name, cond, extra = '') => `res := res || jsonb_build_object('case', $c$${name}$c$, 'ok', coalesce(${cond}, false)${extra});`;
// A seeded boss in a sub-block that rolls back: its weak / resist / passive stay in the variable.
const spawn = (into) => `begin perform setseed(0.37); x := spawn_hunt(3, 'Normal');
    select jsonb_build_object('name', name, 'tier', tier, 'weak', weak_points, 'resist', resist_points, 'passive', passive, 'hp', hp_max) into ${into} from hunts where id = x;
    raise exception 'rollback'; exception when others then if sqlerrm <> 'rollback' then ${into} := to_jsonb(sqlerrm); end if; end;`;

const body = String.raw`do $t$
declare res jsonb := '[]'; ok boolean; n int; m int; x bigint; v jsonb; w jsonb; top text; err text;
  pool_before bigint[]; s1_before jsonb; psets_before jsonb; badges_before jsonb; spawn_before jsonb; spawn_after jsonb;
  s2 bigint[]; five bigint[]; five_nums jsonb; subj bigint; aid0 bigint; fields jsonb;
begin
  select player_id into top from player_cards group by player_id order by count(*) desc, player_id limit 1;
  select array_agg(id order by id) into pool_before from draw_pool;
  select jsonb_agg(jsonb_build_object('id', id, 'n', set_number) order by id) into s1_before from cards where set_id = 'S1';
  psets_before := pullable_sets(top);
  select jsonb_agg(to_jsonb(b) order by b.key) into badges_before from ach_tag_badges(top) b;
  ${spawn('spawn_before')}
  ${mig ? 'execute $p$' + SPAWN + '$p$; execute $m$' + mig + '$m$;' : '-- the database as it is'}
  ${MUT}
  select coalesce(max(id), 0) into aid0 from admin_actions;
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}_a', 'tst a');
${kase('S1 only, no pool rows: draw_pool, the S1 pool, pullable_sets, tag badges and a seeded boss are unchanged', `
    ${spawn('spawn_after')}
    ${got('S1 only, no pool rows: draw_pool, the S1 pool, pullable_sets, tag badges and a seeded boss are unchanged', `
      (select array_agg(id order by id) from draw_pool) = pool_before
      and (select array_agg(id order by id) from set_draw_pool where pool_set_id = 'S1') = pool_before
      and pullable_sets(top) = psets_before
      and (select jsonb_agg(to_jsonb(b) order by b.key) from ach_tag_badges(top) b) = badges_before
      and spawn_after = spawn_before and jsonb_typeof(spawn_before) = 'object'
      and cardinality(pool_before) > 0`, ", 'spawn_before', spawn_before, 'spawn_after', spawn_after")}`)}
  -- "S2 test": made through the admin function, NOT pullable first (a set in preparation), with 30 cards.
  -- 30 attacker subjects (one for each S2T card) with shared tags: enough to enter the boss tag band and the tag badges.
  insert into subjects (key, name, type, tags) select '${P}_subj' || i, 'Set pool test subject ' || i, 'Item', '{"class": "attacker"}' from generate_series(1, 30) i;
  update subjects set tag_slugs = array['origin:tstpoolorigin', 'trait:tstpooltrait', 'type:tstpooltype'] where key like '${P}_subj%';
${kase('admin_set_save creates S2T (logged set_create) and an edit with a stale before value is refused (LP409)', `
    v := admin_set_save('tester', '{"id": "S2T", "name": "S2 test", "code": "S2T", "pack_color": "#22AA66", "season": 92, "pullable": false, "sort": 2}', null, 'test');
    fields := v->'set';
    begin perform admin_set_save('tester', '{"id": "S2T", "name": "S2 test b"}', fields || '{"name": "old"}', 'test'); ok := false;
    exception when sqlstate 'LP409' then ok := true; end;
    ${got('admin_set_save creates S2T (logged set_create) and an edit with a stale before value is refused (LP409)', `ok
      and (v->>'created')::boolean and fields->>'pack_color' = '#22aa66'
      and (select name from card_sets where id = 'S2T') = 'S2 test'
      and exists (select 1 from admin_actions where id > aid0 and action = 'set_create' and target_id = 'S2T' and actor = 'tester')`, ", 'v', v")}`)}
  insert into cards (subject_id, name, rarity, set_id)
    select (select id from subjects where key = '${P}_subj' || i), 'tst s2 ' || i, (case when i <= 20 then 'normal' when i <= 25 then 'illustrated_rare' else 'secret_rare' end)::card_rarity, 'S2T'
      from generate_series(1, 30) i order by i;
  select array_agg(id order by id) into s2 from cards where set_id = 'S2T';
${kase('a set that is not pullable gives nothing: no pack, not in draw_pool, not in the tag badges, not in boss tags', `
    begin perform open_packs('${P}_a', s2[1:5], 5, 'S2T'); ok := false; exception when others then ok := sqlerrm like 'set_not_pullable%'; end;
    ${spawn('spawn_after')}
    ${got('a set that is not pullable gives nothing: no pack, not in draw_pool, not in the tag badges, not in boss tags', `ok
      and not exists (select 1 from draw_pool where id = any(s2)) and not exists (select 1 from set_draw_pool where pool_set_id = 'S2T')
      and not exists (select 1 from ach_tag_badges(top) b where b.tag like '%tstpool%')
      and spawn_after = spawn_before`, ", 'spawn_after', spawn_after")}`)}
${kase('S2T made pullable (an edit with the right before value): a pack of S2T gives only S2T cards', `
    v := admin_set_save('tester', '{"id": "S2T", "pullable": true}', fields, 'release');
    fields := v->'set';
    perform grant_packs('${P}_a', 3, 'admin', null, 'admin', 'set pools test');
    n := open_packs('${P}_a', s2[1:5], 5, 'S2T');
    begin perform open_packs('${P}_a', array[pool_before[1], s2[1], s2[2], s2[3], s2[4]], 5, 'S2T'); ok := false;
    exception when others then ok := sqlerrm like 'open_packs: a card is not in the draw pool%'; end;
    ${got('S2T made pullable (an edit with the right before value): a pack of S2T gives only S2T cards', `ok and n = 1
      and (select array_agg(id order by id) from set_draw_pool where pool_set_id = 'S2T') = s2
      and exists (select 1 from admin_actions where id > aid0 and action = 'set_edit' and target_id = 'S2T')`, ", 'n', n")}`)}
${kase('five S1 cards in the S2T pool keep their S1 set and numbers; an S2T open gives them; the S1 pool and numbers are unchanged', `
    select array_agg(id order by id) into five from (select id from cards where set_id = 'S1' and in_draw_pool and source::text = 'draw' order by id limit 5) z;
    select jsonb_agg(jsonb_build_object('id', id, 'set_id', set_id, 'n', set_number) order by id) into five_nums from cards where id = any(five);
    v := admin_set_pool('tester', 'S2T', five, true, 'reprints');
    n := open_packs('${P}_a', five, 5, 'S2T');
    ${got('five S1 cards in the S2T pool keep their S1 set and numbers; an S2T open gives them; the S1 pool and numbers are unchanged', `n = 1 and (v->>'changed')::int = 5
      and (select jsonb_agg(jsonb_build_object('id', id, 'set_id', set_id, 'n', set_number) order by id) from set_draw_pool where pool_set_id = 'S2T' and id = any(five)) = five_nums
      and (select count(*) from set_draw_pool where pool_set_id = 'S2T') = 35
      and (select array_agg(id order by id) from set_draw_pool where pool_set_id = 'S1') = pool_before
      and (select jsonb_agg(jsonb_build_object('id', id, 'n', set_number) order by id) from cards where set_id = 'S1') = s1_before
      and (select (e->>'cards')::int from jsonb_array_elements(pullable_sets(top)->'sets') e where e->>'id' = 'S2T') = 35
      and exists (select 1 from admin_actions where id > aid0 and action = 'set_pool_add' and target_id = 'S2T')`, ", 'v', v, 'n', n")}`)}
${kase('draw_pool (every pullable set) has each card once: the S1 pool plus the S2T cards', `
    ${got('draw_pool (every pullable set) has each card once: the S1 pool plus the S2T cards', `(select count(*) from draw_pool) = (select count(distinct id) from draw_pool)
      and (select array_agg(id order by id) from draw_pool) = (select array_agg(i order by i) from unnest(pool_before || s2) i)`)}`)}
${kase('a set that includes S1 and S2T gives every card of both, each once (and the S2T pool through S2T)', `
    perform admin_set_save('tester', '{"id": "S12T", "name": "S1 and S2 test", "code": "S12T", "pack_color": "#3366cc", "season": 93}', null, 'test');
    perform admin_set_include('tester', 'S12T', 'S1', true, 'test');
    perform admin_set_include('tester', 'S12T', 'S2T', true, 'test');
    ${got('a set that includes S1 and S2T gives every card of both, each once (and the S2T pool through S2T)', `
      (select array_agg(id order by id) from set_draw_pool where pool_set_id = 'S12T') = (select array_agg(i order by i) from unnest(pool_before || s2) i)
      and (select count(*) from draw_pool) = (select count(distinct id) from draw_pool)`)}`)}
${kase('cycles are refused: a set cannot include itself, S2T cannot include S12T (S12T includes S2T), nor through a third set', `
    n := 0;
    begin insert into set_includes values ('S2T', 'S2T'); exception when check_violation then n := n + 1; end;
    begin insert into set_includes (set_id, included_set_id) values ('S2T', 'S12T'); exception when check_violation then n := n + 1; end;
    begin perform admin_set_include('tester', 'S2T', 'S12T', true, 'test'); exception when sqlstate 'LP400' then n := n + 1; end;
    perform admin_set_save('tester', '{"id": "S3T", "name": "S3 test", "code": "S3T", "pack_color": "#aa3366", "season": 94}', null, 'test');
    insert into set_includes (set_id, included_set_id) values ('S3T', 'S12T');
    begin insert into set_includes (set_id, included_set_id) values ('S1', 'S3T'); exception when check_violation then n := n + 1; end;
    ${got('cycles are refused: a set cannot include itself, S2T cannot include S12T (S12T includes S2T), nor through a third set', 'n = 4', ", 'refused', n")}`)}
${kase('a home card cannot be in the pool of its own set (admin LP400 and a direct insert)', `
    n := 0;
    begin perform admin_set_pool('tester', 'S2T', s2[1:1], true, 'test'); exception when sqlstate 'LP400' then n := n + 1; end;
    begin insert into set_pool (set_id, card_id) values ('S2T', s2[1]); exception when check_violation then n := n + 1; end;
    ${got('a home card cannot be in the pool of its own set (admin LP400 and a direct insert)', 'n = 2', ", 'refused', n")}`)}
${kase('the last pullable set cannot be turned off (LP400); removing pool cards and excluding a set work and are logged', `
    perform admin_set_save('tester', '{"id": "S2T", "pullable": false}', fields, 'test');
    perform admin_set_save('tester', '{"id": "S12T", "pullable": false}', (select admin_set_fields(s) from card_sets s where id = 'S12T'), 'test');
    perform admin_set_save('tester', '{"id": "S3T", "pullable": false}', (select admin_set_fields(s) from card_sets s where id = 'S3T'), 'test');
    begin perform admin_set_save('tester', '{"id": "S1", "pullable": false}', (select admin_set_fields(s) from card_sets s where id = 'S1'), 'test'); ok := false;
    exception when sqlstate 'LP400' then ok := true; end;
    v := admin_set_pool('tester', 'S2T', five, false, 'test');
    w := admin_set_include('tester', 'S12T', 'S1', false, 'test');
    ${got('the last pullable set cannot be turned off (LP400); removing pool cards and excluding a set work and are logged', `ok
      and (v->>'changed')::int = 5 and not exists (select 1 from set_pool where set_id = 'S2T')
      and w->'includes' = '["S2T"]'::jsonb
      and (select pullable from card_sets where id = 'S1')
      and (select count(*) from admin_actions where id > aid0 and action in ('set_pool_remove', 'set_exclude')) = 2`, ", 'v', v, 'w', w")}`)}
${kase('pack art: https:// anywhere, http:// only to localhost or 127.0.0.1 (http://evil.example refused)', `
    perform admin_set_save('tester', '{"id": "S4T", "name": "S4 test", "code": "S4T", "pack_color": "#123456", "season": 95}', null, 'test');
    n := 0; m := 0;
    foreach err in array array['http://evil.example/pack.png', 'http://localhost.evil.example/pack.png', 'http://127.0.0.1@evil.example/pack.png', 'ftp://example.com/p.png', 'https://'] loop
      begin perform admin_set_save('tester', jsonb_build_object('id', 'S4T', 'pack_art_url', err), (select admin_set_fields(s) from card_sets s where id = 'S4T'), 'test');
      exception when sqlstate 'LP400' then n := n + 1; end;
    end loop;
    foreach err in array array['http://127.0.0.1:54321/storage/v1/object/public/card-art/packs/S4T-still.png', 'http://localhost/p.png', 'https://cdn.example.com/packs/s4.webp'] loop
      perform admin_set_save('tester', jsonb_build_object('id', 'S4T', 'pack_art_url', err), (select admin_set_fields(s) from card_sets s where id = 'S4T'), 'test');
      if (select pack_art_url from card_sets where id = 'S4T') = err then m := m + 1; end if;
    end loop;
    ${got('pack art: https:// anywhere, http:// only to localhost or 127.0.0.1 (http://evil.example refused)', 'n = 5 and m = 3', ", 'refused', n, 'accepted', m")}`)}
  raise exception 'RESULT:%', jsonb_build_object('res', res)::text;
end $t$;`;

const out = await q(body);
const msg = JSON.stringify(out);
const mm = String(out?.message ?? msg).match(/RESULT:({.*})/);
if (!mm) { console.log('FAIL the block did not return its results:', msg.slice(0, 1500)); process.exitCode = 1; }
else {
  const res = JSON.parse(mm[1]).res;
  let fails = 0;
  for (const x of res) { if (!x.ok) fails += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.case}${x.ok ? '' : '  ' + JSON.stringify(x).slice(0, 400)}`); }
  console.log(`\n${OLD ? 'BASELINE (--old) ' : LIVE ? '(--live) ' : ''}${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
  if (fails) process.exitCode = 1;
}
const left = await q(`select (select count(*) from players where id like '${P}%') as players, (select count(*) from card_sets where id in ('S2T', 'S12T', 'S3T')) as sets`);
console.log('after (nothing stays):', JSON.stringify(left));
