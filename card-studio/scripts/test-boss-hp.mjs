/**
 * Test boss_hp_heal_share.sql (the new boss HP and a fixed heal share) with NO lasting change:
 *   node scripts/test-boss-hp.mjs [file.sql]      (default: ../tcg-bot/supabase/boss_hp_heal_share.sql)
 *   MUTATE=<name> node scripts/test-boss-hp.mjs   must FAIL, for every name:
 *     share     the share is HP / crew again        settings  the file does not change settings.hunt_hp
 *     guard     the live-version guard accepts any version
 * One DO block: apply the file, check the live boss, spawn each tier, check the fallback, then RAISE (rollback).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { mutation } from './fixtures.mjs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();

// No file: test the CURRENT functions (boss_hp_heal_share.sql is live, and a later migration replaced its functions, so its own guard
// refuses a second run). With a file: the acceptance run (apply it, the guard, every mutation).
const FILE = process.argv[2];
let mig = !FILE ? '' : readFileSync(FILE, 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
const M = process.env.MUTATE;
if (!FILE && ['guard', 'settings'].includes(M)) throw new Error(`MUTATE=${M} changes the migration text: pass the file`);
const MUT = M === 'guard' || M === 'settings' ? '' : mutation({
  share: ['public.spawn_hunt(integer,text)', "coalesce((v_cfg->>'heal_share')::bigint, greatest(1, round(v_hp::numeric / v_hunters)))", 'greatest(1, round(v_hp::numeric / v_hunters))'],
});
const TEXT_MUT = {
  settings: ["update public.settings set value = value ||", '-- update public.settings set value = value ||'],
  guard: ["not in ('eec42fa92d6696a5ad8af4dfa1d6b078',", "is null and 'x' not in ('eec42fa92d6696a5ad8af4dfa1d6b078',"],
}[M];
if (TEXT_MUT) { if (!mig.includes(TEXT_MUT[0])) throw new Error(`bad ${M} mutation`); mig = mig.replace(TEXT_MUT[0], TEXT_MUT[1]); console.log(`MUTATE=${M}: the migration text`); }
if (mig.includes('$m$') || mig.includes('$t$')) throw new Error('the migration must not contain $m$ or $t$');

const body = String.raw`do $t$ declare
  bad text := ''; h bigint; rec record; before jsonb; after jsonb; tier text; want bigint; cfg jsonb;
begin
  -- The boss that is live now (if any), before the file runs.
  select jsonb_build_object('id', id, 'hp_max', hp_max, 'hp_remaining', hp_remaining, 'hp_share', hp_share) into before
    from hunts where status = 'active' order by id desc limit 1;
  ${mig ? 'execute $m$' + mig + '$m$;' : '-- the current functions'}
  ${MUT}

  -- 1. The settings: the new HP per tier and the heal share. The other keys (crew) stay.
  select value into cfg from settings where key = 'hunt_hp';
  if (cfg->>'Normal')::int is distinct from 70000 or (cfg->>'Heroic')::int is distinct from 80000 or (cfg->>'Mythic')::int is distinct from 80000
     or (cfg->>'heal_share')::int is distinct from 3000 or cfg->>'crew' is null then bad := bad || 'settings: ' || cfg::text || '; '; end if;

  -- 2. The live boss is not changed by the file (Nathan: no change to the current boss).
  select jsonb_build_object('id', id, 'hp_max', hp_max, 'hp_remaining', hp_remaining, 'hp_share', hp_share) into after
    from hunts where status = 'active' order by id desc limit 1;
  if before is distinct from after then bad := bad || 'the live boss changed: ' || coalesce(before::text, 'none') || ' -> ' || coalesce(after::text, 'none') || '; '; end if;

  -- 3. A new boss of each tier: the tier HP, full, and the share 3,000 (not HP / crew).
  foreach tier in array array['Normal', 'Heroic', 'Mythic'] loop
    want := case tier when 'Normal' then 70000 else 80000 end;
    h := spawn_hunt(3, tier); select * into rec from hunts where id = h;
    if rec.tier <> tier or rec.hp_max <> want or rec.hp_remaining <> want or rec.hp_share <> 3000 then
      bad := bad || tier || ': hp ' || rec.hp_max || '/' || rec.hp_remaining || ' share ' || rec.hp_share || '; '; end if;
  end loop;

  -- 4. With no heal_share in the settings, the share is HP / crew (the old rule, a safe fallback).
  update settings set value = value - 'heal_share' where key = 'hunt_hp';
  h := spawn_hunt(3, 'Normal'); select * into rec from hunts where id = h;
  if rec.hp_share <> 7000 then bad := bad || 'fallback share ' || rec.hp_share || ' (want 70000 / 10); '; end if;

${mig && (!M || M === 'guard') ? `
  -- 5. The guard: the file runs again on its own result; a changed live function stops it.
  begin execute $m$${mig}$m$; exception when others then bad := bad || 'second run: ' || sqlerrm || '; '; end;
  execute replace(pg_get_functiondef('public.spawn_hunt'::regproc), 'declare', 'declare -- changed by someone else');
  begin execute $m$${mig}$m$; bad := bad || 'the guard let a changed spawn_hunt through; ';
  exception when others then if sqlerrm not like '%changed since this file was built%' then bad := bad || 'guard: ' || sqlerrm || '; '; end if; end;
` : ''}

  raise exception 'RESULT:%', case when bad = '' then 'PASS' else 'FAIL ' || bad end;
end $t$;`;

const res = await q(body);
const msg = JSON.stringify(res);
const m = String(res?.message || msg).match(/RESULT:(PASS|FAIL[\s\S]*?)(\nCONTEXT|$)/);
console.log(m ? m[1] : 'ERROR ' + msg.slice(0, 2000));
process.exit(m && m[1] === 'PASS' ? 0 : 1);
