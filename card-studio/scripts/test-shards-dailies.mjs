/**
 * Acceptance test for tcg-bot/supabase/shards_dailies_gifts.sql on the LIVE database, NO lasting change:
 *   node scripts/test-shards-dailies.mjs              (one DO block; the final RAISE rolls it all back)
 *   MUTATE=capped node scripts/test-shards-dailies.mjs   must FAIL (a daily at the pack limit refused again)
 *   MUTATE=chat   node scripts/test-shards-dailies.mjs   must FAIL (the chat milestone pays Shards every call)
 *   MUTATE=once   node scripts/test-shards-dailies.mjs   must FAIL (a once_ Shards gift can repeat)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRE_REF_FILE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/shards_dailies_gifts.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
const MUT = {
  capped: ["if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;", "if amt <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;"],
  chat: ["    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily', 'chat'); end if;\n  end if;", "  end if;\n    if sh > 0 then perform grant_shards(p_player_id, sh, 'daily', 'daily', 'chat'); end if;"],
  once: ["create unique index if not exists gift_claims_once_kind on public.gift_claims (player_id, kind) where kind like 'once\\_%';", "drop index if exists gift_claims_once_kind;"],
};
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.replace(m[0], m[1]);
}
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; d date := (now() at time zone 'America/Denver')::date; n int; n2 int; g bigint; sb int; pb int;
begin
  ${PRE_REF_FILE(mig)}
  update settings set value = value || '{"enabled": true, "cap": 5, "shards": 40}' where key = 'dailies';
  insert into settings (key, value) values ('pack_earn_multiplier', '1') on conflict (key) do update set value = '1';
  insert into players (id, username) values ('tst_sd_a', 'daily a');
  sb := 0;

  -- 1. Check in: 1 pack + 40 Shards, ledger reason 'daily'; a second claim pays nothing.
  r := claim_daily('tst_sd_a', 'checkin');
  if not (r->>'ok')::boolean or (r->>'packs')::int < 1 or (r->>'shards')::int <> 40 then bad := bad || 'checkin ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_sd_a') <> 40 then bad := bad || 'checkin balance; '; end if;
  if (select count(*) from shard_ledger where player_id = 'tst_sd_a' and reason = 'daily') <> 1 then bad := bad || 'ledger reason; '; end if;
  if (claim_daily('tst_sd_a', 'checkin')->>'error') <> 'claimed' or (select shard_balance from players where id = 'tst_sd_a') <> 40 then bad := bad || 'claimed twice; '; end if;

  -- 2. A daily that is not done pays nothing.
  if (claim_daily('tst_sd_a', 'voice')->>'error') <> 'not_done' then bad := bad || 'voice not done; '; end if;

  -- 3. At the 5-pack earn limit: the voice daily still pays 40 Shards and 0 packs (Nathan's rule).
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values ('tst_sd_a', 5, 'earned_daily', 'test', 'shards-dailies');
  insert into voice_minutes (player_id, day, minutes) values ('tst_sd_a', d, 45);
  pb := (select pack_balance from players where id = 'tst_sd_a');
  r := claim_daily('tst_sd_a', 'voice');
  if not coalesce((r->>'ok')::boolean, false) or (r->>'packs')::int <> 0 or (r->>'shards')::int <> 40 then bad := bad || 'capped daily ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_sd_a') <> 80 or (select pack_balance from players where id = 'tst_sd_a') <> pb then bad := bad || 'capped balances; '; end if;

  -- 4. Paused: nothing pays.
  update settings set value = '0' where key = 'pack_earn_multiplier';
  if (claim_daily('tst_sd_a', 'social')->>'error') <> 'paused' then bad := bad || 'paused; '; end if;
  update settings set value = '1' where key = 'pack_earn_multiplier';

  -- 5. Chat (the bot): 30 messages -> 40 + 40 Shards once; a second call pays nothing more.
  insert into daily_activity (player_id, activity_date, message_count) values ('tst_sd_a', d, 30)
    on conflict (player_id, activity_date) do update set message_count = 30, base_claimed = false, bonus_claimed = false;
  perform claim_daily_earn('tst_sd_a', d, 1, 1, 25);
  if (select shard_balance from players where id = 'tst_sd_a') <> 160 then bad := bad || 'chat shards ' || (select shard_balance from players where id = 'tst_sd_a') || '; '; end if;
  perform claim_daily_earn('tst_sd_a', d, 1, 1, 25);
  if (select shard_balance from players where id = 'tst_sd_a') <> 160 then bad := bad || 'chat paid twice; '; end if;

  -- 6. The window shows 40 per daily and today's total.
  r := dailies_view('tst_sd_a');
  if (r->>'shards')::int <> 40 or (r->>'shards_today')::int <> 160 then bad := bad || 'view ' || (r->>'shards') || '/' || (r->>'shards_today') || '; '; end if;

  -- 7. The Shards gift for everyone: one per member, once; Redeem adds 1,000 Shards and no packs.
  n := give_shards_gift_all('once_tst_stimulus', 'Stimulus package: 1,000 Shards', 1000, null);
  if n <> (select count(*) from players) then bad := bad || 'gift count ' || n || '; '; end if;
  n2 := give_shards_gift_all('once_tst_stimulus', 'Stimulus package: 1,000 Shards', 1000, null);
  if n2 <> 0 then bad := bad || 'gift repeated ' || n2 || '; '; end if;
  select id into g from gift_claims where player_id = 'tst_sd_a' and kind = 'once_tst_stimulus';
  pb := (select pack_balance from players where id = 'tst_sd_a');
  r := claim_gift('tst_sd_a', g);
  if not (r->>'ok')::boolean or (r->>'shards')::int <> 1000 or (r->>'packs')::int <> 0 then bad := bad || 'redeem ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_sd_a') <> 1160 or (select pack_balance from players where id = 'tst_sd_a') <> pb then bad := bad || 'redeem balances; '; end if;
  if (claim_gift('tst_sd_a', g)->>'error') <> 'claimed' or (select shard_balance from players where id = 'tst_sd_a') <> 1160 then bad := bad || 'redeemed twice; '; end if;

  -- 8. A pack gift still works the old way.
  g := give_gift('tst_sd_a', 'promo', 'Five packs', 5, 'event');
  r := claim_gift('tst_sd_a', g);
  if not (r->>'ok')::boolean or (r->>'packs')::int <> 5 or (select pack_balance from players where id = 'tst_sd_a') <> pb + 5 then bad := bad || 'pack gift ' || r::text || '; '; end if;

  -- 9. The ledger always sums to the balance.
  if (select sum(amount) from shard_ledger where player_id = 'tst_sd_a') <> (select shard_balance from players where id = 'tst_sd_a') then bad := bad || 'ledger <> balance; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = msg.match(/RESULT:([^"\\]*)/);
if (!m) { console.error('NO RESULT:', msg.slice(0, 1500)); process.exitCode = 1; }
else if (m[1] === 'PASS') console.log(`PASS${process.env.MUTATE ? ` (MUTATE=${process.env.MUTATE}: the test did NOT catch it)` : ''}`);
else { console.log(`FAIL: ${m[1]}`); process.exitCode = 1; }
