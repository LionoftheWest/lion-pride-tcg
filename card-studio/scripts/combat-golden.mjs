/**
 * The combat lockdown test (Nathan, 2026-10-03: "the same combat systems for Hunt, Dungeon Run, and
 * Arena ... really lock down across the whole underlying system").
 *
 * It plays many scripted Hunt fights on the LOCAL copy with fixed random seeds (setseed) and records
 * every result of hunt_attack / hunt_support and the full state after each fight (the boss, every card's
 * HP / shield / buffs / cooldown, the combat state, the hits, the combat log). Each fight is undone right
 * after it runs. Then it installs a candidate migration and replays the same fights with the same seeds.
 * The test FAILS on the first difference. Nothing is kept: the final RAISE rolls everything back.
 *
 * The LOCAL copy only (F-3, docs/foundations.md "Performance and cost budget" rule 2: heavy work never runs on live):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/combat-golden.mjs     the code vs itself (repeatable)
 *   CANDIDATE=../tcg-bot/supabase/x.sql LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/combat-golden.mjs
 *                                                                                        the code vs the candidate
 *   MUTATE=1 CANDIDATE=... (the same)                                                    a 1-point change must FAIL
 *   BASE=<file.sql> CANDIDATE=<file.sql> ...   the BASE text is installed first (inside the rolled-back block) and plays the "live" fights, so a
 *                                        migration that is already applied on the local copy is still compared with the text before it
 * The stat points of the stat card (the 2nd attacker) and of every support, to show that a stat moves only what it names:
 *   GOLDEN_PTS='{"precision": 3}' (default {"attack": 3, "precision": 3}), GOLDEN_SUP_PTS='{"haste": 5}' (default {}).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
if (process.env.LOCALDB !== '1') throw new Error('combat-golden.mjs runs on the LOCAL copy only: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/combat-golden.mjs');
// The same rule as lab-lib.mjs: with LOCALDB=1 the preload loads here when the caller did not load it (test-golden-mutations.mjs starts this
// file with plain node: with no preload the SQL went to the LIVE project with the live token, and a live change in the middle of a run
// gave "NOT REPEATABLE ... two answers"). Fail closed: no preload, no run.
if (!globalThis.__LOCALDB_API) await import('./localdb-preload.mjs');
if (!globalThis.__LOCALDB_API) throw new Error('combat-golden.mjs: the localdb preload is not active, so it would use the LIVE project');
const PTS = JSON.stringify(JSON.parse(process.env.GOLDEN_PTS || '{"attack": 3, "precision": 3}'));
const SUP_PTS = JSON.stringify(JSON.parse(process.env.GOLDEN_SUP_PTS || '{}'));
if ((PTS + SUP_PTS).includes("'")) throw new Error('GOLDEN_PTS / GOLDEN_SUP_PTS: no quotes');
import { readFileSync } from 'node:fs';
import { runBlock } from './lab-lib.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);

let cand = process.env.CANDIDATE ? readFileSync(process.env.CANDIDATE, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (process.env.MUTATE && cand) {
  // A one-point change to the hit damage: the test must catch it.
  const a = 'v_dmg := greatest(1, round(v_base));';
  if (!cand.includes(a)) throw new Error('MUTATE: the candidate has no hit rounding line to change');
  cand = cand.replace(a, 'v_dmg := greatest(1, round(v_base)) + 1;');
}
let baseSql = process.env.BASE ? readFileSync(process.env.BASE, 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '') : '';
if (baseSql.includes('$b$')) throw new Error('the BASE file must not contain $b$');
if (cand.includes('$c$')) throw new Error('the candidate must not contain $c$');

// The cards: 5 attackers (execute, focus, lifesteal, pierce, rampage) and 8 supports.
const ATK = [24, 29, 44, 34, 49];
const SUPS = [[64, 79, 82], [91, 92, 93], [96, 97, 64], [93, 103], [254, 82, 100]]; // two weaken cards: the stun immunity (one card hits its own cooldown first); 254 is a stun card (juggernaut can make it fail)
// Heal cards for the fights where the heal target is the MOST HURT living attacker (hurt: true). In the other fights a heal goes to the first attacker, who is at full HP
// early on, so a heal of +1 HP changed nothing (the gap that the mutation hunt-heal-plus-1 of test-golden-mutations.mjs closes, F-3 PR 4.0).
const HEALSUPS = [[82, 100, 253], [82, 79, 64]];
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
  // The four counter passives (hunt_support: plague halves a heal, shatterer a shield and a smite, dispeller an empower and an expose, juggernaut a weaken and fails a stun).
  { tier: 'Heroic', hp: 4000, passive: ['plague'], weak: [], resist: [] },
  { tier: 'Heroic', hp: 4000, passive: ['shatterer'], weak: [], resist: [] },
  { tier: 'Heroic', hp: 4000, passive: ['dispeller'], weak: [], resist: [] },
  { tier: 'Heroic', hp: 4000, passive: ['juggernaut'], weak: [], resist: [] },
  // A heal on a HURT card: a support every round, the heal goes to the most hurt living attacker (with the plague, the heal is halved).
  { tier: 'Heroic', hp: 6000, passive: [], weak: [], resist: [], every: true, hurt: true, sups: HEALSUPS },
  { tier: 'Mythic', hp: 6000, passive: ['plague'], weak: [], resist: [], every: true, hurt: true, sups: HEALSUPS },
  { tier: 'Normal', hp: 6000, passive: ['regenerating', 'frenzied'], weak: [], resist: [], hurt: true, sups: HEALSUPS },
];
const SEEDS = [0.11, 0.53, -0.37];
// What the transcripts must contain (regular expressions of PostgreSQL): a heal that gained HP on a hurt card, and each counter passive at work.
const COVER = ['"gained": [1-9]', ...['plague', 'shatterer', 'dispeller', 'juggernaut'].map((k) => String.raw`"countered": \[[^\]]*"${k}"`), '"effect": "stun"'];
const scen = [];
for (const b of BOSSES) for (const s of (b.sups || SUPS)) for (const seed of SEEDS) scen.push({ b: { ...b, sups: undefined }, s, seed });

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
        select v_p, c, 1, case when c = p_atk[2] then 2 else 0 end, case when c = p_atk[2] then '${PTS}'::jsonb when c = any(p_sup) then '${SUP_PTS}'::jsonb else '{}'::jsonb end from unnest(p_squad) c;
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
          -- ORDER BY the array position: without it the planner may build a hash anti join and return the first free attacker in any order
          -- (the plan follows the table statistics left by the tests that ran before: target 24 in one run and 34 in the next, 2026-10-14).
          if coalesce((p_boss->>'hurt')::boolean, false) then   -- the most hurt living attacker (a heal on a hurt card)
            select u.a into v_tgt from unnest(p_atk) with ordinality u(a, o) left join hunt_card_hp x on x.hunt_id = v_h and x.player_id = v_p and x.card_id = u.a
              where not coalesce(x.downed, false) order by coalesce(x.hp_remaining::numeric / greatest(1, x.max_hp), 1), u.o limit 1;
          else
          select u.a into v_tgt from unnest(p_atk) with ordinality u(a, o) where not exists (select 1 from hunt_card_hp x where x.hunt_id = v_h and x.player_id = v_p and x.card_id = u.a and x.downed) order by u.o limit 1;
          end if;
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
        || 'ACTIONS ' || coalesce((select jsonb_agg(jsonb_build_object('c', card_id, 'k', kind, 'r', round, 'e', effect, 'a', amount, 't', target_card, 'f', target_foe, 'res', result) order by id)::text from combat_actions where mode = 'hunt' and ref_id = v_h), '') || E'
'
        || 'EVENTS ' || coalesce((select string_agg(kind, ',' order by id) from hunt_events where hunt_id = v_h), '');
      raise exception using errcode = 'U0001', message = 'undo';
    exception when sqlstate 'U0001' then null;
    end;
    return v_out;
  end $g$;
  $f$;
  ${baseSql ? 'execute $b$' + baseSql + '$b$;' : ''}
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
  -- The transcripts must show what this test is for (a test that never meets a counter or a hurt heal proves nothing about them).
  if bad = '' then
    select string_agg(k, ', ') into bad from unnest(array[${COVER.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')}]) k where array_to_string(base, E'\n') !~ k;
    if bad is not null then bad := 'COVERAGE GAP, no fight shows: ' || bad; else bad := ''; end if;
  end if;
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

// runBlock (lab-lib.mjs) takes the shared local database lock for this one request when LAB_LOCK_OWNER=<name> is set (a deadlock with another session's
// request gave "NO RESULT" on 2026-10-15).
let out = null;
try { out = await runBlock(body); } catch (e) { console.error(String(e.message).slice(0, 2500)); process.exitCode = 1; }
if (out !== null) {
  console.log(process.env.DUMP ? out : out.slice(0, 4000));
  if (!out.startsWith('PASS')) process.exitCode = 1;
}
