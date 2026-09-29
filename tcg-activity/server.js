/**
 * Lion Pride TCG — Discord Activity backend.
 *
 * An Activity is a web page Discord loads in a sandboxed iframe. This server
 *   1. serves that page (public/),
 *   2. does the OAuth2 code -> token exchange (needs the app's CLIENT_SECRET),
 *   3. returns the logged-in player's own collection from Supabase.
 *
 * The player is identified by their Discord token (verified against Discord),
 * never by an id the browser claims — so nobody can read someone else's cards.
 *
 * Env (.env):  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, SUPABASE_URL,
 *              SUPABASE_SERVICE_ROLE_KEY, PORT (default 4441)
 */
import 'dotenv/config';
import { measure as measureAchievements, ACHIEVEMENTS, rewardOf } from './src/achievements.js';
const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { EFFECTS_SCHEMA, registerEffectRoutes } from './effects.js';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, 'public');

// The bundle filename carries a content hash (main.<hash>.js) so a new build
// gets a new URL. Discord's proxy / the webview can never serve a stale script.
// We read the current name once at boot and inject it into index.html.
const bundleName = readdirSync(PUBLIC).find((f) => /^main\..*\.js$/.test(f));
// style.css is not hashed, so version its URL by content so Discord's proxy can
// never serve stale CSS after a redeploy.
const cssVersion = createHash('sha1').update(readFileSync(join(PUBLIC, 'style.css'))).digest('hex').slice(0, 8);
// Every other stylesheet link (the ui-v2*.css files) gets its own content version the
// same way: without it, Discord served a stale ui-v2-open.css after a deploy (the new
// reveal ran with the old 420px column, 2026-09-27).
const cssV = (name) => createHash('sha1').update(readFileSync(join(PUBLIC, name))).digest('hex').slice(0, 8);
const indexHtml = readFileSync(join(PUBLIC, 'index.html'), 'utf8')
  .replace('__BUNDLE__', bundleName)
  .replace('__CSSV__', cssVersion)
  .replace(/href="\/([\w.-]+\.css)"/g, (m, name) => `href="/${name}?v=${cssV(name)}"`);
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
// Discord's iframe can only load external URLs that are mapped. Card art lives on
// Supabase storage, so we rewrite those URLs to a "/cdn" prefix that the portal
// maps to the Supabase host. Keeps everything inside the proxy's allow-list.
const SUPA_HOST = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
// Card art is streamed THROUGH this server (a "cimg/" relative path), not through
// Discord's /cdn image proxy — that proxy dropped fresh fetches of less-cached images,
// leaving cards blank. A relative path resolves under /app in Discord and / in dev, so
// the request reaches this server, which fetches Supabase storage directly and streams it.
const toProxyImg = (url) => (url && SUPA_HOST ? url.replace(SUPA_HOST + '/', '/api/img/') : url);
// The shared card back, for the 3D viewer's flip. Same storage bucket the gallery
// uses; routed through /cdn like all other art.
const CARD_BACK = SUPA_HOST ? toProxyImg(`${SUPA_HOST}/storage/v1/object/public/card-art/grid/cards/card-back.webp`) : '';
// The bot's internal open endpoint (localhost on the same VM) and the shared
// secret that guards it. Opening a pack goes through the bot so the bot stays the
// single source of truth for draw odds and the daily-pack economy.
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const BOT_INTERNAL_URL = (process.env.BOT_INTERNAL_URL || 'http://127.0.0.1:4451').replace(/\/+$/, '');
// In-app notification (shown on the Activity's bell).
async function notify(userId, kind, message) {
  try { await supabase.rpc('notify_player', { p_player: userId, p_kind: kind, p_message: message }); } catch { /* ignore */ }
}
// Post a directed event to the public notifications channel (via the bot). The
// message should @mention the person who needs to see it: `<@id>`.
// `kind` = the ping setting that applies (the bot's ping-prefs.ts): 'trades' for these.
async function announce(message, kind = 'trades') {
  if (!INTERNAL_TOKEN) return;
  try {
    await fetch(`${BOT_INTERNAL_URL}/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ message, kind }),
    });
  } catch { /* ignore */ }
}
// A bot Card -> the browser shape, with the art routed through the /cdn proxy.
const cardForClient = (c) => ({
  id: c.id,
  name: c.name,
  rarity: c.rarity,
  image_url: toProxyImg(c.image_url),
  artist: c.artist_credit,
  lore: c.lore,
});
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.disable('x-powered-by');
// Baseline security headers. These are safe inside Discord's iframe proxy. We do
// NOT set frame-ancestors or X-Frame-Options — Discord must be able to embed the
// Activity, and a wrong value there would break the embed.
// Two policies (2026-09-29, from the report-only reports of Nathan's session):
// - Discord's proxy adds an INLINE script to the page (script-src-elem inline, line 135 of
//   our 136-line page), so the enforced policy allows inline scripts; scripts from any
//   other site stay blocked.
// - The meshopt decoder of the compressed boss models needs WebAssembly (wasm-eval).
// The strict script rule stays REPORT-ONLY with a sample, to learn what Discord adds.
const cspWith = (script) => [
  "default-src 'self'",
  `script-src ${script}`,
  "style-src 'self' 'unsafe-inline'", // the templates set inline style attributes
  "img-src 'self' data: blob:", // blob: = the boss model textures
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' wss: https://discord.com blob: data:", // the room WebSocket, the SDK's token exchange, the model textures (GLTFLoader fetches blob: URLs)
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors https://discord.com https://*.discord.com https://*.discordsays.com",
  'report-uri /api/csp-report',
].join('; ');
const CSP_ENFORCED = cspWith("'self' 'unsafe-inline' 'wasm-unsafe-eval'");
const CSP_STRICT = cspWith("'self' 'wasm-unsafe-eval' 'report-sample'");
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // CSP_ENFORCE=1 enforces CSP_ENFORCED; without it both policies only report.
  if (process.env.CSP_ENFORCE === '1') res.setHeader('Content-Security-Policy', CSP_ENFORCED);
  else res.append('Content-Security-Policy-Report-Only', CSP_ENFORCED);
  res.append('Content-Security-Policy-Report-Only', CSP_STRICT);
  next();
});
// CSP violation reports (report-only mode): logged, so the policy can be checked in the real client.
let cspReports = 0;
app.post('/api/csp-report', express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }), (req, res) => {
  if (cspReports < 500) {
    cspReports += 1;
    const r = req.body?.['csp-report'] || req.body || {};
    console.log('csp-report', JSON.stringify({ dir: r['violated-directive'] || r.effectiveDirective, blocked: r['blocked-uri'] || r.blockedURL, src: r['source-file'] || r.sourceFile, line: r['line-number'] || r.lineNumber, sample: r['script-sample'] || r.sample }).slice(0, 400));
  }
  res.status(204).end();
});
app.use(express.json());
// The member read limit (readLimit): every signed-in GET /api/* call. Images, avatars and
// the config are public and browser-cached, so they are not counted.
app.use('/api', async (req, res, next) => {
  if (req.method !== 'GET' || !req.headers.authorization || /^\/(img|avatar)\/|^\/config$/.test(req.path)) return next();
  const me = await caller(req).catch(() => null);
  if (me && !readLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  next();
});

// Card-art proxy: stream a Supabase storage object through this server. This replaces
// Discord's flaky /cdn image proxy. Only the public card-art storage path is allowed.
app.get(/^\/api\/img\/(.+)/, async (req, res) => {
  if (!SUPA_HOST) return res.status(404).end();
  const path = decodeURIComponent(req.params[0] || '');
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  if (!path.startsWith('storage/v1/object/public/card-art/') || /\.\.|\\|\/\/|%/.test(path)) return res.status(400).end(); // no traversal, no double-encoding
  try {
    const r = await fetch(`${SUPA_HOST}/${path}${query}`);
    if (!r.ok || !r.body) return res.status(r.ok ? 502 : r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const len = r.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.status(502).end(); else res.destroy(); }
});

// Discord avatar proxy: /api/avatar/<discord id>. The hash is saved at login
// (players.avatar). Discord blocks unmapped fetches, so the picture comes through here.
const avatarHash = new Map(); // id -> { hash, at }
const avatarBytes = new Map(); // id:hash -> { type, buf }
async function hashFor(id) {
  const hit = avatarHash.get(id);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.hash;
  const { data } = await supabase.from('players').select('avatar').eq('id', id).maybeSingle();
  const hash = data?.avatar || null;
  avatarHash.set(id, { hash, at: Date.now() });
  return hash;
}
// No picture: a 1x1 transparent PNG (200), so the initial under it shows. A 404 made
// Discord show a broken-image icon (Nathan, 2026-09-27). Short cache: it becomes the
// real picture once the member's hash is saved at their next login.
const NO_AVATAR = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const noAvatar = (res) => { res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=300'); res.end(NO_AVATAR); };
app.get('/api/avatar/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^\d{5,25}$/.test(id)) return res.status(400).end();
  try {
    const hash = await hashFor(id);
    if (!hash || !/^(a_)?[0-9a-f]{32}$/.test(hash)) return noAvatar(res);
    const key = `${id}:${hash}`;
    let img = avatarBytes.get(key);
    if (!img) {
      const r = await fetch(`https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`);
      if (!r.ok) return noAvatar(res);
      img = { type: r.headers.get('content-type') || 'image/png', buf: Buffer.from(await r.arrayBuffer()) };
      if (avatarBytes.size > 500) avatarBytes.delete(avatarBytes.keys().next().value);
      avatarBytes.set(key, img);
    }
    res.setHeader('Content-Type', img.type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(img.buf);
  } catch { res.status(502).end(); }
});

// index.html is served with the hashed bundle name injected. It must never be
// cached (no-store) so a redeploy is picked up; the hashed bundle itself can be
// cached forever because its URL changes whenever its content changes.
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(indexHtml);
});
// The Terms of Service + Privacy Policy (the Discord app verification asks for both URLs):
// https://lionpridetcg.duckdns.org/app/terms and /app/privacy (Caddy strips /app).
app.get('/terms', (req, res) => res.sendFile(join(PUBLIC, 'legal', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(join(PUBLIC, 'legal', 'privacy.html')));
app.use(express.static(PUBLIC, {
  setHeaders: (res, path) => {
    const base = path.split(/[\\/]/).pop();
    if (/^(main|chunk)\..*\.js$/.test(base)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.woff2$/.test(base)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'no-store');
  },
}));

// The public values the front-end needs before it can talk to Discord.
// Ascension (Phase 1): duplicates raise a card's star level → power + flair.
// Flag-gated so it can be turned off instantly. These tables MIRROR ascension.sql
// (card_power / ascend_cost) — keep them in sync if either changes.
const FEATURE_ASCENSION = process.env.FEATURE_ASCENSION === '1';
// Middle curve. Set-completion bonus (+25%) is applied server-side by the SQL
// (my_collection_power); this per-card math is base × ascension × per-subject cp_mod.
// Power tracks scarcity (gold is the rarest pull, so the strongest). Must match card_power in SQL.
const RARITY_BASE = { normal: 10, illustrated_rare: 20, secret_rare: 40, full_art: 75, gold: 140 };
const ASC_MULT = [1.0, 1.25, 1.5, 1.75, 2.0, 2.5];
const ASC_COST = { normal: [4, 6, 8, 11, 15], illustrated_rare: [3, 4, 6, 8, 11], full_art: [2, 3, 4, 6, 8], gold: [1, 2, 3, 4, 5], secret_rare: [1, 1, 2, 3, 4] };
const cardPower = (rarity, asc, mod = 1) => Math.round((RARITY_BASE[rarity] || 10) * ASC_MULT[Math.max(0, Math.min(5, asc || 0))] * (mod || 1));
const ascendCost = (rarity, asc) => ((asc || 0) >= 5 ? null : (ASC_COST[rarity] || ASC_COST.normal)[asc || 0]);

// Phase 2: The Pride Hunt (weekly co-op raid). Flag-gated.
const FEATURE_HUNT = process.env.FEATURE_HUNT === '1';

// The v2 UI (docs/design.md). Default OFF: FEATURE_UI_V2=1 for everyone, or
// UI_V2_USERS=id,id for a preview. The client asks after login.
const UI_V2_ALL = process.env.FEATURE_UI_V2 === '1';
const UI_V2_USERS = new Set((process.env.UI_V2_USERS || '').split(',').map((s) => s.trim()).filter(Boolean));
app.get('/api/flags', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const hash = me.avatar || null;
  if (hash && avatarHash.get(String(me.id))?.hash !== hash) {
    avatarHash.set(String(me.id), { hash, at: Date.now() });
    supabase.from('players').update({ avatar: hash }).eq('id', me.id).then(() => {}, () => {});
  }
  res.json({ uiV2: UI_V2_ALL || UI_V2_USERS.has(String(me.id)) });
});

app.get('/api/config', (req, res) => res.json({ clientId: CLIENT_ID, backUrl: CARD_BACK, features: { ascension: FEATURE_ASCENSION, hunt: FEATURE_HUNT } }));

// Step 1 of login: swap the one-time OAuth code for the player's access token.
app.post('/api/token', async (req, res) => {
  const code = req.body?.code;
  if (!code) return res.status(400).json({ error: 'missing code' });
  try {
    const r = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
      }),
    });
    const data = await r.json();
    if (!data.access_token) return res.status(400).json({ error: 'token exchange failed', detail: data });
    res.json({ access_token: data.access_token });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Identify the caller from their Discord token (so ids can't be spoofed).
//
// The Discord identity is CACHED per token (5 min TTL). Without this, every
// authenticated request made a live round-trip to https://discord.com — which
// added Discord latency to every call AND, at scale, would 429 the shared app
// token (the hard breakpoint). The token is still the credential Discord minted,
// so caching its resolution is safe; a revoked token simply lingers <= 5 min.
const USER_TTL_MS = 5 * 60 * 1000;
const userCache = new Map(); // token -> { user, exp }
// Load-test only: a flag-gated synthetic identity so a harness can drive hundreds
// of virtual users WITHOUT calling Discord. OFF in prod (LOADTEST unset).
const LOADTEST = process.env.LOADTEST === '1';

async function whoAmI(token) {
  if (!token) return null;
  const now = Date.now();
  const hit = userCache.get(token);
  if (hit && hit.exp > now) return hit.user;
  if (LOADTEST && token.startsWith('lt:')) {
    const id = token.slice(3);
    const user = { id, username: `lt_${id}`, global_name: null };
    userCache.set(token, { user, exp: now + USER_TTL_MS });
    return user;
  }
  const r = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${token}` } });
  const user = r.ok ? await r.json() : null;
  if (user) {
    userCache.set(token, { user, exp: now + USER_TTL_MS });
    if (userCache.size > 5000) for (const [k, v] of userCache) if (v.exp <= now) userCache.delete(k);
  }
  return user;
}

// Per-user collection cache. A user's collection changes only when they open,
// receive, or trade a card — all of which bust their entry (see bustUser). So a
// short TTL is safe and collapses repeated collection reads (the heaviest
// per-user query) into one DB hit.
const collCache = new Map(); // userId -> { at, payload }
const COLL_TTL = 8000;
// Same reasoning for the two other per-user reads that were hitting the DB on
// EVERY call (the load test showed catalog + pack-status at ~120ms each, every
// time — 40% of the request mix and the throughput ceiling). Both change only on
// the same open/receive/trade events, so bustUser clears all three together.
const ownedCache = new Map(); // userId -> { at, owned:Set<cardId> }  (drives /api/catalog overlay)
const OWNED_TTL = 8000;
const packStatusCache = new Map(); // userId -> { at, packs }
const PACK_STATUS_TTL = 8000;
function bustUser(userId) { collCache.delete(userId); ownedCache.delete(userId); packStatusCache.delete(userId); }

// The card-effect columns exist only after card_effects.sql (see effects.js flags).
const EFFECT_COLS = EFFECTS_SCHEMA ? ', id, effect' : '';

// Step 2: the caller's own collection.
app.get('/api/collection', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const cached = collCache.get(me.id);
  if (cached && Date.now() - cached.at < COLL_TTL) return res.json(cached.payload);
  const { data, error } = await supabase
    .from('player_cards')
    .select(`quantity, ascension, card:cards(id, name, rarity, image_url, artist_credit, lore, season, event, tradeable, subject:subjects(name, type, cp_mod, tags, ability${EFFECT_COLS}))`)
    .eq('player_id', me.id);
  if (error) return res.status(500).json({ error: error.message });
  const cards = (data || []).map((row) => {
    const rarity = row.card?.rarity;
    const ascension = row.ascension || 0;
    const nextCost = ascendCost(rarity, ascension);
    return {
      quantity: row.quantity,
      id: row.card?.id,
      name: row.card?.name,
      rarity,
      ascension,
      power: cardPower(rarity, ascension, row.card?.subject?.cp_mod),
      next_cost: nextCost,
      can_ascend: nextCost != null && row.quantity >= 1 + nextCost,
      image_url: toProxyImg(row.card?.image_url),
      artist: row.card?.artist_credit,
      lore: row.card?.lore,
      season: row.card?.season || 'Season 1',
      event: row.card?.event || null,
      tradeable: row.card?.tradeable !== false,
      subject: row.card?.subject?.name,
      type: row.card?.subject?.type || null,
      tags: row.card?.subject?.tags || null,
      ability: row.card?.subject?.ability || null,
      subject_id: row.card?.subject?.id ?? null,
      effect: row.card?.subject?.effect || null,
    };
  });
  // Total CP comes from SQL (authoritative — includes the +25% set-completion
  // bonus). Fall back to the per-card sum if the RPC is unavailable.
  let totalPower = cards.reduce((s, c) => s + c.power, 0);
  // Stat points (stat_points.sql): the combat numbers of each ascended copy. The SQL is the
  // only formula; while the flag is off (or the function is not live) there is no stats key.
  const [cpRes, stRes] = await Promise.allSettled([
    supabase.rpc('my_collection_power', { p_player_id: me.id }),
    supabase.rpc('card_stats_for', { p_player: me.id }),
  ]);
  if (cpRes.status === 'fulfilled' && cpRes.value.data != null) totalPower = Number(cpRes.value.data);
  const st = stRes.status === 'fulfilled' && !stRes.value.error ? stRes.value.data : null;
  let stats = null;
  if (st?.on) {
    stats = { on: true, week: st.week, resetUsed: st.reset_week === st.week };
    for (const c of cards) { const x = st.cards?.[String(c.id)]; if (x) c.stat = x; }
  }
  const payload = { user: { id: me.id, name: me.global_name || me.username }, cards, power: totalPower, stats };
  collCache.set(me.id, { at: Date.now(), payload });
  res.json(payload);
});

let leaderboardCache = null; // top collection power, 30s cache; cleared on ascend
// Ascend a card: consume duplicates to raise its star level. Actor comes from the
// verified token; the RPC is atomic + row-locked (no double-spend).
app.post('/api/ascend', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_ASCENSION) return res.status(403).json({ error: 'ascension disabled' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const cardId = Number(req.body?.cardId);
  if (!cardId) return res.status(400).json({ error: 'bad card' });
  const { data, error } = await supabase.rpc('ascend_card', { p_player_id: me.id, p_card_id: cardId });
  if (error) return res.status(500).json({ error: error.message });
  if (data?.ok) { bustUser(me.id); leaderboardCache = null; } // collection + power changed
  res.json(data);
});

// Stat points: spend on one copy, or the free weekly reset. The RPCs check the flag, the
// ownership, the limits and the week; the actor comes from the verified token.
const STAT_KEYS = ['attack', 'vitality', 'precision', 'potency', 'haste'];
app.post('/api/stats/spend', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const cardId = Number(req.body?.cardId);
  const add = {};
  for (const k of STAT_KEYS) {
    const n = req.body?.add?.[k];
    if (n == null) continue;
    if (!Number.isInteger(n) || n < 0 || n > 15) return res.status(400).json({ error: 'bad amount' });
    if (n > 0) add[k] = n;
  }
  if (!cardId || !Object.keys(add).length) return res.status(400).json({ error: 'bad request' });
  const { data, error } = await supabase.rpc('spend_stat_points', { p_player: me.id, p_card: cardId, p_add: add });
  if (error) return res.status(500).json({ error: error.message });
  if (data?.ok) bustUser(me.id);
  res.json(data);
});
app.post('/api/stats/reset', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const cardId = Number(req.body?.cardId);
  if (!cardId) return res.status(400).json({ error: 'bad card' });
  const { data, error } = await supabase.rpc('reset_stat_points', { p_player: me.id, p_card: cardId });
  if (error) return res.status(500).json({ error: error.message });
  if (data?.ok) bustUser(me.id);
  res.json(data);
});

// Leaderboard: top players by Total Collection Power (30s cache).
app.get('/api/leaderboard', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const now = Date.now();
  if (!leaderboardCache || now - leaderboardCache.at >= 30000) {
    const { data, error } = await supabase.rpc('top_collection_power', { p_limit: 20 });
    if (error) return res.status(500).json({ error: error.message });
    leaderboardCache = { at: now, data: data || [] };
  }
  res.json({ leaders: leaderboardCache.data, me: me.id });
});

// ---- The Pride Hunt (Phase 2) ----------------------------------------------
// The v2 leaderboard (design/12-leaderboard-screen.png): every player with cards, with
// collection power, hunt damage, bosses downed, cards owned, and achievements done.
// One pass over a few tables, cached 60s (the member count is small).
// Single-flight + a small gate (the pressure test, 2026-09-28). Supabase serves ~60 REST
// calls/s in total and PostgREST has 11 connections. So a shared cache that expires under
// load must refresh ONCE (not once per waiting request), and the RPCs that lock the boss
// row must not hold every connection while they wait for the lock (100 attackers did, and
// pack opens and screens then failed with PGRST003).
const inflight = new Map();
function singleFlight(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve().then(fn).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
function makeGate(limit) {
  let active = 0;
  const waiting = [];
  const next = () => { if (active < limit && waiting.length) { active += 1; waiting.shift()(); } };
  return async (fn) => {
    await new Promise((resolve) => { waiting.push(resolve); next(); });
    try { return await fn(); } finally { active -= 1; next(); }
  };
}
// hunt_attack / hunt_support lock the boss row: at most this many wait on it at once.
const huntRpcGate = makeGate(Number(process.env.HUNT_RPC_CONCURRENCY || 4));
// The fight standings (top 100), shared by the Hunt standings and the v2 board. 2 s.
const huntLeadersCache = new Map();
async function huntLeaders(huntId) {
  const c = huntLeadersCache.get(huntId);
  if (c && Date.now() - c.at < 2000) return c.data;
  return singleFlight(`leaders:${huntId}`, async () => {
    const { data, error } = await supabase.rpc('hunt_leaderboard', { p_hunt: huntId, p_limit: 100 });
    if (error) throw new Error(error.message);
    huntLeadersCache.set(huntId, { at: Date.now(), data: data || [] });
    return data || [];
  });
}

let boardV2Cache = null;
app.get('/api/leaderboard/v2', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const hunt = FEATURE_HUNT ? await activeHunt() : null;
  const rebuildBoard = () => singleFlight('boardV2', async () => {
      const [players, owned, hits, hunts, opened, gifted, plays, trades, catalog] = await Promise.all([
        supabase.from('players').select('id, username, avatar, title, frame'),
        supabase.from('player_cards').select('player_id, card_id, quantity, ascension').gte('quantity', 1).limit(100000),
        supabase.from('hunt_hits').select('player_id, hunt_id, damage').limit(100000),
        supabase.from('hunts').select('id, status'),
        supabase.from('pack_ledger').select('player_id').eq('reason', 'opened').limit(100000),
        supabase.from('pack_ledger').select('granted_by').eq('reason', 'gift').limit(100000),
        supabase.from('card_plays').select('player_id, kind').limit(100000),
        supabase.from('trade_offers').select('from_id, to_id').eq('status', 'accepted').limit(100000),
        getCatalogBase(),
      ]);
      const defeated = new Set((hunts.data || []).filter((h) => h.status === 'defeated').map((h) => h.id));
      const byPlayer = new Map();
      const row = (id) => {
        if (!byPlayer.has(id)) byPlayer.set(id, { cards: [], hits: [], opened: 0, gifted: 0, boons: 0, pranks: 0, trades: 0 });
        return byPlayer.get(id);
      };
      for (const r of owned.data || []) row(r.player_id).cards.push(r);
      for (const r of hits.data || []) row(r.player_id).hits.push(r);
      for (const r of opened.data || []) row(r.player_id).opened += 1;
      for (const r of gifted.data || []) if (r.granted_by) row(r.granted_by).gifted += 1;
      for (const r of plays.data || []) { const x = row(r.player_id); if (r.kind === 'boon') x.boons += 1; if (r.kind === 'prank') x.pranks += 1; }
      for (const r of trades.data || []) { row(r.from_id).trades += 1; row(r.to_id).trades += 1; }
      const names = new Map((players.data || []).map((p) => [String(p.id), p]));
      const byId = new Map(catalog.map((c) => [c.id, c]));
      const cp = new Map(catalog.map((c) => [c.id, c]));
      const rows = [];
      for (const [id, x] of byPlayer) {
        if (!x.cards.length && !x.hits.length) continue;
        const mine = new Map(x.cards.map((r) => [r.card_id, r]));
        const merged = catalog.map((c) => { const m = mine.get(c.id); return m ? { ...c, owned: true, quantity: m.quantity, ascension: m.ascension || 0 } : { ...c, owned: false, quantity: 0, ascension: 0 }; });
        const joined = new Set(x.hits.map((h) => h.hunt_id));
        const stats = {
          packsOpened: x.opened, packsGifted: x.gifted, huntsJoined: joined.size,
          bossesDefeated: [...joined].filter((h) => defeated.has(h)).length,
          totalDamage: x.hits.reduce((t, h) => t + (h.damage || 0), 0),
          bestHit: x.hits.reduce((m, h) => Math.max(m, h.damage || 0), 0),
          boonsPlayed: x.boons, pranksPlayed: x.pranks, tradesDone: x.trades,
        };
        const power = x.cards.reduce((t, r) => t + cardPower(cp.get(r.card_id)?.rarity, r.ascension, byId.get(r.card_id)?.cp_mod), 0);
        rows.push({
          id, name: names.get(String(id))?.username || 'Someone', hasAvatar: !!names.get(String(id))?.avatar,
          title: names.get(String(id))?.title || null, frame: names.get(String(id))?.frame || null,
          power, huntDamage: stats.totalDamage, bosses: stats.bossesDefeated, cards: x.cards.length,
          achievements: measureAchievements(merged, stats).filter((a) => a.done).length,
        });
      }
      // The authoritative power (with the set-completion bonus), the same number as the profile.
      await Promise.all(rows.map(async (r) => {
        const { data } = await supabase.rpc('my_collection_power', { p_player_id: r.id });
        if (data != null) r.power = Number(data);
      }));
      boardV2Cache = { at: Date.now(), rows, totalCards: catalog.length };
  });
  if (!boardV2Cache) {
    try { await rebuildBoard(); } catch (e) { return res.status(500).json({ error: e.message }); }
  } else if (Date.now() - boardV2Cache.at > 60000) {
    rebuildBoard().catch((e) => console.error('board rebuild failed:', e.message)); // serve the old copy meanwhile
  }
  let live = null;
  if (hunt) {
    const leaders = await huntLeaders(hunt.id).catch(() => []);
    live = { name: hunt.name, tier: hunt.tier, share: hunt.hp_max ? Math.round((100 * (hunt.hp_max - hunt.hp_remaining)) / hunt.hp_max) : 0, leaders };
  }
  res.json({ me: String(me.id), rows: boardV2Cache.rows, totalCards: boardV2Cache.totalCards, achievementCount: ACHIEVEMENT_COUNT, live });
});

// The active boss, shared for 1 s (100 viewers polled it 33 times a second). An attack
// writes its new HP into the cache, so viewers still see the boss health drop live.
let activeHuntCache = null; // { at, data }
async function activeHunt() {
  if (activeHuntCache && Date.now() - activeHuntCache.at < 1000) return activeHuntCache.data;
  return singleFlight('activeHunt', async () => {
    let q = supabase
      .from('hunts')
      .select('id, name, tier, weak_points, resist_points, passive, stats, hp_max, hp_remaining, opens_at, closes_at, status')
      .eq('status', 'active')
      .gt('closes_at', new Date().toISOString());
    // Load tests only (LOADTEST is never set in production): fight a scratch boss.
    if (LOADTEST && process.env.LOADTEST_HUNT_ID) q = q.eq('id', Number(process.env.LOADTEST_HUNT_ID));
    const { data } = await q.order('id', { ascending: false }).limit(1).maybeSingle();
    activeHuntCache = { at: Date.now(), data: data || null };
    return data || null;
  });
}
const matchesWeak = (weak, { type, rarity, season }) => (weak || []).some((w) =>
  (w.kind === 'type' && w.value === type)
  || (w.kind === 'rarity' && w.value === rarity)
  || (w.kind === 'season' && w.value === season));

// The hunt view: the active boss + the caller's roster annotated with match/rested.
app.get('/api/hunt', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.json({ hunt: null });
  const hunt = await activeHunt();
  if (!hunt) {
    // Cooldown: no active boss. Return the next spawn time + the last boss outcome.
    const [{ data: nextSpawnAt }, { data: last }] = await Promise.all([
      supabase.rpc('next_hunt_spawn'),
      supabase.from('hunts').select('id, name, tier, status, hp_max, hp_remaining, weak_points, resist_points, passive, closes_at')
        .in('status', ['defeated', 'expired']).order('id', { ascending: false }).limit(1).maybeSingle(),
    ]);
    let lastBoard = [], myLast = 0, lastFeed = [];
    if (last) {
      const [lb, mine, fd] = await Promise.all([
        supabase.rpc('hunt_leaderboard', { p_hunt: last.id, p_limit: 5 }),
        supabase.from('hunt_hits').select('damage').eq('hunt_id', last.id).eq('player_id', me.id),
        queryHuntFeed(last.id).catch(() => ({ feed: [] })),
      ]);
      lastBoard = lb.data || [];
      myLast = (mine.data || []).reduce((t, h) => t + (h.damage || 0), 0);
      lastFeed = (fd.feed || []).slice(0, 8);
    }
    return res.json({ hunt: null, nextSpawnAt: nextSpawnAt || null, lastResult: last || null, lastBoard, myLast, lastFeed });
  }
  const today = new Date().toISOString().slice(0, 10);
  // One call (hunt_view.sql) instead of 4: 100 players opening the Hunt at once waited ~6 s.
  let cards, hpRows, myDamage, round, statCards = null;
  const { data: view, error: viewErr } = await supabase.rpc('hunt_view', { p_player: me.id, p_hunt: hunt.id, p_day: today });
  if (!viewErr && view) {
    cards = view.cards; hpRows = view.hp; myDamage = Number(view.damage) || 0; round = view.round || 0;
    if (view.stats?.on) statCards = view.stats.cards || {};
  } else { // the function is not live yet: the 4 separate calls
    const [{ data: c }, { data: hp }, { data: contrib }, { data: cstate }] = await Promise.all([
      supabase.from('player_cards')
        .select('ascension, first_obtained_at, card:cards(id, name, rarity, image_url, season, subject:subjects(type, cp_mod, ability, tags))')
        .eq('player_id', me.id),
      supabase.from('hunt_card_hp').select('card_id, hp_remaining, max_hp, downed, shield, cd_until_round').eq('hunt_id', hunt.id).eq('player_id', me.id).eq('hit_date', today),
      supabase.from('hunt_hits').select('damage').eq('hunt_id', hunt.id).eq('player_id', me.id),
      supabase.from('hunt_combat_state').select('round').eq('hunt_id', hunt.id).eq('player_id', me.id).eq('hit_date', today).maybeSingle(),
    ]);
    cards = c; hpRows = hp; myDamage = (contrib || []).reduce((t, h) => t + h.damage, 0); round = cstate?.round || 0;
  }
  const hpMap = new Map((hpRows || []).map((h) => [h.card_id, h]));
  const roster = (cards || []).map((row) => {
    const c = row.card; const type = c?.subject?.type;
    const sc = statCards?.[String(c?.id)];
    const power = sc ? sc.cp : cardPower(c?.rarity, row.ascension, c?.subject?.cp_mod);
    const st = hpMap.get(c?.id);
    const maxHp = st?.max_hp ?? (sc ? sc.hp : Math.max(60, Math.round(power * 1.8))); // = card_max_hp (floor 60)
    return {
      id: c?.id, name: c?.name, rarity: c?.rarity, image_url: toProxyImg(c?.image_url),
      ascension: row.ascension || 0, power, critAdd: sc?.crit || 0,
      type, matches: matchesWeak(hunt.weak_points, { type, rarity: c?.rarity, season: c?.season }),
      hp: st ? st.hp_remaining : maxHp, max_hp: maxHp, downed: st?.downed || false,
      used: !!st, // this card is committed for today (counts toward the daily cap)
      ability: c?.subject?.ability || null,
      tags: c?.subject?.tags || null, // faceted tags -> drives the element attack visual
      shield: st?.shield || 0, cdReady: st?.cd_until_round || 0, // support cooldown ready-round
      got: row.first_obtained_at || null, // the squad picker's "New" sort
    };
  }).sort((a, b) => (a.downed - b.downed) || (b.matches - a.matches) || (b.power - a.power));
  // Daily distinct-card cap (must match hunt_daily_card_cap in the SQL, default 8).
  const dailyCap = 8;
  res.json({ hunt, roster, myDamage, usedToday: (hpRows || []).length, dailyCap, round });
});

// Send a card at the boss (once per card per day). Atomic + row-locked in the RPC.
app.post('/api/hunt/attack', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.status(403).json({ error: 'hunt disabled' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const hunt = await activeHunt();
  if (!hunt) return res.status(400).json({ error: 'no active hunt' });
  const cardId = Number(req.body?.cardId);
  if (!cardId) return res.status(400).json({ error: 'bad card' });
  const { data, error } = await huntRpcGate(() => supabase.rpc('hunt_attack', { p_player: me.id, p_hunt: hunt.id, p_card: cardId }));
  if (error) return res.status(500).json({ error: error.message });
  if (data?.defeated) activeHuntCache = null;
  else if (data?.ok && activeHuntCache?.data?.id === hunt.id) activeHuntCache.data = { ...activeHuntCache.data, hp_remaining: data.hp_remaining };
  // The RPC settles the killing blow inline and records the defeat + reward notification
  // in the hunt_events outbox, which the bot posts. No announce here (it would duplicate).
  res.json(data);
});

// Fire a support card's ability (Item/Place/Moment). targetId is required for ally effects.
app.post('/api/hunt/support', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.status(403).json({ error: 'hunt disabled' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const hunt = await activeHunt();
  if (!hunt) return res.status(400).json({ error: 'no active hunt' });
  const cardId = Number(req.body?.cardId);
  const targetId = req.body?.targetId ? Number(req.body.targetId) : null;
  if (!cardId) return res.status(400).json({ error: 'bad card' });
  const { data, error } = await huntRpcGate(() => supabase.rpc('hunt_support', { p_player: me.id, p_hunt: hunt.id, p_card: cardId, p_target: targetId }));
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Auto-pick a squad: the best cards you own against TODAY'S boss. Scores each
// attacker by expected damage (CP x the same weakness/resistance multiplier the
// battle uses), tops the squad up with your best support, and returns the card
// ids. The client fills the picker; the player can still edit before Lock In.
app.get('/api/hunt/autopick', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.json({ ids: [] });
  const hunt = await activeHunt();
  if (!hunt) return res.json({ ids: [] });
  const cap = 8; // matches settings.hunt_daily_card_cap / the /api/hunt dailyCap
  const { data } = await supabase
    .from('player_cards')
    .select('ascension, card:cards(id, rarity, season, subject:subjects(type, cp_mod, tag_slugs, ability))')
    .eq('player_id', me.id);
  const weak = hunt.weak_points || [];
  const resist = hunt.resist_points || [];
  const matchCount = (entries, c) => (entries || []).reduce((n, e) => {
    if (e.kind === 'tag') return n + ((c.tag_slugs || []).includes(e.value) ? 1 : 0);
    if (e.kind === 'type') return n + (c.type === e.value ? 1 : 0);
    if (e.kind === 'rarity') return n + (c.rarity === e.value ? 1 : 0);
    if (e.kind === 'season') return n + (c.season === e.value ? 1 : 0);
    return n;
  }, 0);
  const mult = (wm, rm) => Math.max(0.25, Math.min(2.5, 1 + (1 - 0.5 ** wm) - 0.8 * (1 - 0.5 ** rm)));
  const ATT = new Set(['Character', 'Creature']);
  const scored = (data || []).map((row) => {
    const c = row.card; const sub = c?.subject || {};
    const info = { id: c?.id, rarity: c?.rarity, season: c?.season, type: sub.type, tag_slugs: sub.tag_slugs || [] };
    const cp = cardPower(c?.rarity, row.ascension, sub.cp_mod);
    const isAtt = ATT.has(sub.type);
    const ab = sub.ability;
    const score = isAtt
      ? cp * mult(matchCount(weak, info), matchCount(resist, info)) * (ab?.kind === 'attack' ? 1.1 : 1)
      : cp * (ab?.kind === 'support' ? 1.2 : 1);
    return { id: c?.id, isAtt, score };
  }).filter((x) => x.id);
  const atts = scored.filter((x) => x.isAtt).sort((a, b) => b.score - a.score);
  const sups = scored.filter((x) => !x.isAtt).sort((a, b) => b.score - a.score);
  const desiredSupport = Math.min(2, sups.length);
  const ids = [];
  for (const c of atts) { if (ids.length >= cap - desiredSupport) break; ids.push(c.id); }
  for (const c of sups) { if (ids.length >= cap) break; ids.push(c.id); }
  for (const c of [...atts, ...sups]) { if (ids.length >= cap) break; if (!ids.includes(c.id)) ids.push(c.id); }
  res.json({ ids: ids.slice(0, cap) });
});

// The live attack feed: every recent attack on the active boss (who, damage, card).
// High volume by design — this is the in-app equivalent of the community feed, so the
// Discord channel stays quiet. A 2s cache collapses many viewers into one DB read.
let huntFeedCache = null; // { at, huntId, data }
async function queryHuntFeed(huntId) {
  const now = Date.now();
  if (huntFeedCache && huntFeedCache.huntId === huntId && now - huntFeedCache.at < 2000) return huntFeedCache.data;
  return singleFlight(`feed:${huntId}`, async () => {
  const { data: rows } = await supabase
    .from('hunt_combat_log')
    .select('id, ts, player_id, card_id, damage, outcome, crit, bonus, card_downed, countered, counter_dmg')
    .eq('hunt_id', huntId).order('id', { ascending: false }).limit(25);
  const cardIds = [...new Set((rows || []).map((r) => r.card_id))];
  const playerIds = [...new Set((rows || []).map((r) => r.player_id))];
  const [{ data: cards }, { data: players }] = await Promise.all([
    cardIds.length ? supabase.from('cards').select('id, name, rarity').in('id', cardIds) : Promise.resolve({ data: [] }),
    playerIds.length ? supabase.from('players').select('id, username').in('id', playerIds) : Promise.resolve({ data: [] }),
  ]);
  const cmap = new Map((cards || []).map((c) => [c.id, c]));
  const pmap = new Map((players || []).map((p) => [p.id, p.username]));
  const feed = (rows || []).map((r) => ({
    id: r.id, at: r.ts, player: pmap.get(r.player_id) || 'Someone',
    card: cmap.get(r.card_id)?.name || 'a card', rarity: cmap.get(r.card_id)?.rarity || 'normal',
    damage: r.damage, outcome: r.outcome, crit: r.crit, bonus: r.bonus, downed: r.card_downed,
    countered: r.countered, counterDmg: r.counter_dmg,
  }));
  // "Hunters now" = distinct players who attacked in the last 5 minutes.
  const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('hunt_combat_log').select('player_id').eq('hunt_id', huntId).gt('ts', cutoff).limit(2000);
  const fighters = new Set((recent || []).map((r) => r.player_id)).size;
  const data = { feed, fighters };
  huntFeedCache = { at: Date.now(), huntId, data };
  return data;
  });
}
app.get('/api/hunt/feed', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.json({ feed: [] });
  const hunt = await activeHunt();
  if (!hunt) return res.json({ feed: [] });
  const fd = await queryHuntFeed(hunt.id);
  // The boss health is fetched fresh (activeHunt), so every viewer sees the shared
  // health drop live as others attack, and sees the defeat the moment it lands.
  res.json({ feed: fd.feed, fighters: fd.fighters, hp_remaining: hunt.hp_remaining, hp_max: hunt.hp_max, status: hunt.status });
});

// Per-hunt contribution leaderboard.
app.get('/api/hunt/leaderboard', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const hunt = await activeHunt();
  if (!hunt) return res.json({ leaders: [], me: me.id });
  try {
    res.json({ leaders: (await huntLeaders(hunt.id)).slice(0, 20), me: me.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// A layout report from the real client (v2 only, once per session): window + element
// sizes, to find why Discord hid the top bar in smaller windows (2026-09-28). Logged only.
app.post('/api/diag/layout', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).end();
  if (!rateLimit(me.id)) return res.status(429).end();
  console.log('layout-diag', String(me.id).slice(-4), JSON.stringify(req.body || {}).slice(0, 1500));
  res.json({ ok: true });
});

// The v2 profile of any member (?id=<discord id>, default = the caller): the stats the
// achievements need, the hunt rank, the spotlight, and for another member their cards.
const profileCache = new Map(); // id -> { at, payload }
const PROFILE_TTL = 20000;
// Everything the profile shows for one player (the stats also drive the achievements).
// Always with the player's cards: the route strips them for the caller's own profile.
// (Before, a self request cached a payload with no cards, and another member who opened
// that profile within 20s saw an empty collection.)
async function loadProfile(id) {
  const hunt = FEATURE_HUNT ? await activeHunt() : null;
  const [player, opened, gifted, hits, plays, pranked, trades, lb, cp, owned, claims] = await Promise.all([
    supabase.from('players').select('id, username, avatar, spotlight, title, frame').eq('id', id).maybeSingle(),
    supabase.from('pack_ledger').select('id', { count: 'exact', head: true }).eq('player_id', id).eq('reason', 'opened'),
    supabase.from('pack_ledger').select('id', { count: 'exact', head: true }).eq('granted_by', id).eq('reason', 'gift'),
    supabase.from('hunt_hits').select('hunt_id, damage').eq('player_id', id).limit(20000),
    supabase.from('card_plays').select('kind').eq('player_id', id).limit(20000),
    supabase.from('card_plays').select('id', { count: 'exact', head: true }).eq('target_id', id).eq('kind', 'prank').neq('player_id', id),
    supabase.from('trade_offers').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`from_id.eq.${id},to_id.eq.${id}`),
    hunt ? supabase.rpc('hunt_leaderboard', { p_hunt: hunt.id, p_limit: 100 }) : Promise.resolve({ data: [] }),
    supabase.rpc('my_collection_power', { p_player_id: id }),
    supabase.from('player_cards').select('card_id, quantity, ascension').eq('player_id', id),
    supabase.from('achievement_claims').select('key').eq('player_id', id),
  ]);
  if (!player.data) return null;
  const hitRows = hits.data || [];
  const joined = [...new Set(hitRows.map((h) => h.hunt_id))];
  let defeated = 0;
  if (joined.length) {
    const { count } = await supabase.from('hunts').select('id', { count: 'exact', head: true }).in('id', joined).eq('status', 'defeated');
    defeated = count || 0;
  }
  const kinds = (plays.data || []).reduce((m, r) => { m[r.kind] = (m[r.kind] || 0) + 1; return m; }, {});
  const leaders = lb.data || [];
  const idx = leaders.findIndex((r) => String(r.player_id) === id);
  const payload = {
    id, name: player.data.username, hasAvatar: !!player.data.avatar,
    spotlight: player.data.spotlight || [],
    title: player.data.title || null, frame: player.data.frame || null,
    claimed: (claims.data || []).map((c) => c.key),
    power: cp.data != null ? Number(cp.data) : null,
    huntRank: idx >= 0 ? idx + 1 : null, huntPlayers: leaders.length,
    stats: {
      packsOpened: opened.count || 0, packsGifted: gifted.count || 0,
      huntsJoined: joined.length, bossesDefeated: defeated,
      totalDamage: hitRows.reduce((t, h) => t + (h.damage || 0), 0),
      bestHit: hitRows.reduce((m, h) => Math.max(m, h.damage || 0), 0),
      boonsPlayed: kinds.boon || 0, pranksPlayed: kinds.prank || 0, neutralPlayed: kinds.neutral || 0,
      pranksReceived: pranked.count || 0, tradesDone: trades.count || 0,
    },
    cards: (owned.data || []).map((r) => ({ id: r.card_id, quantity: r.quantity, ascension: r.ascension || 0 })),
  };
  payload.packsOpened = payload.stats.packsOpened; // the v2 Home reads this name
  // The live hunt, for the profile's hunt box: damage, attacks, share of the boss HP,
  // damage per day, and the card that hit hardest.
  if (hunt) {
    const { data: hh } = await supabase.from('hunt_hits').select('card_id, damage, hit_date').eq('hunt_id', hunt.id).eq('player_id', id).limit(5000);
    const rows = hh || [];
    const byDay = {}; const byCard = {};
    for (const r of rows) { byDay[r.hit_date] = (byDay[r.hit_date] || 0) + (r.damage || 0); byCard[r.card_id] = (byCard[r.card_id] || 0) + (r.damage || 0); }
    const top = Object.entries(byCard).sort((a, b) => b[1] - a[1])[0];
    const damage = rows.reduce((t, r) => t + (r.damage || 0), 0);
    payload.hunt = {
      name: hunt.name, tier: hunt.tier, damage, attacks: rows.length,
      share: hunt.hp_max ? Math.round((1000 * damage) / hunt.hp_max) / 10 : 0,
      byDay: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([date, dmg]) => ({ date, damage: dmg })),
      topCard: top ? { id: Number(top[0]), damage: top[1] } : null,
    };
  }
  return payload;
}

app.get('/api/profile', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const id = String(req.query.id || me.id);
  if (!/^\d{1,25}$/.test(id)) return res.status(400).json({ error: 'bad id' });
  const self = id === String(me.id);
  let payload = profileCache.get(id)?.at > Date.now() - PROFILE_TTL ? profileCache.get(id).payload : null;
  if (!payload) {
    payload = await loadProfile(id);
    if (!payload) return res.status(404).json({ error: 'no such player' });
    profileCache.set(id, { at: Date.now(), payload });
  }
  res.json({ ...payload, cards: self ? undefined : payload.cards });
});

// The caller's achievements, measured on the server with the same rules the player sees.
async function measureFor(id) {
  const p = await loadProfile(id);
  if (!p) return null;
  const catalog = await getCatalogBase();
  const mine = new Map(p.cards.map((c) => [c.id, c]));
  const merged = catalog.map((c) => { const m = mine.get(c.id); return m ? { ...c, owned: true, quantity: m.quantity, ascension: m.ascension } : { ...c, owned: false, quantity: 0, ascension: 0 }; });
  return { p, achs: measureAchievements(merged, p.stats) };
}
async function claimOne(id, key) {
  const r = rewardOf(key);
  const { data, error } = await supabase.rpc('claim_achievement', { p_player: id, p_key: key, p_packs: r.packs || 0, p_title: r.title || null, p_frame: r.frame || null });
  if (error) throw new Error(error.message);
  return { ...data, key, reward: r };
}

// Redeem ALL finished, unclaimed achievements at once (Nathan: "a lot to go one by
// one"). Each one goes through claim_achievement, so each still pays only once.
app.post('/api/achievements/claim-all', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const m = await measureFor(String(me.id));
  if (!m) return res.status(404).json({ error: 'no such player' });
  const todo = m.achs.filter((a) => a.done && !m.p.claimed.includes(a.key));
  const claimed = []; let packs = 0; const titles = []; const frames = [];
  try {
    for (const a of todo) {
      const r = await claimOne(me.id, a.key);
      if (!r.ok) continue; // claimed meanwhile (another tab): skip it
      claimed.push(a.key); packs += r.reward.packs || 0;
      if (r.reward.title) titles.push(r.reward.title);
      if (r.reward.frame) frames.push(r.reward.frame);
    }
  } catch (e) { return res.status(500).json({ error: e.message, claimed }); }
  finally { profileCache.delete(String(me.id)); bustUser(me.id); boardV2Cache = null; }
  res.json({ ok: true, claimed, packs, titles, frames: [...new Set(frames)] });
});

// Redeem a finished achievement. The server measures it with the same rules the player
// sees (src/achievements.js); claim_achievement records it once and pays its packs.
app.post('/api/achievements/claim', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const key = String(req.body?.key || '');
  const def = ACHIEVEMENTS.find((a) => a.key === key);
  if (!def) return res.status(400).json({ error: 'unknown achievement' });
  const m = await measureFor(String(me.id));
  if (!m) return res.status(404).json({ error: 'no such player' });
  if (m.p.claimed.includes(key)) return res.json({ ok: false, error: 'claimed' });
  const a = m.achs.find((x) => x.key === key);
  if (!a?.done) return res.status(400).json({ error: 'not_done', have: a?.have, need: a?.need });
  let out;
  try { out = await claimOne(me.id, key); } catch (e) { return res.status(500).json({ error: e.message }); }
  profileCache.delete(String(me.id)); bustUser(me.id); boardV2Cache = null;
  res.json(out);
});

// Equip an unlocked title and/or frame (null = none). Only rewards the caller claimed.
app.post('/api/cosmetics', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const { data: claims } = await supabase.from('achievement_claims').select('title, frame').eq('player_id', me.id);
  const titles = new Set((claims || []).map((c) => c.title).filter(Boolean));
  const frames = new Set((claims || []).map((c) => c.frame).filter(Boolean));
  const patch = {};
  if ('title' in (req.body || {})) { const t = req.body.title; if (t !== null && !titles.has(t)) return res.status(400).json({ error: 'title locked' }); patch.title = t; }
  if ('frame' in (req.body || {})) { const f = req.body.frame; if (f !== null && !frames.has(f)) return res.status(400).json({ error: 'frame locked' }); patch.frame = f; }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'nothing to change' });
  const { error } = await supabase.from('players').update(patch).eq('id', me.id);
  if (error) return res.status(500).json({ error: error.message });
  profileCache.delete(String(me.id)); boardV2Cache = null;
  res.json({ ok: true, ...patch });
});

// Save the caller's spotlight: up to 3 cards the caller owns (empty = automatic).
app.post('/api/spotlight', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const ids = Array.isArray(req.body?.cardIds) ? [...new Set(req.body.cardIds.map(Number))] : null;
  if (!ids || ids.length > 3 || ids.some((n) => !Number.isInteger(n) || n <= 0)) return res.status(400).json({ error: 'bad cards' });
  if (ids.length) {
    const { data } = await supabase.from('player_cards').select('card_id').eq('player_id', me.id).in('card_id', ids);
    if ((data || []).length !== ids.length) return res.status(400).json({ error: 'not owned' });
  }
  const { error } = await supabase.from('players').update({ spotlight: ids }).eq('id', me.id);
  if (error) return res.status(500).json({ error: error.message });
  profileCache.delete(String(me.id));
  res.json({ ok: true, spotlight: ids });
});

// The card catalog is identical for every player except the "owned" overlay, so
// the heavy cards+subjects join is cached (60s) and shared. Per request we run
// only ONE light query — the caller's owned card ids — instead of the full join.
let catalogCache = null; // { at, cards: [base, owned:false] }
let catalogInflight = null; // single-flight: one refresh even under a stampede
const CATALOG_TTL = 60 * 1000;
async function getCatalogBase() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CATALOG_TTL) return catalogCache.cards;
  if (catalogInflight) return catalogInflight; // a refresh is already running — join it
  catalogInflight = (async () => {
    const { data, error } = await supabase
      .from('cards')
      .select(`id, name, rarity, image_url, season, event, artist_credit, lore, subject:subjects(name, type, cp_mod, tags, ability${EFFECT_COLS})`)
      .order('id');
    if (error) { if (catalogCache) return catalogCache.cards; throw new Error(error.message); }
    const cards = (data || []).map((c) => ({
      id: c.id,
      name: c.name,
      rarity: c.rarity,
      image_url: toProxyImg(c.image_url),
      season: c.season || 'Season 1',
      event: c.event || null,
      artist: c.artist_credit,
      lore: c.lore,
      power: cardPower(c.rarity, 0, c.subject?.cp_mod), // the base (unascended) power
      cp_mod: c.subject?.cp_mod ?? 1,
      subject: c.subject?.name,
      type: c.subject?.type || null,
      tags: c.subject?.tags || null,
      ability: c.subject?.ability || null,
      subject_id: c.subject?.id ?? null,
      effect: c.subject?.effect || null,
    }));
    catalogCache = { at: Date.now(), cards };
    return cards;
  })().finally(() => { catalogInflight = null; });
  return catalogInflight;
}

// The full catalog grouped for the Season Gallery, flagged with what the caller
// already owns (owned vs still-needed).
app.get('/api/catalog', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  let base;
  try { base = await getCatalogBase(); } catch (e) { return res.status(500).json({ error: e.message }); }
  // The per-user "owned" overlay is the only DB hit here; cache it 8s (busted on
  // open/receive/trade) so a browsing user does not re-query the DB every call.
  const cachedOwned = ownedCache.get(me.id);
  let owned;
  if (cachedOwned && Date.now() - cachedOwned.at < OWNED_TTL) {
    owned = cachedOwned.owned;
  } else {
    const { data: ownedRows } = await supabase.from('player_cards').select('card_id').eq('player_id', me.id);
    owned = new Set((ownedRows || []).map((r) => r.card_id));
    ownedCache.set(me.id, { at: Date.now(), owned });
  }
  res.json({ cards: base.map((c) => ({ ...c, owned: owned.has(c.id) })) });
});

// Community Pulls: the newest cards anyone obtained for the first time, across
// all players. Sourced from player_cards.first_obtained_at (a per-player-per-card
// timestamp), so it is a "new cards entering the community" feed. Auth-gated like
// the rest, but the data is everyone's — the point is to see what others pull.
const PULLS_SELECT = 'first_obtained_at, player_id, player:players(username), card:cards(id, name, rarity, image_url, season, event, artist_credit, lore)';
// The community feed is identical for everyone, so a 3s cache collapses N viewers'
// /api/pulls calls into one DB query every 3s. The 5s SSE poller (> 3s) still gets
// fresh data each tick, so pushed updates are unaffected.
let pullsCache = null; // { at, data }
let pullsInflight = null; // single-flight
const PULLS_TTL = 3000;
async function queryPulls() {
  const now = Date.now();
  if (pullsCache && now - pullsCache.at < PULLS_TTL) return pullsCache.data;
  if (pullsInflight) return pullsInflight;
  pullsInflight = (async () => {
  const { data, error } = await supabase
    .from('player_cards')
    .select(PULLS_SELECT)
    .order('first_obtained_at', { ascending: false })
    .limit(40);
  if (error) return pullsCache ? pullsCache.data : null;
  const mapped = (data || []).map((row) => ({
    at: row.first_obtained_at,
    player: row.player?.username || 'Someone',
    player_id: row.player_id, // the v2 feed shows this member's name badge (sticker / title)
    id: row.card?.id,
    name: row.card?.name,
    rarity: row.card?.rarity,
    season: row.card?.season || 'Season 1',
    event: row.card?.event || null,
    artist: row.card?.artist_credit,
    lore: row.card?.lore,
    image_url: toProxyImg(row.card?.image_url),
  }));
    pullsCache = { at: Date.now(), data: mapped };
    return mapped;
  })().finally(() => { pullsInflight = null; });
  return pullsInflight;
}

app.get('/api/pulls', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const pulls = await queryPulls();
  if (!pulls) return res.status(500).json({ error: 'pulls query failed' });
  res.json({ pulls });
});

// Phase 2 — server push. One backend poller watches the database and streams the
// latest pulls to every connected viewer over Server-Sent Events. No bot change:
// the bot just writes to the database, and we notice the change here. EventSource
// (the browser side) cannot set headers, so the token comes as a query param.
const streamClients = new Set();
let lastTop = null; // newest pull timestamp last broadcast

app.get('/api/pulls/stream', async (req, res) => {
  const me = await whoAmI(String(req.query.token || ''));
  if (!me) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // ask any proxy not to buffer the stream
  });
  res.write('retry: 5000\n\n'); // EventSource reconnects 5s after a drop
  const pulls = await queryPulls();
  if (pulls) { lastTop = pulls[0]?.at || lastTop; res.write(`data: ${JSON.stringify({ pulls })}\n\n`); }
  streamClients.add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000); // keep proxies from closing an idle stream
  req.on('close', () => { clearInterval(heartbeat); streamClients.delete(res); });
});

// The single poller. It only touches the database while someone is watching, and
// only broadcasts when the newest pull actually changed.
setInterval(async () => {
  if (streamClients.size === 0) return;
  const pulls = await queryPulls();
  if (!pulls) return;
  const top = pulls[0]?.at || '';
  if (top === lastTop) return;
  lastTop = top;
  const frame = `data: ${JSON.stringify({ pulls })}\n\n`;
  for (const client of streamClients) client.write(frame);
}, 5000);

// Phase 3a — the shared room. People who launch the Activity from the SAME voice
// channel share a Discord "instance", identified by instanceId. We key a room on
// that id so they can see each other (presence now; pack-opens + reactions next).
// The transport is a WebSocket on /ws, carried through the same proxy as the page.
const rooms = new Map(); // instanceId -> Map(ws -> { id, name })

const STATUS_KINDS = new Set(['home', 'collection', 'hunt', 'trading', 'opening', 'battle']);
function presenceList(instanceId) {
  const members = rooms.get(instanceId);
  if (!members) return [];
  // A user may have two tabs open — show each person once.
  const byId = new Map();
  for (const u of members.values()) {
    const prev = byId.get(u.id);
    if (!prev || (u.status?.at || 0) > (prev.status?.at || 0)) byId.set(u.id, u);
  }
  return [...byId.values()];
}

function roomSend(instanceId, obj) {
  const members = rooms.get(instanceId);
  if (!members) return;
  const frame = JSON.stringify(obj);
  for (const ws of members.keys()) { try { ws.send(frame); } catch { /* dropped socket */ } }
}

// Per-user token bucket. Guards the write endpoints so one valid-token holder
// cannot flood the bot + database. Generous: a 10-request burst that refills at
// 5/sec — far above real play, so a normal user never sees a 429. Keyed on the
// verified Discord id, so it cannot be bypassed by rotating tokens.
const RL_BURST = 10;   // bucket capacity (max burst)
const RL_REFILL = 5;   // tokens restored per second
const rlBuckets = new Map(); // userId -> { tokens, at }
const RL_READ_BURST = 60, RL_READ_REFILL = 10; // per member: 60 at once, 10 per second after
const readBuckets = new Map();
function readLimit(userId) {
  const now = Date.now();
  let b = readBuckets.get(userId);
  if (!b) { b = { tokens: RL_READ_BURST, at: now }; readBuckets.set(userId, b); }
  b.tokens = Math.min(RL_READ_BURST, b.tokens + ((now - b.at) / 1000) * RL_READ_REFILL);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
function rateLimit(userId) {
  const now = Date.now();
  let b = rlBuckets.get(userId);
  if (!b) { b = { tokens: RL_BURST, at: now }; rlBuckets.set(userId, b); }
  b.tokens = Math.min(RL_BURST, b.tokens + ((now - b.at) / 1000) * RL_REFILL);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}
// Drop idle buckets every 5 min so the Map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [id, b] of rlBuckets) if (b.at < cutoff && b.tokens >= RL_BURST) rlBuckets.delete(id);
  for (const [id, b] of readBuckets) if (b.at < cutoff) readBuckets.delete(id);
}, 300000).unref();

// Open the caller's earned packs. The draw + economy run in the bot (via its
// internal endpoint); we only verify who the caller is, then relay the reveal.
// If the caller passes an instanceId, we also broadcast the reveal to their room.
app.post('/api/open', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  if (!INTERNAL_TOKEN) return res.status(503).json({ error: 'opening is not configured' });
  // 1, 5 or 10 packs at once (Nathan: "in increments of 1x, 5x, 10x"); the bot stops
  // early if the balance runs out. Cards the member did not own before get isNew.
  const count = [1, 5, 10].includes(Number(req.body?.count)) ? Number(req.body.count) : 1;
  try {
    const { data: before } = await supabase.from('player_cards').select('card_id').eq('player_id', me.id);
    const had = new Set((before || []).map((r) => r.card_id));
    const r = await fetch(`${BOT_INTERNAL_URL}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ userId: me.id, username: me.global_name || me.username, count }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error || 'open failed' });
    const seen = new Set();
    const packs = (data.packs || []).map((pack) => pack.map((c) => {
      const out = cardForClient(c);
      out.isNew = !had.has(out.id) && !seen.has(out.id);
      seen.add(out.id);
      return out;
    }));
    const cards = packs.flat();
    bustUser(me.id);      // new cards → their collection changed
    pullsCache = null;    // new pull → refresh the community feed now, not in 3s
    const name = me.global_name || me.username;
    const instanceId = req.body?.instanceId;
    if (instanceId && cards.length) roomSend(instanceId, { type: 'open', user: name, cards });
    res.json({ award: data.award, packs, cards });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// How many packs the caller has waiting — so the UI shows Open Pack only when
// there is something to open. Read-only relay to the bot.
app.get('/api/pack-status', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!INTERNAL_TOKEN) return res.json({ packs: 0 });
  // Cache the balance 8s (busted on open/gift/trade). A pack earned in Discord
  // shows within 8s; an Activity-side change busts immediately, so the button
  // state stays correct after the caller's own actions.
  const cachedStatus = packStatusCache.get(me.id);
  if (cachedStatus && Date.now() - cachedStatus.at < PACK_STATUS_TTL) return res.json({ packs: cachedStatus.packs });
  try {
    const r = await fetch(`${BOT_INTERNAL_URL}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ userId: me.id }),
    });
    const data = await r.json();
    const packs = Number(data?.packs) || 0;
    packStatusCache.set(me.id, { at: Date.now(), packs });
    res.json({ packs });
  } catch {
    res.json({ packs: 0 });
  }
});

// Find players to gift/trade with — the game's own directory (everyone who has
// played), so you can reach someone who is NOT in your voice channel.
let playersCache = null; // { at, data } — unfiltered directory only
app.get('/api/players', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const q = String(req.query.q || '').trim();
  // The unfiltered directory is the same for everyone (minus self) — cache it 30s.
  if (!q) {
    const now = Date.now();
    if (!playersCache || now - playersCache.at >= 30000) {
      const { data, error } = await supabase.from('players').select('id, username, pack_balance').order('username').limit(12);
      if (error) return res.status(500).json({ error: error.message });
      playersCache = { at: now, data: data || [] };
    }
    return res.json({ players: playersCache.data.filter((p) => p.id !== me.id) });
  }
  // Escape LIKE metacharacters so a caller cannot widen the match (a bare % would
  // match every player). PostgreSQL LIKE uses backslash as the default escape.
  const safeQ = q.replace(/[\\%_]/g, '\\$&');
  const { data, error } = await supabase.from('players').select('id, username, pack_balance').order('username').limit(12).ilike('username', `%${safeQ}%`);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ players: (data || []).filter((p) => p.id !== me.id) });
});

// Gift packs from the caller's balance to another player (relayed to the bot,
// which owns the economy). The sender is always the verified caller.
app.post('/api/gift', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  if (!INTERNAL_TOKEN) return res.status(503).json({ error: 'gifting is not configured' });
  const toId = String(req.body?.toId || '');
  // Coerce to a positive integer with a sane cap; do not rely only on the RPC.
  const amount = Math.min(999, Math.max(1, Math.floor(Number(req.body?.amount) || 1)));
  if (!toId || toId === me.id) return res.status(400).json({ error: 'bad target' });
  try {
    const r = await fetch(`${BOT_INTERNAL_URL}/gift`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ fromId: me.id, toId, amount }),
    });
    const data = await r.json();
    if (data?.ok) {
      const from = me.global_name || me.username;
      notify(toId, 'pack_gift', `🎁 ${from} gifted you ${amount} pack${amount === 1 ? '' : 's'}!`);
      announce(`🎁 <@${toId}> — **${from}** gifted you ${amount} pack${amount === 1 ? '' : 's'}!`);
    }
    res.json({ ok: Boolean(data?.ok) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Verify the caller from the Bearer token; returns the Discord user or null.
async function caller(req) {
  return whoAmI((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
}
registerEffectRoutes(app, { supabase, caller, rateLimit, toProxyImg });
const cardShape = (c) => c && { id: c.id, name: c.name, rarity: c.rarity, image_url: toProxyImg(c.image_url) };

// Another player's cards — for picking what to request/gift in a trade.
app.get('/api/player-cards', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const pid = String(req.query.id || '');
  if (!pid) return res.status(400).json({ error: 'missing id' });
  const { data, error } = await supabase
    .from('player_cards')
    .select('quantity, card:cards(id, name, rarity, image_url, tradeable, season, event, artist_credit, lore, subject:subjects(name))')
    .eq('player_id', pid);
  if (error) return res.status(500).json({ error: error.message });
  const cards = (data || []).map((r) => ({
    quantity: r.quantity,
    id: r.card?.id,
    name: r.card?.name,
    rarity: r.card?.rarity,
    image_url: toProxyImg(r.card?.image_url),
    tradeable: r.card?.tradeable !== false,
    season: r.card?.season || 'Season 1',
    event: r.card?.event || null,
    artist: r.card?.artist_credit,
    lore: r.card?.lore,
    subject: r.card?.subject?.name,
  }));
  res.json({ cards });
});

// Pending trade offers involving the caller (incoming + outgoing).
app.get('/api/trades', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const { data, error } = await supabase
    .from('trade_offers')
    .select('id, from_id, to_id, created_at, offer:cards!trade_offers_offer_card_id_fkey(id,name,rarity,image_url), request:cards!trade_offers_request_card_id_fkey(id,name,rarity,image_url), from_player:players!trade_offers_from_id_fkey(username), to_player:players!trade_offers_to_id_fkey(username)')
    .or(`to_id.eq.${me.id},from_id.eq.${me.id}`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const shape = (o) => ({
    id: o.id,
    from_id: o.from_id,
    to_id: o.to_id,
    from_name: o.from_player?.username,
    to_name: o.to_player?.username,
    offer: cardShape(o.offer),
    request: cardShape(o.request),
  });
  const all = (data || []).map(shape);
  res.json({ incoming: all.filter((o) => o.to_id === me.id), outgoing: all.filter((o) => o.from_id === me.id) });
});

// Gift a card outright (one-sided). RPC enforces: not gold, tradeable, owned.
app.post('/api/trade/gift', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const toId = String(req.body?.toId || '');
  const cardId = Number(req.body?.cardId);
  if (!toId || !cardId || toId === me.id) return res.status(400).json({ error: 'bad request' });
  const { data, error } = await supabase.rpc('gift_card', { p_from: me.id, p_to: toId, p_card_id: cardId });
  if (error) return res.status(500).json({ error: error.message });
  if (data) {
    bustUser(me.id); bustUser(toId);   // both collections changed
    const from = me.global_name || me.username;
    notify(toId, 'card_gift', `🎁 ${from} gave you a card!`);
    announce(`🎁 <@${toId}> — **${from}** gave you a card!`);
  }
  res.json({ ok: Boolean(data) });
});

// Propose a swap. RPC enforces: same rarity, both tradeable, proposer owns offer.
app.post('/api/trade/offer', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const toId = String(req.body?.toId || '');
  const offerCardId = Number(req.body?.offerCardId);
  const requestCardId = Number(req.body?.requestCardId);
  if (!toId || !offerCardId || !requestCardId) return res.status(400).json({ error: 'bad request' });
  const { data, error } = await supabase.rpc('create_trade', {
    p_from: me.id, p_to: toId, p_offer: offerCardId, p_request: requestCardId,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (data != null) {
    const from = me.global_name || me.username;
    notify(toId, 'trade_offer', `🔄 ${from} sent you a trade offer! Open the Trading tab.`);
    announce(`🔄 <@${toId}> — **${from}** sent you a trade offer! Open Lion Pride TCG to accept or decline.`);
  }
  res.json({ ok: data != null, id: data });
});

// Accept an incoming swap (caller must be the recipient).
app.post('/api/trade/accept', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const offerId = Number(req.body?.offerId);
  if (!offerId) return res.status(400).json({ error: 'bad request' });
  const { data: offer } = await supabase.from('trade_offers').select('from_id').eq('id', offerId).maybeSingle();
  const { data, error } = await supabase.rpc('accept_trade', { p_offer_id: offerId, p_accepter: me.id });
  if (error) return res.status(500).json({ error: error.message });
  if (data && offer?.from_id) {
    bustUser(me.id); bustUser(offer.from_id);   // the swap moved cards both ways
    const who = me.global_name || me.username;
    notify(offer.from_id, 'trade_accepted', `✅ ${who} accepted your trade!`);
    announce(`✅ <@${offer.from_id}> — **${who}** accepted your trade!`);
  }
  res.json({ ok: Boolean(data) });
});

// Ping settings (notify_prefs.sql): may the bot's channel posts ping me? Mute all, or per
// kind. The bot reads players.notify_prefs (tcg-bot/src/ping-prefs.ts, a 30 s cache).
const PING_KEYS = ['all', 'plays', 'trades', 'raid', 'packs'];
app.get('/api/notify-prefs', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const { data } = await supabase.from('players').select('notify_prefs').eq('id', me.id).maybeSingle();
  res.json({ prefs: data?.notify_prefs || {} });
});
app.post('/api/notify-prefs', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const prefs = {};
  for (const k of PING_KEYS) if (typeof req.body?.prefs?.[k] === 'boolean') prefs[k] = req.body.prefs[k];
  const { data: upd, error } = await supabase.from('players').update({ notify_prefs: prefs }).eq('id', String(me.id)).select('id');
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!upd?.length) { // a member with no player row yet
    const { error: ie } = await supabase.from('players').insert({ id: String(me.id), username: me.global_name || me.username, notify_prefs: prefs });
    if (ie) return res.status(500).json({ ok: false, error: ie.message });
  }
  res.json({ ok: true, prefs });
});

// In-app notifications (the bell). Recent items for the caller + unread count.
app.get('/api/notifications', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, message, read, created_at')
    .eq('player_id', me.id)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) return res.status(500).json({ error: error.message });
  const items = data || [];
  res.json({ items, unread: items.filter((n) => !n.read).length });
});

// Mark all the caller's notifications as read.
app.post('/api/notifications/read', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  await supabase.from('notifications').update({ read: true }).eq('player_id', me.id).eq('read', false);
  res.json({ ok: true });
});

// Decline (recipient) or cancel (sender) a pending swap.
app.post('/api/trade/resolve', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
  const offerId = Number(req.body?.offerId);
  const status = req.body?.action === 'cancel' ? 'cancelled' : req.body?.action === 'decline' ? 'declined' : '';
  if (!offerId || !status) return res.status(400).json({ error: 'bad request' });
  const { data, error } = await supabase.rpc('set_trade_status', { p_offer_id: offerId, p_actor: me.id, p_status: status });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: Boolean(data) });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const me = await whoAmI(params.get('token') || '');
  const instanceId = params.get('instanceId') || '';
  if (!me || !instanceId) { ws.close(); return; }

  let members = rooms.get(instanceId);
  if (!members) { members = new Map(); rooms.set(instanceId, members); }
  members.set(ws, { id: me.id, name: me.global_name || me.username, status: null });
  roomSend(instanceId, { type: 'presence', users: presenceList(instanceId) });

  // Reactions: a viewer taps an emoji; everyone in the room sees it.
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type === 'react' && typeof msg.emoji === 'string') {
      const who = members.get(ws);
      roomSend(instanceId, { type: 'react', user: who?.name || 'Someone', emoji: msg.emoji.slice(0, 8) });
    } else if (msg?.type === 'status') {
      // What this member does now (v2 Home "Live in voice"). Allow-listed values only.
      const who = members.get(ws);
      if (!who || !STATUS_KINDS.has(msg.kind)) return;
      who.status = { kind: msg.kind, card: typeof msg.card === 'string' ? msg.card.slice(0, 60) : null, at: Date.now() };
      roomSend(instanceId, { type: 'presence', users: presenceList(instanceId) });
    }
  });

  ws.on('close', () => {
    members.delete(ws);
    if (members.size === 0) rooms.delete(instanceId);
    else roomSend(instanceId, { type: 'presence', users: presenceList(instanceId) });
  });
});

const PORT = Number(process.env.PORT) || 4441;
// Bind loopback only. Caddy (same host) reverse-proxies to localhost, so nothing
// off-box needs a direct connection. This keeps the port closed even if both
// firewall layers were ever misconfigured (defense in depth).
const HOST = process.env.BIND_HOST || '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`TCG Activity -> http://${HOST}:${PORT}`));
