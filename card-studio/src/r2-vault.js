// R2-MOVE: the R2 write key, read from the local DPAPI vault (C:\Users\vaugh\.secrets\vault.ps1, CurrentUser scope).
// Only Nathan's Windows user can decrypt it, on his PC only. No R2 value is in any .env, in the repo, or on a host (I-6).
// readR2Vault() -> { accountId, accessKeyId, secretAccessKey, bucket }. It never prints a value.
// No vault (no script, no entry, or no powershell: CI, another user) = 'refused: R2 vault missing (<path>)'.
// Env: R2_VAULT_SCRIPT (the script path; tests point it at a missing file), R2_ACCOUNT_ID, R2_BUCKET (not secret).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const DEFAULT_VAULT_SCRIPT = 'C:/Users/vaugh/.secrets/vault.ps1';
export const DEFAULT_ACCOUNT_ID = '7c9477dba9f1b5d76a48475dda1ae71a'; // not a secret: it is in every R2 S3 endpoint name
export const DEFAULT_BUCKET = 'lptcg-media';
export const ENTRY_KEY_ID = 'r2-access-key-id';
export const ENTRY_SECRET = 'r2-secret-access-key';

export function vaultScript(env = process.env) {
  return env.R2_VAULT_SCRIPT || DEFAULT_VAULT_SCRIPT;
}

/** One vault entry (the value only, no line end). Throws the refusal; the message never holds the value. */
export function vaultGet(name, { env = process.env, exec = execFileSync } = {}) {
  const script = vaultScript(env);
  if (!existsSync(script)) throw new Error(`refused: R2 vault missing (${script})`);
  let out;
  try {
    out = exec('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'get', name],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch {
    throw new Error(`refused: R2 vault missing (${script} ${name})`);
  }
  const v = String(out).replace(/[\r\n]+/g, '').trim();
  if (!v) throw new Error(`refused: R2 vault missing (${script} ${name})`);
  return v;
}

export function readR2Vault({ env = process.env, exec = execFileSync } = {}) {
  return {
    accountId: env.R2_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
    accessKeyId: vaultGet(ENTRY_KEY_ID, { env, exec }),
    secretAccessKey: vaultGet(ENTRY_SECRET, { env, exec }),
    bucket: env.R2_BUCKET || DEFAULT_BUCKET,
  };
}
