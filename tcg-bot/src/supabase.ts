import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Return the Supabase client, creating it on first use.
 * The client is created lazily so that scripts which only need the command
 * definitions (for example `npm run deploy`) do not require the Supabase env.
 * The bot uses the service role key, which bypasses row level security.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See .env.example.',
    );
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}
