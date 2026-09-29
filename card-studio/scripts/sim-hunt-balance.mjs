/**
 * Boss balance, measured with the REAL engine (hunt_attack) and NO lasting change:
 *   node scripts/sim-hunt-balance.mjs [Normal|Heroic|Mythic] [spawns]
 * One DO block spawns bosses of the tier (their HP raised so nothing dies), builds test
 * members whose cards are drawn at the real pull rates (5 / 15 / 40 packs), adds Nathan's
 * real collection, and lets each member fight one day: the 8 strongest attackers (by
 * card_combat), each attacking until it is downed. It RAISEs the damage per member-day;
 * the exception rolls back everything. Supports are not played (a floor, not a ceiling).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const TIER = process.argv[2] || 'Normal';
const SPAWNS = Number(process.argv[3] || 2);
const NATHAN = '527933470882660373';
const FLOOR = Number(process.argv[4] || 0); // a test card HP floor (0 = the live card_max_hp)

const body = String.raw`do $t$
declare
  res jsonb := '[]'; h bigint; pl record; c record; r jsonb; n int; dmg bigint; atks int; k int; sp int;
  prof text[] := array['light','light','light','light','regular','regular','regular','regular','heavy','heavy','heavy','heavy'];
  packs int; roll numeric; rar text; cid bigint; boss text; v_tier text; downed int; crits int; misses int;
begin
  ${FLOOR ? `create or replace function public.card_max_hp(p_cp integer) returns integer language sql immutable set search_path to 'public' as $f$ select greatest(${FLOOR}, round(p_cp * 1.8))::int; $f$;` : ''}
  -- The test members: 5 cards a pack at the real pull rates (tcg-bot/src/draw.ts PULL_RATES).
  for k in 1..array_length(prof, 1) loop
    insert into players (id, username) values ('tst_bal_' || k, 'tst ' || prof[k]);
    packs := case prof[k] when 'light' then 5 when 'regular' then 15 else 40 end;
    for n in 1..packs * 5 loop
      roll := random();
      rar := case when roll < 0.938 then 'normal' when roll < 0.988 then 'illustrated_rare' when roll < 0.994 then 'secret_rare' when roll < 0.998 then 'full_art' else 'gold' end;
      select id into cid from cards where in_draw_pool and rarity::text = rar order by random() limit 1;
      if cid is null then select id into cid from cards where in_draw_pool and rarity::text = 'normal' order by random() limit 1; end if;
      insert into player_cards (player_id, card_id, quantity) values ('tst_bal_' || k, cid, 1)
        on conflict (player_id, card_id) do update set quantity = player_cards.quantity + 1;
    end loop;
  end loop;

  for sp in 1..${SPAWNS} loop
    loop h := spawn_hunt(3); select hh.tier, hh.name into v_tier, boss from hunts hh where hh.id = h; exit when v_tier = '${TIER}'; delete from hunts where id = h; end loop;
    update hunts set hp_max = 100000000, hp_remaining = 100000000, hp_share = 10000000 where id = h;
    for pl in select id, username from players where id like 'tst_bal_%' or id = '${NATHAN}' loop
      dmg := 0; atks := 0; downed := 0; crits := 0; misses := 0;
      for c in select pc.card_id from player_cards pc join cards cc on cc.id = pc.card_id join subjects s on s.id = cc.subject_id
                where pc.player_id = pl.id and s.type in ('Character', 'Creature')
                order by (card_combat(cc.rarity::text, pc.ascension, s.cp_mod, pc.stat_points)->>'cp')::int desc limit 8 loop
        for n in 1..40 loop
          r := hunt_attack(pl.id, h, c.card_id);
          exit when not (r->>'ok')::boolean;
          atks := atks + 1; dmg := dmg + (r->>'damage')::int;
          if (r->>'crit')::boolean then crits := crits + 1; end if;
          if r->>'outcome' = 'miss' then misses := misses + 1; end if;
          if (r->>'card_downed')::boolean then downed := downed + 1; exit; end if;
        end loop;
      end loop;
      res := res || jsonb_build_object('spawn', sp, 'boss', boss, 'player', case when pl.id = '${NATHAN}' then 'nathan' else pl.username end,
        'damage', dmg, 'attacks', atks, 'downed', downed, 'crits', crits, 'misses', misses);
    end loop;
  end loop;
  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '8min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 1500)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
const HP = { Normal: 60000, Heroic: 80000, Mythic: 80000 }[TIER];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
console.log(`== ${TIER}${FLOOR ? ` card HP floor ${FLOOR}` : ''} (HP ${HP.toLocaleString()}), ${SPAWNS} spawn(s): ${[...new Set(rows.map((r) => r.boss))].join(', ')}`);
for (const who of ['nathan', 'tst light', 'tst regular', 'tst heavy']) {
  const g = rows.filter((r) => r.player === who);
  if (!g.length) continue;
  const d = med(g.map((r) => r.damage));
  console.log(`${who.replace('tst ', '').padEnd(8)} damage/day median ${String(d).padStart(6)} | attacks ${med(g.map((r) => r.attacks))} | ${(100 * g.reduce((t, r) => t + r.crits, 0) / Math.max(1, g.reduce((t, r) => t + r.attacks, 0))).toFixed(0)}% crit | ${(100 * g.reduce((t, r) => t + r.misses, 0) / Math.max(1, g.reduce((t, r) => t + r.attacks, 0))).toFixed(0)}% miss | a crew of 10 needs ${(HP / (10 * Math.max(1, d))).toFixed(1)} days`);
}
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like 'tst_bal_%') test_players, (select count(*) from hunts where status = 'active') active_hunts")));
