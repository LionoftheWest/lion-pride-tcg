/**
 * Acceptance test for tcg-bot/supabase/f3_stun_limit_1.sql (F-3 PR 4c, Nathan 2026-10-16: a stun lasts 1 round). NO lasting change: one DO block,
 * the final RAISE rolls it back. It runs the file's text (MIG=<path> for another file), so it passes before and after the file is applied.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-stun-limit-1.mjs      must PASS
 *   MUTATE=max2 ...                                                                         must FAIL (the limit stays 2)
 * Invariants:
 *   1. After the file, a stun ability with duration 2 is refused (subjects_ability_check, "maximum for stun"), duration 1 is accepted, and every live
 *      stun ability passes ability_check. The other kinds keep their limits (the heal duration max is unchanged).
 *   2. The file is idempotent (applied twice).
 *   3. With a planted live stun of duration 2 the file is refused (the recheck trigger or the self-check), so it cannot break a live card.
 */
import { runBlock, assertLocal } from './lab-lib.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
assertLocal('test-stun-limit-1.mjs');

let mig = readFileSync(process.env.MIG || fileURLToPath(new URL('../../tcg-bot/supabase/f3_stun_limit_1.sql', import.meta.url)), 'utf8')
  .replace(/\r/g, '').replace(/notify pgrst[^\n]*\n/g, '');
if (process.env.MUTATE === 'max2') mig = mig.replace("jsonb_set(fields, '{duration,max}', '1'::jsonb)", "jsonb_set(fields, '{duration,max}', '2'::jsonb)").replace('"max": 1, "default": 1}', '"max": 2, "default": 1}');
if (mig.includes('$m$')) throw new Error('the migration must not contain $m$');

const out = JSON.parse(await runBlock(String.raw`do $t$
declare v_key text; v_ab jsonb; res jsonb := '[]'; e text; v_heal jsonb;
begin
  select key, ability into v_key, v_ab from subjects where ability->>'effect' = 'stun' order by key limit 1;
  select fields->'duration' into v_heal from ability_kinds where key = 'heal';
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- idempotent
  res := res || jsonb_build_object('t', 'the stun duration limit is 1 to 1', 'ok', (select fields->'duration' from ability_kinds where key = 'stun') = '{"type": "integer", "min": 1, "max": 1, "default": 1}'::jsonb);
  res := res || jsonb_build_object('t', 'the heal duration limit is unchanged', 'ok', (select fields->'duration' from ability_kinds where key = 'heal') = v_heal);
  res := res || jsonb_build_object('t', 'every live stun passes', 'ok', not exists (select 1 from subjects where ability->>'effect' = 'stun' and ability_check(ability) is not null)
    and exists (select 1 from subjects where ability->>'effect' = 'stun'));
  begin
    update subjects set ability = v_ab || '{"duration": 2}'::jsonb where key = v_key;
    e := 'accepted';
  exception when others then e := sqlerrm; end;
  res := res || jsonb_build_object('t', 'a stun with duration 2 is refused', 'ok', e like '%maximum for stun%', 'got', e);
  begin
    update subjects set ability = v_ab || '{"duration": 1}'::jsonb where key = v_key;
    e := 'accepted';
  exception when others then e := sqlerrm; end;
  res := res || jsonb_build_object('t', 'a stun with duration 1 is accepted', 'ok', e = 'accepted', 'got', e);
  -- 3. a live stun with duration 2 (planted with the old limit): the file is refused
  begin
    update ability_kinds set fields = jsonb_set(fields, '{duration,max}', '2'::jsonb) where key = 'stun';
    update subjects set ability = v_ab || '{"duration": 2}'::jsonb where key = v_key;
    begin
      execute $m$${mig}$m$;
      e := 'applied';
    exception when others then e := sqlerrm; end;
    raise exception using errcode = 'U0001', message = e;
  exception when sqlstate 'U0001' then e := sqlerrm; end;
  res := res || jsonb_build_object('t', 'the file is refused when a live stun has duration 2', 'ok', e like '%would fail%' or e like '%fail the check%', 'got', e);
  raise exception 'RESULT:%', res::text;
end $t$;`));
let fails = 0;
for (const r of out) { if (!r.ok) fails += 1; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.t}${r.ok ? '' : `  (${r.got ?? ''})`}`); }
console.log(fails ? `FAIL ${fails} of ${out.length}` : `PASS ${out.length} checks`);
process.exit(fails ? 1 : 0);
