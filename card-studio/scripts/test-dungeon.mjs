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
 *     retreat   Retreat in the middle of a floor               lastatk   the run goes on with only support cards standing
 *     odds      every chest tier uses the Legend odds          chestodds the treasure room ignores the chest odds
 *     rewardodds  a reward card keeps one fixed rarity per tier    noodds  a card offer does not show its odds
 *   The Gauntlet (gauntlet.sql): gcost gpool gtheme gchar gseed (the weekly squad), gtreasure gdoors goffers gloot
 *     gsettle (no loot), gbase gmode (base cards, each action finds its own run), gdaily gbest (the boards),
 *     godds gonce gtick gflag (the prizes and the flags), gguard (the live-version guard).
 *   dailypacks (balance key dungeon_prizes, read by dungeon_pay through dungeon_prizes_cfg since balance_economy.sql):
 *     the daily 1st prize gives packs again. (dungeon_prizes_daily.sql only writes settings.dungeon_prizes, which the
 *     balance key overrides, so a mutation of that file can no longer fail.)
 * Env: CORE, GATE, MIG, MIG2, MIG3, MIG4, MIG5, MIG6, MIG7 = other paths for combat_core.sql, adventure_gate.sql, dungeon.sql,
 *      dungeon_v2.sql, dungeon_v2_fix.sql, dungeon_chest_odds.sql, dungeon_reward_odds.sql, gauntlet.sql, dungeon_prizes_daily.sql.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const strip = (s) => s.replace(/notify pgrst[^\n]*\n/g, '').replace(/\r\n/g, '\n');
// balance_table.sql first: combat_core.sql and the Dungeon read the combat numbers from public.balance.
const bal = strip(readFileSync(process.env.BAL || new URL('../../tcg-bot/supabase/balance_table.sql', import.meta.url), 'utf8'));
// combat_core.sql: only the shared combat rules (the Dungeon uses them). Its guard and its Hunt section (the 2026-10-03
// rebuild of hunt_attack / hunt_support) are left out: hunt_boss_moves.sql replaced both live, so the guard refuses the
// file (as designed), and this test does not use the Hunt functions.
const coreFile = strip(readFileSync(process.env.CORE || new URL('../../tcg-bot/supabase/combat_core.sql', import.meta.url), 'utf8'));
const HUNT_PART = '-- ---- The Hunt on the core';
if (!coreFile.includes(HUNT_PART) || !/do \$g\$[\s\S]*?end \$g\$;/.test(coreFile)) throw new Error('combat_core.sql changed: no guard or no Hunt section');
const core = coreFile.slice(0, coreFile.indexOf(HUNT_PART)).replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
let gate = strip(readFileSync(process.env.GATE || new URL('../../tcg-bot/supabase/adventure_gate.sql', import.meta.url), 'utf8'));
// The old one-run-a-day index: gauntlet.sql (below, in the same block) drops it for dungeon_runs_one_a_day_mode
// (player, day, mode). On a database that holds a daily AND a Gauntlet run of one member on one day, creating it
// again fails (23505), so it is left out here. The end state is the same as the files in order.
const OLD_INDEX = 'create unique index if not exists dungeon_runs_one_a_day on public.dungeon_runs (player_id, day);\n';
let mig = strip(readFileSync(process.env.MIG || new URL('../../tcg-bot/supabase/dungeon.sql', import.meta.url), 'utf8'));
if (!mig.includes(OLD_INDEX)) throw new Error('dungeon.sql changed: the old one-run-a-day index line is not there');
mig = mig.replace(OLD_INDEX, '-- (the old one-run-a-day index: gauntlet.sql replaces it)\n');
let mig2 = strip(readFileSync(process.env.MIG2 || new URL('../../tcg-bot/supabase/dungeon_v2.sql', import.meta.url), 'utf8'));
// The fix replaces dungeon_attack whole: its live-version guard is skipped here (the mutations change the text).
let mig3 = strip(readFileSync(process.env.MIG3 || new URL('../../tcg-bot/supabase/dungeon_v2_fix.sql', import.meta.url), 'utf8')).replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
let mig4 = strip(readFileSync(process.env.MIG4 || new URL('../../tcg-bot/supabase/dungeon_chest_odds.sql', import.meta.url), 'utf8')).replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
let mig5 = strip(readFileSync(process.env.MIG5 || new URL('../../tcg-bot/supabase/dungeon_reward_odds.sql', import.meta.url), 'utf8')).replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
// The Gauntlet: its guard is skipped in the main run (the mutations change the text); section 17 runs the file as shipped.
let mig6full = strip(readFileSync(process.env.MIG6 || new URL('../../tcg-bot/supabase/gauntlet.sql', import.meta.url), 'utf8'));
let mig7 = strip(readFileSync(process.env.MIG7 || new URL('../../tcg-bot/supabase/dungeon_prizes_daily.sql', import.meta.url), 'utf8'));
let mig6 = mig6full.replace(/do \$g\$[\s\S]*?end \$g\$;/, '');
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
const MUT3 = {   // dungeon_v2_fix.sql
  lastatk: ["where not (value->>'down')::boolean and not coalesce((value->>'sup')::boolean, false)) then st := st || '{\"phase\": \"fell\"}'", "where not (value->>'down')::boolean) then st := st || '{\"phase\": \"fell\"}'"],
};
const MUT4 = {   // dungeon_chest_odds.sql
  odds: ["(least(5, greatest(1, p_tier)))::text", "'5'"],
  chestodds: ["dungeon_card_of(dungeon_chest_rarity(t))", "dungeon_card_of((array['normal', 'normal', 'illustrated_rare', 'illustrated_rare', 'secret_rare'])[t])"],
};
const MUT5 = {   // dungeon_reward_odds.sql
  noodds: ["'odds', case when k = 'card'", "'odds_x', case when k = 'card'"],
  rewardodds: ["dungeon_card_of(dungeon_chest_rarity(coalesce((o->>'tier')::int, 1)))", "dungeon_card_of((array['normal', 'normal', 'illustrated_rare', 'illustrated_rare', 'secret_rare'])[coalesce((o->>'tier')::int, 1)])"],
};
const GMUT = {
  gate: ["'ok', g.open = 0 and a.n >= g.need", "'ok', a.n >= g.need"],
  huntlock: ["  if not (v_gate->>'ok')::boolean then return", "  if false then return"],
  guard: ["not in ('4a80c769286b2b6022ab79b4cb01f7c6', '22bf3511259d728791ee370775beb5f2')", "is null"],
  allows: ["(adventure_gate(p_player)->>'ok')::boolean);", "true);"],
};
const RUNM = "and status = 'active' and mode = coalesce(p_mode, 'daily') for update;";
const MUT6 = {   // gauntlet.sql
  gcost: ["c := a_cost[i] + a_cost[j] + a_cost[l] + s_cost[m] + s_cost[n];", "c := a_cost[i] + a_cost[j] + a_cost[l] + s_cost[m];"],
  gpool: ["  where c.source::text not in ('event', 'promo') and c.rarity::text not in ('event', 'promo')\n    and (s.type in", "  where true\n    and (s.type in"],
  gtheme: ["where p.role = 'attacker' and (th is null or th = any(p.tags))", "where p.role = 'attacker' and true"],
  gchar: ["continue when a_key[i] = a_key[j] or a_key[i] = a_key[l] or a_key[j] = a_key[l];", "continue when a_id[i] = a_id[j] or a_id[i] = a_id[l] or a_id[j] = a_id[l];"],
  gseed: ["dungeon_rand(k || '|a|' || p.id) o", "random() o"],
  gtreasure: ["wts jsonb := balance_get('gauntlet')->'room_weights';", "wts jsonb := balance_get('dungeon')->'room_weights';"],
  gdoors: ["then array['elite','rest','horde'] else", "then array['elite','rest','treasure','horde','gamble'] else"],
  goffers: ["then array['heal','buff','ward','reset','revive']", "then array['heal','buff','shards','card','ward','reset','revive']"],
  gloot: ["v_loot boolean := coalesce(p_state->>'mode', 'daily') <> 'gauntlet';", "v_loot boolean := true;"],
  gsettle: ["if r.mode = 'gauntlet' then r.state := r.state - 'bank' - 'pend'; end if;", ""],
  gbase: ["then case when p_card = any(p_run.squad) then dungeon_card_base(p_card) end", "then dungeon_card(p_run.player_id, p_card)"],
  gmode: [RUNM, "and status = 'active' for update;"],
  gdaily: ["where r.day = coalesce(p_day, dungeon_day()) and r.mode = 'daily'", "where r.day = coalesce(p_day, dungeon_day())"],
  gbest: ["order by r.player_id, r.floor desc, r.room desc", "order by r.player_id, r.day desc, r.floor desc, r.room desc"],
  godds: ["v_rar := dungeon_pick(p->'odds', random()::numeric);", "v_rar := 'secret_rare';"],
  gonce: ["if not found then return jsonb_build_object('ok', false, 'error', 'already_paid'); end if;", ""],
  gtick: ["if not coalesce((pz->>'enabled')::boolean, false) then return", "if false then return"],
  gflag: ["or not coalesce((gauntlet_cfg()->>'enabled')::boolean, false) then", "then"],
};
const MUT7 = {};  // dungeon_prizes_daily.sql (superseded by balance key dungeon_prizes: see BMUT)
// Balance mutations: a statement that changes one balance value after the files (the mechanism is the value).
const BMUT = {
  dailypacks: `update public.balance set value = jsonb_set(value, '{daily,0,packs}', '2') where key = 'dungeon_prizes';`,
};
const MUT6G = { gguard: ["if m not in (x[2], x[3]) then raise", "if false then raise"] };   // the guard (section 17, the file as shipped)
const M = process.env.MUTATE;
const apply = (src, m) => { if (!src.includes(m[0])) throw new Error(`bad mutation ${M}`); return src.replace(m[0], m[1]); };
if (M) {
  // A mutation applies to its own file (it must match), and to every later file that rebuilds the same function.
  const files = [['mig', MUT1], ['mig2', MUT2], ['mig3', MUT3], ['mig4', MUT4], ['mig5', MUT5], ['mig6', MUT6], ['mig7', MUT7]];
  const V = { mig, mig2, mig3, mig4, mig5, mig6, mig7 };
  const at = files.findIndex(([, T]) => T[M]);
  if (BMUT[M]) { /* runs after the files (below) */ }
  else if (GMUT[M]) gate = apply(gate, GMUT[M]);
  else if (MUT6G[M]) mig6full = apply(mig6full, MUT6G[M]);
  else if (at >= 0) {
    const mm = files[at][1][M];
    V[files[at][0]] = apply(V[files[at][0]], mm);
    for (const [k] of files.slice(at + 1)) V[k] = V[k].replace(mm[0], mm[1]);
    if (files.slice(at).some(([k]) => k === 'mig6')) mig6full = mig6full.replace(mm[0], mm[1]);
    ({ mig, mig2, mig3, mig4, mig5, mig6, mig7 } = V);
  } else throw new Error(`unknown mutation ${M}`);
}
for (const s of [bal, core, gate, mig, mig2, mig3, mig4, mig5, mig6full, mig7]) if (s.includes('$m$') || s.includes('$t$')) throw new Error('a migration contains $m$ or $t$');

const body = String.raw`do $t$
declare bad text := ''; r jsonb; g jsonb; d1 jsonb; d2 jsonb; fl jsonb; rm jsonb; i int; j int; n int; st jsonb; run record;
  atk bigint[]; gold bigint[]; stn bigint; hid bigint; foe jsonb; info jsonb; sq jsonb; wk jsonb; crit numeric; ex jsonb; seed float; bal int; v_day date; ofr jsonb;
begin
  if to_regclass('public.balance') is null then execute $m$${bal}$m$; end if;
  execute $m$${core}$m$;
  execute $m$${gate}$m$;
  execute $m$${mig}$m$;
  execute $m$${mig2}$m$;
  execute $m$${mig3}$m$;
  execute $m$${mig4}$m$;
  execute $m$${mig5}$m$;
  execute $m$${mig6}$m$;
  execute $m$${mig7}$m$;
  ${M && BMUT[M] ? `execute $m$${BMUT[M]}$m$;   -- the balance mutation ${M}` : '-- (no balance mutation)'}
  v_day := dungeon_day();
  -- The stun card (it was card 93; card abilities change, so it is looked up).
  select min(c.id) into stn from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'effect' = 'stun';
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') and c.id not in (24, 29, 34, 44, 49) order by c.id limit 4) x;
  select array_agg(id order by id) into gold from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity::text in ('gold', 'full_art', 'secret_rare') and s.type in ('Character', 'Creature') order by c.rarity desc, c.id limit 5) x;
  insert into players (id, username) values ('tst_dg_a', 'dungeon a'), ('tst_dg_b', 'dungeon b'), ('tst_dg_c', 'dungeon c'), ('tst_dg_g', 'dungeon gate');
  insert into player_cards (player_id, card_id, quantity)
    select p, x, 1 from unnest(array['tst_dg_a', 'tst_dg_b', 'tst_dg_c']) p, unnest(array[24, 29, 34, 44, 49, 64, stn, 97]::bigint[] || atk || gold) x;

  -- 0. The flag OFF: nothing starts.
  update settings set value = value || '{"enabled": false}' where key = 'dungeon';
  r := dungeon_start('tst_dg_a', array[34, 44, 64, stn, 97]);
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
  r := dungeon_start('tst_dg_a', array[34, 44, 64, stn]);
  if r->>'error' is distinct from 'squad_size' then bad := bad || 'size: ' || r::text || '; '; end if;
  r := dungeon_start('tst_dg_a', array[34, 44, 64, stn, 999999]);
  if r->>'error' is distinct from 'not_owned' then bad := bad || 'owned: ' || r::text || '; '; end if;
  r := dungeon_start('tst_dg_a', gold);
  if r->>'error' is distinct from 'budget' then bad := bad || 'budget: ' || r::text || '; '; end if;
  update dungeon_days set rule = dungeon_rules()->0 where day = v_day;   -- Creatures and Items only
  r := dungeon_start('tst_dg_a', array[24, 29, 34, 64, stn]);
  if r->>'error' is distinct from 'rule' then bad := bad || 'rule: ' || r::text || '; '; end if;
  update dungeon_days set rule = dungeon_rules()->8 where day = v_day;
  r := dungeon_start('tst_dg_a', array[34, 44, 64, stn, 97]);
  if not (r->>'ok')::boolean then bad := bad || 'start: ' || r::text || '; '; end if;
  if (dungeon_start('tst_dg_a', array[34, 44, 64, stn, 97])->>'error') is distinct from 'already' then bad := bad || 'two runs a day; '; end if;
  select * into run from dungeon_runs where player_id = 'tst_dg_a' and day = v_day;
  if run.state->>'phase' <> 'fight' or jsonb_array_length(run.state->'foes') < 1 then bad := bad || 'room 1 not a fight; '; end if;
  if (run.state->'cards'->'64'->>'max')::int <> card_max_hp(0) then bad := bad || 'support hp; '; end if;
  if (run.state->'cards'->'34'->>'max')::int <> (dungeon_card('tst_dg_a', 34)->'cmb'->>'hp')::int then bad := bad || 'attacker hp; '; end if;

  -- 4. THE COMBAT CORE: the attack damage = combat_hit with the same seed (x the run buff).
  foe := '{"key":"slime","name":"T","element":"fire","level":1,"hp":100000,"max":100000,"atk":1,"weak":[],"resist":[],"passives":[],"tags":[],"enr":0,"enru":0,"wk":0,"wku":0,"ex":0,"exu":0,"st":0}';
  info := dungeon_card('tst_dg_a', 34);
  sq := combat_squad(dungeon_txt(info->'tags'), true, (select jsonb_agg(coalesce(to_jsonb(s.tag_slugs), '[]'::jsonb)) from unnest(array[44, 64, stn, 97]::bigint[]) x
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
  if (dungeon_support('tst_dg_a', stn, null, 0)->>'error') is distinct from 'one_support' then bad := bad || 'two supports in one turn; '; end if;
  r := dungeon_attack('tst_dg_a', 34, 0);
  if (r->'state'->'cards'->'34'->>'buff')::numeric <> 1 then bad := bad || 'empower not used by the attack; '; end if;
  if (dungeon_support('tst_dg_a', 64, 34, null)->>'error') is distinct from 'cooldown' then bad := bad || 'no cooldown; '; end if;
  r := dungeon_support('tst_dg_a', stn, null, 0);
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
  r := dungeon_start('tst_dg_b', array[34, 44, 64, stn, 97]);
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
  -- 12b. The last ATTACKER down is a fall, even while support cards stand (else no attack is possible and
  -- the run never ends: found in the preview, 2026-10-03). A plain strike only: the supports stay up.
  r := dungeon_start('tst_dg_b', array[34, 44, 64, stn, 97]);
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  update dungeon_runs set state = jsonb_set(state, '{foes}', jsonb_build_array(foe || '{"hp":99999,"max":99999,"atk":5000,"charge":false,"sh":0,"passives":[],"moves":[{"name":"Hit","kind":"strike","w":1}]}'))
    || jsonb_build_object('cards', (select jsonb_object_agg(e.k, case when e.k <> '34' and not coalesce((e.v->>'sup')::boolean, false) then e.v || '{"down":true,"hp":0}' else e.v end) from jsonb_each(state->'cards') e(k, v)))
  where id = run.id;
  r := dungeon_attack('tst_dg_b', 34, 0);
  select * into run from dungeon_runs where id = run.id;
  if not exists (select 1 from jsonb_each(run.state->'cards') e where not (e.value->>'down')::boolean) then bad := bad || 'last attacker: the supports fell too (the case is not tested); '; end if;
  if run.status <> 'over' or run.ended_by is distinct from 'fell' then bad := bad || 'last attacker down, run goes on: ' || run.status || ' ' || left(r::text, 160) || '; '; end if;
  delete from dungeon_runs where player_id = 'tst_dg_b';
  bal := (select shard_balance from players where id = 'tst_dg_b');
  n := (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 29);
  r := dungeon_start('tst_dg_b', array[34, 44, 64, stn, 97]);
  update dungeon_runs set floor = 4, room = 5, state = state || jsonb_build_object('phase', 'floor_done', 'bank', '{"shards":12,"cards":[29]}'::jsonb) where player_id = 'tst_dg_b';
  r := dungeon_retreat('tst_dg_b');
  select * into run from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;
  if not (r->>'ok')::boolean or run.ended_by is distinct from 'retreat' or run.shards <> 12 or (select shard_balance from players where id = 'tst_dg_b') - bal <> 12
     or (select quantity from player_cards where player_id = 'tst_dg_b' and card_id = 29) <> n + 1 then bad := bad || 'retreat: ' || r::text || '; '; end if;

  -- 12c. Chest card odds (Nathan): each tier rolls the rarity; a higher tier has better odds, every tier can
  -- still give the lower cards. Tier 2 = [80, 18, 2], tier 5 = [15, 50, 35] (2000 rolls each).
  declare k int; rr text; n2 int := 0; s2 int := 0; n5 int := 0; s5 int := 0; lowhi int := 0; st3 jsonb; fl3 jsonb; begin
    for k in 1..2000 loop
      rr := dungeon_chest_rarity(2); if rr = 'normal' then n2 := n2 + 1; elsif rr = 'secret_rare' then s2 := s2 + 1; end if;
      rr := dungeon_chest_rarity(5); if rr = 'normal' then n5 := n5 + 1; elsif rr = 'secret_rare' then s5 := s5 + 1; end if;
    end loop;
    if not (n2 between 1450 and 1750 and s2 between 10 and 90 and n5 between 180 and 420 and s5 between 580 and 820) then
      bad := bad || format('chest odds: tier 2 normal %s SR %s, tier 5 normal %s SR %s; ', n2, s2, n5, s5); end if;
    -- The treasure room uses them: an Ultra or Legend chest can still give a Normal card.
    fl3 := jsonb_build_array(jsonb_build_array(jsonb_build_object('type', 'treasure', 'foes', '[]'::jsonb)));
    for k in 1..1500 loop
      st3 := dungeon_enter(jsonb_build_object('cards', '{}'::jsonb, 'bank', '{"shards":0,"cards":[]}'::jsonb, 'pend', '{"shards":0,"cards":[]}'::jsonb), fl3, 1, 1);
      if (st3->'chest'->>'tier')::int >= 4 and (select rarity::text from cards where id = (st3->'chest'->>'card')::bigint) = 'normal' then lowhi := lowhi + 1; end if;
    end loop;
    if lowhi = 0 then bad := bad || 'no Normal card from an Ultra / Legend chest in 1500 chests; '; end if;
  end;

  -- 12d. Reward card odds (Nathan): a reward card rolls its rarity on the tier odds when it is picked.
  -- A Legend card (tier 5 = [15, 50, 35]) picked 300 times gives Normal and SR cards; the offer carries no rarity.
  declare k int; nn int := 0; ss int := 0; rr text; b0 dungeon_runs; begin
    select * into b0 from dungeon_runs where player_id = 'tst_dg_b' and day = v_day;   -- put back after (the board and the view use it)
    delete from dungeon_runs where player_id = 'tst_dg_b';
    r := dungeon_start('tst_dg_b', array[34, 44, 64, stn, 97]);
    for k in 1..300 loop
      update dungeon_runs set room = 1, state = state || jsonb_build_object('phase', 'choose', 'offers', '[{"kind":"card","tier":5,"amount":0}]'::jsonb,
        'pend', '{"shards":0,"cards":[]}'::jsonb) where player_id = 'tst_dg_b' and day = v_day;
      r := dungeon_choose('tst_dg_b', 0);
      rr := (select rarity::text from cards where id = (r->>'card')::bigint);
      if rr is null then bad := bad || 'reward card: ' || left(r::text, 160) || '; '; exit; end if;
      if rr = 'normal' then nn := nn + 1; elsif rr = 'secret_rare' then ss := ss + 1; end if;
    end loop;
    if not (nn between 20 and 80 and ss between 70 and 140) then bad := bad || format('reward odds: Legend normal %s SR %s of 300; ', nn, ss); end if;
    delete from dungeon_runs where player_id = 'tst_dg_b';
    insert into dungeon_runs overriding system value select b0.*;
    for k in 1..30 loop
      if exists (select 1 from jsonb_array_elements(dungeon_offers(jsonb_build_object('cards', '{}'::jsonb), 3)) o where o ? 'rarity' or (o->>'kind' = 'card' and coalesce(jsonb_array_length(o->'odds'), 0) <> 3)) then bad := bad || 'an offer carries a rarity or no odds; '; exit; end if;
    end loop;
  end;

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
  r := dungeon_start('tst_dg_c', array[34, 44, 64, stn, 97]);
  if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'start c: ' || r::text || '; ';
  else
    update dungeon_runs set state = state || jsonb_build_object('round', 0, 'foes', jsonb_build_array(foe || '{"sh":100000}')) where player_id = 'tst_dg_c' and day = v_day;
    r := dungeon_attack('tst_dg_c', 34, 0);
    if (r->>'damage')::int <> 0 or (r->'state'->'foes'->0->>'hp')::int < 100000 - 5 then bad := bad || 'guard absorb ' || left(r::text, 200) || '; '; end if;
  end if;
  -- 14e. The loot at risk never passes 300 in total.
  st := dungeon_loot('{"bank":{"shards":290,"cards":[]},"pend":{"shards":5,"cards":[]}}', 100, null);
  if (st->'pend'->>'shards')::int <> 10 then bad := bad || 'cap ' || st::text || '; '; end if;

  -- 16. The Gauntlet (Nathan 2026-10-03): the weekly squad, the runs (one a day, base cards, no loot), the
  -- board (the best run of the week), the prizes (paid once).
  declare w date := gauntlet_week(dungeon_day()); gq jsonb; ids bigint[]; k int; nsq int := 0; prev text := ''; wk2 record;
    gr dungeon_runs; dr dungeon_runs; tmp jsonb; b0 int; p0 int; q29 int; foe0 jsonb; heal jsonb;
  begin
    update settings set value = value || '{"enabled": true}' where key = 'gauntlet';
    -- 16a. The pool: every card but Event and Promo (attackers, and the other types with a support move).
    if exists (select 1 from gauntlet_pool() p join cards c on c.id = p.id where c.rarity::text in ('event', 'promo') or c.source::text in ('event', 'promo'))
       or (select count(*) from gauntlet_pool()) <> (select count(*) from cards c join subjects s on s.id = c.subject_id
            where c.rarity::text not in ('event', 'promo') and c.source::text not in ('event', 'promo')
              and (s.type in ('Character', 'Creature') or s.ability->>'kind' = 'support')) then bad := bad || 'gauntlet pool; '; end if;
    -- 16b. The squad, 12 weeks: 3 attackers then 2 supports (with a support move), 5 different characters, no
    -- Event or Promo card, within the budget of 12, the theme on every attacker and on a support; seeded.
    for k in 0..11 loop
      gq := gauntlet_squad(w + 7 * k);
      if gq is null then bad := bad || 'no gauntlet squad, week ' || k || '; '; continue; end if;
      ids := array(select (e #>> '{}')::bigint from jsonb_array_elements(gq->'squad') e);
      if array_length(ids, 1) <> 5
         or (select count(*) from unnest(ids[1:3]) x join cards c on c.id = x join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature')) <> 3
         or (select count(*) from unnest(ids[4:5]) x join cards c on c.id = x join subjects s on s.id = c.subject_id
             where s.type not in ('Character', 'Creature') and s.ability->>'kind' = 'support') <> 2
         or (select count(distinct lower(regexp_replace(c.name, '^[^'']*''s[[:space:]]+', ''))) from cards c where c.id = any(ids)) <> 5
         or exists (select 1 from cards c where c.id = any(ids) and (c.rarity::text in ('event', 'promo') or c.source::text in ('event', 'promo')))
         or (select sum(balance_num('dungeon', 'cost', c.rarity::text)) from cards c where c.id = any(ids)) > balance_num('gauntlet', 'budget')
         or (gq->>'theme' is not null and (
              (select count(*) from unnest(ids[1:3]) x join cards c on c.id = x join subjects s on s.id = c.subject_id where (gq->>'theme') = any(s.tag_slugs)) <> 3
              or not exists (select 1 from unnest(ids[4:5]) x join cards c on c.id = x join subjects s on s.id = c.subject_id where s.ability->>'affinity' = gq->>'theme')))
      then bad := bad || 'gauntlet squad, week ' || k || ': ' || gq::text || '; '; end if;
      if gauntlet_squad(w + 7 * k) is distinct from gq then bad := bad || 'gauntlet squad not seeded; '; end if;
      if gq->>'squad' <> prev then nsq := nsq + 1; end if; prev := gq->>'squad';
    end loop;
    if nsq < 6 then bad := bad || 'the weekly squads repeat: ' || nsq || ' different of 12; '; end if;
    -- 16c. The week: the squad, 30 floors, no treasure room, kept once made.
    delete from gauntlet_weeks where week = w;
    wk2 := gauntlet_generate(w);
    if wk2.squad <> array(select (e #>> '{}')::bigint from jsonb_array_elements(gauntlet_squad(w)->'squad') e)
       or jsonb_array_length(wk2.floors) <> balance_num('dungeon', 'floors')
       or exists (select 1 from jsonb_array_elements(wk2.floors) fx, jsonb_array_elements(fx) rx where rx->>'type' = 'treasure')
       or (gauntlet_generate(w)).floors <> wk2.floors then bad := bad || 'gauntlet week; '; end if;
    -- 16d. Start (tst_dg_c has an active Dungeon run too): once a day, the week's squad at base level.
    r := gauntlet_start('tst_dg_c');
    if not coalesce((r->>'ok')::boolean, false) then bad := bad || 'gauntlet start: ' || r::text || '; ';
    else
      if (gauntlet_start('tst_dg_c')->>'error') is distinct from 'already_gauntlet' then bad := bad || 'two Gauntlet runs a day; '; end if;
      select * into gr from dungeon_runs where player_id = 'tst_dg_c' and day = v_day and mode = 'gauntlet';
      select * into dr from dungeon_runs where player_id = 'tst_dg_c' and day = v_day and mode = 'daily';
      if gr.squad <> wk2.squad or gr.state->>'mode' <> 'gauntlet' or dr.status <> 'active'
         or (gr.state->'cards'->(gr.squad[1]::text)->>'max')::int <> (card_combat((select rarity::text from cards where id = gr.squad[1]), 0,
              (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = gr.squad[1]), '{}'::jsonb)->>'hp')::int
      then bad := bad || 'gauntlet run: ' || left(gr.state::text, 200) || '; '; end if;
      -- Nobody needs to own the cards.
      delete from player_cards where player_id = 'tst_dg_c' and card_id = any(gr.squad);
      -- Both runs in a fight with a weak monster, every card up: each action finds its own run (p_mode).
      foe0 := '{"key":"slime","model":"green_blob","name":"T","element":"fire","level":1,"kind":"fight","hp":99999,"max":99999,"atk":1,"charge":false,
                "moves":[{"name":"Hit","kind":"strike","w":1}],"tags":[],"weak":[],"resist":[],"passives":[],"enr":0,"enru":0,"wk":0,"wku":0,"ex":0,"exu":0,"st":0,"sh":0}';
      update dungeon_runs set state = state || jsonb_build_object('phase', 'fight', 'round', 0, 'sup_round', -1, 'foes', jsonb_build_array(foe0),
          'cards', (select jsonb_object_agg(e.k, e.v || jsonb_build_object('down', false, 'hp', (e.v->>'max')::int, 'cd', 0)) from jsonb_each(state->'cards') e(k, v)))
        where id in (gr.id, dr.id);
      select * into gr from dungeon_runs where id = gr.id; select * into dr from dungeon_runs where id = dr.id;
      r := dungeon_attack('tst_dg_c', gr.squad[1], 0, 'gauntlet');
      if not coalesce((r->>'ok')::boolean, false) or (select turns from dungeon_runs where id = gr.id) <> gr.turns + 1
         or (select turns from dungeon_runs where id = dr.id) <> dr.turns then bad := bad || 'gauntlet attack: ' || left(r::text, 200) || '; '; end if;
      r := dungeon_attack('tst_dg_c', 34, 0);
      if (select turns from dungeon_runs where id = dr.id) <> dr.turns + 1 or (select turns from dungeon_runs where id = gr.id) <> gr.turns + 1 then
        bad := bad || 'the Dungeon attack found the wrong run: ' || left(r::text, 200) || '; '; end if;
      r := dungeon_support('tst_dg_c', gr.squad[4], gr.squad[1], 0, 'gauntlet');
      if not coalesce((r->>'ok')::boolean, false) and r->>'error' not in ('boss_stun_immune') then bad := bad || 'gauntlet support: ' || left(r::text, 200) || '; '; end if;
      -- 16e. No loot: a kill adds no Shards and no card; the rewards offer no Shards or card; no chest door.
      for k in 1..10 loop
        update dungeon_runs set state = state || jsonb_build_object('foes', jsonb_build_array(foe0 || '{"hp":1,"max":1}')) where id = gr.id and state->>'phase' = 'fight';
        r := dungeon_attack('tst_dg_c', gr.squad[1], 0, 'gauntlet');
        exit when (select state->>'phase' from dungeon_runs where id = gr.id) <> 'fight';
      end loop;
      select * into gr from dungeon_runs where id = gr.id;
      if gr.state->>'phase' <> 'choose' or coalesce((gr.state->'pend'->>'shards')::int, 0) <> 0 or jsonb_array_length(coalesce(gr.state->'pend'->'cards', '[]')) <> 0 then
        bad := bad || 'gauntlet kill loot: ' || left(gr.state::text, 200) || '; '; end if;
      for k in 1..40 loop
        if exists (select 1 from jsonb_array_elements(dungeon_offers(jsonb_build_object('mode', 'gauntlet', 'cards', '{}'::jsonb), 3)) o where o->>'kind' in ('shards', 'card')) then
          bad := bad || 'a Gauntlet reward offers loot; '; exit; end if;
        if exists (select 1 from jsonb_array_elements(dungeon_enter(jsonb_build_object('mode', 'gauntlet', 'cards', '{}'::jsonb),
             '[[{"type":"choice","foes":[]}]]', 1, 1)->'offers') o where o->>'to' in ('treasure', 'gamble')) then bad := bad || 'a Gauntlet door to a chest; '; exit; end if;
      end loop;
      -- The end of a run grants nothing, even with Shards and a card in the state.
      bal := (select shard_balance from players where id = 'tst_dg_c');
      q29 := coalesce((select quantity from player_cards where player_id = 'tst_dg_c' and card_id = 29), 0);
      update dungeon_runs set state = state || '{"bank":{"shards":50,"cards":[29]},"pend":{"shards":20,"cards":[]}}' where id = gr.id;
      perform dungeon_settle(gr.id, 'fell', true);
      if (select shard_balance from players where id = 'tst_dg_c') <> bal or (select shards from dungeon_runs where id = gr.id) <> 0
         or coalesce((select quantity from player_cards where player_id = 'tst_dg_c' and card_id = 29), 0) <> q29 then bad := bad || 'the Gauntlet granted loot; '; end if;
    end if;
    -- 16f. The board: each member's best run of the week; the Dungeon board has no Gauntlet run.
    insert into dungeon_runs (player_id, day, squad, state, mode, floor, room, turns, status) values
      ('tst_dg_b', w, wk2.squad, '{}', 'gauntlet', 9, 2, 50, 'over'),
      ('tst_dg_g', w, wk2.squad, '{}', 'gauntlet', 4, 1, 30, 'over'),
      ('tst_dg_g', w + 1, wk2.squad, '{}', 'gauntlet', 2, 3, 10, 'over');
    r := gauntlet_board(w, 100);
    if r->0->>'player_id' <> 'tst_dg_b' or (select (e->>'floor')::int from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_g') is distinct from 4
       or (select (e->>'runs')::int from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_g') is distinct from 2
       or not exists (select 1 from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_c') then bad := bad || 'gauntlet board: ' || left(r::text, 300) || '; '; end if;
    r := dungeon_board(v_day, 1000);
    if (select count(*) from jsonb_array_elements(r) e where e->>'player_id' = 'tst_dg_c') <> 1
       or exists (select 1 from jsonb_array_elements(r) e where e->>'player_id' in ('tst_dg_g')) then bad := bad || 'the Dungeon board shows Gauntlet runs; '; end if;
    r := gauntlet_view('tst_dg_c');
    if not coalesce((r->>'ok')::boolean, false) or jsonb_array_length(r->'squad') <> 5 or (r->'run'->>'id')::bigint is distinct from gr.id
       or (r->'best'->>'player_id') <> 'tst_dg_c' or jsonb_array_length(r->'rooms') <> 5 then bad := bad || 'gauntlet view: ' || left(r::text, 300) || '; '; end if;
    if (dungeon_view('tst_dg_c')->'run'->>'id')::bigint is distinct from dr.id then bad := bad || 'the Dungeon view shows the Gauntlet run; '; end if;
    -- 16g. The prizes: off by the flag; the week pays the podium (Shards, packs, cards on the place's odds) and 4-10;
    -- a period pays once; the day pays the Dungeon board.
    update settings set value = value || '{"enabled": false}' where key = 'dungeon_prizes';
    if (dungeon_prize_tick()->>'error') is distinct from 'disabled' then bad := bad || 'prize tick while off; '; end if;
    select shard_balance, pack_balance into b0, p0 from players where id = 'tst_dg_b';
    delete from dungeon_payouts where mode = 'gauntlet' and period = w;
    r := dungeon_pay('gauntlet', w);
    tmp := (select e from jsonb_array_elements(r->'winners') e where (e->>'rank')::int = 1);
    if tmp->>'player_id' is distinct from 'tst_dg_b' or (select shard_balance from players where id = 'tst_dg_b') - b0 <> 500
       or (select pack_balance from players where id = 'tst_dg_b') - p0 <> 5 or jsonb_array_length(tmp->'cards') <> 3
       or exists (select 1 from jsonb_array_elements(tmp->'cards') x where x->>'rarity' not in ('illustrated_rare', 'secret_rare'))
       or exists (select 1 from jsonb_array_elements(tmp->'cards') x where not exists (select 1 from player_cards where player_id = 'tst_dg_b' and card_id = (x->>'id')::bigint))
       or not exists (select 1 from notifications where player_id = 'tst_dg_b' and kind = 'dungeon_prize') then bad := bad || 'gauntlet 1st prize: ' || left(r::text, 300) || '; '; end if;
    tmp := (select e from jsonb_array_elements(r->'winners') e where (e->>'rank')::int = 2);
    if tmp->>'player_id' is distinct from 'tst_dg_g' or (tmp->>'shards')::int <> 300 or (tmp->>'packs')::int <> 3 or jsonb_array_length(tmp->'cards') <> 2 then
      bad := bad || 'gauntlet 2nd prize: ' || coalesce(tmp::text, 'none') || '; '; end if;
    tmp := (select e from jsonb_array_elements(r->'winners') e where (e->>'rank')::int = 3);
    if tmp is null or (tmp->>'shards')::int <> 200 or (tmp->>'packs')::int <> 2 or jsonb_array_length(tmp->'cards') <> 1
       or exists (select 1 from jsonb_array_elements(tmp->'cards') x where x->>'rarity' not in ('normal', 'illustrated_rare')) then
      bad := bad || 'gauntlet 3rd prize: ' || coalesce(tmp::text, 'none') || '; '; end if;
    r := dungeon_pay('gauntlet', w);
    if r->>'error' is distinct from 'already_paid' or (select shard_balance from players where id = 'tst_dg_b') - b0 <> 500 then bad := bad || 'a week paid twice; '; end if;
    select shard_balance, pack_balance into b0, p0 from players where id = 'tst_dg_a';
    delete from dungeon_payouts where mode = 'daily' and period = v_day;
    r := dungeon_pay('daily', v_day);
    if (select shard_balance from players where id = 'tst_dg_a') - b0 <> 300 or (select pack_balance from players where id = 'tst_dg_a') - p0 <> 0 then   -- the daily prizes are Shards only (Nathan)
      bad := bad || 'daily 1st prize: ' || left(r::text, 300) || '; '; end if;
    update settings set value = value || jsonb_build_object('enabled', true, 'from', (v_day - 1)::text) where key = 'dungeon_prizes';
    delete from dungeon_payouts where mode = 'daily' and period = v_day - 1;
    r := dungeon_prize_tick();
    if not exists (select 1 from dungeon_payouts where mode = 'daily' and period = v_day - 1) then bad := bad || 'prize tick: ' || left(r::text, 200) || '; '; end if;
    r := dungeon_prize_tick();
    if jsonb_array_length(r->'paid') <> 0 then bad := bad || 'the prize tick paid twice: ' || left(r::text, 200) || '; '; end if;
    -- 16h. The flag OFF: no Gauntlet.
    update settings set value = value || '{"enabled": false}' where key = 'gauntlet';
    if (gauntlet_start('tst_dg_a')->>'error') is distinct from 'disabled' or (gauntlet_view('tst_dg_a')->>'error') is distinct from 'disabled' then
      bad := bad || 'the Gauntlet with its flag off; '; end if;
  end;
${!M || M === 'gguard' ? `
  -- 17. The Gauntlet guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig6full}$m$;
  exception when others then bad := bad || 'gauntlet second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.dungeon_board'::regproc), 'select coalesce', 'select /* changed */ coalesce');
  begin execute $m$${mig6full}$m$; bad := bad || 'the guard let a changed dungeon_board through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'gauntlet guard: ' || sqlerrm || '; '; end if; end;
` : ''}
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
