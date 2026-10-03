/**
 * The combat lockdown test (Nathan, 2026-10-03: "the same combat systems for Hunt, Dungeon Run, and
 * Arena ... really lock down across the whole underlying system").
 *
 * It plays many scripted Hunt fights on the LIVE database with fixed random seeds (setseed) and records
 * every result of hunt_attack / hunt_support and the full state after each fight (the boss, every card's
 * HP / shield / buffs / cooldown, the combat state, the hits, the combat log). Each fight is undone right
 * after it runs. Then it installs a candidate migration and replays the same fights with the same seeds.
 * The test FAILS on the first difference. Nothing is kept: the final RAISE rolls everything back.
 *
 *   node scripts/combat-golden.mjs                          live vs live (proves the fights are repeatable)
 *   CANDIDATE=../tcg-bot/supabase/x.sql node scripts/combat-golden.mjs   live vs the candidate
 *   MUTATE=1 CANDIDATE=... node scripts/combat-golden.mjs   a 1-point change in the candidate must FAIL
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let cand = process.env.CANDIDATE ? readFileSync(process.env.CANDIDATE, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (process.env.MUTATE && cand) {
  // A one-point change to the hit damage: the test must catch it.
  const a = 'v_dmg := greatest(1, round(v_base));';
  if (!cand.includes(a)) throw new Error('MUTATE: the candidate has no hit rounding line to change');
  cand = cand.replace(a, 'v_dmg := greatest(1, round(v_base)) + 1;');
}
if (cand.includes('$c$')) throw new Error('the candidate must not contain $c$');

// The cards: 5 attackers (execute, focus, lifesteal, pierce, rampage) and 8 supports.
const ATK = [24, 29, 44, 34, 49];
const SUPS = [[64, 79, 82], [91, 92, 93], [96, 97, 64], [93, 103]]; // two stun cards: the stun immunity (one card hits its own cooldown first)
// The bosses: every passive, the three tiers, weaknesses and resistances, small HP for a defeat.
const BOSSES = [
  { tier: 'Normal', hp: 4000, passive: [], weak: [{ kind: 'type', value: 'Creature' }], resist: [] },
  { tier: 'Heroic', hp: 6000, passive: ['armored', 'shrouded'], weak: [{ kind: 'tag', value: 'trait:fire' }], resist: [{ kind: 'type', value: 'Character' }] },
  { tier: 'Mythic', hp: 900, passive: ['flaming', 'volatile'], weak: [], resist: [{ kind: 'rarity', value: 'normal' }] },
  { tier: 'Normal', hp: 2500, passive: ['regenerating', 'thorns', 'frenzied'], weak: [{ kind: 'rarity', value: 'normal' }], resist: [] },
  // Low HP: the 50% rage, phase 2 (a new passive below 25%) and the defeat (settle_hunt).
  { tier: 'Normal', hp: 260, passive: [], weak: [{ kind: 'type', value: 'Creature' }], resist: [] },
  { tier: 'Heroic', hp: 520, passive: ['regenerating'], weak: [], resist: [] },
  // A support every round: the cooldown refusals and the stun immunity.
  { tier: 'Mythic', hp: 3000, passive: ['volatile'], weak: [], resist: [], every: true },
];
const SEEDS = [0.11, 0.53, -0.37];
const scen = [];
for (const b of BOSSES) for (const s of SUPS) for (const seed of SEEDS) scen.push({ b, s, seed });

const lit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'`;
const runs = scen.map((x, i) => `pg_temp.golden_run(${x.seed}, array[${[...ATK, ...x.s].join(',')}]::bigint[], array[${ATK.join(',')}]::bigint[], array[${x.s.join(',')}]::bigint[], ${lit(x.b)}::jsonb)`);

// One frozen snapshot: a change that another process commits during the run cannot reach the test
// (READ COMMITTED gave two answers when the bot or another session committed in the middle of a run).
// One read plan: a Slam / Cataclysm reads the card rows with no ORDER BY, so a sequential scan returned them
// in physical order, which moved between runs (2026-10-03: the live code gave two answers). The primary-key
// index scan reads them by card id every time. The same setting for the live code and the candidate.
const PLAN = process.env.NO_PLAN ? '' : 'set local enable_seqscan = off; set local enable_bitmapscan = off;';
const body = String.raw`${process.env.NO_RR ? '' : 'set transaction isolation level repeatable read;'}${PLAN}
do $t$
declare base text[] := '{}'; again text[] := '{}'; cand text[] := '{}'; i int; j int; l1 text[]; l2 text[]; bad text := ''; n int := ${runs.length};
begin
  execute $f$
  create function pg_temp.golden_run(p_seed float, p_squad bigint[], p_atk bigint[], p_sup bigint[], p_boss jsonb) returns text
  language plpgsql as $g$
  declare v_out text := ''; v_h bigint; v_p text := 'tst_golden'; r jsonb; v_r int; v_ai int := 0; v_card bigint; v_tgt bigint; v_si int := 0; v_day date := (now() at time zone 'America/Denver')::date;
  begin
    begin
      insert into players (id, username) values (v_p, 'golden');
      insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
        select v_p, c, 1, case when c = p_atk[2] then 2 else 0 end, case when c = p_atk[2] then '{"attack": 3, "precision": 3}'::jsonb else '{}'::jsonb end from unnest(p_squad) c;
      insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive, stats)
        values ('Golden Boss', p_boss->>'tier', p_boss->'weak', p_boss->'resist', (p_boss->>'hp')::bigint, (p_boss->>'hp')::bigint, (p_boss->>'hp')::bigint,
                now() - interval '1 hour', now() + interval '1 day', 'active',
                jsonb_build_object('kind', p_boss->'passive'->>0, 'list', coalesce((select jsonb_agg(jsonb_build_object('kind', k)) from jsonb_array_elements_text(p_boss->'passive') k), '[]'::jsonb)), null)
        returning id into v_h;
      insert into hunt_squads (hunt_id, player_id, hit_date, card_ids, locked_at) values (v_h, v_p, v_day, p_squad, now());
      perform setseed(p_seed);
      for v_r in 1..30 loop
        if v_r % 3 = 1 or coalesce((p_boss->>'every')::boolean, false) then
          v_card := p_sup[(v_si % array_length(p_sup, 1)) + 1]; v_si := v_si + 1;
          select a into v_tgt from unnest(p_atk) a where not exists (select 1 from hunt_card_hp x where x.hunt_id = v_h and x.player_id = v_p and x.card_id = a and x.downed) limit 1;
          r := hunt_support(v_p, v_h, v_card, v_tgt);
          v_out := v_out || 'S' || v_card || ' ' || r::text || E'\n';
        end if;
        v_card := null;
        for i in 1..array_length(p_atk, 1) loop
          v_card := p_atk[((v_ai + i - 1) % array_length(p_atk, 1)) + 1];
          exit when not exists (select 1 from hunt_card_hp x where x.hunt_id = v_h and x.player_id = v_p and x.card_id = v_card and x.downed);
          v_card := null;
        end loop;
        exit when v_card is null;
        v_ai := v_ai + 1;
        r := hunt_attack(v_p, v_h, v_card);
        v_out := v_out || 'A' || v_card || ' ' || r::text || E'\n';
        exit when coalesce((r->>'defeated')::boolean, false);
      end loop;
      v_out := v_out || 'BOSS ' || (select jsonb_build_object('hp', hp_remaining, 'status', status, 'passive', passive)::text from hunts where id = v_h) || E'\n'
        || 'CARDS ' || coalesce((select jsonb_agg(jsonb_build_object('c', card_id, 'hp', hp_remaining, 'max', max_hp, 'down', downed, 'sh', shield, 'b', dmg_buff, 'd', dmg_debuff, 'cd', cd_until_round) order by card_id)::text from hunt_card_hp where hunt_id = v_h), '') || E'\n'
        || 'STATE ' || coalesce((select jsonb_build_object('r', round, 'en', boss_enrage, 'enu', enrage_until, 'wk', boss_weaken, 'wku', weaken_until, 'ex', boss_expose, 'exu', expose_until, 'st', stunned_until)::text from hunt_combat_state where hunt_id = v_h), '') || E'\n'
        || 'HITS ' || coalesce((select jsonb_agg(jsonb_build_object('c', card_id, 'd', damage) order by card_id)::text from hunt_hits where hunt_id = v_h), '') || E'\n'
        || 'LOG ' || coalesce((select jsonb_agg(jsonb_build_object('c', card_id, 'cp', cp, 'o', outcome, 'b', bonus, 'cr', crit, 'bl', block, 'd', damage, 'co', countered, 'cd', counter_dmg, 'hp', card_hp_after, 'dn', card_downed, 'bh', boss_hp_after) order by id)::text from hunt_combat_log where hunt_id = v_h), '') || E'\n'
        || 'EVENTS ' || coalesce((select string_agg(kind, ',' order by id) from hunt_events where hunt_id = v_h), '');
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
    end;
    return v_out;
  end $g$;
  $f$;
  for i in 1..n loop base := base || ${'(case i ' + runs.map((r, k) => `when ${k + 1} then ${r}`).join(' ') + ' end)'}; end loop;
  for i in 1..n loop again := again || ${'(case i ' + runs.map((r, k) => `when ${k + 1} then ${r}`).join(' ') + ' end)'}; end loop;
  for i in 1..n loop
    if base[i] is distinct from again[i] then
      l1 := regexp_split_to_array(base[i], E'\n'); l2 := regexp_split_to_array(again[i], E'\n');
      -- A WHILE loop: a FOR loop makes its own j, and the j outside stayed NULL (that turned the whole
      -- failure message into NULL, which read as a PASS - found by the mutation check, 2026-10-03).
      j := 1;
      while j < greatest(array_length(l1, 1), array_length(l2, 1)) and l1[j] is not distinct from l2[j] loop j := j + 1; end loop;
      bad := 'NOT REPEATABLE at fight ' || i || ' line ' || j || ': the live code gives two answers' || E'\nPREV: ' || left(coalesce(l1[j - 1], ''), 500)
        || E'\nRUN1: ' || left(coalesce(l1[j], ''), 2500) || E'\nRUN2: ' || left(coalesce(l2[j], ''), 2500); exit;
    end if;
  end loop;
  -- DUMP=1: what the fights cover (counted here: a long message is cut by the API).
  if ${process.env.DUMP ? 'true' : 'false'} then
    raise exception 'RESULT:%', (select jsonb_object_agg(k, (select count(*) from regexp_matches(array_to_string(base, E'\n'), k, 'g')))::text
      from unnest(array['^A[0-9]+ \{"ok": true', '^A[0-9]+ \{"ok": false', '^S[0-9]+ \{"ok": true', '^S[0-9]+ \{"ok": false',
        '"outcome": "hit"', '"outcome": "crit"', '"outcome": "miss"', '"outcome": "blocked"', '"defeated": true', '"burned": true',
        '"double": true', '"phase": "rage"', '"card_downed": true', '"phase2": true', '"heal": [1-9]',
        '"kind": "strike"', '"kind": "slam"', '"kind": "drain"', '"kind": "stun"', '"kind": "enrage"', '"kind": "curse"',
        '"kind": "regenerate"', '"kind": "stunned"', '"kind": "charging"', '"kind": "cataclysm"',
        '"effect": "empower"', '"effect": "shield"', '"effect": "heal"', '"effect": "weaken"', '"effect": "expose"',
        '"effect": "stun"', '"effect": "cleanse"', '"effect": "smite"',
        '"error": "stunned"', '"error": "cooldown"', '"error": "boss_stun_immune"', '"error": "downed"', '"error": "target_downed"']) k);
  end if;
  if bad = '' and length($c$${cand}$c$) > 0 then
    execute $c$${cand}$c$;
    for i in 1..n loop cand := cand || ${'(case i ' + runs.map((r, k) => `when ${k + 1} then ${r}`).join(' ') + ' end)'}; end loop;
    for i in 1..n loop
      if base[i] is distinct from cand[i] then
        l1 := regexp_split_to_array(base[i], E'\n'); l2 := regexp_split_to_array(cand[i], E'\n');
        j := 1;
        while j < greatest(array_length(l1, 1), array_length(l2, 1)) and l1[j] is not distinct from l2[j] loop j := j + 1; end loop;
        bad := 'DIFF at fight ' || i || ' line ' || j || E'\nPREV: ' || left(coalesce(l1[j - 1], ''), 500)
          || E'\nLIVE: ' || left(coalesce(l1[j], ''), 2500) || E'\nCAND: ' || left(coalesce(l2[j], ''), 2500); exit;
      end if;
    end loop;
  end if;
  -- A NULL message is a failure, never a pass.
  if bad is null then bad := 'FAIL: the failure message became NULL (a bug in this test)'; end if;
  raise exception 'RESULT:%', case when bad <> '' then bad
    else 'PASS ' || n || ' fights, ' || (select sum(array_length(regexp_split_to_array(x, E'\n'), 1)) from unnest(base) x) || ' lines'
      || case when length($c$${cand}$c$) > 0 then ', the candidate matches the live code exactly' else ', the live code is repeatable' end end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = msg.match(/RESULT:(.*?)(\\n\\nCONTEXT|"\})/s);
if (!m) { console.error('NO RESULT:', msg.slice(0, 2500)); process.exitCode = 1; }
else {
  const out = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  console.log(process.env.DUMP ? out : out.slice(0, 4000));
  if (!out.startsWith('PASS')) process.exitCode = 1;
}
