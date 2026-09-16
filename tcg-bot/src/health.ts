import 'dotenv/config';
import { getSupabase } from './supabase.js';

// A safe pre-flight check. It reports whether each secret is present and whether
// the Supabase connection and schema work. It never prints a secret value.
//   npm run health

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

console.log('Environment:');
let missing = 0;
for (const name of required) {
  const ok = Boolean(process.env[name]);
  if (!ok) missing += 1;
  console.log(`  ${name}: ${ok ? 'set' : 'MISSING'}`);
}

console.log('\nSupabase:');
try {
  // A plain GET (not head) so Supabase returns a real error message on failure.
  const { data, error } = await getSupabase()
    .from('cards')
    .select('id')
    .limit(1);
  if (error) throw error;
  console.log(`  connected. The cards table is readable (${data.length} sample row).`);
} catch (error) {
  const err = error as Record<string, unknown> & { cause?: unknown };
  const message =
    (err?.message as string) ||
    (err?.error_description as string) ||
    (err?.code as string) ||
    '(no message)';
  console.log(`  FAILED — ${message}`);
  console.log(
    '  Detail:',
    JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})),
  );
  if (err?.cause) console.log('  Cause:', String(err.cause));
  console.log('  If the error mentions a missing relation, run supabase/schema.sql.');
}

if (missing > 0) {
  console.log(`\n${missing} value(s) are missing from .env.`);
  process.exit(1);
}
