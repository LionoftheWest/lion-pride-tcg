/**
 * Set (or change) the password of the backup role lptcg_backup, and put it on the VM.
 *   node scripts/set-backup-password.mjs            (live project + the VM)
 * The password is never printed, never written to this computer, and never in the repo:
 *   1. a new random password (32 bytes);
 *   2. over ssh (on stdin, not in the command line) it goes to the VM as
 *      /home/ubuntu/backups/.pgpass.new (mode 600, dir 700);
 *   3. ALTER ROLE through the Management API with a SCRAM-SHA-256 verifier, not the password
 *      itself, so the statement text (which Postgres can log) does not hold the password;
 *   4. on the VM, .pgpass.new replaces .pgpass. If step 3 fails, .pgpass.new is deleted and the
 *      old password still works.
 * Run it again to change the password. Options (for the local test):
 *   --pgpass-file <path>   write the pgpass line to this file (mode 600) instead of the VM
 *   --host <h> --port <p> --user <u>   the pgpass line (default: the Supavisor session pooler)
 */
import dotenv from 'dotenv';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve4 } from 'node:dns/promises';
import { writeFileSync, chmodSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROLE = 'lptcg_backup';

// The verifier Postgres stores for SCRAM-SHA-256 (RFC 5802 / RFC 7677, the pg_authid format).
// ALTER ROLE ... PASSWORD '<verifier>' stores it as it is; a login with the plain password works.
export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

// base64url has no ':' or '\', the two characters with a meaning in a pgpass line.
export const newPassword = () => randomBytes(32).toString('base64url');

export const pgpassLine = ({ host, port, db = 'postgres', user, password }) => `${host}:${port}:${db}:${user}:${password}\n`;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  dotenv.config({ override: true });
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = ((process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
  if (!token || !ref) throw new Error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL in .env');

  const sql = async (query) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`SQL failed ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  };

  const exists = await sql(`select count(*)::int n from pg_roles where rolname = '${ROLE}'`);
  if (!exists?.[0]?.n) throw new Error(`No role ${ROLE}: apply tcg-bot/supabase/backup_role.sql first`);

  const password = newPassword();
  const line = pgpassLine({
    host: arg('host', 'aws-0-us-east-1.pooler.supabase.com'),
    port: arg('port', '5432'),
    user: arg('user', `${ROLE}.${ref}`),
    password,
  });
  const file = arg('pgpass-file');

  let ssh = null;
  if (file) {
    if (/supabase\.co/.test(String(process.env.SUPABASE_URL)) && process.env.LOCALDB !== '1') throw new Error('--pgpass-file is for the LOCAL test only (LOCALDB=1)');
    writeFileSync(`${file}.new`, line, { mode: 0o600 });
    chmodSync(`${file}.new`, 0o600);
  } else {
    const host = 'lionpridetcg.duckdns.org';
    const [ip] = await resolve4(host);
    if (!ip) throw new Error(`cannot resolve ${host}`);
    const key = process.env.KEY || join(homedir(), 'Downloads', 'ssh-key-2026-09-08.key');
    ssh = (cmd, input) => {
      const r = spawnSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', `ubuntu@${ip}`, cmd], { input, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`ssh failed (${r.status}): ${(r.stderr || '').trim().slice(0, 300)}`);
      return r.stdout;
    };
    ssh('umask 077; mkdir -p ~/backups && chmod 700 ~/backups && cat > ~/backups/.pgpass.new && chmod 600 ~/backups/.pgpass.new', line);
    console.log(`1. the new password file is on the VM (${ip}, ~/backups/.pgpass.new, 600)`);
  }

  try {
    await sql(`alter role ${ROLE} with password '${scramVerifier(password)}'`);
    console.log(`2. ${ROLE}: the new password is set (stored as a SCRAM-SHA-256 verifier)`);
  } catch (error) {
    if (ssh) ssh('rm -f ~/backups/.pgpass.new', '');
    throw error;
  }

  if (ssh) {
    console.log(`3. ${ssh('mv -f ~/backups/.pgpass.new ~/backups/.pgpass && stat -c "%a %n" ~/backups/.pgpass', '').trim()}`);
  } else {
    renameSync(`${file}.new`, file);
    console.log(`3. wrote ${file} (local test mode)`);
  }
  console.log(`Done. The password was not printed${file ? '' : ' or stored on this computer'}. Test: ~/backups/bin/backup.sh on the VM.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });
}
