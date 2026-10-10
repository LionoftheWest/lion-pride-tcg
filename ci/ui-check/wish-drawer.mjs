// UI-16 (D-128): the Wishlist drawer opens from the handle strip (a tap, a drag up), and closes (Close, Escape, the scrim, the dock).
// Focus returns to the handle. One assertion script, not a G3 cell.   node wish-drawer.mjs [chromium|webkit]   exit 1 on a failed check
import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCREENS, SIZES, sizeKey, boot, runSteps } from './screens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'));
const B = process.argv[2] === 'webkit' ? webkit : chromium;
const port = 4720 + Math.floor(Math.random() * 9);
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.once('data', ok));
const browser = await B.launch(B === chromium ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const drawer = (pg) => pg.evaluate(() => !!document.querySelector('#u3Wish .u3-wl'));
const focusId = (pg) => pg.evaluate(() => document.activeElement?.id || document.activeElement?.className || '');
for (const key of ['375x667', '932x430', '1280x720']) {
  const [W, H, , touch] = SIZES.find((s) => sizeKey(s) === key);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch && B === chromium, timezoneId: 'America/Denver', locale: 'en-US' });
  await ctx.clock.setSystemTime(new Date(FIX.recordedAt));
  await ctx.addCookies([{ name: 'ci_wish', value: 'full', url: `http://127.0.0.1:${port}/` }]);
  const pg = await ctx.newPage();
  await boot(pg, `http://127.0.0.1:${port}/`);
  await runSteps(pg, SCREENS['profile-own-wish'].steps);
  const open = async () => { await pg.evaluate(() => document.getElementById('wlHandle').click()); await pg.waitForTimeout(500); };
  check(`${key} the handle strip is on the Profile and the drawer is closed`, await pg.evaluate(() => !!document.getElementById('wlHandle')) && !(await drawer(pg)));
  await open();
  check(`${key} a tap on the handle opens the drawer with 5 rows`, (await drawer(pg)) && (await pg.evaluate(() => document.querySelectorAll('#u3Wish .u3-wl-row').length)) === 5);
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
  check(`${key} Escape closes it and the focus is on the handle`, !(await drawer(pg)) && (await focusId(pg)) === 'wlHandle', await focusId(pg));
  await open();
  await pg.evaluate(() => document.querySelector('#u3Wish [data-wlclose]').click()); await pg.waitForTimeout(300);
  check(`${key} Close closes it and the focus is on the handle`, !(await drawer(pg)) && (await focusId(pg)) === 'wlHandle');
  await open();
  await pg.evaluate(() => document.querySelector('#u3Wish .u3-wl-scrim').click()); await pg.waitForTimeout(300);
  check(`${key} a tap on the scrim closes it`, !(await drawer(pg)));
  // a drag up on the handle opens it (the pointer events of a touch drag)
  await pg.evaluate(() => {
    const h = document.getElementById('wlHandle'); const r = h.getBoundingClientRect();
    const ev = (t, y) => h.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + 20, clientY: y, pointerId: 1 }));
    ev('pointerdown', r.top + 20); ev('pointermove', r.top + 10); ev('pointermove', r.top - 20); ev('pointerup', r.top - 20);
  });
  await pg.waitForTimeout(400);
  check(`${key} a drag up on the handle opens it`, await drawer(pg));
  await pg.evaluate(() => document.querySelector('#u3Wish [data-wlclose]').click()); await pg.waitForTimeout(300);
  // the Profile is a layer: a tap on the dock closes the drawer with it (the drawer belongs to the Profile)
  await open();
  await pg.evaluate(() => document.querySelector('#dock .dk[data-view="collection"]').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pg.waitForTimeout(600);
  check(`${key} a tap on the dock leaves no drawer and no Profile`, !(await drawer(pg)) && (await pg.evaluate(() => document.getElementById('memberModal')?.classList.contains('hidden') ?? true)));
  await ctx.close();
}
await browser.close(); server.kill();
process.exit(bad ? 1 : 0);
