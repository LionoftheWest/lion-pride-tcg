// Run a database script against the LOCAL Supabase copy instead of the live project (Nathan,
// 2026-10-02: the tests should not cost live log lines or put test rows next to real players).
//   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-hall-auctions.mjs
// The scripts stay as they are. This preload changes fetch():
// - the Management API SQL endpoint (api.supabase.com/v1/projects/<ref>/database/query) goes to the
//   local postgres-meta POST /query; its error answer gets the Management API shape;
// - the live project URL (https://<ref>.supabase.co/...) goes to the local API, with the local
//   service role key in place of the live one (supabase-js too: it uses the global fetch);
// - ANY other request to a supabase.co / supabase.com host is REFUSED (fail closed: a test can never
//   reach the live project by mistake).
// The local values come from LOCALDB_ENV (default %TEMP%/localdb.env, written by the tools' localdb/up.sh):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PGMETA_URL.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

if (process.env.LOCALDB === '1') {
  const file = process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env');
  const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PGMETA_URL']) if (!env[k]) throw new Error(`localdb-preload: ${k} missing in ${file}`);
  const API = env.SUPABASE_URL.replace(/\/+$/, ''), KEY = env.SUPABASE_SERVICE_ROLE_KEY, META = env.PGMETA_URL.replace(/\/+$/, '');
  const realFetch = globalThis.fetch;
  const LIVE_HOST = /(^|\.)supabase\.(co|com|in)$/i;
  const SQL = /^https:\/\/api\.supabase\.com\/v1\/projects\/[^/]+\/database\/query$/;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (SQL.test(url.origin + url.pathname)) {
      // Run as postgres, like the live Management API: postgres-meta connects as supabase_admin, so a function made
      // locally had another owner than live, and the schema snapshot drifted (#252 balance_check_settings).
      let body = init.body;
      try { const j = JSON.parse(body); if (typeof j.query === 'string') body = JSON.stringify({ ...j, query: `set role postgres;
${j.query}` }); } catch { /* not JSON: as it is */ }
      const r = await realFetch(`${META}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const text = await r.text();
      if (r.ok) return new Response(text, { status: 201, headers: { 'Content-Type': 'application/json' } });
      let msg = text; try { msg = JSON.parse(text).error || text; } catch { /* the raw text */ }
      return new Response(JSON.stringify({ message: `Failed to run sql query: ${msg}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (/\.supabase\.co$/i.test(url.hostname)) {
      const local = new URL(url.pathname + url.search, API);
      const headers = new Headers(init.headers || (typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined));
      if (headers.has('apikey')) headers.set('apikey', KEY);
      if (headers.has('authorization')) headers.set('authorization', `Bearer ${KEY}`);
      return realFetch(local, { ...init, headers });
    }
    if (LIVE_HOST.test(url.hostname)) throw new Error(`localdb-preload: refused a live Supabase request (${url.hostname}${url.pathname})`);
    return realFetch(input, init);
  };
  if (!process.env.LOCALDB_QUIET) console.error(`[localdb] this run uses the LOCAL copy (${API}); live Supabase requests are refused`);
}
