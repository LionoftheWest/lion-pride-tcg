// R2-MOVE G9 (S7): delete the card art from Supabase Storage, only when every serving host reads R2 (spec 6.2 G9).
//   node card-studio/scripts/r2-retire-supabase.mjs --dry --hosts main=<ip>,backup=<ip> --connectors <file> --merge <sha>
//        --stats-pass <G5 log> --second-copy-log <r2-verify --exact --source <copy> log> [--manifest <S4 manifest>] [--plan <file>]
//   node card-studio/scripts/r2-retire-supabase.mjs --live [--plan <file>]
//   node card-studio/scripts/r2-retire-supabase.mjs --hosts-check supabase --hosts ... --merge <sha>   (the G7 env part)
// --dry:
//   (1) THE HOST LIST IS DERIVED, not typed (N3): (a) the origin IPs of the tunnel lionpride-main connectors (--connectors:
//       a paste of `cloudflared tunnel info lionpride-main`, or the JSON of the Cloudflare API connections list: every
//       origin_ip), (b) the A record of lionpridetcg.duckdns.org, (c) the standby host (ops/deploy.sh BACKUP_IP default,
//       the backup VM of ops/failover/). Each derived IP must be in --hosts, else 'refused: derived host <ip> not in --hosts'.
//       Each host (ssh): every container, RUNNING OR NOT (docker ps -a; the standby bot is created and stopped):
//       tcg-activity and tcg-bot env count of ^IMG_UPSTREAM=r2$ = 1, card-gallery ^GALLERY_ART=r2$ = 1 (count only, the env is
//       never printed); /home/ubuntu/<dir>/.deployed-commit contains the R2-MOVE merge (git merge-base --is-ancestor);
//       with tcg-activity: /api/config "img":"r2" (no img field = an old build).
//   (2) r2-verify (post-S4 rules) PASS in the same run. (3) a G5 STATS PASS file of the same week (< 7 days).
//   (4) the S7 second copy verified (a log with R2VERIFY PASS). Then RETIRE PLAN n=<N> bytes=<B> and the plan file (head).
// --live: refused without a --dry plan of the same head < 3 h old. Deletes through the storage API (batches of 100, never
//   SQL on storage.objects), then counts the card-art objects again: RETIRE PASS left=0, else RETIRE FAIL left=<n>.
// Every refusal: one 'refused: ...' line, exit 1, 0 deletes.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
export const PROJECT_REF = 'kgvdqqehefezbypozvrh';
export const DUCK = 'lionpridetcg.duckdns.org';
export const CONTAINERS = {
  'tcg-activity': { env: 'IMG_UPSTREAM', dir: 'activity' },
  'tcg-bot': { env: 'IMG_UPSTREAM', dir: 'tcg-bot' },
  'card-gallery': { env: 'GALLERY_ART', dir: 'gallery' },
};
const PLAN_MAX_MS = 3 * 3600e3;
const WEEK_MS = 7 * 24 * 3600e3;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;

async function assertProject(url) {
  try {
    const lib = await import(pathToFileURL(join(here, 'r2-lib.mjs')).href);
    if (typeof lib.assertProject === 'function') return lib.assertProject(url);
  } catch { /* r2-lib.mjs missing: the same check inline */ }
  const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
  if (host !== `${PROJECT_REF}.supabase.co`) throw new Error(`refused: SUPABASE_URL host ${host || '(none)'} is not ${PROJECT_REF} (I-7)`);
}

/** The connector origin IPs: the CF API JSON (every origin_ip), else every IPv4 in the cloudflared text. */
export function parseConnectors(text) {
  const t = String(text || '');
  try {
    const out = new Set();
    const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k === 'origin_ip' && typeof v === 'string') out.add(v); else walk(v); } };
    walk(JSON.parse(t));
    return [...out];
  } catch { return [...new Set(t.match(IPV4) || [])]; }
}

/** The standby host: the BACKUP_IP default of ops/deploy.sh (the backup VM of ops/failover/). */
export function standbyIps(root = ROOT) {
  const m = readFileSync(join(root, 'ops', 'deploy.sh'), 'utf8').match(/BACKUP_IP:-((?:\d+\.){3}\d+)/);
  return m ? [m[1]] : [];
}

export function parseHosts(s) {
  return String(s || '').split(',').filter(Boolean).map((x) => { const [name, ip] = x.split('='); return { name, ip }; });
}

export async function deriveHosts({ connectorsText, resolveA = (n) => dns.resolve4(n), standby = standbyIps(), hosts }) {
  const conn = parseConnectors(connectorsText);
  if (!conn.length) throw new Error('refused: no connector IP in --connectors (paste cloudflared tunnel info lionpride-main)');
  const derived = new Set([...conn, ...(await resolveA(DUCK)), ...standby]);
  const known = new Set(hosts.map((h) => h.ip));
  for (const ip of derived) {
    if (!known.has(ip)) throw new Error(`refused: derived host ${ip} not in --hosts`);
  }
  return [...derived];
}

/**
 * One host in one mode (r2 for G9, supabase for G7). run(ip, cmd) -> { code, out }; isAncestor(merge, sha) -> bool.
 * Returns the problems (refusal lines); [] = the host is in that mode with the merge.
 */
export async function hostChecks({ host, mode, merge, run, isAncestor }) {
  const bad = [];
  const ps = await run(host.ip, "sudo docker ps -a --format '{{.Names}}'");
  if (ps.code !== 0) return [`refused: host ${host.name} docker ps failed`];
  const names = ps.out.split(/\r?\n/).map((x) => x.trim()).filter((x) => CONTAINERS[x]);
  if (!names.length) bad.push(`refused: host ${host.name} has no tcg-activity, tcg-bot or card-gallery container`);
  for (const name of names) {
    const { env, dir } = CONTAINERS[name];
    const c = await run(host.ip, `sudo docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' ${name} | grep -c '^${env}=${mode}$'`);
    if (c.out.trim() !== '1') bad.push(`refused: host ${host.name} ${name} env ${env}=${mode} count ${c.out.trim() || '0'} (need 1)`);
    const d = await run(host.ip, `cat /home/ubuntu/${dir}/.deployed-commit`);
    const sha = d.out.trim();
    if (d.code !== 0 || !/^[0-9a-f]{7,40}$/.test(sha) || !(await isAncestor(merge, sha))) bad.push(`refused: host ${host.name} ${name} build ${sha || '(none)'} has not the merge ${merge}`);
  }
  if (names.includes('tcg-activity')) {
    const c = await run(host.ip, 'curl -fsS http://127.0.0.1:4441/api/config');
    let img;
    try { img = JSON.parse(c.out).img; } catch { img = undefined; }
    if (img === undefined) bad.push(`refused: host ${host.name} old build (no img in /api/config)`);
    else if (img !== mode) bad.push(`refused: host ${host.name} not ${mode} (img=${img})`);
  }
  return bad;
}

export async function retireDry({ hosts, connectorsText, resolveA, standby, run, isAncestor, merge, verify, statsPass, secondCopy,
  objects, head, planPath, now = Date.now() }) {
  if (!merge) throw new Error('refused: --merge <sha> (the R2-MOVE merge) is required');
  await deriveHosts({ connectorsText, resolveA, standby, hosts });
  for (const h of hosts) {
    const bad = await hostChecks({ host: h, mode: 'r2', merge, run, isAncestor });
    if (bad.length) throw new Error(bad.join('\n'));
  }
  const v = await verify();
  if (!/^R2VERIFY PASS/m.test(v)) throw new Error('refused: r2-verify (post-S4) did not PASS in this run');
  if (!statsPass || !/^STATS PASS/m.test(statsPass.text) || now - statsPass.mtime > WEEK_MS) throw new Error('refused: no G5 STATS PASS file of this week');
  if (!secondCopy || !/^R2VERIFY PASS/m.test(secondCopy)) throw new Error('refused: the S7 second copy is not verified (R2VERIFY PASS)');
  const objs = await objects();
  const bytes = objs.reduce((s, o) => s + (o.size || 0), 0);
  mkdirSync(dirname(planPath), { recursive: true });
  writeFileSync(planPath, JSON.stringify({ head, at: new Date(now).toISOString(), n: objs.length, bytes, names: objs.map((o) => o.name) }, null, 1));
  return `RETIRE PLAN n=${objs.length} bytes=${bytes}`;
}

export async function retireLive({ planPath, head, remove, count, now = Date.now() }) {
  let plan = null;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); } catch { /* no plan */ }
  if (!plan || plan.head !== head || !(now - Date.parse(plan.at) < PLAN_MAX_MS)) throw new Error(`refused: no --dry plan of head ${head} younger than 3 h`);
  for (let i = 0; i < plan.names.length; i += 100) await remove(plan.names.slice(i, i + 100));
  const left = await count();
  return left === 0 ? 'RETIRE PASS left=0' : `RETIRE FAIL left=${left}`;
}

/** Every object of the card-art bucket (recursive storage list): [{ name, size }]. */
export async function listAll(db, prefix = '') {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.storage.from('card-art').list(prefix, { limit: 1000, offset: off });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    for (const f of data || []) {
      const name = prefix ? `${prefix}/${f.name}` : f.name;
      if (f.id === null) out.push(...(await listAll(db, name))); else out.push({ name, size: f.metadata?.size || 0 });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const val = (k, d = null) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
  const KEY = process.env.KEY || join(homedir(), 'Downloads', 'ssh-key-2026-09-08.key');
  const run = async (ip, cmd) => {
    const r = spawnSync('ssh', ['-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', `ubuntu@${ip}`, cmd], { encoding: 'utf8' });
    return { code: r.status ?? 1, out: r.stdout || '' };
  };
  const isAncestor = async (m, sha) => spawnSync('git', ['merge-base', '--is-ancestor', m, sha], { cwd: ROOT }).status === 0;
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const planPath = val('--plan', join(process.env.ART_STATE_DIR || join(homedir(), '.lptcg', 'r2'), 'retire-plan.json'));
  console.log(`commit ${head}`);
  try {
    const hosts = parseHosts(val('--hosts'));
    if (val('--hosts-check')) {
      const mode = val('--hosts-check');
      const bad = [];
      for (const h of hosts) bad.push(...(await hostChecks({ host: h, mode, merge: val('--merge'), run, isAncestor })));
      console.log(bad.length ? `${bad.join('\n')}\nHOSTS FAIL ${bad.length}` : `HOSTS PASS mode=${mode} n=${hosts.length}`);
      process.exit(bad.length ? 1 : 0);
    }
    await import('dotenv').then((d) => d.default.config({ path: join(here, '..', '.env') }));
    await assertProject(process.env.SUPABASE_URL);
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    if (a.includes('--dry')) {
      const sp = val('--stats-pass');
      const out = await retireDry({
        hosts, connectorsText: val('--connectors') ? readFileSync(val('--connectors'), 'utf8') : '', run, isAncestor, merge: val('--merge'),
        // r2-verify post-S4 rules need the S4 manifest (--manifest, default ~/.lptcg/r2/s4-manifest.json)
        verify: async () => spawnSync(process.execPath, [join(here, 'r2-verify.mjs'), '--manifest', val('--manifest') || join(homedir(), '.lptcg', 'r2', 's4-manifest.json')], { encoding: 'utf8' }).stdout || '',
        statsPass: sp && existsSync(sp) ? { text: readFileSync(sp, 'utf8'), mtime: statSync(sp).mtimeMs } : null,
        secondCopy: val('--second-copy-log') && existsSync(val('--second-copy-log')) ? readFileSync(val('--second-copy-log'), 'utf8') : null,
        objects: () => listAll(db), head, planPath,
      });
      console.log(out);
    } else if (a.includes('--live')) {
      const out = await retireLive({
        planPath, head,
        remove: async (names) => { const { error } = await db.storage.from('card-art').remove(names); if (error) throw new Error(`remove: ${error.message}`); },
        count: async () => (await listAll(db)).length,
      });
      console.log(out);
      process.exit(out.startsWith('RETIRE PASS') ? 0 : 1);
    } else throw new Error('refused: use --dry, --live or --hosts-check <mode>');
  } catch (e) { console.log(e.message); process.exit(1); }
}
