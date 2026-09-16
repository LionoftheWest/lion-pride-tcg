import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in card-studio/.env');
}

export const supabase = createClient(url, key, { auth: { persistSession: false } });
