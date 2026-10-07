/**
 * Acceptance test for tcg-bot/supabase/one_source_rules.sql. Rolled back, test members only (the result comes back
 * in the exception):
 *   node scripts/test-one-source-rules.mjs              the migration file, executed inside the block
 *   node scripts/test-one-source-rules.mjs --old        the database as it is (the baseline: it must FAIL before the migration)
 *   node scripts/test-one-source-rules.mjs --mutations  each mutation must make at least one case FAIL
 * Invariants:
 *   D1 game_day(t) is the America/Denver date of t, at every instant of the list (the DST changes included)
 *   D2 game_day_start(d) is midnight MT of d: game_day of it is d, and game_day of 1 microsecond before it is d - 1
 *   D3 dungeon_day() and shop_day() are game_day() (they call it: one rule)
 *   D4 the JS copies give the same answers as the SQL at every instant of the list: tcg-activity/src/mt-time.js
 *      (mtToday, mtDayStartISO, nextMtMidnightISO; the server and the client) and shared/game-day-golden.json
 *      (the bot test tcg-bot/src/store.test.ts checks utcToday against the same file)
 *   E1 for every effect card copy (each subject with an effect, 2 rarities, stars 0-5, stat points), the preview
 *      (effect_preview) equals what play_card_effect writes: amount, duration_s and ready_at = now + cooldown_h
 *   E2 the same with stat points OFF and other star rules and a cooldown knob of 1.5 (the per-star branch, the floor)
 *   E3 the same with tight hard limits (the clamp branch)
 *   E4 a card whose effect type is disabled: the preview says enabled false and the play is refused
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mtToday, mtDayStartISO, nextMtMidnightISO } from '../../tcg-activity/src/mt-time.js';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).text();
const OLD = process.argv.includes('--old');
const root = (f) => fileURLToPath(new URL(`../../${f}`, import.meta.url));
const src = readFileSync(root('tcg-bot/supabase/one_source_rules.sql'), 'utf8').replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (src.includes('$m$') || src.includes('$t$')) throw new Error('the migration text contains $m$ or $t$');
const GOLDEN = JSON.parse(readFileSync(root('shared/game-day-golden.json'), 'utf8'));
const AT = GOLDEN.cases.map((c) => c.at);

const MUTATIONS = {
  'D1 game_day uses the UTC day': ["  select (p_at at time zone 'America/Denver')::date;", "  select (p_at at time zone 'UTC')::date;"],
  'D2 game_day_start ignores DST (Phoenix)': ["  select p_day::timestamp at time zone 'America/Denver';", "  select p_day::timestamp at time zone 'America/Phoenix';"],
  'D3 dungeon_day keeps its own copy': ['as $function$ select public.game_day(); $function$;', "as $function$ select (now() at time zone 'America/Denver')::date; $function$;"],
  'E1 no hard limit on the amount': ['  if v_prim.max_amount is not null then v_amount := least(v_amount, v_prim.max_amount); end if;\n', ''],
  'E1 the amount rounded to 1 decimal': ["v_amount := round((p_effect->'base'->>'amount')::numeric * v_power, 2);", "v_amount := round((p_effect->'base'->>'amount')::numeric * v_power, 1);"],
  'E1 the star bonus even with stat points on': ["  if (v_cmb->>'on')::boolean then\n    v_pmul", "  if false then\n    v_pmul"],
  'E2 no cooldown knob': ['  v_cd    := v_cd * coalesce(v_scale, 1);\n', ''],
  'E2 no cooldown floor': ["v_cmul := greatest((v_ascset->>'cd_floor')::numeric, 1 - ", 'v_cmul := (0 + 1 - '],
  'E3 no hard limit on the duration': ['  if v_prim.max_duration_s is not null then v_dur := least(v_dur, v_prim.max_duration_s); end if;\n', ''],
  'E4 a disabled type says enabled': ["'enabled', coalesce(v_prim.enabled, false)", "'enabled', true"],
};

const P = 'tst_osr';
const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; ok boolean; bad jsonb; n int; i int; at timestamptz; d date; v jsonb; r jsonb; pv jsonb; pass text; tgt text;
  sql_days jsonb := '[]'; rc record; k int; m int;
begin
  ${mig ? `execute $m$${mig}$m$;` : '-- the database as it is'}

  -- D1-D3: the game day.
  begin
    bad := '[]';
    foreach at in array array[${AT.map((a) => `'${a}'::timestamptz`).join(', ')}] loop
      d := game_day(at);
      if d is distinct from (at at time zone 'America/Denver')::date then bad := bad || jsonb_build_object('at', at, 'got', d); end if;
      sql_days := sql_days || jsonb_build_object('at', at, 'day', d, 'start', game_day_start(d), 'next', game_day_start(d + 1));
    end loop;
    res := res || jsonb_build_object('case', 'D1 game_day is the Mountain Time date at every instant (DST included)', 'ok', jsonb_array_length(bad) = 0, 'bad', bad);
    bad := '[]';
    for d in select x::date from generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') x loop
      if game_day(game_day_start(d)) <> d or game_day(game_day_start(d) - interval '1 microsecond') <> d - 1
         or game_day_start(d) <> d::timestamp at time zone 'America/Denver' then bad := bad || to_jsonb(d); end if;
    end loop;
    res := res || jsonb_build_object('case', 'D2 game_day_start is midnight MT of every date 2026-2027', 'ok', jsonb_array_length(bad) = 0, 'bad', bad);
    ok := dungeon_day() = game_day() and shop_day() = game_day()
      and pg_get_functiondef('public.dungeon_day'::regproc) like '%game_day()%' and pg_get_functiondef('public.shop_day'::regproc) like '%game_day()%';
    res := res || jsonb_build_object('case', 'D3 dungeon_day and shop_day call game_day', 'ok', coalesce(ok, false));
    res := res || jsonb_build_object('case', 'SQLDAYS', 'ok', true, 'days', sql_days);
  exception when others then res := res || jsonb_build_object('case', 'D1-D3 the game day', 'ok', false, 'error', sqlerrm); end;

  -- E1-E4: the effect preview equals the play. Test members only; caps off, cooldowns cleared before each play.
  begin
    perform set_config('tcg.skip_welcome', 'on', true);
    perform set_config('tcg.effect_choice', '0', true);   -- a poll card plays its first question
    insert into players (id, username) values ('${P}', 'tst osr');
    update balance set value = '{"pair_per_day": 0, "send_per_day": 0, "gift_pack_per_week": 0, "prank_recv_per_day": 0, "timeout_recv_per_day": 0}' where key = 'card_effect_caps';
    -- Each subject with an effect: its lowest and its highest rarity card; stars and stat points vary by row.
    k := 0;
    for rc in select x.id, row_number() over (order by x.id) rn from (
        select distinct on (s.id, e.pick) c.id from subjects s join cards c on c.subject_id = s.id
          cross join (values (1), (2)) e(pick)
          where s.effect->>'primitive' is not null
          order by s.id, e.pick, case when e.pick = 1 then c.id else -c.id end) x loop
      insert into player_cards (player_id, card_id, quantity, ascension, stat_points)
        values ('${P}', rc.id, 1, rc.rn % 6, jsonb_build_object('potency', (rc.rn * 7) % 16, 'haste', (rc.rn * 5) % 16))
        on conflict do nothing;
    end loop;
    select count(*) into k from player_cards where player_id = '${P}';
    foreach pass in array array['E1 stat points on (live rules)', 'E2 stat points off, 0.3 per star, floor 0.35, knob 1.5', 'E3 tight hard limits', 'E4 one effect type disabled'] loop
      if pass like 'E2%' then
        update balance set value = value || '{"enabled": false}' where key = 'stat_points';
        update balance set value = '{"cd_floor": 0.35, "cd_per_star": 0.3, "power_per_star": 0.25}' where key = 'effect_ascension';
        update balance set value = '1.5' where key = 'effect_cooldown_scale';
      elsif pass like 'E3%' then
        update effect_primitives set max_amount = case when max_amount is null then null else 1.5 end,
                                     max_duration_s = case when max_duration_s is null then null else 45 end;
      elsif pass like 'E4%' then
        update effect_primitives set enabled = false where primitive = (select s.effect->>'primitive' from player_cards pc join cards cc on cc.id = pc.card_id
          join subjects s on s.id = cc.subject_id where pc.player_id = '${P}' order by pc.card_id limit 1);
      end if;
      pv := effect_preview('${P}');
      bad := '[]'; n := 0; m := 0; i := 0;
      for rc in select pc.card_id from player_cards pc where pc.player_id = '${P}' order by pc.card_id loop
        i := i + 1;
        tgt := '${P}_' || left(pass, 2) || '_' || i;
        insert into players (id, username) values (tgt, 'tst osr target');
        delete from card_effect_cooldowns where player_id = '${P}';
        v := pv->(rc.card_id::text);
        r := play_card_effect('${P}', rc.card_id, tgt);
        if v is null then bad := bad || jsonb_build_object('card', rc.card_id, 'why', 'no preview', 'play', r);
        elsif not (v->>'enabled')::boolean then
          m := m + 1;
          if r->>'error' is distinct from 'effect_disabled' then bad := bad || jsonb_build_object('card', rc.card_id, 'why', 'preview disabled, play not refused', 'play', r); end if;
        elsif not coalesce((r->>'ok')::boolean, false) then bad := bad || jsonb_build_object('card', rc.card_id, 'why', 'play refused', 'play', r);
        elsif (r->>'amount')::numeric is distinct from (v->>'amount')::numeric
           or (r->>'duration_s')::int is distinct from (v->>'duration_s')::int
           or (r->>'ready_at')::timestamptz is distinct from now() + make_interval(secs => (v->>'cooldown_h')::numeric * 3600) then
          bad := bad || jsonb_build_object('card', rc.card_id, 'why', 'numbers differ', 'preview', v, 'play', r);
        else n := n + 1; end if;
      end loop;
      ok := jsonb_array_length(bad) = 0 and n >= 50 and (pass not like 'E4%' or m >= 1);
      res := res || jsonb_build_object('case', pass || ': the preview equals the play for every card', 'ok', ok, 'cards', k, 'equal', n, 'disabled', m, 'bad', bad);
    end loop;
  exception when others then res := res || jsonb_build_object('case', 'E1-E4 the effect preview', 'ok', false, 'error', sqlerrm); end;

  raise exception 'RESULTS %', res;
exception when others then
  if sqlerrm like 'RESULTS%' then raise; end if;
  raise exception 'RESULTS %', res || jsonb_build_object('case', 'the block ran without an error', 'ok', false, 'error', sqlerrm);
end $t$;`;

const runOnce = async (mig) => {
  const out = await q(body(mig));
  let msg = out; try { msg = JSON.parse(out).message || out; } catch { /* the raw text */ }
  const m = msg.match(/RESULTS (\[.*\])/s);
  if (!m) return { results: null, raw: out.slice(0, 1500) };
  const results = JSON.parse(m[1]);
  // D4: the JS copies against the SQL answers of this run.
  const days = results.find((r) => r.case === 'SQLDAYS');
  if (days) {
    const bad = [];
    for (const [i, s] of days.days.entries()) {
      const at = new Date(s.at), g = GOLDEN.cases[i];
      const js = { day: mtToday(at), start: mtDayStartISO(at), next: nextMtMidnightISO(at) };
      const sql = { day: s.day, start: new Date(s.start).toISOString(), next: new Date(s.next).toISOString() };
      if (js.day !== sql.day || js.start !== sql.start || js.next !== sql.next || g.day !== sql.day || g.start !== sql.start)
        bad.push({ at: s.at, js, sql, golden: g });
    }
    results.splice(results.indexOf(days), 1, { case: `D4 the JS copies (mt-time.js) and shared/game-day-golden.json equal the SQL at ${days.days.length} instants`, ok: bad.length === 0 && days.days.length === AT.length, bad });
  } else results.push({ case: 'D4 the JS copies equal the SQL', ok: false, error: 'no SQL days' });
  return { results };
};

if (process.argv.includes('--mutations')) {
  let missed = 0;
  for (const [name, [a, b]] of Object.entries(MUTATIONS)) {
    if (src.split(a).length !== 2) { console.log(`FAIL mutation "${name}": the text to change is not in the file once`); missed++; continue; }
    const { results, raw } = await runOnce(src.replace(a, b));
    const failed = results ? results.filter((r) => !r.ok).map((r) => r.case) : ['no results: ' + raw];
    if (failed.length) console.log(`caught  "${name}": ${failed.length} case(s) fail, first: ${failed[0]}`);
    else { console.log(`FAIL mutation "${name}" was NOT caught`); missed++; }
  }
  console.log(missed ? `${missed} of ${Object.keys(MUTATIONS).length} mutations NOT caught` : `PASS all ${Object.keys(MUTATIONS).length} mutations caught`);
  process.exitCode = missed ? 1 : 0;
} else {
  const { results, raw } = await runOnce(OLD ? '' : src);
  if (!results) { console.log('FAIL NO RESULTS:', raw); process.exit(1); }
  let fail = 0;
  for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.equal != null ? ` (${r.equal} equal of ${r.cards})` : ''}${r.ok ? '' : '  ' + JSON.stringify(r).slice(0, 700)}`); }
  console.log(`${OLD ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
  process.exitCode = fail ? 1 : 0;
}
const left = await q(`select count(*) as n from players where id like '${P}%'`);
console.log('after (nothing stays):', left);
