/** Raw Supabase REST rate from this host: CONC workers run tiny queries for SECS seconds. */
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const CONC = Number(process.env.CONC || 100), SECS = Number(process.env.SECS || 10);
for (const conc of [1, 10, 50, CONC]) {
  const until = performance.now() + SECS * 1000; const lat = []; let err = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (performance.now() < until) {
      const t = performance.now();
      const { error } = await sb.from('hunts').select('id').limit(1);
      lat.push(performance.now() - t); if (error) err++;
    }
  }));
  lat.sort((a, b) => a - b);
  console.log(`conc ${String(conc).padStart(3)}: ${(lat.length / SECS).toFixed(0).padStart(4)} q/s  p50 ${lat[lat.length >> 1].toFixed(0)}ms  p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)}ms  errors ${err}`);
}
