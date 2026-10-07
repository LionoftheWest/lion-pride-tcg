/**
 * db_comments.sql must run from start to end on the database (a re-run after a merge). On 2026-10-07 a merge cut the
 * end of one DO block, so the file stopped at a syntax error, and nothing caught it: each migration carries its own
 * notes, so the notes on live were complete. This test runs the whole file in one transaction that it rolls back.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-db-comments-file.mjs
 *   ... scripts/test-db-comments-file.mjs --old   must FAIL on a copy of the file with a cut DO block (the mutation)
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.LOCALDB !== '1') { console.error('test-db-comments-file: run it on the LOCAL copy (LOCALDB=1 with the preload)'); process.exit(2); }
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const q = async (sql) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
})).json();

let file = readFileSync(fileURLToPath(new URL('../../tcg-bot/supabase/db_comments.sql', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n').replace(/notify pgrst[^\n]*\n/g, '');
if (process.argv.includes('--old')) {
  // The mutation: the defect of 2026-10-07 (the first DO block of the logs loses its end).
  const cut = file.replace(/  end if;\nend \$logs\$;\n/, '');
  if (cut === file) throw new Error('the mutation does not match');
  file = cut;
}
const r = await q(`begin;\n${file}\nrollback;`);
const ok = Array.isArray(r);
console.log(ok ? 'PASS db_comments.sql runs from start to end (rolled back)' : `FAIL db_comments.sql stops: ${JSON.stringify(r).slice(0, 300)}`);
if (!ok) process.exitCode = 1;
