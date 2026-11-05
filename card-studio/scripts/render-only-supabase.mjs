// S1-FACE render-only mode: the stand-in for card-studio/src/supabase.js (render-only-hooks.mjs). It reads no .env.
const fail = (what) => { throw new Error(`RENDER-ONLY: no database (${what})`); };
export const supabase = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : () => fail(String(k))) });
globalThis.__S1FACE_RENDER_ONLY_SUPABASE = true;
