// Local preview only (not committed): the v3 shell on real screens, from the CI test data (uiV3 on).
//   node .shell-shot.mjs <outDir> [sizes] [screens]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { SIZES, SCREENS, sizeKey, boot, runSteps } from './screens.mjs';
const OUT = process.argv[2]; mkdirSync(OUT, { recursive: true });
const sizes = (process.argv[3] || '1280x720,932x430,430x932').split(',');
const screens = (process.argv[4] || 'home,collection,trades,hunt-squad').split(',');
const FIX = JSON.parse(readFileSync('fixtures/api.json', 'utf8'));
const PORT = 4540, BASE = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch();
const errs = [];
for (const key of sizes) {
  const s = SIZES.find((x) => sizeKey(x) === key); const [W, H, , touch] = s;
  for (const scr of screens) {
    const menu = scr.endsWith('+menu'); const spec = SCREENS[scr.replace('+menu', '')]; if (!spec) { console.log('no screen', scr); continue; }
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, timezoneId: 'America/Denver', locale: 'en-US' });
    await ctx.clock.setSystemTime(new Date(FIX.recordedAt));
    if (spec.battle || spec.hunt) await ctx.addCookies([{ name: 'ci_hunt', value: spec.battle ? 'battle' : spec.hunt, url: BASE }]);
    if (spec.dungeon) await ctx.addCookies([{ name: 'ci_dungeon', value: spec.dungeon, url: BASE }]);
    if (spec.battle && FIX.meta?.teamKey) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [FIX.meta.teamKey, JSON.stringify({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(FIX.recordedAt)), ids: FIX.meta.teamIds })]);
    if (process.env.SAFE) await ctx.addInitScript((css) => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }); }, W > H ? ':root{--discord-safe-area-inset-top:0px;--discord-safe-area-inset-bottom:21px;--discord-safe-area-inset-left:59px;--discord-safe-area-inset-right:59px}' : ':root{--discord-safe-area-inset-top:59px;--discord-safe-area-inset-bottom:34px}');
    const pg = await ctx.newPage();
    if (process.env.MOVES) await pg.route('**/api/hunt', async (r) => { const res = await r.fetch(); const j = await res.json(); j.bossMoves = [['Fade','Ends expose. Expose works at 50% for the rest of the day.'],['Veil','Expose has no effect for the rest of the day.'],['Demotion','For the rest of the day, an attack on an exposed boss sends 20% back.'],['Nightshade','Damage on expose cards for 3 rounds.']].map(([name, text]) => ({ name, text })); await r.fulfill({ response: res, json: j }); });
    if (process.env.V2) await pg.route('**/api/flags', async (r) => { const res = await r.fetch(); const j = await res.json(); j.uiV3 = false; await r.fulfill({ response: res, json: j }); });
    pg.on('pageerror', (e) => errs.push(`${key} ${scr}: ${e.message}`));
    await boot(pg, BASE + '/'); await runSteps(pg, spec.steps); await pg.waitForTimeout(1500);
    if (menu) { await pg.click('#menuBtn'); await pg.waitForTimeout(500); }
    if (process.env.KB) { await pg.evaluate((sel) => document.querySelector(sel)?.focus(), spec.input.split(',').pop().trim() === spec.input ? spec.input : '#main .u3-mp .u3-search__input'); const kh = Math.round(H * (W > H ? 0.55 : 0.4)); await pg.setViewportSize({ width: W, height: H - kh }); await pg.waitForFunction(() => document.body.hasAttribute('data-kb'), null, { timeout: 8000 }).catch(() => console.log('NO data-kb')); await pg.waitForTimeout(500);
      if (process.env.TYPE) { await pg.keyboard.type(process.env.TYPE, { delay: 40 }); await pg.waitForTimeout(900); } }
    await pg.evaluate(() => { const b = document.getElementById('effectBanners'); if (b) b.style.display = 'none'; });
    await pg.screenshot({ path: `${OUT}/${key}-${scr}${process.env.V2 ? "-v2" : ""}.png` });
    const info = await pg.evaluate(() => ({ size: document.body.dataset.size, v3: document.body.classList.contains('ui-v3'), menu: !!document.getElementById('menuBtn'), scrollH: document.documentElement.scrollHeight - innerHeight }));
    console.log(key, scr, JSON.stringify(info));
    if (process.env.EVAL) console.log(JSON.stringify(await pg.evaluate(process.env.EVAL)));
    await ctx.close();
  }
}
await browser.close(); srv.kill();
console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
