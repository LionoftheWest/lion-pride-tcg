/**
 * Acceptance test for tcg-bot/supabase/game_vars_all.sql (F-1 PR 6), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-game-vars-all.mjs     must PASS (the file is applied twice)
 *   MUTATE=<name> ...                                                                        must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                           runs every mutation and prints one line each
 * The old text of each reader (the reference copies pg_temp.ref_<name>) is the file's text with every edit of
 * test-game-vars-all.edits.json put back (the edits that made the file from the live text). One mutation puts back ONE edit.
 * Invariants (docs/foundations.md F-1 items 2 and 5):
 *   1. No live event (sameness, as perf_five_slow_calls.sql's test): every reader gives the same answer, state and ledger rows as
 *      the old text: claim_daily_earn, claim_daily, dailies_view, dungeon_loot, dungeon_offers, dungeon_enter, dungeon_after_kill
 *      (the same random seed), dungeon_view_core, settle_hunt, shop_today, buy_shop_item; dungeon_chest_shards = the old chest
 *      formula; bot_game_vars hunt_prizes = balance hunt_prizes.
 *   2. A live event (daily_shards 2, daily_cap raised, dungeon_shards_mult 2, dungeon_loot_chance 1, hunt_prize_mult 2,
 *      shop_price_mult 0.5): every payout changes by the factor inside the limits: the daily Shards x 2 and the higher cap
 *      (claim_daily, claim_daily_earn, dailies_view); every Dungeon Shards amount x 2 (kill, floor, chest of a room and of a door,
 *      offer, run cap and the cap shown); every kill drops a card; the Hunt prizes x 2 (settle_hunt and bot_game_vars); the Shop
 *      shows and charges half (pack, card, stat reset). The grants are ledger rows (shard_ledger, pack_ledger).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/game_vars_all.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const EDITS = JSON.parse(readFileSync(fileURLToPath(new URL('./test-game-vars-all.edits.json', import.meta.url)), 'utf8'));
const sectionOf = (src, name) => { const s = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`); if (s < 0) throw new Error(`no ${name} in the file`); const e = src.indexOf('$function$;', s); return [s, e + 11]; };
// Mutations: put back one edit (in its function only), and break each one-place formula.
const MUT = {};
for (const [name, pairs] of Object.entries(EDITS)) pairs.forEach(([a, b], i) => { MUT[`${name}#${i}`] = [`CREATE OR REPLACE FUNCTION public.${name}(`, b, a]; });
Object.assign(MUT, {
  h_dshards: ['create or replace function public.game_dungeon_shards', "game_var('dungeon_shards_mult', p_now)", '1'],
  h_chest: ['create or replace function public.dungeon_chest_shards', "* p_floor));", "* p_floor + 1));"],
  h_hunt: ['create or replace function public.game_hunt_prizes', "game_var('hunt_prize_mult', p_now) f", '1 f'],
  h_shop: ['create or replace function public.game_shop_price', "game_var('shop_price_mult', p_now)", '1'],
});
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 140)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
// The reference copies: built from the UNMUTATED file.
const refs = Object.entries(EDITS).filter(([n]) => n !== 'bot_game_vars').map(([name, pairs]) => {
  const [s, e] = sectionOf(mig, name); let txt = mig.slice(s, e);
  for (const [a, b] of pairs) { if (!txt.includes(b)) throw new Error(`${name}: the edit is not in the file: ${b.slice(0, 60)}`); txt = txt.replace(b, a); }
  return txt.replace(`public.${name}(`, `pg_temp.ref_${name}(`);
}).join('\n\n');
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
if (mig.includes('$m$') || mig.includes('$t$') || refs.includes('$m$')) throw new Error('the migration must not contain $m$ or $t$');

const P = 'tst_gva_', A = 'tst_gva_admin';
const body = String.raw`do $t$
declare bad text := ''; T timestamptz := date_trunc('second', now()); d date := game_day(); r jsonb; r2 jsonb; v jsonb; w jsonb; x jsonb; y jsonb;
  ev bigint; n int; i int; k int; pid text; sq bigint[]; run dungeon_runs; st jsonb; h bigint; card bigint := (select id from cards order by id limit 1);
  sh0 int; cap0 int; pk0 int; hp jsonb; old_paid jsonb; new_paid jsonb; a1 int; a2 int; c1 bigint;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', '${A}', true);
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent
  execute $m$${refs}$m$;
  update settings set value = value || '{"enabled": true}' where key in ('dailies', 'dungeon', 'gauntlet', 'shards');
  update balance set value = value || '{"enabled": true}' where key = 'stat_points';
  update events set status = 'cancelled', ended_at = T where status in ('scheduled', 'live') and vars <> '{}'::jsonb;
  if balance_num('daily', 'shards') <= 0 then update balance set value = jsonb_set(value, '{shards}', '5') where key = 'daily'; end if;
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  sh0 := balance_num('daily', 'shards')::int; cap0 := balance_num('daily', 'cap')::int; pk0 := (shard_cfg()->>'pack_price')::int;
  -- members: a full chat day, Shards, and the Dungeon cards (the setup of test-dungeon-auto-rounds.mjs)
  create function pg_temp.member(p text) returns void language plpgsql as $f$
  begin
    insert into players (id, username) values (p, 'tst ' || p) on conflict do nothing;
    insert into daily_activity (player_id, activity_date, message_count) values (p, game_day(), balance_num('daily', 'chat_bonus_at')::int)
      on conflict (player_id, activity_date) do update set message_count = excluded.message_count, base_claimed = false, bonus_claimed = false;
    perform grant_shards(p, 100000, 'admin', 'test', p);
    insert into player_cards (player_id, card_id, quantity)
      select p, z, 1 from unnest((select array_agg(id order by id) from (select c.id from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 10) w)
        || array(select min(c.id) from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature') group by s.ability->>'effect')) z
      on conflict do nothing;
  end $f$;
  create function pg_temp.ledger(p text) returns jsonb language sql as $f$
    select jsonb_build_object('pack', (select coalesce(jsonb_agg(jsonb_build_array(reason, amount, ref_kind, case when ref_kind = 'shop_purchase' then null else replace(ref_id, p, 'X') end) order by id), '[]') from pack_ledger where player_id = p),
                              'shard', (select coalesce(jsonb_agg(jsonb_build_array(reason, amount, ref_kind, case when ref_kind = 'shop_purchase' then null else replace(ref_id, p, 'X') end) order by id), '[]') from shard_ledger where player_id = p and reason <> 'admin')) $f$;
  create function pg_temp.norm(j jsonb, p text) returns jsonb language sql as $f$ select replace(j::text, p, 'X')::jsonb $f$;
  select array_agg(id order by o) into sq from (
    (select c.id, 1 o from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 3)
    union all
    (select min(c.id), 2 from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'kind' = 'support' and s.type not in ('Character', 'Creature')
      and s.ability->>'effect' in ('heal', 'smite') group by s.ability->>'effect')) z;
  -- a Hunt with 3 hitters (places 1, 2, 3)
  create function pg_temp.hunt() returns bigint language plpgsql as $f$
  declare h bigint;
  begin
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status) values ('tst gva', 'Normal', '[]', 1000, 1000, now() + interval '1 day', 'expired') returning id into h;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage)
      select h, 'tst_gva_h' || g, (select id from cards order by id limit 1), current_date, 100 * (4 - g) from generate_series(1, 3) g;
    return h;
  end $f$;
  perform pg_temp.member('${P}h1'); perform pg_temp.member('${P}h2'); perform pg_temp.member('${P}h3');
  perform pg_temp.member('${P}a'); perform pg_temp.member('${P}b'); perform pg_temp.member('${P}c'); perform pg_temp.member('${P}d');

  -- ===== 1. No live event: the same as the old text.
  if game_hunt_prizes() <> balance_get('hunt_prizes') || jsonb_build_object('base', balance_num('hunt_prizes', 'base')::int) or bot_game_vars()->'hunt_prizes' is distinct from game_hunt_prizes() then
    bad := bad || '1: game_hunt_prizes / bot_game_vars hunt_prizes are not balance hunt_prizes; ';
  end if;
  a1 := pg_temp.ref_claim_daily_earn('${P}a', d, 0, 0, 0); a2 := claim_daily_earn('${P}b', d, 0, 0, 0);
  if a1 <> a2 or pg_temp.ledger('${P}a') <> pg_temp.ledger('${P}b') then bad := bad || format('1: claim_daily_earn %s %s / %s %s; ', a1, pg_temp.ledger('${P}a'), a2, pg_temp.ledger('${P}b')); end if;
  r := pg_temp.ref_claim_daily('${P}c', 'checkin'); r2 := claim_daily('${P}d', 'checkin');
  if pg_temp.norm(r, '${P}c') <> pg_temp.norm(r2, '${P}d') or pg_temp.ledger('${P}c') <> pg_temp.ledger('${P}d') then bad := bad || format('1: claim_daily %s / %s; ', r, r2); end if;
  n := 0; k := 0;
  for pid in select id from players order by id limit 40 loop
    if dailies_view(pid) is distinct from pg_temp.ref_dailies_view(pid) then n := n + 1; end if;
    if dungeon_view_core(pid, true) is distinct from pg_temp.ref_dungeon_view_core(pid, true) then k := k + 1; end if;
    if pg_temp.norm(shop_today(pid), pid) is distinct from pg_temp.norm(pg_temp.ref_shop_today(pid), pid) then k := k + 1000; end if;
  end loop;
  if n > 0 or k > 0 then bad := bad || format('1: dailies_view differs for %s, dungeon_view_core / shop_today %s; ', n, k); end if;
  st := '{"bank": {"shards": 10, "cards": []}, "pend": {"shards": 5, "cards": []}}';
  foreach i in array array[0, 7, 50, 100000] loop
    if dungeon_loot(st, i, null) <> pg_temp.ref_dungeon_loot(st, i, null) then bad := bad || format('1: dungeon_loot %s; ', i); end if;
  end loop;
  for i in 1 .. 25 loop
    perform setseed(i / 100.0); x := dungeon_offers('{"cards": {}}', 1 + i % 6);
    perform setseed(i / 100.0); y := pg_temp.ref_dungeon_offers('{"cards": {}}', 1 + i % 6);
    if x <> y then bad := bad || format('1: dungeon_offers seed %s; ', i); exit; end if;
    perform setseed(i / 100.0); x := dungeon_enter(st, '[[{"type": "treasure", "foes": []}]]', 1, 1);
    perform setseed(i / 100.0); y := pg_temp.ref_dungeon_enter(st, '[[{"type": "treasure", "foes": []}]]', 1, 1);
    if x <> y then bad := bad || format('1: dungeon_enter seed %s; ', i); exit; end if;
  end loop;
  for i in 1 .. 5 loop for k in 1 .. 8 loop
    if dungeon_chest_shards(i, k) <> round(balance_num('dungeon_rewards', 'chest', 'shards', (i - 1)::text) + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * k) then
      bad := bad || format('1: dungeon_chest_shards(%s, %s); ', i, k);
    end if;
  end loop; end loop;
  -- a run for dungeon_after_kill (a guardian room with every foe down) and the door chest
  r := dungeon_start('${P}a', sq);
  select * into run from dungeon_runs where id = (r->>'run')::bigint;
  if run.id is null then raise exception 'RESULT:FAIL 1: no Dungeon run: % (squad %)', r, sq; end if;
  run.state := run.state || '{"room_type": "guardian", "foes": [{"hp": 0}], "bank": {"shards": 0, "cards": []}, "pend": {"shards": 0, "cards": []}}';
  for i in 1 .. 5 loop
    perform setseed(i / 10.0); x := dungeon_after_kill(run, run.state);
    perform setseed(i / 10.0); y := pg_temp.ref_dungeon_after_kill(run, run.state);
    if x <> y then bad := bad || format('1: dungeon_after_kill seed %s; ', i); exit; end if;
  end loop;
  -- settle_hunt: the old text and the new text on the same Hunt (each in a block that rolls back)
  h := pg_temp.hunt();
  begin old_paid := pg_temp.ref_settle_hunt(h)->'paid'; raise exception using errcode = 'P0099'; exception when sqlstate 'P0099' then null; end;
  begin new_paid := settle_hunt(h)->'paid'; raise exception using errcode = 'P0099'; exception when sqlstate 'P0099' then null; end;
  if old_paid is distinct from new_paid or old_paid is null then bad := bad || format('1: settle_hunt %s / %s; ', old_paid, new_paid); end if;
  -- buy_shop_item: a pack
  r := pg_temp.ref_buy_shop_item('${P}c', 'pack', null, null, 2); r2 := buy_shop_item('${P}d', 'pack', null, null, 2);
  if (r->>'ok')::boolean is distinct from true or pg_temp.norm(r, '${P}c') <> pg_temp.norm(r2, '${P}d') or pg_temp.ledger('${P}c') <> pg_temp.ledger('${P}d') then bad := bad || format('1: buy_shop_item pack %s / %s; ', r, r2); end if;

  -- ===== 2. A live event.
  r := admin_event_save(jsonb_build_object('key', 'tst_gva_ev', 'kind', 'modifier', 'title', 'Everything', 'starts_at', T - interval '1 minute', 'ends_at', T + interval '1 day',
         'vars', jsonb_build_object('daily_shards', 2, 'daily_cap', least(cap0 + 3, 20), 'dungeon_shards_mult', 2, 'dungeon_loot_chance', 1, 'hunt_prize_mult', 2, 'shop_price_mult', 0.5)), null, '${A}', null);
  ev := (r->'event'->>'id')::bigint;
  if ev is null then raise exception 'RESULT:FAIL 2: the event was refused: %', r; end if;
  perform admin_event_schedule(ev, (select updated_at from events where id = ev), '${A}', true);
  perform event_tick(T);
  -- the daily
  perform pg_temp.member('${P}e'); perform pg_temp.member('${P}f');
  v := dailies_view('${P}e');
  if (v->>'shards')::int <> sh0 * 2 or (v->>'cap')::int <> greatest(cap0, least(cap0 + 3, 20)) then bad := bad || '2: dailies_view ' || jsonb_build_object('shards', v->'shards', 'cap', v->'cap')::text || '; '; end if;
  perform grant_packs('${P}e', cap0, 'earned_daily', null, 'daily_claim', 'tst:e');   -- the old cap is used up
  perform grant_packs('${P}f', cap0, 'earned_daily', null, 'daily_claim', 'tst:f');
  r := claim_daily('${P}e', 'checkin');
  if not exists (select 1 from shard_ledger where player_id = '${P}e' and reason = 'daily' and amount = sh0 * 2) then bad := bad || '2: claim_daily did not pay the daily Shards x 2; '; end if;
  if coalesce((select sum(amount) from pack_ledger where player_id = '${P}e' and ref_kind = 'daily_claim' and ref_id like '%:checkin'), 0) <= 0 then bad := bad || '2: claim_daily paid no pack above the old cap: ' || r::text || '; '; end if;
  a1 := claim_daily_earn('${P}f', d, 0, 0, 0);
  if a1 <= 0 then bad := bad || '2: claim_daily_earn paid no pack above the old cap; '; end if;
  if (select count(*) from shard_ledger where player_id = '${P}f' and reason = 'daily' and amount = sh0 * 2) <> 2 then bad := bad || '2: claim_daily_earn did not pay the daily Shards x 2 for each claim; '; end if;
  -- the Dungeon
  if game_dungeon_shards(10) <> 20 then bad := bad || '2: game_dungeon_shards(10) is not 20; '; end if;
  if (dungeon_loot('{}', 100000, null)->'pend'->>'shards')::int <> 2 * balance_num('dungeon_rewards', 'run_shards_cap')::int then bad := bad || '2: the run cap is not x 2; '; end if;
  if (dungeon_view_core('${P}e', false)->>'cap')::int <> 2 * balance_num('dungeon_rewards', 'run_shards_cap')::int then bad := bad || '2: the cap shown is not x 2; '; end if;
  n := 0;
  for i in 1 .. 40 loop
    perform setseed(i / 100.0); x := dungeon_offers('{"cards": {}}', 3);
    perform setseed(i / 100.0); y := pg_temp.ref_dungeon_offers('{"cards": {}}', 3);
    for k in 0 .. jsonb_array_length(x) - 1 loop
      if x->k->>'kind' = 'shards' then n := n + 1;
        if (x->k->>'amount')::numeric <> 2 * (y->k->>'amount')::numeric then bad := bad || format('2: a Shards offer %s, the old %s; ', x->k->'amount', y->k->'amount'); exit; end if;
      end if;
    end loop;
    perform setseed(i / 100.0); x := dungeon_enter(st, '[[{"type": "treasure", "foes": []}]]', 1, 1);
    perform setseed(i / 100.0); y := pg_temp.ref_dungeon_enter(st, '[[{"type": "treasure", "foes": []}]]', 1, 1);
    if (x->'chest'->>'shards')::int <> 2 * (y->'chest'->>'shards')::int then bad := bad || format('2: a room chest %s, the old %s; ', x->'chest'->'shards', y->'chest'->'shards'); exit; end if;
  end loop;
  if n = 0 then bad := bad || '2: no Shards offer was made in 40 seeds; '; end if;
  for i in 1 .. 5 loop
    perform setseed(i / 10.0); x := dungeon_after_kill(run, run.state);
    perform setseed(i / 10.0); y := pg_temp.ref_dungeon_after_kill(run, run.state);
    if (x->>'card') is null then bad := bad || '2: a kill with loot chance 1 dropped no card; '; exit; end if;
    if (x->>'shards')::int <> 2 * (y->>'shards')::int or (x->'state'->'bank'->>'shards')::int <> 2 * (y->'state'->'bank'->>'shards')::int then
      bad := bad || format('2: the kill and floor Shards %s %s, the old %s %s; ', x->'shards', x->'state'->'bank'->'shards', y->'shards', y->'state'->'bank'->'shards'); exit;
    end if;
  end loop;
  -- the rare chest of a door (dungeon_choose)
  update dungeon_runs set state = state || '{"phase": "path", "offers": [{"kind": "door", "to": "treasure_rare"}], "pend": {"shards": 0, "cards": []}, "bank": {"shards": 0, "cards": []}}' where id = run.id;
  r := dungeon_choose('${P}a', 0, 'daily');
  a1 := balance_num('dungeon_rewards', 'door', 'rare_tier')::int;
  if (r->'state'->'chest'->>'shards')::int is distinct from 2 * round(balance_num('dungeon_rewards', 'chest', 'shards', (a1 - 1)::text) + balance_num('dungeon_rewards', 'chest', 'shards_per_floor') * run.floor)::int then
    bad := bad || format('2: the door chest %s; ', coalesce(r->'state'->'chest'->>'shards', r::text));
  end if;
  -- the Hunt
  hp := bot_game_vars()->'hunt_prizes';
  if (hp->>'base')::int is distinct from round(balance_num('hunt_prizes', 'base') * 2)::int or hp is distinct from game_hunt_prizes() then bad := bad || '2: bot_game_vars hunt_prizes ' || hp::text || '; '; end if;
  begin new_paid := settle_hunt(h)->'paid'; raise exception using errcode = 'P0099'; exception when sqlstate 'P0099' then null; end;
  if (select jsonb_agg(round((o->>'packs')::numeric * 2)::int order by o->>'player_id') from jsonb_array_elements(old_paid) o)
     is distinct from (select jsonb_agg((o->>'packs')::int order by o->>'player_id') from jsonb_array_elements(new_paid) o) then
    bad := bad || format('2: settle_hunt paid %s, the old x 2 is %s; ', new_paid, old_paid);
  end if;
  -- the Shop: half price
  v := shop_today('${P}e');
  if (v->>'pack_price')::int <> round(pk0 * 0.5) or (v->>'stat_reset_price')::int <> round((shard_cfg()->>'stat_reset_price')::int * 0.5)
     or exists (select 1 from jsonb_array_elements(v->'stock') s join shop_stock z on z.day = shop_day() and z.slot = (s->>'slot')::int where (s->>'price')::int <> round(z.price * 0.5)) then
    bad := bad || '2: shop_today prices ' || jsonb_build_object('pack', v->'pack_price', 'reset', v->'stat_reset_price')::text || '; ';
  end if;
  r := buy_shop_item('${P}e', 'pack', null, null, 2);
  if not exists (select 1 from shard_ledger where player_id = '${P}e' and reason = 'shop' and amount = -2 * round(pk0 * 0.5)) then bad := bad || '2: a pack was not charged half: ' || r::text || '; '; end if;
  select slot, price into a1, a2 from shop_stock where day = shop_day() order by slot limit 1;
  if a1 is not null then
    r := buy_shop_item('${P}e', 'card', a1, null, 1);
    if not exists (select 1 from shard_ledger where player_id = '${P}e' and reason = 'shop' and amount = -round(a2 * 0.5)) then bad := bad || '2: a stock card was not charged half: ' || r::text || '; '; end if;
  end if;
  select card_id into c1 from player_cards where player_id = '${P}e' order by card_id limit 1;
  update player_cards set stat_points = '{"atk": 1}' where player_id = '${P}e' and card_id = c1;
  update players set stat_reset_week = to_char(now() at time zone 'America/Denver', 'IYYY-IW') where id = '${P}e';   -- the free reset is used
  r := buy_shop_item('${P}e', 'stat_reset', null, c1, 1);
  if (r->>'price')::int is distinct from round((shard_cfg()->>'stat_reset_price')::int * 0.5)::int then bad := bad || '2: a stat reset was not charged half: ' || r::text || '; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
