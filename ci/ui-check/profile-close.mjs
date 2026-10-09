// UI-14: the Profile is a layer; another screen or window closes it (dock tab, Shop, bell, Menu). One assertion script, not a G3 cell.
//   node profile-close.mjs [chromium|webkit]     exit 1 when a tap leaves the Profile open or the control for the check is missing
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCREENS, SIZES, sizeKey, boot, runSteps } from './screens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'));
const B = process.argv[2] === 'webkit' ? webkit : chromium;
const port = 4660 + Math.floor(Math.random() * 9);
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.once('data', ok));
const browser = await B.launch(B === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
const TAPS = ['#dock .dk[data-view="collection"]', '#dock .dk[data-view="trading"]', '#shopBtn', '#bellBtn', '#menuBtn'];
let bad = 0;
for (const key of ['375x667', '1280x720']) {
  const [W, H, , touch] = SIZES.find((s) => sizeKey(s) === key);
  for (const tap of TAPS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch && B === chromium, timezoneId: 'America/Denver', locale: 'en-US' });
    await ctx.clock.setSystemTime(new Date(FIX.recordedAt));
    const pg = await ctx.newPage();
    await boot(pg, `http://127.0.0.1:${port}/`);
    await runSteps(pg, SCREENS['profile-own'].steps);
    const open = () => pg.evaluate(() => !!document.getElementById('memberModal') && !document.getElementById('memberModal').classList.contains('hidden'));
    const was = await open();
    const found = await pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, tap);
    await pg.waitForTimeout(600);
    const now = await open();
    const ok = was && found && !now;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${key} ${tap}: open before=${was} control=${found} open after=${now}`);
    await ctx.close();
  }
}
await browser.close(); server.kill();
process.exit(bad ? 1 : 0);
