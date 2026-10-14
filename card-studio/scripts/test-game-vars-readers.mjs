/**
 * Acceptance test for tcg-bot/supabase/game_vars_readers.sql (F-1 PR 4), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-game-vars-readers.mjs     must PASS (the file is applied twice)
 *   MUTATE=<name> ...                                                                            must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                               runs every mutation and prints one line each
 * The old text of each reader is the file's text with the one changed line put back (the reference copies ref_*).
 * Invariants (docs/foundations.md F-1 items 5 and 7, acceptance tests 2 and 8):
 *   1. bot_game_vars() = {vars: game_vars(), pulls: game_pull_rates()}; with a live pull_rare_mult = 2 event its non-normal
 *      rates are 2 x balance pulls and add up to 1 (the rates the bot rolls).
 *   2. No live event: claim_daily_earn, add_voice_minutes and dailies_view give the SAME answers and ledger rows as the old text.
 *   3. A live pack_earn_mult = 2 event: claim_daily_earn grants what the old text grants with balance pack_earn_multiplier x 2
 *      (the event works as the base would, inside the limits). A live factor 0 pauses: claim_daily refuses (paused),
 *      add_voice_minutes counts nothing, dailies_view says paused.
 *   4. admin_packrate: 2 makes ONE live modifier event (game_var = base x 2); 3 edits the same event (event_log records it); 1 ends
 *      it (back to the base); 1 again = none; 9, 0 hours and more than 62 days are refused.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/game_vars_readers.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const NEW = "  mult numeric := game_var('pack_earn_mult');   -- balance pack_earn_multiplier x the live events (game_vars_readers.sql)";
const OLD = "  mult numeric := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;";
// The reference copies (the old text): each reader of the file, with the old line, as pg_temp.ref_<name>.
const refs = ['claim_daily_earn', 'claim_daily', 'add_voice_minutes', 'dailies_view'].map((n) => {
  const m = mig.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${n}\\([\\s\\S]*?end \\$function\\$;`));
  if (!m || !m[0].includes(NEW)) throw new Error(`no text of ${n} in the file`);
  return m[0].replace(`public.${n}(`, `pg_temp.ref_${n}(`).replace(NEW, OLD);
}).join('\n');
// [the section start, the text, the replacement]: the first match after the start.
const MUT = {
  botpulls: ['create or replace function public.bot_game_vars', "'pulls', game_pull_rates(p_now)", "'pulls', balance_get('pulls')"],
  earn: ['-- claim_daily_earn:', NEW, OLD],
  daily: ['-- claim_daily:', NEW, OLD],
  voice: ['-- add_voice_minutes:', NEW, OLD],
  view: ['-- dailies_view:', NEW, OLD],
  newevent: ['create or replace function public.admin_packrate', '  if found then\n    return admin_event_save(', '  if false then\n    return admin_event_save('],
  noend: ['create or replace function public.admin_packrate', "return admin_event_end_now(e.id, e.updated_at, p_actor, '/packrate 1') || jsonb_build_object('ended', true);", "return jsonb_build_object('ok', true, 'ended', true);"],
  notlive: ['create or replace function public.admin_packrate', '  perform event_step(v_id, now());   -- live now, not at the next tick\n', ''],
  hours: ['create or replace function public.admin_packrate', 'p_hours <= 0 or p_hours > 62 * 24', 'p_hours <= 0 or p_hours > 620 * 24'],
};

if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(9)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const P = 'tst_gvr_', A = 'tst_gvr_admin';
const body = String.raw`do $t$
declare bad text := ''; T timestamptz := date_trunc('second', now()); d date := game_day(); r jsonb; r2 jsonb; v jsonb; base numeric; ev bigint; ev2 bigint;
  g_old int; g_new int; l_old jsonb; l_new jsonb; n int; x jsonb; y jsonb; pid text; s numeric;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${A}', true);
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent
  execute $m$${refs}$m$;
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  update events set status = 'cancelled', ended_at = T where status in ('scheduled', 'live') and (vars ? 'pack_earn_mult' or vars ? 'pull_rare_mult');
  base := (balance_get('pack_earn_multiplier') #>> '{}')::numeric;
  if base <= 0 then update balance set value = '1' where key = 'pack_earn_multiplier'; base := 1; end if;
  -- members with a full chat day (the chat pack and the bonus pack are due)
  create function pg_temp.member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p) on conflict do nothing;
    insert into daily_activity (player_id, activity_date, message_count) values (p, game_day(), balance_num('daily', 'chat_bonus_at')::int)
      on conflict (player_id, activity_date) do update set message_count = excluded.message_count, base_claimed = false, bonus_claimed = false;
  end $f$;
  create function pg_temp.ledger(p text) returns jsonb language sql as $f$
    select coalesce(jsonb_agg(jsonb_build_array(reason, amount, ref_kind, ref_id) order by id), '[]') from pack_ledger where player_id = p $f$;

  -- 1. The one call of the bot.
  if bot_game_vars() - 'at' <> jsonb_build_object('vars', game_vars(), 'pulls', game_pull_rates()) then bad := bad || '1: bot_game_vars is not game_vars + game_pull_rates; '; end if;
  r := admin_event_save(jsonb_build_object('key', 'tst_gvr_rare', 'kind', 'modifier', 'title', 'Rares', 'starts_at', T - interval '1 minute', 'ends_at', T + interval '1 hour',
         'vars', '{"pull_rare_mult": 2}'::jsonb), null, '${A}', null);
  ev := (r->'event'->>'id')::bigint;
  perform admin_event_schedule(ev, (select updated_at from events where id = ev), '${A}', true);
  perform event_tick(T);
  v := bot_game_vars()->'pulls'->'rates';
  if exists (select 1 from jsonb_each(balance_get('pulls')->'rates') b where b.key <> 'normal' and (v->>b.key)::numeric <> 2 * (b.value #>> '{}')::numeric) then
    bad := bad || '1: with a live 2x event the bot rates are not doubled: ' || v::text || '; ';
  end if;
  select sum((e.value #>> '{}')::numeric) into s from jsonb_each(v) e;
  if s <> 1 then bad := bad || format('1: the bot rates add up to %s; ', s); end if;
  perform admin_event_end_now(ev, (select updated_at from events where id = ev), '${A}', null);

  -- 2. No live event: the same answers as the old text.
  perform pg_temp.member('${P}a'); perform pg_temp.member('${P}b');
  g_old := pg_temp.ref_claim_daily_earn('${P}a', d, 0, 0, 0); g_new := claim_daily_earn('${P}b', d, 0, 0, 0);
  l_old := replace(pg_temp.ledger('${P}a')::text, '${P}a', 'X')::jsonb; l_new := replace(pg_temp.ledger('${P}b')::text, '${P}b', 'X')::jsonb;
  if g_old <> g_new or l_old <> l_new or g_new = 0 then bad := bad || format('2: claim_daily_earn old %s %s, new %s %s; ', g_old, l_old, g_new, l_new); end if;
  if pg_temp.ref_add_voice_minutes(array['${P}a']) <> add_voice_minutes(array['${P}b']) then bad := bad || '2: add_voice_minutes; '; end if;
  n := 0;
  for pid in select id from players order by id limit 60 loop
    if dailies_view(pid) is distinct from pg_temp.ref_dailies_view(pid) then n := n + 1; end if;
  end loop;
  if n > 0 then bad := bad || format('2: dailies_view differs for %s members; ', n); end if;

  -- 3. A live pack_earn_mult = 2 event (admin_packrate) = the old text with the base x 2.
  r := admin_packrate(2, 24, '${A}');
  ev := (r->'event'->>'id')::bigint;
  if ev is null or (select status from events where id = ev) <> 'live' then raise exception 'RESULT:FAIL 4: admin_packrate 2 did not make a live event: %', r; end if;
  if game_var('pack_earn_mult') <> base * 2 then bad := bad || format('4: game_var = %s, not base x 2; ', game_var('pack_earn_mult')); end if;
  perform pg_temp.member('${P}c'); perform pg_temp.member('${P}d');
  g_new := claim_daily_earn('${P}c', d, 0, 0, 0);
  update balance set value = to_jsonb(base * 2) where key = 'pack_earn_multiplier';
  g_old := pg_temp.ref_claim_daily_earn('${P}d', d, 0, 0, 0);
  update balance set value = to_jsonb(base) where key = 'pack_earn_multiplier';
  l_old := replace(pg_temp.ledger('${P}d')::text, '${P}d', 'X')::jsonb; l_new := replace(pg_temp.ledger('${P}c')::text, '${P}c', 'X')::jsonb;
  if g_new <> g_old or l_new <> l_old then bad := bad || format('3: with the event claim_daily_earn gives %s %s, the old text with base x 2 gives %s %s; ', g_new, l_new, g_old, l_old); end if;
  if g_new <= (select coalesce(sum(amount), 0) from pack_ledger where player_id = '${P}b') and g_new < balance_num('daily', 'cap') then bad := bad || '3: the event did not raise the earned packs; '; end if;
  -- 4. edit, end, refuse
  r2 := admin_packrate(3, 48, '${A}');
  if (select count(*) from events where key like 'packrate\_%' and status = 'live') <> 1 or (select vars->>'pack_earn_mult' from events where id = ev) <> '3' then
    bad := bad || '4: admin_packrate 3 did not edit the one live event: ' || r2::text || '; ';
  end if;
  if not exists (select 1 from event_log where event_id = ev and action = 'edit' and new->'vars'->>'pack_earn_mult' = '3') then bad := bad || '4: event_log has no edit row; '; end if;
  if game_var('pack_earn_mult') <> base * 3 then bad := bad || '4: game_var after the edit; '; end if;
  r2 := admin_packrate(9, 24, '${A}');
  if coalesce((r2->>'ok')::boolean, true) then bad := bad || '4: a factor of 9 was accepted; '; end if;
  r2 := admin_packrate(2, 0, '${A}');
  if coalesce((r2->>'ok')::boolean, true) then bad := bad || '4: 0 hours was accepted; '; end if;
  r2 := admin_packrate(2, 62 * 24 + 1, '${A}');
  if coalesce((r2->>'ok')::boolean, true) then bad := bad || '4: more than 62 days was accepted; '; end if;
  r2 := admin_packrate(1, null, '${A}');
  if (select status from events where id = ev) <> 'ended' or game_var('pack_earn_mult') <> base then bad := bad || '4: admin_packrate 1 did not end the event; '; end if;
  if (admin_packrate(1, null, '${A}')->>'note') is distinct from 'none' then bad := bad || '4: a second 1 is not none; '; end if;
  -- the pause: a live factor 0
  r := admin_packrate(0, 1, '${A}');
  perform pg_temp.member('${P}e');
  if (claim_daily('${P}e', 'chat')->>'error') is distinct from 'paused' then bad := bad || '3: claim_daily is not paused by a live factor 0; '; end if;
  if add_voice_minutes(array['${P}e']) <> 0 then bad := bad || '3: add_voice_minutes counts during a pause; '; end if;
  if not coalesce((dailies_view('${P}e')->>'paused')::boolean, false) then bad := bad || '3: dailies_view is not paused; '; end if;
  if claim_daily_earn('${P}e', d, 0, 0, 0) <> 0 then bad := bad || '3: claim_daily_earn grants during a pause; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
