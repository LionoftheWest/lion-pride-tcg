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
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
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
const indexHtml = readFileSync(join(PUBLIC, 'index.html'), 'utf8')
  .replace('__BUNDLE__', bundleName)
  .replace('__CSSV__', cssVersion);
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
const CARD_BACK = SUPA_HOST ? toProxyImg(`${SUPA_HOST}/storage/v1/object/public/card-art/cards/card-back.png`) : '';
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
async function announce(message) {
  if (!INTERNAL_TOKEN) return;
  try {
    await fetch(`${BOT_INTERNAL_URL}/announce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ message }),
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
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json());

// Card-art proxy: stream a Supabase storage object through this server. This replaces
// Discord's flaky /cdn image proxy. Only the public card-art storage path is allowed.
app.get(/^\/api\/img\/(.+)/, async (req, res) => {
  if (!SUPA_HOST) return res.status(404).end();
  const path = decodeURIComponent(req.params[0] || '');
  const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  if (!path.startsWith('storage/v1/object/public/card-art/')) return res.status(400).end();
  try {
    const r = await fetch(`${SUPA_HOST}/${path}${query}`);
    if (!r.ok) return res.status(r.status).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch { res.status(502).end(); }
});

// index.html is served with the hashed bundle name injected. It must never be
// cached (no-store) so a redeploy is picked up; the hashed bundle itself can be
// cached forever because its URL changes whenever its content changes.
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(indexHtml);
});
app.use(express.static(PUBLIC, {
  setHeaders: (res, path) => {
    if (/^main\..*\.js$/.test(path.split(/[\\/]/).pop())) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

// Step 2: the caller's own collection.
app.get('/api/collection', async (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const me = await whoAmI(token);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const cached = collCache.get(me.id);
  if (cached && Date.now() - cached.at < COLL_TTL) return res.json(cached.payload);
  const { data, error } = await supabase
    .from('player_cards')
    .select('quantity, ascension, card:cards(id, name, rarity, image_url, artist_credit, lore, season, event, tradeable, subject:subjects(name, type, cp_mod, tags, ability))')
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
    };
  });
  // Total CP comes from SQL (authoritative — includes the +25% set-completion
  // bonus). Fall back to the per-card sum if the RPC is unavailable.
  let totalPower = cards.reduce((s, c) => s + c.power, 0);
  try {
    const { data: cp } = await supabase.rpc('my_collection_power', { p_player_id: me.id });
    if (cp != null) totalPower = Number(cp);
  } catch { /* keep the fallback */ }
  const payload = { user: { id: me.id, name: me.global_name || me.username }, cards, power: totalPower };
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
async function activeHunt() {
  const { data } = await supabase
    .from('hunts')
    .select('id, name, tier, weak_points, resist_points, hp_max, hp_remaining, opens_at, closes_at, status')
    .eq('status', 'active')
    .gt('closes_at', new Date().toISOString())
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
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
      supabase.from('hunts').select('name, tier, status')
        .in('status', ['defeated', 'expired']).order('id', { ascending: false }).limit(1).maybeSingle(),
    ]);
    return res.json({ hunt: null, nextSpawnAt: nextSpawnAt || null, lastResult: last || null });
  }
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: cards }, { data: hpRows }, { data: contrib }, { data: cstate }] = await Promise.all([
    supabase.from('player_cards')
      .select('ascension, card:cards(id, name, rarity, image_url, season, subject:subjects(type, cp_mod, ability))')
      .eq('player_id', me.id),
    supabase.from('hunt_card_hp').select('card_id, hp_remaining, max_hp, downed, shield, cd_until_round').eq('hunt_id', hunt.id).eq('player_id', me.id).eq('hit_date', today),
    supabase.from('hunt_hits').select('damage').eq('hunt_id', hunt.id).eq('player_id', me.id),
    supabase.from('hunt_combat_state').select('round').eq('hunt_id', hunt.id).eq('player_id', me.id).eq('hit_date', today).maybeSingle(),
  ]);
  const hpMap = new Map((hpRows || []).map((h) => [h.card_id, h]));
  const myDamage = (contrib || []).reduce((s, h) => s + h.damage, 0);
  const round = cstate?.round || 0;
  const roster = (cards || []).map((row) => {
    const c = row.card; const type = c?.subject?.type;
    const power = cardPower(c?.rarity, row.ascension, c?.subject?.cp_mod);
    const st = hpMap.get(c?.id);
    const maxHp = st?.max_hp ?? Math.max(30, Math.round(power * 1.8));
    return {
      id: c?.id, name: c?.name, rarity: c?.rarity, image_url: toProxyImg(c?.image_url),
      ascension: row.ascension || 0, power,
      type, matches: matchesWeak(hunt.weak_points, { type, rarity: c?.rarity, season: c?.season }),
      hp: st ? st.hp_remaining : maxHp, max_hp: maxHp, downed: st?.downed || false,
      used: !!st, // this card is committed for today (counts toward the daily cap)
      ability: c?.subject?.ability || null,
      shield: st?.shield || 0, cdReady: st?.cd_until_round || 0, // support cooldown ready-round
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
  const { data, error } = await supabase.rpc('hunt_attack', { p_player: me.id, p_hunt: hunt.id, p_card: cardId });
  if (error) return res.status(500).json({ error: error.message });
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
  const { data, error } = await supabase.rpc('hunt_support', { p_player: me.id, p_hunt: hunt.id, p_card: cardId, p_target: targetId });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// The live attack feed: every recent attack on the active boss (who, damage, card).
// High volume by design — this is the in-app equivalent of the community feed, so the
// Discord channel stays quiet. A 2s cache collapses many viewers into one DB read.
let huntFeedCache = null; // { at, huntId, data }
async function queryHuntFeed(huntId) {
  const now = Date.now();
  if (huntFeedCache && huntFeedCache.huntId === huntId && now - huntFeedCache.at < 2000) return huntFeedCache.data;
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
  huntFeedCache = { at: Date.now(), huntId, data: feed };
  return feed;
}
app.get('/api/hunt/feed', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  if (!FEATURE_HUNT) return res.json({ feed: [] });
  const hunt = await activeHunt();
  if (!hunt) return res.json({ feed: [] });
  res.json({ feed: await queryHuntFeed(hunt.id) });
});

// Per-hunt contribution leaderboard.
app.get('/api/hunt/leaderboard', async (req, res) => {
  const me = await caller(req);
  if (!me) return res.status(401).json({ error: 'not authenticated' });
  const hunt = await activeHunt();
  if (!hunt) return res.json({ leaders: [], me: me.id });
  const { data, error } = await supabase.rpc('hunt_leaderboard', { p_hunt: hunt.id, p_limit: 20 });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ leaders: data || [], me: me.id });
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
      .select('id, name, rarity, image_url, season, event, artist_credit, lore, subject:subjects(name, type, tags, ability)')
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
      subject: c.subject?.name,
      type: c.subject?.type || null,
      tags: c.subject?.tags || null,
      ability: c.subject?.ability || null,
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
const PULLS_SELECT = 'first_obtained_at, player:players(username), card:cards(id, name, rarity, image_url, season, event, artist_credit, lore)';
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

function presenceList(instanceId) {
  const members = rooms.get(instanceId);
  if (!members) return [];
  // A user may have two tabs open — show each person once.
  const byId = new Map();
  for (const u of members.values()) byId.set(u.id, u);
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
  try {
    const r = await fetch(`${BOT_INTERNAL_URL}/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
      body: JSON.stringify({ userId: me.id, username: me.global_name || me.username }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error || 'open failed' });
    const packs = (data.packs || []).map((pack) => pack.map(cardForClient));
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
  members.set(ws, { id: me.id, name: me.global_name || me.username });
  roomSend(instanceId, { type: 'presence', users: presenceList(instanceId) });

  // Reactions: a viewer taps an emoji; everyone in the room sees it.
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg?.type === 'react' && typeof msg.emoji === 'string') {
      const who = members.get(ws);
      roomSend(instanceId, { type: 'react', user: who?.name || 'Someone', emoji: msg.emoji.slice(0, 8) });
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
