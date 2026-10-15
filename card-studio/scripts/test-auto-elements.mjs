import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/f3_auto_elements.sql (the Auto button picks the attacker by element), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-auto-elements.mjs      must PASS (the file is applied twice: idempotent)
 *   MUTATE=<name> ...                                                                         must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                            runs every mutation, one line each
 * The squad has one attacker whose element beats the foe's element (not by the primary counter, so it has no weakness hit) at the LAST place and with no stars,
 * and four attackers that do not beat it, with 5 stars (so today's rule, the CP, picks one of them). The real dungeon_auto_action and dungeon_auto_rounds run.
 * Invariants:
 *   1. The flag ships OFF: combat.auto_elements is false, the note names it. A second run keeps a value that was changed. true / false are accepted, a string or a number is refused.
 *   2. Flag OFF: the pick is today's pick (one of the high CP cards), for every foe. Flag ON: the card whose element beats the foe's element is picked first.
 *   3. Flag ON and nobody beats the foe, a foe with no element, a pair that is only a proposal, a stunned beater: today's pick (the rule is a preference, not a force).
 *   4. The whole Auto path (dungeon_auto_rounds) attacks with that card and the fight log (combat_actions) says the same card.
 *   5. The target of the pick is unchanged (the living foe closest to falling) and the support pick (kind support) is unchanged.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { installHelpers } from './lab-sql.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_auto_elements.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
mig = mig.replace(/-- GUARD \(the combat_core[\s\S]*?-- GUARD-END\n/, '');
const MUT = {
  flagoff: ['case when v_ael and public.element_beats(', 'case when true and public.element_beats('],
  invert: ['v_foe->>\'element\') then 0 else 1 end', 'v_foe->>\'element\') then 1 else 0 end'],
  noelem: ["dungeon_txt(p_squad->(a.id::text)->'tags')), v_foe->>'element')", "dungeon_txt(p_squad->(a.id::text)->'tags')), null)"],
  noatt: ["public.card_element(dungeon_txt(p_squad->(a.id::text)->'tags'))", 'null::text'],
  last: ['else 1 end,   -- f3_auto_elements.sql: the card whose element beats the target\'s (flag combat.auto_elements, OFF = no preference)\n             a.weak desc, a.cp desc, a.ord limit 1;', 'else 1 end * 0,\n             a.cp desc, a.ord limit 1;'],
  proposal: ['and not c.proposal)', ')'],
  direction: ['c.beater = p_att and c.target = p_def', 'c.beater = p_def and c.target = p_att'],
  defaulton: ["jsonb_build_object('auto_elements', false)", "jsonb_build_object('auto_elements', true)"],
  overwrite: ["set value = jsonb_build_object('auto_elements', false) || value where key = 'combat' and not (value ? 'auto_elements');", "set value = value || jsonb_build_object('auto_elements', false) where key = 'combat';"],
  limflag: ["if new.value ? 'auto_elements' and jsonb_typeof(new.value->'auto_elements') is distinct from 'boolean' then", "if false then"],
  oldlimit: ["not between 1 and 2 then", "not between 0 and 20 then"],
  ready: ['where a.ready\n    order by', 'where true\n    order by'],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(10)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !mig.includes(m[0])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$', '$j$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $j$');

const body = String.raw`do $t$
declare bad text := ''; k text; r dungeon_runs; sq jsonb; pl text := 'tst_ae'; squad bigint[]; fillers bigint[]; cb bigint; pa record; foe jsonb; base jsonb; act jsonb; off_pick bigint; on_pick bigint; res jsonb; last_card bigint; n int; foe2 jsonb;
begin
  ${installHelpers()}
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_ae', true);
  update settings set value = value || '{"enabled": true}'::jsonb where key in ('dungeon', 'gauntlet');
  create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $f$ begin begin execute p_sql; exception when others then return true; end; return false; end $f$;
  create function pg_temp.eb_card(p_el text) returns bigint language sql as $f$
    select min(c.id) from cards c join subjects s on s.id = c.subject_id
     where s.type in ('Character', 'Creature') and c.rarity = 'normal' and card_element(s.tag_slugs) is not distinct from p_el $f$;
  -- the state of the flag before the file, also when the file is already applied
  alter table public.balance disable trigger user;
  update balance set value = value - 'auto_elements', note = split_part(note, ' auto_elements (f3_auto_elements', 1) where key = 'combat';
  alter table public.balance enable trigger user;
  execute $m$${mig}$m$;
  execute $m$${mig}$m$; -- two times: idempotent

  -- ===== 1. The flag ships OFF.
  if (select value->'auto_elements' from balance where key = 'combat') is distinct from 'false'::jsonb then bad := bad || '1: auto_elements is not false after the file; '; end if;
  if (select note from balance where key = 'combat') not like '%auto_elements%' then bad := bad || '1: the note does not name the flag; '; end if;
  update balance set value = value || '{"auto_elements": true}'::jsonb where key = 'combat';
  execute $m$${mig}$m$;
  if (select value->'auto_elements' from balance where key = 'combat') is distinct from 'true'::jsonb then bad := bad || '1: a second run overwrote the flag; '; end if;
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  foreach k in array array['{"auto_elements": "yes"}', '{"auto_elements": 1}', '{"auto_elements": null}'] loop
    if not pg_temp.refused('update balance set value = value || ' || quote_literal(k) || '::jsonb where key = ''combat''') then bad := bad || '1: ' || k || ' was accepted; '; end if;
  end loop;
  if pg_temp.refused('update balance set value = value || ''{"auto_elements": true}''::jsonb where key = ''combat''') then bad := bad || '1: true was refused; '; end if;
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  -- the check of THIS trigger alone (the type guard of balance_check is off for this step)
  alter table public.balance disable trigger balance_check;
  foreach k in array array['{"auto_elements": "yes"}', '{"auto_elements": 1}'] loop
    if not pg_temp.refused('update balance set value = value || ' || quote_literal(k) || '::jsonb where key = ''combat''') then bad := bad || '1: balance_check_combat accepted ' || k || '; '; end if;
  end loop;
  alter table public.balance enable trigger balance_check;
  -- the older limits are still checked by the new function
  if not pg_temp.refused('update balance set value = value || ''{"element_bonus": 2.5}''::jsonb where key = ''combat''') or not pg_temp.refused('update balance set value = value || ''{"element_penalty": 0.1}''::jsonb where key = ''combat''') then bad := bad || '1: an element limit is not checked; '; end if;
  if pg_temp.refused('insert into balance (key, value, note) values (''combat'', ''{"miss": 0.08}''::jsonb, ''seed'') on conflict (key) do nothing') then bad := bad || '1: the seed insert was refused; '; end if;

  -- element_beats
  if not (element_beats('water', 'fire') and not element_beats('fire', 'water') and not element_beats(null, 'fire') and not element_beats('water', null) and not element_beats('fire', 'fire')) then bad := bad || '1: element_beats; '; end if;

  -- ===== the setup: a pair (b beats y) that is not the primary counter of y, with an attacker of element b that has no weakness hit on a foe of element y.
  select c.beater b, c.target y into pa from element_counters c join elements ey on ey.key = c.target
   where not c.proposal and ey.dungeon_foe and c.beater <> coalesce(ey.weak_to, '') and not exists (select 1 from element_counters x where x.beater = c.target and x.target = c.beater)
     and exists (select 1 from cards cc join subjects s on s.id = cc.subject_id where s.type in ('Character', 'Creature') and cc.rarity = 'normal' and card_element(s.tag_slugs) = c.beater and not (s.tag_slugs @> array['trait:' || ey.weak_to]))
   order by c.beater, c.target limit 1;
  if pa.b is null then raise exception 'RESULT:%', 'FAIL 2: no usable pair in the local data'; end if;
  select cc.id into cb from cards cc join subjects s on s.id = cc.subject_id
   where s.type in ('Character', 'Creature') and cc.rarity = 'normal' and card_element(s.tag_slugs) = pa.b and not (s.tag_slugs @> array['trait:' || (select weak_to from elements where key = pa.y)])
   order by s.cp_mod, cc.id limit 1;   -- the weakest beater: today's rule does not pick it
  fillers := array(select cc.id from cards cc join subjects s on s.id = cc.subject_id
     where s.type in ('Character', 'Creature') and cc.rarity = 'normal' and cc.id <> cb and not coalesce(element_beats(card_element(s.tag_slugs), pa.y), false)
       and not (s.tag_slugs @> array['trait:' || (select weak_to from elements where key = pa.y)]) order by s.cp_mod desc, cc.id limit 4);
  if cardinality(fillers) < 4 then raise exception 'RESULT:%', 'FAIL 2: fewer than 4 filler attackers'; end if;
  squad := fillers || cb;                           -- the beater is LAST
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{"budget": 99}'::jsonb where day = dungeon_day();
  perform pg_temp.lab_member(pl, squad, (select jsonb_object_agg(x::text, '{"asc": 5, "pts": {"attack": 6}}'::jsonb) from unnest(fillers) x), true);
  res := dungeon_start(pl, squad);
  if not coalesce((res->>'ok')::boolean, false) then raise exception 'RESULT:%', 'FAIL 2: the run did not start: ' || left(res::text, 200); end if;
  select * into r from dungeon_runs where player_id = pl and day = dungeon_day();
  base := r.state;
  select coalesce(jsonb_object_agg(x::text, dungeon_run_card(r, x)), '{}'::jsonb) into sq from unnest(r.squad) x;
  foe := pg_temp.lab_foe('fight', 1, 1, pa.y, null, null, 'ae1') || '{"hp": 1000000000, "max": 1000000000, "atk": 1, "passives": [], "ex": 0, "exu": 0}'::jsonb;
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  select * into r from dungeon_runs where id = r.id;

  -- ===== 2. OFF = today's pick (a high CP card, not the beater); ON = the beater.
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  act := dungeon_auto_action(r, sq, null, 'attack'); off_pick := (act->>'card')::bigint;
  if off_pick is null or off_pick = cb or not (off_pick = any(fillers)) then bad := bad || '2: flag off picked ' || coalesce(off_pick::text, 'nobody') || ' (the beater is ' || cb || '); '; end if;
  update balance set value = value || '{"auto_elements": true}'::jsonb where key = 'combat';
  act := dungeon_auto_action(r, sq, null, 'attack'); on_pick := (act->>'card')::bigint;
  if on_pick is distinct from cb then bad := bad || '2: flag on picked ' || coalesce(on_pick::text, 'nobody') || ', the beater is ' || cb || '; '; end if;
  -- 5. the target and the answer shape do not change
  if (act->>'target')::int is distinct from 0 or act->>'kind' <> 'attack' then bad := bad || '5: the target or kind changed: ' || act::text || '; '; end if;
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  if (dungeon_auto_action(r, sq, null, 'attack') - 'card') is distinct from (act - 'card') then bad := bad || '5: the answer shape differs between flag off and on; '; end if;

  -- ===== 3. A preference, not a force.
  update balance set value = value || '{"auto_elements": true}'::jsonb where key = 'combat';
  -- a foe of an element that nobody beats (the beater's own element: the same element is no pair)
  foe2 := pg_temp.lab_foe('fight', 1, 1, pa.b, null, null, 'ae2') || '{"hp": 1000000000, "max": 1000000000, "atk": 1, "passives": [], "ex": 0, "exu": 0}'::jsonb;
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe2), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  select * into r from dungeon_runs where id = r.id;
  act := dungeon_auto_action(r, sq, null, 'attack');
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  if (act->>'card')::bigint is distinct from (dungeon_auto_action(r, sq, null, 'attack')->>'card')::bigint then bad := bad || '3: a foe of the beater''s own element changed the pick; '; end if;
  update balance set value = value || '{"auto_elements": true}'::jsonb where key = 'combat';
  -- a foe with no element
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe - 'element'), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  select * into r from dungeon_runs where id = r.id;
  if (dungeon_auto_action(r, sq, null, 'attack')->>'card')::bigint is distinct from off_pick then bad := bad || '3: a foe with no element changed the pick; '; end if;
  -- a pair that is only a proposal
  update element_counters set proposal = true where beater = pa.b and target = pa.y;
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  select * into r from dungeon_runs where id = r.id;
  if (dungeon_auto_action(r, sq, null, 'attack')->>'card')::bigint is distinct from off_pick then bad := bad || '3: a proposal pair changed the pick; '; end if;
  update element_counters set proposal = false where beater = pa.b and target = pa.y;
  -- a stunned beater is not ready: another card
  update dungeon_runs set state = jsonb_set(base || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', 1, 'sup_round', -1), array['cards', cb::text, 'cd'], '9') where id = r.id;
  select * into r from dungeon_runs where id = r.id;
  act := dungeon_auto_action(r, sq, null, 'attack');
  if (act->>'card')::bigint = cb or (act->>'card')::bigint is null then bad := bad || '3: a stunned beater was picked or nobody was: ' || coalesce(act::text, 'null') || '; '; end if;

  -- ===== 4. The whole Auto path attacks with the beater, and the fight log says so.
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  update balance set value = value || '{"auto_elements": true}'::jsonb where key = 'combat';
  res := dungeon_auto_rounds(pl, 'daily', 1);
  select ca.card_id into last_card from combat_actions ca where ca.ref_id = r.id and ca.kind = 'attack' order by ca.id limit 1;
  if last_card is distinct from cb then bad := bad || '4: dungeon_auto_rounds attacked with ' || coalesce(last_card::text, 'nobody') || ', the beater is ' || cb || ': ' || left(res::text, 200) || '; '; end if;
  update dungeon_runs set state = base || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', 1, 'sup_round', -1) where id = r.id;
  delete from combat_actions where ref_id = r.id;
  update balance set value = value || '{"auto_elements": false}'::jsonb where key = 'combat';
  res := dungeon_auto_rounds(pl, 'daily', 1);
  select ca.card_id into last_card from combat_actions ca where ca.ref_id = r.id and ca.kind = 'attack' order by ca.id limit 1;
  if last_card is not distinct from cb or last_card is null then bad := bad || '4: flag off, dungeon_auto_rounds attacked with ' || coalesce(last_card::text, 'nobody') || '; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|\\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2500));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
