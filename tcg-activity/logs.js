// The app logs (Nathan, 2026-10-07: "I want to be gathering as much data as possible"). logs_app.sql has the tables.
//   app_sessions    a visit: app_session_touch at most every 5 minutes per member (any API call that names the member)
//   page_views      a screen: one row per member, view and ref per 10 minutes at most
//   tutorial_steps  a walkthrough step, the first time only
// Each write is one small request with no read-back, sent after the answer, and a failed write is dropped: a log must
// never slow or break the game. The flag FEATURE_APP_LOGS=1 turns it on (default OFF: the tables come with
// logs_app.sql, which must be applied first). LOADTEST (local previews) never writes.

export const APP_LOGS_ON = process.env.FEATURE_APP_LOGS === '1';
export const SESSION_EVERY_MS = 5 * 60_000;
export const VIEW_EVERY_MS = 10 * 60_000;

// The screens with their own data route: logged when the route answers 200 (GET only). ref = what on the screen.
// Not here, because the client calls them outside their screen too (the server cannot tell a view):
// /api/hunt (Home, the bell, the dock dot), /api/collection (at login and after each pack), /api/profile for the
// member self (each Home paint), /api/dailies (at login). The client sends those with POST /api/view.
export const VIEW_ROUTES = {
  '/api/shop': () => ({ view: 'shop' }),
  '/api/hall': () => ({ view: 'hall' }),
  '/api/auctions': (req) => ({ view: 'auctions', ref: req.query.view === 'mine' ? 'mine' : 'open' }),
  '/api/auction': (req) => ({ view: 'auction', ref: /^\d{1,18}$/.test(String(req.query.id || '')) ? String(req.query.id) : null }),
  '/api/dungeon': () => ({ view: 'dungeon' }),
  '/api/gauntlet': () => ({ view: 'gauntlet' }),
  '/api/leaderboard/v2': () => ({ view: 'leaderboard' }),
  // Another member's profile only (the own profile loads on each Home paint).
  '/api/profile': (req, me) => {
    const id = String(req.query.id || '');
    return /^\d{1,25}$/.test(id) && id !== String(me.id) ? { view: 'member_profile', ref: id } : null;
  },
};
// The screens the client may name in POST /api/view (the UI session adds the calls). Anything else is refused.
export const CLIENT_VIEWS = ['home', 'collection', 'hunt', 'trading', 'profile', 'dailies', 'achievements', 'bell', 'help', 'wishlist', 'shop', 'hall', 'auctions', 'dungeon', 'gauntlet', 'leaderboard'];

/** desktop, mobile or web from a user agent. Inferred: the Discord desktop app is Electron with "discord/<version>";
 *  the phone app opens the Activity in an Android WebView or an iOS WKWebView. The raw agent is kept with it. */
export function platformOf(ua) {
  const s = String(ua || '');
  if (!s) return 'unknown';
  if (/\bdiscord\/[\d.]+|Electron\//i.test(s)) return 'desktop';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(s)) return 'mobile';
  return 'web';
}

/** What the server knows of the client: the user agent, and the hints the client may send (?platform=&w=&h= on
 *  /api/flags: the Discord SDK platform and the window size). Short, allow-listed values only. */
export function clientInfo(req, { hints = false } = {}) {
  const ua = String(req.headers?.['user-agent'] || '').slice(0, 200);
  const out = { platform: platformOf(ua), ua };
  if (hints) {
    const q = req.query || {};
    if (['desktop', 'mobile'].includes(String(q.platform))) out.sdk_platform = String(q.platform);
    const n = (v) => { const x = Number(v); return Number.isInteger(x) && x > 0 && x < 10000 ? x : null; };
    if (n(q.w) && n(q.h)) { out.w = n(q.w); out.h = n(q.h); }
  }
  return out;
}

export function createLogs({ supabase, on = APP_LOGS_ON, loadtest = false, now = Date.now, maxKeys = 20000 }) {
  const live = on && !loadtest;
  const touched = new Map(); // member id -> time of the last session write
  const viewed = new Map(); // member|view|ref -> time of the last view row
  const keep = (m, ttl) => {
    if (m.size <= maxKeys) return;
    const t = now();
    for (const [k, at] of m) if (t - at >= ttl) m.delete(k);
    while (m.size > maxKeys) m.delete(m.keys().next().value);
  };
  const send = (p) => { Promise.resolve(p).then(() => {}, () => {}); };
  return {
    on: live,
    /** A call by the member: record the visit (at most every 5 minutes; force = the login with the client hints).
     *  client: an object, or a function that makes it (so a throttled call builds nothing). */
    session(id, client, { force = false } = {}) {
      if (!live || !id) return false;
      const key = String(id), t = now();
      if (!force && t - (touched.get(key) ?? -Infinity) < SESSION_EVERY_MS) return false;
      touched.delete(key); touched.set(key, t); keep(touched, SESSION_EVERY_MS);
      const c = typeof client === 'function' ? client() : client; // built only when it is sent
      send(supabase.rpc('app_session_touch', { p_player: key, p_client: c || {} }));
      return true;
    },
    /** A screen the member opened (one row per member, view and ref per 10 minutes). */
    view(id, view, ref = null) {
      if (!live || !id || !/^[a-z_]{1,30}$/.test(String(view || ''))) return false;
      const r = ref == null ? null : String(ref).slice(0, 40);
      const key = `${id}|${view}|${r ?? ''}`, t = now();
      if (t - (viewed.get(key) ?? -Infinity) < VIEW_EVERY_MS) return false;
      viewed.delete(key); viewed.set(key, t); keep(viewed, VIEW_EVERY_MS);
      send(supabase.from('page_views').insert({ player_id: String(id), view, ref: r }));
      return true;
    },
    /** A walkthrough step, the first time only (the primary key keeps the first time; a repeat is ignored). */
    tutorialStep(id, step) {
      if (!live || !id || !step) return false;
      send(supabase.from('tutorial_steps').upsert({ player_id: String(id), step: String(step).slice(0, 40) }, { onConflict: 'player_id,step', ignoreDuplicates: true }));
      return true;
    },
  };
}

/** The steps that one POST /api/tutorial adds: the new ones only (before -> after of players.tutorial). */
export function newTutorialSteps(before, after, action) {
  const b = before || {}, a = after || {};
  const added = (k) => (a[k] || []).filter((s) => !(b[k] || []).includes(s));
  const out = [...added('done'), ...added('seen').map((s) => `seen:${s}`)];
  if (action === 'skip' && !b.skipped) out.push('skipped');
  if (action === 'replay') out.push('replay');
  return out;
}

/** The view rows of the data routes (registered before them) and POST /api/view for the screens with no own route. */
export function registerLogRoutes(app, { caller, rateLimit, logs }) {
  app.use((req, res, next) => {
    if (!logs.on || req.method !== 'GET') return next();
    const pick = VIEW_ROUTES[req.path];
    if (!pick) return next();
    res.on('finish', () => {
      if (res.statusCode !== 200) return;
      caller(req).then((me) => { // the token is cached: the route resolved it already
        const v = me && pick(req, me);
        if (v) logs.view(me.id, v.view, v.ref ?? null);
      }, () => {});
    });
    next();
  });
  app.post('/api/view', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
    const view = String(req.body?.view || '');
    if (!CLIENT_VIEWS.includes(view)) return res.status(400).json({ error: 'bad view' });
    const ref = req.body?.ref == null ? null : String(req.body.ref).replace(/[^\w:-]/g, '').slice(0, 40) || null;
    res.json({ ok: true, logged: logs.view(me.id, view, ref) });
  });
}
