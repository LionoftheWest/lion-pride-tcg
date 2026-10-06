/**
 * Test hunt_boss_moves.sql (the boss counter moves, the counter passives, D-70) with NO lasting change:
 *   node scripts/test-boss-moves.mjs [file.sql]     (default: ../tcg-bot/supabase/hunt_boss_moves.sql; "current" = the live functions)
 *   MUTATE=<name> node scripts/test-boss-moves.mjs  must FAIL, for every name:
 *     nopick    the boss never uses a counter move      shatter   Shatter leaves the shields
 *     plague    Plague does not weaken heals             d70       a support target gets the attacker HP
 *     guard     the live-version guard accepts any version
 * Each move runs through the real hunt_attack: a test boss whose pool holds only that move, with _share 1.
 * One DO block: apply the file, run every case, then RAISE (everything rolls back).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { GATE, mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

const arg = process.argv[2];
let mig = arg === 'current' ? '' : readFileSync(arg || new URL('../../tcg-bot/supabase/hunt_boss_moves.sql', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const M = process.env.MUTATE;
const SUP = 'public.hunt_support(text,bigint,bigint,bigint)';
const MUT = M === 'guard' ? '' : mutation({
  nopick: ['public.hunt_counter_pick(bigint,text,date,text,text)', "if random() >= coalesce((v_cfg->>'_share')::numeric, 0.4) then return null; end if;", 'return null;'],
  shatter: ['public.hunt_counter_act(bigint,text,date,bigint,integer,numeric,numeric,text,text,integer,integer,integer,numeric)',
    "update hunt_card_hp set shield = 0, updated_at = now() where hunt_id = p_hunt and player_id = p_player and hit_date = p_day and card_id = r.card_id;", 'null;'],
  plague: [SUP, "if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * 0.1;", "if v_eff = 'heal' and 'plague' = any(v_plist) then v_f := v_f * 1;"],
  d70: [SUP, "if v_tkind = 'support' then v_tmaxhp := card_max_hp(0); end if;", 'null;'],
});
if (M === 'guard') {
  const a = "not in ('f84e5768628b1c4afddb89ecfe96a5ec',";
  if (!mig.includes(a)) throw new Error('bad guard mutation');
  mig = mig.replace(a, "is null and 'x' not in ('f84e5768628b1c4afddb89ecfe96a5ec',");
}
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');
const P = 'tst_bmoves';

// One case = one fresh boss whose pool is [key] (or no pool), the squad committed, a setup, the attack, the check.
// In a check: r = the attack result, rnd = its round, c(card) = that card's hunt_card_hp row (a record), st = the combat state.
const CASES = [
  ['bloodrot', '', `update hunt_card_hp set hp_remaining = 10 where hunt_id = h and card_id = a1;
     r2 := hunt_support(P, h, kh, a1); ok := r2->'countered' ? 'bloodrot';`],
  ['siphon', `update hunt_card_hp set hp_remaining = 100 where hunt_id = h and card_id = a2; r2 := hunt_support(P, h, kh, a2);`,
   `ok := (r->>'boss_heal')::int >= (select (result->>'gained')::int from combat_actions where ref_id = h and effect = 'heal') and (r->>'boss_heal')::int > 60;`],   // + a drain of the usual turn (45 max)
  ['feast', `update hunt_card_hp set hp_remaining = 50 where hunt_id = h and card_id = a2;`, `ok := (pg_temp.c(a2)).hp_remaining < 50 - 30;`],   // Feast (34 min) on A2, not the usual slam alone (16 max)
  ['anemia', '', `ok := 60 - (pg_temp.c(kh)).hp_remaining > 60 - (pg_temp.c(ks)).hp_remaining and (pg_temp.c(ks)).hp_remaining < 60;`],
  ['decay', `update hunt_card_hp set hp_remaining = 100 where hunt_id = h and card_id = a1; r2 := hunt_support(P, h, kh, a1);`,
   `ok := (r->>'card_hp')::int <= 100;`],   // without Decay: 100 + the heal (90+) - one usual hit (46 max) > 140
  ['infect', '', `ok := st.marks->'dot' ? a1::text;`],
  ['groan', '', `ok := (pg_temp.c(kh)).cd_until_round >= rnd + 4 and coalesce((pg_temp.c(ks)).cd_until_round, 0) < rnd;`],
  ['undying', `update hunts set hp_remaining = 8000000 where id = h;`,
   `update hunt_card_hp set hp_remaining = 100 where hunt_id = h and card_id = a2; v := (select hp_remaining from hunts where id = h);
    r2 := hunt_support(P, h, kh, a2);
    ok := r2->'countered' ? 'undying' and (select hp_remaining from hunts where id = h) = v + (select (result->>'gained')::int from combat_actions where ref_id = h and effect = 'heal');`],
  ['shatter', `update hunt_card_hp set shield = 50 where hunt_id = h and card_id = a2; update hunt_card_hp set shield = 30 where hunt_id = h and card_id = a1;`,
   `ok := (pg_temp.c(a2)).shield = 0 and (r->>'shield')::int = 0 and st.marks->'shattered'->>a2::text = '50' and st.marks->'shattered'->>a1::text = '30' and hunt_mark_on(st.marks, 'half_shield', 40);`],
  ['crush', `update hunt_combat_state set marks = jsonb_build_object('shattered', jsonb_build_object(a2::text, 100)) where hunt_id = h;`,
   `ok := (pg_temp.c(a2)).hp_remaining between 250 - 16 and 250 and st.marks->'shattered' = '{}'::jsonb;`],   // 100 / 2, plus a usual slam at most
  ['bully', `update hunt_card_hp set shield = 80 where hunt_id = h and card_id = a2;`, `ok := (pg_temp.c(a2)).hp_remaining <= 300 - 34;`],   // Bully ignores the 80 shield (a usual slam alone would hit the shield)
  ['fakerank', `update hunt_card_hp set shield = 1000 where hunt_id = h and card_id = a1;`, `ok := (r->>'shield')::int <= 1000 - 68 and (r->>'card_hp')::int = 300;`],
  ['bonepierce', `update hunt_card_hp set shield = 1000 where hunt_id = h and card_id = a1;`, `ok := (r->>'shield')::int = 1000 and (r->>'card_hp')::int < 300;`],
  ['rattle', `update hunt_card_hp set shield = 100 where hunt_id = h and card_id in (a1, a2);`, `ok := (pg_temp.c(a2)).shield between 30 and 50 and (r->>'shield')::int <= 50;   -- 100 / 2, less a usual slam (16 max)`],
  ['calcify', '', `r2 := hunt_support(P, h, ks, a2); ok := hunt_mark_on(st.marks, 'block_shield', 40) and r2->'countered' ? 'block_shield' and (pg_temp.c(a2)).shield < 30;`],
  ['stuck', '', `ok := (pg_temp.c(ks)).cd_until_round >= rnd + 4 and coalesce((pg_temp.c(kh)).cd_until_round, 0) < rnd;`],
  ['nerf', `update hunt_card_hp set dmg_buff = 1.5 where hunt_id = h and card_id = a2;`, `ok := (pg_temp.c(a2)).dmg_buff = 1;`],
  ['patchnotes', '', `r2 := hunt_support(P, h, ke, a2); ok := r2->'countered' ? 'block_empower' and (pg_temp.c(a2)).dmg_buff < 1.2;`],
  ['tierlist', `update hunt_card_hp set dmg_buff = 1.5 where hunt_id = h and card_id = a2;`, `ok := (pg_temp.c(a2)).hp_remaining <= 300 - 68;`],
  // Tier List on the attack that used empower: a double hit on the attacker (it replaces the usual turn)
  ['tierlist', `update hunt_card_hp set dmg_buff = 1.5 where hunt_id = h and card_id = a1;`, `ok := (r->>'card_hp')::int <= 300 - 68 and (pg_temp.c(a2)).hp_remaining = 300;`],
  ['counterpick', '', `ok := hunt_mark_on(st.marks, 'counterpick', 40);   -- the rest of the day (the round cap is 40)`],
  ['tilt', `update hunt_combat_state set boss_weaken = 0.3, weaken_until = 10 where hunt_id = h;`, `ok := st.weaken_until = 0 and st.enrage_until >= rnd + 2 and st.boss_enrage = 1.4;`],
  ['altf4', '', `r2 := hunt_support(P, h, kw, null); ok := r2->'countered' ? 'block_weaken' and (select boss_weaken from hunt_combat_state where hunt_id = h) = 0;`],
  ['spiral', '', `r2 := hunt_support(P, h, kw, null); ok := (select (marks->'spiral'->>'bonus')::numeric from hunt_combat_state where hunt_id = h) = 0.2;`],
  ['flame', '', `ok := 60 - (pg_temp.c(kw)).hp_remaining > 60 - (pg_temp.c(ks)).hp_remaining and (pg_temp.c(ks)).hp_remaining < 60;`],
  ['fade', `update hunt_combat_state set boss_expose = 0.3, expose_until = 10 where hunt_id = h;`, `ok := st.expose_until = 0 and st.boss_expose = 0;`],
  ['veil', '', `r2 := hunt_support(P, h, kx, null); ok := r2->'countered' ? 'block_expose' and (select boss_expose from hunt_combat_state where hunt_id = h) = 0;`],
  ['demotion', '', `ok := hunt_mark_on(st.marks, 'demotion', 40);`],
  ['nightshade', '', `ok := st.marks->'dot' ? kx::text and not (st.marks->'dot' ? a1::text);`],
  ['desync', '', `r2 := hunt_support(P, h, kt, null); ok := r2->'countered' ? 'desync' and coalesce((select stunned_until from hunt_combat_state where hunt_id = h), 0) < rnd;`],
  ['rubberband', '', `r2 := hunt_support(P, h, kt, null);           -- the stun works
     r3 := hunt_attack(P, h, a2);                                   -- the boss is stunned: Rubberband arms
     r4 := hunt_attack(P, h, a2);                                   -- the turn after: two hits
     ok := r3->'boss_action'->>'kind' = 'stunned' and r4->'boss_action'->>'counter' = 'rubberband_hit';`],
  ['lagspike', '', `ok := (pg_temp.c(kt)).cd_until_round >= rnd + 4;`],
  ['packetloss', '',
   `update hunt_card_hp set hp_remaining = 10, downed = false where hunt_id = h and card_id = a2; r2 := hunt_support(P, h, kh, a2); ok := (r2->>'nullified')::boolean and (pg_temp.c(a2)).hp_remaining = 10 and (pg_temp.c(kh)).cd_until_round > rnd;`],
  ['rollback', `r2 := hunt_support(P, h, km, null);`, `ok := (r->>'boss_heal')::int >= (select (result->>'value')::int from combat_actions where ref_id = h and effect = 'smite') and (r->>'boss_heal')::int > 100;`],   // + a drain of the usual turn
  ['hitbox', '', `r2 := hunt_support(P, h, km, null); ok := r2->'countered' ? 'block_smite';`],
  ['mirror', '', `v := (select hp_remaining from hunts where id = h); r2 := hunt_support(P, h, km, null);
     ok := r2->'countered' ? 'mirror' and (select hp_remaining from hunts where id = h) = v and (pg_temp.c(km)).hp_remaining < 60;`],
  ['pingspike', '', `ok := (pg_temp.c(km)).cd_until_round >= rnd + 4;`],
  ['hotfix', '', `r2 := hunt_support(P, h, kc, null); ok := r2->'countered' ? 'hotfix' and (pg_temp.c(a1)).dmg_debuff = 0.7;`],
  ['rollout', '', `ok := (pg_temp.c(a2)).dmg_debuff = 0.7 and (pg_temp.c(a1)).dmg_debuff = 0.7 and (pg_temp.c(kh)).dmg_debuff = 0.7;`],
  ['rot', `update hunt_card_hp set shield = 50, dmg_buff = 1.5 where hunt_id = h and card_id = a2;`,
   `r2 := hunt_support(P, h, kc, null); ok := r2->'countered' ? 'rot' and (pg_temp.c(a2)).shield = 0 and (pg_temp.c(a2)).dmg_buff = 1;`],
  ['patch', '', `ok := (pg_temp.c(kc)).cd_until_round >= rnd + 4;`],
  ['ban', '', `ok := (select count(*) from hunt_card_hp x where x.hunt_id = h and x.card_id = any(sups) and x.cd_until_round >= rnd + 6) = 2;`],
  ['wave', '', `ok := (select count(*) from hunt_card_hp x where x.hunt_id = h and x.card_id = any(sups) and x.cd_until_round >= rnd + 5) = 8;`],
  ['appeal', `update hunt_card_hp set hp_remaining = 10 where hunt_id = h and card_id = a2; r2 := hunt_support(P, h, kh, a2);`, `ok := (pg_temp.c(kh)).downed;`],
  ['shadowban', '', `r2 := hunt_support(P, h, kw, null); ok := (r2->>'nullified')::boolean and coalesce((select boss_weaken from hunt_combat_state where hunt_id = h), 0) = 0;`],
  ['swarm', '', `ok := 60 - (pg_temp.c(kh)).hp_remaining > 300 - (pg_temp.c(a2)).hp_remaining and (pg_temp.c(a2)).hp_remaining < 300;`],
  ['brood', '', `ok := (select count(*) from hunt_card_hp x where x.hunt_id = h and x.card_id = any(sups) and x.hp_remaining <= 33) = 8;`],   // 0.8 x 40 x 0.85 = 27 at least
  ['rush', `update hunt_card_hp set hp_remaining = 59 where hunt_id = h and card_id = kh;`, `ok := (pg_temp.c(kh)).hp_remaining <= 5;`],   // 2 x 27 from 59
  ['overrun', `update hunt_card_hp set hp_remaining = 10 where hunt_id = h and card_id = kh;`, `ok := (pg_temp.c(kh)).downed and st.enrage_until >= rnd + 2;`],
];
const caseSQL = CASES.map(([key, setup, check]) => `
  -- ${key}
  h := pg_temp.mk('${key}', '[]'); r2 := null; r3 := null; r4 := null;
  ${setup}
  r := hunt_attack(P, h, a1); rnd := (r->>'round')::int;
  select * into st from hunt_combat_state where hunt_id = h;
  if r->'boss_action'->>'counter' is distinct from '${key}' then bad := bad || '${key}: no counter move: ' || left(coalesce(r::text, 'null'), 300) || '; ';
  else ok := false; begin ${check}
    exception when others then bad := bad || '${key}: ' || sqlerrm || '; '; ok := true; end;
    if not coalesce(ok, false) then bad := bad || '${key}: check failed: ' || left(r::text, 200) || ' r2=' || left(coalesce(r2::text, ''), 200) || '; '; end if;
  end if;`).join('\n');

const body = String.raw`do $t$ declare
  bad text := ''; h bigint; r jsonb; r2 jsonb; r3 jsonb; r4 jsonb; rnd int; k int; st record; ok boolean; v bigint; n int; i int; rec record;
  P text := '${P}'; d date := (now() at time zone 'America/Denver')::date;
  a1 bigint; a2 bigint; kh bigint; ks bigint; ke bigint; kw bigint; kx bigint; kt bigint; km bigint; kc bigint; kg bigint; sups bigint[];
begin
  execute $m$${mig}$m$;
  ${MUT}
  select min(c.id) into a1 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold';
  select min(c.id) into a2 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold' and c.id > a1;
  select min(c.id) into kh from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'heal' and s.ability->>'target' = 'ally';
  select min(c.id) into ks from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'shield';
  select min(c.id) into ke from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'empower';
  select min(c.id) into kw from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'weaken';
  select min(c.id) into kx from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'expose';
  select min(c.id) into kt from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'stun';
  select min(c.id) into km from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'smite';
  select min(c.id) into kc from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'cleanse';
  sups := array[kh, ks, ke, kw, kx, kt, km, kc];
  -- A Gold support card: card_combat gives it 252 HP, the support HP is 60 (D-70).
  select min(c.id) into kg from cards c join subjects s on s.id = c.subject_id where s.ability->>'kind' = 'support' and c.rarity = 'gold';
  insert into players (id, username) values (P, 'tst boss moves');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(array[a1, a2] || sups) x;
  ${GATE(P)}
  insert into settings (key, value) values ('hunt_daily_card_cap', '20') on conflict (key) do update set value = excluded.value;

  -- A fresh boss: its pool = [p_key] at _share 1 ('' = no pool), passives p_pass, the squad committed (attackers 300 HP).
  create function pg_temp.mk(p_key text, p_pass jsonb) returns bigint language plpgsql as $f$
  declare h bigint; x bigint; P text := '${P}'; d date := (now() at time zone 'America/Denver')::date;
  begin
    update settings set value = jsonb_build_object('_share', 1, 'Test Moves Boss', jsonb_build_object('moves',
      case when p_key = '' then '[]'::jsonb else jsonb_build_array(jsonb_build_object('key', p_key, 'name', p_key, 'w', 1)) end)) where key = 'hunt_boss_moves';
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Moves Boss', 'Normal', '[]', '[]', jsonb_build_object('list', (select coalesce(jsonb_agg(jsonb_build_object('kind', k)), '[]'::jsonb) from jsonb_array_elements_text(p_pass) k)),
              9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    for x in select c.id from cards c join subjects s on s.id = c.subject_id join player_cards pc on pc.card_id = c.id and pc.player_id = P loop
      perform hunt_commit_card(h, P, x, d, case when (select s.ability->>'kind' from cards c join subjects s on s.id = c.subject_id where c.id = x) = 'support' then 60 else 300 end);
    end loop;
    update hunt_card_hp set hp_remaining = max_hp where hunt_id = h;
    update hunt_card_hp set max_hp = 300, hp_remaining = 300 where hunt_id = h and card_id in (select c.id from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature'));
    return h;
  end $f$;
  create function pg_temp.c(p_card bigint) returns hunt_card_hp language sql as $f$
    select * from hunt_card_hp where player_id = '${P}' and card_id = p_card order by hunt_id desc limit 1 $f$;

  -- 1. Every counter move, through hunt_attack.
${caseSQL}

  -- 2. The share: a pool of 4 moves at _share 0.4 replaces about 40% of the normal turns (12 bosses x 35 attacks, about 300 normal turns).
  n := 0; i := 0;
  for k in 1..12 loop
    h := pg_temp.mk('', '[]');
    update settings set value = jsonb_build_object('_share', 0.4, 'Test Moves Boss', jsonb_build_object('moves', '[{"key":"nerf","name":"Nerf"},{"key":"wave","name":"Wave"},{"key":"fade","name":"Fade"},{"key":"desync","name":"Desync"}]'::jsonb)) where key = 'hunt_boss_moves';
    update hunt_card_hp set hp_remaining = 1000000, max_hp = 1000000 where hunt_id = h and card_id in (a1, a2);
    for rnd in 1..35 loop
      r := hunt_attack(P, h, a1);
      if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;   -- a stunned card waits: the other attacks
      if r->'boss_action'->>'kind' not in ('stunned', 'charging', 'cataclysm') then i := i + 1; if r->'boss_action' ? 'counter' then n := n + 1; end if; end if;
    end loop;
  end loop;
  if n::numeric / greatest(i, 1) not between 0.31 and 0.49 then bad := bad || 'share: ' || n || ' counters in ' || i || ' normal turns; '; end if;

  -- 3. A boss with no pool never uses a counter move, and its result has no move keys.
  h := pg_temp.mk('', '[]'); update hunt_card_hp set hp_remaining = 1000000, max_hp = 1000000 where hunt_id = h and card_id = a1;
  for rnd in 1..30 loop
    r := hunt_attack(P, h, a1);
    if r->'boss_action' ? 'counter' or r->'boss_action' ? 'move' then bad := bad || 'no pool: a counter move; '; exit; end if;
  end loop;

  -- 3b. A squad with none of the countered support meets the usual boss (the pool says "counters": "shield").
  h := pg_temp.mk('shatter', '[]');
  update settings set value = jsonb_set(value, '{Test Moves Boss,counters}', '"shield"') where key = 'hunt_boss_moves';
  delete from hunt_card_hp where hunt_id = h and card_id = ks;
  update hunt_card_hp set hp_remaining = 1000000, max_hp = 1000000 where hunt_id = h and card_id in (a1, a2);
  for rnd in 1..20 loop
    r := hunt_attack(P, h, a1);
    if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;
    if r->'boss_action' ? 'counter' then bad := bad || 'no shield card, yet a counter move; '; exit; end if;
  end loop;
  -- ... and with the shield card in the squad, the counter moves come back.
  perform hunt_commit_card(h, P, ks, d, 60); n := 0;
  for rnd in 1..10 loop
    r := hunt_attack(P, h, a1);
    if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;
    if r->'boss_action' ? 'counter' then n := n + 1; end if;
  end loop;
  if n = 0 then bad := bad || 'a shield card, yet no counter move in 10 turns; '; end if;

  -- 3c. Shadow Ban stops the next 3 support plays, not 4.
  h := pg_temp.mk('shadowban', '[]'); r := hunt_attack(P, h, a1);
  r2 := hunt_support(P, h, kw, null); r3 := hunt_support(P, h, kx, null); r4 := hunt_support(P, h, kt, null); r := hunt_support(P, h, km, null);
  if not coalesce((r2->>'nullified')::boolean, false) or not coalesce((r4->>'nullified')::boolean, false) or coalesce((r->>'nullified')::boolean, false) then
    bad := bad || 'shadowban 2 plays: ' || coalesce(r2::text, '') || ' / ' || coalesce(r3::text, '') || ' / ' || coalesce(r4::text, '') || '; '; end if;

  -- 4. The counter passives (no pool): the countered supports work at 10%.
  h := pg_temp.mk('', '["plague"]');
  update hunt_card_hp set hp_remaining = 10, dmg_debuff = 0.7 where hunt_id = h and card_id = a1;
  r := hunt_support(P, h, kh, a1); r2 := hunt_support(P, h, kc, null);
  if not (r->'countered' ? 'plague') or (pg_temp.c(a1)).hp_remaining > 28 or not (r2->'countered' ? 'plague') or (pg_temp.c(a1)).dmg_debuff not between 0.72 and 0.74 then
    bad := bad || 'plague: ' || r::text || ' / ' || r2::text || ' hp ' || (pg_temp.c(a1)).hp_remaining || ' debuff ' || (pg_temp.c(a1)).dmg_debuff || '; '; end if;
  h := pg_temp.mk('', '["shatterer"]');
  r := hunt_support(P, h, ks, a1); v := (select hp_remaining from hunts where id = h); r2 := hunt_support(P, h, km, null);
  if not (r->'countered' ? 'shatterer') or (pg_temp.c(a1)).shield > 22 or not (r2->'countered' ? 'shatterer') then bad := bad || 'shatterer: ' || r::text || '; '; end if;
  h := pg_temp.mk('', '["dispeller"]');
  r := hunt_support(P, h, ke, a1); r2 := hunt_support(P, h, kx, null);
  if not (r->'countered' ? 'dispeller') or (pg_temp.c(a1)).dmg_buff > 1.2 or not (r2->'countered' ? 'dispeller') then bad := bad || 'dispeller: ' || r::text || '; '; end if;
  h := pg_temp.mk('', '["juggernaut"]');
  r := hunt_support(P, h, kw, null);
  if not (r->'countered' ? 'juggernaut') or (select boss_weaken from hunt_combat_state where hunt_id = h) > 0.1 then bad := bad || 'juggernaut weaken: ' || r::text || '; '; end if;
  n := 0;
  for i in 1..20 loop
    h := pg_temp.mk('', '["juggernaut"]'); r := hunt_support(P, h, kt, null);
    if r->'countered' ? 'juggernaut' then n := n + 1; end if;
  end loop;
  if n < 14 then bad := bad || 'juggernaut stun: only ' || n || ' of 20 failed; '; end if;
  -- With no counter passive and no marks, the support result has no "countered" key.
  h := pg_temp.mk('', '[]'); r := hunt_support(P, h, kw, null);
  if r ? 'countered' then bad := bad || 'plain support has countered: ' || r::text || '; '; end if;

  -- 5. D-70: a heal on a Gold support card that is not in the fight yet gives it the support HP (60), not 252.
  h := pg_temp.mk('', '[]');
  insert into player_cards (player_id, card_id, quantity) values (P, kg, 1);
  r := hunt_support(P, h, kh, kg);
  if not coalesce((r->>'ok')::boolean, false) or (pg_temp.c(kg)).max_hp <> card_max_hp(0) or card_max_hp(0) = (card_combat('gold', 0, (select s.cp_mod from cards c join subjects s on s.id = c.subject_id where c.id = kg), '{}'::jsonb)->>'hp')::int then
    bad := bad || 'd70: ' || r::text || ' max ' || coalesce((pg_temp.c(kg)).max_hp, -1) || '; '; end if;

  -- 6. Spawns: at most one counter passive, the labels, and the counter passives appear.
  n := 0;
  for i in 1..150 loop
    h := spawn_hunt(3); select * into rec from hunts where id = h;
    v := (select count(*) from jsonb_array_elements(rec.passive->'list') x where x->>'kind' in ('plague', 'shatterer', 'dispeller', 'juggernaut'));
    if v > 1 then bad := bad || 'spawn: ' || v || ' counter passives; '; exit; end if;
    if v = 1 then n := n + 1; end if;
    if exists (select 1 from jsonb_array_elements(rec.passive->'list') x where x->>'label' is null) then bad := bad || 'spawn: a passive with no label; '; exit; end if;
  end loop;
  if n = 0 then bad := bad || 'spawn: no counter passive in 150 spawns; '; end if;

  -- 7. Every move in the setting has a rule (an unknown key would raise in the fight).
  if exists (select 1 from settings s, jsonb_each(s.value) b, jsonb_array_elements(b.value->'moves') m
             where s.key = 'hunt_boss_moves' and b.key <> '_share'
               and m->>'key' not in (${CASES.map((c) => `'${c[0]}'`).join(', ')})) then bad := bad || 'a move key with no test; '; end if;

${!M || M === 'guard' ? `
  -- 8. The guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.hunt_attack'::regproc), 'declare', 'declare -- changed by someone else');
  begin execute $m$${mig}$m$; bad := bad || 'the guard let a changed hunt_attack through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;
` : ''}

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 3000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
