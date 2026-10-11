// Probe: counts the visible attacker and support cards of the Dungeon / Gauntlet fight at any size (arg: WxH list, screens).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCREENS, boot, runSteps } from './screens.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const sizes = (arg('sizes', '820x1180,692x917')).split(',').map((s) => s.split('x').map(Number));
const screens = (arg('screens', 'dungeon-fight')).split(',');
const shots = arg('shots');
const force = arg('force');   // e.g. compact-port: body data-size is held at this class (the D-181 tablet portrait)
const mixes = (arg('mix', '3,2')).split(';').map((m) => m.split(',').map(Number));   // attackers,supports of the squad
const FIX = JSON.parse(readFileSync(join(here, 'fixtures', 'api.json'), 'utf8'));
const port = 5100 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, [join(here, 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok) => server.stdout.once('data', ok));
const BASE = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const [W, H] of sizes) for (const sc of screens) for (const [nA, nS] of mixes) {
  const spec = SCREENS[sc];
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, timezoneId: 'America/Denver', locale: 'en-US' });
  await ctx.clock.setSystemTime(new Date(FIX.recordedAt));
  if (spec.dungeon) await ctx.addCookies([{ name: 'ci_dungeon', value: spec.dungeon, url: BASE }]);
  const pg = await ctx.newPage();
  if (force) await pg.addInitScript((f) => { const t = () => { if (document.body && document.body.dataset.size !== f) document.body.dataset.size = f; }; setInterval(t, 20); }, force);
  if (!(nA === 3 && nS === 2)) await pg.route('**/api/dungeon', async (route) => { const res = await route.fetch(); const j = await res.json();
    if (j?.run?.state) { const mine = j.mine || []; const A = mine.filter((c) => ['Character', 'Creature'].includes(c.type)).slice(0, nA); const S = mine.filter((c) => c.ability?.kind === 'support').slice(0, nS);
      const cards = {}; [...A, ...S].forEach((c) => { cards[c.id] = { hp: 50, max: 72, shield: 0, cd: 0 }; }); j.run.squad = [...A, ...S].map((c) => c.id); j.run.state.cards = cards; j._n = [A.length, S.length]; }
    await route.fulfill({ response: res, json: j }); });
  await boot(pg, BASE + '/'); await runSteps(pg, spec.steps);
  await pg.waitForTimeout(1500);
  const r = await pg.evaluate(() => {
    const F = document.querySelector('.dg-fight'); if (!F) return null;
    const vis = (e) => { const b = e.getBoundingClientRect(); const fb = F.getBoundingClientRect(); const cs = getComputedStyle(e);
      return b.width > 4 && b.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden' && b.left >= fb.left - 1 && b.right <= fb.right + 1 && b.top >= fb.top - 1 && b.bottom <= fb.bottom + 1; };
    const u = [...F.querySelectorAll('.dg-unit')], s = [...F.querySelectorAll('.dg-sup')];
    const fb = F.getBoundingClientRect(); const m = document.getElementById('main')?.getBoundingClientRect();
    return { units: u.length, unitsVis: u.filter(vis).length, sups: s.length, supsVis: s.filter(vis).length, cls: F.className.replace('dg-fight', '').trim(), body: document.body.dataset.size, fight: [Math.round(fb.left), Math.round(fb.width), Math.round(fb.height)], main: m && [Math.round(m.left), Math.round(m.width)], scroll: F.scrollHeight - F.clientHeight };
  });
  const ok = r && r.unitsVis === r.units && r.supsVis === r.sups && r.units === nA && r.sups === nS && r.scroll <= 1;
  if (!ok) bad++;
  console.log(`${ok ? 'OK ' : 'BAD'} ${W}x${H} ${sc} mix${nA}+${nS}`, JSON.stringify(r));
  if (shots) { mkdirSync(shots, { recursive: true }); await pg.screenshot({ path: join(shots, `${sc}-${W}x${H}.png`) }); }
  await ctx.close();
}
await browser.close(); server.kill(); process.exit(bad ? 1 : 0);
