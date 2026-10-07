/**
 * The balance table (tcg-bot/supabase/balance_table.sql): every number that changes card power or a fight.
 *
 *   node scripts/balance.mjs                      print the table (key, value, note)
 *   node scripts/balance.mjs --log [key]          the history (balance_log): who changed what, when
 *   node scripts/balance.mjs --set stars.normal.5=8.5 [--by nathan]     change one value (acts at once)
 *   node scripts/balance.mjs --undo <log id>      put back the old value of one logged change
 *   node scripts/balance.mjs --sim [--tier Heroic] [--trials 60] [--try stars.normal.5=8.5] [--today]
 *        measure squads against a private test boss on the LOCAL copy (rolled back, never the live boss):
 *        --try = a value to test without saving it; --today = the old star curve (1 + 0.08 x stars)
 *   node scripts/balance.mjs --members [--try ...]  collection power now vs the old 2.5x star table (LOCAL)
 *
 * --set / --undo change the database the .env points to (the LIVE project). Measure first with --sim on the
 * local copy (LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/balance.mjs --sim ...).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });

const t = process.env.SUPABASE_ACCESS_TOKEN, ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)/)?.[1];
if (!t || !ref) { console.error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL in .env'); process.exit(1); }
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const j = await r.json().catch(() => null);
  if (!r.ok && !String(j?.message || '').includes('RES ')) throw new Error(j?.message || `HTTP ${r.status}`);
  return j;
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const opts = (k) => args.flatMap((a, i) => (a === k && args[i + 1] ? [args[i + 1]] : []));
const LOCAL = process.env.LOCALDB === '1';

// key.path=value -> an UPDATE (the guard in the database refuses a wrong shape or a negative number).
function setSql(spec) {
  const m = spec.match(/^([a-z_]+)((?:\.[A-Za-z0-9_ -]+)*)=(.+)$/);
  if (!m) throw new Error(`bad --set/--try "${spec}": use key.path=value, for example stars.normal.5=8.5`);
  const [, key, dotted, raw] = m;
  let val; try { val = JSON.parse(raw); } catch { val = raw; }
  const path = dotted.split('.').filter(Boolean);
  return path.length
    ? `update balance set value = jsonb_set(value, ${lit(`{${path.join(',')}}`)}, ${lit(JSON.stringify(val))}::jsonb, false) where key = ${lit(key)};`
    : `update balance set value = ${lit(JSON.stringify(val))}::jsonb where key = ${lit(key)};`;
}

if (args.includes('--set')) {
  const by = opt('--by', process.env.USERNAME || 'balance.mjs');
  for (const spec of opts('--set')) {
    const sql = `select set_config('balance.by', ${lit(by + ' via balance.mjs')}, true); ${setSql(spec)} select key, value from balance where key = ${lit(spec.split(/[.=]/)[0])};`;
    console.log(JSON.stringify(await q(sql)));
  }
  console.log(`changed on ${LOCAL ? 'the LOCAL copy' : 'the database in .env'}; the Activity sees it within 60 s. History: --log`);
} else if (args.includes('--undo')) {
  const id = Number(opt('--undo')); if (!Number.isInteger(id)) throw new Error('--undo <balance_log id>');
  const by = opt('--by', process.env.USERNAME || 'balance.mjs');
  console.log(JSON.stringify(await q(`select set_config('balance.by', ${lit(by + ' via balance.mjs --undo ' + id)}, true);
    update balance b set value = l.old_value from balance_log l where l.id = ${id} and l.key = b.key and l.old_value is not null
    returning b.key, b.value;`)));
} else if (args.includes('--log')) {
  const key = opt('--log');
  const rows = await q(`select id, key, op, changed_at, changed_by, old_value, new_value from balance_log ${key ? `where key = ${lit(key)}` : ''} order by id desc limit 50`);
  for (const r of rows) console.log(`#${r.id} ${r.changed_at} ${r.key} ${r.op} by ${r.changed_by}\n   old ${JSON.stringify(r.old_value)}\n   new ${JSON.stringify(r.new_value)}`);
} else if (args.includes('--sim')) {
  if (!LOCAL) { console.error('--sim runs on the LOCAL copy only: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/balance.mjs --sim'); process.exit(1); }
  await sim();
} else if (args.includes('--members')) {
  if (!LOCAL) { console.error('--members runs on the LOCAL copy only (it reads member data): LOCALDB=1 ...'); process.exit(1); }
  await members();
} else {
  const rows = await q('select key, value, note, updated_at, updated_by from balance order by key');
  for (const r of rows) console.log(`${r.key}  (${String(r.updated_at).slice(0, 16)} by ${r.updated_by})\n  ${JSON.stringify(r.value)}\n  ${r.note}\n`);
}

function tryBlock() {
  const tries = opts('--try').map(setSql);
  if (args.includes('--today')) {
    const old = Object.fromEntries(['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'event', 'gold', 'promo'].map((r) => [r, [1, 1.08, 1.16, 1.24, 1.32, 1.40]]));
    tries.unshift(`update balance set value = ${lit(JSON.stringify(old))}::jsonb where key = 'stars';`);
  }
  return tries.join('\n  ');
}

// The squad model (the ascension model of 2026-10-03, ascmodel/sim.mjs): 8 cards with no ability, no tags,
// cp_mod 1, all stat points in Attack (3 per star, max 15), the strongest standing card attacks until the
// squad is down or the round cap. A private test boss per trial, inside a rolled-back block.
async function sim() {
  const tier = opt('--tier', 'Heroic'); const trials = Number(opt('--trials', 60));
  const c = (r, a, n) => Array.from({ length: n }, () => [r, a, Math.min(15, 3 * a), 0]);
  const SQUADS = {
    '8 N 1*': c('normal', 1, 8), '8 N 2*': c('normal', 2, 8), '8 N 3*': c('normal', 3, 8), '8 N 4*': c('normal', 4, 8), '8 N 5*': c('normal', 5, 8),
    '8 IR 3*': c('illustrated_rare', 3, 8),
    '2 G 0* + 6 N 0*': [...c('gold', 0, 2), ...c('normal', 0, 6)],
    'typical + Gold: 1G 3FA 2SR 2IR 0*': [...c('gold', 0, 1), ...c('full_art', 0, 3), ...c('secret_rare', 0, 2), ...c('illustrated_rare', 0, 2)],
    '8 G 0*': c('gold', 0, 8), '8 G 5*': c('gold', 5, 8),
  };
  const only = opt('--squad');
  console.log(`${tier} boss, ${trials} fights per squad, ${args.includes('--today') ? 'TODAY (1 + 0.08 x stars)' : 'the balance table'}${opts('--try').length ? ' + ' + opts('--try').join(' ') : ''}\n`);
  console.log('squad'.padEnd(36), 'damage/day'.padStart(10), '±se'.padStart(6), 'p10'.padStart(7), 'p90'.padStart(7), 'attacks'.padStart(8), 'top Power'.padStart(12));
  for (const [name, cards] of Object.entries(SQUADS)) {
    if (only && !name.includes(only)) continue;
    const t0 = Date.now();
    const body = `set statement_timeout = 45000; do $t$ declare
      h bigint; d date := (now() at time zone 'America/Denver')::date; P text := 'tst_bal_sim'; hp bigint; share bigint;
      ids bigint[]; i int; tr int; r jsonb; cid bigint; dmg bigint; atks int; done boolean; tried boolean; arr jsonb := '[]'; topcp int;
      sq jsonb := ${lit(JSON.stringify(cards))};
    begin
      ${tryBlock()}
      hp := balance_num('boss_hp', ${lit(tier)}); share := greatest(1, round(hp::numeric / balance_num('boss_hp', 'crew')));
      select array_agg(id) into ids from (select c.id from cards c join subjects s on s.id = c.subject_id
         where c.rarity = 'normal' and s.type in ('Character','Creature') order by c.id limit 8) x;
      update subjects s set ability = null, tags = '{}'::jsonb, tag_slugs = '{}', cp_mod = 1.0, type = 'Character'
        where s.id in (select subject_id from cards where id = any(ids));
      insert into players (id, username) values (P, 'tst bal sim');
      for i in 1..jsonb_array_length(sq) loop
        update cards set rarity = (sq->(i-1)->>0)::card_rarity where id = ids[i];
        insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values (P, ids[i], 1, (sq->(i-1)->>1)::int,
          jsonb_build_object('attack', (sq->(i-1)->>2)::int, 'vitality', (sq->(i-1)->>3)::int));
      end loop;
      select max((card_combat(c.rarity::text, pc.ascension, 1.0, pc.stat_points)->>'cp')::int) into topcp
        from player_cards pc join cards c on c.id = pc.card_id where pc.player_id = P;
      for tr in 1..${trials} loop
        insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, closes_at, passive, hp_share, stats)
          values ('Sim Boss', ${lit(tier)}, '[]', '[]', hp, hp, now() + interval '1 day', '{}'::jsonb, share,
                  jsonb_build_object('atk', balance_num('boss_atk', ${lit(tier)}))) returning id into h;
        insert into hunt_squads (hunt_id, player_id, hit_date, card_ids) values (h, P, d, ids[1:jsonb_array_length(sq)]);
        dmg := 0; atks := 0; done := false;
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
        arr := arr || jsonb_build_array(jsonb_build_array(dmg, atks));
      end loop;
      raise exception 'RES %', jsonb_build_object('fights', arr, 'topcp', topcp);
    end $t$;`;
    const out = await q(body);
    const msg = out?.message || JSON.stringify(out);
    const m = msg.match(/RES (\{.*\})/s);
    if (!m) { console.log(name.padEnd(36), 'ERROR', msg.slice(0, 300)); continue; }
    const res = JSON.parse(m[1]);
    const d = res.fights.map((x) => x[0]).sort((a, b) => a - b), a = res.fights.map((x) => x[1]);
    const mean = d.reduce((s, x) => s + x, 0) / d.length, sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / d.length);
    console.log(name.padEnd(36), String(Math.round(mean)).padStart(10), String(Math.round(sd / Math.sqrt(d.length))).padStart(6),
      String(d[Math.floor(d.length * 0.1)]).padStart(7), String(d[Math.floor(d.length * 0.9)]).padStart(7),
      (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1).padStart(8), String(res.topcp).padStart(12), `  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}

// What members see: the collection power (profile + leaderboard) with the table now vs the old 2.5x star
// table, the top 10 and the median member. Anonymous (M1..Mn by today's rank).
async function members() {
  const old = Object.fromEntries(['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'event', 'gold', 'promo'].map((r) => [r, [1, 1.25, 1.5, 1.75, 2, 2.5]]));
  const body = `do $t$ declare a jsonb; b jsonb; begin
    ${tryBlock()}
    select jsonb_object_agg(player_id, power) into b from collection_power_all();
    update balance set value = ${lit(JSON.stringify(old))}::jsonb where key = 'stars';
    select jsonb_object_agg(player_id, power) into a from collection_power_all();
    raise exception 'RES %', jsonb_build_object('old', a, 'new', b);
  end $t$;`;
  const out = await q(body);
  const m = (out?.message || '').match(/RES (\{.*\})/s);
  if (!m) { console.log(out?.message || out); process.exit(1); }
  const { old: o, new: n } = JSON.parse(m[1]);
  const rows = Object.keys(o).map((id) => ({ old: o[id], now: n[id] })).sort((x, y) => y.old - x.old);
  rows.forEach((r, i) => { r.m = `M${i + 1}`; r.oldRank = i + 1; });
  [...rows].sort((x, y) => y.now - x.now).forEach((r, i) => { r.newRank = i + 1; });
  const show = (r) => console.log(r.m.padEnd(5), String(r.old).padStart(7), String(r.now).padStart(7), `${r.now >= r.old ? '+' : ''}${Math.round((100 * (r.now - r.old)) / Math.max(1, r.old))}%`.padStart(7), `#${r.oldRank} -> #${r.newRank}`.padStart(12));
  console.log(`${rows.length} members with cards. Collection power: old 2.5x star table -> the balance table${opts('--try').length ? ' + ' + opts('--try').join(' ') : ''}\n`);
  console.log('who'.padEnd(5), 'old'.padStart(7), 'now'.padStart(7), 'change'.padStart(7), 'rank'.padStart(12));
  rows.slice(0, 10).forEach(show);
  console.log('...');
  show(rows[Math.floor(rows.length / 2)]);
  const ch = rows.map((r) => r.now / Math.max(1, r.old)).sort((x, y) => x - y);
  console.log(`\nall members: change from x${ch[0].toFixed(2)} to x${ch[ch.length - 1].toFixed(2)}, median x${ch[Math.floor(ch.length / 2)].toFixed(2)}; ${rows.filter((r) => r.newRank !== r.oldRank).length} of ${rows.length} change rank`);
}
