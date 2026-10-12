/**
 * achievement_view_old_paid.sql (2026-10-11, D-183): achievement_view tells per track which tiers an old achievement already paid
 * (old_paid = tiers 1..old_paid), and claim_achievement_tiers pays 0 packs for exactly those tiers. Rolled back:
 *   node scripts/test-achievement-old-paid.mjs [--old]
 * Default: runs on the CURRENT functions (the migration is applied by apply-sql.mjs first; test-all-local.mjs runs it after).
 * Baseline (must FAIL): run it on a copy without the migration.
 * Every case runs in its own sub-block, so a missing field is a FAIL line, not a crash.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const P = 'tst_op';
const kase = (name, body) => `
  begin
${body}
  exception when others then res := res || jsonb_build_object('case', ${`$c$${name}$c$`}, 'ok', false, 'r', sqlerrm);
  end;`;
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; v jsonb; tr jsonb; pb int; pb2 int; agree boolean; n int;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  update settings set value = '{"enabled": true, "users": []}'::jsonb where key = 'achievement_tracks';
  insert into players (id, username) values ('${P}_a', 'tst a'), ('${P}_b', 'tst b'), ('${P}_c', 'tst c');
${kase('no claimed old key: old_paid is 0 on every track', `
    v := achievement_view('${P}_a');
    res := res || jsonb_build_object('case', 'no claimed old key: old_paid is 0 on every track', 'ok',
      (select count(*) from jsonb_array_elements(v->'tracks') x) > 10
      and not exists (select 1 from jsonb_array_elements(v->'tracks') x where not (x ? 'old_paid') or (x->>'old_paid')::int <> 0), 'r', v->'tracks'->0);`)}
${kase('own100 + own25 claimed: Collector old_paid = 2, and claim pays 0 packs for tiers 1..2 only (the view and the claim agree)', `
    insert into achievement_claims (player_id, key, packs) values ('${P}_b', 'own100', 3), ('${P}_b', 'own25', 2);
    insert into player_cards (player_id, card_id, quantity) select '${P}_b', id, 1 from cards where in_draw_pool order by id limit 150;
    v := achievement_view('${P}_b');
    select x into tr from jsonb_array_elements(v->'tracks') x where x->>'key' = 'collector';
    select pack_balance into pb from players where id = '${P}_b';
    r := claim_achievement_tiers('${P}_b', 'track:collector');
    select pack_balance - pb into pb2 from players where id = '${P}_b';
    res := res || jsonb_build_object('case', 'own100 + own25 claimed: Collector old_paid = 2, and claim pays 0 packs for tiers 1..2 only (the view and the claim agree)', 'ok',
      (tr->>'old_paid')::int = 2 and (tr->>'reached')::int = 3
      and (select bool_and(((select packs from achievement_claims where player_id = '${P}_b' and key = 'track:collector:' || g) = 0) = (g <= (tr->>'old_paid')::int)) from generate_series(1, 3) g)
      and pb2 = 2, 'r', jsonb_build_object('track', tr, 'claim', r));`)}
${kase('the view and ach_tier_paid_before agree for every track and tier 1..5 (own100 member and element-key member)', `
    insert into achievement_claims (player_id, key, packs) values ('${P}_c', 'fire5', 1), ('${P}_c', 'light5', 1), ('${P}_c', 'rainbow', 3);
    agree := true;
    for n in 1..2 loop
      v := achievement_view(case n when 1 then '${P}_b' else '${P}_c' end);
      agree := agree and not exists (
        select 1 from jsonb_array_elements(v->'tracks') x, generate_series(1, 5) g
         where ((g <= (x->>'old_paid')::int) <> ach_tier_paid_before(case n when 1 then '${P}_b' else '${P}_c' end, x->>'key', g)));
    end loop;
    v := achievement_view('${P}_c');
    res := res || jsonb_build_object('case', 'the view and ach_tier_paid_before agree for every track and tier 1..5 (own100 member and element-key member)', 'ok',
      agree and (select (x->>'old_paid')::int from jsonb_array_elements(v->'tracks') x where x->>'key' = 'elementalist') = 1, 'r', v->'tracks');`)}
${kase('flag OFF: the view stays {"enabled": false}', `
    update settings set value = '{"enabled": false, "users": []}'::jsonb where key = 'achievement_tracks';
    res := res || jsonb_build_object('case', 'flag OFF: the view stays enabled false', 'ok', achievement_view('${P}_b') = '{"enabled": false}'::jsonb, 'r', achievement_view('${P}_b'));`)}
  raise exception 'RESULTS %', res;
end $t$;`;
const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', JSON.stringify(out).slice(0, 900)); process.exitCode = 1; }
else {
  const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  let bad = 0;
  for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x.r).slice(0, 400)}`); }
  console.log(bad ? `${bad} of ${rows.length} FAILED` : `PASS all ${rows.length}`);
  if (bad) process.exitCode = 1;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', JSON.stringify(left));
