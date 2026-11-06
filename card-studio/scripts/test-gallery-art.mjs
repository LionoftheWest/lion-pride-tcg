// R2-MOVE G3b (gallery): GET /api/gallery of the public gallery (gallery-deploy) and the Studio gallery (src/gallery-server.js)
// with a stub Supabase (rows with the stored logical URL).
//   GALLERY_ART=r2        every image_url and backUrl host = img.lionpridetcg.com, 0 Supabase-host URLs
//   GALLERY_ART=supabase  the stored URLs and the Supabase card back, as before (14f533ea)
//   unset / unknown / r2 without R2_PUBLIC_BASE   the server refuses to start (exit 1)
//   node scripts/test-gallery-art.mjs        prints TEST <name> PASS|FAIL, exit 1 on any FAIL
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SERVERS = { public: join(here, '..', 'gallery-deploy', 'src', 'gallery-server.js'), studio: join(here, '..', 'src', 'gallery-server.js') };
const R2 = 'https://img.lionpridetcg.com';
let failed = 0;
const check = (name, ok, info = '') => { console.log(`TEST ${name} ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ` ${info}`}`); if (!ok) failed += 1; };

// The stub Supabase: PostgREST GET /rest/v1/cards answers 2 rows with the stored logical URLs (base = this stub).
const stub = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${stub.address().port}`;
  if (req.url.startsWith('/rest/v1/cards')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([
      { name: 'Abc', rarity: 'common', image_url: `${base}/storage/v1/object/public/card-art/cards/abc-common.png?v=1730000000000`, lore: '', artist_credit: null, season: 'Season 1', event: null, subject: { name: 'Abc', key: 'abc' } },
      { name: 'Abc', rarity: 'gold', image_url: `${base}/storage/v1/object/public/card-art/cards/face2/abc-gold.webp?v=5`, lore: '', artist_credit: null, season: 'Season 1', event: null, subject: { name: 'Abc', key: 'abc' } },
    ]));
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const SUPA = `http://127.0.0.1:${stub.address().port}`;

let port = 4871;
async function run(server, extra) {
  const p = port++;
  const env = { ...process.env, SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: 'x', GALLERY_PORT: String(p), ...extra };
  for (const k of ['GALLERY_ART', 'R2_PUBLIC_BASE']) if (!(k in extra)) delete env[k];
  const child = spawn(process.execPath, [SERVERS[server]], { cwd: mkdtempSync(join(tmpdir(), 'gal-')), env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  for (let i = 0; i < 100 && !out.includes('Card Gallery') && child.exitCode == null; i += 1) await new Promise((r) => setTimeout(r, 100));
  if (child.exitCode != null || !out.includes('Card Gallery')) return { code: await exited, out };
  try {
    const j = await (await fetch(`http://127.0.0.1:${p}/api/gallery`)).json();
    return { code: null, out, json: j };
  } finally { child.kill(); await exited; }
}
const urlsOf = (j) => [...j.subjects.flatMap((s) => s.cards.map((c) => c.image_url)), j.backUrl];

for (const server of Object.keys(SERVERS)) {
  const a = await run(server, { GALLERY_ART: 'r2', R2_PUBLIC_BASE: R2 });
  const ua = a.json ? urlsOf(a.json) : [];
  check(`${server} r2: every image_url and backUrl on img.lionpridetcg.com`, ua.length === 3 && ua.every((u) => new URL(u).host === 'img.lionpridetcg.com'), JSON.stringify(ua) + a.out);
  check(`${server} r2: 0 Supabase-host URLs`, ua.length === 3 && !ua.some((u) => u.startsWith(SUPA)), JSON.stringify(ua));
  check(`${server} r2: the exact R2 URLs (key card-art/<name>, ?v kept)`, JSON.stringify(ua) === JSON.stringify([
    `${R2}/card-art/cards/abc-common.png?v=1730000000000`, `${R2}/card-art/cards/face2/abc-gold.webp?v=5`, `${R2}/card-art/cards/card-back.png`]), JSON.stringify(ua));

  const b = await run(server, { GALLERY_ART: 'supabase' });
  const ub = b.json ? urlsOf(b.json) : [];
  check(`${server} supabase: the stored URLs and the Supabase card back (as before)`, JSON.stringify(ub) === JSON.stringify([
    `${SUPA}/storage/v1/object/public/card-art/cards/abc-common.png?v=1730000000000`, `${SUPA}/storage/v1/object/public/card-art/cards/face2/abc-gold.webp?v=5`,
    `${SUPA}/storage/v1/object/public/card-art/cards/card-back.png`]), JSON.stringify(ub) + b.out);
  // I-3: the back URL of before came from supabase-js getPublicUrl. The same string:
  const { createClient } = await import('@supabase/supabase-js');
  const before = createClient(SUPA, 'x', { auth: { persistSession: false } }).storage.from('card-art').getPublicUrl('cards/card-back.png').data.publicUrl;
  check(`${server} supabase: backUrl = the getPublicUrl string of 14f533ea`, b.json && b.json.backUrl === before, `${b.json && b.json.backUrl} vs ${before}`);

  for (const [extra, msg] of [[{}, 'refused: GALLERY_ART unset'], [{ GALLERY_ART: 'r3' }, 'refused: GALLERY_ART=r3 unknown'], [{ GALLERY_ART: 'r2' }, 'needs R2_PUBLIC_BASE']]) {
    const r = await run(server, extra);
    check(`${server} start ${JSON.stringify(extra)} -> refused, exit 1`, r.code === 1 && r.out.includes(msg), `exit ${r.code} ${r.out}`);
  }
}
stub.close();
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exitCode = failed ? 1 : 0;
