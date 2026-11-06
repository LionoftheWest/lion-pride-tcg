/**
 * EVT-2 B4 (evt2_special_power.sql + evt2_special_power_undo.sql): event and promo cards have full-art power
 * (Nathan 2026-11-05 Q3b). One DO block, always rolled back. items/EVT-2/SPEC.md v2.4 section 4.7.6: C13, C15-C19.
 *   node scripts/test-evt2-special-power.mjs [evt2_special_power.sql] [evt2_special_power_undo.sql]
 *   MUTATE=all (or MUTATE=<id>) runs each mutation and expects the named condition to FAIL.
 * The block first puts the 5 balance keys and balance_check back to the state before B4 (the live values of 2026-11-05,
 * section 4.7.1; the balance triggers are off for that one step only), so the result does not depend on the copy.
 *   C13 v1 CP, v2 Power (both EVT-2 abilities) and effect_tiers of event and promo = full_art (75; 420; 455; {cd 0.75, power 1.3})
 *   C15 a lucky_pull event card (base 2, cd 24 h) and a launch_party event card (base 20, cd 168 h): amount 2.6 and 20 (cap), cooldown 18 h and 126 h
 *   C16 the undo: no error; amount 2.0, cooldown 24 h; rarity_cp.promo 10; alias promo normal; promo Power (OoT ability) 129;
 *       v2_support.enabler_extra_stack = [full_art, event, gold, promo]; 4 balance_log rows by nathan
 *   C17 B4 writes 5 balance_log rows (effect_tiers, rarity_cp, stars, v2_asc, v2_support), by nathan, op update, old_value = before
 *   C18 effect_tiers event.power 5 is refused with the balance_check message
 *   C19 only the 6 paths and the 5 notes change: BAL PASS changed=6 notes=5 other=0
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const read = (f) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const B4 = read(args[0] || '../tcg-bot/supabase/evt2_special_power.sql');
const UNDO = read(args[1] || '../tcg-bot/supabase/evt2_special_power_undo.sql');
// balance_check before B4 (db/schema/functions/balance_check.sql at 456c0e3d, md5 c441652f39f6e29531939cc077b534e2)
const BASE_CHECK = String.raw`CREATE OR REPLACE FUNCTION public.balance_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_bad text;
begin
  if tg_op = 'DELETE' then
    raise exception 'balance: the key % is read by the game; change its value, do not delete it', old.key;
  end if;
  select string_agg(array_to_string(n.path, '.'), ', ') into v_bad from balance_leaves(new.value) n where n.num < 0;
  if v_bad is not null then raise exception 'balance %: negative number at %', new.key, v_bad; end if;
  if tg_op = 'UPDATE' then
    select string_agg(array_to_string(o.path, '.') || ' (' || o.typ || ')', ', ') into v_bad
      from balance_leaves(old.value) o
     where o.typ <> 'object' and o.typ <> 'array'
       and not (new.key = 'combat_v2' and o.path[1] = 'testers')   -- combat_v2_testers.sql: the tester ids may go
       and not exists (select 1 from balance_leaves(new.value) n where n.path = o.path and n.typ = o.typ);
    if v_bad is not null then
      raise exception 'balance %: the new value lost or changed the type of %', new.key, v_bad;
    end if;
    new.updated_at := now();
    new.updated_by := balance_who();
  end if;
  if new.key = 'stars' then
    select string_agg(r.key, ', ') into v_bad from jsonb_each(new.value) r
     where jsonb_typeof(r.value) <> 'array' or jsonb_array_length(r.value) <> 6
        or exists (select 1 from jsonb_array_elements(r.value) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric <= 0);
    if v_bad is not null then raise exception 'balance stars: % must be 6 numbers above 0 (0 to 5 stars)', v_bad; end if;
  end if;
  return new;
end $function$;`;
// The EVT-2 note texts (appended by B4 and by the undo): removed for the before state.
const NOTES = [...B4.matchAll(/position\('((?:[^']|'')*)' in coalesce\(note/g), ...UNDO.matchAll(/position\('((?:[^']|'')*)' in coalesce\(note/g)].map((m) => m[1]);
const WOW = `'[{"k":"apply","status":"slowed","chance":1},{"k":"apply","status":"chill","stacks":1,"chance":1},{"k":"apply","status":"weakened","value":0.2,"chance":1}]'::jsonb`;
const OOT = `'[{"k":"empower","v":0.3},{"k":"quicken","v":0.3}]'::jsonb`;
const pw = (r, role, b) => `(card_power_v2('${r}', 0, 1, 0, '{}', '${role}', ${b})->>'power')::numeric`;
const noMd5 = (s) => s.replace("if md5(replace(pg_get_functiondef('public.balance_check()'", "if false and md5(replace(pg_get_functiondef('public.balance_check()'");

const body = (b4, undo, opt = {}) => String.raw`do $t$
declare res jsonb := '[]'; got jsonb; r jsonb; ok boolean; n int; lg bigint; lg2 bigint; snap jsonb; aft jsonb; k text; nt text; err text := '';
  cr bigint; cp bigint; c_changed int := 0; c_notes int := 0; c_other int := 0; p text; paths text[] := array['effect_tiers.event', 'effect_tiers.promo', 'rarity_cp.promo', 'stars.promo', 'v2_asc.alias.promo', 'v2_support.enabler_extra_stack'];
  a_lp numeric; a_la numeric; h_lp numeric; h_la numeric;
begin
  perform set_config('tcg.skip_welcome', 'on', true);
  -- the state before B4 (4.7.1 before = live 2026-11-05), triggers off for this step only
  alter table balance disable trigger user;
  update balance set value = value - 'event' - 'promo' where key = 'effect_tiers';
  update balance set value = jsonb_set(value, '{promo}', '10') where key = 'rarity_cp';
  update balance set value = jsonb_set(value, '{promo}', value->'normal') where key = 'stars';
  update balance set value = jsonb_set(value, '{alias,promo}', '"normal"') where key = 'v2_asc';
  update balance set value = jsonb_set(value, '{enabler_extra_stack}', (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(value->'enabler_extra_stack') x where x <> '"promo"')) where key = 'v2_support';
  foreach nt in array array[${NOTES.map((x) => `'${x}'`).join(', ')}] loop
    update balance set note = replace(replace(note, ' ' || nt, ''), nt, '') where key in ('effect_tiers', 'rarity_cp', 'stars', 'v2_asc', 'v2_support');
  end loop;
  alter table balance enable trigger user;
  execute $m$${BASE_CHECK}$m$;
  res := res || jsonb_build_object('case', 'setup: the before state (4.7.1)', 'ok',
    (select value->'enabler_extra_stack' = '["full_art","event","gold"]'::jsonb from balance where key = 'v2_support')
    and (select not (value ? 'event') and not (value ? 'promo') from balance where key = 'effect_tiers')
    and (select (value->>'promo')::numeric = 10 from balance where key = 'rarity_cp')
    and (select value->'alias' = '{"event": "full_art", "promo": "normal"}'::jsonb from balance where key = 'v2_asc'));
  select jsonb_object_agg(key, jsonb_build_object('v', value, 'n', note)) into snap from balance;
  select coalesce(max(id), 0) into lg from balance_log;
  perform set_config('balance.by', 'tst_e2_admin', true);   -- B4 must set its own actor

  execute $m$${b4}$m$;   -- B4 (or its mutation)
  ${opt.post || ''}

  -- C17 the log
  select coalesce(jsonb_agg(jsonb_build_array(key, op, changed_by, old_value = snap->key->'v') order by key), '[]') into got from balance_log where id > lg;
  res := res || jsonb_build_object('case', 'C17 B4 writes 5 balance_log rows (effect_tiers, rarity_cp, stars, v2_asc, v2_support), by nathan, op update, old_value = before', 'ok',
    got = '[["effect_tiers","update","nathan",true],["rarity_cp","update","nathan",true],["stars","update","nathan",true],["v2_asc","update","nathan",true],["v2_support","update","nathan",true]]'::jsonb, 'got', got);

  -- C19 only these paths and notes
  select jsonb_object_agg(key, jsonb_build_object('v', value, 'n', note)) into aft from balance;
  foreach p in array paths loop
    if (aft->split_part(p, '.', 1)->'v') #> (string_to_array(p, '.'))[2:] is distinct from (snap->split_part(p, '.', 1)->'v') #> (string_to_array(p, '.'))[2:] then c_changed := c_changed + 1; end if;
  end loop;
  for k in select jsonb_object_keys(aft) loop
    if (aft->k->'n') is distinct from (snap->k->'n') then
      if k = any(array['effect_tiers', 'rarity_cp', 'stars', 'v2_asc', 'v2_support']) then c_notes := c_notes + 1; else c_other := c_other + 1; end if;
    end if;
    got := aft->k->'v';
    foreach p in array paths loop
      continue when split_part(p, '.', 1) <> k;
      got := case when (snap->k->'v') #> (string_to_array(p, '.'))[2:] is null then got #- (string_to_array(p, '.'))[2:]
                  else jsonb_set(got, (string_to_array(p, '.'))[2:], (snap->k->'v') #> (string_to_array(p, '.'))[2:]) end;
    end loop;
    if got is distinct from snap->k->'v' then c_other := c_other + 1; end if;
  end loop;
  res := res || jsonb_build_object('case', format('C19 only these keys and paths change: BAL %s changed=%s notes=%s other=%s (keys %s)',
    case when c_changed = 6 and c_notes = 5 and c_other = 0 then 'PASS' else 'FAIL' end, c_changed, c_notes, c_other, (select count(*) from balance)), 'ok', c_changed = 6 and c_notes = 5 and c_other = 0);

  -- C13 full-art power
  select jsonb_build_object('cp', jsonb_build_array(card_cp_exact('event', 0, 1), card_cp_exact('promo', 0, 1), card_cp_exact('full_art', 0, 1)),
    'wow', jsonb_build_array(${pw('event', 'controller', WOW)}, ${pw('promo', 'controller', WOW)}, ${pw('full_art', 'controller', WOW)}),
    'oot', jsonb_build_array(${pw('event', 'herald', OOT)}, ${pw('promo', 'herald', OOT)}, ${pw('full_art', 'herald', OOT)}),
    'tiers', (select jsonb_build_array(value->'event', value->'promo', value->'full_art') from balance where key = 'effect_tiers')) into got;
  res := res || jsonb_build_object('case', 'C13 full-art power: v1 CP, v2 Power WoW + OoT, effect_tiers of event and promo = full_art (75; 420; 455; {cd 0.75, power 1.3})', 'ok',
    got->'cp' = '[75, 75, 75]'::jsonb and got->'wow' = '[420, 420, 420]'::jsonb and got->'oot' = '[455, 455, 455]'::jsonb
    and got->'tiers' = '[{"cd": 0.75, "power": 1.3}, {"cd": 0.75, "power": 1.3}, {"cd": 0.75, "power": 1.3}]'::jsonb, 'got', got);

  -- C18 the limit
  begin
    update balance set value = jsonb_set(value, '{event,power}', '5') where key = 'effect_tiers';
    err := 'the update passed';
  exception when others then err := sqlerrm;
  end;
  res := res || jsonb_build_object('case', 'C18 effect_tiers event.power 5 is refused: balance effect_tiers: event needs power 0.5 to 3 and cd 0.1 to 2', 'ok',
    err = 'balance effect_tiers: event needs power 0.5 to 3 and cd 0.1 to 2', 'got', err);

  -- C15 the prank and boon result: fixture event cards (the 2 event card rows; the raider subject gets a lucky_pull effect in this block)
  select c.id into cr from cards c join subjects s on s.id = c.subject_id where s.key = 'launch-day-raider';
  select c.id into cp from cards c join subjects s on s.id = c.subject_id where s.key = 'launch-day-player';
  update subjects set effect = '{"primitive": "lucky_pull", "name": "It''s Dangerous to Go Alone", "base": {"amount": 2}, "desc": "x", "cooldown_h": 24}' where key = 'launch-day-raider';
  update subjects set effect = '{"primitive": "launch_party", "name": "Launch Party", "base": {"uses": 8, "amount": 20}, "desc": "x", "cooldown_h": 168}' where key = 'launch-day-player';
  insert into players (id, username, created_at) select 'tst_e2p_' || i, 'tst e2p ' || i, now() - interval '30 days' from generate_series(1, 4) i;
  insert into player_cards (player_id, card_id, quantity) values ('tst_e2p_1', cr, 1), ('tst_e2p_1', cp, 1), ('tst_e2p_3', cr, 1), ('tst_e2p_3', cp, 1);
  r := play_card_effect('tst_e2p_1', cr, 'tst_e2p_2');
  r := r || jsonb_build_object('b', play_card_effect('tst_e2p_1', cp, 'tst_e2p_2'));
  select amount into a_lp from card_plays where player_id = 'tst_e2p_1' and primitive = 'lucky_pull';
  select amount into a_la from card_plays where player_id = 'tst_e2p_1' and primitive = 'launch_party';
  select round(extract(epoch from ready_at - now()) / 3600, 3) into h_lp from card_effect_cooldowns c join cards x on x.subject_id = c.subject_id where c.player_id = 'tst_e2p_1' and x.id = cr;
  select round(extract(epoch from ready_at - now()) / 3600, 3) into h_la from card_effect_cooldowns c join cards x on x.subject_id = c.subject_id where c.player_id = 'tst_e2p_1' and x.id = cp;
  res := res || jsonb_build_object('case', 'C15 the prank result after B4: lucky_pull amount 2.6, cooldown 18 h; launch_party amount 20 (cap), cooldown 126 h', 'ok',
    a_lp = 2.6 and a_la = 20 and abs(h_lp - 18) <= 1.0 / 60 and abs(h_la - 126) <= 1.0 / 60, 'got', jsonb_build_array(a_lp, h_lp, a_la, h_la, r));

  -- C16 the undo, then the plays again (another fixture member)
  select coalesce(max(id), 0) into lg2 from balance_log;
  err := '';
  begin
    execute $m$${undo}$m$;
  exception when others then err := sqlerrm;
  end;
  r := play_card_effect('tst_e2p_3', cr, 'tst_e2p_4');
  r := r || jsonb_build_object('b', play_card_effect('tst_e2p_3', cp, 'tst_e2p_4'));
  select amount into a_lp from card_plays where player_id = 'tst_e2p_3' and primitive = 'lucky_pull';
  select amount into a_la from card_plays where player_id = 'tst_e2p_3' and primitive = 'launch_party';
  select round(extract(epoch from ready_at - now()) / 3600, 3) into h_lp from card_effect_cooldowns c join cards x on x.subject_id = c.subject_id where c.player_id = 'tst_e2p_3' and x.id = cr;
  select round(extract(epoch from ready_at - now()) / 3600, 3) into h_la from card_effect_cooldowns c join cards x on x.subject_id = c.subject_id where c.player_id = 'tst_e2p_3' and x.id = cp;
  select jsonb_build_object('err', err, 'lp', jsonb_build_array(a_lp, h_lp), 'la', jsonb_build_array(a_la, h_la),
    'rcp', (select value->'promo' from balance where key = 'rarity_cp'), 'alias', (select value->'alias'->'promo' from balance where key = 'v2_asc'),
    'oot_promo', ${pw('promo', 'herald', OOT)}, 'stack', (select value->'enabler_extra_stack' from balance where key = 'v2_support'),
    'log', (select coalesce(jsonb_agg(jsonb_build_array(key, changed_by) order by key), '[]') from balance_log where id > lg2)) into got;
  res := res || jsonb_build_object('case', 'C16 the undo: no error; lucky_pull 2.0 / 24 h; launch_party 20 / 168 h; rarity_cp.promo 10; alias promo normal; promo OoT Power 129; extra stack keeps promo; 4 log rows by nathan', 'ok',
    err = '' and a_lp = 2 and abs(h_lp - 24) <= 1.0 / 60 and a_la = 20 and abs(h_la - 168) <= 1.0 / 60
    and got->'rcp' = '10'::jsonb and got->'alias' = '"normal"'::jsonb and got->'oot_promo' = '129'::jsonb
    and got->'stack' = '["full_art","event","gold","promo"]'::jsonb
    and got->'log' = '[["effect_tiers","nathan"],["rarity_cp","nathan"],["stars","nathan"],["v2_asc","nathan"]]'::jsonb, 'got', got);
  if err <> '' then
    res := res || jsonb_build_object('case', 'C16 the refused undo applied nothing (rarity_cp.promo still 75)', 'ok', got->'rcp' = '75'::jsonb, 'got', got->'rcp');
  end if;

  raise exception 'RESULTS %', res;
end $t$;`;

const run = async (b4, undo, opt) => {
  const out = JSON.stringify(await q(body(b4, undo, opt)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1500) };
  return { results: JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')) };
};
const show = (r, tag) => {
  if (r.error) { console.log(`FAIL ${tag}NO RESULTS: ${r.error}`); return 1; }
  let f = 0;
  for (const x of r.results) { if (!x.ok) f++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${tag}${x.case}${x.ok || x.got === undefined ? '' : ` got ${JSON.stringify(x.got)}`}`); }
  return f;
};

const base = await run(B4, UNDO);
let fail = show(base, '');
console.log(fail ? `${fail} FAILED` : `PASS all ${base.results.length}`);

const cut = (s, from, to) => { if (s.split(from).length !== 2) throw new Error('mutation text not found once: ' + from.slice(0, 60)); return s.split(from).join(to); };
const etPart = B4.slice(B4.indexOf('update public.balance\n   set value = value ||'), B4.indexOf("where key = 'effect_tiers';") + "where key = 'effect_tiers';".length);
const rule = B4.slice(B4.indexOf('  -- EVT-2 B4 (Nathan 2026-11-05 Q3b): each effect_tiers'), B4.indexOf("  return new;\nend $function$;"));
const MUT = [
  ['C13a', 'C13', () => [noMd5(B4), UNDO, { post: `update balance set value = jsonb_set(value, '{alias,promo}', '"normal"') where key = 'v2_asc';` }]],
  ['C13b', 'C13', () => [noMd5(B4), UNDO, { post: `update balance set value = jsonb_set(value, '{event,power}', '1.0') where key = 'effect_tiers';` }]],
  ['C13c', 'C13', () => [noMd5(B4), UNDO, { post: `update balance set value = jsonb_set(value, '{alias,event}', '"normal"') where key = 'v2_asc';` }]],
  ['C15', 'C15', () => [noMd5(cut(B4, etPart, '')).replace(/if b->'effect_tiers'->'event'[\s\S]*?or b->'rarity_cp'->'promo'/, "if b->'rarity_cp'->'promo'"), UNDO]],
  ['C16', 'C16', () => [noMd5(B4), UNDO + `\nupdate public.balance set value = jsonb_set(value, '{enabler_extra_stack}', '["full_art","event","gold"]'::jsonb) where key = 'v2_support';\n`]],
  ['C17', 'C17', () => [noMd5(cut(B4, "select set_config('balance.by', 'nathan', true);", '')), UNDO]],
  ['C18', 'C18', () => [noMd5(cut(B4, rule, '')), UNDO]],
  ['C19', 'C19', () => [noMd5(B4), UNDO, { post: `perform set_config('balance.by', 'nathan', true); update balance set value = jsonb_set(value, '{event}', '80') where key = 'rarity_cp';` }]],
];
const want = process.env.MUTATE || '';
if (want) {
  let caught = 0, ran = 0;
  for (const [mid, cond, mk] of MUT) {
    if (want !== 'all' && want !== mid) continue;
    ran++;
    const [b4, undo, opt] = mk();
    const r = await run(b4, undo, opt || {});
    console.log(`--- mutation ${mid} (expect ${cond} to FAIL)`);
    show(r, `[${mid}] `);
    const hit = !r.error && r.results.some((x) => !x.ok && x.case.split(' ')[0] === cond);
    if (hit) caught++; else fail++;
    console.log(`mutation ${mid}: ${hit ? `caught (${cond} FAIL)` : `NOT CAUGHT (${r.error ? 'error' : cond + ' passed'})`}`);
  }
  console.log(`mutations caught ${caught}/${ran}`);
  const again = await run(B4, UNDO);
  const f2 = show(again, '[baseline again] ');
  fail += f2;
  console.log(f2 ? `baseline again: ${f2} FAILED` : `baseline again: PASS all ${again.results.length}`);
}
process.exitCode = fail ? 1 : 0;
