// The guards of apply-sql.mjs refuse before any network call (2026-10-14: LOCALDB=1 without the preload applied a file LIVE).
//   node --test scripts/apply-sql-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'apply-sql.mjs');
// A token and URL that cannot reach anything: a guard that fails would try the network and fail later with another message.
const env = { ...process.env, SUPABASE_ACCESS_TOKEN: 'test-token', SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' };
const run = (extraEnv, args = ['no-such-file.sql']) => spawnSync(process.execPath, [script, ...args], { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 20000 });

test('no LOCALDB and no --live: refused', () => {
  const r = run({ LOCALDB: '' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /refusing to write to LIVE without --live/);
});

test('LOCALDB=1 without the preload: refused (it would write to LIVE)', () => {
  const r = run({ LOCALDB: '1' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /LOCALDB=1 without the preload would write to LIVE/);
});

// Invariant (2026-10-30): a LOCAL apply starts check-grants.mjs, and that child must target the local copy too.
// Before the fix the child had no preload, read the live project from .env and contacted api.supabase.com.
// No real network: a stub server plays the local postgres-meta, and apply-sql-guard.blocker.mjs (in NODE_OPTIONS, so in
// the parent and in each child) refuses and records every live request that is not sent through the local preload.
for (const via of ['--import flag', 'NODE_OPTIONS (as rehearse-sql.mjs does)']) test(`LOCALDB=1 via ${via}: the grant check child targets the local copy, never live`, async () => {
  const { createServer } = await import('node:http');
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(join(tmpdir(), 'apply-sql-guard-'));
  const seen = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { seen.push(body); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('[]'); });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(join(dir, 'localdb.env'), `SUPABASE_URL=${base}\nSUPABASE_SERVICE_ROLE_KEY=local-key\nPGMETA_URL=${base}\n`);
  writeFileSync(join(dir, 'ok.sql'), 'select 1;');
  const log = join(dir, 'live-calls.txt');
  const blocker = pathToFileURL(join(here, 'apply-sql-guard.blocker.mjs')).href;
  const preload = pathToFileURL(join(here, 'localdb-preload.mjs')).href;
  // cwd is the temp dir: dotenv finds no .env, so the token and URL come from the test env only.
  // Async spawn: spawnSync would block this process, and the stub server runs in it.
  const child = spawn(process.execPath, [...(via === '--import flag' ? ['--import', preload] : []), script, join(dir, 'ok.sql')], {
    cwd: dir, timeout: 30000,
    env: { ...process.env, LOCALDB: '1', LOCALDB_ENV: join(dir, 'localdb.env'), LOCALDB_QUIET: '1', BLOCKER_LOG: log, NODE_OPTIONS: `--import=${blocker}${via === '--import flag' ? '' : ` --import=${preload}`}`, SUPABASE_ACCESS_TOKEN: 'test-token', SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co' },
  });
  const r = { stdout: '', stderr: '' };
  child.stdout.on('data', (c) => { r.stdout += c; });
  child.stderr.on('data', (c) => { r.stderr += c; });
  r.status = await new Promise((ok) => child.on('close', ok));
  await new Promise((ok) => server.close(ok));
  const live = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assert.equal(live, '', `a child tried to reach live:\n${live}\n${r.stdout}\n${r.stderr}`);
  assert.ok(seen.some((b) => b.includes('NO_RLS')), `the grant check never reached the local copy\n${r.stdout}\n${r.stderr}`);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
