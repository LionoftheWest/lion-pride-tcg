// R2-MOVE G10: the pre-flight of the R2 public domain, before S5 (spec 6.2 G10). Run it ON each serving host (the host
// must reach the domain: copy the script and the key list, run it with node there), so the check sees that host's path.
//   node r2-preflight.mjs --keys <list.json> [--base https://img.lionpridetcg.com] [--n 30] [--seed <n>]
// --keys: JSON [{ key: 'card-art/<name>', md5, type }] (the S2 manifest). 30 keys over the types png, webp, glb, webm, mp4.
// Each: GET <base>/<key>: 200, MD5 = the list MD5, Content-Type = the list type. One missing key: 404 twice in a row, and the
// second answer is NOT cf-cache-status: HIT (the Cache Rule keeps no 4xx, L4).
// Stop line: PREFLIGHT PASS n=30, else BAD lines + PREFLIGHT FAIL <n> (exit 1). No write.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const md5 = (b) => createHash('md5').update(b).digest('hex');
const EXT = (k) => (k.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
export const TYPES = ['png', 'webp', 'glb', 'webm', 'mp4'];

/** Up to n keys, round-robin over the 5 types (so each type is in the 30). */
export function pickPreflight(keys, n = 30, seed = Date.now()) {
  let s = seed >>> 0 || 1;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const by = new Map(TYPES.map((t) => [t, keys.filter((k) => EXT(k.key) === t).sort(() => rand() - 0.5)]));
  const out = [];
  for (let i = 0; out.length < n && i < n; i += 1) for (const t of TYPES) if (out.length < n && by.get(t)[i]) out.push(by.get(t)[i]);
  return out;
}

export async function preflight({ keys, base = 'https://img.lionpridetcg.com', n = 30, seed = Date.now(), fetchImpl = (...x) => fetch(...x) }) {
  const b = base.replace(/\/+$/, '');
  const bad = [];
  const pick = pickPreflight(keys.map((k) => ({ ...k, key: k.key.startsWith('card-art/') ? k.key : `card-art/${k.key}` })), n, seed);
  if (pick.length < n) bad.push(`BAD only ${pick.length} keys of the 5 types (need ${n})`);
  let ok = 0;
  for (const k of pick) {
    try {
      const r = await fetchImpl(`${b}/${k.key}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const type = (r.headers.get('content-type') || '').split(';')[0].trim();
      if (r.status !== 200) { bad.push(`BAD ${k.key} status ${r.status}`); continue; }
      if (md5(buf) !== k.md5) { bad.push(`BAD ${k.key} md5 ${md5(buf)} != ${k.md5}`); continue; }
      if (type !== k.type) { bad.push(`BAD ${k.key} type ${type} != ${k.type}`); continue; }
      ok += 1;
    } catch (e) { bad.push(`BAD ${k.key} fetch ${e.message}`); }
  }
  const missing = `${b}/card-art/_preflight/missing-${Date.now()}.webp`;
  try {
    const r1 = await fetchImpl(missing); await r1.arrayBuffer();
    const r2 = await fetchImpl(missing); await r2.arrayBuffer();
    if (r1.status !== 404 || r2.status !== 404) bad.push(`BAD missing key status ${r1.status} ${r2.status} (need 404 404)`);
    if ((r2.headers.get('cf-cache-status') || '').toUpperCase() === 'HIT') bad.push('BAD missing key: the second 404 is cf-cache-status HIT (the edge caches a 404)');
  } catch (e) { bad.push(`BAD missing key fetch ${e.message}`); }
  return { ok: bad.length === 0, bad, n: ok };
}

export const report = (r) => (r.ok ? `PREFLIGHT PASS n=${r.n}` : [...r.bad, `PREFLIGHT FAIL ${r.bad.length}`].join('\n'));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (k, d = null) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  try {
    if (!val('--keys')) throw new Error('refused: --keys <list.json> is required');
    const r = await preflight({ keys: JSON.parse(readFileSync(val('--keys'), 'utf8')), base: val('--base', 'https://img.lionpridetcg.com'),
      n: Number(val('--n', 30)), seed: Number(val('--seed', Date.now())) });
    console.log(report(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.log(e.message); process.exit(1); }
}
