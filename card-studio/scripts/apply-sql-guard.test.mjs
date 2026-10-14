// The guards of apply-sql.mjs refuse before any network call (2026-10-14: LOCALDB=1 without the preload applied a file LIVE).
//   node --test scripts/apply-sql-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
