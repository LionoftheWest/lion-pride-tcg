/**
 * Acceptance test for tcg-bot/supabase/event_cards.sql on the LIVE database, NO lasting change:
 *   node scripts/test-event-cards.mjs [--old]   (one DO block; the exception rolls it back)
 * Event power = Full Art (75 base); an Event card can never be traded or gifted.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv.includes('--old') ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/event_cards.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; sid bigint; cid bigint; tr boolean; pool boolean; r bigint;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  if card_power('event', 0, 1.0) <> card_power('full_art', 0, 1.0) then bad := bad || 'event power ' || card_power('event', 0, 1.0) || '; '; end if;
  if (card_combat('event', 0, 1.0, '{}'::jsonb)->>'cp')::int <> (card_combat('full_art', 0, 1.0, '{}'::jsonb)->>'cp')::int then bad := bad || 'event combat cp; '; end if;
  select subject_id into sid from cards limit 1;
  insert into cards (subject_id, name, rarity, tradeable, in_draw_pool, event) values (sid, 'tst event', 'event', true, true, 'Launch Day') returning id, tradeable, in_draw_pool into cid, tr, pool;
  if tr or pool then bad := bad || 'insert kept tradeable=' || tr || ' pool=' || pool || '; '; end if;
  update cards set tradeable = true where id = cid;
  select tradeable into tr from cards where id = cid;
  if tr then bad := bad || 'update made it tradeable; '; end if;
  insert into players (id, username) values ('tst_ev_1', 'tst a'), ('tst_ev_2', 'tst b');
  insert into player_cards (player_id, card_id, quantity) values ('tst_ev_1', cid, 2);
  r := create_trade_open('tst_ev_1', 'tst_ev_2', cid);
  if r is not null then bad := bad || 'trade offer created; '; end if;
  if gift_card('tst_ev_1', 'tst_ev_2', cid) then bad := bad || 'gift went through; '; end if;
  raise exception 'RESULTS [%]', bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 900)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: Event power = Full Art; an Event card stays untradeable (insert + update) and cannot be traded or gifted');
