/**
 * Acceptance test for tcg-bot/supabase/launch_event_cards.sql on the LIVE database, NO lasting
 * change: node scripts/test-launch-event-cards.mjs [--old]   (one DO block, rolled back)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv.includes('--old') ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/launch_event_cards.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; h bigint := 101698; hb bigint; att bigint; sid bigint; pc bigint; r jsonb; g bigint; n int;
  d date := (now() at time zone 'America/Denver')::date; crash int; credit bigint; i int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  insert into players (id, username) values ('tst_lc_a', 'tst a'), ('tst_lc_b', 'tst b'), ('tst_lc_c', 'tst c');
  -- 1. Raider: a first fight in the launch boss gives ONE gift; a later fight gives none.
  -- order by: the same card on every database (2026-10-02: without it a restored copy picked another card).
  select c.id into att from cards c join subjects s on s.id = c.subject_id where s.type = 'Character' and c.rarity = 'normal' order by c.id limit 1;
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, 'tst_lc_a', att, d - 1, 0);
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, 'tst_lc_a', att, d - 2, 0);
  select count(*) into n from gift_claims where player_id = 'tst_lc_a' and reason = 'event:launch_raider';
  if n is distinct from 1 then bad := bad || 'raider gifts ' || coalesce(n, 0) || '; '; end if;
  -- 2. Redeem: the card goes to the collection; a second redeem fails.
  select id into g from gift_claims where player_id = 'tst_lc_a' and reason = 'event:launch_raider';
  r := claim_gift('tst_lc_a', g);
  if g is null or not coalesce((r->>'ok')::boolean, false)
     or (select quantity from player_cards where player_id = 'tst_lc_a' and card_id = 378) is distinct from 1 then
    bad := bad || 'redeem ' || coalesce(r::text, 'none') || '; '; end if;
  if g is not null and coalesce((claim_gift('tst_lc_a', g)->>'ok')::boolean, false) then bad := bad || 'redeemed twice; '; end if;
  -- 3. A pack gift still works.
  perform give_gift('tst_lc_b', 'promo', 'tst', 2, 'admin');
  select id into g from gift_claims where player_id = 'tst_lc_b' and reason = 'admin';
  if (claim_gift('tst_lc_b', g)->>'packs')::int is distinct from 2 then bad := bad || 'pack gift; '; end if;
  -- 4. Player card (a test card): a tutorial finished in the window gets the gift + the card its boon.
  insert into subjects (key, name) values ('tst-launch-player', 'tst launch player') returning id into sid;
  insert into cards (subject_id, name, rarity) values (sid, 'tst Launch Day Player', 'event') returning id into pc;
  insert into pack_ledger (player_id, amount, reason) values ('tst_lc_c', 1, 'tutorial');
  n := set_launch_player_card(pc);
  if not exists (select 1 from gift_claims where player_id = 'tst_lc_c' and reason = 'event:launch_player' and card_id = pc) then bad := bad || 'player backfill; '; end if;
  if (select effect->>'primitive' from subjects where id = sid) is distinct from 'launch_party' then bad := bad || 'player effect; '; end if;
  -- 5. Raid Crasher: B pranks A; A's next 3 hits push extra damage to the boss, credited to B; hit 4 none.
  insert into player_cards (player_id, card_id, quantity) values ('tst_lc_b', 378, 1) on conflict do nothing;
  r := play_card_effect('tst_lc_b', 378, 'tst_lc_a');
  if not coalesce((r->>'ok')::boolean, false) or r->>'outcome' is distinct from 'applied' then bad := bad || 'crasher play ' || coalesce(r::text, 'none') || '; '; end if;
  if (r->>'ready_at')::timestamptz < now() + interval '167 hours' then bad := bad || 'crasher cooldown ' || (r->>'ready_at') || '; '; end if;
  insert into player_cards (player_id, card_id, quantity) values ('tst_lc_a', att, 1) on conflict do nothing;
  -- The fights need a live boss: its own (rolled back), because the launch boss is defeated.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Test Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into hb;
  crash := 0;
  -- A fixed seed: a miss (8 %) in hits 1-3 left a charge for hit 4 (a flaky run, 2026-10-06).
  perform setseed(0.42);
  for i in 1..4 loop
    -- The boss hits back and can down the test card after 1-2 hits (a flaky run, 2026-10-02): heal it.
    update hunt_card_hp set hp_remaining = max_hp, downed = false where hunt_id = hb and player_id = 'tst_lc_a';
    r := hunt_attack('tst_lc_a', hb, att);
    exit when not coalesce((r->>'ok')::boolean, false);
    if i <= 3 and (r->>'damage')::int > 0 and r->>'crashed' is null then bad := bad || 'hit ' || i || ' not crashed; '; end if;
    if i = 4 and r->>'crashed' is not null then bad := bad || 'hit 4 crashed; '; end if;
    crash := crash + coalesce((r->>'crashed')::int, 0);
  end loop;
  select coalesce(sum(damage), 0) into credit from hunt_hits where hunt_id = hb and player_id = 'tst_lc_b';
  if credit <> crash or crash = 0 then bad := bad || 'credit ' || credit || ' vs crashed ' || crash || '; '; end if;
  -- 6. Launch Party: C plays the Player card on A: 8 charges, then it is used up.
  insert into player_cards (player_id, card_id, quantity) values ('tst_lc_c', pc, 1) on conflict do nothing;
  r := play_card_effect('tst_lc_c', pc, 'tst_lc_a');
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'party play ' || coalesce(r::text, 'none') || '; '; end if;
  if (select (options->>'uses')::int from player_effects where player_id = 'tst_lc_a' and primitive = 'launch_party' and consumed_at is null) is distinct from 8 then bad := bad || 'party uses; '; end if;
  for i in 1..9 loop perform use_effect_charge('tst_lc_a', 'launch_party'); end loop;
  if exists (select 1 from player_effects where player_id = 'tst_lc_a' and primitive = 'launch_party' and consumed_at is null) then bad := bad || 'party not used up; '; end if;
  -- 7. Event cards stay untradeable.
  if create_trade_open('tst_lc_a', 'tst_lc_b', 378) is not null then bad := bad || 'raider tradeable; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: %]', sqlerrm;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1200)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: Raider gift once + redeem; pack gifts still work; Player backfill + boon; Raid Crasher 3 hits credited to the prankster; Launch Party 8 charges; untradeable');
