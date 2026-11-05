// S1-FACE render-only mode: the stand-in for card-studio/src/supabase.js (see stage-offline-loader.mjs). It reads no .env.
// Any use of the client is an error: "OFFLINE: no database (<what>)".
const fail = (what) => { throw new Error(`OFFLINE: no database (${what})`); };
export const supabase = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => fail(String(k))) });
globalThis.__S1FACE_OFFLINE_SUPABASE = true;
