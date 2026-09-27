/**
 * Balance simulation for card boons + pranks, against the REAL play_card_effect(),
 * with NO lasting change:  node scripts/boon-sim.mjs [path-to-card_effects.sql]
 *
 * One DO block applies the migration with the DEFAULT caps, builds 12 test members
 * with real cards + test effects, then plays 7 days of abuse:
 *   - farmers  (sim_0, sim_1): every ready boon on each other, every day
 *   - dogpile  (sim_2..sim_7): every ready prank on ONE victim (sim_8)
 *   - spammer  (sim_9):        every ready card on a random member
 *   - others   (sim_10, 11):   every ready card on a random member
 * After each day, every timestamp moves back 1 day (time travel inside the
 * transaction), so cooldowns and weekly caps behave as in a real week.
 * Then it checks the limits and RAISEs the metrics, which rolls everything back.
 * Exit code 1 if any limit is broken.
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config({ override: true });
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = ((process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const file = process.argv[2] || fileURLToPath(new URL('../../tcg-bot/supabase/card_effects.sql', import.meta.url));
const migration = readFileSync(file, 'utf8');

// [primitive, base, cooldown_h] — realistic Normal-tier values for the test cards.
const EFFECTS = [
  ['gift_pack', { amount: 1 }, 72], ['gift_pack', { amount: 1 }, 72], ['lucky_pull', { amount: 2 }, 24],
  ['lucky_pull', { amount: 2 }, 24], ['rally', { amount: 15 }, 24], ['mend', { amount: 10 }, 12],
  ['ward', { duration_s: 86400 }, 48], ['reflect', { duration_s: 86400 }, 48], ['spotlight', { duration_s: 86400 }, 48],
  ['crown', { duration_s: 86400 }, 48], ['hype', {}, 24], ['cleanse', {}, 24],
  ['timeout', { duration_s: 45 }, 48], ['timeout', { duration_s: 30 }, 36], ['nickname', { duration_s: 3600 }, 24],
  ['nickname', { duration_s: 2400 }, 24], ['sticker', { duration_s: 43200 }, 12], ['title', { duration_s: 43200 }, 12],
  ['jinx', {}, 12], ['confetti', {}, 6], ['ping_parade', { amount: 3, duration_s: 300 }, 24],
  ['reaction_storm', { amount: 5, duration_s: 3600 }, 24], ['vc_mute', { duration_s: 20 }, 24], ['clown_role', { duration_s: 3600 }, 24],
];
const effectsSql = EFFECTS.map(([p, b, cd], i) =>
  `update subjects set effect = '${JSON.stringify({ primitive: p, base: b, cooldown_h: cd })}'::jsonb where id = s[${i + 1}];`).join('\n  ');

const body = String.raw`
do $sim$
declare
  s bigint[]; r jsonb; tgt text; rec record; v_metrics jsonb;
  members text[] := array(select 'sim_' || i from generate_series(0, 11) i);
begin
  execute $mig$${migration}$mig$;
  update effect_primitives set enabled = true;
  -- DEFAULT caps from the migration are kept on purpose.

  select array_agg(sid order by sid) into s from (
    select distinct subject_id sid from cards where rarity::text = 'normal' order by 1 limit ${EFFECTS.length}) x;
  ${effectsSql}
  insert into players (id, username) select m, m from unnest(members) m;
  -- Every member owns every test card as a Normal; the farmers and the spammer also own Golds.
  insert into player_cards (player_id, card_id, quantity)
  select m, (select id from cards where subject_id = x and rarity::text = 'normal' order by id limit 1), 1
    from unnest(members) m, unnest(s) x;
  insert into player_cards (player_id, card_id, quantity)
  select m, c.id, 1 from unnest(array['sim_0','sim_1','sim_9']) m
    join cards c on c.subject_id = any(s) and c.rarity::text = 'gold';

  create temp table sim_log (day int, sender text, target text, primitive text, kind text, ok boolean, error text, outcome text, dur int) on commit drop;

  for d in 1..7 loop
    for rec in
      select pc.player_id p, pc.card_id c, sub.effect->>'primitive' prim, ep.kind
        from player_cards pc join cards c on c.id = pc.card_id join subjects sub on sub.id = c.subject_id
        join effect_primitives ep on ep.primitive = sub.effect->>'primitive'
       where pc.player_id = any(members) order by random()
    loop
      tgt := case
        when rec.p in ('sim_0','sim_1') then case when rec.kind = 'prank' then null
                                                   else case rec.p when 'sim_0' then 'sim_1' else 'sim_0' end end
        when rec.p = any(array['sim_2','sim_3','sim_4','sim_5','sim_6','sim_7']) then case when rec.kind = 'prank' then 'sim_8' end
        else (select x from unnest(members) x where x <> rec.p order by random() limit 1) end;
      continue when tgt is null;
      r := play_card_effect(rec.p, rec.c, tgt);
      insert into sim_log values (d, rec.p, coalesce(r->>'target', tgt), rec.prim, rec.kind,
        (r->>'ok')::boolean, r->>'error', r->>'outcome', (r->>'duration_s')::int);
    end loop;
    -- Time travel: the whole world moves back one day.
    update card_plays set created_at = created_at - interval '1 day';
    update card_effect_cooldowns set ready_at = ready_at - interval '1 day';
    update player_effects set created_at = created_at - interval '1 day', expires_at = expires_at - interval '1 day';
    update discord_effects set revert_at = revert_at - interval '1 day', created_at = created_at - interval '1 day';
  end loop;

  select jsonb_build_object(
    'attempts', (select count(*) from sim_log),
    'applied',  (select count(*) from sim_log where ok),
    'refusals', (select jsonb_object_agg(error, n) from (select error, count(*) n from sim_log where not ok group by 1) z),
    'max_sent_per_member_day', (select max(n) from (select count(*) n from sim_log where ok group by day, sender) z),
    'max_pranks_recv_member_day', (select max(n) from (select count(*) n from sim_log where ok and kind = 'prank' and outcome <> 'blocked' group by day, target) z),
    'victim_pranks_per_day', (select jsonb_agg(n order by day) from (select day, count(*) n from sim_log where ok and kind = 'prank' and target = 'sim_8' group by day) z),
    'over_cap_days_by_outcome', (select jsonb_agg(jsonb_build_object('day', day, 'target', target, 'outcomes', o)) from (
        select day, target, jsonb_object_agg(outcome, n) o from (
          select day, target, outcome, count(*) n from sim_log where ok and kind = 'prank' and outcome <> 'blocked' group by 1,2,3) a
        group by 1,2 having sum(n) > 5) z),
    'max_timeouts_recv_member_day', (select max(n) from (select count(*) n from sim_log where ok and primitive = 'timeout' group by day, target) z),
    'max_timeout_s', (select max(dur) from sim_log where ok and primitive = 'timeout'),
    'max_packs_minted_per_member_week', (select max(n) from (select count(*) n from sim_log where ok and primitive = 'gift_pack' and outcome = 'applied' group by target) z),
    'farmer_packs_minted', (select count(*) from sim_log where ok and primitive = 'gift_pack' and target in ('sim_0','sim_1')),
    'stacked_effects', (select count(*) from (select player_id, primitive from player_effects pe join effect_primitives ep using (primitive)
                          where not ep.stacks and consumed_at is null and (expires_at is null or expires_at > now())
                          group by 1, 2 having count(*) > 1) z)
  ) into v_metrics;
  raise exception 'SIM_RESULTS %', v_metrics;
end $sim$;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: body }),
});
const msg = JSON.stringify(await r.json());
const mm = msg.match(/SIM_RESULTS (\{.*?\})\\n/) || msg.match(/SIM_RESULTS (\{.*\})/);
if (!mm) { console.error('NO RESULTS:', msg.slice(0, 1500)); process.exitCode = 1; }
const m = mm && JSON.parse(mm[1].replace(/\\"/g, '"'));
if (m) console.log(JSON.stringify(m, null, 2));

// The limits (default caps in card_effects.sql).
const checks = !m ? [] : [
  ['a member sends at most 10 plays a day', m.max_sent_per_member_day <= 10],
  ['a member receives at most 5 pranks a day (the dogpile victim too)', m.max_pranks_recv_member_day <= 5],
  ['a member receives at most 2 timeouts a day', m.max_timeouts_recv_member_day <= 2],
  ['no timeout is longer than 60s, even from a Gold', m.max_timeout_s <= 60],
  ['gift_pack mints at most 2 packs per member per week (farmers included)', m.max_packs_minted_per_member_week <= 2],
  ['no non-stacking effect is active twice on one member', m.stacked_effects === 0],
];
let fail = m ? 0 : 1;
for (const [name, ok] of m ? checks : []) { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); }
process.exitCode = fail ? 1 : 0;
