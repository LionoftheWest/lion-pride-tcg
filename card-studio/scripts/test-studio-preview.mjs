/**
 * "Render real look" (server.js /api/preview, 2026-10-16): the tier editor renders an animated tier on this PC with the
 * same code as a push (push.js renderTier), and uploads nothing. Runs Blender once (about 1 minute).
 * No real database, no network: the Supabase client talks to a mock fetch, cards.json is a temp file (CARDS_FILE).
 *   node scripts/test-studio-preview.mjs
 * Invariants:
 *   P1 a still tier (Normal) and a tier with no art are refused before any render
 *   P2 an animated tier renders the real animation (500x700, 24 frames) and sends NO request to Supabase
 *   P3 GET answers the render while it is newer than the card's last edit; an edit makes it old
 *   P4 a second render while one runs is refused (409): Blender runs once at a time
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'studio-preview-'));
const file = join(dir, 'cards.json');
const ID = 'tst-preview-card';
const seed = { id: ID, name: 'Preview Card', genre: 'Party Games', type: 'Character', set: 'S2', season: 'Season 2',
  finishes: ['normal', 'secret_rare', 'full_art'], tags: { class: 'attacker', type: 'character' }, updatedAt: Date.now() - 60_000 };
const writeCards = (c) => writeFileSync(file, JSON.stringify([c], null, 2));
const readCard = () => JSON.parse(readFileSync(file, 'utf8'))[0];
writeCards(seed);
Object.assign(process.env, { CARDS_FILE: file, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-key', STUDIO_USER: '', STUDIO_PASS: '', LOCALDB: '', ADMIN_VIEW: '0' });

// Every request to the mock Supabase is logged: the preview must send none.
const log = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname !== '127.0.0.1' || u.port !== '9') return realFetch(url, init);
  log.push(`${init.method || 'GET'} ${u.pathname}`);
  return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
};

// The art of the Full Art tier only (the Secret Rare tier has none): a test picture in art/, removed at the end.
const art = join(ROOT, 'art', `${ID}-full_art.png`);
await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#2a6' } }).png().toFile(art);

const { app } = await import('../src/server.js');
const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, path) => { const r = await realFetch(base + path, { method }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  [${JSON.stringify(detail)}]`}`); };

try {
  const still = await call('POST', `/api/preview/${ID}/normal`);
  check('P1 a still tier is refused (400)', still.status === 400, still);
  const noArt = await call('POST', `/api/preview/${ID}/secret_rare`);
  check('P1 a tier with no art is refused (400)', noArt.status === 400, noArt);
  const before = await call('GET', `/api/preview/${ID}/full_art`);
  check('P3 no render yet: not fresh', before.status === 200 && before.body.fresh === false, before.body);

  const [first, second] = await Promise.all([call('POST', `/api/preview/${ID}/full_art`),
    new Promise((r) => setTimeout(r, 300)).then(() => call('POST', `/api/preview/${ID}/full_art`))]);
  check('P2 the render answers 200 with an image address', first.status === 200 && first.body.ok && /\/image\?t=\d+$/.test(first.body.url), first.body);
  check('P4 a second render while one runs is refused (409)', second.status === 409, second);

  const img = await call('GET', first.body.url);
  const meta = img.status === 200 ? await sharp(img.body, { animated: true }).metadata() : {};
  check('P2 the image is the real animation (500x700, 24 frames)', meta.width === 500 && meta.pageHeight === 700 && meta.pages === 24, meta);
  check('P2 no request reached Supabase (no upload, no row)', log.length === 0, log);

  const fresh = await call('GET', `/api/preview/${ID}/full_art`);
  check('P3 after the render: fresh, with the same address', fresh.body.fresh === true && fresh.body.url === first.body.url, fresh.body);
  writeCards({ ...readCard(), updatedAt: Date.now() + 1000 });
  const stale = await call('GET', `/api/preview/${ID}/full_art`);
  check('P3 an edit after the render makes it old', stale.body.fresh === false && stale.body.url === null, stale.body);
} finally {
  srv.close();
  rmSync(art, { force: true });
  const out = join(ROOT, 'out', 'preview');
  for (const f of [`${ID}-full_art.webp`]) rmSync(join(out, f), { force: true });
  rmSync(join(out, 'work', `frames-${ID}-full_art`), { recursive: true, force: true });
  for (const f of ['full_art.png', 'full_art.webp', 'full_art-mask.png']) rmSync(join(out, 'work', `${ID}-${f}`), { force: true });
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exitCode = fail ? 1 : 0;
if (existsSync(art)) console.log('note: the test art was not removed');
