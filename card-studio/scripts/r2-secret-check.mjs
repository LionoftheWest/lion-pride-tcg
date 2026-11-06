// R2-MOVE G11: no R2 key VALUE in git, in the item logs or in the REPORT. Run it before EVERY push of the branch (Builder
// and Stager), and again at S2 and S7 (spec 6.2 G11, N5).
//   node card-studio/scripts/r2-secret-check.mjs [--repo <dir>] [--base origin/main] [--item <dir>]
// 1. reads the real Access Key ID and Secret from the vault (src/r2-vault.js) and writes them, one per line, to a temp
//    patterns file (never an argument, never printed; folder R2_SECRET_SCRATCH, default the OS temp folder);
// 2. git grep -F -q -f <file> <every commit of origin/main..HEAD>, then HEAD, then the working tree (tracked + untracked);
// 3. the same search in <item>/logs/ and <item>/REPORT*.md (default C:/Users/vaugh/lptcg-pipeline/items/R2-MOVE);
// 4. deletes the temp file in a finally and checks that it is gone.
// Pass = no match anywhere: `SECRET-CHECK PASS commits=<n>`. A match = `SECRET-CHECK FAIL <where>` (the place only, never the
// value), exit 1: do not push. No vault = `refused: R2 vault missing (...)`, exit 1.
// Tests only: --test-vault <json> ({ "r2-access-key-id": "...", "r2-secret-access-key": "..." }) of FAKE values (CI has no
// DPAPI vault); ci/gates/secret-values.test.mjs uses it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTRY_KEY_ID, ENTRY_SECRET, vaultGet } from '../src/r2-vault.js';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const REPO = val('--repo', join(here, '..', '..'));
const BASE = val('--base', 'origin/main');
const ITEM = val('--item', 'C:/Users/vaugh/lptcg-pipeline/items/R2-MOVE');

function values() {
  const tv = val('--test-vault');
  if (tv) { const j = JSON.parse(readFileSync(tv, 'utf8')); return [j[ENTRY_KEY_ID], j[ENTRY_SECRET]]; }
  return [vaultGet(ENTRY_KEY_ID), vaultGet(ENTRY_SECRET)];
}

// git grep exit: 0 = a match, 1 = no match, other = an error (counted as a FAIL: the check did not run).
const gitGrep = (patterns, args) => spawnSync('git', ['grep', '-F', '-q', '-I', '-f', patterns, ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 }).status;

function filesUnder(p) {
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => filesUnder(join(p, n)));
}

const fails = [];
let commits = 0;
let tmpDir = null;
let code = 1;
try {
  const vals = values().map((v) => String(v || '').trim());
  if (vals.some((v) => v.length < 16)) throw new Error('refused: R2 vault missing (an entry is empty or short)');
  tmpDir = mkdtempSync(join(process.env.R2_SECRET_SCRATCH || tmpdir(), 'r2-secret-'));
  const patterns = join(tmpDir, 'patterns');
  writeFileSync(patterns, `${vals.join('\n')}\n`, { mode: 0o600 });

  const revs = spawnSync('git', ['rev-list', `${BASE}..HEAD`], { cwd: REPO, encoding: 'utf8' });
  if (revs.status !== 0) throw new Error(`refused: git rev-list ${BASE}..HEAD failed (fetch ${BASE} first)`);
  const list = revs.stdout.split('\n').filter(Boolean);
  commits = list.length;
  for (let i = 0; i < list.length; i += 200) {
    const s = gitGrep(patterns, list.slice(i, i + 200));
    if (s !== 1) fails.push(s === 0 ? `commits of ${BASE}..HEAD` : `git grep error (exit ${s}) on the branch commits`);
  }
  const h = gitGrep(patterns, ['HEAD']);
  if (h !== 1) fails.push(h === 0 ? 'HEAD' : `git grep error (exit ${h}) on HEAD`);
  const w = gitGrep(patterns, ['--untracked']);
  if (w !== 1) fails.push(w === 0 ? 'the working tree' : `git grep error (exit ${w}) on the working tree`);

  const itemFiles = [...filesUnder(join(ITEM, 'logs')), ...(existsSync(ITEM) ? readdirSync(ITEM).filter((n) => /^REPORT.*\.md$/.test(n)).map((n) => join(ITEM, n)) : [])];
  for (const f of itemFiles) {
    const t = readFileSync(f, 'latin1');
    if (vals.some((v) => t.includes(v))) fails.push(f);
  }
  code = fails.length ? 1 : 0;
} catch (e) {
  console.log(String(e.message).split('\n')[0]);
  code = 1;
} finally {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  if (tmpDir && existsSync(tmpDir)) { console.log(`SECRET-CHECK FAIL the temp patterns file is still present (${tmpDir})`); code = 1; }
}
for (const f of fails) console.log(`SECRET-CHECK FAIL ${f}`);
if (code === 0) console.log(`SECRET-CHECK PASS commits=${commits}`);
process.exitCode = code;
