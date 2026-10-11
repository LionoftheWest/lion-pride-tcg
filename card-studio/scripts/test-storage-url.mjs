/**
 * Review of #374: a stored storage address comes from the base URL that received the upload, never from the live
 * SUPABASE_URL when the requests go to the local copy. No network:
 *   node scripts/test-storage-url.mjs                                         (the helper with a given base)
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-storage-url.mjs   (also the preload's base)
 * Invariants:
 *   - with the local storage base, the address starts with the local base and keeps the object path;
 *   - with no base (live), the address is the client's own (the live project);
 *   - under the preload (test-all-local.mjs runs it so), the default base is the local API of localdb.env.
 */
import { createClient } from '@supabase/supabase-js';
import { publicUrl } from '../src/storage-url.js';

const res = [];
const check = (name, ok, extra = '') => res.push({ name, ok: Boolean(ok), extra });
const LIVE = 'https://kgvdqqehefezbypozvrh.supabase.co';
const db = createClient(LIVE, 'unused-key', { auth: { persistSession: false } });
const PATH = '/storage/v1/object/public/card-art/packs/S2T-clip.webp';

const local = publicUrl(db, 'card-art', 'packs/S2T-clip.webp', 'http://127.0.0.1:54321/');
check('with the local base, the address starts with the local base', local === `http://127.0.0.1:54321${PATH}`, local);
const live = publicUrl(db, 'card-art', 'packs/S2T-clip.webp', null);
check('with no base, the address is the live one', live === `${LIVE}${PATH}`, live);
if (process.env.LOCALDB === '1') {
  const base = globalThis.__LOCALDB_API;
  const dflt = publicUrl(db, 'card-art', 'packs/S2T-clip.webp');
  check('under the preload, the default base is the local API (not the live host)', base && /^http:\/\/(127\.0\.0\.1|localhost)/.test(base) && dflt.startsWith(base) && !dflt.includes('supabase.co'), `${base} ${dflt}`);
}

let fails = 0;
for (const x of res) { if (!x.ok) fails += 1; console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.ok ? '' : `  ${x.extra}`}`); }
console.log(`\n${res.length - fails}/${res.length} pass, FAILS ${fails}`);
process.exitCode = fails ? 1 : 0;
