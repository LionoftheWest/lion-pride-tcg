/**
 * Apply a .sql file to the PERSONAL Supabase project via the Management API.
 *   node scripts/apply-sql.mjs <path-to.sql>
 * Uses SUPABASE_ACCESS_TOKEN + SUPABASE_URL from this project's .env (override:true
 * so the personal token wins over any ambient work-account token).
 */
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';

dotenv.config({ override: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];
const file = process.argv[2];

if (!token) { console.error('Missing SUPABASE_ACCESS_TOKEN in .env'); process.exit(1); }
if (!ref) { console.error('Could not read the project ref from SUPABASE_URL'); process.exit(1); }
if (!file) { console.error('Usage: node scripts/apply-sql.mjs <path-to.sql>'); process.exit(1); }

const sql = readFileSync(file, 'utf8');
const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const body = await r.json().catch(() => ({}));
if (!r.ok) { console.error(`FAILED ${r.status}:`, JSON.stringify(body)); process.exit(1); }
console.log('OK', r.status, JSON.stringify(body).slice(0, 300));
