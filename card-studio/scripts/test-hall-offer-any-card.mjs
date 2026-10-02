/**
 * Acceptance test for tcg-bot/supabase/hall_offer_any_card.sql on the LIVE database, NO lasting change
 * (one DO block, rolled back): an offer on a listing takes any same-rarity card (not only a wishlist
 * card); another rarity is still refused.
 *   node scripts/test-hall-offer-any-card.mjs
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hall_offer_any_card.sql', import.meta.url)), 'utf8');
const body = String.raw`do $t$
declare bad text := ''; n1 bigint; n2 bigint; n3 bigint; sr bigint; lid bigint; r jsonb;
begin
  execute $m$${mig}$m$;
  select id into n1 from cards where rarity = 'normal' and tradeable order by id limit 1;
  select id into n2 from cards where rarity = 'normal' and tradeable order by id offset 1 limit 1;
  select id into n3 from cards where rarity = 'normal' and tradeable order by id offset 2 limit 1;
  select id into sr from cards where rarity = 'secret_rare' and tradeable order by id limit 1;
  insert into players (id, username) values ('tst_oa_s', 's'), ('tst_oa_b', 'b');
  insert into player_cards (player_id, card_id, quantity) values ('tst_oa_s', n1, 1), ('tst_oa_b', n2, 1), ('tst_oa_b', sr, 1);
  insert into wishlists (player_id, slot, card_id) values ('tst_oa_s', 1, n3); -- the seller wants n3, not n2
  lid := (list_for_trade('tst_oa_s', n1)->>'id')::bigint;
  r := offer_on_listing('tst_oa_b', lid, n2);
  if not (r->>'ok')::boolean then bad := bad || 'a same-rarity card off the wishlist refused ' || r::text || '; '; end if;
  r := offer_on_listing('tst_oa_b', lid, sr);
  if (r->>'ok')::boolean then bad := bad || 'another rarity accepted; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 800)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: any same-rarity card can be offered on a listing; another rarity is refused');
