/**
 * Ensure the Supabase `card_rarity` enum contains every tier defined in
 * src/rarity.js. Run this after you add a tier to TIERS:
 *
 *   npm run sync-tiers
 *
 * It adds any missing enum value (ALTER TYPE ... ADD VALUE) and reloads the
 * PostgREST schema, so a pushed card with the new tier will not fail. It never
 * removes a value. Needs SUPABASE_ACCESS_TOKEN + SUPABASE_URL in .env.
 */
import dotenv from 'dotenv';
import { ORDER } from '../src/rarity.js';

// override:true so this project's .env wins over any ambient SUPABASE_ACCESS_TOKEN
// in the shell (a different account's token there would 403 this project).
dotenv.config({ override: true });

const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.SUPABASE_URL || '';
const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1];

if (!token) { console.error('Missing SUPABASE_ACCESS_TOKEN in .env'); process.exit(1); }
if (!ref) { console.error('Could not read the project ref from SUPABASE_URL'); process.exit(1); }

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(body)}`);
  return body;
}

const existing = new Set(
  (await query(
    "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='card_rarity';",
  )).map((row) => row.enumlabel),
);

const missing = ORDER.filter((k) => !existing.has(k));
if (!missing.length) {
  console.log(`card_rarity is up to date (${ORDER.length} tiers).`);
} else {
  for (const key of missing) {
    await query(`ALTER TYPE card_rarity ADD VALUE IF NOT EXISTS '${key}';`);
    console.log(`+ added enum value: ${key}`);
  }
  await query("NOTIFY pgrst, 'reload schema';");
  console.log('Reloaded the PostgREST schema.');
}
