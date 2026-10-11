/**
 * Acceptance test (Nathan, live, 2026-10-11): "in the dailies people can claim their shards even if they have maxed out their
 * daily packs". A member at the daily pack cap claims a daily: the claim succeeds, pays 0 packs and the Shards, the ledgers
 * record exactly that. One DO block, rolled back (the final RAISE), a fake member:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-daily-claim-at-cap.mjs          the live text of claim_daily (db/schema)
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-daily-claim-at-cap.mjs --old    the text before shards_dailies_gifts.sql
 *                                                      (the guard refuses at the cap): case A must FAIL, B and C stay green
 *   A  at the cap: the check-in answers ok, packs 0, Shards 40; no pack_ledger row, pack balance unchanged;
 *      a shard_ledger row (daily, daily_claim, <day>:checkin); a daily_claims row with amount 0; both ledgers sum to the balances
 *   B  under the cap: voice pays 1 pack + 40 Shards, both with ledger rows and refs, balances match
 *   C  a second claim of the same task on the same day is refused ('claimed'), nothing is added to any ledger (under and at the cap)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const snap = readFileSync(fileURLToPath(new URL('../../db/schema/functions/claim_daily.sql', import.meta.url)), 'utf8').replace(/\r/g, '');
let fn = snap.slice(snap.indexOf('CREATE OR REPLACE FUNCTION'), snap.lastIndexOf('$function$;') + '$function$;'.length);
const GUARD = "if amt <= 0 and sh <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;";
if (!fn.includes(GUARD)) throw new Error('the guard line is not in the claim_daily snapshot');
if (old) fn = fn.replace(GUARD, "if amt <= 0 then return jsonb_build_object('ok', false, 'error', 'capped'); end if;");
if (fn.includes('$m$') || fn.includes('$t$')) throw new Error('the function text contains $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; d date := (now() at time zone 'America/Denver')::date; P text := 'tst_dcap'; pb int; sb int; n1 int; n2 int; cap int; sh int;
begin
  execute $m$${fn}$m$;
  update settings set value = value || '{"enabled": true}' where key = 'dailies';
  insert into settings (key, value) values ('pack_earn_multiplier', '1') on conflict (key) do update set value = '1';
  cap := balance_num('daily', 'cap')::int; sh := balance_num('daily', 'shards')::int;
  if cap < 1 or sh < 1 then raise exception 'RESULT:the balance has cap % shards %', cap, sh; end if;
  insert into players (id, username) values (P, 'daily cap');
  insert into voice_minutes (player_id, day, minutes) values (P, d, 600);

  -- B. under the cap: voice pays 1 pack + the Shards, with ledger rows.
  r := claim_daily(P, 'voice');
  if not coalesce((r->>'ok')::boolean, false) or (r->>'packs')::int <> 1 or (r->>'shards')::int <> sh then bad := bad || 'B answer ' || (r - 'view')::text || '; '; end if;
  if (select count(*) from pack_ledger where player_id = P and reason = 'earned_voice' and amount = 1 and ref_kind = 'daily_claim' and ref_id = d::text || ':voice') <> 1 then bad := bad || 'B pack ledger; '; end if;
  if (select count(*) from shard_ledger where player_id = P and reason = 'daily' and amount = sh and ref_kind = 'daily_claim' and ref_id = d::text || ':voice') <> 1 then bad := bad || 'B shard ledger; '; end if;
  if (select pack_balance from players where id = P) <> 1 or (select shard_balance from players where id = P) <> sh then bad := bad || 'B balances; '; end if;

  -- C. the second claim of the same task, the same day: refused, nothing added.
  n1 := (select count(*) from pack_ledger where player_id = P); n2 := (select count(*) from shard_ledger where player_id = P);
  r := claim_daily(P, 'voice');
  if coalesce(r->>'error', '') <> 'claimed' then bad := bad || 'C answer ' || (r - 'view')::text || '; '; end if;
  if (select count(*) from pack_ledger where player_id = P) <> n1 or (select count(*) from shard_ledger where player_id = P) <> n2
     or (select shard_balance from players where id = P) <> sh then bad := bad || 'C ledgers changed; '; end if;

  -- A. at the cap: fill the cap with earned packs, then claim the check-in (it needs no activity).
  insert into pack_ledger (player_id, amount, reason, ref_kind, ref_id) values (P, cap, 'earned_daily', 'test', 'daily-cap-fill');
  update players set pack_balance = pack_balance + cap where id = P;
  pb := (select pack_balance from players where id = P); sb := (select shard_balance from players where id = P);
  n1 := (select count(*) from pack_ledger where player_id = P);
  r := claim_daily(P, 'checkin');
  if not coalesce((r->>'ok')::boolean, false) or (r->>'packs')::int <> 0 or (r->>'shards')::int <> sh then bad := bad || 'A checkin answer ' || (r - 'view')::text || '; '; end if;
  if (select count(*) from pack_ledger where player_id = P) <> n1 or (select pack_balance from players where id = P) <> pb then bad := bad || 'A packs changed at the cap; '; end if;
  if (select shard_balance from players where id = P) <> sb + sh then bad := bad || 'A shard balance; '; end if;
  if (select count(*) from shard_ledger where player_id = P and reason = 'daily' and amount = sh and ref_kind = 'daily_claim' and ref_id = d::text || ':checkin') <> 1 then bad := bad || 'A shard ledger; '; end if;
  if (select amount from daily_claims where player_id = P and day = d and task = 'checkin') is distinct from 0 then bad := bad || 'A daily_claims row; '; end if;
  if (select sum(amount) from shard_ledger where player_id = P) <> (select shard_balance from players where id = P) then bad := bad || 'A shard ledger <> balance; '; end if;
  if (select sum(amount) from pack_ledger where player_id = P) <> (select pack_balance from players where id = P) then bad := bad || 'A pack ledger <> balance; '; end if;
  -- C at the cap: the same check-in again is refused and adds nothing.
  r := claim_daily(P, 'checkin');
  if coalesce(r->>'error', '') <> 'claimed' or (select shard_balance from players where id = P) <> sb + sh then bad := bad || 'C at the cap; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else bad end;
end $t$;`;
const msg = JSON.stringify(await q(body));
const m = msg.match(/RESULT:([^"\\]*)/);
if (!m) { console.error('NO RESULT:', msg.slice(0, 1500)); process.exitCode = 1; }
else if (m[1] === 'PASS') console.log(`${old ? '[--old] ' : ''}PASS (A, B, C)`);
else { console.log(`${old ? '[--old baseline] ' : ''}FAIL: ${m[1]}`); process.exitCode = 1; }
