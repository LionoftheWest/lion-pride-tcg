/**
 * Browser measurement rig for the Dungeon fight on the LOCAL stack (never live).
 *   1. node ci/ui-check/build.mjs                       (the client bundle with the SDK stub; the member is lt:<id>)
 *   2. LOADTEST=1 FEATURE_DUNGEON=1 FEATURE_HUNT=1 SUPABASE_URL=<local> SUPABASE_SERVICE_ROLE_KEY=<local> PORT=4470 node tcg-activity/server.js
 *   3. node tcg-activity/tools/fight-rig.mjs <tap|room|auto> [--size 1280x720] [--delay 0] [--shell v2|v3] [--n 5] [--player <id>] [--secs 60] [--net wifi|4g] [--label x]
 * The rig starts a small proxy (port 4591): "/" and the bundle come from the check build, every other request goes to the
 * server on 4470 with the member token swapped for lt:<player>. --delay adds a latency to the fight calls (POST /api/dungeon|gauntlet|hunt/*, GET /api/dungeon): a live round trip.
 * The database is the one in %TEMP%/localdb.env; the rig refuses any other host. It resets today's runs of the one test member.
 * The page marks (performance.mark "dg:*", ui-v2-dungeon.js) give the times: tap, motion, answer, room:go, room:enter, room:ready.
 */
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeFightRows } from '../src/hunt-merge.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const argv = process.argv.slice(2);
const scenario = argv[0];
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const DELAY = Number(opt('delay', 0)), SHELL = opt('shell', 'v2'), N = Number(opt('n', 5)), SECS = Number(opt('secs', 60)), LABEL = opt('label', '');
const PLAYER = opt('player', '147400772320100352');
const ENVF = process.env.LOCALDB_ENV || join(process.env.TEMP || tmpdir(), 'localdb.env');
const env = Object.fromEntries(readFileSync(ENVF, 'utf8').split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(env.PGMETA_URL)) throw new Error('not a local database');
const sql = async (query) => { const r = await fetch(`${env.PGMETA_URL}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j; };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };

// ---- the proxy -----------------------------------------------------------------------------------
const BUNDLE = opt('bundle', join(root, 'ci', 'ui-check', '.out', 'bundle'));   // --bundle <dir>: the bundle of another source tree (a before/after pair)
const bundleName = readdirSync(BUNDLE).find((f) => /^main\..*\.js$/.test(f));
const index = readFileSync(join(root, 'tcg-activity', 'public', 'index.html'), 'utf8').replace('__BUNDLE__', bundleName).replace('__CSSV__', 'rig');
const stats = { reqs: [] };
const PORT = Number(opt('port', 4591));
const proxy = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(index); return; }
  if (/^\/(main|chunk)\..*\.js$/.test(url.pathname)) { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public, max-age=31536000, immutable' }); res.end(readFileSync(join(BUNDLE, url.pathname.slice(1)))); return; }
  const api = url.pathname.startsWith('/api/');
  if (api) stats.reqs.push({ t: Date.now(), m: req.method, p: url.pathname, q: url.search });
  if (api && DELAY && /^\/api\/(dungeon|gauntlet|hunt)(\/|$)/.test(url.pathname) && (req.method !== 'GET' || url.pathname === '/api/dungeon')) await sleep(DELAY);   // a live round trip on the fight calls only (the sign-in calls stay fast)
  const headers = { ...req.headers, host: '127.0.0.1:4470' };
  if (headers.authorization) headers.authorization = `Bearer lt:${PLAYER}`;
  const up = http.request({ host: '127.0.0.1', port: 4470, path: req.url, method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
    // the rounds an Auto call played (the answer lists them), to count the rounds a minute
    if (url.pathname === '/api/dungeon/auto') { let b = ''; r.on('data', (d) => { b += d; }); r.on('end', () => { try { stats.reqs.push({ t: Date.now(), m: 'ROUNDS', p: '/api/dungeon/auto', q: '', n: (JSON.parse(b).rounds || []).filter((x) => x.atk).length }); } catch { /* not JSON */ } }); }
  });
  up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* closed */ } });
  req.pipe(up);
});
await new Promise((ok) => proxy.listen(PORT, '127.0.0.1', ok));
const call = async (method, path, body) => { const r = await fetch(`http://127.0.0.1:4470${path}`, { method, headers: { Authorization: `Bearer lt:${PLAYER}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

// ---- a valid squad: the cheapest attackers the day's rule allows ----------------------------------
const startRun = async () => {
  await sql(`delete from dungeon_runs where player_id = '${PLAYER}' and day = dungeon_day()`);
  const { j: d } = await call('GET', '/api/dungeon');
  const rule = d.rule || {};
  const ok = (c) => ['Character', 'Creature'].includes(c.type) && (!rule.types || rule.types.includes(c.type));
  const squad = d.mine.filter(ok).sort((a, b) => (a.cost - b.cost) || (argv.includes('--strong') ? b.cp - a.cp : a.cp - b.cp)).slice(0, d.squad || 5).map((c) => c.id);
  const r = await call('POST', '/api/dungeon/start', { cards: squad });
  if (!r.j.ok) throw new Error('start failed ' + JSON.stringify(r.j));
  return squad;
};
await sql(SHELL === 'v3' ? `insert into settings(key, value) values ('ui_v3', '{"enabled": true, "users": ["${PLAYER}"]}') on conflict (key) do update set value = excluded.value` : `delete from settings where key = 'ui_v3'`);

// ---- the browser ----------------------------------------------------------------------------------
const { chromium } = createRequire(join(root, 'ci', 'ui-check', 'package.json'))('playwright');
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let lastPage = null;
const newPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 700 });
  const page = await ctx.newPage(); lastPage = page;
  if (argv.includes('--noroster')) await page.addInitScript(() => { globalThis.__dgNoRoster = true; });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForSelector('#dock .dk[data-view="battling"]', { timeout: 30000 });
  // --net: the page is on a real-world link from here on (the bundle is already loaded): wifi 20 ms and 5 MB/s, 4g 60 ms and 1.5 MB/s.
  const NET = { wifi: [20, 5e6], '4g': [60, 1.5e6] }[opt('net', '')];
  if (NET) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: NET[0], downloadThroughput: NET[1], uploadThroughput: NET[1] }); }
  return { ctx, page };
};
const marks = (page) => page.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('dg:')).map((m) => [m.name.slice(3), Math.round(m.startTime)])));
const clearMarks = (page) => page.evaluate(() => performance.clearMarks());
const openAdventure = async (page) => { await page.click('#dock .dk[data-view="battling"]'); };
const log = (o) => console.log(JSON.stringify({ label: LABEL, scenario, size: `${W}x${H}`, shell: SHELL, delay: DELAY, net: opt('net', ''), ...o }));
const tapOn = (page) => (W < 700 ? page.tap.bind(page) : page.click.bind(page));

try {
  if (scenario === 'tap') {
    await startRun();
    const { page } = await newPage();
    await openAdventure(page);
    await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 });
    await page.waitForFunction(() => performance.getEntriesByName('dg:room:ready').length > 0, null, { timeout: 30000 });
    await sleep(800);
    const rows = [];
    for (let i = 0; i < N; i++) {
      // Between rooms the member takes a reward or descends; the rig does it and waits for the next fight.
      for (let g = 0; g < 8 && !(await page.$('.dg-fight .dg-unit')); g++) {
        if (await page.$('[data-choose]')) await page.click('[data-choose]');
        else if (await page.$('.dg-next, .u3-dgs-next')) await page.click('.dg-next, .u3-dgs-next');
        await sleep(1200);
      }
      await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('.dg-fight:not(.busy)'), null, { timeout: 30000 });
      await sleep(600);
      await clearMarks(page);
      await page.click('.dg-fight .dg-unit:not(.down)', { force: true });
      await page.waitForFunction(() => performance.getEntriesByName('dg:answer').length > 0, null, { timeout: 30000 });
      await sleep(200);
      const m = await marks(page);
      if (m.tap != null && m.motion != null && m.answer != null) rows.push({ motion: m.motion - m.tap, painted: m.painted != null ? m.painted - m.tap : null, answer: m.answer - m.tap });
      await page.waitForFunction(() => document.querySelector('.dg-fight:not(.busy)') || !document.querySelector('.dg-fight'), null, { timeout: 30000 });
    }
    log({ taps: rows.length, tap_to_motion_ms: rows.map((r) => r.motion), tap_to_painted_ms: rows.map((r) => r.painted), tap_to_answer_ms: rows.map((r) => r.answer), median_motion: med(rows.map((r) => r.motion)), median_painted: med(rows.map((r) => r.painted).filter((x) => x != null)), median_answer: med(rows.map((r) => r.answer)) });
  } else if (scenario === 'err') {
    // The server refuses an attack: the lift must go, the reason must show; a double tap must send ONE request.
    await startRun();
    const { page } = await newPage();
    await openAdventure(page);
    await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 });
    await page.waitForFunction(() => performance.getEntriesByName('dg:room:ready').length > 0, null, { timeout: 30000 });
    await sleep(600);
    let posts = 0;
    await page.route('**/api/dungeon/attack', async (route) => { posts++; await sleep(400); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'stunned', message: 'That card is stunned for a round.' }) }); });
    const unit = await page.$('.dg-fight .dg-unit:not(.down)');
    await unit.click({ force: true }); await unit.click({ force: true }); await unit.click({ force: true });
    await sleep(120);
    const during = await page.$eval('.dg-unit.striking', () => true).catch(() => false);
    await page.screenshot({ path: join(process.env.TEMP || tmpdir(), 'fr', `lift-${W}x${H}.png`) });
    await sleep(900);
    const after = await page.$eval('.dg-unit.striking', () => true).catch(() => false);
    const toast = await page.evaluate(() => [...document.querySelectorAll('.toast, #toast, [class*="toast"]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | '));
    const busy = await page.$eval('.dg-fight', (f) => f.classList.contains('busy'));
    log({ lift_during_request: during, lift_after_error: after, toast, fight_busy_after: busy, posts_for_3_taps: posts });
  } else if (scenario === 'hunt') {
    // The Hunt fight refresh: GET /api/hunt (full) against GET /api/hunt?fight=1 (light) after a real squad lock and two attacks, on the local stack.
    // Checks that the roster merged from the light answer equals the roster of the full answer (the fields the fight reads), and times both.
    const full0 = (await call('GET', '/api/hunt')).j;
    if (!full0.hunt) throw new Error('no active hunt on the local copy');
    const squadIds = full0.squad || full0.roster.filter((c) => !c.downed).slice(0, 5).map((c) => c.id);
    if (!full0.squad) { const l = (await call('POST', '/api/hunt/squad', { cards: squadIds })).j; if (!l.ok) throw new Error('squad: ' + JSON.stringify(l)); }
    const attackers = full0.roster.filter((c) => squadIds.includes(c.id) && ['Character', 'Creature'].includes(c.type) && !c.downed && !c.used).slice(0, 2);
    const hits = [];
    for (const c of attackers) hits.push((await call('POST', '/api/hunt/attack', { cardId: c.id })).j.ok);
    const full = (await call('GET', '/api/hunt')).j;
    const lite = (await call('GET', '/api/hunt?fight=1')).j;
    const merged = mergeFightRows(full0.roster, lite.hp);
    const pick = (c) => ({ id: c.id, hp: c.hp, max_hp: c.max_hp, downed: c.downed, used: c.used, shield: c.shield, cdReady: c.cdReady });
    const same = JSON.stringify(full.roster.filter((c) => squadIds.includes(c.id)).map(pick).sort((a, b) => a.id - b.id)) === JSON.stringify(merged.filter((c) => squadIds.includes(c.id)).map(pick).sort((a, b) => a.id - b.id));
    const time = async (path, k = 8) => { const t = []; for (let i = 0; i < k; i++) { const t0 = performance.now(); await call('GET', path); t.push(performance.now() - t0); } return Math.round(med(t)); };
    log({ attacks_ok: hits, squad: squadIds.length, lite_keys: Object.keys(lite), lite_bytes: JSON.stringify(lite).length, full_bytes: JSON.stringify(full).length, same_roster_fields: same, round_equal: lite.round === full.round, usedToday_equal: lite.usedToday === full.usedToday,
      hp_equal: lite.hunt.hp_remaining === full.hunt.hp_remaining, median_ms_full: await time('/api/hunt'), median_ms_light: await time('/api/hunt?fight=1') });
  } else if (scenario === 'hunt-ui') {
    // The Hunt fight in the browser: tap an unused attacker of the locked squad and list the /api/hunt calls that follow (run the 'hunt' scenario first: it locks a squad).
    const { page } = await newPage();
    await openAdventure(page);
    await sleep(2500);
    await page.click('[data-adv="hunt"]').catch(() => {});
    await page.waitForSelector('.squad-grid .c, .u3-ft-grid .c', { timeout: 30000 });
    await sleep(2500);
    const target = await page.evaluate(() => { const c = [...document.querySelectorAll('.squad-grid .c, .u3-ft-grid .c')].find((n) => !n.classList.contains('downed') && n.dataset.used !== '1' && !n.querySelector('.sup-badge')); return c ? c.dataset.id : null; });
    if (!target) throw new Error('no unused card in the Hunt grid');
    const s0 = stats.reqs.length;
    await page.click(`.squad-grid .c[data-id="${target}"], .u3-ft-grid .c[data-id="${target}"]`, { force: true });
    await sleep(Number(opt('wait', 9000)));
    const calls = stats.reqs.slice(s0).filter((r) => r.p.startsWith('/api/hunt')).map((r) => `${r.m} ${r.p}${r.q}`);
    const hp = await page.evaluate(() => document.querySelector('#hpText')?.textContent || document.querySelector('.u3-ft-hp')?.textContent || null);
    await page.screenshot({ path: join(process.env.TEMP || tmpdir(), 'fr', `hunt-${W}x${H}.png` ) });
    log({ tapped_card: target, hunt_calls_after_the_tap: calls, boss_hp_text: hp });
  } else if (scenario === 'next') {
    // The rooms of one run: after each reward pick, the time from the pick to the next monsters standing.
    await startRun();
    const { page } = await newPage();
    await openAdventure(page);
    await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 });
    await page.waitForFunction(() => performance.getEntriesByName('dg:room:ready').length > 0, null, { timeout: 30000 });
    const rows = [];
    for (let guard = 0; guard < 120 && rows.length < N; guard++) {
      if (await page.$('[data-choose]')) {
        await clearMarks(page);
        await page.click('[data-choose]');
        await sleep(2500);
        const m = await marks(page);
        if (m['room:ready'] != null && m['room:go'] != null) rows.push({ go_to_ready: m['room:ready'] - m['room:go'], enter_to_ready: m['room:ready'] - m['room:enter'] });
        continue;
      }
      if (await page.$('.dg-next, .u3-dgs-next')) { await page.click('.dg-next, .u3-dgs-next'); await sleep(2000); continue; }
      if (await page.$('.dg-fight .dg-unit:not(.down)')) {
        await page.waitForFunction(() => document.querySelector('.dg-fight:not(.busy)') || !document.querySelector('.dg-fight'), null, { timeout: 30000 });
        if (await page.$('.dg-fight:not(.busy) .dg-unit:not(.down)')) await page.click('.dg-fight .dg-unit:not(.down)', { force: true });
        await sleep(300);
        continue;
      }
      await sleep(500);
    }
    log({ transitions: rows.length, go_to_ready_ms: rows.map((r) => r.go_to_ready), enter_to_ready_ms: rows.map((r) => r.enter_to_ready), median_go_to_ready: med(rows.map((r) => r.go_to_ready)), median_enter_to_ready: med(rows.map((r) => r.enter_to_ready)) });
  } else if (scenario === 'room') {
    // The member opens the lobby, waits, picks the squad and starts: from the Start tap to the monsters standing in the room.
    await sql(`delete from dungeon_runs where player_id = '${PLAYER}' and day = dungeon_day()`);
    const { page } = await newPage();
    await openAdventure(page);
    await page.waitForSelector('.dg-lobby', { timeout: 30000 });
    const wait = Number(opt('lobby', 4000));
    await sleep(wait);
    await page.click('.dg-chip[data-filter="atk"]'); await page.click('.dg-sort [data-sort="cost"]');
    for (let i = 0; i < 5; i++) { await page.click('.dg-grid [data-pick]:not(.picked)'); await sleep(120); }
    await page.waitForFunction(() => !document.querySelector('.dg-start').disabled, null, { timeout: 5000 });
    await clearMarks(page);
    const t0 = Date.now();
    await page.click('.dg-start');
    await page.waitForFunction(() => performance.getEntriesByName('dg:room:ready').length > 0, null, { timeout: 60000 });
    const m = await marks(page);
    const files = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\.glb|chunk\./.test(r.name)).map((r) => ({ n: r.name.split('/').pop(), start: Math.round(r.startTime), dur: Math.round(r.duration), size: r.transferSize })));
    log({ lobby_wait_ms: wait, go_to_ready_ms: m['room:ready'] - m['room:go'], enter_to_ready_ms: m['room:ready'] - m['room:enter'], wall_ms: Date.now() - t0, marks: m, glb_and_chunks: files });
  } else if (scenario === 'auto') {
    await startRun();
    const { page } = await newPage();
    await openAdventure(page);
    await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 });
    await sleep(1000);
    const isOn = () => page.$eval('.dg-auto', (b) => b.classList.contains('on'));
    if (!(await isOn())) await page.click('.dg-auto');
    const t0 = Date.now(); const s0 = stats.reqs.length; let steps = 0;
    const ROUNDS = Number(opt('rounds', 0));   // --rounds N: stop after N rounds (a fixed amount of play), or after --secs
    const played = () => stats.reqs.slice(s0).reduce((a, r) => a + (r.m === 'ROUNDS' ? r.n : r.m === 'POST' && r.p === '/api/dungeon/attack' ? 1 : 0), 0);
    while (Date.now() - t0 < SECS * 1000 && !(ROUNDS && played() >= ROUNDS)) {
      // Auto stops at every choice: the rig takes the first reward, descends, and starts again when the run is over.
      if (await page.$('[data-choose]')) { await page.click('[data-choose]'); steps++; await sleep(900); continue; }
      if (await page.$('.dg-next, .u3-dgs-next')) { await page.click('.dg-next, .u3-dgs-next'); steps++; await sleep(900); continue; }
      if (!(await page.$('.dg-fight'))) {
        await startRun(); await page.reload(); await openAdventure(page);
        await page.waitForSelector('.dg-fight .dg-unit', { timeout: 30000 }); await sleep(800);
        if (!(await isOn())) await page.click('.dg-auto');
        continue;
      }
      await sleep(250);
    }
    const all = stats.reqs.slice(s0); const secs = (Date.now() - t0) / 1000;
    const mine = all.filter((r) => r.m !== 'ROUNDS');
    const by = {}; for (const r of mine) by[`${r.m} ${r.p}`] = (by[`${r.m} ${r.p}`] || 0) + 1;
    const rounds = (by['POST /api/dungeon/attack'] || 0) + all.filter((r) => r.m === 'ROUNDS').reduce((a, r) => a + r.n, 0);
    const dungeonCalls = mine.filter((r) => r.p.startsWith('/api/dungeon')).length;
    log({ secs: Math.round(secs), requests: mine.length, per_minute: Math.round(mine.length / secs * 60), rounds, rounds_per_minute: Math.round(rounds / secs * 60), dungeon_requests_per_minute: Math.round(dungeonCalls / secs * 60), requests_per_round: rounds ? +(dungeonCalls / rounds).toFixed(2) : null, by, steps });
  } else throw new Error('scenario: tap | room | auto');
} catch (e) {
  console.log('RIG ERROR', e.message);
  try { await lastPage?.screenshot({ path: join(process.env.TEMP || tmpdir(), 'fr', 'rig-error.png') }); console.log('marks', JSON.stringify(await marks(lastPage))); } catch { /* no page */ }
  process.exitCode = 1;
} finally {
  await browser.close(); proxy.close();
  process.exit(process.exitCode || 0);
}
