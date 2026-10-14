/**
 * Acceptance test for tcg-bot/supabase/d191_s1_origins_frame.sql and d191_pack_color_check.sql (UI-13 D-191, option A and the pack color check).
 * NO lasting change (one DO block; the final RAISE rolls it back), on the LOCAL copy only:
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-set-frames.mjs     must PASS (each file is applied twice)
 *   MUTATE=list | MUTATE=<name> | MUTATE=all                                               each mutation must FAIL
 * The block first puts balance back to the state before the files (s1 frame 'holo'), then applies d191_set_rewards.sql (the set_complete rule).
 * Invariants:
 *   A. claim_achievement('s1') pays 5 packs, "Origins Champion" and the frame 'holo:S1'; 'set:T93' pays 'holo:T93'.
 *   B. The plain 'holo' frame stays: badges.rainbow still pays 'holo' (balance); a member who claimed s1 before keeps the frame 'holo' (no grant here).
 *   C. Applying the files a second time changes nothing (balance value and admin_set_save text); a hand-made s1 frame stops the file (fails closed).
 *   D. admin_set_save refuses a near-grey, near-white and near-black pack color on a create and on a color change (LP400).
 *   E. The two live colors (S1, S2) and other colors with enough color pass; an edit of another field of a set with an old weak color still works.
 *   F. pack_color_ok: saturation >= 0.35 and lightness 0.25 to 0.75 (the edges).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const read = (f) => readFileSync(fileURLToPath(new URL(`../../tcg-bot/supabase/${f}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '').replace(/-- GUARD \([^)]*\)[\s\S]*?-- GUARD-END\n/, '');
const FILES = { rewards: 'd191_set_rewards.sql', frame: 'd191_s1_origins_frame.sql', color: 'd191_pack_color_check.sql' };
const src = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)]));
for (const [k, s] of Object.entries(src)) if (/do \$g\$/.test(s) || s.includes('$m$') || s.includes('$t$')) throw new Error(`${k}: the guard or a quote tag is in the text`);
const MUT = {
  s1_frame_not_changed: ['frame', '"holo:S1"', '"holo"'],
  s1_frame_wrong_set: ['frame', '"holo:S1"', '"holo:S2"'],
  frame_no_guard: ['frame', "in ('holo', 'holo:S1')", "in ('holo', 'holo:S1', 'gold')"],
  sat_zero: ['color', 's >= 0.35', 's >= 0.0'],
  sat_high: ['color', 's >= 0.35', 's >= 0.7'],
  light_low: ['color', 'l between 0.25 and 0.75', 'l between 0.0 and 0.75'],
  light_high: ['color', 'l between 0.25 and 0.75', 'l between 0.25 and 1.0'],
  grey_ok: ['color', 'if mx = mn then return false; end if;', ''],
  check_off: ['color', 'and not public.pack_color_ok(v_new.pack_color) then', 'and false then'],
  change_not_checked: ['color', '(v_create or v_new.pack_color is distinct from v_old.pack_color) and', 'v_create and'],
};
if (process.env.MUTATE === 'list') { console.log(Object.keys(MUT).join('\n')); process.exit(0); }
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name }, encoding: 'utf8' });
    const line = (r.stdout || '').trim().split(/\r?\n/).pop() || '';
    const caught = r.status !== 0 && /^(FAIL|ERROR) /.test(line);
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(22)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 140)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  if (!m || !src[m[0]].includes(m[1])) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  src[m[0]] = src[m[0]].replace(m[1], m[2]);
}
const P = 'tst_d191f_';
const body = String.raw`do $t$
declare res jsonb := '[]'; r1 jsonb; r2 jsonb; v0 jsonb; v1 jsonb; f0 text; f1 text; ok1 boolean; ok2 boolean; ok3 boolean; ok4 boolean; ok5 boolean; old card_sets;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  if exists (select 1 from card_sets where id in ('T93', 'T95', 'T96', 'T97') or code like 'TSTF%' or season >= 93) then raise exception 'the test sets exist already'; end if;
  insert into card_sets (id, name, code, pack_color, season, pullable) values ('T93', 'Test Set 93', 'TSTF93', '#112233', 93, true);
  -- The state before the files: s1 pays 'holo', no rule, the old title.
  alter table balance disable trigger balance_check;
  update balance set value = (value - 'set_complete') || jsonb_build_object('badges', jsonb_set(value->'badges', '{s1,title}', '"Season 1 Champion"')) where key = 'achievement_rewards';
  update balance set value = jsonb_set(value, '{badges,s1,frame}', '"holo"') where key = 'achievement_rewards';
  alter table balance enable trigger balance_check;
  insert into players (id, username, pack_balance) values ('${P}1', '${P}1', 0), ('${P}2', '${P}2', 0), ('${P}3', '${P}3', 0);
  insert into achievement_claims (player_id, key, packs, title, frame) values ('${P}3', 's1', 5, 'Season 1 Champion', 'holo');

  execute $m$${src.rewards}$m$;
  execute $m$${src.frame}$m$;
  select value into v0 from balance where key = 'achievement_rewards';
  execute $m$${src.frame}$m$;   -- C: the second application
  select value into v1 from balance where key = 'achievement_rewards';
  res := res || jsonb_build_object('case', 'C1 the S1 file a second time changes nothing', 'ok', v0 = v1 and v1 #>> '{badges,s1,frame}' = 'holo:S1', 'frame', v1 #>> '{badges,s1,frame}');

  r1 := claim_achievement('${P}1', 's1');
  res := res || jsonb_build_object('case', 'A1 s1 pays 5 packs, "Origins Champion" and the frame holo:S1', 'ok',
    coalesce((r1->>'ok')::boolean, false) and (r1->>'packs')::int = 5 and r1->>'title' = 'Origins Champion' and r1->>'frame' = 'holo:S1', 'r', r1);
  r2 := claim_achievement('${P}1', 'set:T93');
  res := res || jsonb_build_object('case', 'A2 set:T93 pays the frame holo:T93', 'ok', coalesce((r2->>'ok')::boolean, false) and r2->>'frame' = 'holo:T93', 'r', r2);
  res := res || jsonb_build_object('case', 'B1 the rainbow badge (Rainbow Pride) still pays the plain holo frame in balance', 'ok', v1 #>> '{badges,rainbow,frame}' = 'holo', 'rb', v1 #>> '{badges,rainbow}');
  res := res || jsonb_build_object('case', 'B2 a past s1 claimer keeps holo and gets no new frame (no grant here)', 'ok',
    (select count(*) from achievement_claims where player_id = '${P}3') = 1 and (select frame from achievement_claims where player_id = '${P}3' and key = 's1') = 'holo');
  res := res || jsonb_build_object('case', 'A3 the S1 title is "Origins Champion" in balance', 'ok', v1 #>> '{badges,s1,title}' = 'Origins Champion');

  -- a hand-made s1 frame stops the S1 file (it does not overwrite it).
  alter table balance disable trigger balance_check;
  update balance set value = jsonb_set(value, '{badges,s1,frame}', '"gold"') where key = 'achievement_rewards';
  alter table balance enable trigger balance_check;
  begin
    execute $m$${src.frame}$m$;
    ok1 := false;
  exception when others then ok1 := sqlerrm like 'd191_s1_origins_frame.sql:%';
  end;
  res := res || jsonb_build_object('case', 'C2 a hand-made s1 frame stops the S1 file and is not overwritten', 'ok', ok1 and (select value #>> '{badges,s1,frame}' from balance where key = 'achievement_rewards') = 'gold');

  execute $m$${src.color}$m$;
  select md5(replace(pg_get_functiondef('public.admin_set_save(text,jsonb,jsonb,text)'::regprocedure), chr(13), '')) into f0;
  execute $m$${src.color}$m$;   -- C: the second application
  select md5(replace(pg_get_functiondef('public.admin_set_save(text,jsonb,jsonb,text)'::regprocedure), chr(13), '')) into f1;
  res := res || jsonb_build_object('case', 'C3 the pack color file a second time gives the same admin_set_save text', 'ok', f0 = f1, 'md5', f1);

  -- D: refused colors on a create
  ok1 := false; ok2 := false; ok3 := false; ok4 := false;
  begin perform admin_set_save('${P}admin', jsonb_build_object('id', 'T95', 'name', 'Test Set 95', 'code', 'TSTF95', 'pack_color', '#999999', 'season', 95), null);
  exception when others then ok1 := sqlstate = 'LP400' and sqlerrm like '%needs more color%'; end;
  begin perform admin_set_save('${P}admin', jsonb_build_object('id', 'T95', 'name', 'Test Set 95', 'code', 'TSTF95', 'pack_color', '#fefefe', 'season', 95), null);
  exception when others then ok2 := sqlstate = 'LP400'; end;
  begin perform admin_set_save('${P}admin', jsonb_build_object('id', 'T95', 'name', 'Test Set 95', 'code', 'TSTF95', 'pack_color', '#0a0a0b', 'season', 95), null);
  exception when others then ok3 := sqlstate = 'LP400'; end;
  begin perform admin_set_save('${P}admin', jsonb_build_object('id', 'T95', 'name', 'Test Set 95', 'code', 'TSTF95', 'pack_color', '#8a7f80', 'season', 95), null);
  exception when others then ok4 := sqlstate = 'LP400'; end;   -- grey with a little red: saturation 0.06
  res := res || jsonb_build_object('case', 'D1 a create with a grey, near-white, near-black or near-grey pack color is refused (LP400)', 'ok', ok1 and ok2 and ok3 and ok4 and not exists (select 1 from card_sets where id = 'T95'),
    'ok1', ok1, 'ok2', ok2, 'ok3', ok3, 'ok4', ok4);

  -- E: accepted colors
  r1 := admin_set_save('${P}admin', jsonb_build_object('id', 'T96', 'name', 'Test Set 96', 'code', 'TSTF96', 'pack_color', '#ff8d4d', 'season', 96), null);
  r2 := admin_set_save('${P}admin', jsonb_build_object('id', 'T97', 'name', 'Test Set 97', 'code', 'TSTF97', 'pack_color', '#3366cc', 'season', 97), null);
  res := res || jsonb_build_object('case', 'E1 the two live colors #ff8d4d and #3366cc are accepted on a create', 'ok', (r1->>'created')::boolean and (r2->>'created')::boolean);
  select coalesce(bool_and(pack_color_ok(pack_color)), false) into ok5 from card_sets where id in ('S1', 'S2');
  res := res || jsonb_build_object('case', 'E2 the pack colors of the live sets S1 and S2 in this database pass', 'ok', ok5 and (select count(*) from card_sets where id in ('S1', 'S2')) = 2,
    'colors', (select jsonb_agg(pack_color order by id) from card_sets where id in ('S1', 'S2')));

  -- D2: a color change to grey on an existing set is refused
  select * into old from card_sets where id = 'T96';
  ok1 := false;
  begin perform admin_set_save('${P}admin', jsonb_build_object('id', 'T96', 'pack_color', '#888888'), admin_set_fields(old));
  exception when others then ok1 := sqlstate = 'LP400' and sqlerrm like '%needs more color%'; end;
  res := res || jsonb_build_object('case', 'D2 a change of an existing set to a grey color is refused and the color stays', 'ok', ok1 and (select pack_color from card_sets where id = 'T96') = '#ff8d4d');
  -- E3: a good color change works
  perform admin_set_save('${P}admin', jsonb_build_object('id', 'T96', 'pack_color', '#22aa66'), admin_set_fields(old));
  res := res || jsonb_build_object('case', 'E3 a change to #22aa66 works', 'ok', (select pack_color from card_sets where id = 'T96') = '#22aa66');
  -- E4: another field of a set with an old weak color (T93 #112233) is not blocked
  select * into old from card_sets where id = 'T93';
  perform admin_set_save('${P}admin', jsonb_build_object('id', 'T93', 'name', 'Test Set 93b'), admin_set_fields(old));
  res := res || jsonb_build_object('case', 'E4 a rename of a set with an old weak color is not blocked', 'ok', (select name from card_sets where id = 'T93') = 'Test Set 93b');

  -- F: the edges of pack_color_ok
  res := res || jsonb_build_object('case', 'F1 #ff8d4d, #3366cc, #22aa66, #FF8D4D pass; #999999, #ffffff, #000000, #8a7f80, a light, a dark, a bad text and null fail', 'ok',
    pack_color_ok('#ff8d4d') and pack_color_ok('#3366cc') and pack_color_ok('#22aa66') and pack_color_ok('#FF8D4D')
    and not pack_color_ok('#999999') and not pack_color_ok('#ffffff') and not pack_color_ok('#000000') and not pack_color_ok('#8a7f80')
    and not pack_color_ok('#f5f0f0') and not pack_color_ok('#1a0505') and not pack_color_ok('red') and not pack_color_ok(null));
  -- lightness 0.5: #a65959 has saturation 0.30 (fails), #b34d4d has 0.40 (passes). Lightness: #ff5555 is 0.67 (passes), #ff9999 is 0.80 (fails), #330000 is 0.10 (fails), #660000 is 0.20 (fails), #800000 is 0.25 (passes).
  res := res || jsonb_build_object('case', 'F2 saturation 0.30 fails, 0.40 passes; lightness 0.80 and 0.20 fail, 0.67 and 0.25 pass', 'ok',
    not pack_color_ok('#a65959') and pack_color_ok('#b34d4d') and not pack_color_ok('#ff9999') and not pack_color_ok('#660000') and pack_color_ok('#ff5555') and pack_color_ok('#800000'));

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'ERROR % %', sqlstate, sqlerrm;
end $t$;`;

const out = await q(body);
const m = JSON.stringify(out).match(/RESULTS (\[.*\])/);
if (!m) { console.log('ERROR ' + JSON.stringify(out).slice(0, 700)); process.exit(1); }
const rows = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
let bad = 0;
for (const x of rows) { if (!x.ok) bad += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok ? '' : ' ' + JSON.stringify(x).slice(0, 500)}`); }
console.log(bad ? `FAIL ${bad} of ${rows.length} cases (${rows.filter((x) => !x.ok).map((x) => x.case.split(' ')[0]).join(' ')})` : `PASS all ${rows.length} cases`);
process.exit(bad ? 1 : 0);
