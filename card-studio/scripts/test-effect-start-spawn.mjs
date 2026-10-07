/**
 * Acceptance test for tcg-bot/supabase/effect_start_spawn_settle.sql. Rolled back, on a PRIVATE test boss row and test
 * members only (the result comes back in the exception):
 *   node scripts/test-effect-start-spawn.mjs              the migration file, executed inside the block
 *   node scripts/test-effect-start-spawn.mjs --old        the database as it is (the baseline: it must FAIL before the migration)
 *   node scripts/test-effect-start-spawn.mjs --mutations  each mutation must make at least one case FAIL
 * spawn_hunt closes EVERY active Hunt, so outside the local copy (LOCALDB=1) the test refuses to run while a real Hunt is active.
 * Invariants:
 *   E1 take_player_effect does not use up an effect whose starts_at is in the future (a delayed prank), and uses it
 *      up once starts_at has come (lucky_pull and mend: the bot and hunt_attack call this function)
 *   E2 an effect that is not delayed (starts_at = now) is used up at once, as before
 *   E3 a hit (hunt_attack) leaves a delayed rally / butterfingers waiting, and uses both up after starts_at
 *   S1 spawn_hunt closes a still-active Hunt through close_hunt: expired, paid by rank once, one 'expired' post
 *   S2 a second settle_hunt and close_due_hunts pay nothing more; the new boss is the only active Hunt
 *   G1 balance_table.sql builds the same spawn_hunt (same md5), and a re-run of this file changes nothing
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const OLD = process.argv.includes('--old');
const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r/g, '');
const src = read('effect_start_spawn_settle.sql').replace(/notify pgrst[^\n]*\n/g, '');
// G1: the spawn_hunt that balance_table.sql writes on a re-run (its guard accepts this file's result).
const bt = read('balance_table.sql');
const btSpawn = bt.slice(bt.indexOf('CREATE OR REPLACE FUNCTION "public"."spawn_hunt"'), bt.indexOf('end $$;', bt.indexOf('CREATE OR REPLACE FUNCTION "public"."spawn_hunt"')) + 7);
for (const s of [src, btSpawn]) if (s.includes('$m$') || s.includes('$b$') || s.includes('$mq$')) throw new Error('a migration text contains $m$, $b$ or $mq$');
if (!btSpawn.startsWith('CREATE')) throw new Error('balance_table.sql: spawn_hunt not found');

// Mutations: 'file' changes the migration text (the guard is opened for the mutated md5); 'fn' changes a live
// function after the migration ran (settle_hunt is not in this file, but S2 depends on its once-only guard).
const MUTATIONS = {
  'E1 no starts_at check': ['file', '                  and (starts_at is null or starts_at <= now())   -- a delayed prank waits (effects_batch3.sql: delay)\n', ''],
  'E1 starts_at check too late by 2 hours': ['file', 'starts_at <= now())', "starts_at <= now() + interval '2 hours')"],
  'E2 a not-delayed effect waits': ['file', 'starts_at <= now())', 'starts_at < now())'],
  'S1 spawn only marks expired (the old line)': ['file', 'perform close_hunt(a.id) from (select id from hunts where status = \'active\' order by id) a;', "update hunts set status = 'expired' where status = 'active';"],
  'S2 settle_hunt pays twice': ['fn', 'public.settle_hunt(bigint)', "  if v_settled is not null then return jsonb_build_object('ok', false, 'error', 'already_settled'); end if;\n", ''],
};
const guardOpen = (s) => s.replace("'8c5aa2f9c40142cbf1be50ecf1e6509b')", "'8c5aa2f9c40142cbf1be50ecf1e6509b', md5(replace(pg_get_functiondef('public.take_player_effect'::regproc), chr(13), '')))")
  .replace("'87d7ae86ad47945a5e6c7d44f453a1ad')", "'87d7ae86ad47945a5e6c7d44f453a1ad', md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), '')))");
const fnMut = ([, fn, a, b]) => `declare mut_src text; begin
    mut_src := replace(pg_get_functiondef('${fn}'::regprocedure), chr(13), '');
    if position($mq$${a}$mq$ in mut_src) = 0 then raise exception 'MUTATION does not match'; end if;
    execute replace(mut_src, $mq$${a}$mq$, $mq$${b}$mq$);
  end;`;

const P = 'tst_esp';
const body = (mig, mut = '') => String.raw`do $t$
declare res jsonb := '[]'; h bigint; hn bigint; atk bigint[]; r jsonb; r2 jsonb; i int; n int; ok boolean; a numeric; b numeric;
  e1 bigint; e2 bigint; m1 text; m2 text; v_ranks jsonb; v_packs int;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}
  ${mut}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${P}_a', 'tst esp a'), ('${P}_b', 'tst esp b'), ('${P}_c', 'tst esp c');

  -- E1 + E2: take_player_effect directly (the bot calls it for lucky_pull; hunt_attack for mend).
  begin
    insert into player_effects (player_id, primitive, amount, starts_at) values ('${P}_a', 'lucky_pull', 1, now() + interval '1 hour') returning id into e1;
    insert into player_effects (player_id, primitive, amount, starts_at) values ('${P}_a', 'mend', 30, now() + interval '1 hour') returning id into e2;
    a := take_player_effect('${P}_a', 'lucky_pull'); b := take_player_effect('${P}_a', 'mend');
    ok := a is null and b is null and (select count(*) from player_effects where id in (e1, e2) and consumed_at is null) = 2;
    res := res || jsonb_build_object('case', 'E1 a delayed lucky_pull / mend is NOT used up before starts_at', 'ok', coalesce(ok, false), 'lucky', a, 'mend', b);
    update player_effects set starts_at = now() - interval '1 second' where id in (e1, e2);
    a := take_player_effect('${P}_a', 'lucky_pull'); b := take_player_effect('${P}_a', 'mend');
    ok := a = 1 and b = 30 and (select count(*) from player_effects where id in (e1, e2) and consumed_at is not null) = 2
      and take_player_effect('${P}_a', 'lucky_pull') is null;
    res := res || jsonb_build_object('case', 'E1 the same lucky_pull / mend IS used up after starts_at, once', 'ok', coalesce(ok, false), 'lucky', a, 'mend', b);
    insert into player_effects (player_id, primitive, amount) values ('${P}_b', 'lucky_pull', 1) returning id into e1;
    a := take_player_effect('${P}_b', 'lucky_pull');
    ok := a = 1 and (select consumed_at is not null from player_effects where id = e1);
    res := res || jsonb_build_object('case', 'E2 a lucky_pull that is not delayed is used up at once', 'ok', coalesce(ok, false), 'lucky', a);
  exception when others then res := res || jsonb_build_object('case', 'E1/E2 take_player_effect', 'ok', false, 'error', sqlerrm); end;

  -- A private boss (rolled back). The live boss row is never read for update or written by these cases.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Effect Start Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '5 days') returning id into h;

  -- E3: a hit leaves a delayed rally / butterfingers waiting, and uses both up after starts_at.
  begin
    select array_agg(id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
      where s.type in ('Character','Creature') and s.ability->>'kind' = 'attack' and c.rarity = 'normal' order by c.id limit 4) x;
    insert into player_cards (player_id, card_id, quantity) select '${P}_c', x, 1 from unnest(atk) x;
    ${GATE(P + '_c')}
    r := lock_hunt_squad('${P}_c', h, atk);
    if not coalesce((r->>'ok')::boolean, false) then raise exception 'squad lock refused: %', r; end if;
    insert into player_effects (player_id, primitive, amount, starts_at) values ('${P}_c', 'rally', 20, now() + interval '1 hour') returning id into e1;
    insert into player_effects (player_id, primitive, amount, starts_at) values ('${P}_c', 'butterfingers', 20, now() + interval '1 hour') returning id into e2;
    r := null; i := 0;
    while i < 16 loop
      r2 := hunt_attack('${P}_c', h, atk[1 + (i % 4)]); i := i + 1;
      if coalesce((r2->>'ok')::boolean, false) and r2->>'outcome' <> 'miss' then r := r2; exit; end if;
    end loop;
    ok := r is not null and r->'rally' = 'null'::jsonb and r->'butterfingers' = 'null'::jsonb
      and (select count(*) from player_effects where id in (e1, e2) and consumed_at is null) = 2;
    res := res || jsonb_build_object('case', 'E3 a hit does NOT use up a delayed rally / butterfingers', 'ok', coalesce(ok, false), 'r', r, 'last', r2);
    update player_effects set starts_at = now() - interval '1 second' where id in (e1, e2);
    r := null;
    while i < 32 loop
      r2 := hunt_attack('${P}_c', h, atk[1 + (i % 4)]); i := i + 1;
      if coalesce((r2->>'ok')::boolean, false) and r2->>'outcome' <> 'miss' then r := r2; exit; end if;
    end loop;
    ok := r is not null and (r->>'rally')::numeric = 20 and (r->>'butterfingers')::numeric = 20
      and (select count(*) from player_effects where id in (e1, e2) and consumed_at is not null) = 2;
    res := res || jsonb_build_object('case', 'E3 the next hit after starts_at uses up both', 'ok', coalesce(ok, false), 'r', r, 'last', r2);
  exception when others then res := res || jsonb_build_object('case', 'E3 hunt_attack with delayed boons', 'ok', false, 'error', sqlerrm); end;

  -- S1 + S2: a spawn while the private boss is still active pays its prizes once.
  begin
    delete from hunt_hits where hunt_id = h;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values
      (h, '${P}_a', (select min(id) from cards), current_date, 900), (h, '${P}_b', (select min(id) from cards), current_date, 400);
    v_ranks := coalesce(balance_get('hunt_prizes')->'ranks', '[]'::jsonb);
    v_packs := coalesce((v_ranks->>0)::int, balance_num('hunt_prizes', 'base')::int) + coalesce((v_ranks->>1)::int, balance_num('hunt_prizes', 'base')::int);
    hn := spawn_hunt(3);
    select count(*) into n from pack_ledger where ref_kind = 'hunt' and ref_id = h::text;
    ok := (select status = 'expired' and settled_at is not null from hunts where id = h)
      and n = 2 and (select sum(amount) from pack_ledger where ref_kind = 'hunt' and ref_id = h::text) = v_packs
      and (select count(*) from hunt_events where hunt_id = h and kind = 'expired') = 1;
    res := res || jsonb_build_object('case', 'S1 a spawn closes the active Hunt and pays its prizes by rank, once', 'ok', coalesce(ok, false),
      'rows', n, 'packs', (select sum(amount) from pack_ledger where ref_kind = 'hunt' and ref_id = h::text), 'expect', v_packs,
      'hunt', (select jsonb_build_object('status', status, 'settled', settled_at is not null) from hunts where id = h));
    r := settle_hunt(h);
    perform close_due_hunts();
    ok := (select count(*) from pack_ledger where ref_kind = 'hunt' and ref_id = h::text) = 2
      and (select count(*) from hunt_events where hunt_id = h and kind = 'expired') = 1
      and (select array_agg(id) from hunts where status = 'active') = array[hn];
    res := res || jsonb_build_object('case', 'S2 a second settle_hunt and close_due_hunts pay nothing more; the new boss is the only active Hunt', 'ok', coalesce(ok, false), 'settle2', r);
  exception when others then res := res || jsonb_build_object('case', 'S1/S2 spawn while a Hunt is active', 'ok', false, 'error', sqlerrm); end;

  -- G1: balance_table.sql writes the same spawn_hunt; a re-run of this file changes nothing.
  begin
    m1 := md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), ''));
    m2 := md5(replace(pg_get_functiondef('public.take_player_effect'::regproc), chr(13), ''));
    ${mig ? `execute $m$${mig}$m$;` : ''}
    ok := m1 = md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), ''))
      and m2 = md5(replace(pg_get_functiondef('public.take_player_effect'::regproc), chr(13), ''));
    execute $b$${btSpawn}$b$;
    ok := ok and m1 = md5(replace(pg_get_functiondef('public.spawn_hunt'::regproc), chr(13), ''))
      and m1 = '87d7ae86ad47945a5e6c7d44f453a1ad' and m2 = '8c5aa2f9c40142cbf1be50ecf1e6509b';
    res := res || jsonb_build_object('case', 'G1 a re-run of this file and the balance_table.sql spawn_hunt give the same md5s', 'ok', coalesce(ok, false), 'spawn', m1, 'take', m2);
  exception when others then res := res || jsonb_build_object('case', 'G1 re-run', 'ok', false, 'error', sqlerrm); end;

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig, mut) => {
  const out = await q(body(mig, mut));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

// spawn_hunt closes every active Hunt (rolled back, but it locks the row): never against a real active boss.
if (process.env.LOCALDB !== '1') {
  const live = await q("select count(*)::int as n from hunts where status = 'active'");
  if (!/"n":0\b/.test(live)) { console.log('FAIL refused: a Hunt is active on this database. Run on the local copy (LOCALDB=1).', live); process.exit(1); }
}

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, m] of Object.entries(MUTATIONS)) {
    let mig = src, mut = '';
    if (m[0] === 'file') {
      if (src.split(m[1]).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
      mig = guardOpen(src.replace(m[1], m[2]));
    } else mut = fnMut(m);
    const { results, raw } = await runOnce(mig, mut);
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0]}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(OLD ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}`); }
  console.log(`${OLD ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', left);
