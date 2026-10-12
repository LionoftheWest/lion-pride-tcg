/**
 * The time budget of F-3 (docs/foundations.md "Performance and cost budget" rule 1), on the LOCAL copy, rolled back:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/time-f3-support.mjs [file.sql] [rounds]
 * It times the mean of hunt_support, dungeon_support, hunt_attack and hunt_view (also for the largest collection) (N calls each, the state reset between calls
 * and outside the timing), first with the CURRENT functions (the baseline) and then, in the SAME block, after the file.
 * It runs `rounds` times (default 3) and prints each round, so the baseline is in the same run as the change.
 * OLD=<file> (the function texts before the file): each phase first runs its own texts (the baseline OLD, the change the file),
 * and the even rounds time the change first, so the order and the plan cache do not favor one side.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
if (process.env.LOCALDB !== '1') throw new Error('time-f3-support.mjs runs on the LOCAL copy only');
const ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)?.[1] || 'local';
const file = process.argv[2] || '../tcg-bot/supabase/f3_one_combat_math.sql';
const rounds = Number(process.argv[3] || 3);
const mig = readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const old = process.env.OLD ? readFileSync(process.env.OLD, 'utf8') : '';
if ((mig + old).includes('$o$') || (mig + old).includes('$m$')) throw new Error('no $m$ / $o$ in the files');
const N = 150;
const bodyOf = (afterFirst) => String.raw`do $t$
declare res jsonb := '{}'; h bigint; atk bigint[]; s3 bigint; s2 bigint; p text := 'tst_f3t'; i int; k int; t0 timestamptz; acc interval; r jsonb; run bigint;
  v_day date := (now() at time zone 'America/Denver')::date; lab text; big text;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = value || '{"enabled": true}' where key = 'dungeon';
  perform dungeon_generate(dungeon_day());
  update dungeon_days set rule = '{}'::jsonb where day = dungeon_day();
  select array_agg(id order by id) into atk from (select c.id from cards c join subjects s on s.id = c.subject_id
    where c.rarity = 'normal' and s.type in ('Character', 'Creature') order by c.id limit 4) x;
  select min(c.id) into s3 from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'effect' = 'weaken';
  select min(c.id) into s2 from cards c join subjects s on s.id = c.subject_id where c.rarity = 'normal' and s.ability->>'effect' = 'shield';
  insert into players (id, username) values (p, 'f3 time');
  insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
    select p, x, 1, 3, case when x = s3 then '{"haste": 4, "potency": 3}'::jsonb when x = atk[1] then '{"attack": 4, "vitality": 3}'::jsonb else '{}'::jsonb end
      from unnest(atk || array[s3, s2]) x;
  insert into player_cards (player_id, card_id, quantity)
    select p, c.id, 1 from cards c join subjects s on s.id = c.subject_id where s.type in ('Character', 'Creature') and c.rarity = 'normal'
      and not exists (select 1 from player_cards x where x.player_id = p and x.card_id = c.id) order by c.id limit 8;
  insert into hunts (name, tier, weak_points, resist_points, hp_max, hp_remaining, hp_share, opens_at, closes_at, status, passive)
    values ('F3 Time', 'Normal', '[{"kind": "type", "value": "Creature"}]', '[]', 90000000, 90000000, 90000000, now() - interval '1 hour', now() + interval '1 day', 'active', '{}') returning id into h;
  perform lock_hunt_squad(p, h, atk || array[s3, s2]);
  perform hunt_commit_card(h, p, x, v_day, 10000000) from unnest(atk || array[s3, s2]) x;
  r := dungeon_start(p, atk || array[s3]);
  run := (r->>'run')::bigint;
  update dungeon_runs set state = jsonb_set(state, '{foes}', (select jsonb_agg(f || '{"hp": 90000000, "max": 90000000}'::jsonb) from jsonb_array_elements(state->'foes') f)) where id = run;
  for k in 1 .. 2 loop
    lab := case when (k = 1) = ${afterFirst} then 'after' else 'base' end;
    if lab = 'after' then execute $m$${mig}$m$; ${old ? 'else execute $o$' + old + '$o$;' : ''} end if;
    perform setseed(0.5);
    acc := '0'; for i in 1 .. ${N} loop
      update hunt_card_hp set cd_until_round = 0, downed = false, hp_remaining = 10000000 where hunt_id = h and player_id = p;
      update hunt_combat_state set round = 1 where hunt_id = h and player_id = p;
      t0 := clock_timestamp(); r := hunt_support(p, h, s3, null); acc := acc + (clock_timestamp() - t0);
      if not coalesce((r->>'ok')::boolean, false) then raise exception 'hunt_support %', r; end if;
    end loop;
    res := res || jsonb_build_object(lab || ' hunt_support', round(extract(epoch from acc) * 1e6 / ${N}));
    acc := '0'; for i in 1 .. ${N} loop
      update dungeon_runs set state = jsonb_set(jsonb_set(state, array['cards', s3::text, 'cd'], '0'), '{sup_round}', '-1') where id = run;
      t0 := clock_timestamp(); r := dungeon_support(p, s3, null, 0, 'daily'); acc := acc + (clock_timestamp() - t0);
      if not coalesce((r->>'ok')::boolean, false) then raise exception 'dungeon_support %', r - 'state'; end if;
    end loop;
    res := res || jsonb_build_object(lab || ' dungeon_support', round(extract(epoch from acc) * 1e6 / ${N}));
    acc := '0'; for i in 1 .. ${N} loop
      update hunt_card_hp set cd_until_round = 0, downed = false, hp_remaining = 10000000 where hunt_id = h and player_id = p;
      update hunt_combat_state set round = 1, stunned_until = 0 where hunt_id = h and player_id = p;
      t0 := clock_timestamp(); r := hunt_attack(p, h, atk[1 + i % 4]); acc := acc + (clock_timestamp() - t0);
      if not coalesce((r->>'ok')::boolean, false) then raise exception 'hunt_attack %', r; end if;
    end loop;
    res := res || jsonb_build_object(lab || ' hunt_attack', round(extract(epoch from acc) * 1e6 / ${N}));
    acc := '0'; for i in 1 .. ${N} loop
      t0 := clock_timestamp(); r := hunt_view(p, h, v_day); acc := acc + (clock_timestamp() - t0);
    end loop;
    res := res || jsonb_build_object(lab || ' hunt_view', round(extract(epoch from acc) * 1e6 / ${N}));
    select player_id into big from player_cards where quantity > 0 group by 1 order by count(*) desc limit 1;   -- the largest collection
    acc := '0'; for i in 1 .. 40 loop
      t0 := clock_timestamp(); r := hunt_view(big, h, v_day); acc := acc + (clock_timestamp() - t0);
    end loop;
    res := res || jsonb_build_object(lab || ' hunt_view_big', round(extract(epoch from acc) * 1e6 / 40));
  end loop;
  raise exception 'RESULTS %', res;
end $t$;`;
if (!old) console.log('(no OLD file: the baseline is timed first in every round)');
for (let k = 1; k <= rounds; k++) {
  const body = bodyOf(old && k % 2 === 0 ? 'true' : 'false');
  const out = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }) })).json();
  const m = JSON.stringify(out).match(/RESULTS (\{.*?\})/);
  if (!m) { console.log('NO RESULTS', JSON.stringify(out).slice(0, 800)); process.exit(1); }
  const v = JSON.parse(m[1].replace(/\\"/g, '"'));
  const fns = ['hunt_support', 'dungeon_support', 'hunt_attack', 'hunt_view', 'hunt_view_big'];
  console.log(`round ${k}${old ? (k % 2 === 0 ? ' (change first)' : ' (baseline first)') : ''} (mean µs per call, ${N} calls): ` + fns.map((f) => `${f} ${v['base ' + f]} -> ${v['after ' + f]} (${(100 * (v['after ' + f] / v['base ' + f] - 1)).toFixed(0)}%)`).join(', '));
}
