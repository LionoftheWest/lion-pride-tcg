import './localdb-guard.mjs';
/**
 * S1-FACE B11 (SPEC v2.4 2.6, N-2, D-222, r5 L-1): the boss files on the game server and on the failover backup VM.
 *   node scripts/boss-check.mjs backup --live [--out <dir>]          B11a step 1, READ ONLY on live (only the LIST call and public GETs):
 *        the storage LIST of boss/models and boss/behemoth, a public GET of each file -> <dir>/<models|behemoth>/<name>, <dir>/list.txt
 *        ("<sha256>  <dir>/<name>  <Content-Type>"), <dir>/types.json. "BOSS-BACKUP PASS models=36 clips=30 bytes=<n>" (sizes = the LIST).
 *   node scripts/boss-check.mjs copy --host game|backup [--dir <backup dir>] [--dry]     B11a step 2 (a file copy, not a deploy):
 *        sudo mkdir /srv/lptcg/boss-files/{models,behemoth}, chown ubuntu; scp the 66 files, list.txt and types.json; sha256sum on the VM =
 *        the list; count 36 + 30. "BOSS-COPY PASS host=<h> files=66". It does NOT create ENABLED (the flag is B11d).
 *   node scripts/boss-check.mjs check --host game|backup [--dir <backup dir>] [--public] [--dry]   B11d (game, --public) / B11d2 (backup):
 *        runs ops/boss-check.sh on the VM against http://127.0.0.1:4441 (66 GETs: 200, X-Boss-Source: vm, type, sha; the folder count and
 *        sha), and with --public ONE GET through Cloudflare https://play.lionpridetcg.com/app/api/img/...boss/models/<name>?v=bc<unix time>
 *        (200, X-Boss-Source: vm, sha). Last line: "BOSS PASS host=game models=36 clips=30 source=vm public=1" or
 *        "BOSS PASS host=backup models=36 clips=30 source=vm" (B11e needs both lines of the day).
 * Hosts: game = lionpridetcg.duckdns.org (resolved), backup = 137.131.48.8 (BACKUP_IP). KEY (default C:/Users/vaugh/.ssh/lptcg-vm).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '..');
const a = process.argv.slice(2);
const CMD = a[0];
const val = (n, d = null) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const flag = (n) => a.includes(n);
const DIR = val('--dir', val('--out', 'C:/Users/vaugh/lptcg-pipeline/items/S1-FACE/work/boss-backup'));
const KEY = process.env.KEY || 'C:/Users/vaugh/.ssh/lptcg-vm';
const VMDIR = '/srv/lptcg/boss-files';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const DRY = flag('--dry');

function hostIp(h) {
  if (h === 'backup') return process.env.BACKUP_IP || '137.131.48.8';
  if (h !== 'game') throw new Error('--host game|backup');
  const out = execFileSync('nslookup', ['lionpridetcg.duckdns.org'], { encoding: 'utf8' });
  const ips = [...out.matchAll(/Address(?:es)?:\s*([0-9.]+)/g)].map((m) => m[1]);
  const ip = ips.pop();
  if (!ip) throw new Error('cannot resolve lionpridetcg.duckdns.org');
  return ip;
}
const ssh = (ip, cmd, input) => {
  const args = ['-i', KEY, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', `ubuntu@${ip}`, cmd];
  if (DRY) { console.log(`DRY ssh ${args.join(' ')}`); return ''; }
  return execFileSync('ssh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
};
const scp = (ip, from, to) => {
  const args = ['-i', KEY, '-o', 'BatchMode=yes', '-r', ...from, `ubuntu@${ip}:${to}`];
  if (DRY) { console.log(`DRY scp ${args.join(' ')}`); return; }
  execFileSync('scp', args, { stdio: 'inherit' });
};
const readList = () => readFileSync(join(DIR, 'list.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { const [s, p, t] = l.split(/\s+/); return { sha: s, path: p, type: t }; });

async function backup() {
  if (!flag('--live')) { console.log('refused: the target is LIVE (use --live)'); return 1; }
  // read only: the storage LIST call and public GETs (this branch is from main: the stage-guard.mjs allow-list is in the S1-FACE PR)
  const { supabase } = await import('../src/supabase.js');
  const lines = [], types = {};
  let bytes = 0, bad = 0;
  const n = { models: 0, behemoth: 0 };
  for (const sub of ['models', 'behemoth']) {
    const { data, error } = await supabase.storage.from('card-art').list(`boss/${sub}`, { limit: 1000 });
    if (error) throw new Error(`list boss/${sub}: ${error.message}`);
    mkdirSync(join(DIR, sub), { recursive: true });
    for (const e of data.filter((x) => x.id !== null)) {
      const url = supabase.storage.from('card-art').getPublicUrl(`boss/${sub}/${e.name}`).data.publicUrl;
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.length !== Number(e.metadata?.size)) { bad += 1; console.log(`BOSS-BACKUP BAD ${sub}/${e.name} http=${r.status} bytes=${buf.length} listed=${e.metadata?.size}`); continue; }
      writeFileSync(join(DIR, sub, e.name), buf);
      const type = r.headers.get('content-type') || 'application/octet-stream';
      lines.push(`${sha(buf)}  ${sub}/${e.name}  ${type}`);
      types[`${sub}/${e.name}`] = type;
      bytes += buf.length; n[sub] += 1;
    }
  }
  writeFileSync(join(DIR, 'list.txt'), lines.join('\n') + '\n');
  writeFileSync(join(DIR, 'types.json'), JSON.stringify(types, null, 1));
  const ok = !bad && n.models === 36 && n.behemoth === 30;
  console.log(`BOSS-BACKUP ${ok ? 'PASS' : 'FAIL'} models=${n.models} clips=${n.behemoth} bytes=${bytes} dir=${DIR}`);
  return ok ? 0 : 1;
}

function copy(host) {
  const ip = hostIp(host);
  const list = readList();
  if (list.length !== 66) { console.log(`refused: list.txt has ${list.length} lines (need 66)`); return 1; }
  for (const x of list) if (sha(readFileSync(join(DIR, x.path))) !== x.sha) { console.log(`refused: local ${x.path} sha differs from list.txt`); return 1; }
  ssh(ip, `sudo mkdir -p ${VMDIR}/models ${VMDIR}/behemoth && sudo chown -R ubuntu:ubuntu /srv/lptcg && ls -ld ${VMDIR}`);
  scp(ip, readdirSync(join(DIR, 'models')).map((f) => join(DIR, 'models', f)), `${VMDIR}/models/`);
  scp(ip, readdirSync(join(DIR, 'behemoth')).map((f) => join(DIR, 'behemoth', f)), `${VMDIR}/behemoth/`);
  scp(ip, [join(DIR, 'list.txt'), join(DIR, 'types.json')], `${VMDIR}/`);
  if (DRY) { console.log('DRY end'); return 0; }
  const out = ssh(ip, `cd ${VMDIR} && awk '{print $1"  "$2}' list.txt | sha256sum -c --quiet && echo SHA-OK; echo models=$(ls models | wc -l) behemoth=$(ls behemoth | wc -l)`);
  const ok = /SHA-OK/.test(out) && /models=36 behemoth=30/.test(out);
  console.log(out.trim());
  console.log(`BOSS-COPY ${ok ? 'PASS' : 'FAIL'} host=${host} files=${ok ? 66 : '?'}`);
  return ok ? 0 : 1;
}

async function check(host) {
  const ip = hostIp(host);
  scp(ip, [join(REPO, 'ops', 'boss-check.sh'), join(DIR, 'list.txt')], '/tmp/');
  const out = DRY ? '' : (() => { try { return ssh(ip, `bash /tmp/boss-check.sh /tmp/list.txt --host ${host} --base http://127.0.0.1:4441 --dir ${VMDIR}`); } catch (e) { return `${e.stdout || ''}`; } })();
  if (out) process.stdout.write(out);
  const last = out.trim().split(/\r?\n/).pop() || '';
  let ok = /^BOSS PASS host=\S+ models=36 clips=30 source=vm$/.test(last);
  let pub = '';
  if (flag('--public')) {
    if (host !== 'game') { console.log('refused: --public is for the game server only'); return 1; }
    const m = readList().find((x) => x.path.startsWith('models/'));
    const url = `https://play.lionpridetcg.com/app/api/img/storage/v1/object/public/card-art/boss/${m.path}?v=bc${Math.floor(Date.now() / 1000)}`;
    if (DRY) console.log(`DRY GET ${url}`);
    else {
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      const good = r.status === 200 && r.headers.get('x-boss-source') === 'vm' && sha(buf) === m.sha;
      console.log(`PUBLIC ${good ? 'ok' : 'FAIL'} ${url} http=${r.status} x-boss-source=${r.headers.get('x-boss-source')} sha=${sha(buf) === m.sha ? 'equal' : 'DIFFERS'}`);
      ok = ok && good; pub = ' public=1';
    }
  }
  if (DRY) { console.log('DRY end'); return 0; }
  console.log(ok ? `BOSS PASS host=${host} models=36 clips=30 source=vm${pub}` : `BOSS FAIL host=${host}`);
  return ok ? 0 : 1;
}

const rc = CMD === 'backup' ? await backup() : CMD === 'copy' ? copy(val('--host')) : CMD === 'check' ? await check(val('--host'))
  : (console.error('usage: boss-check.mjs backup --live | copy --host game|backup | check --host game|backup [--public]'), 2);
process.exitCode = rc;
