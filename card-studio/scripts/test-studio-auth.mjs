/**
 * Test of the studio login (src/studio-auth.js) and of the whole server behind it. No database:   node scripts/test-studio-auth.mjs
 * Invariants:
 *   L1 no STUDIO_PASS: only this PC is served; a forwarded request (the tunnel gate) and another address get 403
 *   L2 STUDIO_PASS set: no login = 401 (API, scripts) or a redirect to /login (a browser page), also from this PC
 *   L3 the login form: a wrong password = 401 and no cookie; the right one = 303 and a cookie HttpOnly, SameSite=Strict, Path=/
 *   L4 the session: a valid cookie opens every route; a changed, an expired cookie or a cookie from before a password change does not
 *   L5 Basic Auth (scripts, the tunnel gate) still works; a wrong one is refused
 *   L6 the rate limit: 5 failures per address, 30 for all addresses, in 15 minutes = 429, also for the right password; the window ends
 *   L7 the next page after the login is a path on this site only
 *   L8 the session secret: made once (64 hex) and kept
 *   L9 the real server: EVERY Express route and every static file answers 401 or a redirect to /login without a session
 *      (the routes are read from the app, so a new route is covered by itself); with a session a static file is served
 */
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { studioAuth, loadSecret, safeNext, COOKIE, FAIL_LIMIT, GLOBAL_LIMIT, FAIL_WINDOW_MS } from '../src/studio-auth.js';

let fails = 0, n = 0;
const check = (name, ok, got) => { n++; if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 300)}`); };
const SECRET = 'x'.repeat(64);

// A request with full control of the headers (fetch cannot send a Cookie header from Node in every version).
const req = (base, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(path, base);
  const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
    let data = '';
    res.on('data', (c) => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  r.on('error', reject);
  if (body) r.write(body);
  r.end();
});
const listen = (app, host = '127.0.0.1') => new Promise((resolve) => { const s = app.listen(0, host, () => resolve(s)); });
const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
const form = (o) => ({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString(), method: 'POST' });

function mini(env, clock) {
  const app = express();
  app.use(studioAuth({ env, secret: SECRET, now: () => clock.t }));
  app.get('/secret', (q, s) => s.json({ in: true }));
  app.get('/page', (q, s) => s.send('page'));
  return app;
}

// ---- L1 ----
{
  const env = { STUDIO_PASS: '' }, clock = { t: Date.now() };
  const app = mini(env, clock);
  const srv = await listen(app, '0.0.0.0');
  const base = `http://127.0.0.1:${srv.address().port}`;
  let r = await req(base, '/secret');
  check('L1 no STUDIO_PASS: this PC is served', r.status === 200, r.status);
  r = await req(base, '/secret', { headers: { 'x-forwarded-for': '203.0.113.9' } });
  check('L1 no STUDIO_PASS: a forwarded request (the tunnel gate) gets 403', r.status === 403, r.status);
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
  if (lan) {
    r = await req(`http://${lan.address}:${srv.address().port}`, '/secret');
    check(`L1 no STUDIO_PASS: another address (${lan.address.replace(/\d+$/, 'x')}) gets 403`, r.status === 403, r.status);
  } else console.log('SKIP L1 another address: this PC has no LAN IPv4');
  srv.close();
}

// ---- L2 - L7 ----
{
  const env = { STUDIO_USER: 'nathan', STUDIO_PASS: 'right-pass' }, clock = { t: Date.now() };
  const app = mini(env, clock);
  const srv = await listen(app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  let r = await req(base, '/secret');
  check('L2 no login, API: 401 with a Basic challenge (also from this PC)', r.status === 401 && /Basic/.test(r.headers['www-authenticate'] || ''), r.status);
  r = await req(base, '/page?a=1', { headers: { accept: 'text/html' } });
  check('L2 no login, a browser page: 302 to /login with the page as next', r.status === 302 && r.headers.location === `/login?next=${encodeURIComponent('/page?a=1')}`, r.headers.location);
  r = await req(base, '/login');
  check('L2 the login page is open', r.status === 200 && /name="pass"/.test(r.body), r.status);
  r = await req(base, '/health');
  check('L2 /health is open and has no data', r.status === 200 && r.body === '{"ok":true}', r.body);

  r = await req(base, '/login', form({ user: 'nathan', pass: 'wrong', next: '/page' }));
  check('L3 a wrong password: 401, no cookie', r.status === 401 && !r.headers['set-cookie'], r.status);
  r = await req(base, '/login', form({ user: 'nathan', pass: 'right-pass', next: '/page' }));
  const sc = (r.headers['set-cookie'] || [])[0] || '';
  check('L3 the right password: 303 to next', r.status === 303 && r.headers.location === '/page', [r.status, r.headers.location]);
  check('L3 the cookie: HttpOnly, SameSite=Strict, Path=/, Max-Age, not Secure on http', sc.startsWith(`${COOKIE}=`) && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc)
    && /Path=\//.test(sc) && /Max-Age=\d+/.test(sc) && !/Secure/.test(sc), sc);
  const cookie = sc.split(';')[0];
  r = await req(base, '/login', { ...form({ user: 'nathan', pass: 'right-pass' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' } });
  check('L3 behind https: the cookie is Secure', /Secure/.test((r.headers['set-cookie'] || [])[0] || ''), r.headers['set-cookie']);

  r = await req(base, '/secret', { headers: { cookie } });
  check('L4 a valid cookie opens the route', r.status === 200, r.status);
  const [, val] = cookie.split('=');
  const bad = `${COOKIE}=${val.slice(0, -2)}${val.endsWith('AA') ? 'BB' : 'AA'}`;
  r = await req(base, '/secret', { headers: { cookie: bad } });
  check('L4 a changed cookie: 401', r.status === 401, r.status);
  const exp = Number(val.split('.')[0]);
  r = await req(base, '/secret', { headers: { cookie: `${COOKIE}=${exp + 3600}.${val.split('.')[1]}` } });
  check('L4 a cookie with a later expiry and the old signature: 401', r.status === 401, r.status);
  clock.t += 31 * 24 * 3600 * 1000;
  r = await req(base, '/secret', { headers: { cookie } });
  check('L4 an expired cookie (31 days): 401', r.status === 401, r.status);
  clock.t -= 31 * 24 * 3600 * 1000;
  env.STUDIO_PASS = 'new-pass';
  r = await req(base, '/secret', { headers: { cookie } });
  check('L4 a new password ends the old sessions', r.status === 401, r.status);
  env.STUDIO_PASS = 'right-pass';
  r = await req(base, '/logout', { method: 'POST', headers: { cookie } });
  check('L4 logout clears the cookie', r.status === 303 && /Max-Age=0/.test((r.headers['set-cookie'] || [])[0] || ''), r.headers['set-cookie']);

  r = await req(base, '/secret', { headers: basic('nathan', 'right-pass') });
  check('L5 Basic Auth with the right password: 200', r.status === 200, r.status);
  r = await req(base, '/secret', { headers: basic('nathan', 'nope') });
  check('L5 Basic Auth with a wrong password: 401', r.status === 401, r.status);

  // L6: one address. The right login in L3 cleared the earlier failure; the Basic failure in L5 counts: 1 so far.
  for (let i = 1; i < FAIL_LIMIT; i++) await req(base, '/login', form({ user: 'nathan', pass: `bad${i}` }));
  r = await req(base, '/login', form({ user: 'nathan', pass: 'right-pass' }));
  check(`L6 after ${FAIL_LIMIT} failures the right password gets 429`, r.status === 429 && r.headers['retry-after'], r.status);
  r = await req(base, '/secret', { headers: basic('nathan', 'right-pass') });
  check('L6 ... and Basic Auth too (429)', r.status === 429, r.status);
  r = await req(base, '/secret', { headers: { cookie: (await (async () => cookie)()) } });
  check('L6 a valid session is not blocked', r.status === 200, r.status);
  clock.t += FAIL_WINDOW_MS + 1000;
  r = await req(base, '/login', form({ user: 'nathan', pass: 'right-pass' }));
  check('L6 after 15 minutes the right password works again', r.status === 303, r.status);
  // All addresses together (through the tunnel gate on this PC: X-Forwarded-For).
  let blockedAt = 0;
  for (let i = 0; i < GLOBAL_LIMIT + 2 && !blockedAt; i++) {
    const rr = await req(base, '/login', { ...form({ user: 'x', pass: 'y' }), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `198.51.100.${i}` } });
    if (rr.status === 429) blockedAt = i + 1;
  }
  check(`L6 many addresses: blocked at failure ${GLOBAL_LIMIT}`, blockedAt === GLOBAL_LIMIT, blockedAt);
  // A LAN client cannot choose its own rate-limit key with X-Forwarded-For (it counts only from this PC).
  clock.t += FAIL_WINDOW_MS + 1000;
  srv.close();

  check('L7 next: a path stays', safeNext('/admin/#/members') === '/admin/#/members', safeNext('/admin/#/members'));
  check('L7 next: //host, /\\host, a URL and a space go to /', ['//evil.example', '/\\evil.example', 'https://evil.example', '/a b', null].every((x) => safeNext(x) === '/'), 'x');
}

// ---- L8 ----
{
  const dir = mkdtempSync(join(os.tmpdir(), 'studio-secret-'));
  const f = join(dir, '.studio-secret');
  const a = loadSecret(f, {}), b = loadSecret(f, {});
  check('L8 the secret is made once (64 hex) and kept', /^[0-9a-f]{64}$/.test(a) && a === b && readFileSync(f, 'utf8').trim() === a, a.length);
  check('L8 STUDIO_SESSION_SECRET wins', loadSecret(f, { STUDIO_SESSION_SECRET: 'y'.repeat(40) }) === 'y'.repeat(40), 'env');
}

// ---- L9: the real server ----
{
  Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-key', STUDIO_USER: 'nathan', STUDIO_PASS: 'right-pass',
    STUDIO_SESSION_SECRET: SECRET, ADMIN_VIEW: '1', LOCALDB: '' });
  const { app } = await import('../src/server.js');
  const routes = [];
  const walk = (stack, prefix = '') => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) routes.push([m.toUpperCase(), prefix + l.route.path]);
      else if (l.name === 'router' && l.handle.stack) {
        const p = l.regexp.source.replace('^\\', '').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/');
        walk(l.handle.stack, prefix + p);
      }
    }
  };
  walk(app._router.stack);
  const here = dirname(fileURLToPath(import.meta.url));
  const pub = join(here, '..', 'public');
  const files = [];
  const list = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) list(p); else files.push('/' + relative(pub, p).replace(/\\/g, '/')); } };
  list(pub);
  check(`L9 found the routes (${routes.length}) and the static files (${files.length})`, routes.length > 25 && routes.some(([, p]) => p.startsWith('/api/admin/')) && files.includes('/admin/admin.js'), routes.length);
  const srv = await listen(app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const fill = (p) => p.replace(/:[a-z]+/gi, 'x');
  const bad = [];
  for (const [m, p] of routes) {
    const r = await req(base, fill(p), { method: m, headers: m === 'GET' ? {} : { 'content-type': 'application/json', 'content-length': '2' }, body: m === 'GET' ? undefined : '{}' })
      .catch((e) => ({ status: e.code }));
    if (r.status !== 401) bad.push(`${m} ${p} -> ${r.status}`);
    const rh = await req(base, fill(p), { method: m, headers: { accept: 'text/html' } }).catch((e) => ({ status: e.code, headers: {} }));
    if (!(rh.status === 401 || (m === 'GET' && rh.status === 302 && rh.headers.location.startsWith('/login')))) bad.push(`${m} ${p} (browser) -> ${rh.status}`);
  }
  for (const f of [...files, '/', '/admin/', '/admin']) {
    const r = await req(base, f);
    if (r.status !== 401 || /<html|function|@font-face/i.test(r.body)) bad.push(`GET ${f} -> ${r.status}`);
  }
  check('L9 every route and static file without a session: 401 / redirect, no content', bad.length === 0, bad.slice(0, 10));
  const login = await req(base, '/login', form({ user: 'nathan', pass: 'right-pass' }));
  const ck = (login.headers['set-cookie'] || [])[0].split(';')[0];
  let r = await req(base, '/admin/admin.js', { headers: { cookie: ck } });
  check('L9 with a session the Admin view files are served', r.status === 200 && /lineChart/.test(r.body), r.status);
  r = await req(base, '/api/admin/source', { headers: { cookie: ck } });
  check('L9 with a session /api/admin answers (the admin gate takes the studio login)', r.status === 200 && JSON.parse(r.body).source === 'LIVE', r.body);
  process.env.STUDIO_PASS = '';
  r = await req(base, '/api/admin/source', { headers: { 'x-forwarded-for': '203.0.113.9' } });
  check('L9 no STUDIO_PASS: the real server refuses a forwarded request (403)', r.status === 403, r.status);
  r = await req(base, '/api/admin/source');
  check('L9 no STUDIO_PASS: the real server serves this PC', r.status === 200, r.status);
  srv.close();
}

console.log(fails ? `FAIL ${fails} of ${n}` : `PASS all ${n}`);
process.exit(fails ? 1 : 0);
