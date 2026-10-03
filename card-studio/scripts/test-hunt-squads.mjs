/**
 * Acceptance test for tcg-bot/supabase/hunt_squads.sql on the LIVE database, NO lasting change:
 *   node scripts/test-hunt-squads.mjs [--old]   (one DO block; the exception rolls it back)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv.includes('--old') ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_squads.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; h bigint; ids bigint[]; r jsonb; extra bigint;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  -- Its own boss (rolled back): the live boss can be defeated or closed.
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at) values ('Test Boss', 'Normal', '[]', '[]', 500000, 500000, now() + interval '1 day') returning id into h;
  select array_agg(id) into ids from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and c.rarity = 'normal' order by c.id limit 9) x;
  insert into players (id, username) values ('tst_sq_a', 'a'), ('tst_sq_b', 'b');
  insert into player_cards (player_id, card_id, quantity) select p, x, 1 from unnest(ids) x, unnest(array['tst_sq_a', 'tst_sq_b']) p;
  extra := ids[9];
  -- 1. A locks 8 cards; a card outside the squad cannot fight; a squad card can.
  r := lock_hunt_squad('tst_sq_a', h, ids[1:8]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'lock ' || r::text || '; '; end if;
  r := hunt_attack('tst_sq_a', h, extra);
  if coalesce(r->>'error', '') <> 'not_in_squad' then bad := bad || 'outside card fought ' || coalesce(r::text, '') || '; '; end if;
  r := hunt_attack('tst_sq_a', h, ids[1]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'squad card ' || r::text || '; '; end if;
  -- 2. After the first fight the squad is fixed.
  r := lock_hunt_squad('tst_sq_a', h, ids[2:9]);
  if coalesce(r->>'error', '') <> 'squad_fixed' then bad := bad || 'relock after a fight ' || coalesce(r::text, '') || '; '; end if;
  -- 3. B (no squad) fights as before; B is not limited by A's squad.
  r := hunt_attack('tst_sq_b', h, extra);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'no-squad member blocked ' || r::text || '; '; end if;
  -- 4. B now locks a squad: it must keep the card B already used.
  r := lock_hunt_squad('tst_sq_b', h, ids[1:8]);
  if coalesce(r->>'error', '') <> 'must_keep_used' then bad := bad || 'dropped a used card ' || coalesce(r::text, '') || '; '; end if;
  r := lock_hunt_squad('tst_sq_b', h, ids[2:9]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'lock with the used card ' || r::text || '; '; end if;
  -- 5. Bad squads.
  if coalesce((lock_hunt_squad('tst_sq_a', h, array[ids[1], ids[1]])->>'ok')::boolean, false) then bad := bad || 'duplicate; '; end if;
  if coalesce((lock_hunt_squad('tst_sq_a', h, ids || ids[1:1])->>'ok')::boolean, false) then bad := bad || 'too many; '; end if;
  -- 6. A support play takes only squad cards too.
  if coalesce((hunt_commit_card(h, 'tst_sq_a', extra, (now() at time zone 'America/Denver')::date, 60)), false) then bad := bad || 'commit outside the squad; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1200)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: a locked squad fights only with its cards, is fixed after the first fight, keeps used cards; members are independent');
