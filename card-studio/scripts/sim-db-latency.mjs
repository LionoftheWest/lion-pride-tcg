// Load tests only (never in production): add SIM_DB_MS of network time to every call to the database API, so the LOCAL copy
// (round trip < 1 ms) behaves like the VM talking to the Supabase project (tens of ms). The effect of a route that makes its
// database calls one after the other, or all at once, shows only with this delay.
//   SIM_DB_MS=40 LOADTEST=1 node --import ../card-studio/scripts/sim-db-latency.mjs server.js     (from tcg-activity/)
const ms = Number(process.env.SIM_DB_MS || 0);
const base = process.env.SUPABASE_URL;
if (ms > 0 && process.env.LOADTEST === '1' && base) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    if (url.startsWith(base)) await new Promise((r) => setTimeout(r, ms));
    return real(input, init);
  };
}
