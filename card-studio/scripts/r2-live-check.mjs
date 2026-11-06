// R2-MOVE G6 (after S5): the members' read path of one serving host. Also the G7 / G8 checker (`--expect supabase`).
//   node card-studio/scripts/r2-live-check.mjs --keys <list.json> [--base <img base>] [--gallery <gallery base>]
//        [--expect r2|supabase] [--v r2m1] [--r2-base https://img.lionpridetcg.com] [--seed <n>]
// --keys: the R2 key list with the MD5 of each key (the S4 manifest, or the write-log MD5 for a newer key):
//   JSON [{ key: 'card-art/<name>', md5, type }] (r2-verify / the manifest). The checker makes no write.
// --base: default https://play.lionpridetcg.com/app/api/img (the tunnel). A host that is not behind the tunnel: run the
//   checker ON that host with --base http://127.0.0.1:4441/api/img.
// expect r2 (G6): keys = the card back (2), sets/*, every boss/*, and 100 random cards/ grid/ reveal/ keys.
//   GET <base>/storage/v1/object/public/<key>?v=<v>. Pass: 200, MD5 = the list MD5, and on this FIRST fetch
//   X-Img-Source: r2 or X-Boss-Source: vm. ONE fixed v (r2m1) so each host caches each test key once (L1). A run again on
//   the same host is a cache hit (no header): give a new --v (r2m2 ...).
//   Gallery: GET <gallery>/api/gallery: every image_url and backUrl = <r2-base>/card-art/<key>, each key in the list; the
//   client thumb() rule (gallery-deploy/public-gallery/gallery.js:75-76) of each image_url gives a grid key in the list;
//   10 of the URLs fetched directly with MD5 = the list MD5. Stop line: R2LIVE PASS n=<k>.
// expect supabase (G7 after S1, G8 "back to supabase"): <base>/../config has "img":"supabase"; 20 random keys answer 200
//   with X-Img-Source absent or supabase; every gallery URL host = the Supabase host. Stop line: SUPABASE-MODE PASS n=<k>.
// Any failure: one BAD line each, then R2LIVE FAIL <n> (or SUPABASE-MODE FAIL <n>), exit 1.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SUPABASE_HOST = 'https://kgvdqqehefezbypozvrh.supabase.co';
export const R2_BASE = 'https://img.lionpridetcg.com';
const BACKS = ['card-art/cards/card-back.png', 'card-art/grid/cards/card-back.webp'];
// gallery.js:75-76 (the client grid copy)
const PARTS = /\/card-art\/(cards\/[^?]+?)\.(png|webp|jpe?g)(\?|$)/i;
export const thumb = (url) => String(url || '').replace(PARTS, '/card-art/grid/$1.webp$3');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const norm = (k) => (k.startsWith('card-art/') ? k : `card-art/${k}`);

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function sample(list, n, rand) { const a = [...list]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }

export function pickKeys(keys, { expect = 'r2', seed = Date.now() } = {}) {
  const rand = rng(seed);
  const all = keys.map((k) => k.key);
  const art = all.filter((k) => /^card-art\/(cards|grid|reveal)\//.test(k) && !BACKS.includes(k));
  if (expect === 'supabase') return sample(art, 20, rand);
  return [...BACKS.filter((k) => all.includes(k)), ...all.filter((k) => k.startsWith('card-art/sets/')),
    ...all.filter((k) => k.startsWith('card-art/boss/')), ...sample(art, 100, rand)];
}

async function galleryUrls(gallery, fetchImpl) {
  const r = await fetchImpl(`${gallery.replace(/\/+$/, '')}/api/gallery`);
  if (!r.ok) throw new Error(`gallery ${r.status}`);
  const j = await r.json();
  const urls = [];
  for (const s of j.subjects || []) for (const c of s.cards || []) urls.push(c.image_url);
  return { images: urls, back: j.backUrl };
}

export async function liveCheck({ keys, base = 'https://play.lionpridetcg.com/app/api/img', gallery = null, expect = 'r2', v = 'r2m1',
  r2Base = R2_BASE, supabaseHost = SUPABASE_HOST, seed = Date.now(), fetchImpl = (...x) => fetch(...x) }) {
  const list = keys.map((k) => ({ ...k, key: norm(k.key) }));
  const byKey = new Map(list.map((k) => [k.key, k]));
  const bad = [];
  const b = base.replace(/\/+$/, '');
  let n = 0;
  if (expect === 'supabase') {
    try {
      const c = await (await fetchImpl(b.replace(/\/img$/, '/config'))).json();
      if (c.img !== 'supabase') bad.push(`BAD config img=${c.img === undefined ? '(none)' : c.img}`);
    } catch (e) { bad.push(`BAD config ${e.message}`); }
  }
  for (const key of pickKeys(list, { expect, seed })) {
    let r;
    try { r = await fetchImpl(`${b}/storage/v1/object/public/${key}?v=${encodeURIComponent(v)}`); } catch (e) { bad.push(`BAD ${key} fetch ${e.message}`); continue; }
    const src = r.headers.get('x-img-source'), boss = r.headers.get('x-boss-source');
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    if (r.status !== 200) { bad.push(`BAD ${key} status ${r.status}`); continue; }
    if (expect === 'r2') {
      if (!(src === 'r2' || boss === 'vm')) bad.push(`BAD ${key} source ${src || boss || '(none: a cache hit or not r2)'}`);
      if (md5(buf) !== byKey.get(key).md5) bad.push(`BAD ${key} md5 ${md5(buf)} != ${byKey.get(key).md5}`);
    } else if (src && src !== 'supabase') bad.push(`BAD ${key} source ${src} (expect supabase)`);
    n += 1;
  }
  if (gallery) {
    let g;
    try { g = await galleryUrls(gallery, fetchImpl); } catch (e) { bad.push(`BAD gallery ${e.message}`); g = { images: [], back: null }; }
    const urls = [...g.images, g.back];
    if (expect === 'supabase') {
      for (const u of urls) if (!String(u).startsWith(`${supabaseHost}/`)) bad.push(`BAD gallery url host ${u}`);
    } else {
      const prefix = `${r2Base.replace(/\/+$/, '')}/`;
      const keyOf = (u) => (String(u).startsWith(prefix) ? String(u).slice(prefix.length).split('?')[0] : null);
      for (const u of urls) {
        const k = keyOf(u);
        if (!k || !k.startsWith('card-art/')) { bad.push(`BAD gallery url host ${u}`); continue; }
        if (!byKey.has(k)) bad.push(`BAD gallery key not in R2 ${k}`);
      }
      for (const u of g.images) {
        const k = keyOf(thumb(u));
        if (k && !byKey.has(k)) bad.push(`BAD gallery grid key not in R2 ${k}`);
      }
      for (const u of sample(urls.filter((x) => keyOf(x) && byKey.has(keyOf(x))), 10, rng(seed))) {
        try {
          const r = await fetchImpl(u);
          const buf = Buffer.from(await r.arrayBuffer());
          if (r.status !== 200 || md5(buf) !== byKey.get(keyOf(u)).md5) bad.push(`BAD gallery fetch ${u} ${r.status}`);
          else n += 1;
        } catch (e) { bad.push(`BAD gallery fetch ${u} ${e.message}`); }
      }
    }
  }
  return { ok: bad.length === 0, bad, n, expect };
}

export function report(r) {
  const name = r.expect === 'supabase' ? 'SUPABASE-MODE' : 'R2LIVE';
  return r.ok ? `${name} PASS n=${r.n}` : [...r.bad, `${name} FAIL ${r.bad.length}`].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (k, d = null) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  try {
    if (!val('--keys')) throw new Error('refused: --keys <list.json> is required');
    const r = await liveCheck({
      keys: JSON.parse(readFileSync(val('--keys'), 'utf8')), base: val('--base', undefined) || undefined, gallery: val('--gallery'),
      expect: val('--expect', 'r2'), v: val('--v', 'r2m1'), r2Base: val('--r2-base', R2_BASE), seed: Number(val('--seed', Date.now())),
    });
    console.log(report(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.log(e.message); process.exit(1); }
}
