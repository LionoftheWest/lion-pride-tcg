/**
 * The login of the whole card studio (every route: the card editor, the static files, /api/*, the Admin view).
 *
 *   STUDIO_PASS set   -> every request needs a session cookie (the login page) or HTTP Basic Auth (scripts, the tunnel gate).
 *   STUDIO_PASS empty -> only a request from this PC (loopback, not forwarded) is served; every other address gets 403.
 *   Open always: GET /health (no data) and the login page itself.
 *
 * The session cookie: "studio_session" = <expiry>.<HMAC-SHA256>, HttpOnly, SameSite=Strict, Path=/, 30 days, Secure on https.
 * The HMAC key mixes the secret with STUDIO_USER and STUDIO_PASS, so a new password ends every old session.
 * The secret: STUDIO_SESSION_SECRET, else card-studio/.studio-secret (made with 32 random bytes at the first start; git ignores it).
 * Failed logins (form or Basic) are limited: 5 per address and 30 for all addresses in 15 minutes, then 429 until the window ends.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const COOKIE = 'studio_session';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const MAX_AGE_S = 30 * 24 * 3600;
export const FAIL_LIMIT = 5;
export const GLOBAL_LIMIT = 30;
export const FAIL_WINDOW_MS = 15 * 60 * 1000;

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export const isLocal = (req) => LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];

export function loadSecret(file, env = process.env) {
  if (env.STUDIO_SESSION_SECRET && env.STUDIO_SESSION_SECRET.length >= 32) return env.STUDIO_SESSION_SECRET;
  if (existsSync(file)) {
    const s = readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const s = randomBytes(32).toString('hex');
  writeFileSync(file, s + '\n', { mode: 0o600 });
  return s;
}

const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0])
  .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

// Only a path on this site: "/x", never "//host" or "/\host" or a full URL.
export const safeNext = (v) => (typeof v === 'string' && /^\/(?![/\\])[^\s]*$/.test(v) && v.length < 500 ? v : '/');

const page = (msg, next) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Card Studio - Log in</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A12;color:#F5F2EC;font:15px Inter,system-ui,sans-serif}
form{width:min(360px,calc(100vw - 32px));background:#181824;border:1px solid #2A2A3E;border-radius:12px;padding:24px;display:grid;gap:12px}
h1{margin:0 0 4px;font-size:20px;font-weight:700}label{font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#AEABC0;font-weight:600}
input{width:100%;font:inherit;color:#F5F2EC;background:#20202F;border:1px solid #76769C;border-radius:8px;padding:10px 12px}
button{font:inherit;font-weight:700;background:#F4B73C;color:#1C1203;border:0;border-radius:8px;padding:12px;cursor:pointer}
.err{color:#FF6B7D;font-size:13px;margin:0}
</style></head><body><form method="post" action="/login">
<h1>Lion Pride TCG - Studio</h1>
${msg ? `<p class="err" role="alert">${msg}</p>` : ''}
<label for="u">User</label><input id="u" name="user" autocomplete="username" required>
<label for="p">Password</label><input id="p" name="pass" type="password" autocomplete="current-password" required>
<input type="hidden" name="next" value="${safeNext(next).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}">
<button type="submit">Log in</button></form></body></html>`;

/**
 * Returns the middleware. Mount it before every other route and before express.static.
 * opts: env (process.env), secret (string), now () => ms (tests).
 */
export function studioAuth({ env = process.env, secret, now = () => Date.now() } = {}) {
  if (!secret || secret.length < 32) throw new Error('studioAuth needs a secret of 32+ characters');
  const fails = new Map(); // address -> { n, until }
  const user = () => env.STUDIO_USER || 'studio';
  const pass = () => env.STUDIO_PASS || '';
  const key = () => createHmac('sha256', secret).update(`${user()}\0${pass()}`).digest();
  const sign = (exp) => createHmac('sha256', key()).update(`v1.${exp}`).digest('base64url');
  const validCookie = (v) => {
    const m = /^(\d{10,13})\.([A-Za-z0-9_-]{43})$/.exec(v || '');
    return Boolean(m) && Number(m[1]) * 1000 > now() && same(m[2], sign(m[1]));
  };
  // The forwarded address counts only from the tunnel gate on this PC; a LAN client cannot pick its own key.
  const addr = (req) => (LOOPBACK.has(req.socket.remoteAddress) && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())
    || req.socket.remoteAddress || '?';
  const over = (a, limit) => {
    const f = fails.get(a);
    if (!f) return false;
    if (f.until <= now()) { fails.delete(a); return false; }
    return f.n >= limit;
  };
  // Per address, and all addresses together (many addresses cannot try more than GLOBAL_LIMIT passwords).
  const blocked = (req) => over(addr(req), FAIL_LIMIT) || over('*', GLOBAL_LIMIT);
  const count = (a) => {
    const f = fails.get(a);
    if (!f || f.until <= now()) fails.set(a, { n: 1, until: now() + FAIL_WINDOW_MS });
    else f.n += 1;
  };
  const fail = (req) => {
    count(addr(req));
    count('*');
    if (fails.size > 10000) fails.clear(); // a flood of addresses cannot grow the map without end
  };
  const tooMany = (res, html) => {
    res.set('Retry-After', String(Math.ceil(FAIL_WINDOW_MS / 1000)));
    return html ? res.status(429).type('html').send(page('Too many failed logins. Try again in 15 minutes.', '/'))
      : res.status(429).json({ error: 'too many failed logins' });
  };
  const wantsHtml = (req) => req.method === 'GET' && !req.path.startsWith('/api/') && /text\/html/.test(req.headers.accept || '');
  const cookieFlags = (req) => `HttpOnly; SameSite=Strict; Path=/${req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`;

  return (req, res, next) => {
    if (req.method === 'GET' && req.path === '/health') return res.json({ ok: true });
    res.set('X-Frame-Options', 'SAMEORIGIN');

    if (!pass()) {
      if (isLocal(req)) { req.studioAuthed = true; return next(); }
      return res.status(403).type('text').send('Set STUDIO_PASS in card-studio/.env to open the studio from another device.');
    }

    if (req.path === '/login') {
      if (req.method === 'GET') return res.type('html').set('Cache-Control', 'no-store').send(page('', req.query.next));
      if (req.method !== 'POST') return res.status(405).end();
      if (blocked(req)) return tooMany(res, true);
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        const nxt = safeNext(f.get('next'));
        // Compare both always, so the time does not show which one was wrong.
        const ok = [same(f.get('user') || '', user()), same(f.get('pass') || '', pass())].every(Boolean);
        if (!ok) {
          fail(req);
          if (blocked(req)) return tooMany(res, true);
          return res.status(401).type('html').send(page('The user or the password is wrong.', nxt));
        }
        fails.delete(addr(req));
        const exp = Math.floor(now() / 1000) + MAX_AGE_S;
        res.set('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Max-Age=${MAX_AGE_S}; ${cookieFlags(req)}`);
        return res.redirect(303, nxt);
      });
      return undefined;
    }
    if (req.path === '/logout' && req.method === 'POST') {
      res.set('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
      return res.redirect(303, '/login');
    }

    if (validCookie(parseCookies(req.headers.cookie)[COOKIE])) { req.studioAuthed = true; return next(); }

    const h = req.headers.authorization;
    if (h) {
      if (blocked(req)) return tooMany(res, false);
      const expected = 'Basic ' + Buffer.from(`${user()}:${pass()}`).toString('base64');
      if (same(h, expected)) { req.studioAuthed = true; return next(); }
      fail(req);
      if (blocked(req)) return tooMany(res, false);
    }
    if (wantsHtml(req)) return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    res.set('WWW-Authenticate', 'Basic realm="Card Studio"');
    return res.status(401).json({ error: 'login required' });
  };
}
