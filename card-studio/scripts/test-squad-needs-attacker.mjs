/**
 * Acceptance test for tcg-bot/supabase/squad_needs_attacker.sql on the LIVE database, NO lasting change:
 *   node scripts/test-squad-needs-attacker.mjs [--old]   (one DO block; the exception rolls it back)
 * --old tests the live function (the baseline: a support-only squad locks).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = process.argv.includes('--old') ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/squad_needs_attacker.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');
const body = String.raw`do $t$
declare bad text := ''; h bigint; sup bigint[]; atk bigint; r jsonb;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  select id into h from hunts where status = 'active' order by id desc limit 1;
  if h is null then -- no live boss now: make the newest hunt active inside this rolled-back block
    select id into h from hunts order by id desc limit 1;
    update hunts set status = 'active', hp_remaining = greatest(hp_remaining, 1) where id = h;
  end if;
  select array_agg(id) into sup from (select c.id from cards c join subjects s on s.id = c.subject_id
    where coalesce(s.type, '') not in ('Character', 'Creature') and c.rarity = 'normal' order by c.id limit 3) x;
  select c.id into atk from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'normal' order by c.id limit 1;
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('tst_sqa_1', 'sqa');
  insert into player_cards (player_id, card_id, quantity) select 'tst_sqa_1', x, 1 from unnest(sup || atk) x;
  -- 1. Supports only: refused with 'no_attacker', and nothing is stored.
  r := lock_hunt_squad('tst_sqa_1', h, sup);
  if coalesce(r->>'error', '') <> 'no_attacker' then bad := bad || 'support-only squad: ' || coalesce(r::text, 'null') || '; '; end if;
  if exists (select 1 from hunt_squads where player_id = 'tst_sqa_1') then bad := bad || 'a support-only squad was stored; '; end if;
  -- 2. The same supports + 1 attacker: locks.
  r := lock_hunt_squad('tst_sqa_1', h, sup || atk);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'squad with 1 attacker: ' || coalesce(r::text, 'null') || '; '; end if;
  -- 3. 1 attacker alone: locks.
  r := lock_hunt_squad('tst_sqa_1', h, array[atk]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'attacker alone: ' || coalesce(r::text, 'null') || '; '; end if;
  raise exception 'RESULTS [%]', bad;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS [error: % / %]', sqlerrm, bad;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS \[([^\]]*)\]/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1200)); process.exit(1); }
if (m[1]) { console.log('FAIL', m[1]); process.exit(1); }
console.log('PASS: a support-only squad is refused (no_attacker); 1 attacker is enough');
