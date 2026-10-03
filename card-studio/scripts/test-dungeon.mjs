/**
 * Acceptance test for the Dungeon (combat_core.sql + adventure_gate.sql + dungeon.sql + dungeon_v2.sql) on
 * the LIVE database, NO lasting change: one DO block installs the migrations, plays the Dungeon with test
 * members, and the final RAISE rolls it all back.
 *   node scripts/test-dungeon.mjs                  must PASS
 *   MUTATE=<name> node scripts/test-dungeon.mjs    must FAIL, for every name:
 *     gate      the gate ignores open starter gifts          huntlock / allows  the Hunt skips the gate
 *     guard     the live-version guard accepts any version   gen       the generator uses the session random
 *     core      the attack damage is not the core's hit      every     only the first monster acts
 *     area      Slam / Cataclysm skip the other cards        bank      a fall also grants the floor's loot at risk
 *     cap       the run passes 300 Shards                    carry     support cooldowns reset between rooms
 *     onesup    two supports in one turn                     repeat    the last reward comes back
 *     retreat   Retreat in the middle of a floor
 * Env: CORE, GATE, MIG, MIG2 = other paths for combat_core.sql, adventure_gate.sql, dungeon.sql, dungeon_v2.sql.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const strip = (s) => s.replace(/notify pgrst[^\n]*\n/g, '').replace(/\r\n/g, '\n');
const core = strip(readFileSync(process.env.CORE || new URL('../../tcg-bot/supabase/combat_core.sql', import.meta.url), 'utf8'));
let gate = strip(readFileSync(process.env.GATE || new URL('../../tcg-bot/supabase/adventure_gate.sql', import.meta.url), 'utf8'));
let mig = strip(readFileSync(process.env.MIG || new URL('../../tcg-bot/supabase/dungeon.sql', import.meta.url), 'utf8'));
let mig2 = strip(readFileSync(process.env.MIG2 || new URL('../../tcg-bot/supabase/dungeon_v2.sql', import.meta.url), 'utf8'));
const MUT1 = {   // dungeon.sql
  gen: ["  select (('x' || substr(md5(p_key), 1, 8))", "  select random() * 0 + (('x' || substr(md5(p_key || random()::text), 1, 8))"],
};
const MUT2 = {   // dungeon_v2.sql
  core: ["  v_dmg := (hit->>'dmg')::int;\n", "  v_dmg := (hit->>'dmg')::int + 1;\n"],
  every: ["    continue when (f->>'hp')::int <= 0;\n", "    continue when (f->>'hp')::int <= 0 or i > 0;\n"],
  area: ["    if (act->>'area')::numeric > 0 then", "    if false then"],
  bank: ["v_end := dungeon_settle(r.id, 'fell', false);", "v_end := dungeon_settle(r.id, 'fell', true);"],
  cap: ["add int := greatest(0, least(coalesce(p_shards, 0), cap - have));", "add int := coalesce(p_shards, 0);"],
  carry: ["then greatest(0, coalesce((c->>'cd')::int, 0) - v_old) else 0 end;", "then 0 else 0 end;"],
  onesup: ["if coalesce((st->>'sup_round')::int, -1) = v_round then return", "if false then return"],
  repeat: ["    continue when k = p_state->>'last_pick';\n", "    continue when false;\n"],
  retreat: ["if r.state->>'phase' <> 'floor_done' then return", "if false then return"],
};
const GMUT = {
  gate: ["'ok', g.open = 0 and a.n >= g.need", "'ok', a.n >= g.need"],
  huntlock: ["  if not (v_gate->>'ok')::boolean then return", "  if false then return"],
  guard: ["not in ('f0db1bb166d0eccb33522bd373f4ee4e', '4a80c769286b2b6022ab79b4cb01f7c6')", "is null"],
  allows: ["(adventure_gate(p_player)->>'ok')::boolean);", "true);"],
};
const M = process.env.MUTATE;
const apply = (src, m) => { if (!src.includes(m[0])) throw new Error(`bad mutation ${M}`); return src.replace(m[0], m[1]); };
if (M) {
  if (GMUT[M]) gate = apply(gate, GMUT[M]);
  else if (MUT1[M]) mig = apply(mig, MUT1[M]);
  else if (MUT2[M]) mig2 = apply(mig2, MUT2[M]);
  else throw new Error(`unknown mutation ${M}`);
}
for (const s of [core, gate, mig, mig2]) if (s.includes('$m$') || s.includes('$t$')) throw new Error('a migration contains $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; g jsonb; d1 jsonb; d2 jsonb; fl jsonb; rm jsonb; i int; j int; n int; st jsonb; run record;
  atk bigint[]; gold bigint[]; hid bigint; foe jsonb; info jsonb; sq jsonb; wk jsonb; crit numeric; ex jsonb; seed float; bal int; v_day date; ofr jsonb;
begin
  execute $m$${core}$m$;
  execute $m$${gate}$m$;
  execute $m$${mig}$m$;
  execute $m$${mig2}$m$;
  v_day := dungeon_day();
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id not in (24, 29, 34, 44, 49) order by c.id limit 4) x;
  select array_agg(id order by id) into gold from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity::text in ('gold', 'full_art', 'secret_rare') and s.type in ('Character', 'Creature') order by c.rarity desc, c.id limit 5) x;
  insert into players (id, username) values ('tst_dg_a', 'dungeon a'), ('tst_dg_b', 'dungeon b'), ('tst_dg_c', 'dungeon c'), ('tst_dg_g', 'dungeon gate');
  insert into player_cards (player_id, card_id, quantity)
    select p, x, 1 from unnest(array['tst_dg_a', 'tst_dg_b', 'tst_dg_c']) p, unnest(array[24, 29, 34, 44, 49, 64, 93, 97]::bigint[] || atk || gold) x;

  -- 0. The flag OFF: nothing starts.
  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
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
  -- The Hunt: no squad lock, and no fight without a locked squad.
  select id into hid from hunts where status = 'active' order by id desc limit 1;
  if hid is null then insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at) values ('test', 'Normal', '[]', 1000, 1000, now() + interval '1 day') returning id into hid; end if;
  r := lock_hunt_squad('tst_dg_g', hid, array[24, 29, 34, 44, 49]);
  if r->>'error' is distinct from 'locked' then bad := bad || 'hunt lock not locked: ' || r::text || '; '; end if;
  if hunt_squad_allows(hid, 'tst_dg_g', v_day, 24) then bad := bad || 'hunt fight allowed while locked; '; end if;
  update gift_claims set claimed_at = now() where player_id = 'tst_dg_g';
  if not (adventure_gate('tst_dg_g')->>'ok')::boolean then bad := bad || 'gate closed after claim; '; end if;
  if not hunt_squad_allows(hid, 'tst_dg_g', v_day, 24) then bad := bad || 'hunt fight refused after claim; '; end if;
  r := lock_hunt_squad('tst_dg_g', hid, array[24, 29, 34, 44, 49]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'hunt lock after claim: ' || r::text || '; '; end if;
  delete from player_cards where player_id = 'tst_dg_g' and card_id = atk[3];
  if (adventure_gate('tst_dg_g')->>'ok')::boolean then bad := bad || 'gate open with 7 attackers; '; end if;


  -- 2. The generator: the same day gives the same dungeon; the shape is valid (v2 room types).
  delete from dungeon_days where day in (v_day, v_day + 1);   -- a live day may hold a v1 run (v2 keeps it); rolled back
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
      if (rm->>'type' = 'fight' and n not between 1 and 3) or (rm->>'type' = 'horde' and n not between 4 and 5)
         or (rm->>'type' in ('elite', 'miniboss', 'guardian') and n <> 1)
         or (rm->>'type' in ('treasure', 'rest', 'choice') and n <> 0)
         or rm->>'type' not in ('fight', 'horde', 'elite', 'miniboss', 'guardian', 'treasure', 'rest', 'choice') then
        bad := bad || 'room ' || i || '/' || j || ' ' || left(rm::text, 80) || '; '; end if;
      if n > 0 and jsonb_array_length(rm->'foes'->0->'moves') < 3 then bad := bad || 'no move pool ' || i || '/' || j || '; '; end if;
    end loop;
  end loop;
  -- Faster scaling (item 22): the floor 6 guardian has more than 5x the HP of the floor 1 guardian.
  if (d1->'floors'->5->4->'foes'->0->>'max')::numeric / (select (m.hp * 4.0)::numeric from dungeon_monsters m where m.key = d1->'floors'->5->4->'foes'->0->>'key')
     < 5 then bad := bad || 'slow scaling ' || (d1->'floors'->5->4->'foes'->0->>'max') || '; '; end if;
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

  -- 6. A charging monster's Cataclysm (round 6) hits every other card standing (the area roll).
  update dungeon_runs set state = run.state || jsonb_build_object('round', 5, 'buff', 1, 'foes', jsonb_build_array(foe || '{"atk":20,"charge":true}')) where id = run.id;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if r->'enemy'->0->>'action' <> 'cataclysm' then bad := bad || 'no cataclysm: ' || coalesce(r->>'enemy', r::text) || '; '; end if;
  if (select count(*) from jsonb_each(r->'state'->'cards') e where e.key <> '34' and (e.value->>'hp')::int < (e.value->>'max')::int) <> 4 then
    bad := bad || 'area hit: ' || coalesce(r->>'state', '') || '; '; end if;

  -- 7. Supports: Empower (the core value); ONE support per turn (item 17); the cooldown; Stun; Smite.
  update dungeon_runs set state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'sup_round', -1, 'foes', jsonb_build_array(foe)) where id = run.id;
  r := dungeon_support('tst_dg_a', 64, 34, null);
  if not (r->>'ok')::boolean or (r->'state'->'cards'->'34'->>'buff')::numeric <> combat_support_value('empower', (r->>'amount')::numeric, 1, null) then
    bad := bad || 'empower: ' || r::text || '; '; end if;
  if (dungeon_support('tst_dg_a', 93, null, 0)->>'error') is distinct from 'one_support' then bad := bad || 'two supports in one turn; '; end if;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if (r->'state'->'cards'->'34'->>'buff')::numeric <> 1 then bad := bad || 'empower not used by the attack; '; end if;
  if (dungeon_support('tst_dg_a', 64, 34, null)->>'error') is distinct from 'cooldown' then bad := bad || 'no cooldown; '; end if;
  r := dungeon_support('tst_dg_a', 93, null, 0);
  if not (r->>'ok')::boolean or (r->'state'->'foes'->0->>'st')::int <> 2 then bad := bad || 'stun: ' || r::text || '; '; end if;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if r->'enemy'->0->>'action' <> 'stunned' then bad := bad || 'stunned foe acted: ' || coalesce(r->>'enemy', r::text) || '; '; end if;
  select (state->'foes'->0->>'hp')::int into n from dungeon_runs where id = run.id;
  r := dungeon_support('tst_dg_a', 97, null, 0);
  if not (r->>'ok')::boolean or (r->'state'->'foes'->0->>'hp')::int <> n - combat_support_value('smite', (r->>'amount')::numeric, combat_aff_scale((r->>'aff_count')::int), null)::int then
    bad := bad || 'smite: ' || r::text || '; '; end if;
  if (dungeon_support('tst_dg_a', 34, null, 0)->>'error') is distinct from 'not_support' then bad := bad || 'attacker as support; '; end if;
  if (dungeon_attack('tst_dg_a', 64, 0)->>'error') is distinct from 'not_attacker' then bad := bad || 'support as attacker; '; end if;

  -- 8. A kill: NO Shards granted yet (the loot is at risk, item 12); the rewards; the next room.
  bal := (select shard_balance from players where id = 'tst_dg_a');
  update dungeon_runs set floor = 1, room = 1, shards = 0, state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'sup_round', -1,
    'room_type', 'fight', 'foes', jsonb_build_array(foe || '{"hp":1,"max":50}')) where id = run.id;
  for i in 1..20 loop
    r := dungeon_attack('tst_dg_a', 34, 0);
    exit when (r->>'kill')::boolean;
  end loop;
  if not coalesce((r->>'kill')::boolean, false) then bad := bad || 'no kill: ' || r::text || '; '; end if;
  if (select shard_balance from players where id = 'tst_dg_a') <> bal then bad := bad || 'Shards granted before the run ended; '; end if;
  if (r->'state'->'pend'->>'shards')::int <> 1 then bad := bad || 'kill shards at risk ' || coalesce(r->'state'->>'pend', '-') || '; '; end if;
  if r->'state'->>'phase' <> 'choose' or jsonb_array_length(r->'state'->'offers') <> 3 or jsonb_array_length(r->'enemy') <> 0
     or (select count(distinct o->>'kind') from jsonb_array_elements(r->'state'->'offers') o) <> 3 then
    bad := bad || 'after the room: ' || coalesce(r->>'state', r::text) || '; '; end if;
  if (dungeon_attack('tst_dg_a', 34, 0)->>'error') is distinct from 'not_fighting' then bad := bad || 'attack while choosing; '; end if;
  ofr := r->'state'->'offers'->0;
  r := dungeon_choose('tst_dg_a', 0);
  if not (r->>'ok')::boolean or (r->>'room')::int <> 2 or (r->>'floor')::int <> 1 or r->'state'->>'last_pick' is distinct from ofr->>'kind' then
    bad := bad || 'choose: ' || r::text || '; '; end if;
  if r->'state'->>'room_type' <> d1->'floors'->0->1->>'type' then bad := bad || 'room 2 type; '; end if;
  if (select count(*) from dungeon_log where run_id = run.id) < 25 then bad := bad || 'log rows; '; end if;

  -- 9. A rest room heals and revives; a chest adds its loot to the loot at risk (item 14); a choice offers doors.
  st := dungeon_enter(jsonb_build_object('buff', 1, 'pend', '{"shards":0,"cards":[]}'::jsonb, 'cards', jsonb_build_object('1', '{"hp":0,"max":100,"down":true,"shield":0,"buff":1,"debuff":1,"cd":0}'::jsonb,
          '2', '{"hp":10,"max":100,"down":false,"shield":0,"buff":1,"debuff":1,"cd":0}'::jsonb)),
          '[[{"type":"rest","foes":[]}, {"type":"treasure","foes":[]}, {"type":"choice","foes":[]}]]', 1, 1);
  if st->>'phase' <> 'rest' or (st->'cards'->'1'->>'down')::boolean or (st->'cards'->'1'->>'hp')::int <> 25 or (st->'cards'->'2'->>'hp')::int <> 50 then
    bad := bad || 'rest: ' || st::text || '; '; end if;
  st := dungeon_enter(st, '[[{"type":"rest","foes":[]}, {"type":"treasure","foes":[]}, {"type":"choice","foes":[]}]]', 1, 2);
  if st->>'phase' <> 'chest' or (st->'chest'->>'tier')::int not between 1 and 5 or (st->'pend'->>'shards')::int <> (st->'chest'->>'shards')::int then
    bad := bad || 'chest: ' || st::text || '; '; end if;
  st := dungeon_enter(st, '[[{"type":"rest","foes":[]}, {"type":"treasure","foes":[]}, {"type":"choice","foes":[]}]]', 1, 3);
  if st->>'phase' <> 'path' or jsonb_array_length(st->'offers') not between 2 and 3 or exists (select 1 from jsonb_array_elements(st->'offers') o where o->>'kind' <> 'door') then
    bad := bad || 'choice: ' || st::text || '; '; end if;

  -- 10. The guardian of floor 1 banks the floor's loot (+ the floor bonus); the floor_done screen.
  update dungeon_runs set floor = 1, room = 5, state = run.state || jsonb_build_object('round', 0, 'buff', 1, 'phase', 'fight', 'room_type', 'guardian', 'sup_round', -1,
    'bank', '{"shards":5,"cards":[]}'::jsonb, 'pend', '{"shards":7,"cards":[24]}'::jsonb, 'foes', jsonb_build_array(foe || '{"hp":1}')) where id = run.id;
  if (dungeon_retreat('tst_dg_a')->>'error') is distinct from 'not_between_floors' then bad := bad || 'retreat in the middle of a floor; '; end if;
  for i in 1..20 loop
    r := dungeon_attack('tst_dg_a', 34, 0);
    exit when (r->>'kill')::boolean;
  end loop;
  st := r->'state';
  if st->>'phase' <> 'floor_done' or (st->'bank'->>'shards')::int <> 5 + 7 + 1 + 10 or (st->'pend'->>'shards')::int <> 0
     or not (st->'bank'->'cards' @> '[24]') then bad := bad || 'floor done: ' || left(st::text, 300) || '; '; end if;
  r := dungeon_choose('tst_dg_a', 0);
  if not (r->>'ok')::boolean or (r->>'floor')::int <> 2 or (r->>'room')::int <> 1 then bad := bad || 'next floor: ' || r::text || '; '; end if;

  -- 11. The last guardian clears the run: everything is granted once, never past 300 Shards.
  bal := (select shard_balance from players where id = 'tst_dg_a');
  update dungeon_runs set floor = 30, room = 5, state = state || jsonb_build_object('round', 0, 'buff', 1, 'phase', 'fight', 'room_type', 'guardian', 'sup_round', -1,
    'bank', '{"shards":20,"cards":[]}'::jsonb, 'pend', '{"shards":30,"cards":[]}'::jsonb, 'foes', jsonb_build_array(foe || '{"hp":1}')) where id = run.id;
  for i in 1..20 loop
    r := dungeon_attack('tst_dg_a', 34, 0);
    exit when (r->>'kill')::boolean;
  end loop;
  select * into run from dungeon_runs where id = run.id;
  if run.status <> 'over' or run.ended_by is distinct from 'cleared' then bad := bad || 'cleared: ' || run.status || '/' || coalesce(run.ended_by, '-') || '; '; end if;
  if (select shard_balance from players where id = 'tst_dg_a') - bal <> 300 or run.shards <> 300 then
    bad := bad || 'clear grant ' || ((select shard_balance from players where id = 'tst_dg_a') - bal) || ' / ' || run.shards || '; '; end if;
  if (dungeon_attack('tst_dg_a', 34, 0)->>'error') is distinct from 'no_run' then bad := bad || 'attack after the end; '; end if;

  -- 12. A fall loses the floor's loot at risk and keeps the bank; Retreat (between floors) keeps the bank.
  bal := (select shard_balance from players where id = 'tst_dg_b');
  r := dungeon_start('tst_dg_b', array[34, 44, 64, 93, 97]);
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  n := (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 24);
  update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array(foe || '{"atk":5000,"charge":true}')) || '{"round": 5}'::jsonb
    || jsonb_build_object('bank', '{"shards":20,"cards":[]}'::jsonb, 'pend', '{"shards":50,"cards":[24]}'::jsonb) where id = run.id;
  r := dungeon_attack('tst_dg_b', 34, 0);
  select * into run from dungeon_runs where id = run.id;
  if run.status <> 'over' or run.ended_by is distinct from 'fell' then bad := bad || 'fell: ' || run.status || '/' || coalesce(run.ended_by, '-') || ' ' || left(r::text, 200) || '; '; end if;
  if (select shard_balance from players where id = 'tst_dg_b') - bal <> 20 or run.shards <> 20 or (run.state->'lost'->>'shards')::int <> 50
     or (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 24) <> n then
    bad := bad || 'fall grant ' || ((select shard_balance from players where id = 'tst_dg_b') - bal) || '; '; end if;
  delete from dungeon_runs where player_id = 'tst_dg_b';
  bal := (select shard_balance from players where id = 'tst_dg_b');
  n := (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 29);
  r := dungeon_start('tst_dg_b', array[34, 44, 64, 93, 97]);
  update dungeon_runs set floor = 4, room = 5, state = state || jsonb_build_object('phase', 'floor_done', 'bank', '{"shards":12,"cards":[29]}'::jsonb) where player_id = 'tst_dg_b';
  r := dungeon_retreat('tst_dg_b');
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  if not (r->>'ok')::boolean or run.ended_by is distinct from 'retreat' or run.shards <> 12 or (select shard_balance from players where id = 'tst_dg_b') - bal <> 12
     or (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 29) <> n + 1 then bad := bad || 'retreat: ' || r::text || '; '; end if;

  -- 13. The board, the view (the rooms ahead hidden, item 15), the old runs settled with the bank.
  r := dungeon_board(v_day, 50);
  if (select e->>'player_id' from jsonb_array_elements(r) e order by (e->>'rank')::int limit 1) <> 'tst_dg_a'
     or not exists (select 1 from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_b') then bad := bad || 'board: ' || r::text || '; '; end if;
  r := dungeon_view('tst_dg_b');
  if not (r->>'ok')::boolean or r->'run'->>'ended_by' <> 'retreat' or (r->'run'->>'rank')::int < 1 or not (r->'gate'->>'ok')::boolean then bad := bad || 'view: ' || left(r::text, 200) || '; '; end if;
  if (select (e->>'cp')::int from jsonb_array_elements(r->'mine') e where (e->>'id')::bigint = 34) is distinct from (dungeon_card('tst_dg_b', 34)->'cmb'->>'cp')::int then bad := bad || 'view mine; '; end if;
  r := dungeon_view('tst_dg_g');
  if exists (select 1 from jsonb_array_elements(r->'rooms') with ordinality x(v, idx) where x.idx between 2 and 4 and x.v->>'type' not in ('unknown', 'guardian'))
     or r->'rooms'->4->>'type' <> 'guardian' then bad := bad || 'rooms ahead shown: ' || (r->>'rooms') || '; '; end if;
  bal := (select shard_balance from players where id = 'tst_dg_g');
  insert into dungeon_runs (player_id, day, squad, state) values ('tst_dg_g', v_day - 1, array[24, 29, 34, 44, 49]::bigint[],
    jsonb_build_object('phase', 'fight', 'bank', '{"shards":30,"cards":[]}'::jsonb, 'pend', '{"shards":40,"cards":[]}'::jsonb));
  perform dungeon_settle_stale();
  if (select shard_balance from players where id = 'tst_dg_g') - bal <> 30 or (select ended_by from dungeon_runs where player_id = 'tst_dg_g' and day = v_day - 1) <> 'abandoned' then
    bad := bad || 'stale settle; '; end if;

  -- 14. The v2 rules on their own.
  -- 14a. Offers: the last pick never comes back (30 draws); Heal / Revive once per floor; tiers 1..5.
  for i in 1..30 loop
    r := dungeon_offers(jsonb_build_object('last_pick', 'buff', 'cards', '{}'::jsonb), 3);
    if exists (select 1 from jsonb_array_elements(r) o where o->>'kind' = 'buff' or (o->>'tier')::int not between 1 and 5) then bad := bad || 'offer repeat / tier; '; exit; end if;
    r := dungeon_offers(jsonb_build_object('heal_floor', 3, 'cards', '{"1":{"down":true}}'::jsonb), 3);
    if exists (select 1 from jsonb_array_elements(r) o where o->>'kind' in ('heal', 'revive')) then bad := bad || 'heal twice on a floor; '; exit; end if;
  end loop;
  -- 14b. Support cooldowns carry over (item 9): 5 at round 2 -> 3 rounds left; an attacker's stun does not.
  st := dungeon_enter(jsonb_build_object('round', 2, 'buff', 1, 'cards', jsonb_build_object(
          '64', '{"hp":60,"max":60,"down":false,"shield":0,"buff":1,"debuff":1,"cd":5,"sup":true}'::jsonb,
          '34', '{"hp":60,"max":60,"down":false,"shield":0,"buff":1,"debuff":1,"cd":5,"sup":false}'::jsonb)),
          jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'fight', 'foes', jsonb_build_array(foe)))), 1, 1);
  if (st->'cards'->'64'->>'cd')::int <> 3 or (st->'cards'->'34'->>'cd')::int <> 0 then bad := bad || 'cooldown carry ' || (st->>'cards') || '; '; end if;
  -- 14c. Move pools (item 20): a guard pool guards; a poison pool poisons; a charger charges on round 5.
  r := combat_pool_act(50, 1, 1, 0, 0, 1000, '[{"name":"Stone Skin","kind":"guard","w":1}]', false);
  if r->>'action' <> 'guard' or (r->>'guard')::int <> 200 or r->>'move' <> 'Stone Skin' then bad := bad || 'guard move ' || r::text || '; '; end if;
  r := combat_pool_act(50, 1, 1, 0, 0, 1000, '[{"name":"Acid Spit","kind":"poison","w":1}]', false);
  if r->>'action' <> 'poison' or (r->>'dot')::int < 1 or (r->>'dmg')::int < 1 then bad := bad || 'poison move ' || r::text || '; '; end if;
  if combat_pool_act(50, 1, 5, 0, 0, 1000, '[]', true)->>'action' <> 'charging' then bad := bad || 'no charge; '; end if;
  -- 14d. A monster's guard absorbs the hit first.
  r := dungeon_start('tst_dg_c', array[34, 44, 64, 93, 97]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'start c: ' || r::text || '; ';
  else
    update dungeon_runs set state = state || jsonb_build_object('round', 0, 'foes', jsonb_build_array(foe || '{"sh":100000}')) where player_id = 'tst_dg_c' and day = v_day;
    r := dungeon_attack('tst_dg_c', 34, 0);
    if (r->>'damage')::int <> 0 or (r->'state'->'foes'->0->>'hp')::int < 100000 - 5 then bad := bad || 'guard absorb ' || left(r::text, 200) || '; '; end if;
  end if;
  -- 14e. The loot at risk never passes 300 in total.
  st := dungeon_loot('{"bank":{"shards":290,"cards":[]},"pend":{"shards":5,"cards":[]}}', 100, null);
  if (st->'pend'->>'shards')::int <> 10 then bad := bad || 'cap ' || st::text || '; '; end if;

  -- 15. The live-version guard: the migrations run again on their own result; a changed live function stops them.
  begin execute $m$${core}$m$; execute $m$${gate}$m$;
  exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.lock_hunt_squad'::regproc), 'begin', 'begin -- changed by someone else');
  begin execute $m$${gate}$m$; bad := bad || 'the guard let a changed lock_hunt_squad through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;
  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 3000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
