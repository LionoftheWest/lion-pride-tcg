// S1-FACE render-only mode (SPEC v2.4 2.8), a second render machine with no project and no keys:
//   node --import ./scripts/render-only-preload.mjs scripts/stage-faces.mjs stage --render-only --cards <f> --face-export <f> --keys <f> ...
// 1. Any import of card-studio/src/supabase.js resolves to scripts/render-only-supabase.mjs (render-only-hooks.mjs): no .env is read and
//    no Supabase client is made; every property of the stand-in throws "RENDER-ONLY: no database".
// 2. Every fetch to a host that is not this machine (127.0.0.1, localhost, ::1) throws "NET BLOCKED <host><path>".
// stage-faces.mjs refuses --render-only without this preload.
import { register } from 'node:module';

register('./render-only-hooks.mjs', import.meta.url);
globalThis.__S1FACE_RENDER_ONLY = true;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)) {
    console.log(`NET BLOCKED ${u.host}${u.pathname}`);
    process.exitCode = 5;
    throw new Error(`NET BLOCKED ${u.host}${u.pathname}`);
  }
  return realFetch(input, init);
};
