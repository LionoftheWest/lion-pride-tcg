/**
 * Acceptance test for tcg-bot/supabase/hunt_prizes_fixed.sql against the LIVE database with NO
 * lasting change:  node scripts/test-hunt-prizes.mjs
 * One DO block applies the migration, fights two test hunts (one escapes, one falls) with 13
 * test members, settles them, and checks every pack balance. The exception rolls back everything.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_prizes_fixed.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

// Damage per test member (k = 1..13). 5 and 6 tie: 5 hits first, so 5 ranks first.
// 13 only supports (0 damage): a hunter, but no leaderboard place. 14 never fights.
const DMG = [900, 800, 700, 650, 600, 600, 550, 500, 450, 400, 50, 10, 0];
const WANT = [7, 5, 4, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1];
const body = String.raw`do $t$
declare
  res jsonb := '{}'; h bigint; k int; cid bigint; s jsonb; bal int; bad text := ''; st text;
  dmg int[] := array[${DMG.join(',')}]; want int[] := array[${WANT.join(',')}];
  small int[] := array[7, 5, 1];
begin
  execute $m$${mig}$m$;
  select id into cid from cards limit 1;
  for k in 1..14 loop insert into players (id, username, pack_balance) values ('tst_prz_' || k, 'tst prize', 0); end loop;

  foreach st in array array['expired', 'defeated'] loop
    h := spawn_hunt(3);
    -- 5 and 6 tie on damage. 5 hits first (a lower id), so 5 ranks first.
    for k in 1..13 loop
      insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values (h, 'tst_prz_' || k, cid, current_date, dmg[k]);
    end loop;
    update hunts set status = st where id = h;
    update players set pack_balance = 0 where id like 'tst_prz_%';
    s := settle_hunt(h);
    for k in 1..14 loop
      select pack_balance into bal from players where id = 'tst_prz_' || k;
      if bal <> coalesce(want[k], 0) then bad := bad || st || ' member ' || k || ' got ' || bal || ' want ' || coalesce(want[k], 0) || '; '; end if;
    end loop;
    res := res || jsonb_build_object(st, jsonb_build_object('participants', s->'participants', 'total_packs', s->'total_packs'));
    if (s->>'total_packs')::int <> 40 or (s->>'participants')::int <> 13 then bad := bad || st || ' totals ' || (s->>'participants') || ' hunters ' || (s->>'total_packs') || ' packs; '; end if;
    -- Settle twice: no second payout.
    s := settle_hunt(h);
    if s->>'error' is distinct from 'already_settled' then bad := bad || 'second settle ' || coalesce(s->>'error', 'paid again') || '; '; end if;
    select pack_balance into bal from players where id = 'tst_prz_1';
    if bal <> 7 then bad := bad || 'double pay ' || bal || '; '; end if;
  end loop;

  -- A small hunt: 2 damage dealers + 1 support. The support is not 3rd (0 damage).
  h := spawn_hunt(3);
  update players set pack_balance = 0 where id like 'tst_prz_%';
  insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values
    (h, 'tst_prz_1', cid, current_date, 300), (h, 'tst_prz_2', cid, current_date, 200), (h, 'tst_prz_3', cid, current_date, 0);
  update hunts set status = 'expired' where id = h;
  s := settle_hunt(h);
  for k in 1..3 loop
    select pack_balance into bal from players where id = 'tst_prz_' || k;
    if bal <> small[k] then bad := bad || 'small member ' || k || ' got ' || bal || ' want ' || small[k] || '; '; end if;
  end loop;

  -- An active hunt does not pay.
  h := spawn_hunt(3);
  s := settle_hunt(h);
  if s->>'error' is distinct from 'not_ended' then bad := bad || 'active settle ' || coalesce(s->>'error', 'paid') || '; '; end if;

  res := res || jsonb_build_object('bad', bad);
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\{.*?\})\s*\\n/) || out.match(/RESULTS (\{.*\})/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const res = JSON.parse(m[1].replace(/\\"/g, '"'));
console.log(JSON.stringify(res));
const after = await q("select (select count(*) from players where id like 'tst_prz_%') test_players, (select value from settings where key = 'hunt_prizes') prizes");
console.log('after (rolled back):', JSON.stringify(after));
if (res.bad) { console.log('FAIL', res.bad); process.exit(1); }
console.log('PASS: 1st 7, 2nd 5, 3rd 4, 4th-10th 3, others 1; the same on escape and defeat; supports 1; no double pay');
