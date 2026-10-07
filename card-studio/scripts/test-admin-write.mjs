/**
 * admin_write.sql: the Admin view write functions. Each writer applies its change, writes its admin_actions row in the
 * same transaction, refuses a stale before value (LP409), and an undo puts the before value back with undo_of (a second
 * undo and an undo after a later change are refused). The API roles cannot call them. Fake members, rolled back.
 *   node scripts/test-admin-write.mjs [path/to/admin_write.sql] [--mutate] [--old]
 * With a file it applies the file inside the rolled-back block (two times: it must be idempotent). Without a file it
 * tests the database as it is. --old drops the functions first (the state before the migration): the test must FAIL.
 * --mutate also runs each mutation of the file below and expects the test to FAIL for each one.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const MIG = file ? readFileSync(file, 'utf8').replace(/notify pgrst[^\n]*\n/g, '') : '';
const OLD = args.includes('--old');

const A = 'tst_aw_a', B = 'tst_aw_b', WHO = 'studio:tst_aw';
const FNS = ['admin_write_begin(text,text)', 'admin_stale(text,jsonb,jsonb)', 'admin_is_member_list(text,text[],jsonb)', 'admin_check_pulls(jsonb)',
  'admin_balance_set(text,text,text[],jsonb,jsonb,text,bigint)', 'admin_setting_set(text,text,text[],jsonb,jsonb,text,bigint)',
  'admin_setting_member(text,text,text[],text,boolean,text,bigint)', 'admin_member_packs(text,text,integer,integer,text,bigint)',
  'admin_member_shards(text,text,integer,integer,text,bigint)', 'admin_member_card(text,text,bigint,integer,integer,text,bigint)', 'admin_undo(text,bigint,text)'];

const body = (mig) => String.raw`do $t$
declare res jsonb := '[]'; got jsonb; r jsonb; v0 int; c1 bigint; c2 bigint; id1 bigint; id2 bigint; st text; ok boolean; n int; pulls0 jsonb; pulls1 jsonb; f text;
begin
  ${OLD ? `foreach f in array array[${FNS.map((x) => `'public.${x}'`).join(', ')}] loop
    execute format('drop function if exists %s cascade', f); end loop;` : ''}
  ${mig ? `execute $m$${mig}$m$;\n  execute $m$${mig}$m$; -- two times: idempotent` : '-- the database as it is'}
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${A}', 'tst aw a'), ('${B}', 'tst aw b');
  update players set pack_balance = 0, shard_balance = 0 where id in ('${A}', '${B}');
  select id into c1 from cards where rarity = 'normal' order by id limit 1;
  select id into c2 from cards where rarity = 'normal' order by id offset 1 limit 1;

  -- B. balance ------------------------------------------------------------------------------------
  v0 := (balance_get('round_cap') #>> '{}')::int;
  r := admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0), to_jsonb(v0 + 1), 'tst raise the cap');
  id1 := (r->>'action_id')::bigint;
  select jsonb_build_array(actor, action, target_kind, target_id, before, after, reason, source, undo_of) into got from admin_actions where id = id1;
  res := res || jsonb_build_object('case', 'B1 balance_set applies and logs the action (path, before, after)', 'ok',
    (balance_get('round_cap') #>> '{}')::int = v0 + 1 and got = jsonb_build_array('${WHO}', 'balance_set', 'balance', 'round_cap',
      jsonb_build_object('path', '[]'::jsonb, 'value', v0), jsonb_build_object('path', '[]'::jsonb, 'value', v0 + 1), 'tst raise the cap', 'studio', null), 'got', got);
  res := res || jsonb_build_object('case', 'B1 balance_log names the admin', 'ok',
    (select changed_by from balance_log where key = 'round_cap' order by id desc limit 1) = '${WHO}');
  st := null; begin perform admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0), to_jsonb(v0 + 5), 'tst stale'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B2 a stale before is refused (LP409) and nothing changes', 'ok', st = 'LP409' and (balance_get('round_cap') #>> '{}')::int = v0 + 1, 'got', st);
  st := null; begin perform admin_balance_set('${WHO}', 'combat', '{crit}', balance_get('combat')->'crit', '"x"', 'tst type'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B3 a type change is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  st := null; begin perform admin_balance_set('${WHO}', 'card_hp', '{}', balance_get('card_hp'), '{"floor": 60}', 'tst shape'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B4 a lost leaf is refused by balance_check', 'ok', st is not null and balance_get('card_hp') ? 'per_cp', 'got', st);
  pulls0 := balance_get('pulls');
  st := null; begin perform admin_balance_set('${WHO}', 'pulls', '{rates,gold}', pulls0 #> '{rates,gold}', to_jsonb((pulls0 #>> '{rates,gold}')::numeric + 0.0001), 'tst pulls'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B5 pull rates that do not add up to 1 are refused (LP400)', 'ok', st = 'LP400' and balance_get('pulls') = pulls0, 'got', st);
  pulls1 := jsonb_set(jsonb_set(pulls0, '{rates,gold}', to_jsonb((pulls0 #>> '{rates,gold}')::numeric + 0.0001)), '{rates,normal}', to_jsonb((pulls0 #>> '{rates,normal}')::numeric - 0.0001));
  r := admin_balance_set('${WHO}', 'pulls', '{}', pulls0, pulls1, 'tst pulls ok');
  res := res || jsonb_build_object('case', 'B5 pull rates that add up to 1 apply', 'ok', balance_get('pulls') = pulls1);
  r := admin_undo('${WHO}', id1, 'tst undo');
  id2 := (r->>'action_id')::bigint;
  res := res || jsonb_build_object('case', 'B6 undo puts the before value back and logs undo_of', 'ok', (balance_get('round_cap') #>> '{}')::int = v0
    and (select undo_of = id1 and action = 'balance_set' and (before->>'value')::int = v0 + 1 and (after->>'value')::int = v0 from admin_actions where id = id2));
  st := null; begin perform admin_undo('${WHO}', id1, 'tst undo again'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B6 a second undo is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  r := admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0), to_jsonb(v0 + 1), 'tst the same change again');  -- the value matches the first action again
  st := null; begin perform admin_undo('${WHO}', id1, 'tst undo again'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B6 a second undo is refused (LP409) also when the value matches again', 'ok', st = 'LP409' and (balance_get('round_cap') #>> '{}')::int = v0 + 1, 'got', st);
  r := admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0 + 1), to_jsonb(v0), 'tst back');
  r := admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0), to_jsonb(v0 + 2), 'tst again');
  id1 := (r->>'action_id')::bigint;
  r := admin_balance_set('${WHO}', 'round_cap', '{}', to_jsonb(v0 + 2), to_jsonb(v0 + 3), 'tst later change');
  st := null; begin perform admin_undo('${WHO}', id1, 'tst undo old'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'B7 an undo after a later change is refused (LP409)', 'ok', st = 'LP409' and (balance_get('round_cap') #>> '{}')::int = v0 + 3, 'got', st);

  -- S. settings -----------------------------------------------------------------------------------
  insert into settings (key, value) values ('tst_aw', '{"enabled": false, "from": "2026-10-04", "at": "2026-10-15T06:00:00Z", "users": [], "box": {"x": 1}}');
  r := admin_setting_set('${WHO}', 'tst_aw', '{enabled}', 'false', 'true', 'tst flag on');
  res := res || jsonb_build_object('case', 'S1 setting_set applies, logs the action and settings_log names the admin', 'ok',
    (select value->'enabled' from settings where key = 'tst_aw') = 'true'
    and (select action = 'setting_set' and target_id = 'tst_aw' from admin_actions where id = (r->>'action_id')::bigint)
    and (select changed_by from settings_log where key = 'tst_aw' order by id desc limit 1) = '${WHO}');
  st := null; begin perform admin_setting_set('${WHO}', 'tst_aw', '{enabled}', 'false', 'false', 'tst stale'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S1 a stale before is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  st := null; begin perform admin_setting_set('${WHO}', 'tst_aw', '{from}', '"2026-10-04"', '"2026-13-01"', 'tst date'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S2 a bad date is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  st := null; begin perform admin_setting_set('${WHO}', 'tst_aw', '{at}', '"2026-10-15T06:00:00Z"', '"tomorrow"', 'tst time'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S2 a bad time is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  r := admin_setting_set('${WHO}', 'tst_aw', '{at}', '"2026-10-15T06:00:00Z"', '"2026-10-20T06:00:00Z"', 'tst time ok');
  res := res || jsonb_build_object('case', 'S2 a good time applies', 'ok', (select value->>'at' from settings where key = 'tst_aw') = '2026-10-20T06:00:00Z');
  st := null; begin perform admin_setting_set('${WHO}', 'tst_aw', '{users}', '[]', '["${A}"]', 'tst list'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S3 a member list cannot be set as a value (LP400)', 'ok', st = 'LP400', 'got', st);
  st := null; begin perform admin_setting_set('${WHO}', 'tst_aw', '{box}', '{"x": 1}', '{"x": 2}', 'tst object'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S3 a whole group of values cannot be set (LP400)', 'ok', st = 'LP400', 'got', st);
  r := admin_setting_member('${WHO}', 'tst_aw', '{users}', '${A}', true, 'tst add');
  res := res || jsonb_build_object('case', 'S4 setting_member adds a member and logs it', 'ok', (select value->'users' from settings where key = 'tst_aw') = '["${A}"]'
    and (select action = 'setting_member' and (after->>'in_list')::boolean and after->>'member' = '${A}' from admin_actions where id = (r->>'action_id')::bigint));
  st := null; begin perform admin_setting_member('${WHO}', 'tst_aw', '{users}', '${A}', true, 'tst add again'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S4 adding a member who is in the list is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  st := null; begin perform admin_setting_member('${WHO}', 'tst_aw', '{users}', 'tst_aw_nobody', true, 'tst unknown'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'S4 adding an unknown member is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  r := admin_setting_member('${WHO}', 'tst_aw', '{users}', '${A}', false, 'tst remove');
  id1 := (r->>'action_id')::bigint;
  r := admin_undo('${WHO}', id1, 'tst undo remove');
  res := res || jsonb_build_object('case', 'S4 remove, then the undo adds the member back with undo_of', 'ok', (select value->'users' from settings where key = 'tst_aw') = '["${A}"]'
    and (select undo_of from admin_actions where id = (r->>'action_id')::bigint) = id1);

  -- M. member balances ------------------------------------------------------------------------------
  r := admin_member_packs('${WHO}', '${A}', 5, 0, 'tst grant');
  id1 := (r->>'action_id')::bigint;
  select jsonb_agg(jsonb_build_array(amount, reason, ref_kind, ref_id = id1::text, granted_by) order by id) into got from pack_ledger where player_id = '${A}';
  res := res || jsonb_build_object('case', 'M1 member_packs grants through grant_packs: reason admin, ref the action', 'ok',
    (select pack_balance from players where id = '${A}') = 5 and got = '[[5, "admin", "admin_action", true, null]]'::jsonb
    and (select action = 'member_packs' and target_id = '${A}' and before = '{"packs": 0}' and after = '{"packs": 5, "amount": 5}' from admin_actions where id = id1), 'got', got);
  st := null; begin perform admin_member_packs('${WHO}', '${A}', 1, 0, 'tst stale'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M1 a stale pack balance is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  st := null; begin perform admin_member_packs('${WHO}', '${A}', -6, 5, 'tst below 0'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M1 a balance below 0 is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  r := admin_undo('${WHO}', id1, 'tst undo grant');
  res := res || jsonb_build_object('case', 'M1 the undo takes the packs back (a -5 admin row) with undo_of', 'ok', (select pack_balance from players where id = '${A}') = 0
    and (select sum(amount) from pack_ledger where player_id = '${A}') = 0 and (select undo_of from admin_actions where id = (r->>'action_id')::bigint) = id1);
  r := admin_member_shards('${WHO}', '${A}', 300, 0, 'tst shards');
  id1 := (r->>'action_id')::bigint;
  res := res || jsonb_build_object('case', 'M2 member_shards grants through grant_shards: reason admin, ref the action', 'ok', (select shard_balance from players where id = '${A}') = 300
    and (select count(*) from shard_ledger where player_id = '${A}' and amount = 300 and reason = 'admin' and ref_kind = 'admin_action' and ref_id = id1::text) = 1);
  st := null; begin perform admin_member_shards('${WHO}', '${A}', 10, 0, 'tst stale'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M2 a stale Shards balance is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  perform grant_shards('${A}', -100, 'shop', 'tst', 'x');  -- the member spends: the undo must be refused
  st := null; begin perform admin_undo('${WHO}', id1, 'tst undo shards'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M2 an undo after the balance changed is refused (LP409)', 'ok', st = 'LP409' and (select shard_balance from players where id = '${A}') = 200, 'got', st);
  r := admin_member_card('${WHO}', '${A}', c1, 2, 0, 'tst give');
  id1 := (r->>'action_id')::bigint;
  res := res || jsonb_build_object('case', 'M3 member_card gives copies through card_move: reason admin, ref the action, first_source admin', 'ok',
    (select quantity = 2 and first_source = 'admin' from player_cards where player_id = '${A}' and card_id = c1)
    and (select count(*) from card_ledger where player_id = '${A}' and card_id = c1 and amount = 2 and reason = 'admin' and ref_kind = 'admin_action' and ref_id = id1::text) = 1);
  st := null; begin perform admin_member_card('${WHO}', '${A}', c1, -3, 2, 'tst too many'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M3 removing more copies than the member has is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  insert into auctions (seller_id, card_id, ends_at) values ('${A}', c1, now() + interval '1 day');  -- holds 1 of the 2 copies
  st := null; begin perform admin_member_card('${WHO}', '${A}', c1, -2, 2, 'tst reserved'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M3 removing copies held by an auction is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  delete from auctions where seller_id = '${A}';
  r := admin_member_card('${WHO}', '${A}', c1, -1, 2, 'tst remove');
  res := res || jsonb_build_object('case', 'M3 a removal applies', 'ok', (select quantity from player_cards where player_id = '${A}' and card_id = c1) = 1);
  update player_cards set ascension = 1 where player_id = '${A}' and card_id = c1;
  st := null; begin perform admin_member_card('${WHO}', '${A}', c1, -1, 1, 'tst stars'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M3 the last copy of a card with stars is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  st := null; begin perform admin_member_card('${WHO}', '${A}', c1, 1, 2, 'tst stale'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'M3 a stale copy count is refused (LP409)', 'ok', st = 'LP409', 'got', st);
  r := admin_member_card('${WHO}', '${B}', c2, 1, 0, 'tst give b');
  id1 := (r->>'action_id')::bigint;
  r := admin_undo('${WHO}', id1, 'tst undo give');
  res := res || jsonb_build_object('case', 'M3 the undo of a give removes the copy (the row goes) with undo_of', 'ok',
    not exists (select 1 from player_cards where player_id = '${B}' and card_id = c2) and (select undo_of from admin_actions where id = (r->>'action_id')::bigint) = id1);
  res := res || jsonb_build_object('case', 'M4 the test members: ledgers = balances', 'ok',
    (select bool_and(p.pack_balance = coalesce((select sum(amount) from pack_ledger l where l.player_id = p.id), 0)
                 and p.shard_balance = coalesce((select sum(amount) from shard_ledger l where l.player_id = p.id), 0)) from players p where p.id in ('${A}', '${B}'))
    and not exists (select 1 from player_cards pc where pc.player_id in ('${A}', '${B}')
                     and pc.quantity <> (select sum(amount) from card_ledger c where c.player_id = pc.player_id and c.card_id = pc.card_id)));

  -- R. the request and the undo rules ---------------------------------------------------------------
  st := null; begin perform admin_member_packs('${WHO}', '${A}', 1, 0, '  '); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'R1 an empty reason is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  st := null; begin perform admin_member_packs(' ', '${A}', 1, 0, 'tst no actor'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'R1 an empty actor is refused (LP400)', 'ok', st = 'LP400', 'got', st);
  id1 := admin_log_action('tst_bot', 'gift', 'player', '${A}', null, '{"amount": 1}', 'admin', 'bot', null);
  st := null; begin perform admin_undo('${WHO}', id1, 'tst undo gift'); exception when others then st := sqlstate; end;
  res := res || jsonb_build_object('case', 'R2 a bot gift cannot be undone here (LP400)', 'ok', st = 'LP400', 'got', st);

  -- G. the lockdown -----------------------------------------------------------------------------------
  select coalesce(jsonb_agg(p.oid::regprocedure::text order by 1), '[]') into got from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.oid::regprocedure::text = any(array[${FNS.map((x) => `'${x}'`).join(', ')}])
    and not p.prosecdef and array_to_string(p.proconfig, ',') ilike '%search_path=public%' and obj_description(p.oid, 'pg_proc') is not null
    and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
    and has_function_privilege('service_role', p.oid, 'execute');
  res := res || jsonb_build_object('case', 'G1 the 11 functions: invoker, search_path public, a comment, service_role only', 'ok', jsonb_array_length(got) = 11, 'got', got);
  foreach f in array array['anon', 'authenticated'] loop
    ok := false;
    begin
      execute format('set local role %I', f);
      perform admin_member_packs('${WHO}', '${A}', 1, 0, 'tst as an API role');
    exception when insufficient_privilege then ok := true; end;
    reset role;
    res := res || jsonb_build_object('case', 'G2 a call as ' || f || ' is refused', 'ok', ok);
  end loop;
  raise exception 'RESULTS %', res;
end $t$;`;

const run = async (mig) => {
  const out = JSON.stringify(await q(body(mig)));
  const m = out.match(/RESULTS (\[.*\])/);
  if (!m) return { error: out.slice(0, 1200) };
  return { results: JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, '')) };
};

const base = await run(MIG);
let fail = 0;
if (base.error) { console.log('FAIL NO RESULTS:', base.error); fail = 1; }
else {
  for (const x of base.results) { if (!x.ok) fail++; console.log(`${x.ok ? 'PASS' : 'FAIL'} ${x.case}${x.ok || x.got === undefined ? '' : ` got ${JSON.stringify(x.got)}`}`); }
  console.log(fail ? `${fail} of ${base.results.length} FAILED` : `PASS all ${base.results.length}`);
}

if (args.includes('--mutate') && MIG) {
  const MUT = [
    ['balance_set: no stale check', "if v_cur is distinct from p_before then perform admin_stale(btrim(format('balance", "if false then perform admin_stale(btrim(format('balance"],
    ['balance_set: no admin log', "v_id := admin_log_action(p_actor, 'balance_set'", "v_id := 0; perform admin_log_action(p_actor || '', 'balance_set_x'"],
    ['balance_set: no pull check', "if p_key = 'pulls' then perform admin_check_pulls(v_new); end if;", ''],
    ['balance_set: the type may change', "if jsonb_typeof(p_after) <> jsonb_typeof(v_cur) then\n    raise exception using errcode = 'LP400', message = format('admin: balance", "if false then\n    raise exception using errcode = 'LP400', message = format('admin: balance"],
    ['setting_set: member lists as values', 'if admin_is_member_list(p_key, v_path, v_cur) or admin_is_member_list(p_key, v_path, p_after) then', 'if false then'],
    ['setting_set: no date check', "if not v_ok then raise exception using errcode = 'LP400', message = format('admin: setting %s %s must be a date", "if false then raise exception using errcode = 'LP400', message = format('admin: setting %s %s must be a date"],
    ['setting_member: a duplicate add', "if p_add and v_in then perform admin_stale", "if false then perform admin_stale"],
    ['member_packs: no stale check', "if v_bal is distinct from p_before then perform admin_stale('the pack balance'", "if false then perform admin_stale('the pack balance'"],
    ['member_packs: another ref', "v_new := grant_packs(p_player, p_amount, 'admin', null, 'admin_action', v_id::text);", "v_new := grant_packs(p_player, p_amount, 'admin', null, 'admin', v_id::text);"],
    ['member_card: reserved copies taken', 'if free_copies(p_player, p_card) < -p_amount then', 'if false then'],
    ['member_card: the last starred copy taken', 'if v_q + p_amount = 0 and coalesce(v_asc, 0) > 0 then', 'if false then'],
    ['undo: a second undo not caught as LP409', "if exists (select 1 from admin_actions where undo_of = p_action) then", 'if false then'],
    ['undo: the values swapped', "admin_balance_set(p_actor, a.target_id, v_path, a.after->'value', a.before->'value', p_reason, a.id)", "admin_balance_set(p_actor, a.target_id, v_path, a.before->'value', a.after->'value', p_reason, a.id)"],
    ['lockdown: anon may execute', "execute format('revoke execute on function %s from public, anon, authenticated', f);", "execute format('grant execute on function %s to anon', f);"],
  ];
  let caught = 0;
  for (const [name, from, to] of MUT) {
    if (!MIG.includes(from)) { console.log(`MUTATION FAIL (text not found): ${name}`); fail++; continue; }
    const r = await run(MIG.split(from).join(to));
    const failed = r.error || r.results.some((x) => !x.ok);
    if (failed) caught++; else fail++;
    console.log(`${failed ? 'PASS' : 'FAIL'} mutation caught: ${name}${failed && !r.error ? ` (${r.results.filter((x) => !x.ok).map((x) => x.case.split(' ')[0]).join(', ')})` : ''}`);
  }
  console.log(`mutations caught ${caught}/${MUT.length}`);
}
process.exitCode = fail ? 1 : 0;
