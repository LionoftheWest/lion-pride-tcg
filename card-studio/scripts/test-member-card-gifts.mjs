// Acceptance test for member_card_gifts_redeem.sql (live DB, rolled back): node scripts/test-member-card-gifts.mjs [old]
import fs from 'fs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const mig = process.argv[2] === 'old' ? '' : fs.readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/member_card_gifts_redeem.sql', import.meta.url)), 'utf8');
const body = `do $t$
declare bad text := ''; cid bigint; g bigint; r jsonb; q int;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  insert into players (id, username) values ('tst_mg_a', 'tst a'), ('tst_mg_b', 'tst b');
  select id into cid from cards where rarity = 'normal' and tradeable limit 1;
  insert into player_cards (player_id, card_id, quantity) values ('tst_mg_a', cid, 2);
  if not gift_card('tst_mg_a', 'tst_mg_b', cid) then bad := bad || 'gift refused; '; end if;
  select quantity into q from player_cards where player_id = 'tst_mg_a' and card_id = cid;
  if q is distinct from 1 then bad := bad || 'sender kept ' || coalesce(q, 0) || '; '; end if;
  if exists (select 1 from player_cards where player_id = 'tst_mg_b' and card_id = cid) then bad := bad || 'receiver got it before redeem; '; end if;
  select id into g from gift_claims where player_id = 'tst_mg_b' and kind = 'card' and card_id = cid and from_id = 'tst_mg_a';
  if g is null then bad := bad || 'no gift in the bell; '; else
    r := claim_gift('tst_mg_b', g);
    if not (r->>'ok')::boolean or r->>'card_id' is null then bad := bad || 'claim ' || r::text || '; '; end if;
    if not exists (select 1 from player_cards where player_id = 'tst_mg_b' and card_id = cid) then bad := bad || 'no card after redeem; '; end if;
  end if;
  raise exception 'RESULTS [%]', bad;
end $t$;`;
const out = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }) })).text();
const m = out.match(/RESULTS \[([^\]]*)\]/);
console.log(m ? (m[1] ? 'FAIL ' + m[1] : 'PASS: the card leaves the sender, waits in the bell, and arrives on redeem') : 'NO RESULTS ' + out.slice(0, 400));
