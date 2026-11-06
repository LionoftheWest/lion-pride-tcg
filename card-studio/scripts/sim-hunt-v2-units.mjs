import './localdb-guard.mjs';
/**
 * HUNT-V2-NATIVE measurement: one simulated Hunt with the live roster, today's units (v1: hp_max 80000, the x hp_max / private max credit)
 * against the new units (v2: hp_max = the v2 boss max, credit 1:1). LOCAL copy only, one rolled-back DO block per variant: NO lasting change.
 *   LOCALDB=1 LAB_LOCK_OWNER=<you> node --import ./scripts/localdb-preload.mjs scripts/sim-hunt-v2-units.mjs [boss name] [tier] [days] [members per day]
 *   members per day (default all): the members take turns (day d plays the next n members of the roster), as a lower participation
 * The roster: every member with damage in the 3 newest Hunts before the live one (the members who play the Hunt now), with their own cards
 * and the auto-pick. Each simulated day every member plays one full v2 day (hunt_v2_start + hunt_v2_auto to the end). The same random seed
 * per (day, member) in both variants. The file hunt_v2_native_units.sql is applied in the block (the v1 variant is a row with no unit mark).
 * Prints, per variant, the boss HP fraction left after each day and the day and member-day count of the kill.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('sim-hunt-v2-units.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const MIG = read('../../tcg-bot/supabase/hunt_v2_native_units.sql');
const [NAME = 'The Rage-Quit Warlord', TIER = 'Heroic', DAYS = '6', PER_DAY = '0'] = process.argv.slice(2);
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

const block = (unit) => String.raw`do $t$
declare roster text[]; hid bigint; d int; i int; j int; nd int; p text; a jsonb; x jsonb; k int; v1hp bigint; mx numeric; days jsonb := '[]'; killed int; md int := 0;
  plays int; fails jsonb := '{}'; st text;
begin
  execute $m$${MIG}$m$;
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'sim_hvn', true);
  update balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';
  update hunts set status = 'expired' where status = 'active';
  roster := array(select distinct h.player_id from hunt_hits h
                   where h.hunt_id in (select id from hunts where id < (select max(id) from hunts) order by id desc limit 3) order by 1);
  v1hp := greatest((balance_get('boss_hp')->>'floor')::bigint, balance_num('boss_hp', ${lit(TIER)})::bigint);
  mx := (combat_v2_hunt_boss(${lit(TIER)}, hunt_v2_boss_key(${lit(NAME)}))->>'max')::numeric;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
    values (${lit(NAME)}, ${lit(TIER)}, '[]'::jsonb,
            ${unit === 'v2' ? 'round(mx)' : 'v1hp'}, ${unit === 'v2' ? 'round(mx)' : 'v1hp'}, now() - interval '1 hour', now() + interval '6 days', 'active',
            jsonb_build_object('atk', 50)${unit === 'v2' ? " || jsonb_build_object('unit', 'v2', 'v1_hp', v1hp)" : ''}) returning id into hid;
  for d in 1 .. ${Number(DAYS)} loop
    plays := 0;
    nd := case when ${Number(PER_DAY)} > 0 then least(${Number(PER_DAY)}, cardinality(roster)) else cardinality(roster) end;
    for j in 1 .. nd loop
      i := 1 + ((d - 1) * nd + j - 1) % cardinality(roster);
      p := roster[i];
      exit when (select status from hunts where id = hid) <> 'active';
      -- the next day of the member: the rows of the day before go (the v2 day and its bridge rows), the shared numbers stay
      delete from hunt_v2_days where hunt_id = hid and player_id = p;
      delete from hunt_card_hp where hunt_id = hid and player_id = p;
      perform setseed(((d * 37 + i * 11) % 997) / 997.0);
      a := hunt_v2_start(p, null);
      if not coalesce((a->>'ok')::boolean, false) then fails := fails || jsonb_build_object(p, a->'error'); continue; end if;
      plays := plays + 1; md := md + 1;
      for k in 1 .. 6 loop
        st := (select status from hunt_v2_days where hunt_id = hid and player_id = p);
        exit when st = 'over';
        x := hunt_v2_auto(p, 1000);
        exit when not coalesce((x->>'ok')::boolean, false);
      end loop;
      if (select status from hunts where id = hid) = 'defeated' and killed is null then killed := md; end if;
    end loop;
    days := days || jsonb_build_object('day', d, 'plays', plays, 'left', round((select hp_remaining::numeric / hp_max from hunts where id = hid), 4),
      'hp', (select hp_remaining from hunts where id = hid));
    exit when (select status from hunts where id = hid) = 'defeated';
  end loop;
  raise exception 'RESULT:%', jsonb_build_object('unit', '${unit}', 'roster', cardinality(roster), 'hp_max', (select hp_max from hunts where id = hid),
    'v2_max', mx, 'days', days, 'kill_member_day', killed, 'member_days', md, 'credited', (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid),
    'start_errors', fails)::text;
end $t$;`;

for (const unit of ['v1', 'v2']) {
  const t0 = Date.now();
  const r = JSON.parse(await runBlock(block(unit)));
  console.log(`${unit}: roster ${r.roster}, hp_max ${r.hp_max} (v2 max ${r.v2_max}), ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const d of r.days) console.log(`  day ${d.day}: ${d.plays} plays, boss HP left ${(d.left * 100).toFixed(2)} % (${d.hp})`);
  console.log(`  kill at member-day ${r.kill_member_day ?? 'none'} of ${r.member_days}; hunt_hits total ${r.credited}; start errors ${JSON.stringify(r.start_errors)}`);
}
