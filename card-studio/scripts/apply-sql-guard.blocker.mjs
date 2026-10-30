// Test helper for apply-sql-guard.test.mjs: a preload that refuses and records every live Supabase request.
// It lets a request through only after localdb-preload.mjs has set globalThis.__LOCALDB_API (the local copy is the target).
import { appendFileSync } from 'node:fs';

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (/supabase\.(co|com)$/i.test(u.hostname) && !globalThis.__LOCALDB_API) {
    appendFileSync(process.env.BLOCKER_LOG, `${u.href}\n`);
    throw new Error('apply-sql-guard.blocker: refused a live request');
  }
  return realFetch(input, init);
};
