// The G3 check server: the real tcg-activity/public files, the check bundle (.out/bundle), and every GET /api
// call answered from the recorded fixtures (fixtures/api.json). No database, no secrets, no member data.
//   node serve.mjs [port]            (default 4480)
// Variants (a cookie on the browser context, run.mjs sets it):
//   ci_hunt=battle   /api/hunt answers the battle state (the squad is locked)
//   ci_hunt=resting  derived from the recorded /api/hunt: no live boss, the recorded one defeated (UI-19)
//   ci_hunt=down     derived from the recorded /api/hunt: today's squad (the first 8 roster cards) is down (UI-19)
//   ci_dungeon=choose   /api/dungeon answers a run in the "Choose a reward" step (UI-48), derived from the recorded lobby answer
//   ci_board=rows|empty|error   the 4 Leaderboard answers (UI-66): rows = a board with many rows, empty = no rows, error = HTTP 500 (derived below)
//   ci_dungeon=rest|path|chest|floor   the room steps and Floor cleared (UI-49)
//   ci_dungeon=fight|fight2   a Dungeon fight with 5 or 2 monsters (UI-47); ci_dungeon=over the run over (UI-50)
//   ci_fx=hist|day|member   the Boons tab (UI-27): my play history, the day limit used up, a member at the pair cap
//   ci_trades=few   /api/trades answers 2 incoming and 3 sent offers, /api/trade/partners answers one partner (UI-25: Pending, few partners)
//   ci_notes=many   /api/notifications answers 45 notes (UI-24, D-144)
//   ci_home=busy|live   Home (UI-03): pulls from the catalog (/api/pulls) and a presence list (run.mjs sends it on the room socket);
//                       busy = a resting hunt with a last result, live = the recorded live hunt
//   ci_data=long     every member name becomes a 32-character name and every count a 9-digit number (12.6)
//   ci_report=on     /api/flags answers reports: true (the Feedback window, UI-40); the send stays blocked (403), so a send shows the error state
//   ci_data=long    every member name becomes a 32-character name and every count a 9-digit number (12.6)
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
// UI-66: the Leaderboard answers of a board state. The recorded answers have 2 Hunt rows and an empty Dungeon board (no
// Gauntlet board): 'rows' gives each tab a list long enough to page, with the member's own row inside it.
const BOARD_PATHS = new Set(['/api/leaderboard/v2', '/api/hunt/leaderboard', '/api/dungeon/board', '/api/gauntlet/board']);
function derivedBoard(p, mode, me, last = false) {
  const id = (i) => String(100000000000000100n + BigInt(i));
  const name = (i) => `Member ${String(100 + i).padStart(3, '0')}`;
  if (mode === 'empty') return p === '/api/hunt/leaderboard' ? (last ? { leaders: [], me, boss: null } : { leaders: [], me }) : { ok: true, board: [], me };
  // D-178: ?last=1 = the final standings of the last boss (the same shape, with the boss)
  if (p === '/api/hunt/leaderboard' && last) return { leaders: Array.from({ length: 20 }, (_, i) => ({ player_id: i === 3 ? me : id(i + 30), username: name(i + 30), damage: 6100 - i * 240 })), me, boss: { name: 'Warden of the Hollow Deep', tier: 'Heroic', status: 'defeated' } };
  if (p === '/api/hunt/leaderboard') return { leaders: Array.from({ length: 24 }, (_, i) => ({ player_id: i === 7 ? me : id(i), username: name(i), damage: 4700 - i * 190 })), me };
  return { ok: true, me, board: Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, player_id: i === 0 ? me : id(i), username: name(i), floor: 5 - (i >> 2), room: 1 + (i % 3), turns: 27 + i * 3, runs: 1 + (i % 2), status: i === 3 ? 'active' : 'done' })) };
}
const TITLE = 'the Unbreakable Champion of the Realm';
function withTitles(p, body, FIX) {
  if (p === '/api/leaderboard/v2' && Array.isArray(body?.rows)) return { ...body, rows: body.rows.map((r) => ({ ...r, title: 'Season 1 Champion' })) };
  if (p === '/api/effects/badges') {
    const ids = [...(FIX.routes['/api/leaderboard/v2']?.body?.rows || []).map((r) => r.id), ...Array.from({ length: 40 }, (_, i) => String(100000000000000100n + BigInt(i)))];
    // the signed-in member is left out: Home (behind the window) shows that name too, and its own layout is not under test here
    return { badges: Object.fromEntries(ids.filter((id) => id !== '100000000000000001').map((id) => [id, { title: TITLE, sticker: null, spotlight: false }])) };
  }
  return body;
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

// UI-10: the Collection with every owned card ready to ascend (ascend) or with 2 free stat points (points) (cookie ci_col=ascend | points). The write calls answer 403,
// so an Ascend or a Save shows the real error path. The recording has no card with stat points.
function derivedCol(body, kind) {
  const hp = (c) => Math.round((c.power || 0) * 3);
  return { ...body, cards: body.cards.map((c) => {
    if (!(c.quantity > 0)) return c;
    if (kind.startsWith('ascend')) return { ...c, quantity: Math.max(c.quantity, 3), can_ascend: c.next_cost != null };
    return { ...c, stat: { cp: c.power || 0, hp: hp(c), crit: 0, free: 2, points: {} } };   // 'points'
  }) };
}
DERIVED.push({ when: (p, c, body) => p === '/api/collection' && ['ascend', 'ascend-ok', 'points'].includes(c.ci_col) && body?.cards, make: (body, c) => derivedCol(body, c.ci_col) });
// UI-52: the Gauntlet after a run (cookie ci_dungeon = g-over): the run is over (the squad fell on floor 4), as in the approved frame:
// 4F Room 1, week best 4F R1, rank #1, 62 turns, the next run in 10:27:13. The prizes come from the recorded lobby answer.
function derivedGauntletOver(body) {
  const next = new Date(Date.parse(FIX.recordedAt) + ((10 * 60 + 27) * 60 + 13) * 1000).toISOString();
  return { ...body, next_at: next, best: { floor: 4, room: 1, rank: 1, runs: 1 }, run: { id: 1, status: 'over', ended_by: 'fell', floor: 4, room: 1, turns: 62, rank: 1, squad: (body.squad || []).map((c) => c.id), state: {} } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/gauntlet' && c.ci_dungeon === 'g-over' && body?.ok, make: (body) => derivedGauntletOver(body) });

// UI-05: the Home slides with a Top 3 (cookie ci_dungeon = top): three runs today and three members this week (the Dungeon and Gauntlet slides draw the board rows).
const TOP3 = [{ rank: 1, username: 'Member B', floor: 6, room: 3 }, { rank: 2, username: 'Member C', floor: 5, room: 2 }, { rank: 3, username: 'Member D', floor: 3, room: 1 }];
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && c.ci_dungeon === 'top' && body?.ok, make: (body) => ({ ...body, top: TOP3, runs_today: 3 }) });
DERIVED.push({ when: (p, c, body) => p === '/api/gauntlet' && c.ci_dungeon === 'top' && body?.ok, make: (body) => ({ ...body, top: TOP3, players_week: 3 }) });

// UI-47: a Dungeon fight (cookie ci_dungeon = fight | fight2): the 5-monster horde and a 2-monster room, with 3 attackers and
// 2 supports, the numbers of the approved frames (run 1879, squad HP 320 / 392). ci_dungeon=over: the run over (UI-50).
const FOES5 = [['skeleton', 'Water Skeleton', 'water', 50, ['caster']], ['squidle', 'Earth Squid', 'earth', 0, ['hero']], ['goleling', 'Water Golem', 'water', 85, ['agile']],
  ['dino', 'Lightning Raptor', 'lightning', 50, ['strong']], ['blue_demon', 'Ice Demon', 'ice', 55, ['strong']]];
function derivedFight(body, kind) {
  const base = derivedDungeon(body);
  const mine = body.mine || [];
  const atk = mine.filter((c) => ['Character', 'Creature'].includes(c.type)).slice(0, 3);
  const sup = mine.filter((c) => c.ability?.kind === 'support' && ['heal', 'shield', 'empower'].includes(c.ability.effect)).slice(0, 2);
  const cards = {};
  [[48, 72, 14], [119, 128, 1], [52, 72, 14]].forEach(([hp, max, shield], i) => { cards[atk[i].id] = { hp, max, shield, cd: 0 }; });
  [[51, 60, 12], [50, 60, 12]].forEach(([hp, max, shield], i) => { cards[sup[i].id] = { hp, max, shield, cd: 0 }; });
  const list = kind === 'fight2' ? FOES5.slice(0, 2) : FOES5;
  const foes = list.map(([key, name, element, max, passives], i) => ({ key, name, element, level: 2, hp: max, max: max || 45, sh: 0, st: 0,
    weak: [{ value: 'lightning' }, { value: `trait:${passives[0]}` }], resist: [{ value: 'fire' }], passives: [] }));
  if (kind !== 'fight2') foes[1].hp = 0;
  const R = { ...base.run, floor: 2, room: 4, squad: atk.concat(sup).map((c) => c.id) };
  const st = { phase: 'fight', room_type: 'horde', round: 0, buff: 1.23, cards, foes, pend: { shards: 0, cards: [] }, bank: { shards: 0, cards: [] }, sup_round: -1 };
  return { ...base, name: 'The Hollow Mines', run: { ...R, state: st } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && ['fight', 'fight2'].includes(c.ci_dungeon) && body?.ok, make: (body, c) => derivedFight(body, c.ci_dungeon) });
// UI-52: a Gauntlet fight (cookie ci_dungeon = g-fight): the week's squad (3 attackers, 2 supports) against the 5-monster horde of the
// approved frames; floor 2, room 4 of 5, week best 4F R1, damage +23%. The squad cards come from the recorded lobby answer.
function derivedGauntletFight(body) {
  // the two supports heal an ally (the approved frames), so that a support can be picked and then a card (D-70)
  const heal = (c, name) => ({ ...c, name, ability: { ...(c.ability || {}), kind: 'support', effect: 'heal', amount: 0.3, target: 'ally' } });
  const sq = (body.squad || []).map((c, i) => (i === 3 ? heal(c, "I'll get it back, don't worry") : i === 4 ? heal(c, "Zeoic's Redstone Machine") : c));
  const cards = {};
  [[48, 72, 14], [119, 128, 1], [52, 72, 14], [51, 60, 12], [50, 60, 12]].forEach(([hp, max, shield], i) => { if (sq[i]) cards[sq[i].id] = { hp, max, shield, cd: 0 }; });
  const foes = FOES5.map(([key, name, element, max, passives]) => ({ key, name, element, level: 2, hp: max, max: max || 45, sh: 0, st: 0,
    weak: [{ value: 'lightning' }, { value: `trait:${passives[0]}` }], resist: [{ value: 'fire' }], passives: [] }));
  foes[1].hp = 0;
  const st = { phase: 'fight', room_type: 'horde', round: 0, buff: 1.23, cards, foes, pend: { shards: 0, cards: [] }, bank: { shards: 0, cards: [] }, sup_round: -1 };
  return { ...body, squad: sq, best: { floor: 4, room: 1, rank: 1, runs: 1 }, run: { id: 1, status: 'active', floor: 2, room: 4, squad: sq.map((c) => c.id), state: st } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/gauntlet' && c.ci_dungeon === 'g-fight' && body?.ok, make: (body) => derivedGauntletFight(body) });
// UI-50: the run over (a fall on floor 3, room 2) with 4 found cards: the names of the approved frames.
function derivedOver(body) {
  const base = derivedDungeon(body);
  const mine = body.mine || [];
  const loot = LOOT.concat([["LionoftheWest's Dodrio", 'normal']]).map(([name, rarity], i) => ({ ...mine[i], name, rarity }));
  return { ...base, name: 'The Hollow Mines', loot, next_at: new Date(Date.parse(FIX.recordedAt) + 8 * 3600 * 1000).toISOString(),
    run: { id: 1, status: 'over', ended_by: 'fell', floor: 3, room: 2, rank: 1, shards: 204, turns: 27, squad: [], state: { phase: 'over', cards: {} } } };
}
DERIVED.push({ when: (p, c, body) => p === '/api/dungeon' && c.ci_dungeon === 'over' && body?.ok, make: (body) => derivedOver(body) });

// UI-25: open offers in every state (derived from the recorded sent offer), and a member with one trade partner (D-116).
function derivedTrades(body) {
  const card = (n, rarity) => ({ id: 900 + n, name: `Card ${n}`, rarity, image_url: body.outgoing?.[0]?.offer?.image_url || '' });
  const o = (id, from, to, status, offer, request) => ({ id, from_id: from, to_id: to, status, from_name: from === '100000000000000999' ? 'Member 999' : `Member ${from.slice(-3)}`, to_name: `Member ${to.slice(-3)}`, created_at: new Date(Date.parse(FIX.recordedAt) - 86400000).toISOString(), offer, request });
  const me = body.outgoing?.[0]?.from_id || '100000000000000001';
  return { incoming: [o(201, '100000000000000012', me, 'pending', card(1, 'normal'), card(2, 'normal')), o(202, '100000000000000012', me, 'pending', card(3, 'illustrated_rare'), card(4, 'illustrated_rare'))],
    outgoing: [...(body.outgoing || []), o(203, me, '100000000000000011', 'countered', card(5, 'normal'), card(6, 'normal')), o(204, me, '100000000000000163', 'pending', card(7, 'secret_rare'), null)] };
}
// UI-26: an accepted offer leaves Pending (the server rule): POST /api/trade/accept (below) sets the cookie ci_accepted=<offer id>
// and the derived list drops that offer, so the landed state shows Pending without it.
DERIVED.push({ when: (p, c, body) => p === '/api/trades' && c.ci_trades === 'few' && body, make: (body, c) => {
  const t = derivedTrades(body); const gone = Number(c.ci_accepted);
  return gone ? { ...t, incoming: t.incoming.filter((o) => o.id !== gone) } : t; } });
DERIVED.push({ when: (p, c, body) => p === '/api/trade/partners' && c.ci_trades === 'few' && body, make: (body) => ({ partners: (body.partners || []).slice(0, 1) }) });
// UI-63 / UI-25 trade REQUESTS (D-168, trade_request.sql): cookie ci_treq=on makes /api/flags carry tradeRequest (the Request button works,
// Offer with both cards is the full proposal); ci_treq=rows also derives open requests in every state: an incoming request (the owner picks), a
// sent request (waiting), a sent request that the owner picked for (the requester confirms). Nothing is written (every POST answers 403).
DERIVED.push({ when: (p, c, body) => p === '/api/flags' && (c.ci_treq === 'on' || c.ci_treq === 'rows') && body, make: (body) => ({ ...body, tradeRequest: true }) });
function derivedTradeRequests(body) {
  const card = (n, rarity) => ({ id: 900 + n, name: `Card ${n}`, rarity, image_url: body.outgoing?.[0]?.offer?.image_url || '' });
  const o = (id, from, to, status, offer, request) => ({ id, from_id: from, to_id: to, status, from_name: `Member ${from.slice(-3)}`, to_name: `Member ${to.slice(-3)}`, created_at: new Date(Date.parse(FIX.recordedAt) - 3600000).toISOString(), offer, request });
  const me = body.outgoing?.[0]?.from_id || '100000000000000001';
  return { incoming: [o(211, '100000000000000012', me, 'pending', null, card(1, 'normal'))],
    outgoing: [o(212, me, '100000000000000011', 'pending', null, card(2, 'normal')), o(213, me, '100000000000000163', 'countered', card(3, 'normal'), card(4, 'normal'))] };
}
DERIVED.push({ when: (p, c, body) => p === '/api/trades' && c.ci_treq === 'rows' && body, make: (body) => derivedTradeRequests(body) });
DERIVED.push({ when: (p, c, body) => p === '/api/trade/partners' && c.ci_treq === 'rows' && body, make: (body) => ({ partners: (body.partners || []).slice(0, 1) }) });
// UI-63: the cards of another member (the recorded answer has none): every second card of the recorded collection, with
// 1 to 4 copies, in the shape of GET /api/player-cards.
function derivedTheirCards() {
  const cards = (FIX.routes['/api/collection']?.body?.cards || []).filter((_, i) => i % 2 === 0).map((c, i) => ({ quantity: 1 + (i % 4), id: c.id, name: c.name,
    rarity: c.rarity, image_url: c.image_url, tradeable: true, season: c.season || 'Season 1', event: null, artist: null, lore: null, subject: c.subject }));
  return { cards };
}
DERIVED.push({ when: (p, c, body) => p === '/api/player-cards' && body && !(body.cards || []).length, make: () => derivedTheirCards() });
// UI-03 Home: the states the recorded fixtures do not have. A resting hunt (the last boss, its result, the top hunter, the next spawn)
// and a feed of pulls built from the recorded catalog (names of the people are made up: no member data).
const WHO = ['Member B', 'Member C', 'Member D', 'Member E', 'Member F'];
function derivedPulls() {
  const cards = (FIX.routes['/api/catalog']?.body?.cards || []).filter((c) => c.image_url);
  const t0 = new Date(FIX.recordedAt).getTime();
  return { pulls: cards.slice(0, 9).map((c, i) => ({ id: i + 1, player_id: `10000000000000010${i % 5}`, player: WHO[i % 5], name: c.name, rarity: i === 0 ? 'normal' : c.rarity, image_url: c.image_url, at: new Date(t0 - (i + 1) * 3_600_000).toISOString() })) };
}
function derivedResting() {
  const t0 = new Date(FIX.recordedAt).getTime();
  return { hunt: null, nextSpawnAt: new Date(t0 + 4 * 86_400_000 + 3_600_000).toISOString(), lastResult: { name: 'The Ranked Nightshade', tier: 'Tier 1', status: 'defeated', hp_max: 30000 },
    lastBoard: [{ player_id: '100000000000000102', username: 'Member C', damage: 6075 }], myLast: 3766, lastFeed: [] };
}
// UI-30: a Trade Hall with listings of other members (the recording holds the signed-in member's own only; cookie ci_hall=many):
// 10 Wanted cards (every third one owned 0 times: the Not owned look) and 11 For trade cards. The cards come from the recorded catalog.
function derivedHall(body) {
  const cat = (FIX.routes['/api/catalog']?.body?.cards || []).filter((c) => c.image_url);
  const pick = (i) => { const c = cat[(i * 37) % cat.length]; return { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power }; };
  const who = (i) => ({ player_id: `1000000000000001${String(i).padStart(2, '0')}`, name: `Member ${String(i + 1).padStart(3, '0')}` });
  const wanted = body.wanted.concat(Array.from({ length: 9 }, (_, i) => ({ ...who(i + 1), card: pick(i + 1), yours: false, mine: i % 3 === 0 ? 0 : (i % 3) })));
  const forTrade = body.forTrade.slice(0, 2).concat(Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, ...who(i + 1), card: pick(i + 20), mine: false, match: i % 2, at: body.forTrade[0].at })));
  return { ...body, wanted, forTrade };
}
// UI-31: ci_hall=list = two listings of mine (the approved list frames show 2/5; the recording has 5/5); ci_hall=offer = one Wanted card
// I own copies of (Wanted index 2) and one For trade card in the derived cards of the lister (For trade index 2), for the Trade window.
function derivedHallMode(body, mode) {
  const out = derivedHall(body);
  const col = FIX.routes['/api/collection']?.body?.cards || [];
  if (mode === 'list') return { ...out, mine: out.mine.slice(0, 2) };
  if (mode === 'offer' && col.length > 5) {
    const pick = (c) => ({ id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power });
    const wanted = out.wanted.slice(), forTrade = out.forTrade.slice();
    wanted[2] = { ...wanted[2], card: pick(col[5]), mine: col[5].quantity };
    forTrade[2] = { ...forTrade[2], card: pick(col[2]) };   // every other collection card is in the derived cards of a member (derivedTheirCards)
    return { ...out, wanted, forTrade };
  }
  return out;
}
DERIVED.push({ when: (p, c, body) => p === '/api/hall' && ['many', 'list', 'offer'].includes(c.ci_hall) && body?.wanted, make: (body, c) => derivedHallMode(body, c.ci_hall) });
// UI-32 Auctions (cookie ci_auction): the recording holds no auction. open = the open list (40 auctions of other members, one mine, one that waits for my
// Confirm, one ending soon); seller | seller-bids | seller-accepted = my auction (no bids, 3 bids, one bid accepted); bidder | bidder-bid | bidder-confirm = an
// auction of another member (no bid, my bid of one card below the minimum, my bid accepted). Cards come from the recorded catalog; names are made up.
const AU_ME = '100000000000000001';
function auCards() {
  const cat = (FIX.routes['/api/catalog']?.body?.cards || []).filter((c) => c.image_url);
  const by = (r) => cat.filter((c) => c.rarity === r);
  const slim = (c) => ({ id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power });
  return { slim, normal: (i) => slim(by('normal')[i % by('normal').length]), any: (i) => slim(cat[(i * 37) % cat.length]) };
}
function auBase(id, kind) {
  const { normal, any } = auCards();
  const t0 = new Date(FIX.recordedAt).getTime();
  const seller = kind.startsWith('seller');
  return { id, seller_id: seller ? AU_ME : '100000000000000112', seller: seller ? 'Member A' : 'Member 112', card: normal(id), min: { rarity: 'normal', count: 5, cards: [any(3), any(4), any(5)], mode: 'or' },
    status: 'live', ends_at: new Date(t0 + (2 * 24 + 22) * 3600e3).toISOString(), mine: seller, myBid: false, bids: 0, any, normal, t0 };
}
function derivedAuctions(kind) {
  const { normal } = auCards();
  const t0 = new Date(FIX.recordedAt).getTime();
  const mk = (i, o = {}) => ({ id: i + 1, seller_id: `1000000000000001${String(i + 10)}`, seller: `Member ${String(i + 110)}`, card: normal(i), min: { rarity: 'normal', count: 1, cards: [], mode: 'and' }, status: 'live',
    ends_at: new Date(t0 + (2 * 24 + 22 - i) * 3600e3).toISOString(), bids: i % 3, mine: false, myBid: false, ...o });
  if (kind === 'open') {
    const l = Array.from({ length: 40 }, (_, i) => mk(i));
    l[1] = { ...l[1], mine: true, seller_id: AU_ME, seller: 'Member A', bids: 2 };
    l[2] = { ...l[2], status: 'accepted', myBid: true, bids: 1 };
    l[3] = { ...l[3], ends_at: new Date(t0 + 5 * 3600e3 + 180e3).toISOString() };
    return l;
  }
  return [mk(0, { mine: kind.startsWith('seller'), seller_id: kind.startsWith('seller') ? AU_ME : '100000000000000112', seller: kind.startsWith('seller') ? 'Member A' : 'Member 112', myBid: kind.startsWith('bidder') && kind !== 'bidder', bids: kind === 'seller-bids' ? 3 : kind === 'seller' || kind === 'bidder' ? 0 : 1 })];
}
function derivedAuction(kind) {
  const b = auBase(1, kind), col = FIX.routes['/api/collection']?.body?.cards || [];
  const one = (c) => ({ id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power });
  const bid = (id, n, o = {}) => ({ id, bidder_id: `10000000000000012${id}`, bidder: `Member 12${id}`, cards: col.slice(id * 6, id * 6 + n).map(one), status: 'open', meets: false, at: new Date(b.t0 - 3600e3).toISOString(), score: n, ...o });
  const out = { id: b.id, seller_id: b.seller_id, seller: b.seller, card: b.card, min: b.min, status: b.status, ends_at: b.ends_at, accepted_bid_id: null, confirm_by: null,
    isSeller: kind.startsWith('seller'), bidsCount: 0, myBid: null, best: null };
  if (kind === 'seller-bids') { out.bids = [bid(1, 1), bid(2, 5, { meets: true }), bid(3, 2)]; out.bidsCount = 3; }
  if (kind === 'seller-accepted') { out.bids = [bid(1, 1, { status: 'accepted' })]; out.bidsCount = 1; out.status = 'accepted'; out.accepted_bid_id = 1; out.confirm_by = new Date(b.t0 + 24 * 3600e3).toISOString(); }
  if (kind === 'seller') out.bids = [];
  if (kind === 'bidder-bid' || kind === 'bidder-confirm') {
    const my = { ...bid(1, 1), bidder_id: AU_ME, bidder: 'Member A' };
    out.myBid = my; out.bidsCount = 1; out.best = { cards: my.cards, meets: false, mine: true };
    if (kind === 'bidder-confirm') { out.status = 'accepted'; out.myBid = { ...my, status: 'accepted' }; out.accepted_bid_id = 1; out.confirm_by = new Date(b.t0 + 24 * 3600e3).toISOString(); }
  }
  return out;
}
// UI-14: a wishlist with five cards (the recorded one has five empty slots): one name per rarity label, a long name, a plain name.
function derivedWish(body) {
  const R = [['full_art', 'Full Art'], ['gold', 'Gold'], ['rare', 'Rare'], ['uncommon', 'Uncommon'], ['normal', 'Normal']];
  return { ...body, slots: body.slots.map((x, i) => ({ ...x, card: { id: 900 + i, name: i === 1 ? 'A card with a very long name for the row' : `Wish card ${i + 1}`, rarity: R[i][0], image_url: '/api/img/x' }, mine: i })), top: 1 };
}
// UI-37: a gift waits in the bell (cookie ci_gifts=1), so walkthrough step 1 shows; the recorded answer has none.
const derivedGifts = (body) => ({ ...body, gifts: [{ id: 1, kind: 'packs', title: 'New Player Bonus', amount: 10 }] });
DERIVED.push({ when: (p, c, body) => p === '/api/notifications' && c.ci_gifts === '1' && body && typeof body === 'object', make: (body) => derivedGifts(body) });
DERIVED.push({ when: (p, c, body) => p === '/api/wishlist' && c.ci_wish === 'full' && body?.slots, make: (body) => derivedWish(body) });
// UI-12: two achievements that are done and not claimed (First Pull, First Shine), so the tab shows Claim and Claim all (cookie ci_ach=ready).
DERIVED.push({ when: (p, c, body) => p === '/api/profile' && c.ci_ach === 'ready' && Array.isArray(body?.claimed), make: (body) => ({ ...body, claimed: body.claimed.filter((k) => k !== 'first' && k !== 'ir1') }) });
// UI-13 (cookie ci_ach=tracks; the harness addition for the tracks): the recorded answers hold no /api/achievements, so the view and the gallery
// are made here from the public track table (tcg-bot/supabase/achievement_tracks.sql, the 24 tracks) and the tag set badges. The values give the states
// of the approved frames: tracks with 3 tiers ready, one tier ready, tiers claimed, a finished track, a track with no tier (Podium), a set badge ready and
// one not done. Every member number is made up. ci_data=long gives one track a 9-digit value and the gallery a 9-digit member count.
const ACH_TRACKS = [   // key, name, tiers, step, titles, value, claimed
  ['collector', 'Collector', [25, 75, 150, 250, 350], null, ['Collector', 'Archivist', 'Living Library'], 161, 0],
  ['shine', 'Shine', [1, 10, 30, 75, 150], null, ['Shiny Hunter', 'Prism Seeker', 'Radiant'], 35, 0],
  ['elementalist', 'Elementalist', [10, 30, 60, 110, 167], null, ['Elementalist', 'Element Sage', 'Avatar of the Pride'], 60, 0],
  ['fullsets', 'Full Sets', [1, 5, 15, 35, 71], null, ['Completionist', 'Set Master', 'Grand Curator'], 4, 0],
  ['ascension', 'Ascension', [1, 10, 40, 100, 200], null, ['Rising Star', 'Star Forger', 'Ascended'], 69, 3],
  ['trainer', 'Trainer', [3, 15, 45, 120, 300], null, ['Coach', 'Head Trainer', 'Legendary Trainer'], 57, 3],
  ['packs', 'Pack Opener', [10, 50, 150, 400, 1000], 250, ['Pack Rat', 'Rip King', 'Pack Legend'], 128, 2],
  ['generous', 'Generous', [1, 5, 15, 40, 100], 50, ['Generous', 'Big Heart', 'Patron of the Pride'], 8, 2],
  ['trader', 'Trader', [1, 5, 15, 40, 100], 50, ['Trader', 'Deal Maker', 'Trade Baron'], 17, 0],
  ['market', 'Market', [1, 5, 15, 40, 100], 50, ['Merchant', 'Auctioneer', 'Market Mogul'], 3, 1],
  ['wish', 'Wish Granter', [1, 3, 10, 25, 60], 25, ['Wish Granter', 'Genie', 'Fairy Godparent'], 12, 3],
  ['shards', 'Shard Earner', [500, 2500, 10000, 30000, 75000], 25000, ['Shard Miner', 'Crystal Keeper', 'Shard Tycoon'], 41000, 4],
  ['shopper', 'Shopper', [1, 10, 30, 75, 150], 50, ['Shopper', 'VIP', 'Big Spender'], 22, 3],
  ['recycler', 'Recycler', [10, 50, 200, 500, 1500], 500, ['Recycler', 'Copy Smelter', 'Alchemist'], 1900, 5],
  ['grind', 'Daily Grind', [10, 50, 150, 400, 1000], 250, ['Grinder', 'Clockwork', 'Never Misses'], 160, 3],
  ['streak', 'On a Roll', [3, 7, 14, 30, 60], 30, ['On a Roll', 'Unbroken', 'Eternal Flame'], 9, 2],
  ['raider', 'Hunter', [1, 4, 10, 20, 40], 10, ['Hunter', 'Veteran Hunter', 'Warlord'], 11, 3],
  ['heavy', 'Heavy Hitter', [2500, 10000, 40000, 100000, 250000], 100000, ['Heavy Hitter', 'Wrecking Ball', 'Boss Wrecker'], 52000, 3],
  ['bighit', 'Big Hit', [400, 900, 1600, 2600, 4000], null, ['Big Hitter', 'One-Shot', 'Meteor'], 1700, 3],
  ['slayer', 'Boss Slayer', [1, 3, 8, 15, 30], 10, ['Boss Slayer', 'Giant Slayer', "Dragon's Bane"], 4, 2],
  ['podium', 'Podium', [1, 3, 8, 15, 30], 10, ['Podium Finisher', 'Champion', 'Hall of Famer'], 0, 0],
  ['prankster', 'Prankster', [5, 25, 75, 200, 500], 100, ['Prankster', 'Menace', 'Agent of Chaos'], 80, 3],
  ['vibes', 'Good Vibes', [1, 10, 30, 75, 200], 50, ['Good Vibes', 'Ray of Sunshine', 'Heart of the Pride'], 14, 2],
  ['voice', 'Voice + Chat', [3, 10, 30, 75, 150], 50, ['Chatterbox', 'Life of the Party', 'Voice of the Pride'], 40, 3],
];
const ACH_BADGES = [   // tag, label, have, need, packs, claimed
  ['origin:pokemon', 'Pokemon', 29, 29, 4, false], ['origin:party', 'Party', 20, 20, 3, false], ['origin:minecraft', 'Minecraft', 10, 10, 2, false],
  ['origin:meme', 'Meme', 9, 9, 2, false], ['type:moment', 'Moment', 56, 56, 7, false], ['type:creature', 'Creature', 21, 21, 4, false],
  ['origin:smash', 'Smash', 52, 53, 7, false], ['origin:community', 'Community', 5, 6, 2, false], ['type:character', 'Character', 35, 37, 5, false],
  ['type:item', 'Item', 8, 8, 2, true], ['type:place', 'Place', 6, 6, 2, true],
];
const ACH_RETIRED = ['first', 'own10', 'own25', 'own50', 'own100', 'ir1', 'sr1', 'fa1', 'g1', 'ir10', 'sr5', 'fa5', 'g5', 'fire5', 'light5', 'lightning5', 'nature5', 'shadow5',
  'psychic5', 'water5', 'rainbow', 'fullset', 'double5', 'asc1', 'asc3', 'asc5', 'packs10', 'gift1', 'trade1', 'hunt1', 'hunt4', 'dmg1k', 'hit500', 'slay1', 'slay3', 'boon1', 'prank5'];
function derivedAchView(long) {
  const tracks = ACH_TRACKS.map(([key, name, tiers, step, titles, v, claimed]) => {
    const value = long && key === 'shards' ? 123456789 : v;
    const need = (n) => (n <= 5 ? tiers[n - 1] : step ? tiers[4] + (n - 5) * step : null);
    let reached = 0;
    while (need(reached + 1) != null && value >= need(reached + 1) && reached < 2000) reached += 1;
    // D-183: tiers an old achievement already paid (Collector: 2 unclaimed rows; Shine: 4, so the tile foot shows the tier-4 reward without packs)
    return { key, group: '', name, value, tiers, step, titles, reached, claimed: Math.min(claimed, reached), next: need(reached + 1), old_paid: { collector: 2, shine: 4 }[key] || 0 };
  });
  const badges = ACH_BADGES.map(([tag, label, have, need, packs, claimed]) => ({ key: `tag:S1:${tag}`, season: 'Season 1', short: 'S1', tag, label, title: `${label} Master S1`, need, have, packs, claimed }));
  const ready = tracks.reduce((s, t) => s + Math.max(0, t.reached - t.claimed), 0) + badges.filter((b) => b.have >= b.need && !b.claimed).length;
  // `rewards` = the balance achievement_rewards value that the server adds to the answer (made-up numbers)
  const rewards = { tiers: [{ packs: 1, shards: 50 }, { packs: 1, shards: 150 }, { packs: 2, shards: 200 }, { packs: 3, shards: 400 }, { packs: 5, shards: 800 }], step: { packs: 5, shards: 200 } };
  return { enabled: true, tracks, badges, ready, retired: ACH_RETIRED, rewards };
}
function derivedAchGallery(long) {
  const view = derivedAchView(false);
  const items = [];
  for (const t of view.tracks) {
    for (let i = 0; i < 3; i += 1) items.push({ kind: 'title', value: t.titles[i], track: t.key, tier: i + 3, need: t.tiers[i + 2], badge: null, owners: i === 1 && t.key === 'collector' ? 28 : 0, mine: i === 1 && t.key === 'collector', plus: null });
    items.push({ kind: 'frame', value: `diamond:${t.key}`, track: t.key, tier: 4, need: t.tiers[3], badge: null, owners: 0, mine: false, plus: null });
    items.push({ kind: 'frame', value: `mythic:${t.key}`, track: t.key, tier: 5, need: t.tiers[4], badge: null, owners: 0, mine: false, plus: null });
  }
  view.badges.forEach((b, i) => items.push({ kind: 'title', value: b.title, track: null, tier: null, need: b.need, badge: b.key, owners: 3 + i, mine: b.claimed, plus: null }));
  for (const [value, name, how, mine, owners] of [['silver', 'Collector', 'Own 50 different cards', true, 28], ['gold', 'Archivist', 'Own 100 different cards', true, 28], ['holo', 'Season 1 Complete', 'Own every Season 1 base card', true, 28]]) {
    items.push({ kind: 'frame', value, track: null, tier: null, need: null, badge: 'old', name, how, retired: true, owners, mine, plus: null });
  }
  for (const [value, name, how, mine, owners] of [['Rare Hunter', 'Rare Hunter', 'Own 10 Illustrated Rares', true, 27], ['Secret Keeper', 'Secret Keeper', 'Own 5 Secret Rares', true, 5]]) {
    items.push({ kind: 'title', value, track: null, tier: null, need: null, badge: 'old', name, how, retired: true, owners, mine, plus: null });
  }
  return { members: long ? 123456789 : 29, items };
}
DERIVED.push({ when: (p, c, body) => p === '/api/profile' && c.ci_ach === 'tracks' && body && typeof body === 'object', make: (body) => ({ ...body, title: 'Secret Keeper', frame: 'silver' }) });
// UI-64 (Shop stat reset picker, pick one): the recorded collection has 3 cards with stat points; ci_stats=many gives the
// first 30 cards points (a member who spent points on many cards), so the picker shows a full page.
const STAT_KEYS = ['attack', 'vitality', 'precision', 'potency', 'haste'];
function derivedStats(body) {
  return { ...body, cards: body.cards.map((c, i) => (i < 30 ? { ...c, stat: { ...(c.stat || {}), points: Object.fromEntries(STAT_KEYS.filter((_, k) => (i + k) % 3 !== 0).map((k, j) => [k, 1 + ((i + j) % 4)])) } } : { ...c, stat: { ...(c.stat || {}), points: {} } })) };
}
DERIVED.push({ when: (p, c, body) => p === '/api/collection' && c.ci_stats === 'many' && Array.isArray(body?.cards), make: (body) => derivedStats(body) });
// UI-24 (D-144): a bell with many notes (cookie ci_notes=many): the recorded notes repeated to 45, so the list scrolls on every size.
function derivedNotes(body) {
  const base = body.items, items = [];
  for (let i = 0; i < 45; i += 1) items.push({ ...base[i % base.length], id: 5000 + i, read: i > 3, created_at: new Date(Date.parse(base[i % base.length].created_at) - Math.floor(i / base.length) * 86400000).toISOString() });
  return { ...body, items };
}
DERIVED.push({ when: (p, c, body) => p === '/api/notifications' && c.ci_notes === 'many' && body?.items, make: (body) => derivedNotes(body) });
// UI-53: the locked Hunt, Dungeon and Gauntlet (cookie ci_hunt=gate / ci_dungeon=gate): the recorded answer plus the gate of the
// approved frames (starter gifts 0 of 2 claimed, 3 of 8 attackers). The server rule itself is not touched.
const LOCKED = { ok: false, need: 8, attackers: 3, gifts_open: 2, gifts_total: 2 };
DERIVED.push({ when: (p, c, body) => p === '/api/hunt' && c.ci_hunt === 'gate' && body?.hunt, make: (body) => ({ ...body, gate: { ...LOCKED } }) });
DERIVED.push({ when: (p, c, body) => (p === '/api/dungeon' || p === '/api/gauntlet') && c.ci_dungeon === 'gate' && body?.ok, make: (body) => ({ ...body, closed: false, gate: { ...LOCKED } }) });
// UI-27 (Boons): cookie ci_fx. hist = I played cards on members before (Frequent and Recent in the Member picker; the recorded plays are other
// members') ; day = all 10 plays of the day used; member = 3 plays on the first member (the pair cap). day and member include hist.
const ME = '100000000000000001';
function derivedFx(path, mode, body) {
  if (!mode) return body;
  if (path === '/api/effects/recent' && body?.plays) {
    const ids = ['012', '012', '012', '163', '163', '011', '011', '110', '076', '161', '077', '032'];
    const mine = ids.map((n, i) => ({ id: 9000 + i, from_id: ME, to_id: `100000000000000${n}`, from: 'Member A', to: `Member ${n}`, primitive: 'confetti', kind: 'boon', outcome: 'applied', at: new Date(Date.parse(FIX.recordedAt) - (i + 1) * 3600e3).toISOString() }));
    return { ...body, plays: [...mine, ...body.plays] };
  }
  if (path === '/api/effects/me' && body?.enabled) {
    if (mode === 'day') return { ...body, playsToday: 10, dayEnds: new Date(Date.parse(FIX.recordedAt) + (7 * 60 + 25) * 60e3).toISOString() };
    if (mode === 'member') return { ...body, playsToday: 3, pairs: { '100000000000000012': 3 } };
    // UI-28: every effect enabled and ready, so that the first card of the picker can be picked (the confirm, poll and owner states)
    const open = { ...body, cooldowns: {}, primitives: Object.fromEntries(Object.entries(body.primitives || {}).map(([k, v]) => [k, { ...v, enabled: true }])) };
    if (mode === 'owner') return { ...open, immune: ['012', '163', '011', '110', '076', '161', '077', '032'].map((n) => `100000000000000${n}`), primitives: { ...open.primitives, nickname: { primitive: 'nickname', kind: 'prank', channel: 'discord', enabled: true } } };
    if (mode === 'poll') return open;
    if (mode === 'refund') return { ...open, refunds: [{ id: 9201, primitive: 'nickname', reason: 'not_manageable', target: 'Member 012', card: { name: 'Card A' } }] };
    if (mode === 'banners') {
      const art = (FIX.routes['/api/collection']?.body?.cards || []).slice(0, 3).map((c) => ({ name: c.name, image_url: c.image_url }));
      const mk = (i, kind, outcome, sender) => ({ id: 9300 + i, primitive: 'confetti', kind, outcome, sender, created_at: FIX.recordedAt, card: art[i] || null });
      return { ...open, incoming: [mk(2, 'boon', 'applied', 'Member B'), mk(1, 'prank', 'decoyed', 'Member B'), mk(0, 'prank', 'applied', 'Member A')] };
    }
  }
  return body;
}
// UI-28: the collection cards carry a poll (4 questions with the member name) or the owner-refused effect (nickname).
function derivedFxCards(body, mode) {
  const polls = [1, 2, 3, 4].map((n) => ({ question: `Question ${n} about {name}?`, answers: ['Yes', 'No'] }));
  return { ...body, cards: (body.cards || []).map((c) => (!c.effect?.primitive ? c
    : mode === 'poll' ? { ...c, effect: { ...c.effect, options: { ...(c.effect.options || {}), polls } } }
    : mode === 'owner' ? { ...c, effect: { ...c.effect, primitive: 'nickname' } } : c)) };
}
DERIVED.push({ when: (p, c, body) => ['poll', 'owner'].includes(c.ci_fx) && p === '/api/collection' && body?.cards, make: (body, c) => derivedFxCards(body, c.ci_fx) });
DERIVED.push({ when: (p, c, body) => c.ci_fx && p === '/api/effects/recent' && body?.plays, make: (body, c) => derivedFx('/api/effects/recent', c.ci_fx, body) });
DERIVED.push({ when: (p, c, body) => c.ci_fx && p === '/api/effects/me' && body?.enabled, make: (body, c) => derivedFx('/api/effects/me', c.ci_fx, body) });
// UI-55: avatar effects (cookie ci_avfx=on): the badge list holds the mustache for the signed-in member, the five members of Home
// (pulls and voice) and every member of the recorded leaderboard, so every avatar of the three screens shows it.
function derivedAvatarFx(body) {
  const ids = new Set([FIX.routes['/api/leaderboard/v2']?.body?.me, ...Array.from({ length: 5 }, (_, i) => `10000000000000010${i}`),
    ...(FIX.routes['/api/leaderboard/v2']?.body?.rows || []).map((r) => r.id)].filter(Boolean));
  return { ...body, badges: { ...(body?.badges || {}), ...Object.fromEntries([...ids].map((id) => [id, { mustache: true }])) } };
}
DERIVED.push({ when: (p, c) => p === '/api/effects/badges' && c.ci_avfx === 'on', make: (body) => derivedAvatarFx(body) });
// UI-40: the recorded /api/flags has the report flag off; ci_report=on turns it on (the send stays blocked, so a send shows the error)
DERIVED.push({ when: (p, c, body) => p === '/api/flags' && c.ci_report === 'on' && body, make: (body) => ({ ...body, reports: true }) });
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((x) => x[0]));
const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

// The two Hunt states with no recording of their own, built from the recorded calls (the same cards, names and numbers).
// UI-18: the fight with two supports (a heal and a shield on an ally) and one card down, as the approved frames draw it
// (the recorded squad has attackers only). Ids 370 and 72 become supports, id 30 is down.
function derivedBattleMix() {
  const b = JSON.parse(JSON.stringify((FIX.routes['/api/hunt#battle'] || {}).body || {}));
  const AB = { 370: { name: 'Comeback', desc: 'Heal an ally.', kind: 'support', effect: 'heal', target: 'ally' }, 72: { name: 'Bulwark', desc: 'Shield an ally.', kind: 'support', effect: 'shield', target: 'ally' } };
  for (const c of b.roster || []) {
    if (AB[c.id]) { c.type = 'Item'; c.ability = AB[c.id]; c.hp = c.max_hp = 60; }
    if (c.id === 30) { c.hp = 0; c.downed = true; }
  }
  return b;
}
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
  const p = url.pathname.replace(/^\/app(?=\/)/, '');   // production serves under /app (Caddy strips it); the legal pages (UI-57) link /app/...
  if (req.method === 'POST' && p === '/api/open') {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => { let count = 1; try { count = Number(JSON.parse(raw || '{}').count) || 1; } catch { /* the default */ } send(res, 200, JSON.stringify(openAnswer(count))); });
    return undefined;
  }
  // UI-10: with ci_col=ascend-ok the Ascend answers success (the celebration); with ci_col=ascend it is refused (403 below). Writes nothing.
  if (req.method === 'POST' && p === '/api/ascend' && cookies(req).ci_col === 'ascend-ok') return send(res, 200, JSON.stringify({ ok: true, ascension: 1, quantity: 2, power: 12, next_cost: 2 }));
  // UI-28 (cookie ci_play=ok): a play that works. Nothing is written. Without the cookie the play stays blocked (the error state of the confirm window).
  if (req.method === 'POST' && p === '/api/effects/play' && cookies(req).ci_play === 'ok') { req.resume(); return send(res, 200, JSON.stringify({ ok: true, outcome: 'applied', kind: 'boon', primitive: 'lucky_pull' })); }
  // UI-31: taking a card off the Hall answers ok (nothing is written) so the screen shows the "unlisted" toast with Undo; a list call stays refused (the error state).
  if (req.method === 'POST' && p === '/api/hall/unlist') return send(res, 200, '{"ok":true}');
  if (req.method === 'POST' && p === '/api/trade/accept') {   // UI-26: nothing is written; the answer is ok and the cookie hides the offer
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => { let id = 0; try { id = Number(JSON.parse(raw || '{}').offerId) || 0; } catch { /* no id */ }
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': `ci_accepted=${id}; Path=/` }); res.end('{"ok":true}'); });
    return undefined;
  }
  // UI-32: withdrawing a bid answers ok (nothing is written) so the screen shows "Bid withdrawn." with Undo; start, bid, accept, close and confirm stay refused (the error states).
  if (req.method === 'POST' && p === '/api/auction/withdraw') return send(res, 200, '{"ok":true}');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 403, '{"error":"ui-check: writes are blocked"}');
  if (p === '/' || p === '/index.html') return send(res, 200, index, 'text/html');
  if (p === '/ui3.css') return send(res, 200, ui3Css(PUB), 'text/css');   // joined as server.js does (read on each request)
  if (/^\/(main|chunk)\..*\.js$/.test(p)) return send(res, 200, readFileSync(join(BUNDLE, p.slice(1))), 'text/javascript');
  if (/^\/(api\/img|cimg|api\/avatar)\//.test(p) || /^\/cdn\//.test(p)) return send(res, 200, PNG, 'image/png');
  // The pull feed stream: open and quiet, as in production with no new pulls (a closed stream makes the client poll).
  if (p === '/api/pulls/stream') { res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(': ui-check\n\n'); const k = cookies(req); if (k.ci_home) res.write(`data: ${JSON.stringify(k.ci_data === 'long' ? longData(derivedPulls()) : derivedPulls())}\n\n`); return undefined; }
  if (p.startsWith('/api/')) {
    const c = cookies(req);
    if (c.ci_home && p === '/api/pulls') return send(res, 200, JSON.stringify(c.ci_data === 'long' ? longData(derivedPulls()) : derivedPulls()));
    if (c.ci_home === 'busy' && p === '/api/hunt') return send(res, 200, JSON.stringify(c.ci_data === 'long' ? longData(derivedResting()) : derivedResting()));
    if (p === '/api/hunt' && (c.ci_hunt === 'resting' || c.ci_hunt === 'down')) return send(res, 200, JSON.stringify(derivedHunt(c.ci_hunt, c.ci_data === 'long')));
    if (p === '/api/hunt' && c.ci_hunt === 'battle-mix') return send(res, 200, JSON.stringify(derivedBattleMix()));
    if (c.ci_auction && (p === '/api/auctions' || p === '/api/auction')) {
      const out = p === '/api/auctions' ? { view: url.searchParams.get('view') || 'open', auctions: derivedAuctions(c.ci_auction) } : derivedAuction(c.ci_auction);
      return send(res, 200, JSON.stringify(c.ci_data === 'long' ? longData(out) : out));
    }
    if (c.ci_ach === 'tracks' && p === '/api/achievements') return send(res, 200, JSON.stringify(derivedAchView(c.ci_data === 'long')));   // UI-13
    if (c.ci_ach === 'tracks' && p === '/api/achievements/gallery') return send(res, 200, JSON.stringify(derivedAchGallery(c.ci_data === 'long')));   // UI-13
    if (p === '/api/achievements') return send(res, 200, JSON.stringify({ enabled: false, rewards: null }));   // tracks off (the live answer of achievement_view + withRewards): the UI-12 list
    const key = keyOf(p, url.search) + (p === '/api/hunt' && c.ci_hunt ? `#${c.ci_hunt}` : '');
    // The exact request, else the same path with no query, else the same path with another query (another member's
    // wishlist when the long-data variant changes the order of a list: the layout is the same).
    const hit = FIX.routes[key] || FIX.routes[keyOf(p, '')] || BY_PATH[p];
    // UI-66: a Leaderboard board state (cookie ci_board) answers before the fixture lookup (the Gauntlet board has no recorded answer)
    if (BOARD_PATHS.has(p) && c.ci_board === 'error') return send(res, 500, '{"error":"ui-check: board error"}');
    const board = BOARD_PATHS.has(p) && p !== '/api/leaderboard/v2' && (c.ci_board === 'rows' || c.ci_board === 'empty')
      ? derivedBoard(p, c.ci_board, FIX.routes['/api/hunt/leaderboard']?.body?.me || '100000000000000001', url.searchParams.get('last') === '1') : null;
    if (!hit && !board) { misses.add(key); return send(res, 404, '{"error":"ui-check: no fixture"}'); }
    const derived = board || DERIVED.reduce((b, d) => (d.when(p, c, b) ? d.make(b, c) : b), hit.body);
    // UI-66 (ci_board=rows): every member has a title, an achievement title on the Main board and a name badge title everywhere
    // else, so a long name and a title meet on every row and podium spot.
    const body0 = c.ci_board === 'rows' ? withTitles(p, derived, FIX) : derived;
    const body = c.ci_data === 'long' ? longData(body0) : body0;
    return send(res, board ? 200 : (hit.status || 200), JSON.stringify(body));
  }
  const f = normalize(join(PUB, decodeURIComponent(p)));
  if (!f.startsWith(PUB) || !existsSync(f) || !statSync(f).isFile()) return send(res, 404, 'not found', 'text/plain');
  return send(res, 200, readFileSync(f), TYPES[extname(f)] || 'application/octet-stream');
}).listen(PORT, () => console.log(`ui-check server on http://127.0.0.1:${PORT} (fixtures recorded ${FIX.recordedAt})`));
