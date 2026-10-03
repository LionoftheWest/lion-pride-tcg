/**
 * achievement_tracks.sql (2026-10-03): the tiered tracks, the switch rule, the tag set badges, the
 * Wish Granter capture and the retired old keys. Rolled back (the result comes back in the exception):
 *   node scripts/test-achievement-tracks.mjs [--old]
 * --old: the same cases WITHOUT the migration (the baseline must fail).
 * Each case runs in its own sub-block, so a missing function is a FAIL line, not a crash.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const OLD = process.argv.includes('--old');
const mig = OLD ? '' : readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/achievement_tracks.sql', import.meta.url)), 'utf8');
if (mig.includes('$m$') || mig.includes('$c$')) throw new Error('the migration must not contain $m$ or $c$');
const P = 'tst_at';
// One case: its body runs in a sub-block; an error is a failed case with the error text.
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; r2 jsonb; v jsonb; pb int; sb int; pb2 int; sb2 int; n int; m int; x bigint; y bigint; h bigint; d date := current_date - 40;
begin
  ${mig ? 'execute $m$' + mig + '$m$;' : ''}
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = '{"enabled": true, "users": []}'::jsonb where key = 'achievement_tracks';
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b'), ('${P}_c', 'tst c'), ('${P}_d', 'tst d'),
    ('${P}_e', 'tst e'), ('${P}_f', 'tst f'), ('${P}_g', 'tst g'), ('${P}_h', 'tst h');
${kase('Pack Opener 1,000 opened: 5 tiers pay 1+1+2+3+5 packs, 50+150+200+400+800 Shards, 3 titles, 2 frames', `
    insert into pack_ledger (player_id, amount, reason) select '${P}_a', -1, 'opened' from generate_series(1, 1000);
    select pack_balance, shard_balance into pb, sb from players where id = '${P}_a';
    v := achievement_view('${P}_a');
    r := claim_achievement_tiers('${P}_a', 'track:packs');
    select pack_balance - pb, shard_balance - sb into pb2, sb2 from players where id = '${P}_a';
    res := res || jsonb_build_object('case', 'Pack Opener 1,000 opened: 5 tiers pay 1+1+2+3+5 packs, 50+150+200+400+800 Shards, 3 titles, 2 frames', 'ok',
      (r->>'ok')::boolean and (r->>'packs')::int = 12 and (r->>'shards')::int = 1600 and pb2 = 12 and sb2 = 1600
      and r->'titles' = '["Pack Rat", "Rip King", "Pack Legend"]'::jsonb and r->'frames' = '["diamond:packs", "mythic:packs"]'::jsonb
      and (select count(*) from pack_ledger where player_id = '${P}_a' and reason = 'achievement') = 5
      and (select count(*) from shard_ledger where player_id = '${P}_a' and reason = 'milestone') = 5
      and (select title from achievement_claims where player_id = '${P}_a' and key = 'track:packs:4') = 'Rip King'
      and (select frame from achievement_claims where player_id = '${P}_a' and key = 'track:packs:5') = 'mythic:packs'
      and (v->>'ready')::int >= 5 and (select (tr->>'reached')::int from jsonb_array_elements(v->'tracks') tr where tr->>'key' = 'packs') = 5,
      'r', r);`)}
${kase('Mythic +N: 1,500 opened = 2 steps, 5 packs + 200 Shards each, title "Pack Legend +2"', `
    insert into pack_ledger (player_id, amount, reason) select '${P}_a', -1, 'opened' from generate_series(1, 500);
    select pack_balance, shard_balance into pb, sb from players where id = '${P}_a';
    r := claim_achievement_tiers('${P}_a', 'track:packs');
    select pack_balance - pb, shard_balance - sb into pb2, sb2 from players where id = '${P}_a';
    res := res || jsonb_build_object('case', 'Mythic +N: 1,500 opened = 2 steps, 5 packs + 200 Shards each, title "Pack Legend +2"', 'ok',
      (r->>'packs')::int = 10 and (r->>'shards')::int = 400 and pb2 = 10 and sb2 = 400 and r->'titles' = '["Pack Legend +1", "Pack Legend +2"]'::jsonb
      and r->'claimed' = '["track:packs:6", "track:packs:7"]'::jsonb, 'r', r);`)}
${kase('a repeated claim (one track, then all) pays nothing more and leaves one row per tier', `
    select pack_balance, shard_balance into pb, sb from players where id = '${P}_a';
    r := claim_achievement_tiers('${P}_a', 'track:packs');
    r2 := claim_achievement_tiers('${P}_a', null);
    select pack_balance - pb, shard_balance - sb into pb2, sb2 from players where id = '${P}_a';
    res := res || jsonb_build_object('case', 'a repeated claim (one track, then all) pays nothing more and leaves one row per tier', 'ok',
      r->>'error' = 'nothing' and pb2 = coalesce((r2->>'packs')::int, 0) and sb2 = coalesce((r2->>'shards')::int, 0)
      and not (r2->'claimed' ?| array['track:packs:1', 'track:packs:7'])
      and (select count(*) from achievement_claims where player_id = '${P}_a' and key like 'track:packs:%') = 7
      and (select count(*) from achievement_claims where player_id = '${P}_a' and key like 'track:packs:%') = (select count(distinct key) from achievement_claims where player_id = '${P}_a' and key like 'track:packs:%')
      and (achievement_view('${P}_a')->>'ready')::int = 0, 'r', jsonb_build_object('again', r, 'all', r2));`)}
${kase('a track that is not reached pays nothing (Collector with 3 cards)', `
    insert into player_cards (player_id, card_id, quantity) select '${P}_h', id, 1 from cards where in_draw_pool order by id limit 3;
    r := claim_achievement_tiers('${P}_h', 'track:collector');
    res := res || jsonb_build_object('case', 'a track that is not reached pays nothing (Collector with 3 cards)', 'ok',
      r->>'error' = 'nothing' and not exists (select 1 from achievement_claims where player_id = '${P}_h'), 'r', r);`)}
${kase('switch rule: own100 claimed proves Collector Bronze + Silver: 150 cards pay 0 + 0 + 2 packs, all Shards, the Gold title', `
    insert into achievement_claims (player_id, key, packs) values ('${P}_b', 'own100', 3), ('${P}_b', 'own25', 2);
    insert into player_cards (player_id, card_id, quantity) select '${P}_b', id, 1 from cards where in_draw_pool order by id limit 150;
    select pack_balance, shard_balance into pb, sb from players where id = '${P}_b';
    r := claim_achievement_tiers('${P}_b', 'track:collector');
    select pack_balance - pb, shard_balance - sb into pb2, sb2 from players where id = '${P}_b';
    res := res || jsonb_build_object('case', 'switch rule: own100 claimed proves Collector Bronze + Silver: 150 cards pay 0 + 0 + 2 packs, all Shards, the Gold title', 'ok',
      (r->>'packs')::int = 2 and pb2 = 2 and sb2 = 400 and r->'titles' = '["Collector"]'::jsonb
      and (select packs from achievement_claims where player_id = '${P}_b' and key = 'track:collector:1') = 0
      and (select packs from achievement_claims where player_id = '${P}_b' and key = 'track:collector:2') = 0
      and (select packs from achievement_claims where player_id = '${P}_b' and key = 'track:collector:3') = 2, 'r', r);`)}
${kase('switch rule: element keys add up (fire5 + light5 = 10 proves Bronze), rainbow alone (8) proves nothing', `
    insert into achievement_claims (player_id, key, packs) values ('${P}_c', 'fire5', 1), ('${P}_c', 'light5', 1), ('${P}_d', 'rainbow', 3);
    insert into player_cards (player_id, card_id, quantity)
      select '${P}_c', c.id, 1 from cards c join subjects s on s.id = c.subject_id where c.in_draw_pool and ach_has_element(s.tags) order by c.id limit 35;
    r := claim_achievement_tiers('${P}_c', 'track:elementalist');
    res := res || jsonb_build_object('case', 'switch rule: element keys add up (fire5 + light5 = 10 proves Bronze), rainbow alone (8) proves nothing', 'ok',
      (r->>'packs')::int = 1 and r->'claimed' = '["track:elementalist:1", "track:elementalist:2"]'::jsonb
      and (select packs from achievement_claims where player_id = '${P}_c' and key = 'track:elementalist:1') = 0
      and ach_tier_paid_before('${P}_d', 'elementalist', 1) is false and ach_tier_paid_before('${P}_c', 'elementalist', 2) is false, 'r', r);`)}
${kase('the 37 replaced old keys are retired while the tracks are on; a kept badge (dup2) still pays', `
    r := claim_achievement('${P}_e', 'own50', 2, null, 'silver');
    r2 := claim_achievement('${P}_e', 'dup2', 1, null, null);
    res := res || jsonb_build_object('case', 'the 37 replaced old keys are retired while the tracks are on; a kept badge (dup2) still pays', 'ok',
      r->>'error' = 'retired' and (r2->>'ok')::boolean and (select count(*) from achievement_switch_map) = 37
      and not exists (select 1 from achievement_claims where player_id = '${P}_e' and key = 'own50'), 'r', jsonb_build_object('own50', r, 'dup2', r2));`)}
${kase('tag set badge: every Community subject (any version, no Event card) pays ceil(n/10)+1 packs + "Community Master S1", once', `
    select count(distinct c.subject_id) into n from cards c join subjects s on s.id = c.subject_id
     where c.in_draw_pool and c.rarity::text <> 'event' and coalesce(c.season, 'Season 1') = 'Season 1' and 'origin:community' = any (s.tag_slugs);
    -- one version of each subject: the highest card id (often a rare version)
    insert into player_cards (player_id, card_id, quantity)
      select distinct on (c.subject_id) '${P}_f', c.id, 1 from cards c join subjects s on s.id = c.subject_id
       where c.in_draw_pool and coalesce(c.season, 'Season 1') = 'Season 1' and 'origin:community' = any (s.tag_slugs) order by c.subject_id, c.id desc limit greatest(n - 1, 0);
    r2 := claim_achievement_tiers('${P}_f', 'tag:S1:origin:community'); -- one subject missing: nothing
    insert into player_cards (player_id, card_id, quantity)
      select distinct on (c.subject_id) '${P}_f', c.id, 1 from cards c join subjects s on s.id = c.subject_id
       where c.in_draw_pool and coalesce(c.season, 'Season 1') = 'Season 1' and 'origin:community' = any (s.tag_slugs)
         and not exists (select 1 from player_cards pc join cards c2 on c2.id = pc.card_id where pc.player_id = '${P}_f' and c2.subject_id = c.subject_id)
       order by c.subject_id, c.id;
    select pack_balance into pb from players where id = '${P}_f';
    r := claim_achievement_tiers('${P}_f', 'tag:S1:origin:community');
    v := claim_achievement_tiers('${P}_f', 'tag:S1:origin:community');
    select pack_balance - pb into pb2 from players where id = '${P}_f';
    res := res || jsonb_build_object('case', 'tag set badge: every Community subject (any version, no Event card) pays ceil(n/10)+1 packs + "Community Master S1", once', 'ok',
      n > 0 and r2->>'error' = 'nothing' and (r->>'packs')::int = ceil(n / 10.0)::int + 1 and pb2 = ceil(n / 10.0)::int + 1
      and r->'titles' = '["Community Master S1"]'::jsonb and v->>'error' = 'nothing'
      and (select need from ach_tag_badges('${P}_f') b where b.key = 'tag:S1:origin:community') = n
      and not exists (select 1 from ach_tag_badges('${P}_f') b where b.tag not like 'origin:%' and b.tag not like 'type:%'), 'r', jsonb_build_object('n', n, 'r', r, 'early', r2));`)}
${kase('Wish Granter: a gift (x) and a trade (x back, y) on the wishlists count for each giver; the gift of y (not wished by h) does not', `
    select id into x from cards where in_draw_pool order by id limit 1;
    select id into y from cards where in_draw_pool order by id offset 1 limit 1;
    insert into wishlists (player_id, slot, card_id) values ('${P}_h', 1, x), ('${P}_g', 1, y);
    insert into gift_claims (player_id, kind, title, amount, reason, from_id, card_id) values ('${P}_h', 'card', 'gift', 1, 'member_gift', '${P}_g', x);
    insert into gift_claims (player_id, kind, title, amount, reason, from_id, card_id) values ('${P}_h', 'card', 'gift', 1, 'member_gift', '${P}_g', y);
    insert into trade_offers (from_id, to_id, offer_card_id, request_card_id, status) values ('${P}_h', '${P}_g', y, x, 'pending') returning id into h;
    update trade_offers set status = 'accepted', resolved_at = now() where id = h;
    res := res || jsonb_build_object('case', 'Wish Granter: a gift (x) and a trade (x back, y) on the wishlists count for each giver; the gift of y (not wished by h) does not', 'ok',
      (ach_track_values('${P}_g')->>'wish')::int = 2 and (ach_track_values('${P}_h')->>'wish')::int = 1
      and (select count(*) from wish_grants where giver_id like '${P}%') = 3
      and (ach_track_values('${P}_g')->>'trader')::int = 1 and (ach_track_values('${P}_h')->>'trader')::int = 1,
      'r', jsonb_build_object('g', ach_track_values('${P}_g')->'wish', 'h', ach_track_values('${P}_h')->'wish', 'trader', ach_track_values('${P}_g')->'trader'));`)}
${kase('On a Roll = the best check-in run; Podium = top 3 of a settled raid; joined = own committed cards (a credit row alone is not a raid joined)', `
    insert into daily_claims (player_id, day, task, amount) values ('${P}_g', d, 'checkin', 1), ('${P}_g', d + 1, 'checkin', 1), ('${P}_g', d + 2, 'checkin', 1), ('${P}_g', d + 5, 'checkin', 1);
    insert into hunts (name, tier, weak_points, hp_max, hp_remaining, closes_at, status, settled_at)
      values ('tst hunt', 'Normal', '[]', 1000, 0, now() - interval '1 day', 'defeated', now()) returning id into h;
    select id into x from cards where in_draw_pool order by id limit 1;
    select id into y from cards where in_draw_pool order by id offset 1 limit 1;
    insert into hunt_hits (hunt_id, player_id, card_id, hit_date, damage) values
      (h, '${P}_a', x, d, 500), (h, '${P}_b', x, d, 400), (h, '${P}_c', x, d, 300), (h, '${P}_g', x, d, 200), (h, '${P}_g', y, d, 50);
    -- g fought (committed cards); c has only a hunt_hits row (like a Raid Crasher credit)
    insert into hunt_card_hp (hunt_id, player_id, card_id, hit_date, hp_remaining, max_hp) values (h, '${P}_g', x, d, 10, 60), (h, '${P}_g', y, d, 10, 60);
    res := res || jsonb_build_object('case', 'On a Roll = the best check-in run; Podium = top 3 of a settled raid; joined = own committed cards (a credit row alone is not a raid joined)', 'ok',
      (ach_track_values('${P}_g')->>'raider')::int = 1 and (ach_track_values('${P}_c')->>'raider')::int = 0 and (ach_track_values('${P}_c')->>'slayer')::int = 0 and
      (ach_track_values('${P}_g')->>'streak')::int = 3 and (ach_track_values('${P}_c')->>'podium')::int = 1 and (ach_track_values('${P}_g')->>'podium')::int = 0
      and (ach_track_values('${P}_g')->>'slayer')::int = 1 and (ach_track_values('${P}_g')->>'bighit')::int = 200 and (ach_track_values('${P}_g')->>'heavy')::int = 250,
      'r', ach_track_values('${P}_g'));`)}
${kase('flag OFF: tier claims refused, the view is off, the old keys pay as before', `
    update settings set value = '{"enabled": false, "users": []}'::jsonb where key = 'achievement_tracks';
    r := claim_achievement_tiers('${P}_a', null);
    r2 := claim_achievement('${P}_e', 'own50', 2, null, 'silver');
    v := achievement_view('${P}_a');
    update settings set value = '{"enabled": false, "users": ["${P}_h"]}'::jsonb where key = 'achievement_tracks';
    res := res || jsonb_build_object('case', 'flag OFF: tier claims refused, the view is off, the old keys pay as before', 'ok',
      r->>'error' = 'disabled' and (r2->>'ok')::boolean and v = '{"enabled": false}'::jsonb
      and ach_tracks_on('${P}_h') and not ach_tracks_on('${P}_a'), 'r', jsonb_build_object('tiers', r, 'own50', r2));`)}
  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 900)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x.r).slice(0, 400)}`); }
  console.log(bad ? `${bad} of ${rows.length} FAILED${OLD ? ' (baseline without the migration: expected)' : ''}` : `PASS all ${rows.length}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
