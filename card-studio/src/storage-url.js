/**
 * The public address of a storage object, built from the base URL that REALLY receives the storage requests.
 * supabase-js builds getPublicUrl from its configured SUPABASE_URL (the live project), but with LOCALDB=1 the
 * preload (scripts/localdb-preload.mjs) sends every request to the local API and sets globalThis.__LOCALDB_API.
 * So an object uploaded to the local copy gets a local address, never a live one (review of #374, 2026-10-11).
 */
export function publicUrl(db, bucket, object, base = globalThis.__LOCALDB_API) {
  const url = db.storage.from(bucket).getPublicUrl(object).data.publicUrl;
  return base ? url.replace(/^https?:\/\/[^/]+/, String(base).replace(/\/+$/, '')) : url;
}
