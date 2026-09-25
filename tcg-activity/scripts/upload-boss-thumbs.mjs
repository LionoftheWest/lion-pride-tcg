import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'node:fs';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const dir = 'preview/thumbs';
let ok = 0, fail = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.png'))) {
  const buf = readFileSync(`${dir}/${f}`);
  let error = null;
  for (let a = 1; a <= 4; a++) { ({ error } = await sb.storage.from('card-art').upload(`boss/thumbs/${f}`, buf, { contentType: 'image/png', upsert: true })); if (!error) break; await new Promise(r => setTimeout(r, 700 * a)); }
  if (error) { console.log('ERR', f, error.message); fail++; } else { console.log('ok', f, Math.round(buf.length/1024)+'KB'); ok++; }
}
console.log(`DONE thumbs uploaded=${ok} failed=${fail}`);
process.exit(fail ? 1 : 0);
