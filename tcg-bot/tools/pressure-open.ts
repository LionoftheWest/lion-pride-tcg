/**
 * Open-path pressure test WITHOUT a second Discord login: N scratch players (lt_open_*)
 * each open COUNT packs at the same time through openPacks() (the code the internal /open
 * endpoint runs). Run on the VM in a one-off container of the bot image:
 *   npx tsx tools/pressure-open.ts <players=100> <count=10>
 */
import { openPacks } from '../src/store.js';

const N = Number(process.argv[2] || 100), COUNT = Number(process.argv[3] || 10);
const t0 = performance.now();
const res = await Promise.all(Array.from({ length: N }, async (_, i) => {
  const id = `lt_open_${String(i).padStart(4, '0')}`, s = performance.now();
  try { const packs = await openPacks(id, `zzz_loadtest_${i}`, COUNT); return { ms: performance.now() - s, packs: packs.length, err: '' }; }
  catch (e) { return { ms: performance.now() - s, packs: 0, err: String((e as Error).message).slice(0, 80) }; }
}));
const wall = (performance.now() - t0) / 1000;
const lat = res.map((r) => r.ms).sort((a, b) => a - b);
const p = (q: number) => lat[Math.min(lat.length - 1, Math.floor((q / 100) * lat.length))] ?? 0;
const packs = res.reduce((t, r) => t + r.packs, 0);
const errs = res.filter((r) => r.err);
console.log(`\nOPEN ${N} players x ${COUNT} packs via openPacks(): ${packs} packs in ${wall.toFixed(1)}s = ${(packs / wall).toFixed(1)} packs/s`);
console.log(`  per request p50 ${p(50).toFixed(0)}ms p95 ${p(95).toFixed(0)}ms max ${p(100).toFixed(0)}ms | errors ${errs.length} ${JSON.stringify([...new Set(errs.map((e) => e.err))].slice(0, 3))}\n`);
process.exit(0);
