/**
 * Acceptance test for tcg-bot/supabase/effects_cleanup.sql against the LIVE database with
 * NO lasting change:  node scripts/test-effects-cleanup.mjs [path/to/effects_cleanup.sql]
 * One DO block applies the migration, checks take_player_effect, rampage, rally, mend and
 * the switched-on boons, then RAISEs the results. The exception rolls back everything.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const file = process.argv[2] || fileURLToPath(new URL('../../tcg-bot/supabase/effects_cleanup.sql', import.meta.url));
const mig = readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare
  res jsonb := '[]'; r jsonb; ok boolean; h bigint; c bigint; fx bigint; i int; a numeric; b numeric; n int;
  d0 int[] := '{}'; d1 int[] := '{}'; dbl int := 0; hp0 int; mx int;
begin
  execute $m$${mig}$m$;

  -- 1. take_player_effect: the oldest waiting row, once; expired and used rows are skipped.
  insert into players (id, username) values ('tst_ec', 'tst ec');
  insert into player_effects (player_id, primitive, amount, created_at) values ('tst_ec', 'lucky_pull', 2, now() - interval '2 min'), ('tst_ec', 'lucky_pull', 3, now() - interval '1 min');
  insert into player_effects (player_id, primitive, amount, expires_at) values ('tst_ec', 'lucky_pull', 9, now() - interval '1 s');
  a := take_player_effect('tst_ec', 'lucky_pull'); b := take_player_effect('tst_ec', 'lucky_pull');
  res := res || jsonb_build_object('case', 'take_player_effect: oldest first, once each, expired skipped, then null', 'ok',
    a = 2 and b = 3 and take_player_effect('tst_ec', 'lucky_pull') is null and take_player_effect('tst_ec', 'rally') is null, 'a', a, 'b', b);

  -- 2. The switched-on boons.
  select count(*) into n from effect_primitives where enabled and primitive in ('gift_pack', 'spotlight', 'fog', 'rally', 'mend', 'lucky_pull');
  res := res || jsonb_build_object('case', 'gift_pack, spotlight, fog, rally, mend, lucky_pull are on', 'ok', n = 6, 'n', n);

  -- 3. Rampage: the chance set to 0 vs 1 on the same card, 14 fresh players each.
  h := spawn_hunt(3);
  select c2.id into c from cards c2 join subjects s on s.id = c2.subject_id where s.ability->>'effect' = 'rampage' order by c2.id limit 1;
  update subjects set ability = jsonb_set(ability, '{amount}', '0') where id = (select subject_id from cards where id = c);
  for i in 1..14 loop
    insert into players (id, username) values ('tst_r0_' || i, 'tst'); insert into player_cards (player_id, card_id, quantity) values ('tst_r0_' || i, c, 1);
    r := hunt_attack('tst_r0_' || i, h, c); if (r->>'outcome') in ('hit') then d0 := d0 || (r->>'damage')::int; end if;
    if (r->>'double')::boolean then dbl := dbl + 100; end if;
  end loop;
  update subjects set ability = jsonb_set(ability, '{amount}', '1') where id = (select subject_id from cards where id = c);
  -- 30 tries (was 14): a miss, a crit or a block gives no double, so 10 of 14 failed 1 run in ~40 (2026-10-03).
  for i in 1..30 loop
    insert into players (id, username) values ('tst_r1_' || i, 'tst'); insert into player_cards (player_id, card_id, quantity) values ('tst_r1_' || i, c, 1);
    r := hunt_attack('tst_r1_' || i, h, c); if (r->>'outcome') in ('hit') then d1 := d1 || (r->>'damage')::int; end if;
    if (r->>'double')::boolean then dbl := dbl + 1; end if;
  end loop;
  a := (select percentile_cont(0.5) within group (order by x) from unnest(d0) x);
  b := (select percentile_cont(0.5) within group (order by x) from unnest(d1) x);
  res := res || jsonb_build_object('case', 'rampage: chance 0 = no double, chance 1 = a double on every hit (~2x damage)', 'ok',
    dbl >= 10 and dbl < 100 and b >= 1.6 * a, 'doubles_at_1', dbl, 'median0', a, 'median1', b);

  -- 4. Rally: a waiting +20% is used by the next hit and reported.
  insert into players (id, username) values ('tst_ra', 'tst ra'); insert into player_cards (player_id, card_id, quantity) values ('tst_ra', c, 1);
  insert into player_effects (player_id, primitive, amount) values ('tst_ra', 'rally', 20);
  update subjects set ability = jsonb_set(ability, '{amount}', '0') where id = (select subject_id from cards where id = c);
  ok := false;
  for i in 1..6 loop
    -- A miss, then the boss hit back can down or stun the card (flaky runs, 2026-10-03): reset it each try.
    update hunt_card_hp set hp_remaining = max_hp, downed = false, cd_until_round = 0 where hunt_id = h and player_id = 'tst_ra';
    r := hunt_attack('tst_ra', h, c);
    if (r->>'outcome') <> 'miss' or (r->>'error') is not null then exit; end if;
  end loop;
  res := res || jsonb_build_object('case', 'rally: the next hit uses the +20% boon, the row is used up', 'ok',
    (r->>'rally')::numeric = 20 and not exists (select 1 from player_effects where player_id = 'tst_ra' and consumed_at is null), 'r', r);

  -- 5. Mend: a hurt card heals the waiting 25 HP before it attacks; a full card keeps the boon.
  insert into players (id, username) values ('tst_me', 'tst me'); insert into player_cards (player_id, card_id, quantity) values ('tst_me', c, 1);
  insert into player_effects (player_id, primitive, amount) values ('tst_me', 'mend', 25);
  r := hunt_attack('tst_me', h, c);                     -- full HP: the boon waits
  ok := r->'mend' = 'null'::jsonb and exists (select 1 from player_effects where player_id = 'tst_me' and primitive = 'mend' and consumed_at is null);
  select hp_remaining, max_hp into hp0, mx from hunt_card_hp where hunt_id = h and player_id = 'tst_me' and card_id = c;
  update hunt_card_hp set hp_remaining = 5, downed = false where hunt_id = h and player_id = 'tst_me' and card_id = c;
  update hunt_combat_state set stunned_until = 0 where hunt_id = h and player_id = 'tst_me';
  update hunt_card_hp set cd_until_round = 0 where hunt_id = h and player_id = 'tst_me';
  r := hunt_attack('tst_me', h, c);
  res := res || jsonb_build_object('case', 'mend: waits at full HP; a hurt card heals +25 first, the row is used up', 'ok',
    ok and (r->>'mend')::numeric = 25 and not exists (select 1 from player_effects where player_id = 'tst_me' and consumed_at is null)
    and (r->>'card_hp')::int >= least(mx, 30) - (r->>'counter_dmg')::int - 40, 'r', r);

  -- 6. Gift Pack plays (it was built but off): the target gets a pack.
  select c2.id into fx from cards c2 order by c2.id limit 1;
  update subjects set effect = '{"primitive":"gift_pack","name":"Test Gift","base":{"amount":1},"cooldown_h":24}' where id = (select subject_id from cards where id = fx);
  insert into players (id, username) values ('tst_gp', 'tst gp'), ('tst_gt', 'tst gt');
  insert into player_cards (player_id, card_id, quantity) values ('tst_gp', fx, 1);
  n := coalesce((select pack_balance from players where id = 'tst_gt'), 0);
  r := play_card_effect('tst_gp', fx, 'tst_gt');
  res := res || jsonb_build_object('case', 'gift_pack: the play works and the target has +1 pack', 'ok',
    (r->>'ok')::boolean and (select pack_balance from players where id = 'tst_gt') = n + 1, 'r', r);

  raise exception 'RESULTS %', res;
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) {
  const { case: name, ok, ...rest } = r;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 900)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like 'tst_%') test_players, (select count(*) from pg_proc where proname = 'take_player_effect') take_fn, (select count(*) from effect_primitives where enabled) enabled")));
process.exitCode = fail ? 1 : 0;
