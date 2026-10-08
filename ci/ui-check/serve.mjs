// The G3 check server: the real tcg-activity/public files, the check bundle (.out/bundle), and every GET /api
// call answered from the recorded fixtures (fixtures/api.json). No database, no secrets, no member data.
//   node serve.mjs [port]            (default 4480)
// Variants (a cookie on the browser context, run.mjs sets it):
//   ci_hunt=battle   /api/hunt answers the battle state (the squad is locked)
//   ci_dungeon=choose   /api/dungeon answers a run in the "Choose a reward" step (UI-48), derived from the recorded lobby answer
//   ci_data=long     every member name becomes a 32-character name and every count a 9-digit number (12.6)
// Every non-GET request answers 403 (as the audit walkthrough): the check never writes.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { keyOf, longData } from './fixture-lib.mjs';
import { ui3Css } from '../../tcg-activity/src/ui3/css-parts.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUB = join(here, '..', '..', 'tcg-activity', 'public');
const BUNDLE = join(here, '.out', 'bundle');
const FIX = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'));
const BY_PATH = {};   // the first recorded answer for each path (the routes keep their recorded order)
for (const [k, v] of Object.entries(FIX.routes)) { const path = k.split(/[?#]/)[0]; if (!BY_PATH[path] && !k.includes('#')) BY_PATH[path] = v; }
const PORT = Number(process.argv[2] || process.env.PORT || 4480);
const bundleName = readdirSync(BUNDLE).find((f) => /^main\..*\.js$/.test(f));
const index = readFileSync(join(PUB, 'index.html'), 'utf8').replace('__BUNDLE__', bundleName).replace('__CSSV__', 'ci');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4' };
// A grey 5:7 placeholder for every card image and avatar (the layout reserves the box; the check needs no art).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAUAAAAHCAYAAADAp4fuAAAAEUlEQVR42mNkYGD4z0AEYBxVSF8AAN8VBgGrDJ8AAAAASUVORK5CYII=', 'base64');
export const misses = new Set();

// UI-48: a Dungeon run in the "Choose a reward" step. The offers cover the kinds the approved frames show
// (an Uncommon card, 10 Shards, a Ward). The squad is the first cards of the recorded collection.
function derivedDungeon(body) {
  const ids = (body.mine || []).slice(0, body.squad || 5).map((c) => c.id);
  return { ...body, run: { id: 1, status: 'active', floor: 1, room: 1, squad: ids, state: { phase: 'choose', room_type: 'fight', buff: 1, cards: {},
    pend: { shards: 1, cards: [] }, bank: { shards: 0, cards: [] },
    offers: [{ kind: 'card', tier: 2, odds: [70, 25, 5] }, { kind: 'shards', tier: 1, amount: 10 }, { kind: 'ward', tier: 1, amount: 0.1 }] } } };
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 403, '{"error":"ui-check: writes are blocked"}');
  if (p === '/' || p === '/index.html') return send(res, 200, index, 'text/html');
  if (p === '/ui3.css') return send(res, 200, ui3Css(PUB), 'text/css');   // joined as server.js does (read on each request)
  if (/^\/(main|chunk)\..*\.js$/.test(p)) return send(res, 200, readFileSync(join(BUNDLE, p.slice(1))), 'text/javascript');
  if (/^\/(api\/img|cimg|api\/avatar)\//.test(p) || /^\/cdn\//.test(p)) return send(res, 200, PNG, 'image/png');
  // The pull feed stream: open and quiet, as in production with no new pulls (a closed stream makes the client poll).
  if (p === '/api/pulls/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(': ui-check\n\n'); return undefined; }
  if (p.startsWith('/api/')) {
    const c = cookies(req);
    const key = keyOf(p, url.search) + (p === '/api/hunt' && c.ci_hunt ? `#${c.ci_hunt}` : '');
    // The exact request, else the same path with no query, else the same path with another query (another member's
    // wishlist when the long-data variant changes the order of a list: the layout is the same).
    const hit = FIX.routes[key] || FIX.routes[keyOf(p, '')] || BY_PATH[p];
    if (!hit) { misses.add(key); return send(res, 404, '{"error":"ui-check: no fixture"}'); }
    const raw = p === '/api/dungeon' && c.ci_dungeon === 'choose' && hit.body?.ok ? derivedDungeon(hit.body) : hit.body;
    const body = c.ci_data === 'long' ? longData(raw) : raw;
    return send(res, hit.status || 200, JSON.stringify(body));
  }
  const f = normalize(join(PUB, decodeURIComponent(p)));
  if (!f.startsWith(PUB) || !existsSync(f) || !statSync(f).isFile()) return send(res, 404, 'not found', 'text/plain');
  return send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`ui-check server on http://127.0.0.1:${PORT} (fixtures recorded ${FIX.recordedAt})`));
