// F-2 PR 1: the Card Portal is the Cards section of the Admin page. No database (a fake Supabase URL).
//   node scripts/test-studio-start-page.mjs
//   S1 ADMIN_VIEW=1: / goes to /admin/ (the Overview)
//   S2 ADMIN_VIEW off: / goes to /admin/#/cards (the card editor needs no flag)
//   S3 /index.html (the old portal) goes to /admin/#/cards, with the flag on and off
//   S4 the old portal files are gone; the Cards section files are served
//   S5 the admin shell routes #/cards to cards.js and the old admin card numbers to #/card-stats
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'test-key', STUDIO_USER: '', STUDIO_PASS: '', LOCALDB: '' });
const { app } = await import('../src/server.js');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  [${JSON.stringify(detail)}]`}`); };
const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${srv.address().port}`;
const get = (p) => new Promise((res, rej) => http.get(base + p, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => res({ status: r.statusCode, location: r.headers.location, body: b })); }).on('error', rej));

process.env.ADMIN_VIEW = '1';
let r = await get('/');
check('S1 ADMIN_VIEW=1: / -> /admin/', r.status === 302 && r.location === '/admin/', r);
r = await get('/index.html');
check('S3 ADMIN_VIEW=1: /index.html -> /admin/#/cards', r.status === 302 && r.location === '/admin/#/cards', r);
process.env.ADMIN_VIEW = '0';
r = await get('/');
check('S2 ADMIN_VIEW=0: / -> /admin/#/cards', r.status === 302 && r.location === '/admin/#/cards', r);
r = await get('/index.html');
check('S3 ADMIN_VIEW=0: /index.html -> /admin/#/cards', r.status === 302 && r.location === '/admin/#/cards', r);
delete process.env.ADMIN_VIEW;
r = await get('/');
check('S2 ADMIN_VIEW unset: / -> /admin/#/cards', r.status === 302 && r.location === '/admin/#/cards', r);
for (const f of ['/app.js', '/style.css']) { r = await get(f); check(`S4 the old portal file ${f} is gone (404)`, r.status === 404, r.status); }
r = await get('/admin/cards.js');
check('S4 /admin/cards.js is served', r.status === 200 && /export async function pageCardEditor/.test(r.body), r.status);
r = await get('/admin/cards.css');
check('S4 /admin/cards.css is served', r.status === 200 && /\.cs-tile/.test(r.body), r.status);
srv.close();

const admin = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'admin', 'admin.js'), 'utf8');
check('S5 #/cards and #/cards/<id> load cards.js', /\[\/\^\\\/cards\(\?:\\\/\(\[\^\/\]\+\)\)\?\$\/, \(main, a, q\) => import\('\.\/cards\.js'\)/.test(admin), 'route');
check('S5 the card numbers page is #/card-stats', admin.includes("[/^\\/card-stats$/, pageCards]") && !admin.includes("[/^\\/cards$/, pageCards]"), 'route');
check('S5 no link to the old /index.html portal', !admin.includes("href: '/index.html'"), 'link');

console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `PASS all ${pass}`);
process.exit(fail ? 1 : 0);
