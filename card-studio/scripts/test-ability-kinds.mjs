/**
 * Acceptance test for tcg-bot/supabase/f3_ability_kinds.sql (F-3 PR 4a), NO lasting change (one DO block; the final RAISE rolls it back):
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-ability-kinds.mjs     must PASS (the file is applied twice)
 *   MUTATE=<name> ...                                                                       must FAIL, for every name in MUT below
 *   MUTATE=all ...                                                                          runs every mutation, one line each
 * It tests the file's text (MIG=<path> for another file), so it also passes before the file is applied (and after).
 * Invariants (docs/f3-effect-engine.md 2.3 to 2.5, "no change in play"):
 *   1. All live abilities pass ability_ok (the count is printed), the 13 kinds exist, the kinds seed is idempotent.
 *   2. A bad ability is refused on subjects (an UPDATE and an INSERT), with the reason: an unknown effect, an unknown kind, an amount above its maximum
 *      or below its minimum, a wrong target, a missing required field, an unknown field, a wrong slot (an attack effect as a support), a text for a
 *      number, a fraction for a whole number, a bad affinity form, a missing name. The edge values (the min and the max) are accepted. NULL is accepted.
 *      The ability of a squad kind and the ability of a switched-off kind are refused.
 *   3. A bad kind row is refused (reserved primitive, trigger, status and buff stat; unknown primitive, trigger, condition, target, key, value ref;
 *      a balance ref that does not exist; a field ref the kind does not have; a trigger that does not fit the slot; a bad field spec; 0 or 9 steps).
 *      A good new kind (data only) is accepted and an ability can use it at once.
 *   4. A change of ability_kinds that would break a live ability (a tighter limit, a switch off, a delete) is refused.
 *   5. ability_power gives base + weights x values (NULL for NULL). RLS is on, anon and authenticated have no right, service_role has all rights,
 *      every table, column and function has a comment.
 *   6. The self-check at the end of the file stops at a failing live ability (it runs again in the test on a planted bad ability).
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
if (ref !== 'kgvdqqehefezbypozvrh') throw new Error(`wrong Supabase project: ${ref}`);
if (process.env.LOCALDB !== '1') throw new Error('run this test on the LOCAL copy only (LOCALDB=1 and the localdb preload)');
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_ability_kinds.sql', import.meta.url)), 'utf8').replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
// Mutations: [an anchor in the file, the text to find after it, the text that replaces it]. Each breaks one rule; the test must FAIL.
const MUT = {
  reserved_prim: ["create or replace function public.ability_step_check", "if v_do in ('repeat', 'summon', 'reflect') then return", "if false then return"],
  reserved_trig: ["create or replace function public.ability_step_check", "'round_start', 'on_crit', 'on_kill',", "'round_start', 'on_crit', 'x_kill',"],
  reserved_stat: ["create or replace function public.ability_step_check", "if v_stat in ('crit', 'cooldown') then return", "if false then return"],
  reserved_status: ["create or replace function public.ability_step_check", "if p_step->>'status' in ('burn', 'mark') then return", "if false then return"],
  balance_ref: ["create or replace function public.ability_ref_check", "if v is null or (v #> v_path[2:cardinality(v_path)]) is null then return", "if false then return"],
  field_ref: ["create or replace function public.ability_ref_check", "if p_fields ? substr(p_ref, 7) then return null; end if;", "return null;"],
  slot_trigger: ["create or replace function public.ability_step_check", "if p_slot = 'support' and v_on <> 'use' then return", "if false then return"],
  target_rule: ["create or replace function public.ability_step_check", "if not v_target = any(v_tgt_ok) then return", "if false then return"],
  max_limit: ["create or replace function public.ability_check", "if s ? 'max' and n > (s->>'max')::numeric then return", "if false then return"],
  min_limit: ["create or replace function public.ability_check", "if s ? 'min' and n < (s->>'min')::numeric then return", "if false then return"],
  required: ["create or replace function public.ability_check", "if coalesce((s->>'required')::boolean, false) then return", "if false then return"],
  enum_rule: ["create or replace function public.ability_check", "if s ? 'enum' and not s->'enum' @>", "if false and not s->'enum' @>"],
  pattern_rule: ["create or replace function public.ability_check", "if s ? 'pattern' and (v #>> '{}') !~", "if false and (v #>> '{}') !~"],
  unknown_field: ["create or replace function public.ability_check", "if not k.fields ? f then return", "if false then return"],
  slot_rule: ["create or replace function public.ability_check", "if k.slot <> v_kind then return", "if false then return"],
  squad_rule: ["create or replace function public.ability_check", "if k.slot = 'squad' then return", "if false then return"],
  enabled_rule: ["create or replace function public.ability_check", "if not k.enabled then return", "if false then return"],
  int_rule: ["create or replace function public.ability_check", "if v_type = 'integer' and n <> trunc(n) then return", "if false then return"],
  name_rule: ["create or replace function public.ability_check", "or btrim(p_ability->>'name') = '' then return", "or false then return"],
  null_ok: ["create or replace function public.ability_check", "if p_ability is null then return null; end if;", "if p_ability is null then return 'null'; end if;"],
  subjects_trigger: ["create or replace function public.subjects_ability_check", "if r is not null then raise exception", "if false then raise exception"],
  recheck: ["create or replace function public.ability_kinds_recheck", "if v is not null then raise exception", "if false then raise exception"],
  selfcheck: ["do $chk$", "then raise exception 'f3_ability_kinds.sql: the live ability", "then raise notice 'f3_ability_kinds.sql: the live ability"],
  power_sign: ["create or replace function public.ability_power", "round((k.power->>'base')::numeric +", "round((k.power->>'base')::numeric -"],
  steps_trigger: ["create trigger ability_kinds_check", "before insert or update on", "before delete on"],
  seed_slot: ["('rampage', 'Rampage', 'attack',", "'attack',", "'support',"],
};
if (process.env.MUTATE === 'all') {
  let ok = true;
  for (const name of Object.keys(MUT)) {
    const r = spawnSync(process.execPath, process.execArgv.concat([fileURLToPath(import.meta.url)]), { env: { ...process.env, MUTATE: name, LOCALDB_QUIET: '1' }, encoding: 'utf8' });
    const lines = (r.stdout || '').trim().split(/\r?\n/);
    const line = lines.find((l) => /^FAIL /.test(l)) || lines.pop() || '';
    const caught = r.status !== 0;
    if (!caught) ok = false;
    console.log(`mutation ${name.padEnd(16)} ${caught ? 'caught (test FAILS)' : 'NOT CAUGHT'}  ${line.slice(0, 150)}`);
  }
  console.log(ok ? 'mutations: all caught' : 'mutations: FAIL (a mutation was not caught)');
  process.exit(ok ? 0 : 1);
}
if (process.env.MUTATE) {
  const m = MUT[process.env.MUTATE];
  const s = m && mig.indexOf(m[0]); const i = s >= 0 ? mig.indexOf(m[1], s) : -1;
  if (!m || s < 0 || i < 0) throw new Error(`the mutation ${process.env.MUTATE} does not match the migration`);
  mig = mig.slice(0, i) + m[2] + mig.slice(i + m[1].length);
}
if (['$m$', '$t$', '$f$'].some((x) => mig.includes(x))) throw new Error('the migration must not contain $m$, $t$ or $f$');
// The self-check section of the file (section 7), run again on a planted bad ability.
const selfStart = mig.indexOf('do $chk$'), selfEnd = mig.indexOf('end $chk$;', selfStart) + 'end $chk$;'.length;
if (selfStart < 0) throw new Error('no self-check section in the file');
const selfCheck = mig.slice(selfStart, selfEnd);

const body = String.raw`do $t$
declare
  vk text; vh text; va jsonb; vh_a jsonb; vk_key text; vh_key text; n int; m text;
begin
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- two times: idempotent (the seed runs only into an empty table)
  create temp table res (c text, ok boolean, d text);
  create function pg_temp.try(p text) returns text language plpgsql as $f$ begin execute p; return null; exception when others then return sqlerrm; end $f$;
  -- expect: sql must be refused and the message must contain the fragment (a null fragment: must succeed)
  create function pg_temp.expect(p_case text, p_sql text, p_frag text) returns void language plpgsql as $f$
  declare e text := pg_temp.try(p_sql);
  begin
    insert into res values (p_case, case when p_frag is null then e is null else e is not null and position(lower(p_frag) in lower(e)) > 0 end, coalesce(e, 'accepted'));
  end $f$;
  create function pg_temp.up(p_key text, p_ab jsonb) returns text language sql as $f$
    select pg_temp.try(format('update subjects set ability = %L::jsonb where key = %L', p_ab::text, p_key)) $f$;

  select key, ability into vk_key, va from subjects where ability->>'effect' = 'focus' order by key limit 1;
  select key, ability into vh_key, vh_a from subjects where ability->>'effect' = 'heal' order by key limit 1;
  select count(*) into n from subjects where ability is not null;

  -- 1. the live data
  insert into res select 'every live ability passes ability_ok (' || n || ' abilities)', n >= 127 and not exists (select 1 from subjects where ability is not null and not ability_ok(ability)),
    coalesce((select string_agg(key || ': ' || ability_check(ability), '; ') from subjects where ability is not null and not ability_ok(ability)), 'ok');
  insert into res select 'the 13 live kinds exist and are enabled', (select count(*) from ability_kinds where enabled and slot in ('attack', 'support')) = 13
    and (select count(*) from ability_kinds) = 13, (select count(*)::text from ability_kinds);
  insert into res select 'every kind has the live effect names (5 attack, 8 support)', (select string_agg(key, ',' order by key) from ability_kinds where slot = 'attack') = 'execute,focus,lifesteal,pierce,rampage'
    and (select string_agg(key, ',' order by key) from ability_kinds where slot = 'support') = 'cleanse,empower,expose,heal,shield,smite,stun,weaken', 'lists';
  insert into res select 'ability_ok(NULL) is true, ability_check(NULL) is null', ability_ok(null) and ability_check(null) is null, 'null';
  perform pg_temp.expect('a NULL ability is accepted on subjects', format('update subjects set ability = null where key = %L', vk_key), null);
  update subjects set ability = va where key = vk_key;

  -- 2. planted bad abilities (update)
  perform pg_temp.expect('unknown effect refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"effect":"burninate"}')::text, vk_key), 'unknown ability effect');
  perform pg_temp.expect('unknown kind refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"kind":"passive"}')::text, vk_key), 'attack or support');
  perform pg_temp.expect('no effect refused', format('update subjects set ability = %L::jsonb where key = %L', (va - 'effect')::text, vk_key), 'unknown ability effect');
  perform pg_temp.expect('an ability that is not an object refused', format('update subjects set ability = %L::jsonb where key = %L', '[1]', vk_key), 'must be an object');
  perform pg_temp.expect('amount above the maximum refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":0.41}')::text, vk_key), 'maximum for focus');
  perform pg_temp.expect('amount 5 instead of 0.5 refused (the typo)', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":5}')::text, vk_key), 'maximum');
  perform pg_temp.expect('amount below the minimum refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":0.005}')::text, vk_key), 'minimum for focus');
  perform pg_temp.expect('amount at the maximum accepted', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":0.4}')::text, vk_key), null);
  perform pg_temp.expect('amount at the minimum accepted', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":0.01}')::text, vk_key), null);
  perform pg_temp.expect('a text for a number refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":"0.2"}')::text, vk_key), 'must be a number');
  perform pg_temp.expect('missing required amount refused', format('update subjects set ability = %L::jsonb where key = %L', (va - 'amount')::text, vk_key), 'needs the field "amount"');
  perform pg_temp.expect('a null amount counts as missing (the studio sends null)', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":null}')::text, vk_key), 'needs the field');
  perform pg_temp.expect('unknown field refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"power":9}')::text, vk_key), 'no field "power"');
  perform pg_temp.expect('a support field on an attack refused (cooldown)', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"cooldown":2}')::text, vk_key), 'no field "cooldown"');
  perform pg_temp.expect('a null extra field accepted (the studio sends null)', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"cooldown":null,"target":null}')::text, vk_key), null);
  perform pg_temp.expect('wrong slot refused (a support effect as an attack)', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"effect":"heal"}')::text, vk_key), 'support effect, not an attack');
  perform pg_temp.expect('wrong slot refused (an attack effect as a support)', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"effect":"focus"}')::text, vh_key), 'attack effect, not an support');
  perform pg_temp.expect('missing name refused', format('update subjects set ability = %L::jsonb where key = %L', (va - 'name')::text, vk_key), 'needs a name');
  perform pg_temp.expect('empty name refused', format('update subjects set ability = %L::jsonb where key = %L', (va || '{"name":"  "}')::text, vk_key), 'needs a name');
  perform pg_temp.expect('heal on the boss refused (wrong target)', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"target":"boss"}')::text, vh_key), 'must be one of');
  perform pg_temp.expect('weaken on an ally refused (wrong target)', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"effect":"weaken","target":"ally"}')::text, vh_key), 'must be one of');
  perform pg_temp.expect('missing target refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a - 'target')::text, vh_key), 'needs the field "target"');
  perform pg_temp.expect('missing cooldown refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a - 'cooldown')::text, vh_key), 'needs the field "cooldown"');
  perform pg_temp.expect('cooldown 0 refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"cooldown":0}')::text, vh_key), 'minimum for heal');
  perform pg_temp.expect('a fraction for a whole number refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"cooldown":2.5}')::text, vh_key), 'whole number');
  perform pg_temp.expect('a bad affinity form refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"affinity":"Fire Cards"}')::text, vh_key), 'wrong form');
  perform pg_temp.expect('a good affinity accepted', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"affinity":"trait:fire"}')::text, vh_key), null);
  perform pg_temp.expect('duration 9 refused', format('update subjects set ability = %L::jsonb where key = %L', (vh_a || '{"duration":9}')::text, vh_key), 'maximum for heal');
  perform pg_temp.expect('an execute with no threshold refused', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"execute","amount":0.3}', vk_key), 'needs the field "threshold"');
  perform pg_temp.expect('a good execute accepted', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"execute","amount":0.3,"threshold":0.2}', vk_key), null);
  perform pg_temp.expect('lifesteal target must be self', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"lifesteal","amount":0.2,"target":"boss"}', vk_key), 'must be one of');
  perform pg_temp.expect('pierce with an amount refused (no field)', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"pierce","amount":0.2}', vk_key), 'no field "amount"');
  perform pg_temp.expect('a good pierce accepted', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"pierce"}', vk_key), null);
  perform pg_temp.expect('a rampage with amount 0 accepted (the tests use it)', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"rampage","amount":0}', vk_key), null);
  perform pg_temp.expect('a rampage with amount 1 accepted (a chance of 100%)', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"rampage","amount":1}', vk_key), null);
  perform pg_temp.expect('a rampage with amount 1.1 refused', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"attack","effect":"rampage","amount":1.1}', vk_key), 'maximum for rampage');
  perform pg_temp.expect('smite 200 accepted', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"support","effect":"smite","amount":200,"target":"boss","cooldown":4}', vh_key), null);
  perform pg_temp.expect('smite 0.3 refused (below the minimum)', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"support","effect":"smite","amount":0.3,"target":"boss","cooldown":4}', vh_key), 'minimum for smite');
  perform pg_temp.expect('stun with an amount refused', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"support","effect":"stun","amount":1,"target":"boss","cooldown":5}', vh_key), 'maximum for stun');
  perform pg_temp.expect('a change of another column passes with an old bad ability', format('update subjects set cp_mod = cp_mod where key = %L', vk_key), null);
  -- the message carries the card key (the studio shows it)
  insert into res select 'the refusal names the card and the reason', pg_temp.try(format('update subjects set ability = %L::jsonb where key = %L', (va || '{"amount":5}')::text, vk_key)) like 'ability refused (' || vk_key || '): %', 'msg';
  -- an INSERT of a subject is checked too
  perform pg_temp.expect('an INSERT with a bad ability refused', $i$insert into subjects (key, name, type, ability) values ('tst_ak_bad', 'tst', 'Character', '{"name":"x","kind":"attack","effect":"focus","amount":9}')$i$, 'maximum for focus');
  perform pg_temp.expect('an INSERT with a good ability accepted', $i$insert into subjects (key, name, type, ability) values ('tst_ak_good', 'tst', 'Character', '{"name":"x","kind":"attack","effect":"focus","amount":0.1}')$i$, null);
  perform pg_temp.expect('an INSERT with no ability accepted', $i$insert into subjects (key, name, type) values ('tst_ak_none', 'tst', 'Item')$i$, null);
  update subjects set ability = va where key = vk_key; update subjects set ability = vh_a where key = vh_key;

  -- 3. planted bad kinds
  create function pg_temp.kind(p_key text, p_slot text, p_steps text, p_fields text default '{"amount":{"type":"number","required":true,"min":0,"max":1}}', p_extra text default '') returns text language sql as $f$
    select pg_temp.try(format('insert into ability_kinds (key, label, slot, steps, fields %s) values (%L, %L, %L, %L::jsonb, %L::jsonb %s)', case when p_extra = '' then '' else ', latent, power' end,
      p_key, 'T ' || p_key, p_slot, p_steps, p_fields, case when p_extra = '' then '' else ', ' || p_extra end)) $f$;
  insert into res select 'bad kind: ' || x.c, (pg_temp.kind('ta' || kk.k, x.s, x.st, coalesce(x.f, '{"amount":{"type":"number","required":true,"min":0,"max":1}}'))) is not null
      and position(lower(x.frag) in lower(pg_temp.kind('tb' || kk.k, x.s, x.st, coalesce(x.f, '{"amount":{"type":"number","required":true,"min":0,"max":1}}')))) > 0,
    coalesce(pg_temp.kind('tc' || kk.k, x.s, x.st, coalesce(x.f, '{"amount":{"type":"number","required":true,"min":0,"max":1}}')), 'accepted')
  from (values
    (1, 'reserved primitive repeat', 'support', '[{"on":"use","do":"repeat"}]', null, 'reserved'),
    (2, 'reserved primitive summon', 'support', '[{"on":"use","do":"summon"}]', null, 'reserved'),
    (3, 'reserved primitive reflect', 'support', '[{"on":"use","do":"reflect"}]', null, 'reserved'),
    (4, 'unknown primitive', 'support', '[{"on":"use","do":"explode"}]', null, 'unknown primitive'),
    (5, 'unknown trigger', 'support', '[{"on":"on_sneeze","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', null, 'unknown trigger'),
    (6, 'reserved trigger on_kill', 'attack', '[{"on":"on_kill","do":"hit_mod","mod":"no_block"}]', null, 'reserved'),
    (7, 'reserved trigger round_start', 'support', '[{"on":"round_start","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', null, 'reserved'),
    (8, 'reserved trigger low_hp', 'attack', '[{"on":"low_hp","do":"hit_mod","mod":"no_block"}]', null, 'reserved'),
    (9, 'reserved buff stat crit', 'support', '[{"on":"use","do":"buff","stat":"crit","target":"ally_target","value":{"refs":["field:amount"]},"until":"next_attack"}]', null, 'reserved'),
    (10, 'unknown buff stat', 'support', '[{"on":"use","do":"buff","stat":"luck","target":"ally_target","value":{"refs":["field:amount"]},"until":"next_attack"}]', null, 'unknown buff stat'),
    (11, 'reserved status burn', 'support', '[{"on":"use","do":"apply_status","status":"burn","target":"enemy_target","rounds":{"refs":["field:amount"]}}]', null, 'reserved'),
    (12, 'reserved status mark in remove_status', 'support', '[{"on":"use","do":"remove_status","statuses":["mark"],"target":"all_allies"}]', null, 'reserved'),
    (13, 'a balance ref that does not exist (leaf)', 'support', '[{"on":"use","do":"heal","target":"ally_target","basis":"target_max","value":{"refs":["field:amount"]},"cap":"balance:support.nope_cap"}]', null, 'no value there'),
    (14, 'a balance ref that does not exist (key)', 'support', '[{"on":"use","do":"heal","target":"ally_target","basis":"target_max","value":{"refs":["field:amount"]},"cap":"balance:nokey.x"}]', null, 'no value there'),
    (15, 'a balance ref in a condition that does not exist', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block","when":[{"kind":"flag","balance":"balance:combat.nope"}]}]', null, 'no value there'),
    (16, 'a field ref the kind does not have', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:power"]}}]', null, 'no field "power"'),
    (17, 'an unknown value ref', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["banana"]}}]', null, 'unknown value ref'),
    (18, 'an attack kind on use', 'attack', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', null, 'cannot run on'),
    (19, 'a support kind on before_hit', 'support', '[{"on":"before_hit","do":"hit_mod","mod":"no_block"}]', null, 'runs on'),
    (20, 'heal on an enemy target', 'support', '[{"on":"use","do":"heal","target":"enemy_target","basis":"target_max","value":{"refs":["field:amount"]}}]', null, 'not allowed'),
    (21, 'damage on self', 'support', '[{"on":"use","do":"damage","target":"self","value":{"refs":["field:amount"]}}]', null, 'not allowed'),
    (22, 'an unknown target', 'support', '[{"on":"use","do":"damage","target":"everyone","value":{"refs":["field:amount"]}}]', null, 'unknown target'),
    (23, 'attack buff on an enemy', 'support', '[{"on":"use","do":"buff","stat":"attack","target":"enemy_target","value":{"refs":["field:amount"]},"until":"next_attack"}]', null, 'not allowed'),
    (24, 'an unknown condition', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block","when":[{"kind":"moon_phase"}]}]', null, 'unknown condition'),
    (25, 'count_tag with no min or max', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block","when":[{"kind":"count_tag","tag":"trait:x","scope":"squad"}]}]', null, 'needs min or max'),
    (26, 'an unknown step key', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]},"color":"red"}]', null, 'unknown key'),
    (27, 'a hit_mod after the hit', 'attack', '[{"on":"on_hit","do":"hit_mod","mod":"no_block"}]', null, 'before_hit only'),
    (28, 'an unknown hit_mod', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"vampire"}]', null, 'unknown hit_mod'),
    (29, 'a heal with no basis', 'support', '[{"on":"use","do":"heal","target":"ally_target","value":{"refs":["field:amount"]}}]', null, 'basis'),
    (30, 'basis dealt on use', 'support', '[{"on":"use","do":"heal","target":"ally_target","basis":"dealt","value":{"refs":["field:amount"]}}]', null, 'basis dealt'),
    (31, 'a buff with no rounds and no until', 'support', '[{"on":"use","do":"buff","stat":"enemy_damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', null, 'exactly one'),
    (32, 'a buff with rounds and until', 'support', '[{"on":"use","do":"buff","stat":"attack","target":"ally_target","value":{"refs":["field:amount"]},"rounds":{"refs":["field:amount"]},"until":"next_attack"}]', null, 'exactly one'),
    (33, 'a stun with no rounds', 'support', '[{"on":"use","do":"apply_status","status":"stun","target":"enemy_target"}]', null, 'needs rounds'),
    (34, 'no steps', 'support', '[]', null, 'list of 1 to 8'),
    (35, '9 steps', 'support', (select jsonb_agg('{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}'::jsonb)::text from generate_series(1, 9)), null, 'list of 1 to 8'),
    (36, 'steps that are not a list', 'support', '{"on":"use"}', null, 'list of 1 to 8'),
    (37, 'a bad slot', 'boss', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', null, 'slot must be'),
    (38, 'a field type that is not known', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', '{"amount":{"type":"blob"}}', 'type must be'),
    (39, 'a field with min above max', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', '{"amount":{"type":"number","min":2,"max":1}}', 'min is above max'),
    (40, 'a reserved field name', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', '{"name":{"type":"text"},"amount":{"type":"number"}}', 'reserved'),
    (41, 'a field with an unknown key', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', '{"amount":{"type":"number","step":1}}', 'unknown key'),
    (42, 'a squad kind with a field', 'squad', '[{"on":"before_hit","do":"hit_mod","mod":"no_block"}]', '{"amount":{"type":"number"}}', 'squad kind has no fields'),
    (43, 'a default above the maximum', 'support', '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount"]}}]', '{"amount":{"type":"number","max":1,"default":2}}', 'default is above max')
  ) x(i, c, s, st, f, frag), lateral (select translate(x.i::text, '0123456789', 'abcdefghij') as k) kk;
  -- latent and power are checked too
  perform pg_temp.expect('latent names a field the kind does not have', $i$insert into ability_kinds (key, label, slot, steps, fields, latent) values ('t_lat', 'T', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block"}]', '{}', '["amount"]')$i$, 'latent');
  perform pg_temp.expect('a power weight on a field the kind does not have', $i$insert into ability_kinds (key, label, slot, steps, fields, power) values ('t_pw', 'T', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block"}]', '{}', '{"base":1,"weights":{"amount":2}}')$i$, 'power weight');
  perform pg_temp.expect('a key with a capital letter refused', $i$insert into ability_kinds (key, label, slot, steps) values ('Bad', 'T', 'attack', '[{"on":"before_hit","do":"hit_mod","mod":"no_block"}]')$i$, 'key_check');

  -- a good new kind is data only: accepted, and an ability can use it at once
  perform pg_temp.expect('a good new kind accepted (data only)', $i$insert into ability_kinds (key, label, slot, steps, fields, latent, power, counter_key) values ('t_drain', 'Drain', 'support',
    '[{"on":"use","do":"damage","target":"enemy_target","value":{"refs":["field:amount","scale"]}},{"on":"use","do":"heal","target":"ally_target","basis":"target_max","value":{"refs":["field:amount"]},"cap":"balance:support.heal_cap"}]',
    '{"amount":{"type":"number","required":true,"min":1,"max":50},"target":{"type":"text","required":true,"enum":["ally"]},"cooldown":{"type":"integer","required":true,"min":1,"max":5}}', '["amount"]', '{"base":1,"weights":{"amount":0.1}}', 't_drain')$i$, null);
  perform pg_temp.expect('an ability can use the new kind at once', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"support","effect":"t_drain","amount":20,"target":"ally","cooldown":2}', vh_key), null);
  insert into res select 'ability_power of the new kind = base + weight x amount', ability_power('{"name":"x","kind":"support","effect":"t_drain","amount":20,"target":"ally","cooldown":2}') = 3, coalesce(ability_power('{"name":"x","kind":"support","effect":"t_drain","amount":20}')::text, 'null');
  -- a squad kind (the shape of the Forbidden Pride row, PR 4f): accepted, and not an ability
  perform pg_temp.expect('a squad kind (count_tag, holds_subject, mode_in) accepted', $i$insert into ability_kinds (key, label, slot, steps) values ('t_set', 'T set', 'squad',
    '[{"on":"before_hit","do":"hit_mod","mod":"dmg_mult","value":{"refs":["balance:support.matched_x"],"add1":false},"when":[{"kind":"count_tag","tag":"trait:forbidden-pride","scope":"squad","distinct":"subject","min":"balance:combat.syn_small_at"},{"kind":"holds_subject","key":"ottozone-s-head","scope":"squad"},{"kind":"mode_in","modes":["hunt"]}]}]')$i$, null);
  perform pg_temp.expect('the ability of a squad kind refused', format('update subjects set ability = %L::jsonb where key = %L', '{"name":"x","kind":"support","effect":"t_set"}', vh_key), 'a card cannot have it');
  update subjects set ability = vh_a where key = vh_key;
  delete from ability_kinds where key in ('t_drain', 't_set');

  -- 4. a change that breaks a live ability is refused (the kind rows are used by the live abilities)
  perform pg_temp.expect('a tighter limit under a live value refused', $i$update ability_kinds set fields = jsonb_set(fields, '{amount,max}', '0.1') where key = 'focus'$i$, 'would fail');
  perform pg_temp.expect('a looser limit accepted', $i$update ability_kinds set fields = jsonb_set(fields, '{amount,max}', '0.5') where key = 'focus'$i$, null);
  perform pg_temp.expect('a switch off of a used kind refused', $i$update ability_kinds set enabled = false where key = 'heal'$i$, 'would fail');
  perform pg_temp.expect('a delete of a used kind refused', $i$delete from ability_kinds where key = 'smite'$i$, 'would fail');
  perform pg_temp.expect('a field removed that a live ability has refused', $i$update ability_kinds set fields = fields - 'affinity' where key = 'weaken'$i$, 'would fail');
  perform pg_temp.expect('a step edit with a reserved name refused', $i$update ability_kinds set steps = '[{"on":"use","do":"repeat"}]' where key = 'smite'$i$, 'reserved');

  -- 5. power, grants, comments
  insert into res select 'ability_power: focus 0.2 = 2', ability_power('{"name":"x","kind":"attack","effect":"focus","amount":0.2}') = 2, coalesce(ability_power('{"name":"x","kind":"attack","effect":"focus","amount":0.2}')::text, 'null');
  insert into res select 'ability_power: smite 200 cooldown 4 = 4 (5 - 1)', ability_power('{"name":"x","kind":"support","effect":"smite","amount":200,"target":"boss","cooldown":4}') = 4,
    coalesce(ability_power('{"name":"x","kind":"support","effect":"smite","amount":200,"target":"boss","cooldown":4}')::text, 'null');
  insert into res select 'ability_power: pierce = 1 (base only), NULL = NULL, unknown effect = NULL', ability_power('{"effect":"pierce"}') = 1 and ability_power(null) is null and ability_power('{"effect":"nope"}') is null, 'power';
  insert into res select 'RLS is on for ability_kinds', (select relrowsecurity from pg_class where oid = 'public.ability_kinds'::regclass), 'rls';
  insert into res select 'anon and authenticated have no right on ability_kinds, service_role has all',
    not has_table_privilege('anon', 'public.ability_kinds', 'select') and not has_table_privilege('authenticated', 'public.ability_kinds', 'select')
    and not has_table_privilege('authenticated', 'public.ability_kinds', 'insert') and has_table_privilege('service_role', 'public.ability_kinds', 'select,insert,update,delete'), 'grants';
  insert into res select 'ability_kinds has a comment on the table and on every column',
    obj_description('public.ability_kinds'::regclass, 'pg_class') is not null
    and not exists (select 1 from pg_attribute a where a.attrelid = 'public.ability_kinds'::regclass and a.attnum > 0 and not a.attisdropped and col_description(a.attrelid, a.attnum) is null), 'comments';
  insert into res select 'every new function has a comment', not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'ability\_%' or p.proname in ('subjects_ability_check'))
    and obj_description(p.oid, 'pg_proc') is null), coalesce((select string_agg(p.proname, ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'ability\_%' and obj_description(p.oid, 'pg_proc') is null), 'ok');

  -- 6. the self-check of the file stops at a bad live ability
  alter table subjects disable trigger subjects_ability_check;
  update subjects set ability = va || '{"amount":99}' where key = vk_key;
  alter table subjects enable trigger subjects_ability_check;
  m := pg_temp.try($sc$${selfCheck}$sc$);
  insert into res select 'the self-check stops at a failing live ability and names the card', m is not null and m like '%' || vk_key || '%fails the check%', coalesce(m, 'no error');
  update subjects set ability = va where key = vk_key;
  m := pg_temp.try($sc$${selfCheck}$sc$);
  insert into res select 'the self-check passes on the live data', m is null, coalesce(m, 'ok');

  raise exception 'RESULTS %', (select jsonb_agg(jsonb_build_object('case', c, 'ok', ok, 'd', translate(left(d, 300), chr(34) || chr(92) || chr(10), '   '))) from res);
end $t$;`;

const out = JSON.stringify(await q(`set statement_timeout = '5min';` + String.fromCharCode(10) + body));
const mm = out.match(/RESULTS (\[.*\])/);
if (!mm) { console.log('FAIL no results:', out.slice(0, 2500)); process.exit(1); }
const results = JSON.parse(mm[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n.*$/, ''));
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.case}${r.ok ? '' : ' :: ' + r.d}`);
}
console.log(fail ? `FAIL ${fail} of ${results.length} cases${process.env.MUTATE ? ' (mutation ' + process.env.MUTATE + ' caught)' : ''}` : `PASS all ${results.length}${process.env.MUTATE ? ' (mutation NOT caught)' : ''}`);
process.exitCode = fail ? 1 : 0;
