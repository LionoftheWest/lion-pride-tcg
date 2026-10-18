// util.mjs - seeded random numbers, hashing, config loading and markdown helpers.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const HERE = dirname(fileURLToPath(import.meta.url));

// A small fast PRNG (mulberry32 variant). Same seed = same stream.
export function mkRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// FNV-1a over the parts. Used for deterministic choices (template of a card) and for per-unit random streams.
export function hash(...parts) {
  let h = 2166136261;
  for (const p of parts) { const s = String(p); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } h ^= 0x2f; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const clone = o => JSON.parse(JSON.stringify(o));
// Deep merge of a patch into a copy of the config. Arrays and scalars replace.
export function patch(base, p) {
  const out = clone(base);
  const rec = (t, s) => { for (const [k, v] of Object.entries(s)) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) rec(t[k], v); else t[k] = clone(v); } };
  rec(out, p || {});
  return out;
}
let CFG = null, FIX = null;
export function loadConfig(path) { if (!path && CFG) return CFG; const c = JSON.parse(readFileSync(path || join(HERE, 'config.json'), 'utf8')); if (!path) CFG = c; return c; }
export function loadFixture() { if (FIX) return FIX; FIX = JSON.parse(readFileSync(join(HERE, 'fixture.json'), 'utf8')); return FIX; }

// ---------- statistics ----------
export const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
export const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
export const se = a => a.length > 1 ? sd(a) / Math.sqrt(a.length - 1) : 0;
export const median = a => { const b = [...a].sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
export function ranks(a) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1; } return r; }
export function pearson(x, y) { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return dx && dy ? n / Math.sqrt(dx * dy) : 0; }
export const spearman = (x, y) => pearson(ranks(x), ranks(y));

// ---------- markdown ----------
export function fmt(x, d = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '-';
  if (typeof x !== 'number') return String(x);
  if (Number.isInteger(x)) return String(x);
  const a = Math.abs(x); return a >= 1000 ? x.toFixed(0) : a >= 100 ? x.toFixed(0) : a >= 10 ? x.toFixed(1) : x.toFixed(d);
}
export const pct = (x, d = 1) => (x === null || Number.isNaN(x)) ? '-' : (x * 100).toFixed(d) + '%';
export const ratio = (x, d = 2) => (x === null || Number.isNaN(x) || !Number.isFinite(x)) ? '-' : 'x' + x.toFixed(d);
export function table(head, rows) {
  const l = ['| ' + head.join(' | ') + ' |', '|' + head.map(() => '---').join('|') + '|'];
  for (const r of rows) l.push('| ' + r.map(c => fmt(c)).join(' | ') + ' |');
  return l.join('\n') + '\n';
}
