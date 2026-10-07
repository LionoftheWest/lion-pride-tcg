/**
 * Test combat_actions.sql (the shared combat action log; the Hunt support plays) with NO lasting change:
 *   node scripts/test-combat-actions.mjs [file.sql]      (default: ../tcg-bot/supabase/combat_actions.sql)
 *   MUTATE=<name> node scripts/test-combat-actions.mjs   must FAIL, for every name:
 *     noinsert   hunt_support writes no row           bosstarget  a boss support logs a target card
 *     novalue    the row has no applied value          guard       the live-version guard accepts any version
 * One DO block: apply the file, make a test boss + member, play supports, check the rows, then RAISE (rollback).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { GATE, mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

// No file: test the CURRENT functions (combat_actions.sql is live, and a later migration replaced its functions, so its own guard
// refuses a second run). With a file: the acceptance run (apply it, the guard, every mutation).
const FILE = process.argv[2];
let mig = !FILE ? '' : readFileSync(FILE, 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const SUP = 'public.hunt_support(text,bigint,bigint,bigint)';
const M = process.env.MUTATE;
if (!FILE && ['guard', 'settings'].includes(M)) throw new Error(`MUTATE=${M} changes the migration text: pass the file`);
const MUT = M === 'guard' ? '' : mutation({
  noinsert: [SUP, 'insert into combat_actions (mode, ref_id', 'insert into pg_temp.ca_sink (mode, ref_id'],   // the rows go to a temp table
  bosstarget: [SUP, "    case when v_tgt in ('ally', 'self') then p_target end,", '    p_target,'],
  novalue: [SUP, "      'value', case", "      'value_x', case"],
});
const GUARD_MUT = M === 'guard' ? ["not in ('beb6c2738ef2b0966054234c13fa1085',", "is null and 'x' not in ('beb6c2738ef2b0966054234c13fa1085',"] : null;
if (GUARD_MUT) { if (!mig.includes(GUARD_MUT[0])) throw new Error('bad guard mutation'); mig = mig.replace(GUARD_MUT[0], GUARD_MUT[1]); }
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');
const P = 'tst_cact';

const body = String.raw`do $t$ declare
  h bigint; d date := (now() at time zone 'America/Denver')::date; bad text := '';
  atk bigint; heal bigint; wk bigint; r jsonb; n int; row record;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the current functions'}
  create temp table ca_sink (like public.combat_actions including all);   -- for MUTATE=noinsert only
  ${MUT}
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at)
    values ('Test Boss', 'Normal', '[]', '[]', 9000000, 9000000, now() + interval '1 day') returning id into h;
  select c.id into atk from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold' order by c.id limit 1;
  select c.id into heal from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'heal' and s.ability->>'target' = 'ally' order by c.id limit 1;
  select c.id into wk from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'weaken' order by c.id limit 1;
  insert into players (id, username) values ('${P}', 'tst combat actions');
  insert into player_cards (player_id, card_id, quantity) values ('${P}', atk, 1), ('${P}', heal, 1), ('${P}', wk, 1);
  ${GATE(P)}
  perform hunt_state_round(h, '${P}', d);
  perform hunt_commit_card(h, '${P}', atk, d, 300);
  update hunt_card_hp set hp_remaining = 10 where player_id = '${P}' and card_id = atk;

  -- 1. A heal on an ally: one row, kind support, the target, the applied value, the target after the play.
  r := hunt_support('${P}', h, heal, atk);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'heal play failed: ' || r::text || '; '; end if;
  select count(*) into n from combat_actions where player_id = '${P}';
  if n <> 1 then bad := bad || 'heal: ' || n || ' rows; '; end if;
  select * into row from combat_actions where player_id = '${P}' order by id limit 1;
  if row.mode is distinct from 'hunt' or row.ref_id is distinct from h or row.kind is distinct from 'support' or row.effect is distinct from 'heal'
     or row.card_id is distinct from heal or row.target_card is distinct from atk or row.game_day is distinct from d or row.round is null
     or (row.result->>'value') is null or (row.result->'target_after'->>'hp')::int is distinct from (select hp_remaining from hunt_card_hp where player_id = '${P}' and card_id = atk)
     or (row.result->'target_after'->>'hp')::int <= 10 then bad := bad || 'heal row: ' || to_jsonb(row)::text || '; '; end if;

  -- 2. A play that fails (the same card on cooldown) writes no row.
  r := hunt_support('${P}', h, heal, atk);
  if r->>'error' is distinct from 'cooldown' then bad := bad || 'expected a cooldown: ' || r::text || '; '; end if;
  select count(*) into n from combat_actions where player_id = '${P}';
  if n <> 1 then bad := bad || 'a failed play wrote a row (' || n || '); '; end if;

  -- 3. A boss support (weaken, sent with a card id that it ignores): a row with no target card, the scaled value.
  r := hunt_support('${P}', h, wk, atk);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'weaken play failed: ' || r::text || '; '; end if;
  select * into row from combat_actions where player_id = '${P}' and effect = 'weaken';
  if row.id is null or row.target_card is not null or (row.result->>'value') is null or (row.result->>'scale') is null then bad := bad || 'weaken row: ' || coalesce(to_jsonb(row)::text, 'none') || '; '; end if;

  -- 4. The table is closed to the API roles (RLS on, no grants): only the server reads it.
  if not (select relrowsecurity from pg_class where oid = 'public.combat_actions'::regclass) then bad := bad || 'RLS is off; '; end if;
  if has_table_privilege('anon', 'public.combat_actions', 'select') then bad := bad || 'anon can read; '; end if;

${mig && (!M || M === 'guard') ? `
  -- 5. The guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.hunt_support'::regproc), 'declare', 'declare -- changed by someone else');
  begin execute $m$${mig}$m$; bad := bad || 'the guard let a changed hunt_support through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;
` : ''}

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
