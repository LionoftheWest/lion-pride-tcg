// R2-MOVE: the tests of the live checkers G5 (r2-stats-check), G6 / G7 / G8 (r2-live-check), G10 (r2-preflight), with stubs
// only (one local http server: the Activity /api/img + /api/config, the gallery /api/gallery, the R2 public domain). No
// request leaves this PC. The G7 env-count part (hostChecks of r2-retire-supabase.mjs) runs with an injected ssh runner.
// The G5 log is built in the real Activity format (server.js: the start line `TCG Activity -> http://..`, the hourly
// `img-cache hits=.. upstream=.. upstreamMB=.. diskMB=.. fallback=.. r2err=.. r2=..` line, the img-fallback line). No real
// host log was read here: the Stager pastes one real line before S5 (spec 8.2) and runs the G5 mutations on a real log.
//   node card-studio/scripts/test-r2-checks.mjs      -> TEST <name> PASS|FAIL ..., exit 1 on any FAIL
import http from 'node:http';
import { createHash } from 'node:crypto';
import { checkStats } from './r2-stats-check.mjs';
import { liveCheck, SUPABASE_HOST } from './r2-live-check.mjs';
import { preflight } from './r2-preflight.mjs';
import { hostChecks } from './r2-retire-supabase.mjs';

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`TEST ${name} PASS`); } catch (e) { failed += 1; console.log(`TEST ${name} FAIL ${e.message}`); }
}
const must = (c, msg) => { if (!c) throw new Error(msg); };
const hasBad = (r, text) => must(!r.ok && r.bad.some((b) => b.includes(text)), `expected a BAD line with "${text}", got ok=${r.ok} ${JSON.stringify(r.bad).slice(0, 300)}`);
const md5 = (b) => createHash('md5').update(b).digest('hex');

// ---------- G5 ----------
const S5 = Date.parse('2026-11-09T19:00:00Z');
const iso = (ms) => new Date(ms).toISOString().replace('Z', '000000Z'); // docker --timestamps: nanoseconds
function activityLog({ hours = 25, edits = {} } = {}) {
  const lines = [`${iso(S5 + 1000)} TCG Activity -> http://127.0.0.1:4441`];
  for (let m = 5; m <= hours * 60; m += 5) {
    const at = S5 + m * 60e3;
    lines.push(`${iso(at)} route-timing GET /api/collection p50=12ms p95=40ms max=80ms n=31`);
    if (m % 60 === 0) {
      const h = m / 60;
      lines.push(edits[h] || `${iso(at)} img-cache hits=${h * 100} upstream=${h * 3} upstreamMB=${(h * 0.4).toFixed(1)} diskMB=412.3 fallback=0 r2err=0 r2=${h * 3}`);
    }
  }
  return lines;
}
const g5 = (lines, minHours) => checkStats({ logs: [{ host: 'main', text: lines.join('\n') }], since: new Date(S5).toISOString(), minHours });

await t('G5 baseline: 25 h, no fallback -> STATS PASS', () => { const r = g5(activityLog()); must(r.ok && r.hours >= 24, JSON.stringify(r)); });
await t('G5 a fallback line BEFORE S5 is not counted', () => {
  const l = activityLog(); l.unshift(`${iso(S5 - 3600e3)} img-fallback card-art/cards/x.png 404 mode=r2-first`);
  must(g5(l).ok, 'a line before --since failed the check');
});
await t('G5 mutation: one inserted img-fallback line -> FAIL', () => {
  const l = activityLog(); l.splice(40, 0, `${iso(S5 + 3 * 3600e3 + 7)} img-fallback card-art/cards/x.png 404 mode=r2-first`);
  hasBad(g5(l), 'img-fallback card-art/cards/x.png 404');
});
await t('G5 mutation: one later stats line edited to fallback=1 -> FAIL', () => {
  const at = S5 + 20 * 3600e3;
  hasBad(g5(activityLog({ edits: { 20: `${iso(at)} img-cache hits=2000 upstream=60 upstreamMB=8.0 diskMB=412.3 fallback=1 r2err=0 r2=59` } })), 'fallback=1');
});
await t('G5 mutation: a restart in the middle, then fallback=1 after it -> FAIL', () => {
  const l = activityLog();
  const i = l.findIndex((x) => x.includes(' img-cache hits=1200 '));
  l.splice(i + 1, 0, `${iso(S5 + 12 * 3600e3 + 60e3)} TCG Activity -> http://127.0.0.1:4441`,
    `${iso(S5 + 13 * 3600e3 + 30e3)} img-cache hits=3 upstream=1 upstreamMB=0.1 diskMB=412.3 fallback=1 r2err=1 r2=0`);
  hasBad(g5(l), 'fallback=1 r2err=1 segment=2');
});
await t('G5 an old build line (no fallback fields) -> FAIL', () => {
  hasBad(g5(activityLog({ edits: { 5: `${iso(S5 + 5 * 3600e3)} img-cache hits=5 upstream=1 upstreamMB=0.1 diskMB=412.3` } })), 'old build');
});
await t('G5 mutation: a copy cut to 23 h -> FAIL', () => { hasBad(g5(activityLog({ hours: 23 }), 24), 'cover 23.0 h'); });

// ---------- stubs: the Activity, the gallery, the R2 public domain ----------
const TYPE = { png: 'image/png', webp: 'image/webp', glb: 'model/gltf-binary', webm: 'video/webm', mp4: 'video/mp4' };
const files = new Map();
const add = (key) => files.set(key, Buffer.from(`bytes of ${key}`));
add('card-art/cards/card-back.png'); add('card-art/grid/cards/card-back.webp'); add('card-art/sets/s1-still.png');
for (let i = 0; i < 6; i += 1) { add(`card-art/boss/models/m${i}.glb`); add(`card-art/boss/behemoth/s${i}.webm`); add(`card-art/boss/behemoth/s${i}.mp4`); add(`card-art/boss/thumbs/t${i}.png`); }
for (let i = 0; i < 12; i += 1) { add(`card-art/cards/c${i}-common.png`); add(`card-art/grid/cards/c${i}-common.webp`); add(`card-art/reveal/cards/c${i}-common.webp`); }
const keyList = [...files].map(([key, buf]) => ({ key, md5: md5(buf), type: TYPE[key.split('.').pop()] }));

const S = { mode: 'r2-first', configImg: 'r2-first', noHeaders: false, bossVm: true, gallery: 'r2', missHit: false, missSeen: 0 };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const base = `http://127.0.0.1:${server.address().port}`;
  if (u.pathname === '/api/config') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ clientId: '1', ...(S.configImg ? { img: S.configImg } : {}) })); }
  if (u.pathname === '/api/gallery') {
    const host = S.gallery === 'r2' ? `${base}/r2` : SUPABASE_HOST;
    const p = S.gallery === 'r2' ? '' : '/storage/v1/object/public';
    const cards = Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, image_url: `${host}${p}/card-art/cards/c${i}-common.png?v=17${i}` }));
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ subjects: [{ key: 'k', name: 'n', cards }], backUrl: `${host}${p}/card-art/cards/card-back.png` }));
  }
  let m = u.pathname.match(/^\/api\/img\/storage\/v1\/object\/public\/(card-art\/.+)$/);
  if (m && files.has(m[1])) {
    res.setHeader('content-type', TYPE[m[1].split('.').pop()]);
    if (!S.noHeaders) {
      if (S.bossVm && m[1].startsWith('card-art/boss/')) res.setHeader('X-Boss-Source', 'vm');
      else res.setHeader('X-Img-Source', S.mode === 'supabase' ? 'supabase' : 'r2');
    }
    return res.end(files.get(m[1]));
  }
  m = u.pathname.match(/^\/r2\/(card-art\/.+)$/);
  if (m && files.has(m[1])) { res.setHeader('content-type', TYPE[m[1].split('.').pop()]); return res.end(files.get(m[1])); }
  if (m && m[1].startsWith('card-art/_preflight/')) { S.missSeen += 1; res.statusCode = 404; res.setHeader('cf-cache-status', S.missHit && S.missSeen > 1 ? 'HIT' : 'MISS'); return res.end(); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const reset = (o) => Object.assign(S, { mode: 'r2-first', configImg: 'r2-first', noHeaders: false, bossVm: true, gallery: 'r2', missHit: false, missSeen: 0 }, o);
const g6 = (o = {}) => liveCheck({ keys: o.keys || keyList, base: `${BASE}/api/img`, gallery: BASE, expect: o.expect || 'r2', r2Base: `${BASE}/r2`, seed: 7 });

// ---------- G6 ----------
await t('G6 baseline: r2-first host, gallery r2 -> R2LIVE PASS', async () => { reset(); const r = await g6(); must(r.ok && r.n > 40, JSON.stringify(r).slice(0, 400)); });
await t('G6 mutation: the checker against a host in mode supabase -> FAIL (no X-Img-Source: r2)', async () => {
  reset({ mode: 'supabase', configImg: 'supabase' }); hasBad(await g6(), 'source supabase');
});
await t('G6 mutation: the gallery in GALLERY_ART=supabase -> FAIL', async () => { reset({ gallery: 'supabase' }); hasBad(await g6(), 'BAD gallery url host'); });
await t('G6 mutation: one grid key removed from the R2 list -> FAIL', async () => {
  reset(); hasBad(await g6({ keys: keyList.filter((k) => k.key !== 'card-art/grid/cards/c3-common.webp') }), 'grid key not in R2 card-art/grid/cards/c3-common.webp');
});

// ---------- G7 / G8 ----------
await t('G7 baseline: host in mode supabase, gallery supabase -> SUPABASE-MODE PASS', async () => {
  reset({ mode: 'supabase', configImg: 'supabase', gallery: 'supabase' }); const r = await g6({ expect: 'supabase' }); must(r.ok && r.n === 20, JSON.stringify(r).slice(0, 400));
});
await t('G7 mutation: the G7 checker against a host in r2-first -> FAIL', async () => { reset({ gallery: 'supabase' }); hasBad(await g6({ expect: 'supabase' }), 'BAD config img=r2-first'); });
await t('G7 config r2-first while every image is a cache hit (no header) -> FAIL', async () => {
  reset({ noHeaders: true, gallery: 'supabase' }); hasBad(await g6({ expect: 'supabase' }), 'BAD config img=r2-first');
});
await t('G7 an old build (no img in /api/config) -> FAIL', async () => { reset({ mode: 'supabase', configImg: null, gallery: 'supabase' }); hasBad(await g6({ expect: 'supabase' }), 'img=(none)'); });
await t('G8 mutation: the "back to supabase" check while the host is still r2-first -> FAIL', async () => {
  reset({ gallery: 'r2' }); const r = await g6({ expect: 'supabase' }); hasBad(r, 'source r2'); hasBad(r, 'BAD gallery url host');
});

// G7 env count (N3): each container, running or created/stopped, by COUNT only.
function sshStub(hosts) {
  return async (ip, cmd) => {
    const h = hosts[ip];
    if (/^sudo docker ps (-a )?--format/.test(cmd)) return { code: 0, out: Object.entries(h.containers).filter(([, c]) => cmd.includes(' -a ') || c.running).map(([n]) => n).join('\n') };
    let m = cmd.match(/docker inspect .* (\S+) \| grep -c '\^(.+)\$'$/);
    if (m) return { code: 0, out: String((h.containers[m[1]]?.env || []).filter((l) => l === m[2]).length) };
    m = cmd.match(/^cat \/home\/ubuntu\/(\S+)\/\.deployed-commit$/);
    if (m) return { code: 0, out: `${h.commit}\n` };
    if (cmd.startsWith('curl')) return { code: 0, out: JSON.stringify(h.config) };
    return { code: 1, out: '' };
  };
}
const isAncestor = async (merge, sha) => sha === 'bbbbbbbbbb';
await t('G7 env count: activity + a STOPPED standby bot with IMG_UPSTREAM=supabase -> no problem', async () => {
  const run = sshStub({ '10.0.0.9': { commit: 'bbbbbbbbbb', config: { img: 'supabase' }, containers: { 'tcg-activity': { running: true, env: ['IMG_UPSTREAM=supabase'] }, 'tcg-bot': { running: false, env: ['IMG_UPSTREAM=supabase'] } } } });
  const bad = await hostChecks({ host: { name: 'backup', ip: '10.0.0.9' }, mode: 'supabase', merge: 'aaaaaaaaaa', run, isAncestor });
  must(bad.length === 0, bad.join(' | '));
});
await t('G7 mutation: a stopped test container with no IMG_UPSTREAM -> count 0 -> FAIL', async () => {
  const run = sshStub({ '10.0.0.9': { commit: 'bbbbbbbbbb', config: { img: 'supabase' }, containers: { 'tcg-activity': { running: true, env: ['IMG_UPSTREAM=supabase'] }, 'tcg-bot': { running: false, env: ['DISCORD_TOKEN=x'] } } } });
  const bad = await hostChecks({ host: { name: 'backup', ip: '10.0.0.9' }, mode: 'supabase', merge: 'aaaaaaaaaa', run, isAncestor });
  must(bad.some((b) => b.includes('tcg-bot env IMG_UPSTREAM=supabase count 0')), bad.join(' | ') || 'no problem found');
});

// ---------- G10 ----------
await t('G10 baseline: 30 keys of the 5 types -> PREFLIGHT PASS n=30', async () => { reset(); const r = await preflight({ keys: keyList, base: `${BASE}/r2`, seed: 3 }); must(r.ok && r.n === 30, JSON.stringify(r).slice(0, 400)); });
await t('G10 mutation: a wrong base path (/nope/) -> FAIL on key 1', async () => {
  reset(); const r = await preflight({ keys: keyList, base: `${BASE}/nope`, seed: 3 }); must(!r.ok && /status 404/.test(r.bad[0]), r.bad[0]);
});
await t('G10 mutation: an expected type changed for one key -> FAIL', async () => {
  reset(); const keys = keyList.map((k) => (k.key === 'card-art/boss/models/m0.glb' ? { ...k, type: 'application/octet-stream' } : k));
  hasBad(await preflight({ keys, base: `${BASE}/r2`, seed: 3 }), 'type model/gltf-binary != application/octet-stream');
});
await t('G10 the edge caches the 404 (second answer HIT) -> FAIL', async () => { reset({ missHit: true }); hasBad(await preflight({ keys: keyList, base: `${BASE}/r2`, seed: 3 }), 'cf-cache-status HIT'); });

server.close();
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exit(failed ? 1 : 0);
