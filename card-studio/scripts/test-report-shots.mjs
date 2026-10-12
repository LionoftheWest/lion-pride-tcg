/**
 * report_shots.sql (Nathan, 2026-10-11): the private screenshots of a player report. The bucket is private, a member
 * adds at most per_report images to an OWN report, each at most max_bytes, and report_shots_expired lists only the
 * screenshots older than keep_days (all three numbers from balance report_shots). Rolled back:
 *   node scripts/test-report-shots.mjs            (on the local copy: test-all-local.mjs runs it with LOCALDB=1)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const t = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_URL.match(/https:\/\/([a-z0-9]+)/)[1];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) })).json();
const mig = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/report_shots.sql', import.meta.url)), 'utf8').replace(/notify pgrst[^\n]*\n/g, '');
const X = '999999999999999951', Y = '999999999999999952';
const body = String.raw`do $t$
declare res jsonb := '[]'; r jsonb; rx bigint; ry bigint; rold bigint; s_old bigint; s_new bigint; e jsonb; ok boolean;
begin
  execute $m$${mig}$m$;
  execute $m$${mig}$m$;   -- twice: a second run changes nothing and keeps the balance value
  perform set_config('tcg.skip_welcome', 'on', true);
  insert into players (id, username) values ('${X}', 'tst shot x'), ('${Y}', 'tst shot y');
  insert into player_reports (player_id, kind, body) values ('${X}', 'bug', 'the pack froze') returning id into rx;
  insert into player_reports (player_id, kind, body) values ('${Y}', 'bug', 'the hunt froze') returning id into ry;
  insert into player_reports (player_id, kind, body, created_at) values ('${X}', 'bug', 'an old report', now() - interval '100 days') returning id into rold;

  res := res || jsonb_build_object('case', 'the bucket report-shots exists and is PRIVATE (public = false)', 'ok',
    exists (select 1 from storage.buckets where id = 'report-shots' and public = false));
  res := res || jsonb_build_object('case', 'balance report_shots: keep_days 90, per_report 3, max_bytes 1572864, with a note', 'ok',
    (select value = '{"keep_days": 90, "per_report": 3, "max_bytes": 1572864}'::jsonb and length(note) > 40 from balance where key = 'report_shots'));

  r := reserve_report_shot('${X}', rx, 'image/webp', 1000);
  res := res || jsonb_build_object('case', 'the own report: place 1 at <report>/1.webp, the row is not stored yet', 'ok',
    (r->>'ok')::boolean and (r->>'n')::int = 1 and r->>'path' = rx || '/1.webp'
    and exists (select 1 from player_report_shots where id = (r->>'id')::bigint and report_id = rx and bytes = 1000 and stored_at is null), 'r', r);
  res := res || jsonb_build_object('case', 'a png is <report>/2.png, a jpeg <report>/3.jpg', 'ok',
    reserve_report_shot('${X}', rx, 'image/png', 10)->>'path' = rx || '/2.png' and reserve_report_shot('${X}', rx, 'image/jpeg', 10)->>'path' = rx || '/3.jpg');
  r := reserve_report_shot('${X}', rx, 'image/webp', 10);
  res := res || jsonb_build_object('case', 'the 4th screenshot of a report is refused (full)', 'ok',
    r->>'error' = 'full' and (select count(*) from player_report_shots where report_id = rx) = 3, 'r', r);
  res := res || jsonb_build_object('case', 'another member''s report is refused (report), nothing is stored', 'ok',
    reserve_report_shot('${X}', ry, 'image/webp', 10)->>'error' = 'report' and not exists (select 1 from player_report_shots where report_id = ry));
  res := res || jsonb_build_object('case', 'an unknown report is refused (report)', 'ok', reserve_report_shot('${X}', -1, 'image/webp', 10)->>'error' = 'report');
  res := res || jsonb_build_object('case', 'a report older than keep_days is refused (report)', 'ok', reserve_report_shot('${X}', rold, 'image/webp', 10)->>'error' = 'report');
  res := res || jsonb_build_object('case', 'a gif or an svg is refused (type)', 'ok',
    reserve_report_shot('${Y}', ry, 'image/gif', 10)->>'error' = 'type' and reserve_report_shot('${Y}', ry, 'image/svg+xml', 10)->>'error' = 'type');
  res := res || jsonb_build_object('case', 'one byte above max_bytes is refused (big); exactly max_bytes is accepted', 'ok',
    reserve_report_shot('${Y}', ry, 'image/webp', 1572865)->>'error' = 'big' and (reserve_report_shot('${Y}', ry, 'image/webp', 1572864)->>'ok')::boolean);
  update balance set value = jsonb_set(value, '{per_report}', '4') where key = 'report_shots';
  res := res || jsonb_build_object('case', 'per_report comes from balance: 4 allows a 4th', 'ok', (reserve_report_shot('${X}', rx, 'image/webp', 10)->>'n')::int = 4);
  update balance set value = jsonb_set(value, '{per_report}', '3') where key = 'report_shots';

  -- The cleanup: a fake 91-day-old screenshot and an 89-day-old one.
  insert into player_report_shots (report_id, n, path, mime, bytes, created_at, stored_at) values (ry, 8, ry || '/8.webp', 'image/webp', 5, now() - interval '91 days', now() - interval '91 days') returning id into s_old;
  insert into player_report_shots (report_id, n, path, mime, bytes, created_at, stored_at) values (ry, 9, ry || '/9.webp', 'image/webp', 5, now() - interval '89 days', now() - interval '89 days') returning id into s_new;
  res := res || jsonb_build_object('case', 'cleanup: the 91-day-old screenshot is listed with its path, the 89-day-old one and the new ones are not', 'ok',
    exists (select 1 from report_shots_expired(1000) x where x.id = s_old and x.path = ry || '/8.webp')
    and not exists (select 1 from report_shots_expired(1000) x where x.id = s_new or x.id in (select id from player_report_shots where report_id = rx)));
  update balance set value = jsonb_set(value, '{keep_days}', '30') where key = 'report_shots';
  res := res || jsonb_build_object('case', 'cleanup: keep_days comes from balance (30 lists the 89-day-old one too)', 'ok',
    exists (select 1 from report_shots_expired(1000) x where x.id = s_new));
  res := res || jsonb_build_object('case', 'cleanup: p_limit caps the list', 'ok', (select count(*) from report_shots_expired(1)) = 1);

  -- The balance limits.
  ok := true;
  foreach e in array array['{"keep_days": 0, "per_report": 3, "max_bytes": 1}', '{"keep_days": 1, "per_report": 10, "max_bytes": 1}',
                           '{"keep_days": 1, "per_report": 3, "max_bytes": 5242881}', '{"keep_days": 1.5, "per_report": 3, "max_bytes": 1}']::jsonb[] loop
    begin
      update balance set value = e where key = 'report_shots';
      ok := false;
    exception when others then null;
    end;
  end loop;
  res := res || jsonb_build_object('case', 'balance refuses keep_days 0, per_report 10, max_bytes above 5 MB, and a fraction', 'ok', ok);

  res := res || jsonb_build_object('case', 'RLS on with no policy, and the API roles cannot run the functions', 'ok',
    (select relrowsecurity from pg_class where oid = 'public.player_report_shots'::regclass)
    and not exists (select 1 from pg_policies where tablename = 'player_report_shots')
    and not has_function_privilege('anon', 'public.reserve_report_shot(text, bigint, text, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.report_shots_expired(integer)', 'execute'));
  delete from player_reports where id = ry;
  res := res || jsonb_build_object('case', 'a deleted report takes its screenshot rows with it', 'ok',
    not exists (select 1 from player_report_shots where report_id = ry));
  raise exception 'RESULTS %', res;
end $t$;`;
const out = JSON.stringify(await q(body));
const m = out.match(/RESULTS (\[.*\])/);
if (!m) { console.log('NO RESULTS:', out.slice(0, 2000)); process.exit(1); }
const results = JSON.parse(m[1].replace(/\\"/g, '"').replace(/\n.*$/, ''));
let fail = 0;
for (const r of results) { const { case: name, ok, ...rest } = r; if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(rest).slice(0, 500)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exit(fail ? 1 : 0);
