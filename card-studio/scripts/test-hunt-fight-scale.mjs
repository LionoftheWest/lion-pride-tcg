import './localdb-guard.mjs';
/**
 * Acceptance test for tcg-bot/supabase/hunt_fight_scale.sql (HUNT-HEADER-V2 part A, Nathan 2026-11-06: "everything needs to be accurate to
 * the damage people ACTUALLY do now in combat v2").
 * Invariant: hunt_fight_scale(h) = combat_v2_hunt_boss(tier, key).max / hunts.hp_max (the max of the fight that hunt_v2_start makes) for an active
 * Hunt or a Hunt with a live v2 day, with the flag ON; NULL with the flag OFF, for a past v1 Hunt, or a Hunt with no v2 boss.
 * hunt_fight_scales(ids) = the non-null factors by id. After a live v2 day, the shared drop x factor = the sum of the shared hits x factor
 * (the bar and the damage numbers agree), and the credit of the day x factor >= the private net damage (the credit counts no heal).
 * ONE DO block, undone by its final RAISE (no lasting change).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hunt-fight-scale.mjs      must PASS
 *   MUTATE=<name> ...   must FAIL;   MUTATE=all ...   the baseline, then every mutation (each must FAIL)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runBlock, assertLocal } from './lab-lib.mjs';
assertLocal('test-hunt-fight-scale.mjs');

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
let mig = read('../../tcg-bot/supabase/hunt_fight_scale.sql');

const MUT = {
  no_flag_check: ["  if not combat_v2_on('hunt') then return null; end if;\n", ''],
  past_v1_converted: ["  if h.status <> 'active' and not exists (select 1 from public.hunt_v2_days d where d.hunt_id = p_hunt and d.live) then return null; end if;\n", ''],
  inverse_factor: ["  return (combat_v2_hunt_boss(h.tier, k)->>'max')::numeric / h.hp_max;", "  return h.hp_max / (combat_v2_hunt_boss(h.tier, k)->>'max')::numeric;"],
  second_calc: ["  return (combat_v2_hunt_boss(h.tier, k)->>'max')::numeric / h.hp_max;", "  return (combat_v2_enemy_numbers()->'v2_enemy'->'hunt'->h.tier->>'hp')::numeric / h.hp_max;"],
  unit_ignored: ["  if h.stats->>'unit' = 'v2' then return 1; end if;   -- a v2-native row: already the fight scale\n", ''],
  batch_keeps_nulls: ['   where x.f is not null;\n', '   where true;\n'],
};

if (process.env.MUTATE === 'all') {
  const run = (m) => spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { env: { ...process.env, MUTATE: m }, encoding: 'utf8' });
  const base = run('');
  const bl = (base.stdout || '').trim().split(/\r?\n/).pop() || '';
  let ok = base.status === 0;
  console.log(`baseline (no mutation)   ${ok ? 'PASS' : 'FAIL'}  ${bl}`);
  if (!ok) console.log(base.stdout, base.stderr);
  for (const n of Object.keys(MUT)) {
    const r = run(n);
    const caught = r.status !== 0 && /FAILED/.test(r.stdout || '');
    if (!caught) ok = false;
    const why = (r.stdout || '').split(/\r?\n/).find((l) => /^FAIL/.test(l)) || (r.stderr || '').trim().split(/\r?\n/).pop() || '';
    console.log(`mutation ${n.padEnd(20)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${why.slice(0, 160)}`);
  }
  console.log(ok ? `mutations: baseline PASS, all ${Object.keys(MUT).length} caught` : 'mutations: FAIL');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE]; if (!m) throw new Error(`no mutation ${process.env.MUTATE}`);
  const n = mig.split(m[0]).length - 1;
  if (n !== 1) throw new Error(`the mutation ${process.env.MUTATE} does not match exactly once (${n})`);
  mig = mig.split(m[0]).join(m[1]);
}
if (['$m$', '$t$', '$x$'].some((x) => mig.includes(x))) throw new Error('the SQL must not contain $m$, $t$ or $x$');

const lit = (s) => `'${s.replace(/'/g, "''")}'`;
const P = lit('9000000000000044001');
const add = (name, okExpr, got = "'null'::jsonb") => `res := res || jsonb_build_object('case', ${lit(name)}, 'ok', coalesce(${okExpr}, false), 'got', ${got});`;

const SQL = String.raw`do $t$
#variable_conflict use_column
declare res jsonb := '[]'; bk text; bn text; hid bigint; hpast bigint; hlive bigint; hnov2 bigint; hnat bigint; hnatpast bigint; sq bigint[]; mx numeric; f numeric; a jsonb; x jsonb;
  s jsonb; drop0 numeric; hits numeric; cred numeric; dmg numeric;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  perform set_config('balance.by', 'tst_hhv2s_admin', true);
  execute $m$${mig}$m$;
  update hunts set status = 'expired' where status = 'active';
  select x.key, x.name into bk, bn from hunt_bosses_v2 x order by x.ord limit 1;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 80000, now() - interval '1 hour', now() + interval '2 days', 'active') returning id into hid;
  -- a past v1 Hunt (no live v2 day), a past Hunt with a live v2 day, a Hunt with no v2 boss
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 80000, 0, now() - interval '20 days', now() - interval '15 days', 'defeated') returning id into hpast;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('The ' || bn, 'Normal', '[]'::jsonb, 50000, 1000, now() - interval '10 days', now() - interval '8 days', 'expired') returning id into hlive;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status)
    values ('Nobody Of This Name', 'Heroic', '[]'::jsonb, 80000, 1000, now() - interval '30 days', now() - interval '28 days', 'expired') returning id into hnov2;
  -- v2-native rows (HUNT-V2-NATIVE PR #533): hp_max is the v2 max already; one active (a fractional-looking max), one past with no v2 day
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 36244, 30000, now() - interval '40 days', now() - interval '38 days', 'expired', '{"unit": "v2", "atk": 73}'::jsonb) returning id into hnatpast;
  insert into players (id, username) values (${P}, 'tst hhv2s');
  insert into hunt_v2_days (hunt_id, player_id, day, boss, squad, state, start_hp, live)
    values (hlive, ${P}, current_date - 9, bk, '{1}'::bigint[], '{}'::jsonb, 1, true);
  sq := array(select c.id from cards c join subjects s0 on s0.id = c.subject_id
               where jsonb_typeof(s0.ability_v2) = 'object' and jsonb_typeof(s0.ability_v2->'blocks') = 'array'
                 and exists (select 1 from roles y where y.key = s0.ability_v2->>'role') and s0.type in ('Character', 'Creature') order by c.id limit 4);
  insert into player_cards (player_id, card_id, quantity) select ${P}, z, 1 from unnest(sq) z on conflict do nothing;
  update balance set value = jsonb_set(value, '{hunt}', 'true') where key = 'combat_v2';
  mx := (combat_v2_hunt_boss('Heroic', bk)->>'max')::numeric;
  f := hunt_fight_scale(hid);
  ${add('S1 flag ON, the active v2 Hunt: factor = combat_v2_hunt_boss(Heroic, key).max / hp_max (not 1)', `f = mx / 80000 and f <> 1`, `jsonb_build_object('f', f, 'max', mx)`)}
  ${add('S2 a past v1 Hunt (no live v2 day): NULL (its numbers stay v1)', `hunt_fight_scale(hpast) is null`, `to_jsonb(hunt_fight_scale(hpast))`)}
  ${add('S3 a past Hunt with a live v2 day: its own tier factor', `hunt_fight_scale(hlive) = (combat_v2_hunt_boss('Normal', bk)->>'max')::numeric / 50000`, `to_jsonb(hunt_fight_scale(hlive))`)}
  ${add('S4 a Hunt with no v2 boss: NULL', `hunt_fight_scale(hnov2) is null`, `to_jsonb(hunt_fight_scale(hnov2))`)}
  s := hunt_fight_scales(array[hid, hpast, hlive, hnov2, null]);
  update hunts set status = 'expired' where id = hid;
  insert into hunts (name, tier, weak_points, hp_max, hp_remaining, opens_at, closes_at, status, stats)
    values ('The ' || bn, 'Heroic', '[]'::jsonb, 36243, 20000, now() - interval '1 hour', now() + interval '2 days', 'active', '{"unit": "v2"}'::jsonb) returning id into hnat;
  ${add('S8 a v2-native row (stats.unit v2): the factor is exactly 1 (not max / hp_max), active or past with no v2 day', `hunt_fight_scale(hnat) = 1 and hunt_fight_scale(hnatpast) = 1 and mx / 36243 <> 1`, `jsonb_build_object('active', hunt_fight_scale(hnat), 'past', hunt_fight_scale(hnatpast))`)}
  delete from hunts where id = hnat;
  update hunts set status = 'active' where id = hid;
  ${add('S5 hunt_fight_scales: exactly the non-null factors by id, each = hunt_fight_scale',
    `(select count(*) from jsonb_object_keys(s)) = 2 and (s->>hid::text)::numeric = f and (s->>hlive::text)::numeric = hunt_fight_scale(hlive) and not s ? hpast::text`, 's')}
  -- S6 a real live day: the shared numbers x factor agree, and the credit x factor is at least the private net damage (heals are not credited)
  delete from hunt_v2_days where player_id = ${P};
  perform setseed(0.27);
  a := hunt_v2_start(${P}, sq);
  x := hunt_v2_auto(${P}, 1000);
  drop0 := (select (hp_max - hp_remaining)::numeric from hunts where id = hid);
  hits := (select coalesce(sum(damage), 0) from hunt_hits where hunt_id = hid);
  select credited, damage into cred, dmg from hunt_v2_days where player_id = ${P} and hunt_id = hid;
  ${add('S6 a live day: the shared drop = the sum of the shared hits = the credit (so x factor they agree); credit x factor >= private net damage > 0',
    `(a->>'ok')::boolean and drop0 > 0 and drop0 = hits and hits = cred and cred * f >= dmg - 1 and dmg > 0`,
    `jsonb_build_object('drop', drop0, 'hits', hits, 'credited', cred, 'credited_v2', round(cred * f, 1), 'private_damage', round(dmg, 1), 'err', a->'error')`)}
  update balance set value = jsonb_set(value, '{hunt}', 'false') where key = 'combat_v2';
  ${add('S7 flag OFF: NULL for every Hunt, and the batch is empty', `hunt_fight_scale(hid) is null and hunt_fight_scale(hlive) is null and hunt_fight_scale(hnatpast) is null and hunt_fight_scales(array[hid, hlive, hnatpast]) = '{}'::jsonb`,
    `jsonb_build_object('one', hunt_fight_scale(hid), 'batch', hunt_fight_scales(array[hid, hlive]))`)}
  raise exception 'RESULT:%', jsonb_build_object('rows', res)::text;
end $t$;`;

const out = JSON.parse(await runBlock(SQL));
let fail = 0;
for (const r of out.rows) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}  ${JSON.stringify(r.got).slice(0, 300)}`); }
console.log(fail ? `FAILED ${fail} of ${out.rows.length}` : `PASS all ${out.rows.length}`);
process.exit(fail ? 1 : 0);
