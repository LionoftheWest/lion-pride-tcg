/**
 * Acceptance test for tcg-bot/supabase/stat_points.sql against the LIVE database with NO
 * lasting change:  node scripts/test-stat-points.mjs
 * One DO block applies the migration, checks the flag-OFF parity, turns the flag on, spends
 * and resets points, fights with them and plays an effect, then RAISEs the results. The
 * exception rolls back everything.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/stat_points.sql', import.meta.url)), 'utf8')
  .replace(/notify pgrst[^\n]*\n/g, '');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const body = String.raw`do $t$
declare
  res jsonb := '[]'; r jsonb; ok boolean; bad text := ''; h bigint; g bigint; att bigint; fx bigint; rar text; a int; m numeric;
  cmb jsonb; amt_a numeric; amt_b numeric;
begin
  execute $m$${mig}$m$;
  -- The migration inserts the flag OFF only if the setting is new. Live is ON since launch.
  update settings set value = value || '{"enabled": false}' where key = 'stat_points';

  -- 1. Flag OFF: card_combat = card_power + card_max_hp for every rarity, star and cp_mod.
  ok := true;
  foreach rar in array array['normal','illustrated_rare','secret_rare','full_art','gold'] loop
    for a in 0..5 loop
      foreach m in array array[1.0, 1.3, 0.85] loop
        cmb := card_combat(rar, a, m, '{"attack":15,"vitality":15}');
        if (cmb->>'cp')::int <> card_power(rar, a, m) or (cmb->>'hp')::int <> card_max_hp(card_power(rar, a, m))
           or (cmb->>'on')::boolean or (cmb->>'crit')::numeric <> 0 or (cmb->>'potency')::numeric <> 1 then
          ok := false; bad := bad || rar || a || ' '; end if;
      end loop;
    end loop;
  end loop;
  res := res || jsonb_build_object('case', 'flag off: card_combat = card_power / card_max_hp (90 inputs)', 'ok', ok, 'bad', bad);

  -- Fixtures: a gold attacker at star 2, a gold attacker at star 5, an effect card at star 2.
  select c.id into att from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character','Creature') and c.rarity::text = 'gold' and coalesce(s.cp_mod, 1) = 1 order by c.id limit 1;
  select c.id into g from cards c join subjects s on s.id = c.subject_id
    where s.type in ('Character','Creature') and c.rarity::text = 'gold' and c.id <> att order by c.id limit 1;
  insert into players (id, username) values ('tst_sp', 'tst sp'), ('tst_sp2', 'tst sp2'), ('tst_tg1', 'tst tg1'), ('tst_tg2', 'tst tg2');
  insert into player_cards (player_id, card_id, quantity, ascension) values ('tst_sp', att, 1, 2), ('tst_sp', g, 1, 5);

  -- 2. With the flag off, spend and reset refuse, and hunt_attack uses card_power.
  r := spend_stat_points('tst_sp', att, '{"attack":1}');
  res := res || jsonb_build_object('case', 'flag off: spend refused', 'ok', r->>'error' = 'disabled', 'r', r);
  h := spawn_hunt(3);
  r := hunt_attack('tst_sp', h, att);
  res := res || jsonb_build_object('case', 'flag off: hunt_attack cp = card_power (star 2 gold = 210)', 'ok',
    (r->>'cp')::int = card_power('gold', 2, 1.0) and (r->>'card_max_hp')::int = card_max_hp(card_power('gold', 2, 1.0)), 'cp', r->'cp', 'hp', r->'card_max_hp');

  -- 3. Flag ON: the formulas.
  update settings set value = value || '{"enabled": true}' where key = 'stat_points';
  cmb := card_combat('gold', 5, 1.0, '{"attack":15}');
  res := res || jsonb_build_object('case', 'on: star 5 all-Attack = 140 x 1.40 x 1.75 = 343 (old 350), HP follows', 'ok',
    (cmb->>'cp')::int = 343 and (cmb->>'hp')::int = card_max_hp(343) and (cmb->>'free')::int = 0, 'cmb', cmb);
  cmb := card_combat('gold', 5, 1.0, '{}');
  res := res || jsonb_build_object('case', 'on: star 5, no points = 196, 15 free', 'ok', (cmb->>'cp')::int = 196 and (cmb->>'free')::int = 15, 'cmb', cmb);
  cmb := card_combat('gold', 5, 1.0, '{"vitality":10,"precision":5}');
  res := res || jsonb_build_object('case', 'on: Vitality +6% HP, Precision +3% crit', 'ok',
    (cmb->>'hp')::int = round(card_max_hp(196) * 1.6) and (cmb->>'crit')::numeric = 0.15, 'cmb', cmb);
  cmb := card_combat('normal', 3, 1.0, '{"potency":4,"haste":5}');
  res := res || jsonb_build_object('case', 'on: Potency +5%, Haste -4%', 'ok',
    (cmb->>'potency')::numeric = 1.20 and (cmb->>'haste')::numeric = 0.80 and (cmb->>'free')::int = 0, 'cmb', cmb);

  -- 4. Spend: the limits (star 2 = 6 points).
  r := spend_stat_points('tst_sp', att, '{"attack":4}');
  ok := (r->>'ok')::boolean and r->'points'->>'attack' = '4' and (r->'stats'->>'free')::int = 2;
  r := spend_stat_points('tst_sp', att, '{"vitality":3}');
  ok := ok and r->>'error' = 'not_enough' and (r->>'free')::int = 2;
  r := spend_stat_points('tst_sp', att, '{"vitality":2}');
  ok := ok and (r->>'ok')::boolean and (r->'stats'->>'free')::int = 0;
  res := res || jsonb_build_object('case', 'spend: 4 + 2 of 6, the 7th point refused', 'ok', ok, 'r', r);
  ok := spend_stat_points('tst_sp', g, '{"luck":1}')->>'error' = 'bad_stat'
    and spend_stat_points('tst_sp', g, '{"attack":-1}')->>'error' = 'bad_amount'
    and spend_stat_points('tst_sp', g, '{"attack":1.5}')->>'error' = 'bad_amount'
    and spend_stat_points('tst_sp', g, '{"attack":"3"}')->>'error' = 'bad_amount'
    and spend_stat_points('tst_sp', g, '{}')->>'error' = 'bad_request'
    and spend_stat_points('tst_sp2', att, '{"attack":1}')->>'error' = 'not_owned'
    and (select stat_points from player_cards where player_id = 'tst_sp' and card_id = g) = '{}'::jsonb;
  res := res || jsonb_build_object('case', 'spend: bad stat / negative / fraction / string / empty / not owned refused, nothing written', 'ok', ok);

  -- 5. The fight reads the points: Attack 4 -> cp = 140 x 1.16 x 1.20, Vitality 2 -> HP x 1.12.
  h := spawn_hunt(3);
  r := hunt_attack('tst_sp', h, att);
  cmb := card_combat('gold', 2, 1.0, '{"attack":4,"vitality":2}');
  res := res || jsonb_build_object('case', 'on: hunt_attack cp + max HP = the points of this copy', 'ok',
    (r->>'cp')::int = (cmb->>'cp')::int and (cmb->>'cp')::int = round(140 * 1.16 * 1.20)
    and (r->>'card_max_hp')::int = (cmb->>'hp')::int, 'cp', r->'cp', 'hp', r->'card_max_hp', 'want', cmb);
  r := hunt_view('tst_sp', h, (now() at time zone 'utc')::date);
  res := res || jsonb_build_object('case', 'hunt_view carries the points', 'ok',
    (r->'stats'->>'on')::boolean and r->'stats'->'cards'->(att::text)->'points'->>'attack' = '4');

  -- 6. Reset: free once a week, then refused; nothing spent refused.
  r := reset_stat_points('tst_sp', g);
  ok := r->>'error' = 'nothing_spent';
  r := reset_stat_points('tst_sp', att);
  ok := ok and (r->>'ok')::boolean and (select stat_points from player_cards where player_id = 'tst_sp' and card_id = att) = '{}'::jsonb
    and (r->'stats'->>'free')::int = 6;
  perform spend_stat_points('tst_sp', g, '{"haste":2}');
  r := reset_stat_points('tst_sp', g);
  ok := ok and r->>'error' = 'reset_used';
  res := res || jsonb_build_object('case', 'reset: nothing spent refused, first reset ok (6 free again), second in the week refused', 'ok', ok, 'r', r);

  -- 7. Effects: Potency and Haste replace the per-star bonus. The same Mustache card at star 2 (a sticker acts in Discord for 1 h since effects_outside.sql):
  --    0 points, Potency 6 (duration x1.30), Haste 5 (cooldown x0.80). now() is fixed in the
  --    transaction, so the ready_at times compare exactly.
  select c.id into fx from cards c join subjects s on s.id = c.subject_id
    where s.effect->>'primitive' = 'mustache' order by c.id limit 1;
  insert into players (id, username) values ('tst_sp3', 'tst sp3'), ('tst_tg3', 'tst tg3');
  insert into player_cards (player_id, card_id, quantity, ascension) values ('tst_sp', fx, 1, 2), ('tst_sp2', fx, 1, 2), ('tst_sp3', fx, 1, 2);
  perform spend_stat_points('tst_sp2', fx, '{"potency":6}');
  perform spend_stat_points('tst_sp3', fx, '{"haste":5}');
  r := play_card_effect('tst_sp', fx, 'tst_tg1');
  cmb := play_card_effect('tst_sp2', fx, 'tst_tg2');
  amt_a := extract(epoch from ((r->>'ready_at')::timestamptz - now()));
  res := res || jsonb_build_object('case', 'effects: Potency 6 = duration x1.30 of the 0-point copy', 'ok',
    (r->>'ok')::boolean and (cmb->>'ok')::boolean
    and abs((cmb->>'duration_s')::int - least(129600, round((r->>'duration_s')::int * 1.30))) <= 1, 'a', r, 'b', cmb);
  cmb := play_card_effect('tst_sp3', fx, 'tst_tg3');
  amt_b := extract(epoch from ((cmb->>'ready_at')::timestamptz - now()));
  res := res || jsonb_build_object('case', 'effects: Haste 5 = cooldown x0.80 of the 0-point copy', 'ok',
    (cmb->>'ok')::boolean and abs(amt_b - amt_a * 0.80) <= 1, 'cd0', amt_a, 'cd_haste', amt_b, 'b', cmb);
  update settings set value = value || '{"enabled": false}' where key = 'stat_points';
  insert into players (id, username) values ('tst_sp4', 'tst sp4'), ('tst_tg4', 'tst tg4');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points) values ('tst_sp4', fx, 1, 2, '{"potency":6}');
  cmb := play_card_effect('tst_sp4', fx, 'tst_tg4');
  res := res || jsonb_build_object('case', 'effects: flag off = the old per-star bonus (x1.20 duration, x0.84 cooldown at star 2), points ignored', 'ok',
    (cmb->>'ok')::boolean and abs(extract(epoch from ((cmb->>'ready_at')::timestamptz - now())) - amt_a * 0.84) <= 1
    and abs((cmb->>'duration_s')::int - least(129600, round((r->>'duration_s')::int * 1.20))) <= 1, 'b', cmb);

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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 700)}`);
}
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
// Nothing may stay: no test players, no new column, no setting.
console.log('after:', JSON.stringify(await q("select (select count(*) from players where id like 'tst_sp%' or id like 'tst_tg%') test_players, (select count(*) from information_schema.columns where table_name='player_cards' and column_name='stat_points') stat_col, (select count(*) from settings where key='stat_points') setting")));
process.exitCode = fail ? 1 : 0;
