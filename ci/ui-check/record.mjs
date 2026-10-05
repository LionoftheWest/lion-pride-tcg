// Record the G3 fixtures (fixtures/api.json) from a LOCAL preview server. A session runs this by hand when the
// API changes (a screen shows "no fixture" in the G3 summary). CI never runs it.
//   node record.mjs --base http://127.0.0.1:4471 --me <member id> [--pgmeta http://127.0.0.1:28415]
// The preview server must run with LOADTEST=1, every FEATURE_* flag on, and the LOCAL database copy (never the
// live database). The browser blocks every write (403), as the audit walkthrough did.
// Every GET /api answer of every screen at 3 sizes (4 screens at a time) is kept. The Hunt is a fixture (discord-ui-audit/common.py),
// because a live Hunt is not always there. Then the anonymizer (fixture-lib.mjs) replaces every member id, name
// and avatar, and the recorder stops when a real name or id is still in the text.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SCREENS, boot, runSteps } from './screens.mjs';
import { keyOf, anonymizer, residue, withoutCatalog } from './fixture-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:4471');
const ME = arg('me'); if (!ME) throw new Error('--me <member id> is required');
const PGMETA = arg('pgmeta', 'http://127.0.0.1:28415');
const SIZES = [[1990, 830, false], [430, 932, true], [932, 430, true]];   // desktop, phone portrait, phone landscape: every API call
const recordedAt = new Date().toISOString();
const routes = {};

// The members for the anonymizer: every player of the local copy.
const members = await (await fetch(`${PGMETA}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'select id, username from players' }) })).json();
if (!Array.isArray(members) || !members.length) throw new Error('no players from the local database (pgmeta)');

// The Hunt fixture (common.py): the top 40 cards of the member as the roster, a Tier 3 boss closing in 1 day 5 h.
const apiGet = async (p) => (await fetch(BASE + p, { headers: { authorization: `Bearer lt:${ME}` } })).json();
const coll = (await apiGet('/api/collection')).cards.sort((a, b) => b.power - a.power);
const roster = coll.slice(0, 40).map((c, i) => { const mx = Math.max(30, Math.round(c.power * 1.8));
  return { ...c, type: c.type || 'Creature', used: false, downed: false, hp: i !== 2 ? mx : Math.round(mx * 0.4), max_hp: mx, shield: 0, matches: i === 0 || i === 3, cdReady: 0 }; });
const closes = new Date(Date.parse(recordedAt) + (29 * 3600 * 1000)).toISOString();
const hunt = (battle) => ({ hunt: { id: 999, name: 'The Ban-Wave Demon', tier: 'Mythic', hp_remaining: 1284000, hp_max: 2070000, status: 'active', closes_at: closes,
  weak_points: [{ facet: 'trait', value: 'trait:earth' }], resist_points: [{ facet: 'trait', value: 'trait:water' }],
  passive: { kind: 'armored', list: [{ kind: 'armored', label: 'Armored' }] }, stats: { atk: 93 } },
  roster: roster.map((r, i) => ({ ...r, used: battle && i < 3 })), myDamage: 41230, usedToday: battle ? 3 : 0, dailyCap: 8, round: 3 });
const feed = { feed: [
  { id: 3, player: 'Member 101', card: 'Canyon Rhino', rarity: 'illustrated_rare', outcome: 'hit', damage: 2480, crit: true },
  { id: 2, player: 'Member 102', card: 'Storm Hawk', rarity: 'normal', outcome: 'hit', damage: 1920, bonus: true },
  { id: 1, player: 'Member 103', card: 'Frost Owl', rarity: 'secret_rare', outcome: 'hit', damage: 1104, countered: true, counterDmg: 22 }],
  hp_remaining: 1284000, hp_max: 2070000, status: 'active', fighters: 5 };
const lb = { leaders: [{ player_id: 'a', username: 'Member 101', damage: 90000 }, { player_id: ME, username: 'Member A', damage: 41230 }], me: ME };
const FIXED = { '/api/hunt': hunt(false), '/api/hunt#battle': hunt(true), '/api/hunt/feed': feed, '/api/hunt/leaderboard': lb, '/api/pack-status': { packs: 12 } };
const teamIds = roster.slice(0, 8).map((c) => c.id);

const browser = await chromium.launch();
const jobs = SIZES.flatMap(([W, H, touch]) => Object.entries(SCREENS).map(([screen, spec]) => ({ W, H, touch, screen, spec })));
const worker = async () => {
  for (let job; (job = jobs.shift());) {
    const { W, H, touch, screen, spec } = job;
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, timezoneId: 'America/Denver', locale: 'en-US' });
    await ctx.route('**/*', (r) => {
      const req = r.request(); const u = new URL(req.url());
      if (req.method() !== 'GET') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"preview"}' });
      const key = u.pathname === '/api/hunt' && spec.battle ? '/api/hunt#battle' : u.pathname;
      if (FIXED[key]) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXED[key]) });
      return r.continue();
    });
    if (spec.battle) await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ['lpt_team_999', JSON.stringify({ date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(recordedAt)), ids: teamIds })]);
    const pg = await ctx.newPage();
    pg.on('response', async (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith('/api/') || r.request().method() !== 'GET' || FIXED[u.pathname]) return;
      if (!/json/.test(r.headers()['content-type'] || '')) return;
      const key = keyOf(u.pathname, u.search);
      if (routes[key]) return;
      try { routes[key] = { status: r.status(), body: await r.json() }; } catch { /* a closed page */ }
    });
    await boot(pg, `${BASE}/?as=${ME}&name=Member`);
    const miss = await runSteps(pg, spec.steps);
    await new Promise((ok) => setTimeout(ok, 1500));
    console.log(`${W}x${H} ${screen.padEnd(20)} routes=${Object.keys(routes).length}${miss.length ? ' miss=' + miss.join(',') : ''}`);
    await ctx.close();
  }
};
await Promise.all([worker(), worker(), worker(), worker()]);   // 4 screens at a time
await browser.close();
for (const [k, v] of Object.entries(FIXED)) routes[k] = { status: 200, body: v };

const anon = anonymizer(members, ME);
const out = { recordedAt, source: { commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), note: 'Recorded from the local database copy, then anonymized (fixture-lib.mjs). No real member data.' },
  meta: { teamKey: 'lpt_team_999', teamIds }, routes: anon.walk(routes) };
const text = JSON.stringify(out, null, 1);
const left = residue(JSON.stringify(withoutCatalog(out)), members);   // the card catalog is public (withoutCatalog)
if (left.length) { console.error('STOP: real member data is still in the fixtures:\n' + left.slice(0, 40).join('\n')); process.exit(1); }
mkdirSync(join(here, 'fixtures'), { recursive: true });
writeFileSync(join(here, 'fixtures', 'api.json'), text);
console.log(`fixtures/api.json: ${Object.keys(out.routes).length} routes, ${(text.length / 1024).toFixed(0)} KB, recorded ${recordedAt}`);
