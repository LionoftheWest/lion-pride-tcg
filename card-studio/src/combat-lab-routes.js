/**
 * The Admin view "Combat v2 Lab" (docs/combat-redesign-plan.md 20.4): see a combat v2 fight of a real member's cards before v2 goes live.
 * Every fight runs the REAL v2 SQL functions (card_combat_v2, combat_v2_hunt_boss, combat_v2_dungeon_foe, combat_v2_next, combat_v2_card_act,
 * combat_v2_enemy_act, combat_v2_turn_order, hunt_boss_v2_card, ability_v2_text) on the LOCAL copy, inside ONE DO block that always ends with a
 * RAISE: nothing is kept (no player row, no ledger row, no hunt row, no balance_log row). The v2 functions are pure (state in, state out); the block
 * is the second guard. Every card choice comes from Auto v2 (combat_v2_auto, PR E8: use the charged active unless a rule holds it, the target, the
 * ally); the log shows the Auto choice of each card action. The Hunt squad "auto" is the Hunt auto-pick (combat_v2_autopick: the offense value, the
 * role answers of the boss, the Weak to bonus and the pair score); the Dungeon squad "auto" stays the best N by v2 CP (E8 has no Dungeon pick).
 * PR E9: the Power number of each card (card_power_v2) and the squad value (combat_v2_squad_value) come from SQL and are shown as they are (no math
 * here). A local copy with no E9 functions shows no Power (to_regprocedure guards each call).
 *   GET  /setup             the local copy, the v2 functions there, the named Hunt bosses, the tiers, the Dungeon monsters and room kinds, the squad sizes
 *   GET  /players?q=        members of the local copy by name or id (20 at most)
 *   GET  /player/:id/cards  the member's cards with the v2 role and the v2 active (subjects.ability_v2, else the simulator placeholder) and its text
 *   POST /fight             {player, cards: [card ids] | 'auto', mode: hunt|dungeon, boss, tier, start_hp, monster, kind, floor, room, foes, level, seed}
 *                           the squad (v2 stats, role passive, active text), the enemy card, the turn order, the action log and the totals
 *   GET  /l12               the Combat Lab measurements L1 and L2 (plan 19.5, read-only): the last report of `node card-studio/v2sim/run.mjs lab12`
 *                           (out/v2sim/lab12.json, made from the private Set 1 actives; the page shows numbers only: no card key, no card text) as rows
 *                           (v2sim/lab12.mjs l12Rows) with the number that the price uses today. No database. ok with report null when no run exists.
 *   POST /compare           the same body, mode hunt: the same squad in v1 (hunt_attack, the live fight, on a PRIVATE test boss of the tier, a test
 *                           member with copies of the cards, rolled back: the admin sim of src/admin-write.js) and in v2 (this lab), totals side by side
 * The tester list (balance combat_v2.testers) is NOT edited here: the page uses the balance editor (/api/admin/edit: review, test, apply, admin log).
 * Protection: the admin gate (ADMIN_VIEW=1 + the studio login). A POST needs JSON and X-Admin-Write: 1 (like every Admin write route; a fight writes
 * nothing, but it is heavy work). The LOCAL copy: LOCALDB_ENV (src/admin-write.js localCopy).
 * Usage in server.js: app.use('/api/admin/combat-lab', combatLabRouter()) BEFORE the read-only router.
 */
import express from 'express';
import { adminGate } from './admin-routes.js';
import { localCopy, lit, readRes, BadRequest } from './admin-write.js';
import { roleOf, templateFor, allocate, classOf, ROLES } from '../v2sim/cards.mjs';
import { loadConfig, HERE as V2SIM } from '../v2sim/util.mjs';
import { l12Rows } from '../v2sim/lab12.mjs';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The default report file of `run.mjs lab12` (card-studio/out/v2sim, not committed). */
export const L12_FILE = join(V2SIM, '..', 'out', 'v2sim', 'lab12.json');
/** The L1/L2 report of a run.mjs lab12 JSON file: null when there is no file; an error text when the file has another shape. */
export function l12Report(file, cfg) {
  if (!existsSync(file)) return null;
  let j; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { error: `the report file is not JSON (${e.message})` }; }
  const M = j?.measure, S = j?.summary;
  if (!M || !S || typeof S !== 'object' || !Object.keys(S).length) return { error: 'the report file has no measure and summary (run node card-studio/v2sim/run.mjs lab12 again)' };
  let rows; try { rows = l12Rows(S, cfg); } catch (e) { return { error: `the report file has another shape (${e.message})` }; }
  return { written_at: statSync(file).mtime.toISOString(), runs: M.runs, seeds: M.seeds, teams: M.teams, pairs: M.pairs ?? null, standard: M.standard ?? null,
    policies: Object.keys(S), rows };
}

export const MODES = ['hunt', 'dungeon'];
export const MAX_ACTIONS = 600; // a safety bound of the driver loop (a Hunt day of 40 steps has about 100 actions)
const ID = /^[A-Za-z0-9_]{1,40}$/;
const KEY = /^[a-z_]{1,40}$/;
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`;

const intIn = (v, name, min, max, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const numIn = (v, name, min, max, dflt) => {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new BadRequest(`${name} must be a number from ${min} to ${max}`);
  return n;
};

/** The fight request, checked. The SQL functions check again (an unknown boss, tier, monster or kind raises). */
export function parseFight(body, { hunt = 8, dungeon = 5 } = {}) {
  const b = body || {};
  if (!ID.test(String(b.player || ''))) throw new BadRequest('player must be a member id');
  if (!MODES.includes(b.mode)) throw new BadRequest('mode must be hunt or dungeon');
  const size = b.mode === 'hunt' ? hunt : dungeon;
  let cards = 'auto';
  if (b.cards !== 'auto' && b.cards !== undefined) {
    if (!Array.isArray(b.cards) || b.cards.length < 1 || b.cards.length > size) throw new BadRequest(`cards must be 'auto' or a list of 1 to ${size} card ids`);
    if (!b.cards.every((c) => Number.isInteger(c) && c > 0)) throw new BadRequest('a card id is a whole number');
    if (new Set(b.cards).size !== b.cards.length) throw new BadRequest('a card is twice in the squad');
    cards = b.cards;
  }
  const out = { player: b.player, mode: b.mode, cards, size, level: intIn(b.level, 'level', 0, 100, 0), seed: intIn(b.seed, 'seed', 1, 999999, 1) };
  if (b.mode === 'hunt') {
    if (b.boss != null && b.boss !== '' && !KEY.test(String(b.boss))) throw new BadRequest('boss must be a boss key');
    if (!['Normal', 'Heroic', 'Mythic'].includes(b.tier)) throw new BadRequest('tier must be Normal, Heroic or Mythic');
    Object.assign(out, { boss: b.boss || null, tier: b.tier, start_hp: numIn(b.start_hp, 'start_hp', 0.05, 1, 1) });
  } else {
    if (!KEY.test(String(b.monster || ''))) throw new BadRequest('monster must be a monster key');
    if (!KEY.test(String(b.kind || ''))) throw new BadRequest('kind must be a room kind');
    Object.assign(out, { monster: b.monster, kind: b.kind, floor: intIn(b.floor, 'floor', 1, 50, 1), room: intIn(b.room, 'room', 1, 10, 1), foes: intIn(b.foes, 'foes', 1, 4, 1) });
  }
  return out;
}

/** The v2 role and the base blocks of a card: subjects.ability_v2 when it has one, else the simulator placeholder (config.json). pick_factor = the measured
 * active factor of the Hunt auto-pick (plan 20.10, subjects.ability_v2.pick_factor; a placeholder has none: the pick uses 1). */
export function activeOf(cfg, card) {
  const a2 = card.ability_v2;
  if (a2 && typeof a2 === 'object' && ROLES.includes(a2.role) && Array.isArray(a2.blocks)) {
    return { role: a2.role, name: a2.name || 'Active', blocks: a2.blocks, source: 'ability_v2', pick_factor: typeof a2.pick_factor === 'number' ? a2.pick_factor : null };
  }
  const role = roleOf(cfg, { key: card.subject_key, type: card.type, ability: card.ability || null });
  const tid = templateFor(cfg, card.subject_key || role, role);
  const t = cfg.v2_templates[tid];
  return { role, name: t.name, blocks: t.blocks, source: 'placeholder', template: tid, pick_factor: null };
}

/** The stat points of a level: the simulator build of the role (config.json v2_builds) with the numbers of balance v2_level and v2_stats. */
export function pointsOf(cfg, role, level, b) {
  const lv = b?.v2_level || cfg.v2_level;
  const pts = Math.max(0, Math.min(level, lv.max_level)) * lv.points_per_level;
  const c = { ...cfg, v2_stats: { ...cfg.v2_stats, max_per_stat: b?.v2_stats?.max_per_stat ?? cfg.v2_stats.max_per_stat } };
  return Object.fromEntries(Object.entries(allocate(c, cfg.v2_builds[role], pts)).filter(([, n]) => n > 0));
}

// ---------------------------------------------------------------------------------------------------- the SQL of one fight
// The driver: a pg_temp function made and undone inside the block. It plays the fight with Auto v2 (combat_v2_auto) and records each event.
// snap = {"card:<id>" | "enemy:<i>": [hp, max, down, {status: stacks or value}, charge, charging]}: the screen diffs two snaps (damage, statuses, deaths).
const DRIVER = String.raw`
create function pg_temp.v2lab_snap(s jsonb) returns jsonb language sql as $x$
  select coalesce(jsonb_object_agg(q.side || ':' || q.id, jsonb_build_array(
      round(coalesce((u.v->>'hp')::numeric, 0), 2), round(coalesce((u.v->>'max')::numeric, 0), 2), coalesce((u.v->>'down')::boolean, false),
      coalesce((select jsonb_object_agg(st.key, coalesce(st.value->'stacks', st.value->'value', 'true'::jsonb)) from jsonb_each(coalesce(u.v->'status', '{}'::jsonb)) st), '{}'::jsonb),
      coalesce((u.v->>'charge')::int, 0), coalesce((u.v->>'charging')::boolean, false))), '{}'::jsonb)
  from combat_v2_units(s) q cross join lateral (select s #> case when q.side = 'card' then array['cards', q.id] else array['enemies', q.id] end as v) u;
$x$;
create function pg_temp.v2lab_fight(p_s jsonb, p_b jsonb, p_max int) returns jsonb language plpgsql as $x$
declare s jsonb := p_s; r jsonb; a jsonb; dec jsonb; ev text := 'act'; n int := 0; pre jsonb;
  log jsonb := '[]'; ent jsonb;
begin
  loop
    if n >= p_max then ev := 'limit'; exit; end if;
    r := combat_v2_next(s, null, p_b); s := r->'state'; ev := r->>'event';
    pre := pg_temp.v2lab_snap(s);
    ent := jsonb_build_object('clock', s->'clock', 'event', ev, 'ticks', coalesce(r->'ticks', '[]'::jsonb), 'ended', coalesce(r->'ended', '[]'::jsonb), 'pre', pre);
    if ev <> 'act' then log := log || jsonb_build_array(ent); exit; end if;
    n := n + 1;
    ent := ent || jsonb_build_object('n', n, 'actor', r->'actor');
    if (r->>'skip')::boolean then
      log := log || jsonb_build_array(ent || jsonb_build_object('skip', true, 'reason', r->'reason', 'post', pre));
      continue;
    end if;
    if r->'actor'->>'side' = 'card' then
      -- Auto v2 (PR E8): the active or the basic attack, the target and the ally
      dec := combat_v2_auto(s, r->'actor', p_b, null);
      a := combat_v2_card_act(s, r->'actor', jsonb_build_object('use', dec->'use', 'target', dec->'target', 'ally', dec->'ally'), p_b);
      -- the ally shows only for an active with a single-ally block (every other action gets the most hurt ally, which it does not use)
      ent := ent || jsonb_build_object('action', a->'action', 'target', dec->'target', 'auto', jsonb_build_object('use', dec->'use', 'why', dec->'why'),
        'ally', case when (dec->>'use')::boolean and exists (select 1 from jsonb_array_elements(coalesce(s #> (combat_v2_unit_path(s, r->'actor') || '{active,blocks}'::text[]), '[]'::jsonb)) x
                            where x->>'k' in ('cure', 'shield', 'heal', 'empower', 'focus') or (x->>'k' = 'quicken' and not coalesce((x->>'all')::boolean, false))) then dec->'ally' end,
        'hits', coalesce(a->'hits', '[]'::jsonb));
    else
      a := combat_v2_enemy_act(s, r->'actor', '{}'::jsonb, p_b);
      ent := ent || jsonb_build_object('move', a->'move');
    end if;
    s := a->'state';
    log := log || jsonb_build_array(ent || jsonb_build_object('post', pg_temp.v2lab_snap(s)));
  end loop;
  return jsonb_build_object('end', ev, 'actions', n, 'clock', s->'clock', 'log', log, 'final', pg_temp.v2lab_snap(s));
end $x$;`;

/** The SQL text of one fight (a DO block that always raises: RES {...}). squad = [{card_id, rarity, stars, cp_mod, level, points, role, blocks}]. */
export function fightSql(f, squad, { maxActions = MAX_ACTIONS } = {}) {
  const enemies = f.mode === 'hunt'
    ? `en := jsonb_build_array(combat_v2_hunt_boss(${lit(f.tier)}, ${f.boss ? lit(f.boss) : 'null'}, jsonb_build_object('start_frac', ${Number(f.start_hp)}, 'meter', round((random() * 100)::numeric, 2)), b));
       ${f.boss ? `card := hunt_boss_v2_card(${lit(f.boss)}, ${lit(f.tier)});` : ''}`
    : `for i in 1..${Number(f.foes)} loop
         en := en || jsonb_build_array(combat_v2_dungeon_foe(${lit(f.monster)}, ${Number(f.floor)}, ${Number(f.room)}, ${lit(f.kind)}, null, b) || jsonb_build_object('meter', round((random() * 100)::numeric, 2)));
       end loop;`;
  return `set statement_timeout = 120000;
do $t$
declare b jsonb; s jsonb; cards jsonb := '{}'; info jsonb := '[]'; en jsonb := '[]'; card jsonb; x jsonb; i int; cc jsonb; res jsonb; mech jsonb; txt jsonb;
  pw jsonb; pws jsonb := '[]'; sv jsonb; e9 boolean := to_regprocedure('public.card_power_v2(jsonb, jsonb, jsonb)') is not null;
begin
  ${DRIVER}
  perform setseed(${(f.seed % 1000000) / 1000000});
  b := combat_v2_enemy_numbers();
  for x, i in select v, o::int from jsonb_array_elements(${jlit(squad)}) with ordinality q(v, o) loop
    cc := card_combat_v2(x->>'rarity', (x->>'stars')::int, (x->>'cp_mod')::numeric, (x->>'level')::int, x->'points', x->>'role');
    begin txt := ability_v2_text(cc->>'class', x->'blocks'); exception when others then txt := jsonb_build_object('text', null, 'error', sqlerrm); end;
    -- PR E9: the Power number (card_power_v2) of the card, and its entry of the squad value
    pw := null;
    if e9 then begin pw := card_power_v2(cc, x->'blocks', null); exception when others then pw := jsonb_build_object('error', sqlerrm); end; end if;
    if pw ? 'value' then pws := pws || jsonb_build_array(jsonb_build_object('id', i, 'role', cc->>'role', 'power', pw->'value', 'blocks', x->'blocks')); end if;
    cards := cards || jsonb_build_object(i::text, jsonb_build_object('role', cc->>'role', 'class', cc->>'class',
      'atk', cc->'stats'->'atk', 'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'abl', cc->'stats'->'abl', 'acc', cc->'stats'->'acc',
      'def', cc->'stats'->'def', 'ddg', cc->'stats'->'ddg', 'max', cc->'stats'->'hp', 'hp', cc->'stats'->'hp', 'down', false,
      'speed', b->'v2_speed'->'role_base'->(cc->>'role'), 'spd', coalesce(cc->'points'->'spd', '0'::jsonb), 'power', cc->'power', 'extra_stack', cc->'extra_stack',
      'meter', round((random() * 100)::numeric, 2), 'charge', (b->'v2_charge'->>'start')::int, 'held', 0, 'status', '{}'::jsonb,
      'active', jsonb_build_object('blocks', x->'blocks')));
    info := info || jsonb_build_array(jsonb_build_object('slot', i, 'card_id', x->'card_id', 'v2', cc, 'text', txt->'text', 'text_error', txt->'error',
      'charge_need', (b->'v2_charge'->>(cc->>'class'))::int, 'power', pw));
  end loop;
  if e9 and jsonb_array_length(pws) = jsonb_array_length(info) then sv := combat_v2_squad_value(pws, null, null); end if;
  ${enemies}
  s := jsonb_build_object('v', 2, 'mode', ${lit(f.mode)}, 'round', 0, 'clock', 0, 'squad', (select jsonb_agg(g) from generate_series(1, jsonb_array_length(info)) g),
    'cards', cards, 'enemies', en, 'marks', '{}'::jsonb, 'facts', jsonb_build_object('passives', '[]'::jsonb, 'cards', '{}'::jsonb), 'ext', '{}'::jsonb);
  select coalesce(jsonb_object_agg(m.key, jsonb_build_object('label', m.label, 'text', m.text, 'kind', m.kind, 'numbers', balance_path(m.numbers))), '{}'::jsonb) into mech
    from public.enemy_mechanics m where exists (select 1 from jsonb_array_elements(en) e where e->'mechanics' ? m.key);
  res := jsonb_build_object('squad', info, 'squad_value', sv, 'enemies', en, 'boss_card', card, 'mechanics', mech,
    'turn_order', combat_v2_turn_order(s, 12), 'start', pg_temp.v2lab_snap(s), 'cap', b->${f.mode === 'hunt' ? "'v2_hunt'" : "'v2_dungeon'"}->'round_cap',
    'fight', pg_temp.v2lab_fight(s, b, ${Number(maxActions)}));
  raise exception 'RES %', res;
end $t$;`;
}

/** The Hunt auto-pick (combat_v2_autopick) of a member's cards against the boss of the fight: a DO block that always raises (RES {ids, rows, passes}).
 * all = [{card_id, rarity, stars, cp_mod, level, points, role, blocks, pick_factor}] (pick_factor null = none: the pick uses 1). A named boss gives its mechanics and its Weak to role (combat_v2_hunt_boss); the
 * tier boss draws its signatures in the fight, so its pick has no mechanics and no Weak to role. A card that card_combat_v2 refuses is left out. */
export function pickSql(f, all) {
  return `set statement_timeout = 120000;
do $t$
declare b jsonb; u jsonb := '{}'; pool jsonb := '[]'; x jsonb; cc jsonb;
begin
  b := combat_v2_enemy_numbers();
  ${f.boss ? `u := combat_v2_hunt_boss(${lit(f.tier)}, ${lit(f.boss)}, '{"start_frac": 1}'::jsonb, b);` : ''}
  for x in select v from jsonb_array_elements(${jlit(all)}) v loop
    begin
      cc := card_combat_v2(x->>'rarity', (x->>'stars')::int, (x->>'cp_mod')::numeric, (x->>'level')::int, x->'points', x->>'role');
      pool := pool || jsonb_build_array(jsonb_build_object('id', x->'card_id', 'role', cc->>'role', 'class', cc->>'class', 'atk', cc->'stats'->'atk',
        'crt', cc->'stats'->'crt', 'crd', cc->'stats'->'crd', 'spd', cc->'stats'->'spd', 'blocks', x->'blocks', 'pick_factor', x->'pick_factor'));
    exception when others then null;
    end;
  end loop;
  raise exception 'RES %', combat_v2_autopick(pool, jsonb_build_object('mechanics', coalesce(u->'mechanics', '[]'::jsonb), 'weak_role', u->'weak_role'), ${Number(f.size)}, b, null);
end $t$;`;
}

/** The v1 side of the compare (the admin sim of src/admin-write.js simSql, with the member's cards): a test member with copies of the chosen
 * cards (same stars and stat points), a PRIVATE test boss of the tier with no passive (never the live boss row), hunt_attack until the round
 * cap, the strongest standing card first. Rolled back: RES {damage, attacks, downs, round_cap}. */
export function v1Sql(f, cardIds) {
  return `set statement_timeout = 120000;
do $t$
declare P text := 'tst_v2lab_cmp'; d date := (now() at time zone 'America/Denver')::date; ids bigint[] := array[${cardIds.map(Number).join(', ')}]::bigint[];
  h bigint; hp bigint; share bigint; cid bigint; dmg bigint := 0; atks int := 0; done boolean := false; tried boolean; r jsonb; downs int;
begin
  perform setseed(${(f.seed % 1000000) / 1000000});
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values (P, 'tst v2 lab compare');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select P, pc.card_id, 1, pc.ascension, pc.stat_points from player_cards pc where pc.player_id = ${lit(f.player)} and pc.card_id = any(ids);
  hp := balance_num('boss_hp', ${lit(f.tier)}); share := greatest(1, round(hp::numeric / balance_num('boss_hp', 'crew')));
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, passive, hp_share, stats)
    values ('Lab Boss', ${lit(f.tier)}, '[]', '[]', hp, hp, now() + interval '1 day', '{}'::jsonb, share,
            jsonb_build_object('atk', balance_num('boss_atk', ${lit(f.tier)}))) returning id into h;
  insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, ids);
  while not done loop
    tried := false;
    for cid in select pc.card_id from player_cards pc join cards c on c.id = pc.card_id
                left join hunt_card_hp hh on hh.card_id = pc.card_id and hh.player_id = P and hh.hunt_id = h
                where pc.player_id = P and not coalesce(hh.downed, false)
                order by (card_combat(c.rarity::text, pc.ascension, 1.0, pc.stat_points)->>'cp')::int desc, pc.card_id loop
      r := hunt_attack(P, h, cid);
      if r->>'error' in ('stunned', 'downed') then continue; end if;
      tried := true; exit;
    end loop;
    if not tried or r->>'error' is not null then done := true;
    else
      dmg := dmg + coalesce((r->>'damage')::int, 0); atks := atks + 1;
      if (r->>'round')::int >= hunt_round_cap() or coalesce((r->>'defeated')::boolean, false) then done := true; end if;
    end if;
  end loop;
  select count(*) into downs from hunt_card_hp where hunt_id = h and player_id = P and downed;
  raise exception 'RES %', jsonb_build_object('damage', dmg, 'attacks', atks, 'downs', downs, 'round_cap', hunt_round_cap(), 'cards', cardinality(ids),
    'boss_hp', hp, 'last_error', r->>'error');
end $t$;`;
}

// ---------------------------------------------------------------------------------------------------- the mechanic lines (the text with its OWN numbers)
/** One number of a mechanic text, readable: a count (a whole number of 1 or more) or a "{x} times" factor stays a number (2, 1.4); a share or a
 * multiplier below 1 is a percent (0 -> 0%, 0.7 -> 70%, 0.004 -> 0.4%). true / false -> yes / no. */
export function fmtNum(v, times = false) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const n = Number(v);
  if (!Number.isFinite(n)) return '?';
  if (times || (Number.isInteger(n) && n >= 1)) return String(+n.toFixed(3));
  return `${+(n * 100).toFixed(1)}%`;
}
/** A mechanic text with every {leaf} filled from ITS numbers (a dotted leaf reads a nested number). A leaf with no number shows "?" (never a "{"). */
export function fillMech(text, numbers) {
  return String(text || '').replace(/{([a-z0-9_.]+)}( times)?/g, (m, leaf, times) => {
    const v = leaf.split('.').reduce((o, x) => (o && typeof o === 'object' ? o[x] : undefined), numbers || {});
    return `${v === undefined || v === null ? '?' : fmtNum(v, !!times)}${times || ''}`;
  });
}
/** The mechanic lines of a named Hunt boss: hunt_boss_v2_card(key, tier).signature, each text filled with the card's OWN numbers (the boss's
 * params over the base numbers: enemy_v2.bosses.<key>.params, for example the Warlord's Ironhide crit_x 0). */
export function bossLines(card) {
  return (card?.signature || []).map((x) => ({ key: x.key, label: x.label, mythic: !!x.mythic, text: fillMech(x.text, x.numbers) }));
}
/** The mechanic lines of a unit with no boss card (a Dungeon foe, the tier boss): enemy_mechanics with the balance numbers (they have no params). */
export function unitLines(unit, mechanics) {
  return (unit?.mechanics || []).map((k) => { const m = mechanics?.[k]; return m ? { key: k, label: m.label, text: fillMech(m.text, m.numbers) } : { key: k, label: k, text: '' }; });
}

// ---------------------------------------------------------------------------------------------------- the log and the totals (no combat math: diffs only)
const unitKey = (ref) => `${ref.side}:${ref.side === 'enemy' ? Number(ref.id) : String(ref.id)}`;
/** The changes between two snaps: [{unit, hp: [before, after], add: {status: v}, drop: [status], down: true|undefined}]. */
export function snapDiff(a, b) {
  const out = [];
  for (const k of Object.keys(b || {})) {
    const x = a?.[k], y = b[k];
    if (!x) continue;
    const add = {}, drop = [];
    for (const [s, v] of Object.entries(y[3] || {})) if (JSON.stringify(x[3]?.[s]) !== JSON.stringify(v)) add[s] = v;
    for (const s of Object.keys(x[3] || {})) if (!(s in (y[3] || {}))) drop.push(s);
    const ch = { unit: k };
    if (x[0] !== y[0]) ch.hp = [x[0], y[0]];
    if (Object.keys(add).length) ch.add = add;
    if (drop.length) ch.drop = drop;
    if (!x[2] && y[2]) ch.down = true;
    if (x[5] !== y[5]) ch.charging = y[5];
    if (Object.keys(ch).length > 1) out.push(ch);
  }
  return out;
}
/** The events of the screen and the totals from the raw driver log. */
export function shapeFight(raw) {
  const f = raw.fight || {}; const log = f.log || [];
  const events = []; let prev = raw.start || {};
  const dealt = {}; let toEnemies = 0, toCards = 0, crits = 0, misses = 0, actives = 0, basics = 0, skips = 0, healEnemy = 0;
  for (const e of log) {
    const between = snapDiff(prev, e.pre);
    if ((e.ticks || []).length || (e.ended || []).length || between.length) events.push({ kind: 'step', clock: e.clock, ticks: e.ticks || [], ended: e.ended || [], changes: between });
    if (e.event !== 'act') { prev = e.pre; break; }
    const changes = snapDiff(e.pre, e.post);
    const ev = { kind: e.skip ? 'skip' : e.actor.side === 'card' ? 'card' : 'enemy', n: e.n, clock: e.clock, actor: unitKey(e.actor), reason: e.reason || null,
      action: e.action || null, move: e.move || null, auto: e.auto ? { why: e.auto.why, target: e.target ? unitKey(e.target) : null, ally: e.ally ? unitKey(e.ally) : null } : null, hits: (e.hits || []).map((h) => ({ target: h.target ? unitKey(h.target) : null, dmg: Number(h.dmg) || 0, crit: !!h.crit, miss: !!h.miss,
        tag: h.extra ? 'extra' : h.splash ? 'splash' : h.area ? 'area' : h.mirrored ? 'mirrored' : h.desync ? 'desync' : null })), changes };
    if (e.skip) skips++;
    if (ev.kind === 'card') { if (e.action === 'active') actives++; else if (e.action === 'basic') basics++; }
    for (const h of ev.hits) { if (h.crit) crits++; if (h.miss) misses++; }
    for (const c of changes) {
      if (!c.hp) continue;
      const loss = c.hp[0] - c.hp[1];
      if (c.unit.startsWith('enemy:')) { if (loss > 0) toEnemies += loss; else healEnemy -= loss; }
      else if (loss > 0) toCards += loss;
      if (c.unit.startsWith('enemy:') && loss > 0 && ev.kind === 'card') dealt[ev.actor] = (dealt[ev.actor] || 0) + loss;
    }
    events.push(ev);
    prev = e.post;
  }
  // step-end ticks on enemies count as damage dealt (Poison, Burn); heals of an enemy between actions count as enemy heals
  // (and step-end ticks on cards count as damage taken)
  for (const ev of events) if (ev.kind === 'step') for (const c of ev.changes) if (c.hp) {
    const loss = c.hp[0] - c.hp[1];
    if (c.unit.startsWith('enemy:')) { if (loss > 0) toEnemies += loss; else healEnemy -= loss; } else if (loss > 0) toCards += loss;
  }
  const final = f.final || {};
  const cardsDown = Object.entries(final).filter(([k, v]) => k.startsWith('card:') && v[2]).length;
  const enemiesDown = Object.entries(final).filter(([k, v]) => k.startsWith('enemy:') && v[2]).length;
  const enemies = Object.keys(final).filter((k) => k.startsWith('enemy:')).length;
  const result = f.end === 'end' ? (enemiesDown === enemies ? 'won' : 'lost') : f.end === 'cap' ? 'step cap' : f.end === 'limit' ? 'action limit' : String(f.end);
  const r2 = (x) => Math.round(x * 100) / 100;
  return { events, totals: { result, steps: Number(f.clock) || 0, cap: raw.cap ?? null, actions: f.actions || 0, damage: r2(toEnemies), net: r2(toEnemies - healEnemy), enemy_heal: r2(healEnemy),
    damage_taken: r2(toCards), crits, misses, actives, basics, skips, cards_down: cardsDown, enemies_down: enemiesDown, by_card: Object.fromEntries(Object.entries(dealt).map(([k, v]) => [k, r2(v)])) }, final };
}

// ---------------------------------------------------------------------------------------------------- the router
export function combatLabRouter({ local = localCopy(), env = process.env, cfg = loadConfig(), l12File = L12_FILE } = {}) {
  const r = express.Router();
  r.use(adminGate(env));
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
    if (req.get('x-admin-write') !== '1' || !req.is('application/json')) return res.status(403).json({ ok: false, error: 'a write needs JSON and the header X-Admin-Write: 1' });
    return next();
  });
  r.use(express.json({ limit: '64kb' }));
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ ok: false, error: e.message });
      const msg = String(e.message || e).split('\n')[0];
      return res.status(/does not exist/.test(msg) ? 409 : 502).json({ ok: false, error: /does not exist/.test(msg)
        ? `The local copy has no combat v2 E7 functions (${msg}). Apply the combat_v2_*.sql files on the local copy.` : msg });
    }
  };
  const rows = (q) => local.sql(q);
  const one = async (q) => (await rows(q))[0] || {};
  // a rolled-back block: its RES or the error text
  // (a deadlock with another rolled-back run of DDL on the same copy, for example a test that replaces a function, runs the block again: at most 3 times)
  const block = async (q) => {
    for (let k = 0; ; k++) {
      try { await local.sql(q); } catch (e) {
        if (e instanceof BadRequest) throw e;
        const out = readRes(e.message);
        if (out.error && /deadlock detected/.test(out.error) && k < 2) continue;
        if (out.error) throw new Error(out.error);
        return out.res;
      }
      throw new Error('the fight block did not roll back');
    }
  };

  const sizes = async () => {
    const x = await one(`select (select (value->>'squad')::int from balance where key = 'dungeon') as dungeon`);
    return { hunt: 8, dungeon: Number(x.dungeon) || 5 };
  };

  r.get('/setup', wrap(async (req, res) => {
    const info = await local.info();
    if (!info.reachable) return res.json({ ok: true, local: info, ready: false });
    const x = await one(`select to_regprocedure('public.combat_v2_enemy_act(jsonb, jsonb, jsonb, jsonb)') is not null as has_e7,
      to_regprocedure('public.combat_v2_on(text, text)') is not null as has_testers,
      (select value from balance where key = 'combat_v2') as flag,
      (select jsonb_agg(jsonb_build_object('key', key, 'name', name, 'weak_to', weak_to, 'sig', sig, 'mythic', mythic) order by ord) from hunt_bosses_v2) as bosses,
      (select jsonb_agg(m.key order by m.key) from dungeon_monsters_v2 m) as monsters,
      (select jsonb_agg(k order by (value->'kinds'->k->>'hp')::numeric) from balance, jsonb_object_keys(value->'kinds') k where key = 'v2_dungeon') as kinds,
      (select jsonb_agg(k) from balance, jsonb_object_keys(value->'hunt') k where key = 'v2_enemy') as tiers,
      (select value->'floors' from balance where key = 'dungeon') as floors`).catch((e) => ({ error: e.message }));
    if (x.error) return res.json({ ok: true, local: info, ready: false, error: String(x.error).split('\n')[0] });
    res.json({ ok: true, local: info, ready: !!x.has_e7, has_testers: !!x.has_testers, flag: x.flag || null, bosses: x.bosses || [], monsters: x.monsters || [],
      kinds: x.kinds || [], tiers: ['Normal', 'Heroic', 'Mythic'].filter((t) => (x.tiers || []).includes(t)), floors: Number(x.floors) || null, sizes: await sizes() });
  }));

  // the Combat Lab measurements L1 and L2 (read-only: a file of the simulator, no database)
  r.get('/l12', wrap(async (req, res) => {
    const rep = l12Report(l12File, cfg);
    res.json({ ok: true, report: rep && !rep.error ? rep : null, error: rep?.error || null, run: 'node card-studio/v2sim/run.mjs lab12 --runs 300 --seeds 5' });
  }));

  r.get('/players', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!q) return res.json({ ok: true, rows: [] });
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const list = await rows(`select p.id, p.username, (select count(*) from player_cards pc where pc.player_id = p.id)::int as cards
      from players p where p.username ilike ${lit(like)} or p.id = ${lit(q)} order by (p.id = ${lit(q)}) desc, p.username limit 20`);
    res.json({ ok: true, rows: list });
  }));

  // the member's cards with the v2 role, the active (ability_v2 or the placeholder), its text and the level-0 v2 CP (the sort of "auto")
  const cardsOf = async (player, level = 0) => {
    const list = await rows(`select pc.card_id, c.name, c.rarity::text as rarity, pc.ascension as stars, pc.quantity, s.key as subject_key, s.type,
        coalesce(s.cp_mod, 1) as cp_mod, s.ability, s.ability_v2
      from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = ${lit(player)} and pc.quantity > 0 order by pc.card_id`);
    if (!list.length) return [];
    const bal = await one(`select (select value from balance where key = 'v2_level') as v2_level, (select value from balance where key = 'v2_stats') as v2_stats`);
    const specs = list.map((c) => { const a = activeOf(cfg, c); return { card: c, a, cls: classOf(a.role), points: pointsOf(cfg, a.role, level, bal) }; });
    // one rolled-back block: the level-L v2 CP (card_combat_v2 cp_base) and the card text of the active (ability_v2_text) of each card; a card that
    // one of them refuses gets null (the fight shows the error)
    const lines = (await block(`do $t$ declare out jsonb := '[]'; x jsonb; cp numeric; tx text; pw jsonb; e9 boolean := to_regprocedure('public.card_power_v2(text, integer, numeric, integer, jsonb, text, jsonb)') is not null;
begin
  for x in select v from jsonb_array_elements(${jlit(specs.map((s) => ({ rarity: s.card.rarity, stars: s.card.stars, cp_mod: Number(s.card.cp_mod), level, points: s.points, role: s.a.role, cls: s.cls, blocks: s.a.blocks })))}) with ordinality q(v, o) order by o loop
    begin cp := (card_combat_v2(x->>'rarity', (x->>'stars')::int, (x->>'cp_mod')::numeric, (x->>'level')::int, x->'points', x->>'role')->>'cp_base')::numeric;
    exception when others then cp := null; end;
    begin tx := ability_v2_text(x->>'cls', x->'blocks')->>'text'; exception when others then tx := null; end;
    -- PR E9: the Power number at this level (card_power_v2 from the card facts)
    pw := null;
    if e9 then begin pw := card_power_v2(x->>'rarity', (x->>'stars')::int, (x->>'cp_mod')::numeric, (x->>'level')::int, x->'points', x->>'role', x->'blocks')->'power';
      exception when others then pw := null; end; end if;
    out := out || jsonb_build_array(jsonb_build_object('cp', cp, 'text', tx, 'power', pw));
  end loop;
  raise exception 'RES %', jsonb_build_object('r', out);
end $t$;`)).r || [];
    return specs.map((s, i) => ({ card_id: Number(s.card.card_id), name: s.card.name, rarity: s.card.rarity, stars: s.card.stars, cp_mod: Number(s.card.cp_mod), role: s.a.role, class: s.cls,
      active: { name: s.a.name, source: s.a.source, template: s.a.template || null, text: lines[i]?.text || null },
      blocks: s.a.blocks, pick_factor: s.a.pick_factor, points: s.points, cp: lines[i]?.cp ?? null, power: lines[i]?.power ?? null }));
  };
  r.get('/player/:id/cards', wrap(async (req, res) => {
    if (!ID.test(req.params.id)) throw new BadRequest('id must be a member id');
    const level = intIn(req.query.level, 'level', 0, 100, 0);
    const list = await cardsOf(req.params.id, level);
    res.json({ ok: true, player: req.params.id, level, rows: list.map(({ blocks, ...c }) => c) });
  }));

  const squadOf = async (f) => {
    const all = await cardsOf(f.player, f.level);
    if (!all.length) throw new BadRequest('the member has no cards on the local copy');
    let pick;
    if (f.cards === 'auto' && f.mode === 'hunt') {
      // the Hunt auto-pick (Auto v2, PR E8)
      const r = await block(pickSql(f, all.map((c) => ({ card_id: c.card_id, rarity: c.rarity, stars: c.stars, cp_mod: c.cp_mod, level: f.level, points: c.points, role: c.role, blocks: c.blocks, pick_factor: c.pick_factor }))));
      pick = (r.ids || []).map((id) => all.find((c) => c.card_id === Number(id))).filter(Boolean);
      if (!pick.length) throw new BadRequest('the auto-pick found no card that card_combat_v2 accepts');
      const why = new Map((r.rows || []).map((x) => [Number(x.id), x]));
      pick = pick.map((c) => ({ ...c, pick: why.get(c.card_id) || null }));
    } else if (f.cards === 'auto') pick = [...all].sort((a, b) => (b.cp ?? 0) - (a.cp ?? 0) || a.card_id - b.card_id).slice(0, f.size);
    else {
      pick = f.cards.map((id) => all.find((c) => c.card_id === id));
      const miss = f.cards.filter((id, i) => !pick[i]);
      if (miss.length) throw new BadRequest(`the member does not own the card${miss.length > 1 ? 's' : ''} ${miss.join(', ')}`);
    }
    return pick;
  };
  const runFight = async (f, pick) => {
    const raw = await block(fightSql(f, pick.map((c) => ({ card_id: c.card_id, rarity: c.rarity, stars: c.stars, cp_mod: c.cp_mod, level: f.level, points: c.points, role: c.role, blocks: c.blocks }))));
    const shaped = shapeFight(raw);
    const squad = raw.squad.map((s) => { const c = pick[s.slot - 1]; return { slot: s.slot, unit: `card:${s.slot}`, card_id: c.card_id, name: c.name, rarity: c.rarity, stars: c.stars,
      role: c.role, active: { ...c.active, text: s.text ?? c.active.text, error: s.text_error || null }, charge_need: s.charge_need, v2: s.v2, pick: c.pick || null, power: s.power || null,
      passive_text: fillMech(s.v2?.passive?.text, s.v2?.passive?.numbers),
      dealt: shaped.totals.by_card[`card:${s.slot}`] || 0 }; });
    // each enemy with its mechanic lines: the named boss from its own card (its own numbers), the others from enemy_mechanics
    const enemies = raw.enemies.map((e, i) => ({ ...e, lines: i === 0 && raw.boss_card ? bossLines(raw.boss_card) : unitLines(e, raw.mechanics) }));
    return { squad, squad_value: raw.squad_value || null, enemies, boss_card: raw.boss_card, mechanics: raw.mechanics, turn_order: raw.turn_order, start: raw.start, ...shaped };
  };

  r.post('/fight', wrap(async (req, res) => {
    const f = parseFight(req.body, await sizes());
    const pick = await squadOf(f);
    res.json({ ok: true, request: f, ...(await runFight(f, pick)) });
  }));

  r.post('/compare', wrap(async (req, res) => {
    const f = parseFight(req.body, await sizes());
    if (f.mode !== 'hunt') throw new BadRequest('compare is for the Hunt only: the v1 Dungeon is a run of rooms with no read-only one-fight path');
    const pick = await squadOf(f);
    const v2 = await runFight(f, pick);
    const v1 = await block(v1Sql(f, pick.map((c) => c.card_id)));
    res.json({ ok: true, request: f, squad: v2.squad.map(({ slot, card_id, name, role }) => ({ slot, card_id, name, role })),
      v1: { ...v1, rule: 'v1 hunt_attack on a private test boss of the tier with no passive (the admin sim)' },
      v2: { ...v2.totals, boss: f.boss, rule: 'v2 on the chosen boss, Auto v2 (combat_v2_auto)' } });
  }));
  return r;
}
