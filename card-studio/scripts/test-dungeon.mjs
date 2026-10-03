/**
 * Acceptance test for tcg-bot/supabase/dungeon.sql (with combat_core.sql) on the LIVE database, NO lasting
 * change: one DO block installs both migrations, plays the Dungeon with test members, and the final RAISE
 * rolls it all back.
 *   node scripts/test-dungeon.mjs                 must PASS
 *   MUTATE=gate  node scripts/test-dungeon.mjs    must FAIL (the gate ignores open starter gifts)
 *   MUTATE=core  node scripts/test-dungeon.mjs    must FAIL (the attack damage is not the core's hit)
 *   MUTATE=every node scripts/test-dungeon.mjs    must FAIL (only the first monster acts)
 *   MUTATE=area  node scripts/test-dungeon.mjs    must FAIL (Slam / Cataclysm skip the other cards)
 *   MUTATE=gen   node scripts/test-dungeon.mjs    must FAIL (the generator uses the session random)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const strip = (s) => s.replace(/notify pgrst[^\n]*\n/g, '');
const core = strip(readFileSync(process.env.CORE || new URL('../../tcg-bot/supabase/combat_core.sql', import.meta.url), 'utf8'));
let mig = strip(readFileSync(process.env.MIG || new URL('../../tcg-bot/supabase/dungeon.sql', import.meta.url), 'utf8'));
const MUT = {
  gate: ["'ok', g.open = 0 and a.n >= g.need", "'ok', a.n >= g.need"],
  core: ["  v_dmg := (hit->>'dmg')::int;\n", "  v_dmg := (hit->>'dmg')::int + 1;\n"],
  every: ["    continue when (f->>'hp')::int <= 0;\n", "    continue when (f->>'hp')::int <= 0 or i > 0;\n"],
  area: ["    if (act->>'area')::numeric > 0 then", "    if false then"],
  gen: ["  select (('x' || substr(md5(p_key), 1, 8))", "  select random() * 0 + (('x' || substr(md5(p_key || random()::text), 1, 8))"],
};
if (process.env.MUTATE) { const m = MUT[process.env.MUTATE]; if (!m || !mig.includes(m[0])) throw new Error('bad mutation'); mig = mig.replace(m[0], m[1]); }
for (const s of [core, mig]) if (s.includes('$m$') || s.includes('$t$')) throw new Error('a migration contains $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; g jsonb; d1 jsonb; d2 jsonb; fl jsonb; rm jsonb; i int; j int; n int; st jsonb; run record;
  atk bigint[]; gold bigint[]; foe jsonb; info jsonb; sq jsonb; wk jsonb; crit numeric; ex jsonb; seed float; bal int; v_day date;
begin
  execute $m$${core}$m$;
  execute $m$${mig}$m$;
  v_day := dungeon_day();
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id not in (24, 29, 34, 44, 49) order by c.id limit 4) x;
  select array_agg(id order by id) into gold from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity::text in ('gold', 'full_art', 'secret_rare') and s.type in ('Character', 'Creature') order by c.rarity desc, c.id limit 5) x;
  insert into players (id, username) values ('tst_dg_a', 'dungeon a'), ('tst_dg_b', 'dungeon b'), ('tst_dg_g', 'dungeon gate');
  insert into player_cards (player_id, card_id, quantity)
    select p, x, 1 from unnest(array['tst_dg_a', 'tst_dg_b']) p, unnest(array[24, 29, 34, 44, 49, 64, 93, 97]::bigint[] || atk || gold) x;

  -- 0. The flag OFF: nothing starts.
  r := dungeon_start('tst_dg_a', array[34, 44, 64, 93, 97]);
  if r->>'error' is distinct from 'disabled' then bad := bad || 'flag off: ' || r::text || '; '; end if;
  if (dungeon_view('tst_dg_a')->>'error') is distinct from 'disabled' then bad := bad || 'view flag off; '; end if;
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';

  -- 1. The gate: an open starter gift locks it; fewer than 8 attackers locks it.
  insert into player_cards (player_id, card_id, quantity) select 'tst_dg_g', x, 1 from unnest(array[24, 29, 34, 44, 49]::bigint[] || atk[1:3]) x;
  insert into gift_claims (player_id, kind, title, amount) values ('tst_dg_g', 'new_player', 'test', 1);
  g := adventure_gate('tst_dg_g');
  if (g->>'ok')::boolean or (g->>'gifts_open')::int <> 1 or (g->>'attackers')::int <> 8 then bad := bad || 'gate open gift: ' || g::text || '; '; end if;
  r := dungeon_start('tst_dg_g', array[24, 29, 34, 44, 49]);
  if r->>'error' is distinct from 'locked' then bad := bad || 'start not locked: ' || r::text || '; '; end if;
  update gift_claims set claimed_at = now() where player_id = 'tst_dg_g';
  if not (adventure_gate('tst_dg_g')->>'ok')::boolean then bad := bad || 'gate closed after claim; '; end if;
  delete from player_cards where player_id = 'tst_dg_g' and card_id = atk[3];
  if (adventure_gate('tst_dg_g')->>'ok')::boolean then bad := bad || 'gate open with 7 attackers; '; end if;

  -- 2. The generator: the same day gives the same dungeon; the shape is valid.
  d1 := dungeon_generate(v_day);
  delete from dungeon_days where day = v_day;
  d2 := dungeon_generate(v_day);
  if d1->'floors' <> d2->'floors' or d1->'rule' <> d2->'rule' or d1->>'name' <> d2->>'name' then bad := bad || 'generator not deterministic; '; end if;
  if (select floors from dungeon_days where day = v_day + 1) is not null then bad := bad || 'extra day; '; end if;
  if (dungeon_generate(v_day + 1)->'floors') = d1->'floors' then bad := bad || 'two days are the same; '; end if;
  if jsonb_array_length(d1->'floors') <> 30 then bad := bad || 'floors ' || jsonb_array_length(d1->'floors') || '; '; end if;
  for i in 0..29 loop
    fl := d1->'floors'->i;
    if jsonb_array_length(fl) <> 5 then bad := bad || 'rooms on floor ' || i || '; '; end if;
    if fl->0->>'type' <> 'fight' or fl->4->>'type' <> 'guardian' or jsonb_array_length(fl->4->'foes') <> 1 then bad := bad || 'room 1 / 5 on floor ' || i || '; '; end if;
    for j in 0..4 loop
      rm := fl->j; n := jsonb_array_length(rm->'foes');
      if (rm->>'type' = 'fight' and n not between 1 and 3) or (rm->>'type' in ('elite', 'guardian') and n <> 1)
         or (rm->>'type' in ('treasure', 'rest') and n <> 0) or rm->>'type' not in ('fight', 'elite', 'guardian', 'treasure', 'rest') then
        bad := bad || 'room ' || i || '/' || j || ' ' || rm::text || '; '; end if;
    end loop;
  end loop;
  -- The monsters get stronger with depth.
  if (d1->'floors'->29->4->'foes'->0->>'max')::int <= (d1->'floors'->0->4->'foes'->0->>'max')::int * 3 then bad := bad || 'no depth scaling; '; end if;
  update dungeon_days set rule = dungeon_rules()->8 where day = v_day;   -- Everything goes

  -- 3. Starting: the squad size, ownership, the budget, an attacker, today's rule, once a day.
  r := dungeon_start('tst_dg_a', array[34, 44, 64, 93]);
  if r->>'error' is distinct from 'squad_size' then bad := bad || 'size: ' || r::text || '; '; end if;
  r := dungeon_start('tst_dg_a', array[34, 44, 64, 93, 999999]);
  if r->>'error' is distinct from 'not_owned' then bad := bad || 'owned: ' || r::text || '; '; end if;
  r := dungeon_start('tst_dg_a', gold);
  if r->>'error' is distinct from 'budget' then bad := bad || 'budget: ' || r::text || '; '; end if;
  update dungeon_days set rule = dungeon_rules()->0 where day = v_day;   -- Creatures and Items only
  r := dungeon_start('tst_dg_a', array[24, 29, 34, 64, 93]);
  if r->>'error' is distinct from 'rule' then bad := bad || 'rule: ' || r::text || '; '; end if;
  update dungeon_days set rule = dungeon_rules()->8 where day = v_day;
  r := dungeon_start('tst_dg_a', array[34, 44, 64, 93, 97]);
  if not (r->>'ok')::boolean then bad := bad || 'start: ' || r::text || '; '; end if;
  if (dungeon_start('tst_dg_a', array[34, 44, 64, 93, 97])->>'error') is distinct from 'already' then bad := bad || 'two runs a day; '; end if;
  select * into run from dungeon_runs where player_id = 'tst_dg_a' and day = v_day;
  if run.state->>'phase' <> 'fight' or jsonb_array_length(run.state->'foes') < 1 then bad := bad || 'room 1 not a fight; '; end if;
  if (run.state->'cards'->'64'->>'max')::int <> card_max_hp(0) then bad := bad || 'support hp; '; end if;
  if (run.state->'cards'->'34'->>'max')::int <> (dungeon_card('tst_dg_a', 34)->'cmb'->>'hp')::int then bad := bad || 'attacker hp; '; end if;

  -- 4. THE COMBAT CORE: the attack damage = combat_hit with the same seed (x the run buff).
  foe := '{"key":"slime","name":"T","element":"fire","level":1,"hp":100000,"max":100000,"atk":1,"weak":[],"resist":[],"passives":[],"tags":[],"enr":0,"enru":0,"wk":0,"wku":0,"ex":0,"exu":0,"st":0}';
  info := dungeon_card('tst_dg_a', 34);
  sq := combat_squad(dungeon_txt(info->'tags'), true, (select jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) from unnest(array[44, 64, 93, 97]::bigint[]) x
          join cards c on c.id = x join subjects s on s.id = c.subject_id), '[]');
  wk := combat_weak('[]', '[]', info->>'type', info->>'rarity', info->>'season', dungeon_txt(info->'tags'), (sq->>'stack')::int);
  crit := combat_crit_chance(false, info->'ability'->>'effect', coalesce((info->'ability'->>'amount')::numeric, 0), info->'cmb');
  foreach seed in array array[0.11, 0.23, 0.37, 0.41, 0.59, 0.67, 0.73, 0.89, -0.2, -0.5] loop
    for j in 1..2 loop   -- j = 2: a run buff of 1.1
      update dungeon_runs set state = run.state || jsonb_build_object('foes', jsonb_build_array(foe), 'round', 0, 'buff', case when j = 1 then 1 else 1.1 end)
        where id = run.id;
      perform setseed(seed);
      ex := combat_hit((info->'cmb'->>'cp')::int, (wk->>'mult')::numeric, 1, 1, (sq->>'synmult')::numeric, crit, 0.08,
        info->'ability'->>'effect', coalesce((info->'ability'->>'amount')::numeric, 0), coalesce((info->'ability'->>'threshold')::numeric, 0), false, 0, 100000, 100000);
      perform setseed(seed);
      r := dungeon_attack('tst_dg_a', 34, 0);
      n := (case when (ex->>'dmg')::int = 0 then 0 else greatest(1, round((ex->>'dmg')::int * (case when j = 1 then 1 else 1.1 end)))::int end);
      if (r->>'damage')::int is distinct from n then
        bad := bad || 'core seed ' || seed || '/' || j || ': ' || coalesce(r->>'damage', r::text) || ' vs ' || (ex->>'dmg') || '; '; end if;
      if ((r->'state'->'foes'->0->>'hp')::int) <> least(100000, 100000 - coalesce((r->>'damage')::int, -1) + coalesce((r->'enemy'->0->>'heal')::int, 0)) then bad := bad || 'foe hp; '; end if;
    end loop;
  end loop;

  -- 5. Every living monster acts; a dead one does not.
  update dungeon_runs set state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'foes', jsonb_build_array(foe, foe || '{"hp":0}', foe, foe)) where id = run.id;
  r := dungeon_attack('tst_dg_a', 44, 0);
  if jsonb_array_length(r->'enemy') <> 3 or exists (select 1 from jsonb_array_elements(r->'enemy') e where (e->>'foe')::int = 1) then
    bad := bad || 'monsters acting: ' || coalesce(r->>'enemy', r::text) || '; '; end if;

  -- 6. The Cataclysm (round 8) hits every other card standing (the area roll).
  update dungeon_runs set state = run.state || jsonb_build_object('round', 7, 'buff', 1, 'foes', jsonb_build_array(foe || '{"atk":20}')) where id = run.id;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if r->'enemy'->0->>'action' <> 'cataclysm' then bad := bad || 'no cataclysm: ' || coalesce(r->>'enemy', r::text) || '; '; end if;
  if (select count(*) from jsonb_each(r->'state'->'cards') e where e.key <> '34' and (e.value->>'hp')::int < (e.value->>'max')::int) <> 4 then
    bad := bad || 'area hit: ' || coalesce(r->>'state', '') || '; '; end if;

  -- 7. Supports: Empower on an ally (the core value), the cooldown, Stun (the monster skips), Smite.
  update dungeon_runs set state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'foes', jsonb_build_array(foe)) where id = run.id;
  r := dungeon_support('tst_dg_a', 64, 34, null);
  if not (r->>'ok')::boolean or (r->'state'->'cards'->'34'->>'buff')::numeric <> combat_support_value('empower', (r->>'amount')::numeric, 1, null) then
    bad := bad || 'empower: ' || r::text || '; '; end if;
  if (dungeon_support('tst_dg_a', 64, 34, null)->>'error') is distinct from 'cooldown' then bad := bad || 'no cooldown; '; end if;
  r := dungeon_support('tst_dg_a', 93, null, 0);
  if not (r->>'ok')::boolean or (r->'state'->'foes'->0->>'st')::int <> 1 then bad := bad || 'stun: ' || r::text || '; '; end if;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if r->'enemy'->0->>'action' <> 'stunned' then bad := bad || 'stunned foe acted: ' || coalesce(r->>'enemy', r::text) || '; '; end if;
  if (r->'state'->'cards'->'34'->>'buff')::numeric <> 1 then bad := bad || 'empower not used by the attack; '; end if;
  select (state->'foes'->0->>'hp')::int into n from dungeon_runs where id = run.id;
  r := dungeon_support('tst_dg_a', 97, null, 0);
  if not (r->>'ok')::boolean or (r->'state'->'foes'->0->>'hp')::int <> n - combat_support_value('smite', (r->>'amount')::numeric, combat_aff_scale((r->>'aff_count')::int), null)::int then
    bad := bad || 'smite: ' || r::text || '; '; end if;
  if (dungeon_support('tst_dg_a', 34, null, 0)->>'error') is distinct from 'not_support' then bad := bad || 'attacker as support; '; end if;
  if (dungeon_attack('tst_dg_a', 64, 0)->>'error') is distinct from 'not_attacker' then bad := bad || 'support as attacker; '; end if;

  -- 8. A kill and the last kill: the Shards (kill + room), the rewards, the next room.
  bal := (select shard_balance from players where id = 'tst_dg_a');
  update dungeon_runs set floor = 1, room = 1, shards = 0, state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'foes', jsonb_build_array(foe || '{"hp":1,"max":50}')) where id = run.id;
  for i in 1..20 loop
    r := dungeon_attack('tst_dg_a', 34, 0);
    exit when (r->>'kill')::boolean;
  end loop;
  if not coalesce((r->>'kill')::boolean, false) then bad := bad || 'no kill: ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_dg_a') - bal <> 8 or (select shards from dungeon_runs where id = run.id) <> 8 then
    bad := bad || 'kill shards ' || ((select shard_balance from players where id = 'tst_dg_a') - bal) || '; '; end if;
  if r->'state'->>'phase' <> 'choose' or jsonb_array_length(r->'state'->'offers') <> 3 or jsonb_array_length(r->'enemy') <> 0 then
    bad := bad || 'after the room: ' || coalesce(r->>'state', r::text) || '; '; end if;
  if (dungeon_attack('tst_dg_a', 34, 0)->>'error') is distinct from 'not_fighting' then bad := bad || 'attack while choosing; '; end if;
  r := dungeon_choose('tst_dg_a', 1);   -- the run buff
  if not (r->>'ok')::boolean or (r->'state'->>'buff')::numeric <> 1.1 or (r->>'room')::int <> 2 or (r->>'floor')::int <> 1 then
    bad := bad || 'choose: ' || r::text || '; '; end if;
  if r->'state'->>'room_type' <> d1->'floors'->0->1->>'type' then bad := bad || 'room 2 type; '; end if;
  if (select count(*) from dungeon_log where run_id = run.id) < 25 then bad := bad || 'log rows; '; end if;

  -- 9. A rest room heals and revives; a treasure offers 3 picks.
  st := dungeon_enter(jsonb_build_object('buff', 1, 'cards', jsonb_build_object('1', '{"hp":0,"max":100,"down":true,"shield":0,"buff":1,"debuff":1,"cd":0}'::jsonb,
          '2', '{"hp":10,"max":100,"down":false,"shield":0,"buff":1,"debuff":1,"cd":0}'::jsonb)),
          '[[{"type":"rest","foes":[]}, {"type":"treasure","foes":[]}]]', 1, 1);
  if st->>'phase' <> 'rest' or (st->'cards'->'1'->>'down')::boolean or (st->'cards'->'1'->>'hp')::int <> 25 or (st->'cards'->'2'->>'hp')::int <> 50 then
    bad := bad || 'rest: ' || st::text || '; '; end if;
  st := dungeon_enter(st, '[[{"type":"rest","foes":[]}, {"type":"treasure","foes":[]}]]', 1, 2);
  if st->>'phase' <> 'choose' or jsonb_array_length(st->'offers') <> 3 then bad := bad || 'treasure: ' || st::text || '; '; end if;

  -- 10. The last guardian ends the run as 'cleared'.
  update dungeon_runs set floor = 30, room = 5, state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'phase', 'fight', 'foes', jsonb_build_array(foe || '{"hp":1}')) where id = run.id;
  for i in 1..20 loop
    r := dungeon_attack('tst_dg_a', 34, 0);
    exit when (r->>'kill')::boolean;
  end loop;
  select * into run from dungeon_runs where id = run.id;
  if run.status <> 'over' or run.ended_by is distinct from 'cleared' then bad := bad || 'cleared: ' || run.status || '/' || coalesce(run.ended_by, '-') || '; '; end if;
  if (dungeon_attack('tst_dg_a', 34, 0)->>'error') is distinct from 'no_run' then bad := bad || 'attack after the end; '; end if;

  -- 11. The squad falls: the run ends as 'fell'. Retreat keeps the loot.
  r := dungeon_start('tst_dg_b', array[34, 44, 64, 93, 97]);
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array(foe || '{"atk":5000}')) || '{"round": 7}' where id = run.id;
  r := dungeon_attack('tst_dg_b', 34, 0);
  select * into run from dungeon_runs where id = run.id;
  if run.status <> 'over' or run.ended_by is distinct from 'fell' then bad := bad || 'fell: ' || run.status || '/' || coalesce(run.ended_by, '-') || ' ' || r::text || '; '; end if;
  delete from dungeon_runs where player_id = 'tst_dg_b';
  r := dungeon_start('tst_dg_b', array[34, 44, 64, 93, 97]);
  update dungeon_runs set shards = 12, floor = 4, room = 3 where player_id = 'tst_dg_b';
  r := dungeon_retreat('tst_dg_b');
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  if not (r->>'ok')::boolean or run.ended_by is distinct from 'retreat' or run.shards <> 12 or (r->>'floor')::int <> 4 then bad := bad || 'retreat: ' || r::text || '; '; end if;

  -- 12. The leaderboard (the deepest first) and the view.
  r := dungeon_board(v_day, 50);
  if (select e->>'player_id' from jsonb_array_elements(r) e order by (e->>'rank')::int limit 1) <> 'tst_dg_a'
     or not exists (select 1 from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_b') then bad := bad || 'board: ' || r::text || '; '; end if;
  r := dungeon_view('tst_dg_b');
  if not (r->>'ok')::boolean or r->'run'->>'ended_by' <> 'retreat' or (r->'run'->>'rank')::int < 1 or not (r->'gate'->>'ok')::boolean then bad := bad || 'view: ' || r::text || '; '; end if;

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = msg.match(/RESULT:(PASS|FAIL[^"]*)/);
console.log(m ? m[1].replace(/\\"/g, '"') : 'ERROR ' + msg.slice(0, 3000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
