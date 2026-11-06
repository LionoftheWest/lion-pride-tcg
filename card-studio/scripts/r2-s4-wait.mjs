// R2-MOVE S4 step 1: after the Stager wrote FROZEN, wait until no logical write of the art store is in flight.
//   node scripts/r2-s4-wait.mjs [--timeout-min 10] [--poll-s 5]
// Refuses without FROZEN (a wait without the freeze proves nothing). A dead process's in-flight file is reported as
// `STALE-INFLIGHT <file> <label>` and removed (paste it in logs/s4.txt; that write goes to the step-3 FAIL rule).
// Stop line: `INFLIGHT EMPTY t0=<iso> waited=<s>s stale=<n>` (T0 = the time inflight became empty), exit 0;
// after the timeout `INFLIGHT TIMEOUT left=<n>` + the files, exit 1 (then stop S4 and remove FROZEN, spec 6.1 S4).
import { readState, waitInflight } from '../src/art-store.js';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const s = readState();
if (!s.frozen) {
  console.log(`refused: no FROZEN in ${s.dir} (write it first, spec 6.1 S4 step 1)`);
  process.exitCode = 1;
} else {
  const r = await waitInflight({ timeoutMs: arg('--timeout-min', 10) * 60_000, pollMs: arg('--poll-s', 5) * 1000 });
  if (r.ok) console.log(`INFLIGHT EMPTY t0=${new Date().toISOString()} waited=${Math.round(r.waitedMs / 1000)}s stale=${r.stale.length}`);
  else { console.log(`INFLIGHT TIMEOUT left=${r.left.length}`); for (const f of r.left) console.log(`  ${f}`); }
  process.exitCode = r.ok ? 0 : 1;
}
