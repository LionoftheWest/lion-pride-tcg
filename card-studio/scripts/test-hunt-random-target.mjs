/**
 * Acceptance test for hunt_random_target.sql (Nathan 2026-10-08, D-129): in the raid Hunt the boss's SINGLE hit
 * (strike, drain, stun) picks a RANDOM standing card of the squad, supports included, not always the attacking card.
 * Supports can go down in the Hunt (D-126). Slam and Cataclysm keep their own targets (all other cards take the area hit).
 * One DO block, rolled back (the final RAISE), a fake member, fixed random seeds (setseed):
 *   node scripts/test-hunt-random-target.mjs              the migration file, executed inside the block (must PASS)
 *   node scripts/test-hunt-random-target.mjs --old        the hunt_attack text of git 0ce21af (the live text before the
 *                                                         file): the baseline, it must FAIL on R1 and R2 and PASS the rest
 *   node scripts/test-hunt-random-target.mjs --mutations  each mutation of the file must make a case FAIL
 * Run it on the local copy: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-random-target.mjs
 * The squad: 2 attackers and 2 supports (the other committed cards are removed), every card at 10 million HP, a boss
 * with no counter-move pool and ATK 40, so every normal turn is the usual boss turn. 14 bosses x up to 30 attacks.
 *   R1 the single hits (strike, drain, stun) reach BOTH attackers and BOTH supports, each at least 5 times
 *   R2 a single hit on another card does not hurt the attacking card (its HP is the same as before the attack)
 *   R3 Slam / Cataclysm: the attacking card takes the main hit and every other standing card an area hit (4 cards hit)
 *   R4 the Hunt still downs a support: a support with 1 HP in the squad is downed within the attacks
 *   R5 a stun that lands on another card: the stunned card is targets[0] (the client marks it) and has the cooldown
 *   R7 for every single hit the card that was hit (its HP went down) is targets[0] of boss_action, the attacking card follows
 *      (checked when a stun on another card happens in the sample; the number of samples is printed)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GATE } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const old = process.argv.includes('--old');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const strip = (s) => s.replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
const src = strip(readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/hunt_random_target.sql', import.meta.url)), 'utf8'));
const oldText = (() => {
  const s = execFileSync('git', ['show', '0ce21af:db/schema/functions/hunt_attack.sql'], { cwd: repo, encoding: 'utf8' }).replace(/\r/g, '');
  const a = s.indexOf('CREATE OR REPLACE FUNCTION'), b = s.indexOf('$function$;', a);
  return s.slice(a, b + '$function$;'.length);
})();
for (const s of [src, oldText]) if (s.includes('$m$') || s.includes('$t$') || s.includes('$f$')) throw new Error('a file contains $m$, $t$ or $f$');

const MUTATIONS = {
  'the single hit goes to the attacking card again': ['order by random() limit 1;\n    end if;\n    if v_rtgt is not null', 'order by (t.cid = p_card) desc limit 1;\n    end if;\n    if v_rtgt is not null'],
  'the single hit never reaches a support': ["and h.card_id <> p_card and not h.downed) t\n", "and h.card_id <> p_card and not h.downed\n              and exists (select 1 from cards cc join subjects ss on ss.id = cc.subject_id where cc.id = h.card_id and ss.type in ('Character', 'Creature'))) t\n"],
  'the attacking card also takes the hit that landed on another card': ["      v_cdmg := 0;\n    elsif v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then\n      v_ab := combat_absorb(v_shield, v_cdmg);", "    end if;\n    if v_bossact in ('cataclysm', 'strike', 'slam', 'drain', 'stun') then\n      v_ab := combat_absorb(v_shield, v_cdmg);"],
  'a hit on another card is not applied (the card keeps its HP)': ['v_redir := hunt_counter_hit(p_hunt, p_player, v_day, v_rtgt, v_cdmg, false);', 'v_redir := jsonb_build_object(\'card_id\', v_rtgt, \'dmg\', v_cdmg, \'hp\', 0, \'max_hp\', 0, \'downed\', false);'],
  'the hit card comes after the attacking card in targets (the client marks targets[0])': ["v_targets := case when v_redir is null then '[]'::jsonb else jsonb_build_array(v_redir) end", "v_slam := case when v_redir is null then '[]'::jsonb else jsonb_build_array(v_redir) end || coalesce(v_slam, '[]'::jsonb); v_targets := '[]'::jsonb"],
  'the pool ignores the locked squad (only cards with a row, D-132)': ["union select x from unnest(coalesce(v_squad, '{}'::bigint[])) x", "union select x from unnest('{}'::bigint[]) x"],
  'a down squad card can be hit': ['and h.card_id = x and h.downed)', 'and h.card_id = x and false)'],
  'a support of the squad is never in the squad pool': ["and exists (select 1 from player_cards pc where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0)", "and exists (select 1 from player_cards pc join cards cc on cc.id = pc.card_id join subjects ss on ss.id = cc.subject_id where pc.player_id = p_player and pc.card_id = x and pc.quantity > 0 and ss.type in ('Character', 'Creature'))"],
  'a card that enters on a hit gets the attacker HP rule (a support not 60)': ["if v_rkind = 'support' then v_rmax := card_max_hp(0); end if;", 'null;'],
  'a hit that the cap refuses is lost (no fallback row)': ['values (p_hunt, p_player, v_rtgt, v_day, v_rmax, v_rmax, false)', 'select p_hunt, p_player, v_rtgt, v_day, v_rmax, v_rmax, false where false'],
  'Slam also redirects (the attacking card takes no area-turn hit)': ["if v_bossact in ('strike', 'drain', 'stun') then\n      select card_ids into v_squad", "if v_bossact in ('strike', 'drain', 'stun', 'slam') then\n      select card_ids into v_squad"],
};

const P = 'tst_hrt';
const body = (mig) => String.raw`do $t$ declare
  res jsonb := '[]'; P text := '${P}'; d date := (now() at time zone 'America/Denver')::date;
  a1 bigint; a2 bigint; kh bigint; ks bigint; h bigint; r jsonb; k int; rnd int; ids bigint[]; hit bigint; kind text; tg jsonb;
  hp0 int; c1 int := 0; c2 int := 0; ch int := 0; cs int := 0; n_single int := 0; n_attacker_hurt int := 0; n_slam int := 0; n_slam_bad int := 0;
  n_stun_other int := 0; n_stun_bad int := 0; n_down int := 0; exp2 int; exps int; expv int; rec record; n8 int := 0; n8_bad int := 0; d2 int := 0; dk int := 0; ds int := 0; n9 int := 0; n9_lost int := 0; cap_over boolean := false; n10 int := 0; n10_bad int := 0; n10_lost int := 0; kg bigint; dg int := 0; hpb jsonb; n_noeffect int := 0; hpa int; att bigint; n_first_bad int := 0; row_cd int; downed_sup boolean;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- 0. the function under test: the file, or the text before it (--old).
  ${mig ? `execute $m$${mig}$m$;` : `execute $m$${oldText}$m$;`}
  select min(c.id) into a1 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold';
  select min(c.id) into a2 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'gold' and c.id > a1;
  select min(c.id) into kh from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'heal' and s.ability->>'target' = 'ally';
  select min(c.id) into kg from cards c join subjects s on s.id = c.subject_id where s.ability->>'kind' = 'support' and c.rarity = 'gold';
  select min(c.id) into ks from cards c join subjects s on s.id = c.subject_id where s.ability->>'effect' = 'shield';
  insert into players (id, username) values (P, 'tst hunt random');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(array[a1, a2, kh, ks, kg]) x;
  ${GATE(P)}
  update balance set value = '20' where key = 'daily_card_cap';
  update settings set value = jsonb_build_object('Test Random Boss', jsonb_build_object('moves', '[]'::jsonb)) where key = 'hunt_boss_moves';

  -- Fresh bosses (no move pool, ATK 40): the 4 squad cards committed at 10 million HP; the gate cards are removed.
  ids := array[a1, a2, kh, ks];
  perform setseed(0.37);
  for k in 1..14 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Random Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    perform hunt_commit_card(h, P, x, d, 10000000) from unnest(array[a1, a2, kh, ks]) x;
    update hunt_card_hp set hp_remaining = 10000000, max_hp = 10000000 where hunt_id = h;
    delete from hunt_card_hp where hunt_id = h and card_id <> all(ids);
    for rnd in 1..30 loop
      att := a1;
      select hp_remaining into hp0 from hunt_card_hp where hunt_id = h and card_id = a1;
      select jsonb_object_agg(card_id::text, hp_remaining) into hpb from hunt_card_hp where hunt_id = h;
      r := hunt_attack(P, h, a1);
      if r->>'error' = 'stunned' then
        att := a2;
        select hp_remaining into hp0 from hunt_card_hp where hunt_id = h and card_id = a2;
        select jsonb_object_agg(card_id::text, hp_remaining) into hpb from hunt_card_hp where hunt_id = h;
        r := hunt_attack(P, h, a2);
      end if;
      exit when not coalesce((r->>'ok')::boolean, false);
      kind := r->'boss_action'->>'kind';
      tg := r->'boss_action'->'targets';
      if kind in ('strike', 'drain', 'stun') then
        n_single := n_single + 1;
        -- the hit card, from the ROWS: the one card whose HP went down (the answer is checked against it)
        select card_id into hit from hunt_card_hp where hunt_id = h and hp_remaining < (hpb->>(card_id::text))::int limit 1;
        if hit is null then n_noeffect := n_noeffect + 1; continue; end if;
        if hit = a1 then c1 := c1 + 1; elsif hit = a2 then c2 := c2 + 1; elsif hit = kh then ch := ch + 1; elsif hit = ks then cs := cs + 1; end if;
        -- the hit card is targets[0] (the client marks a stun and a curse on targets[0]), the attacking card follows
        if (tg->0->>'card_id')::bigint is distinct from hit then n_first_bad := n_first_bad + 1; end if;
        -- the attacking card keeps its HP when the hit went to another card
        if hit <> att and (r->>'card_hp')::int <> hp0 then n_attacker_hurt := n_attacker_hurt + 1; end if;
        if kind = 'stun' and hit <> att then
          n_stun_other := n_stun_other + 1;
          select cd_until_round into row_cd from hunt_card_hp where hunt_id = h and card_id = (tg->0->>'card_id')::bigint;
          if coalesce(row_cd, 0) < (r->>'round')::int + 1 then n_stun_bad := n_stun_bad + 1; end if;
        end if;
      elsif kind in ('slam', 'cataclysm') then
        n_slam := n_slam + 1;
        if (select count(distinct e->>'card_id') from jsonb_array_elements(tg) e) <> 4 or coalesce((select (e->>'dmg')::int from jsonb_array_elements(tg) e where (e->>'card_id')::bigint = att limit 1), 0) = 0 then n_slam_bad := n_slam_bad + 1; end if;
      end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'R1 the single hits reach both attackers and both supports, each at least 5 times', 'ok',
    least(c1, c2, ch, cs) >= 5 and n_single > 40, 'single_hits', n_single, 'attacker1', c1, 'attacker2', c2, 'support_heal', ch, 'support_shield', cs);
  res := res || jsonb_build_object('case', 'R2 a single hit on another card does not hurt the attacking card', 'ok', n_attacker_hurt = 0 and (c2 + ch + cs) > 0, 'attacker_hurt', n_attacker_hurt);
  res := res || jsonb_build_object('case', 'R7 for strike / drain / stun the hit card is targets[0]', 'ok', n_first_bad = 0 and n_single > 40, 'not_first', n_first_bad);
  res := res || jsonb_build_object('case', 'R6 the card that the boss hit has really lost HP in its row', 'ok', n_noeffect = 0 and n_single > 40, 'no_effect', n_noeffect);
  res := res || jsonb_build_object('case', 'R3 a Slam / Cataclysm hits all 4 cards, the attacking card takes the main hit (dmg > 0)', 'ok', n_slam > 0 and n_slam_bad = 0, 'slams', n_slam, 'bad', n_slam_bad);
  res := res || jsonb_build_object('case', 'R5 a stun that lands on another card: targets[0] is that card and it has the cooldown (samples: ' || n_stun_other || ')', 'ok', n_stun_bad = 0, 'stun_on_other', n_stun_other, 'bad', n_stun_bad);

  -- R4 a support with 1 HP: the Hunt still downs it (the boss hits any squad card)
  perform setseed(0.55);
  for k in 1..10 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Random Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    perform hunt_commit_card(h, P, x, d, 10000000) from unnest(array[a1, a2, kh, ks]) x;
    update hunt_card_hp set hp_remaining = 10000000, max_hp = 10000000 where hunt_id = h;
    update hunt_card_hp set hp_remaining = 1, max_hp = 60 where hunt_id = h and card_id = kh;
    delete from hunt_card_hp where hunt_id = h and card_id <> all(ids);
    for rnd in 1..30 loop
      r := hunt_attack(P, h, a1);
      if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;
      exit when not coalesce((r->>'ok')::boolean, false);
      exit when (select downed from hunt_card_hp where hunt_id = h and card_id = kh);
    end loop;
    select downed into downed_sup from hunt_card_hp where hunt_id = h and card_id = kh;
    if downed_sup then n_down := n_down + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', 'R4 the Hunt still downs a support (a 1 HP support is down in 10 of 10 fights)', 'ok', n_down = 10, 'downed_in', n_down);

  -- The squad is LOCKED from here on (hunt_squads row, D-132): the pool is the whole locked squad, from the first attack.
  -- R8 the FIRST attack of a day: 100 fresh hunts, no row of a squad card yet. The single hit reaches cards that have not acted,
  --    each enters with full HP (the HP rule of hunt_support: card_combat for an attacker, card_max_hp(0) for a support) and loses the hit.
  perform setseed(0.81);
  select (card_combat(c.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'hp')::int into exp2
    from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id where pc.player_id = P and pc.card_id = a2;
  exps := card_max_hp(0);
  for k in 1..120 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Random Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, a2, kh, ks, kg]);
    r := hunt_attack(P, h, a1);
    continue when not coalesce((r->>'ok')::boolean, false);
    if r->'boss_action'->>'kind' in ('strike', 'drain', 'stun') then
      n8 := n8 + 1; hit := (r->'boss_action'->'targets'->0->>'card_id')::bigint;
      if hit = a2 then d2 := d2 + 1; elsif hit = kh then dk := dk + 1; elsif hit = ks then ds := ds + 1; elsif hit = kg then dg := dg + 1; end if;
      if hit <> a1 then
        select * into rec from hunt_card_hp where hunt_id = h and card_id = hit;
        expv := case when hit = a2 then exp2 else exps end;
        if rec.card_id is null or rec.max_hp <> expv or rec.hp_remaining >= rec.max_hp then n8_bad := n8_bad + 1; end if;
      end if;
    end if;
  end loop;
  res := res || jsonb_build_object('case', 'R8 the FIRST attack of a day: the single hit reaches squad cards that have not acted, each enters with full HP and loses the hit', 'ok',
    least(d2, dk, ds, dg) >= 3 and n8_bad = 0 and n8 > 20, 'first_attacks_single', n8, 'attacker2', d2, 'support_heal', dk, 'support_shield', ds, 'gold_support', dg, 'bad_rows', n8_bad, 'expected_max_hp', jsonb_build_array(exp2, exps));

  -- R9 the daily card cap: the cap is 2 and the 2 rows are used (a1, a2); the squad has 4 cards. A hit on a card without a row
  --    is not refused: hunt_commit_card says no, the fallback insert gives the row (the hit is never lost).
  update balance set value = '2' where key = 'daily_card_cap';
  for k in 1..10 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Random Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, a2, kh, ks]);
    perform hunt_commit_card(h, P, a1, d, 10000000); perform hunt_commit_card(h, P, a2, d, 10000000);
    update hunt_card_hp set hp_remaining = 10000000, max_hp = 10000000 where hunt_id = h;
    for rnd in 1..25 loop
      r := hunt_attack(P, h, a1);
      if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;
      exit when not coalesce((r->>'ok')::boolean, false);
      if r->'boss_action'->>'kind' in ('strike', 'drain', 'stun') then
        hit := (r->'boss_action'->'targets'->0->>'card_id')::bigint;
        if hit in (kh, ks) then
          n9 := n9 + 1;
          select * into rec from hunt_card_hp where hunt_id = h and card_id = hit;
          if rec.card_id is null or rec.hp_remaining >= rec.max_hp then n9_lost := n9_lost + 1; end if;
        end if;
      end if;
    end loop;
    if (select count(*) from hunt_card_hp where hunt_id = h) > 2 then cap_over := true; end if;
  end loop;
  update balance set value = '20' where key = 'daily_card_cap';
  res := res || jsonb_build_object('case', 'R9 the daily card cap (2) is used up: a hit on a squad card without a row is not refused or lost (rows go above the cap)', 'ok',
    n9 >= 5 and n9_lost = 0 and cap_over, 'hits_on_cards_without_row', n9, 'lost', n9_lost, 'rows_above_cap', cap_over);

  -- R10 a squad card that is DOWN is never hit: kh is down (hp 0) in the squad
  perform setseed(0.66);
  for k in 1..6 loop
    insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
      values ('Test Random Boss', 'Normal', '[]', '[]', '{"list": []}', 900000000, 900000000, now() + interval '1 day', 3000, '{"atk": 40}') returning id into h;
    perform hunt_state_round(h, P, d);
    insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, array[a1, a2, kh, ks]);
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp, downed) values (h, P, kh, d, 0, 60, true);
    perform hunt_commit_card(h, P, a1, d, 10000000);
    update hunt_card_hp set hp_remaining = 10000000, max_hp = 10000000 where hunt_id = h and card_id = a1;
    for rnd in 1..25 loop
      r := hunt_attack(P, h, a1);
      if r->>'error' = 'stunned' then r := hunt_attack(P, h, a2); end if;
      exit when not coalesce((r->>'ok')::boolean, false);
      if r->'boss_action'->>'kind' in ('strike', 'drain', 'stun') then
        n10 := n10 + 1;
        if (r->'boss_action'->'targets'->0->>'card_id')::bigint = kh then n10_bad := n10_bad + 1; end if;
        if (r->'boss_action'->'targets'->0->>'dmg')::int = 0 then n10_lost := n10_lost + 1; end if;   -- a hit that landed nowhere
      end if;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'R10 a down squad card is never hit by a single hit, and no hit is lost', 'ok', n10_bad = 0 and n10_lost = 0 and n10 > 20, 'single_hits', n10, 'on_the_down_card', n10_bad, 'hits_lost', n10_lost);

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  return { results: JSON.parse(m[1]) };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(src.replace(a, () => b));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0].slice(0, 90)}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(old ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}  ${r.ok ? JSON.stringify(r).slice(0, 300) : ''}`); }
  console.log(`${old ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
