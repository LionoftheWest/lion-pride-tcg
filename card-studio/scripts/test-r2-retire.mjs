// R2-MOVE G9: the tests of r2-retire-supabase.mjs with stubs only (an injected ssh runner, DNS answer, verify, storage).
// One PASS (dry plan, then live with left=0) and every refusal of the spec G9 list, each with 0 deletes.
//   node card-studio/scripts/test-r2-retire.mjs      -> TEST <name> PASS|FAIL ..., exit 1 on any FAIL
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retireDry, retireLive, standbyIps, parseConnectors } from './r2-retire-supabase.mjs';

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`TEST ${name} PASS`); } catch (e) { failed += 1; console.log(`TEST ${name} FAIL ${e.message}`); }
}
const must = (c, msg) => { if (!c) throw new Error(msg); };
const dir = mkdtempSync(join(tmpdir(), 'r2-retire-'));
const HEAD = '1111111111111111111111111111111111111111';
const MERGE = 'aaaaaaaaaa';
const MAIN = '10.0.0.1';
const STANDBY = standbyIps()[0];

// The hosts: main (activity, bot, gallery running), backup (activity running + the standby bot CREATED, stopped).
function world(o = {}) {
  const env = (v) => [`IMG_UPSTREAM=${v}`];
  const hosts = {
    [MAIN]: { commit: 'bbbbbbbbbb', config: { img: o.mainImg ?? 'r2' }, containers: {
      'tcg-activity': { running: true, env: env('r2') }, 'tcg-bot': { running: true, env: env('r2') }, 'card-gallery': { running: true, env: ['GALLERY_ART=r2'] } } },
    [STANDBY]: { commit: 'bbbbbbbbbb', config: { img: 'r2' }, containers: {
      'tcg-activity': { running: true, env: env('r2') }, 'tcg-bot': { running: false, env: o.standbyEnv ?? env('r2') }, 'cf-named': { running: false, env: [] } } },
  };
  if (o.mainImg === null) delete hosts[MAIN].config.img;
  return hosts;
}
function runner(hosts) {
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
function dryArgs(o = {}) {
  return {
    hosts: [{ name: 'main', ip: MAIN }, { name: 'backup', ip: STANDBY }],
    connectorsText: o.connectors ?? `CONNECTOR ID  CREATED  ARCHITECTURE  VERSION  ORIGIN IP  EDGE\nabc  2026-11-01T00:00:00Z  linux_arm64  2026.9.1  ${MAIN}  2xsjc01`,
    resolveA: async () => [MAIN], run: runner(world(o)), isAncestor: async (m, sha) => sha === 'bbbbbbbbbb', merge: MERGE,
    verify: async () => o.verify ?? 'R2VERIFY PASS n=3 bytes=300 newer=1',
    statsPass: { text: 'commit x\nSTATS PASS hosts=2 hours=26.0\n', mtime: Date.now() - 3600e3 },
    secondCopy: 'R2VERIFY PASS n=3 bytes=300', objects: async () => [{ name: 'cards/a.png', size: 100 }, { name: 'grid/cards/a.webp', size: 100 }, { name: 'boss/x.glb', size: 100 }],
    head: HEAD, planPath: join(dir, o.plan || 'plan.json'),
  };
}
async function refused(args, text) {
  try { await retireDry(args); } catch (e) { must(e.message.includes(text), `refused, but not "${text}": ${e.message}`); return; }
  throw new Error(`not refused (expected "${text}")`);
}

await t('parse: the cloudflared text and the CF API JSON give the origin IPs', () => {
  must(parseConnectors(`x ${MAIN} 2xsjc01`).join() === MAIN, 'text');
  must(parseConnectors(JSON.stringify({ result: [{ conns: [{ origin_ip: '10.0.0.5', colo_name: 'sjc' }] }] })).join() === '10.0.0.5', 'json');
  must(STANDBY === '137.131.48.8', `standby from ops/deploy.sh: ${STANDBY}`);
});
await t('G9 baseline: --dry RETIRE PLAN, then --live RETIRE PASS left=0', async () => {
  const out = await retireDry(dryArgs());
  must(out === 'RETIRE PLAN n=3 bytes=300', out);
  const removed = [];
  const live = await retireLive({ planPath: join(dir, 'plan.json'), head: HEAD, remove: async (n) => removed.push(...n), count: async () => 0 });
  must(live === 'RETIRE PASS left=0' && removed.length === 3, `${live} removed=${removed.length}`);
});
await t('G9 mutation: a host with "img":"supabase" -> refused: host main not r2', () => refused(dryArgs({ mainImg: 'supabase' }), 'refused: host main not r2'));
await t('G9 mutation: a host with an old build (no img field) -> refused', () => refused(dryArgs({ mainImg: null }), 'refused: host main old build'));
await t('G9 mutation: a stopped standby container with no IMG_UPSTREAM -> refused', () => refused(dryArgs({ standbyEnv: ['DISCORD_TOKEN=x'] }), 'refused: host backup tcg-bot env IMG_UPSTREAM=r2 count 0'));
await t('G9 mutation: a derived connector IP that is not in --hosts -> refused', () => refused(dryArgs({ connectors: `abc linux 2026.9.1 10.9.9.9 2xsjc01\ndef linux 2026.9.1 ${MAIN} 2xsjc01` }), 'refused: derived host 10.9.9.9 not in --hosts'));
await t('G9 mutation: a key with a different R2 ETag and no log line (r2-verify FAIL) -> refused', () => refused(dryArgs({ verify: 'DIFF card-art/cards/a.png etag 1 2\nR2VERIFY FAIL missing=0 differ=1 type=0' }), 'refused: r2-verify'));
await t('G9 mutation: --live without a fresh plan -> refused, 0 deletes', async () => {
  const removed = [];
  const remove = async (n) => removed.push(...n);
  for (const [why, plan] of [['none', null], ['old', { head: HEAD, at: new Date(Date.now() - 4 * 3600e3).toISOString(), names: ['a'] }], ['other head', { head: '2222', at: new Date().toISOString(), names: ['a'] }]]) {
    const p = join(dir, `live-${why.replace(' ', '-')}.json`);
    if (plan) writeFileSync(p, JSON.stringify(plan));
    let msg = '';
    try { await retireLive({ planPath: p, head: HEAD, remove, count: async () => 0 }); } catch (e) { msg = e.message; }
    must(msg.startsWith('refused: no --dry plan'), `${why}: ${msg || 'not refused'}`);
  }
  must(removed.length === 0, `deleted ${removed.length}`);
});

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `RESULT FAIL failed=${failed}` : 'RESULT PASS failed=0');
process.exit(failed ? 1 : 0);
