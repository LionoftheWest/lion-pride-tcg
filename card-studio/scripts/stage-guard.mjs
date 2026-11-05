// S1-FACE: the runtime write guard of the READ commands of scripts/stage-faces.mjs (SPEC 2.1, review r2 item 3).
// An ALLOW-LIST by method + host + path. Everything that is not on the list is blocked ("WRITE BLOCKED <method> <path>", exit 5):
//   a Supabase project host (*.supabase.co / *.supabase.in, or the local copy origin of the localdb preload):
//     GET          /rest/v1/<cards|subjects|statuses|player_cards>?select=...   (table reads)
//     GET or HEAD  /storage/v1/object/public/card-art/...    (public object reads: backup, the upload checks)
//     POST         /rest/v1/rpc/ability_v2_check, /rest/v1/rpc/card_element   (both STABLE: the face data)
//     POST         /storage/v1/object/list/card-art          (the storage list API: a read)
//   api.supabase.com and every other *.supabase.com host (the Management API: SQL can write): NOTHING
//   any other host: GET or HEAD only
// The client layer: .insert/.update/.upsert/.delete on any table, every write method of storage.from(...), and .rpc(<another name>)
// throw before a request is made.
export const BUCKET = 'card-art';
export const READ_RPC = new Set(['ability_v2_check', 'card_element']);
// SPEC v2.2 2.1: cards, subjects, statuses; + player_cards (only `order` reads it: the owner counts of section 5)
export const READ_TABLES = new Set(['cards', 'subjects', 'statuses', 'player_cards']);
const READ_METHODS = new Set(['GET', 'HEAD']);

/** true = the request may go. origin of the local copy: localOrigin (or null). */
export function allowed(method, url, localOrigin = null, { offline = false } = {}) {
  const u = new URL(url);
  const m = String(method || 'GET').toUpperCase();
  if (/(^|\.)supabase\.com$/i.test(u.hostname)) return false; // the Management API (SQL) and the dashboard: never
  if (offline && /(^|\.)supabase\.(co|in)$/i.test(u.hostname)) return false; // render-only mode: no Supabase request at all
  const project = /(^|\.)supabase\.(co|in)$/i.test(u.hostname) || (localOrigin !== null && u.origin === localOrigin);
  if (!project) return READ_METHODS.has(m);
  const p = u.pathname;
  if (m === 'GET' && READ_TABLES.has((p.match(/^\/rest\/v1\/([a-z0-9_]+)$/) || [])[1])) return u.searchParams.has('select');
  if (READ_METHODS.has(m)) return p.startsWith(`/storage/v1/object/public/${BUCKET}/`) && !p.includes('/../') && !/%2e%2e/i.test(p);
  if (m === 'POST') {
    const rpc = p.match(/^\/rest\/v1\/rpc\/([a-z0-9_]+)$/);
    if (rpc) return READ_RPC.has(rpc[1]);
    return p === `/storage/v1/object/list/${BUCKET}`;
  }
  return false;
}

export let blocked = null;
function block(what) {
  if (!blocked) blocked = what;
  console.log(`WRITE BLOCKED ${what}`);
  process.exitCode = 5;
  throw new Error(`WRITE BLOCKED ${what}`);
}
export const isBlocked = () => blocked;

/** The NAMED writes of swap / unswap (S1-FACE swap build). Everything else stays blocked. named = {
 *    uploads: Set of object names that may be uploaded (POST /storage/v1/object/card-art/<name>, never x-upsert: true),
 *    deletes: Set of object names that may be deleted (DELETE /storage/v1/object/card-art, every name of the body),
 *    patch:   Map card id -> Set of allowed image_url PATHS (PATCH /rest/v1/cards?id=eq.<id>&image_url=eq.<value>: a compare-and-set,
 *             the body = { image_url } only) }
 * A project host only (a Supabase host or the local copy origin). */
export function namedWrite(method, url, body, headers, localOrigin, named, pathOf) {
  if (!named) return false;
  const u = new URL(url);
  const project = /(^|\.)supabase\.(co|in)$/i.test(u.hostname) || (localOrigin !== null && u.origin === localOrigin);
  if (!project) return false;
  const p = u.pathname;
  const up = p.match(new RegExp(`^/storage/v1/object/${BUCKET}/(.+)$`));
  if (method === 'POST' && up) {
    const name = decodeURIComponent(up[1]);
    return named.uploads.has(name) && String(headerOf(headers, 'x-upsert') || 'false') !== 'true' && !name.includes('..');
  }
  if (method === 'DELETE' && p === `/storage/v1/object/${BUCKET}`) {
    let names = null;
    try { names = JSON.parse(String(body)).prefixes; } catch { return false; }
    return Array.isArray(names) && names.length > 0 && names.every((n) => named.deletes.has(n));
  }
  if (method === 'PATCH' && p === '/rest/v1/cards') {
    const id = (u.searchParams.get('id') || '').match(/^eq\.(\d+)$/);
    const cas = u.searchParams.get('image_url');
    if (!id || !cas || !cas.startsWith('eq.')) return false; // a compare-and-set only
    let b = null;
    try { b = JSON.parse(String(body)); } catch { return false; }
    if (!b || Object.keys(b).join() !== 'image_url') return false;
    const ok = named.patch.get(Number(id[1]));
    return Boolean(ok && ok.has(pathOf(b.image_url)));
  }
  return false;
}
function headerOf(h, k) {
  if (!h) return null;
  if (typeof h.get === 'function') return h.get(k);
  const key = Object.keys(h).find((x) => x.toLowerCase() === k);
  return key ? h[key] : null;
}

/** Wrap globalThis.fetch (call it before the Supabase client is made). opts.named (+ opts.pathOf): the named writes of swap/unswap. */
export function installFetchGuard(localApi = globalThis.__LOCALDB_API, opts = {}) {
  const inner = globalThis.fetch;
  const localOrigin = localApi ? new URL(localApi).origin : null;
  globalThis.fetch = async (input, init = {}) => {
    const isReq = typeof input === 'object' && !(input instanceof URL);
    const url = isReq ? input.url : String(input);
    const method = String(init.method || (isReq ? input.method : '') || 'GET').toUpperCase();
    const headers = init.headers || (isReq ? input.headers : null);
    if (!allowed(method, url, localOrigin, opts) && !namedWrite(method, url, init.body, headers, localOrigin, opts.named, opts.pathOf)) block(`${method} ${new URL(url).host}${new URL(url).pathname}`);
    return inner(input, init);
  };
}

/** Wrap the shared Supabase client (the client layer). */
export function guardClient(db) {
  const from = db.from.bind(db);
  db.from = (t) => { const q = from(t); for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => block(`${m} ${t}`); return q; };
  const rpc = db.rpc.bind(db);
  db.rpc = (fn, ...r) => (READ_RPC.has(fn) ? rpc(fn, ...r) : block(`rpc ${fn}`));
  const st = db.storage, sfrom = st.from.bind(st);
  st.from = (b) => {
    const s = sfrom(b);
    for (const m of ['uploadOrUpdate', 'upload', 'uploadToSignedUrl', 'createSignedUploadUrl', 'update', 'move', 'copy', 'remove', 'purgeCache']) s[m] = () => block(`storage ${m} ${b}`);
    return s;
  };
  return db;
}
