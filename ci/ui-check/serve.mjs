// The G3 check server: the real tcg-activity/public files, the check bundle (.out/bundle), and every GET /api
// call answered from the recorded fixtures (fixtures/api.json). No database, no secrets, no member data.
//   node serve.mjs [port]            (default 4480)
// Variants (a cookie on the browser context, run.mjs sets it):
//   ci_hunt=battle   /api/hunt answers the battle state (the squad is locked)
//   ci_hunt=resting  derived from the recorded /api/hunt: no live boss, the recorded one defeated (UI-19)
//   ci_hunt=down     derived from the recorded /api/hunt: today's squad (the first 8 roster cards) is down (UI-19)
//   ci_dungeon=choose   /api/dungeon answers a run in the "Choose a reward" step (UI-48), derived from the recorded lobby answer
//   ci_dungeon=rest|path|chest|floor   the room steps and Floor cleared (UI-49)
//   ci_data=long     every member name becomes a 32-character name and every count a 9-digit number (12.6)
// Every non-GET request answers 403 (as the audit walkthrough): the check never writes. One exception: POST /api/open
// answers a fixed pack open from the fixture catalog (openAnswer below), for the reveal screens; it writes nothing.
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

// The derived states of an /api answer (a recorded body becomes a state the recording does not hold). The table keeps one
// entry for each state, registered next to its own helper below: { when: (p, c, body) => bool, make: (body, c) => newBody }.
// p = the path, c = the cookies, body = the recorded body. Every entry whose `when` is true runs, in table order.
const DERIVED = [];

// UI-48: a Dungeon run in the "Choose a reward" step. The offers cover the kinds the approved frames show
// (an Uncommon card, 10 Shards, a Shield). The squad is the first cards of the recorded collection.
// ci_dungeon=choose2: the same step with other rewards (a Heal, a damage bonus, a Revive: no odds line), to check that the panel does not change.
function derivedChoose2(body) {
  const d = derivedDungeon(body);
  d.run.state.offers = [{ kind: 'heal', tier: 3, amount: 0.4 }, { kind: 'buff', tier: 4, amount: 0.1 }, { kind: 'revive', tier: 5, amount: 0.5 }];
  return d;
}
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && c.ci_dungeon === 'choose2' && body?.ok, make: (body) => derivedChoose2(body) });
function derivedDungeon(body) {
  const ids = (body.mine || []).slice(0, body.squad || 5).map((c) => c.id);
  return { ...body, run: { id: 1, status: 'active', floor: 1, room: 1, squad: ids, state: { phase: 'choose', room_type: 'fight', buff: 1, cards: {},
    pend: { shards: 1, cards: [] }, bank: { shards: 0, cards: [] },
    offers: [{ kind: 'card', tier: 2, odds: [70, 25, 5] }, { kind: 'shards', tier: 1, amount: 10 }, { kind: 'ward', tier: 1, amount: 0.1 }] } } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && c.ci_dungeon === 'choose' && body?.ok, make: (body) => derivedDungeon(body) });
// UI-49: the other steps of a run (cookie ci_dungeon = rest | path | chest | floor): the room steps and Floor cleared, as in the
// approved frames (a real run's numbers). The loot cards are the first cards of the recorded collection with the names of the frames.
const LOOT = [['Cocky little Freak!', 'normal'], ["LionoftheWest's Tsareena", 'illustrated_rare'], ["Texafornia's Richter", 'illustrated_rare']];
function derivedRoom(body, kind) {
  const base = derivedDungeon(body);
  const mine = body.mine || [];
  const lootCards = {};
  LOOT.forEach(([name, rarity], i) => { const c = mine[i]; lootCards[c.id] = { ...c, name, rarity }; });
  const ids = Object.keys(lootCards).map(Number);
  const st = { phase: 'choose', room_type: 'fight', buff: 1, cards: {}, pend: { shards: 1, cards: [ids[0]] }, bank: { shards: 0, cards: [] }, offers: [] };
  const R = { ...base.run, floor: 1, room: 2 };
  if (kind === 'path') Object.assign(st, { phase: 'path', room_type: 'choice', offers: [{ kind: 'door', to: 'gamble' }, { kind: 'door', to: 'rest' }] });
  if (kind === 'chest') Object.assign(st, { phase: 'chest', room_type: 'treasure', chest: { tier: 4, shards: 68, card: ids[0] }, offers: [{ kind: 'continue' }] });
  if (kind === 'rest') { R.floor = 3; Object.assign(st, { phase: 'rest', room_type: 'rest', buff: 1.08, pend: { shards: 3, cards: [] }, bank: { shards: 204, cards: ids.concat(ids[0]) }, offers: [{ kind: 'continue' }] }); }
  if (kind === 'floor') { R.room = 5; Object.assign(st, { phase: 'floor_done', room_type: 'guardian', floor_loot: { shards: 150, cards: ids }, pend: { shards: 0, cards: [] }, bank: { shards: 150, cards: ids } }); }
  return { ...base, name: 'The Hollow Mines', lootCards, run: { ...R, state: st } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && ['rest', 'path', 'chest', 'floor'].includes(c.ci_dungeon) && body?.ok, make: (body, c) => derivedRoom(body, c.ci_dungeon) });

// UI-52: the Gauntlet after a run (cookie ci_dungeon = g-over): the run is over (the squad fell on floor 4), as in the approved frame:
// 4F Room 1, week best 4F R1, rank #1, 62 turns, the next run in 10:27:13. The prizes come from the recorded lobby answer.
function derivedGauntletOver(body) {
  const next = new Date(Date.parse(FIX.recordedAt) + ((10 * 60 + 27) * 60 + 13) * 1000).toISOString();
  return { ...body, next_at: next, best: { floor: 4, room: 1, rank: 1, runs: 1 }, run: { id: 1, status: 'over', ended_by: 'fell', floor: 4, room: 1, turns: 62, rank: 1, squad: (body.squad || []).map((c) => c.id), state: {} } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/gauntlet' && c.ci_dungeon === 'g-over' && body?.ok, make: (body) => derivedGauntletOver(body) });

// UI-14: a wishlist with five cards (the recorded one has five empty slots): one name per rarity label, a long name, a plain name.
function derivedWish(body) {
  const R = [['full_art', 'Full Art'], ['gold', 'Gold'], ['rare', 'Rare'], ['uncommon', 'Uncommon'], ['normal', 'Normal']];
  return { ...body, slots: body.slots.map((x, i) => ({ ...x, card: { id: 900 + i, name: i === 1 ? 'A card with a very long name for the row' : `Wish card ${i + 1}`, rarity: R[i][0], image_url: '/api/img/x' }, mine: i })), top: 1 };
}
DERIVED.push({ when: (p, c, body) => p === '/api/wishlist' && c.ci_wish === 'full' && body?.slots, make: (body) => derivedWish(body) });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

// The two Hunt states with no recording of their own, built from the recorded calls (the same cards, names and numbers).
function derivedHunt(kind, long) {
  const pick = (k) => (FIX.routes[k] || BY_PATH[k] || {}).body || {};
  const base = JSON.parse(JSON.stringify(pick('/api/hunt')));
  let out;
  if (kind === 'resting') {
    const at = new Date(new Date(FIX.recordedAt).getTime() + (3 * 24 + 23) * 3600 * 1000).toISOString();
    out = { hunt: null, lastResult: { ...base.hunt, status: 'defeated', hp_remaining: 0 }, nextSpawnAt: at,
      lastBoard: (pick('/api/hunt/leaderboard').leaders || []).slice(0, 3), myLast: base.myDamage || 0, lastFeed: pick('/api/hunt/feed').feed || [] };
  } else {
    const ids = (base.roster || []).slice(0, base.dailyCap || 8).map((c) => c.id);
    base.roster = (base.roster || []).map((c) => (ids.includes(c.id) ? { ...c, used: true, downed: true, hp: 0 } : c));
    out = { ...base, squad: ids, usedToday: ids.length };
  }
  return long ? longData(out) : out;
}

// The pack reveal screens (UI-34, UI-35) need the answer of a pack open. POST /api/open answers a fixed open made from
// the fixture catalog; nothing is written (the check has no database). 5 cards a pack; only pack 2 of a multi open
// (pack 1 of a single open) holds an SR+ card (a Full Art), so the rare clip plays on one pack (D-107). isNew on every
// second card. The Full Art is the 2nd card of its pack, so the reveal must move it to the end (D-92). The same count
// gives the same answer on every run.
const CATALOG = (FIX.routes['/api/catalog']?.body?.cards || []);
const byRarity = (r) => CATALOG.filter((c) => c.rarity === r);
export function openAnswer(count) {
  const n = [1, 5, 10].includes(count) ? count : 1;
  const pool = { normal: byRarity('normal'), illustrated_rare: byRarity('illustrated_rare'), full_art: byRarity('full_art') };
  const take = (r, i) => { const l = pool[r]; return l.length ? l[i % l.length] : CATALOG[i % CATALOG.length]; };
  const rarePack = n === 1 ? 0 : 1;
  let k = 0;
  const packs = Array.from({ length: n }, (_, p) => ['normal', p === rarePack ? 'full_art' : 'normal', 'normal', 'illustrated_rare', 'normal']
    .map((r) => { const c = take(r, k * 7 + p); k += 1;
      return { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, artist: c.artist ?? null, lore: c.lore ?? null, isNew: k % 2 === 0 }; }));
  return { award: null, packs, cards: packs.flat() };
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'POST' && p === '/api/open') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => { let count = 1; try { count = Number(JSON.parse(raw || '{}').count) || 1; } catch { /* the default */ } send(res, 200, JSON.stringify(openAnswer(count))); });
    return undefined;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 403, '{"error":"ui-check: writes are blocked"}');
  if (p === '/' || p === '/index.html') return send(res, 200, index, 'text/html');
  if (p === '/ui3.css') return send(res, 200, ui3Css(PUB), 'text/css');   // joined as server.js does (read on each request)
  if (/^\/(main|chunk)\..*\.js$/.test(p)) return send(res, 200, readFileSync(join(BUNDLE, p.slice(1))), 'text/javascript');
  if (/^\/(api\/img|cimg|api\/avatar)\//.test(p) || /^\/cdn\//.test(p)) return send(res, 200, PNG, 'image/png');
  // The pull feed stream: open and quiet, as in production with no new pulls (a closed stream makes the client poll).
  if (p === '/api/pulls/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(': ui-check\n\n'); return undefined; }
  if (p.startsWith('/api/')) {
    const c = cookies(req);
    if (p === '/api/hunt' && (c.ci_hunt === 'resting' || c.ci_hunt === 'down')) return send(res, 200, JSON.stringify(derivedHunt(c.ci_hunt, c.ci_data === 'long')));
    const key = keyOf(p, url.search) + (p === '/api/hunt' && c.ci_hunt ? `#${c.ci_hunt}` : '');
    // The exact request, else the same path with no query, else the same path with another query (another member's
    // wishlist when the long-data variant changes the order of a list: the layout is the same).
    const hit = FIX.routes[key] || FIX.routes[keyOf(p, '')] || BY_PATH[p];
    if (!hit) { misses.add(key); return send(res, 404, '{"error":"ui-check: no fixture"}'); }
    const body0 = DERIVED.reduce((b, d) => (d.when(p, c, b) ? d.make(b, c) : b), hit.body);
    const body = c.ci_data === 'long' ? longData(body0) : body0;
    return send(res, hit.status || 200, JSON.stringify(body));
  }
  const f = normalize(join(PUB, decodeURIComponent(p)));
  if (!f.startsWith(PUB) || !existsSync(f) || !statSync(f).isFile()) return send(res, 404, 'not found', 'text/plain');
  return send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`ui-check server on http://127.0.0.1:${PORT} (fixtures recorded ${FIX.recordedAt})`));
