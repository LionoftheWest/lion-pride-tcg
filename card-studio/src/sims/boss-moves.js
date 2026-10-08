/**
 * The boss counter moves (docs/hunt-boss-moves.md section 7), NO lasting change, the LOCAL copy only (was the body of
 * scripts/sim-boss-moves.mjs; the script is now its CLI).
 * For each boss and each squad, it plays scripted squad-days through the real hunt_attack / hunt_support on PRIVATE boss
 * rows: first with the counter moves off (share 0), then on (share 0.4; balance boss_counters). A day: every ready support
 * plays (heal on the most hurt attacker, shield / empower on the next attacker), then one attack; until every attacker is
 * down or the round cap. The result: the average boss damage per squad-day. Off and on use the same random seed for
 * each day (paired). One rolled-back block per boss.
 */
import { runBlock, lit, intParam } from './common.js';

export const ALL_BOSSES = ['The Grind Vampire', 'The AFK Warzombie', 'The Smurf Brute', 'The Hardstuck Skeleton', 'Maw of the Meta', 'The Rage-Quit Warlord',
  'The Ranked Nightshade', 'The Lagspike Parasite', 'The Netcode Mutant', 'The Patch-Day Pumpkin', 'The Ban-Wave Demon', 'The Zerg-Rush Queen'];
// Squads of 8: attackers (full_art) + supports by effect.
export const DEFAULT_SQUADS = {
  'support-heavy (3 atk + heal, shield, empower, weaken, expose)': [3, ['heal', 'shield', 'empower', 'weaken', 'expose']],
  'mixed (5 atk + heal, shield, weaken)': [5, ['heal', 'shield', 'weaken']],
  'attackers only (8 atk)': [8, []],
};
const EFFECTS = /^[a-z_]{2,20}$/;

export function params(p = {}) {
  const bosses = p.bosses == null || p.bosses === '' ? ALL_BOSSES : (Array.isArray(p.bosses) ? p.bosses : [p.bosses]);
  for (const b of bosses) if (!ALL_BOSSES.includes(b)) throw new Error(`bosses: ${String(b).slice(0, 40)} is not a boss`);
  const squads = p.squads || DEFAULT_SQUADS;
  for (const [name, v] of Object.entries(squads)) {
    if (!/^[\w ,().+-]{1,80}$/.test(name) || !Array.isArray(v) || !Number.isInteger(v[0]) || v[0] < 1 || v[0] > 8 || !Array.isArray(v[1]) || !v[1].every((e) => EFFECTS.test(e))) {
      throw new Error('squads: a squad is not allowed');
    }
  }
  return { days: intParam(p.days, 'days', 1, 60, 6), bosses, squads };
}

export function bossSQL(boss, p, { prelude = '', migration = '' } = {}) {
  const squads = Object.entries(p.squads).map(([name, [na, effs]]) => `jsonb_build_object('name', ${lit(name)}, 'na', ${na}, 'effs', ${lit(JSON.stringify(effs))}::jsonb)`).join(', ');
  return String.raw`do $t$ declare
  P text := 'tst_simbm'; d date := (now() at time zone 'America/Denver')::date; out jsonb := '[]';
  atks bigint[]; sq jsonb; share numeric; day int; h bigint; ids bigint[]; sup bigint[]; a bigint; s bigint; r jsonb; tg bigint;
  rounds int; total bigint; n int; eff text;
begin
  ${migration ? 'execute $m$' + migration + '$m$;' : '-- the database as it is'}
  -- the scenario (the Test lab): it rolls back with the rest
  ${prelude || '-- (no prelude)'}
  perform set_config('tcg.skip_welcome', 'on', true);
  select array_agg(id order by id) into atks from (select c.id from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character', 'Creature') and c.rarity = 'full_art' order by c.id limit 8) x;
  insert into players (id, username) values (P, 'tst sim');
  insert into player_cards (player_id, card_id, quantity) select P, x, 1 from unnest(atks) x;
  insert into player_cards (player_id, card_id, quantity)
    select P, min(c.id), 1 from cards c join subjects s on s.id = c.subject_id
    where s.ability->>'kind' = 'support' and c.rarity = 'normal' group by s.ability->>'effect';
  update balance set value = '8' where key = 'daily_card_cap';   -- the daily card cap (balance_table.sql)
  for sq in select * from jsonb_array_elements(jsonb_build_array(${squads})) loop
    select array_agg(x) into ids from (select unnest(atks[1:(sq->>'na')::int]) x) y;
    select coalesce(array_agg(pc.card_id order by pc.card_id), '{}') into sup from player_cards pc join cards c on c.id = pc.card_id join subjects s on s.id = c.subject_id
      where pc.player_id = P and s.ability->>'kind' = 'support' and s.ability->>'effect' in (select jsonb_array_elements_text(sq->'effs'));
    foreach share in array array[0, 0.4]::numeric[] loop
      update balance set value = jsonb_set(value, '{share}', to_jsonb(share)) where key = 'boss_counters';
      total := 0;
      for day in 1..${p.days} loop
        insert into hunts (name, tier, weak_points, resist_points, passive, hp_max, hp_remaining, closes_at, hp_share, stats)
          values (${lit(boss)}, 'Normal', '[]', '[]', '{"list": []}', 9000000, 9000000, now() + interval '1 day', 3000, '{"atk": 58}') returning id into h;
        perform hunt_state_round(h, P, d);
        perform setseed(day / 1000.0);   -- the same seed for off and on: a paired comparison (less noise)
        for rounds in 1..60 loop
          -- every ready support plays
          foreach s in array sup loop
            select s2.ability->>'effect' into eff from cards c join subjects s2 on s2.id = c.subject_id where c.id = s;
            select x.card_id into tg from hunt_card_hp x where x.hunt_id = h and x.player_id = P and x.card_id = any(ids) and not x.downed
              order by case when eff = 'heal' then x.hp_remaining::numeric / greatest(1, x.max_hp) else 0 end, x.card_id limit 1;
            if tg is null then tg := ids[1]; end if;
            r := hunt_support(P, h, s, tg);
          end loop;
          -- one attack: the first attacker that may attack
          r := null;
          foreach a in array ids loop
            r := hunt_attack(P, h, a);
            exit when coalesce((r->>'ok')::boolean, false) or r->>'error' in ('round_cap', 'hunt_over');
          end loop;
          exit when r is null or not coalesce((r->>'ok')::boolean, false);
        end loop;
        total := total + coalesce((select sum(damage) from hunt_hits where hunt_id = h and player_id = P), 0);
        update hunts set status = 'expired' where id = h;
      end loop;
      out := out || jsonb_build_object('boss', ${lit(boss)}, 'squad', sq->>'name', 'share', share, 'avg', round(total::numeric / ${p.days}));
    end loop;
  end loop;
  raise exception 'SIMRES %', out;
end $t$;`;
}

/** The table: per boss and squad, the damage with the counters off and on. */
export function summarize(rows, p) {
  const out = [];
  for (const boss of p.bosses) for (const sq of Object.keys(p.squads)) {
    const off = Number(rows.find((r) => r.boss === boss && r.squad === sq && Number(r.share) === 0)?.avg);
    const on = Number(rows.find((r) => r.boss === boss && r.squad === sq && Number(r.share) === 0.4)?.avg);
    out.push({ boss, squad: sq, off, on, change: off ? Math.round((100 * (on - off)) / off) : null });
  }
  return { days: p.days, rows: out };
}

export function metrics(s) {
  const short = (sq) => sq.replace(/ \(.*$/, '');
  return s.rows.flatMap((r) => [
    { key: `on_${r.boss}_${r.squad}`, label: `${r.boss}, ${short(r.squad)}: damage, counters on`, value: r.on, chart: 'Damage per squad-day, counters on', short: `${r.boss.replace(/^The /, '')} ${short(r.squad)}` },
    { key: `off_${r.boss}_${r.squad}`, label: `${r.boss}, ${short(r.squad)}: damage, counters off`, value: r.off },
  ]);
}

export async function run(q, p, { prelude = '', migration = '', onProgress, isCancelled } = {}) {
  const rows = [];
  for (let i = 0; i < p.bosses.length; i++) {
    if (isCancelled?.()) throw new Error('cancelled');
    onProgress?.(i, p.bosses.length, p.bosses[i]);
    rows.push(...(await runBlock(q, bossSQL(p.bosses[i], p, { prelude, migration }))));
  }
  onProgress?.(p.bosses.length, p.bosses.length);
  return { raw: rows, summary: summarize(rows, p) };
}
