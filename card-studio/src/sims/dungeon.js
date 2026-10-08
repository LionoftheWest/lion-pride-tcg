/**
 * The Dungeon simulation (new, 2026-10-07): seeded daily runs and Gauntlet runs through the REAL dungeon_* functions
 * (dungeon_start / gauntlet_start, dungeon_attack, dungeon_support, dungeon_choose, dungeon_retreat) in ONE rolled-back
 * block, the LOCAL copy only. CLI: scripts/sim-dungeon.mjs. Test: scripts/test-sim-dungeon.mjs.
 *
 * Squads: the local copy's real collections by power tier. The members who pass the adventure gate are ranked by the
 * combat power (CP) of their 3 strongest attackers and cut in 3 equal tiers (low, mid, high); the member in the middle of
 * each tier lends the collection: it is COPIED to test members (tst_simdg_*), so no member row changes and no member id
 * leaves the block (the result names the tier and its power only). The squad: the strongest attackers and up to 2 supports
 * within the day's budget and rule (balance dungeon). The Gauntlet: the week's squad (the same for everyone).
 * Today's dungeon and this week's Gauntlet are generated again in the block (deterministic: the salt + the day), so a
 * scenario that changes a generation number (rooms, growth) shows. The flags dungeon / gauntlet are on in the block.
 *
 * The play (scripted, the same for every run): in a fight, one ready support plays (heal on the most hurt attacker, an ally
 * effect on the strongest attacker, a foe effect on the first foe), then the strongest attacker that may attack attacks.
 * A reward: revive when a card is down, heal when an attacker is below half, else buff, ward, shards, card, heal, reset.
 * A door: the first. Between floors: go on, or retreat at max_floors. Each run has its own seed (from the seed
 * parameter), the same in the baseline and the scenario.
 * The result per run: floors reached, the end (cleared, fell, retreat), cards down, Shards and cards earned, the damage of
 * each squad card.
 */
import { runBlock, lit, intParam, numParam, oneOf, mean } from './common.js';

export const TIER_NAMES = ['low', 'mid', 'high'];

export function params(p = {}) {
  return {
    mode: oneOf(p.mode, 'mode', ['daily', 'gauntlet', 'both'], 'both'),
    runs: intParam(p.runs, 'runs', 1, 10, 2),                 // runs per power tier (daily) and Gauntlet runs
    max_floors: intParam(p.max_floors, 'max_floors', 1, 30, 30),
    max_steps: intParam(p.max_steps, 'max_steps', 50, 20000, 4000),   // actions per run (a safety stop)
    seed: numParam(p.seed, 'seed', -1, 1, 0.42),
  };
}

/** The seed of run k of tier t (t = 0 for the Gauntlet): in [0, 1), from the seed parameter. */
export const runSeed = (seed, t, k) => { const x = Math.abs(seed) + 0.1373 * t + 0.0711 * k; return Math.round((x - Math.floor(x)) * 1e6) / 1e6; };

export function sql(p, { prelude = '' } = {}) {
  const daily = p.mode !== 'gauntlet', gauntlet = p.mode !== 'daily';
  const seeds = [0, 1, 2, 3].map((t) => Array.from({ length: p.runs }, (_, k) => runSeed(p.seed, t, k + 1)));
  return String.raw`set statement_timeout = '10min';
do $t$
declare
  v_day date; d dungeon_days; v_rule jsonb; v_n int; v_budget int; res jsonb := '[]'; tiers jsonb := '[]';
  src_id text; src_power int; lenders jsonb; t int; k int; P text; m text; sq bigint[]; atks bigint[]; sups bigint[]; x bigint; c record;
  v_cost int; v_cheap int; n_atk int; n_sup int; want_sup int; r jsonb; run dungeon_runs; v_run bigint; steps int; ph text;
  acted boolean; tgt bigint; eff text; aim text; dmg jsonb; kills int; pick int; prio text[]; downed int; v_err text;
  v_seq text := pg_get_serial_sequence('public.dungeon_runs', 'id'); v_last bigint; v_called boolean;
  seeds float8[] := array[${seeds.map((a) => `array[${a.join(', ')}]::float8[]`).join(', ')}];
begin
  -- A door room draws its foes from the run id (dungeon_choose: 'door|' || r.id ...), so every run gets a FIXED id: the id
  -- sequence is set before each start. A sequence does not roll back: its value is put back at the end, also on an error.
  execute format('select last_value, is_called from %s', v_seq) into v_last, v_called;
  begin
  -- the scenario (the Test lab): it rolls back with the rest
  ${prelude || '-- (no prelude)'}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}'::jsonb where key in ('dungeon', 'gauntlet');
  v_day := dungeon_day();
  delete from dungeon_days where day = v_day;                     -- generated again with the numbers of this block
  delete from gauntlet_weeks where week = gauntlet_week(v_day);
  perform dungeon_generate(v_day);
  select * into d from dungeon_days where day = v_day;
  v_rule := coalesce(d.rule, '{}'::jsonb);
  v_n := balance_num('dungeon', 'squad')::int;
  v_budget := coalesce((v_rule->>'budget')::int, balance_num('dungeon', 'budget')::int);
  select min(balance_num('dungeon', 'cost', r2::text))::int into v_cheap from unnest(enum_range(null::card_rarity)) r2
    where balance_get('dungeon')->'cost' ? r2::text;

  -- the lenders: the members who pass the gate, by the CP of their 3 strongest attackers, in 3 tiers; the middle of each tier
  select coalesce(jsonb_agg(jsonb_build_object('tier', w.tl, 'player', w.player_id, 'power', w.power) order by w.tl), '[]') into lenders from (
    select z.*, row_number() over (partition by z.tl order by z.power, z.player_id) rn, count(*) over (partition by z.tl) cnt from (
      select y.player_id, y.power, ntile(3) over (order by y.power, y.player_id) tl from (
        select x2.player_id, sum(x2.cp)::int power from (
          select pc.player_id, (card_combat(c2.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int cp,
                 row_number() over (partition by pc.player_id order by (card_combat(c2.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int desc, pc.card_id) rk
          from player_cards pc join cards c2 on c2.id = pc.card_id join subjects s on s.id = c2.subject_id
          where pc.quantity > 0 and s.type in ('Character', 'Creature') and pc.player_id not like 'tst%') x2
        where x2.rk <= 3 group by x2.player_id) y
      where (adventure_gate(y.player_id)->>'ok')::boolean) z) w
  where w.rn = (w.cnt + 1) / 2;

  for t in 1..${daily ? 3 : 0} loop
    src_id := null; src_power := null;
    select (l->>'player'), (l->>'power')::int into src_id, src_power from jsonb_array_elements(lenders) l where (l->>'tier')::int = t;
    continue when src_id is null;
    sq := null;
    for k in 1..${p.runs} loop
      P := 'tst_simdg_' || t || '_' || k;
      insert into players (id, username) values (P, 'tst sim dungeon');
      insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
        select P, pc.card_id, pc.quantity, pc.ascension, pc.stat_points from player_cards pc where pc.player_id = src_id and pc.quantity > 0;
      if sq is null then
        -- the squad: the strongest attackers, then up to 2 supports, within the budget (room left for the cheapest card)
        want_sup := least(2, (select count(*) from player_cards pc join cards c2 on c2.id = pc.card_id join subjects s on s.id = c2.subject_id
          where pc.player_id = P and s.type not in ('Character', 'Creature') and s.ability->>'kind' = 'support'
            and not (v_rule ? 'types' and not (v_rule->'types' ? s.type)) and not (v_rule ? 'no_rarity' and v_rule->'no_rarity' ? c2.rarity::text)))::int;
        sq := '{}'; v_cost := 0; n_atk := 0; n_sup := 0;
        for c in select pc.card_id id, (s.type in ('Character', 'Creature')) atk, balance_num('dungeon', 'cost', c2.rarity::text)::int cost,
                        (s.ability->>'kind' = 'support') sup, (dungeon_card(P, pc.card_id)->'cmb'->>'cp')::int cp
                 from player_cards pc join cards c2 on c2.id = pc.card_id join subjects s on s.id = c2.subject_id
                 where pc.player_id = P and not (v_rule ? 'types' and not (v_rule->'types' ? s.type))
                   and not (v_rule ? 'no_rarity' and v_rule->'no_rarity' ? c2.rarity::text)
                 order by (s.type in ('Character', 'Creature')) desc, 5 desc, pc.card_id loop
          exit when n_atk >= v_n - want_sup;
          continue when not c.atk;
          if v_cost + c.cost + (v_n - n_atk - 1) * v_cheap <= v_budget then sq := sq || c.id; v_cost := v_cost + c.cost; n_atk := n_atk + 1; end if;
        end loop;
        for c in select pc.card_id id, balance_num('dungeon', 'cost', c2.rarity::text)::int cost, (s.type in ('Character', 'Creature')) atk,
                        (s.ability->>'kind' = 'support') sup
                 from player_cards pc join cards c2 on c2.id = pc.card_id join subjects s on s.id = c2.subject_id
                 where pc.player_id = P and pc.card_id <> all(sq) and not (v_rule ? 'types' and not (v_rule->'types' ? s.type))
                   and not (v_rule ? 'no_rarity' and v_rule->'no_rarity' ? c2.rarity::text)
                 order by (not (s.type in ('Character', 'Creature')) and s.ability->>'kind' = 'support') desc, 2 desc, pc.card_id loop
          exit when coalesce(array_length(sq, 1), 0) >= v_n;
          if v_cost + c.cost + (v_n - coalesce(array_length(sq, 1), 0) - 1) * v_cheap <= v_budget then sq := sq || c.id; v_cost := v_cost + c.cost; end if;
        end loop;
      end if;
      if k = 1 then tiers := tiers || jsonb_build_object('tier', t, 'power', src_power, 'squad', to_jsonb(sq), 'cost', v_cost, 'budget', v_budget); end if;
    end loop;
  end loop;

  -- every run: daily (tiers 1..3) and Gauntlet (tier 0)
  for t in ${gauntlet ? 0 : 1}..${daily ? 3 : 0} loop
    for k in 1..${p.runs} loop
      m := case when t = 0 then 'gauntlet' else 'daily' end;
      if t = 0 then
        P := 'tst_simdg_g_' || k;
        insert into players (id, username) values (P, 'tst sim gauntlet');
        -- the gate needs 8 attackers: base cards (the Gauntlet plays the week's squad, not these)
        insert into player_cards (player_id, card_id, quantity)
          select P, c2.id, 1 from cards c2 join subjects s on s.id = c2.subject_id where s.type in ('Character', 'Creature') and c2.rarity = 'normal'
          order by c2.id limit balance_num('adventure_gate', 'attackers')::int;
      else
        P := 'tst_simdg_' || t || '_' || k;
        continue when not exists (select 1 from players where id = P);
        select array(select (e #>> '{}')::bigint from jsonb_array_elements(tt->'squad') e) into sq from jsonb_array_elements(tiers) tt where (tt->>'tier')::int = t;
      end if;
      perform setval(v_seq, 2000000000 + t * 100 + k, false);   -- the fixed run id (put back at the end)
      perform setseed(seeds[t + 1][k]);
      r := case when t = 0 then gauntlet_start(P) else dungeon_start(P, sq) end;
      if not coalesce((r->>'ok')::boolean, false) then
        res := res || jsonb_build_object('tier', t, 'run', k, 'mode', m, 'error', coalesce(r->>'error', 'start'), 'detail', r - 'state');
        continue;
      end if;
      v_run := (r->>'run')::bigint;
      select * into run from dungeon_runs where id = v_run;
      -- attackers by CP (strongest first), supports in squad order
      select coalesce(array_agg(e.id order by e.cp desc, e.id) filter (where e.atk), '{}'), coalesce(array_agg(e.id order by e.id) filter (where not e.atk and e.sup), '{}')
        into atks, sups from (
        select x2 id, (dungeon_run_card(run, x2)->>'type') in ('Character', 'Creature') atk, dungeon_run_card(run, x2)->'ability'->>'kind' = 'support' sup,
               (dungeon_run_card(run, x2)->'cmb'->>'cp')::int cp from unnest(run.squad) x2) e;
      dmg := '{}'; kills := 0; steps := 0; v_err := null;
      loop
        steps := steps + 1;
        exit when steps > ${p.max_steps};
        select * into run from dungeon_runs where id = v_run;
        exit when run.status <> 'active';
        ph := run.state->>'phase';
        if ph = 'fight' then
          -- one ready support
          foreach x in array sups loop
            continue when coalesce((run.state->'cards'->x::text->>'down')::boolean, false);
            eff := dungeon_run_card(run, x)->'ability'->>'effect';
            aim := coalesce(dungeon_run_card(run, x)->'ability'->>'target', 'boss');
            if aim in ('ally', 'self') then
              select a2 into tgt from unnest(atks) with ordinality u(a2, o)
                where not coalesce((run.state->'cards'->a2::text->>'down')::boolean, true)
                order by case when eff = 'heal' then (run.state->'cards'->a2::text->>'hp')::numeric / greatest(1, (run.state->'cards'->a2::text->>'max')::numeric) else 0 end, u.o limit 1;
              continue when tgt is null;
              continue when eff = 'heal' and (run.state->'cards'->tgt::text->>'hp')::int >= (run.state->'cards'->tgt::text->>'max')::int;
              r := dungeon_support(P, x, tgt, null, m);
            else
              r := dungeon_support(P, x, null, null, m);
            end if;
            exit when coalesce((r->>'ok')::boolean, false);
          end loop;
          select * into run from dungeon_runs where id = v_run;
          exit when run.status <> 'active';
          continue when run.state->>'phase' <> 'fight';
          acted := false;
          foreach x in array atks loop
            r := dungeon_attack(P, x, null, m);
            if coalesce((r->>'ok')::boolean, false) then
              acted := true;
              dmg := jsonb_set(dmg, array[x::text], to_jsonb(coalesce((dmg->>x::text)::int, 0) + coalesce((r->>'damage')::int, 0)));
              if coalesce((r->>'kill')::boolean, false) then kills := kills + 1; end if;
              exit;
            end if;
            exit when coalesce(r->>'error', '') not in ('stunned', 'downed');
          end loop;
          if not acted then
            exit when r->>'error' = 'round_cap';
            v_err := coalesce(r->>'error', 'no attack'); exit;
          end if;
        elsif ph = 'floor_done' then
          if run.floor >= ${p.max_floors} then r := dungeon_retreat(P, m); else r := dungeon_choose(P, 0, m); end if;
          if not coalesce((r->>'ok')::boolean, false) then v_err := coalesce(r->>'error', ph); exit; end if;
        elsif ph in ('choose', 'rest', 'chest', 'path') then
          prio := case when exists (select 1 from jsonb_each(run.state->'cards') e where (e.value->>'down')::boolean) then array['revive', 'heal', 'buff', 'ward', 'shards', 'card', 'reset']
                       when exists (select 1 from jsonb_each(run.state->'cards') e where not (e.value->>'down')::boolean and not coalesce((e.value->>'sup')::boolean, false)
                                      and (e.value->>'hp')::numeric < 0.5 * (e.value->>'max')::numeric) then array['heal', 'buff', 'ward', 'shards', 'card', 'reset', 'revive']
                       else array['buff', 'ward', 'shards', 'card', 'heal', 'reset', 'revive'] end;
          select (o.ord - 1)::int into pick from jsonb_array_elements(run.state->'offers') with ordinality o(v, ord)
            order by coalesce(array_position(prio, o.v->>'kind'), 99), o.ord limit 1;
          r := dungeon_choose(P, coalesce(pick, 0), m);
          if not coalesce((r->>'ok')::boolean, false) then v_err := coalesce(r->>'error', ph); exit; end if;
        else
          v_err := 'phase ' || coalesce(ph, '-'); exit;
        end if;
      end loop;
      select * into run from dungeon_runs where id = v_run;
      select count(*) into downed from jsonb_each(run.state->'cards') e where (e.value->>'down')::boolean;
      res := res || jsonb_build_object('tier', t, 'run', k, 'mode', m, 'status', run.status, 'ended_by', run.ended_by, 'floor', run.floor, 'room', run.room,
        'shards', run.shards, 'cards', coalesce(array_length(run.cards, 1), 0),
        'card_rarities', (select coalesce(jsonb_agg(c2.rarity::text order by c2.id), '[]') from unnest(run.cards) y join cards c2 on c2.id = y),
        'downed', downed, 'kills', kills, 'steps', steps, 'error', v_err, 'damage', dmg, 'squad', to_jsonb(run.squad));
    end loop;
  end loop;
  raise exception 'SIMRES %', jsonb_build_object('day', v_day, 'rule', v_rule->>'name', 'tiers', tiers, 'runs', res,
    'names', (select coalesce(jsonb_object_agg(c2.id::text, c2.name), '{}') from cards c2
              where c2.id in (select (e #>> '{}')::bigint from jsonb_array_elements(res) rr, jsonb_array_elements(coalesce(rr->'squad', '[]')) e)));
  exception when others or query_canceled then
    perform setval(v_seq, v_last, v_called);   -- the sequence as it was (the SIMRES result and every error go on)
    raise;
  end;
end $t$;`;
}

/** Per tier (low, mid, high, Gauntlet): the averages; per card: the damage per run. */
export function summarize(raw) {
  const groups = [[1, 'low'], [2, 'mid'], [3, 'high'], [0, 'gauntlet']].map(([t, name]) => {
    const runs = (raw.runs || []).filter((r) => r.tier === t);
    if (!runs.length) return null;
    const ok = runs.filter((r) => !r.error || r.status);
    const tierInfo = (raw.tiers || []).find((x) => x.tier === t);
    const cards = {};
    for (const r of ok) for (const [id, v] of Object.entries(r.damage || {})) cards[id] = (cards[id] || 0) + Number(v);
    return { tier: name, power: tierInfo?.power ?? null, runs: runs.length, failed: runs.length - ok.length,
      errors: [...new Set(runs.map((r) => r.error).filter(Boolean))],
      floors: Math.round(10 * mean(ok.map((r) => r.floor))) / 10, fell: ok.length ? ok.filter((r) => r.ended_by === 'fell').length / ok.length : null,
      downed: Math.round(10 * mean(ok.map((r) => r.downed))) / 10, shards: Math.round(mean(ok.map((r) => r.shards))),
      cards: Math.round(100 * mean(ok.map((r) => r.cards))) / 100,
      card_damage: Object.entries(cards).map(([id, v]) => ({ card: Number(id), name: raw.names?.[id] || `card ${id}`, damage: Math.round(v / Math.max(1, ok.length)) }))
        .sort((a, b) => b.damage - a.damage) };
  }).filter(Boolean);
  return { day: raw.day, rule: raw.rule, groups };
}

export function metrics(s) {
  return s.groups.flatMap((g) => [
    { key: `floors_${g.tier}`, label: `Floors reached, ${g.tier}`, value: g.floors, chart: 'Floors reached', short: g.tier },
    { key: `fell_${g.tier}`, label: `Runs that fell, ${g.tier}`, value: g.fell, fmt: 'pct' },
    { key: `downed_${g.tier}`, label: `Cards down at the end, ${g.tier}`, value: g.downed },
    { key: `shards_${g.tier}`, label: `Shards per run, ${g.tier}`, value: g.shards, chart: 'Shards per run', short: g.tier },
    { key: `cards_${g.tier}`, label: `Cards per run, ${g.tier}`, value: g.cards },
  ]);
}

export async function run(q, p, { prelude = '', onProgress } = {}) {
  onProgress?.(0, 1);
  const raw = await runBlock(q, sql(p, { prelude }));
  onProgress?.(1, 1);
  return { raw, summary: summarize(raw) };
}
