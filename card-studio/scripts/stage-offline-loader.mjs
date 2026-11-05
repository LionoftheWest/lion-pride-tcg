// S1-FACE render-only mode (stage --offline): a module loader hook. Any import of card-studio/src/supabase.js resolves to
// scripts/stage-offline-supabase.mjs instead, so the render machine needs no .env and never makes a Supabase client.
// Registered by stage-faces.mjs (node:module register) before it imports src/push.js.
const STUB = new URL('./stage-offline-supabase.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (/\/card-studio\/src\/supabase\.js$/.test(r.url.replace(/\\/g, '/'))) return { ...r, url: STUB, shortCircuit: true };
  return r;
}
