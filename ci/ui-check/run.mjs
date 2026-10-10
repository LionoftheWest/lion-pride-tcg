// Gate G3, the run (docs/design.md 12.5, 12.6): open every screen and window at the given sizes in one browser,
// run the checks, and write one result file and one screenshot for each cell. evaluate.mjs gives the verdict.
//   node run.mjs --browser chromium|webkit [--sizes 375x667,...] [--screens home,...] [--variants base,long,safe,keyboard] [--workers 4] [--shard k/n] [--out DIR]
// --shard k/n: CI splits the cells over n runners; this runner takes every n-th cell from cell k. All shards = all cells.
// --workers: the cells that run at the same time (each in its own browser context, as before). A GitHub runner has 4 cores.
// It starts serve.mjs on a free port (the fixtures). Every cell uses a new browser context (the audit method).
// Variants (12.6): base; long = a 32-character name and a 9-digit number; safe = the safe-area presets (touch
// sizes); keyboard = a text box focused with the keyboard height taken off the view (touch sizes, screens with a text box).
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SIZES, SCREENS, sizeKey, boot, runSteps } from './screens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BROWSER = arg('browser', 'chromium');
const sizes = (arg('sizes') ? arg('sizes').split(',') : SIZES.map(sizeKey)).map((k) => SIZES.find((s) => sizeKey(s) === k) || (() => { throw new Error(`unknown size ${k}`); })());
const screens = arg('screens') ? arg('screens').split(',') : Object.keys(SCREENS);
const variants = (arg('variants') || 'base,long,safe,keyboard').split(',');
const OUT = arg('out', join(here, '.out', 'results'));
const WORKERS = Math.max(1, Number(arg('workers', 4)));
mkdirSync(join(OUT, 'shots'), { recursive: true });
const FIX = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'));
const read = (f) => readFileSync(join(here, 'checks', f), 'utf8');
const CHECKS = read('walk-checks.js'), FIT = read('fitdetect.js'), CUT = read('cutdetect.js'), EXTRA = read('extra.js');
// The game day (MT) of the recording: main.js keeps the locked squad for that day only.
const MT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(FIX.recordedAt));
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
// Call a check file (a function expression) in the page. Node Playwright evaluates a string as an expression and
// does not call a function in it (the audit's Python runner did), so the call is part of the expression.
const call = (pg, src, arg) => pg.evaluate(`(${src})(${arg === undefined ? '' : JSON.stringify(arg)})`);

// The safe-area presets (design.md 2.3): a phone notch and home bar in portrait, both sides in landscape.
const SAFE = (land) => `:root{--discord-safe-area-inset-top:${land ? 0 : 59}px;--discord-safe-area-inset-bottom:${land ? 21 : 34}px;--discord-safe-area-inset-left:${land ? 59 : 0}px;--discord-safe-area-inset-right:${land ? 59 : 0}px}`;
// The variants run where they can change the result: long data where member names and counts show, the safe-area
// presets on the overlays, the windows and the stages (the screens that touch the frame edges).
const LONG_SCREENS = new Set(Object.entries(SCREENS).filter(([, s]) => s.long).map(([k]) => k));   // the spec's `long: true` flag (screens.mjs)
const SAFE_SCREENS = new Set(Object.entries(SCREENS).filter(([, s]) => s.safe).map(([k]) => k));   // the spec's `safe: true` flag (screens.mjs)
const IMGWAIT ="() => [...document.images].filter((i) => i.getClientRects().length && i.loading !== 'lazy').every((i) => i.complete)";

const port = Number(process.env.UI_CHECK_PORT) || 4480 + Math.floor(Math.random() * 400);   // UI_CHECK_PORT: a builder keeps its own port range
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.once('data', ok));
const BASE = `http://127.0.0.1:${port}`;
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch(BROWSER === 'chromium' ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});

// The cells: every size, screen and variant that applies (the same rules as the serial loop before).
const todo = [];
for (const s of sizes) for (const screen of screens) for (const variant of variants) {
  const [, , cls, touch] = s; const spec = SCREENS[screen];
  if (spec.notOn?.includes(cls)) continue;   // the screen does not exist on this class (design.md 2.1)
  if ((variant === 'safe' || variant === 'keyboard') && !touch) continue;
  if (variant === 'keyboard' && !spec.input) continue;
  if (variant === 'keyboard' && cls === 'tiny') continue;   // D-138: no typing in the tiny window (Discord picture-in-picture)
  if (variant === 'safe' && (!/^compact/.test(cls) || !SAFE_SCREENS.has(screen))) continue;
  if (variant === 'long' && !LONG_SCREENS.has(screen)) continue;
  todo.push([s, screen, variant]);
}
const [SHARD_K, SHARD_N] = (arg('shard') || '1/1').split('/').map(Number);
if (!(SHARD_N >= 1 && SHARD_K >= 1 && SHARD_K <= SHARD_N)) throw new Error(`bad --shard ${arg('shard')}`);
const all = todo.length;
todo.splice(0, todo.length, ...todo.filter((_, i) => i % SHARD_N === SHARD_K - 1));
console.log(`shard ${SHARD_K}/${SHARD_N}: ${todo.length} of ${all} cells`);

let cells = 0, failures = 0;
async function runCell([s, screen, variant], ref = {}) {
        const [W, H, cls, touch] = s; const size = sizeKey(s); const land = W > H;
        const spec = SCREENS[screen];
        const t0 = Date.now();
        const ctx = ref.ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch && BROWSER === 'chromium', deviceScaleFactor: 1, timezoneId: 'America/Denver', locale: 'en-US' });
        await ctx.clock.setSystemTime(new Date(FIX.recordedAt));
        const cookies = [];
        if (spec.battle || spec.hunt) cookies.push({ name: 'ci_hunt', value: spec.battle ? (spec.battle === 'mix' ? 'battle-mix' : 'battle') : spec.hunt, url: BASE });
        if (spec.trades) cookies.push({ name: 'ci_trades', value: spec.trades, url: BASE });
        if (spec.dungeon) cookies.push({ name: 'ci_dungeon', value: spec.dungeon, url: BASE });
        if (spec.notes) cookies.push({ name: 'ci_notes', value: spec.notes, url: BASE });
        if (spec.wish) cookies.push({ name: 'ci_wish', value: spec.wish, url: BASE });
        if (spec.ach) cookies.push({ name: 'ci_ach', value: spec.ach, url: BASE });
        if (spec.loader) {   // UI-56: the sign-in never answers (loading, timeout) or fails (error); the hint says "v3 member" (the loader cannot read the flag)
          cookies.push({ name: 'ci_loader', value: spec.loader === 'error' ? 'error' : 'wait', url: BASE });
          await ctx.addInitScript(() => localStorage.setItem('lp_ui3', '1'));
        }
        if (variant === 'long') cookies.push({ name: 'ci_data', value: 'long', url: BASE });
        if (cookies.length) await ctx.addCookies(cookies);
        if (spec.battle && FIX.meta?.teamKey) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [FIX.meta.teamKey, JSON.stringify({ date: MT_DAY, ids: FIX.meta.teamIds })]);   // the date of the game day (MT), as main.js loadTeam() checks
        if (variant === 'safe') await ctx.addInitScript((css) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }); }, SAFE(land));
        const pg = await ctx.newPage(); const errs = []; const blocked = [];
        pg.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
        pg.on('response', (r) => { if (r.status() === 403 && r.request().method() !== 'GET') blocked.push(r.request().method() + ' ' + new URL(r.url()).pathname); });
        const noFixture = new Set();   // a GET /api call with no recorded answer (the screen may show an error state)
        pg.on('response', (r) => { const u = new URL(r.url()); if (r.status() === 404 && u.pathname.startsWith('/api/')) noFixture.add(u.pathname); });
        const res = { browser: BROWSER, size, class: cls, touch, screen, id: spec.id, variant };
        try {
          if (spec.loader) {
            // The app never starts here (no ui-v2 class): wait for the loader state itself (the timeout is the real 15 s), then let the
            // checks see the loader: they skip #loader (it covers the page during a normal boot), so the loader gets data-measure for this cell only.
            const want = { loading: 'loading', timeout: 'timeout', error: 'error' }[spec.loader];
            await pg.goto(BASE + '/');
            await pg.waitForFunction((w) => document.getElementById('ldr3')?.dataset.state === w && !document.getElementById('ldr3').hidden, want, { timeout: 40000 });
            await pg.evaluate(() => document.fonts?.ready); await sleep(1.5);
            await pg.evaluate("document.getElementById('loader').dataset.measure = ''");
            res.miss = [];
          } else {
          await boot(pg, BASE + '/');
          res.miss = await runSteps(pg, spec.steps);
          }
          for (let i = 0; i < 20; i++) { if (await pg.evaluate(IMGWAIT)) break; await sleep(0.5); }
          await pg.evaluate(() => document.fonts?.ready); await sleep(1);
          if (variant === 'keyboard') {
            const focused = await pg.evaluate((sel) => { const e = [...document.querySelectorAll(sel)].find((x) => x.getClientRects().length); if (!e) return false; e.focus(); return true; }, spec.input);
            res.keyboard = { focused, height: Math.round(H * (land ? 0.55 : 0.4)) };
            if (focused) { await pg.setViewportSize({ width: W, height: H - res.keyboard.height }); await sleep(1);
              // size-class.js sets body[data-kb] after a debounced resize (120 ms). On a loaded runner the resize came late once
              // (PR #277, 915x412: the cell was measured before the layout changed). Wait for it on a v3 page, then measure.
              await pg.waitForFunction(() => !document.body.classList.contains('ui-v3') || document.body.hasAttribute('data-kb'), null, { timeout: 8000 }).catch(() => {});
              res.keyboard.dataKb = await pg.evaluate(() => document.body.hasAttribute('data-kb')); await sleep(0.3);
              res.keyboard.inputInView = await pg.evaluate(() => { const r = document.activeElement?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight + 1; }); }
          }
          await pg.evaluate(() => { const b = document.getElementById('effectBanners'); if (b) b.style.display = 'none'; });
          res.checks = await call(pg, CHECKS, { touch, phone: /^compact|tiny/.test(cls) });
          res.fit = await call(pg, FIT);
          res.cut = await call(pg, CUT, 'body');
          res.cutWin = await call(pg, CUT, '[data-audit-win]');
          res.extra = await call(pg, EXTRA);
          if (!res.checks || !res.fit || !res.cut || !res.extra) throw new Error('a check returned nothing');
          await pg.screenshot({ path: join(OUT, 'shots', `${BROWSER}-${size}-${screen}-${variant}.jpg`), type: 'jpeg', quality: 70 });
        } catch (e) {
          res.error = String(e).slice(0, 300); if (!ref.dead) failures++;
          try { await pg.screenshot({ path: join(OUT, 'shots', `${BROWSER}-${size}-${screen}-${variant}.jpg`), type: 'jpeg', quality: 70 }); } catch { /* ignore */ }
        }
        res.blocked = [...new Set(blocked)]; res.noFixture = [...noFixture]; res.pageErrors = errs.slice(0, 5); res.seconds = Math.round((Date.now() - t0) / 1000);
        if (ref.dead) return;   // this try timed out: the retry writes the result
        writeFileSync(join(OUT, `${BROWSER}-${size}-${screen}-${variant}.json`), JSON.stringify(res));
        cells++;
        console.log(`${BROWSER} ${size} ${screen.padEnd(20)} ${variant.padEnd(8)} ${String(res.seconds).padStart(3)}s miss=${(res.miss || []).length} fit=${(res.fit || []).length} cut=${(res.cut || []).length}${res.error ? ' ERROR ' + res.error.slice(0, 80) : ''}`);
        await ctx.close();
}
// A hung cell (one WebKit shard ran 55 min instead of 11, PR #270, 2026-10-08): each try has a time limit, and a cell that
// times out runs once more. Two timeouts: the cell is a runner error ("not checked" in the verdict), not a lost shard.
const CELL_LIMIT = Number(process.env.UI_CHECK_CELL_LIMIT) || 150;   // seconds; a cell takes 10 to 25 s (the variable is for a test)
async function runCellGuarded(c) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ref = {}; let timer;
    const limit = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`over ${CELL_LIMIT} s`)), CELL_LIMIT * 1000); });
    try { await Promise.race([runCell(c, ref), limit]); clearTimeout(timer); return; } catch (e) {
      clearTimeout(timer); ref.dead = true;
      try { await ref.ctx?.close(); } catch { /* the hung context */ }
      const [s, screen, variant] = c;
      console.log(`${BROWSER} ${sizeKey(s)} ${screen} ${variant}: try ${attempt} ${e.message}${attempt === 1 ? ', one more try' : ''}`);
      if (attempt === 2) {
        writeFileSync(join(OUT, `${BROWSER}-${sizeKey(s)}-${screen}-${variant}.json`), JSON.stringify({ browser: BROWSER, size: sizeKey(s), class: s[2], touch: s[3], screen, id: SCREENS[screen].id, variant, error: `the cell timed out twice (${CELL_LIMIT} s)` }));
        cells++; failures++;
      }
    }
  }
}
const t00 = Date.now();
try {
  await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, async () => { for (let c; (c = todo.shift());) await runCellGuarded(c); }));
} finally {
  await browser.close(); server.kill();
}
console.log(`${WORKERS} workers, ${Math.round((Date.now() - t00) / 1000)} s`);
console.log(`${cells} cells, ${failures} runner errors`);
