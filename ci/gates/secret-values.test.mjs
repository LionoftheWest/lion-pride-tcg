// R2-MOVE G11: no secret VALUE in the committed text files (spec 6.2 G11), and the pre-push check r2-secret-check.mjs.
//   node --test ci/gates/secret-values.test.mjs
// CI part: every tracked (and untracked, not ignored) TEXT file (binary files skipped) has no
//   R2_(SECRET_ACCESS_KEY|ACCESS_KEY_ID) = <a value of 20+ characters>   and no 64-hex string outside the allow list.
// The names of the env vars are allowed (they have no value). The allow list: the 3 JSON files of the base that hold file
// hashes (14f533ea, L6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSIGN = /R2_(SECRET_ACCESS_KEY|ACCESS_KEY_ID)\s*[=:]\s*['"]?[A-Za-z0-9]{20,}/;
const HEX64 = /(?<![0-9a-fA-F])[0-9a-f]{64}(?![0-9a-fA-F])/;
export const HEX64_ALLOW = {
  'card-studio/scripts/member-data-allow.json': 'file hashes (base 14f533ea)',
  'card-studio/scripts/member-data-images.json': 'file hashes (base 14f533ea)',
  'tcg-bot/src/draw-golden.json': 'file hashes (base 14f533ea)',
};

export function scanValues(root = ROOT) {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean);
  const hits = [];
  for (const f of files) {
    let buf; try { buf = readFileSync(join(root, f)); } catch { continue; }
    if (buf.subarray(0, 8000).includes(0)) continue; // binary
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((l, i) => {
      if (ASSIGN.test(l)) hits.push(`${f}:${i + 1} R2 key assignment`);
      if (!HEX64_ALLOW[f] && HEX64.test(l)) hits.push(`${f}:${i + 1} 64-hex`);
    });
  }
  return { files: files.length, hits };
}

test('G11 CI: no R2 key value and no 64-hex string outside the allow list in the text files', () => {
  const r = scanValues();
  assert.ok(r.files > 500, `scanned ${r.files}`);
  assert.deepEqual(r.hits, []);
});

test('G11 CI: the patterns hit a value, not a name', () => {
  assert.ok(ASSIGN.test(`R2_SECRET_ACCESS_KEY=${'a1'.repeat(20)}`));
  assert.ok(ASSIGN.test(`R2_ACCESS_KEY_ID: "${'0f'.repeat(16)}"`));
  assert.ok(!ASSIGN.test('const n = process.env.R2_SECRET_ACCESS_KEY;'));
  assert.ok(!ASSIGN.test('R2_ACCESS_KEY_ID='));
  assert.ok(HEX64.test(`x ${'ab'.repeat(32)} y`));
  assert.ok(!HEX64.test(`x ${'ab'.repeat(33)} y`), 'a longer hex run is not a 64-hex key');
});

// ---- the pre-push check (r2-secret-check.mjs) in a temp repo with a TEST vault (fake values) ----------------------------
const CHECK = join(ROOT, 'card-studio', 'scripts', 'r2-secret-check.mjs');
const FAKE_ID = 'f3c1a9e07b2d4c6e8a0b1c2d3e4f5a6b'; // 32 hex: the form of an R2 Access Key ID (FAKE)
const FAKE_SECRET = 'q'.repeat(10) + 'FAKEFAKEFAKE' + 'z'.repeat(18);
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function tempRepo() {
  const d = mkdtempSync(join(tmpdir(), 'secret-repo-'));
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't'); git(d, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(d, 'a.txt'), 'base\n'); git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'base');
  git(d, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return d;
}
function runCheck(repo, item) {
  const scratch = mkdtempSync(join(tmpdir(), 'secret-scratch-'));
  const vault = join(scratch, '..', `test-vault-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(vault, JSON.stringify({ 'r2-access-key-id': FAKE_ID, 'r2-secret-access-key': FAKE_SECRET }));
  const r = spawnSync(process.execPath, [CHECK, '--repo', repo, '--item', item, '--test-vault', vault], { encoding: 'utf8', env: { ...process.env, R2_SECRET_SCRATCH: scratch } });
  rmSync(vault, { force: true });
  const left = readdirSync(scratch);
  rmSync(scratch, { recursive: true, force: true });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, left };
}

test('G11 r2-secret-check: a clean branch -> SECRET-CHECK PASS, the temp patterns file is gone', () => {
  const repo = tempRepo(); const item = mkdtempSync(join(tmpdir(), 'secret-item-'));
  writeFileSync(join(repo, 'b.txt'), 'R2_ACCESS_KEY_ID= (the name only)\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'clean');
  const r = runCheck(repo, item);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /SECRET-CHECK PASS commits=1/); assert.deepEqual(r.left, []);
  assert.ok(!r.out.includes(FAKE_ID) && !r.out.includes(FAKE_SECRET), 'never prints a value');
});

test('G11 r2-secret-check: one commit adds the (test vault) Access Key ID in a log-like file, later removed -> FAIL', () => {
  const repo = tempRepo(); const item = mkdtempSync(join(tmpdir(), 'secret-item-'));
  writeFileSync(join(repo, 'run.log'), `PUT ok key=${FAKE_ID}\n`); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'oops');
  git(repo, 'rm', '-q', 'run.log'); git(repo, 'commit', '-q', '-m', 'removed (still in history)');
  const r = runCheck(repo, item);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /SECRET-CHECK FAIL commits of origin\/main\.\.HEAD/); assert.deepEqual(r.left, []);
  assert.ok(!r.out.includes(FAKE_ID), 'the place only, never the value');
});

test('G11 r2-secret-check: the secret in the item logs -> FAIL (the file named)', () => {
  const repo = tempRepo(); const item = mkdtempSync(join(tmpdir(), 'secret-item-'));
  mkdirSync(join(item, 'logs')); writeFileSync(join(item, 'logs', 's2.txt'), `x ${FAKE_SECRET} y\n`);
  const r = runCheck(repo, item);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /SECRET-CHECK FAIL .*s2\.txt/); assert.ok(!r.out.includes(FAKE_SECRET));
});

test('G11 r2-secret-check: an uncommitted file in the working tree with the value -> FAIL', () => {
  const repo = tempRepo(); const item = mkdtempSync(join(tmpdir(), 'secret-item-'));
  writeFileSync(join(repo, 'new.txt'), `${FAKE_SECRET}\n`);
  const r = runCheck(repo, item);
  assert.equal(r.code, 1, r.out); assert.match(r.out, /SECRET-CHECK FAIL the working tree/);
});

test('G11 r2-secret-check: no vault -> refused, exit 1', () => {
  const repo = tempRepo();
  const r = spawnSync(process.execPath, [CHECK, '--repo', repo, '--item', repo], { encoding: 'utf8', env: { ...process.env, R2_VAULT_SCRIPT: join(tmpdir(), 'no-such-vault.ps1') } });
  assert.equal(r.status, 1); assert.match(`${r.stdout}`, /refused: R2 vault missing/);
  assert.ok(existsSync(repo));
});
