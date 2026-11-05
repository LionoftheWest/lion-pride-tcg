// S1-FACE render-only mode: the module resolve hook of render-only-preload.mjs. card-studio/src/supabase.js -> render-only-supabase.mjs.
const STUB = new URL('./render-only-supabase.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (/\/card-studio\/src\/supabase\.js$/.test(r.url.replace(/\\/g, '/'))) return { ...r, url: STUB, shortCircuit: true };
  return r;
}
