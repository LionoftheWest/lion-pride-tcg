/**
 * Probe a spawn_hunt definition WITHOUT changing live data.
 *   node scripts/probe-spawn.mjs <file-with-CREATE-spawn_hunt.sql> <temp_fn_name>
 * Inside one DO block: create the function under a temp name, spawn 40 hunts, measure
 * how many attackers match each picked weak/resist tag, then RAISE with the stats.
 * The exception rolls back every hunt, the function, and any outbox row.
 * Compare the live definition (pg_get_functiondef) against a new one in the same run.
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const file = process.argv[2], fn = process.argv[3];
let create = readFileSync(file, 'utf8').replace(/CREATE OR REPLACE FUNCTION public\.spawn_hunt\(/i, `CREATE OR REPLACE FUNCTION public.${fn}(`);
create = create.replace(/;\s*$/, '');
const sql = `do $do$ declare v_before bigint; v_active bigint; r jsonb; begin
  select coalesce(max(id),0) into v_before from hunts;
  select id into v_active from hunts where status='active' order by id desc limit 1;
  execute $q$${create}$q$;
  for i in 1..40 loop perform public.${fn}(3); end loop;
  with att as (select s.id, s.tag_slugs from subjects s where s.tags->>'class'='attacker' and exists (select 1 from cards c where c.subject_id=s.id and c.in_draw_pool)),
  w as (select h.id, e->>'value' tag, 'weak' k from hunts h, jsonb_array_elements(h.weak_points) e where h.id > v_before
        union all select h.id, e->>'value', 'resist' from hunts h, jsonb_array_elements(h.resist_points) e where h.id > v_before),
  c as (select w.k, w.tag, (select count(*) from att where w.tag = any(att.tag_slugs)) n from w)
  select jsonb_build_object('hunts', (select count(*) from hunts where id > v_before),
    'weak_picks', count(*) filter (where k='weak'), 'resist_picks', count(*) filter (where k='resist'),
    'min_cov', min(n), 'max_cov', max(n), 'picks_le_2', count(*) filter (where n <= 2), 'smash_picks', count(*) filter (where tag='origin:smash'),
    'distinct_tags', count(distinct tag), 'still_active_before', v_active) into r from c;
  raise exception 'PROBE %', r;
end $do$;`;
const out = await q(sql); const m = JSON.stringify(out).match(/PROBE (\{.*?\})\n|PROBE (\{.*\})/);
console.log(m ? (m[1] || m[2]).replace(/\\"/g, '"') : JSON.stringify(out).slice(0, 600));
const after = await q(`select (select count(*) from pg_proc where proname='${fn}') fn_left, (select id from hunts where status='active' order by id desc limit 1) active_now, (select max(id) from hunts) max_id`);
console.log('after rollback:', JSON.stringify(after));
