/**
 * NO-SERVER (option B): the bot's home host, settings.bot_home (tcg-bot/supabase/bot_home.sql).
 *
 *   node scripts/bot-home.mjs                       print bot_home_state(): {home, age_s} (read-only)
 *   node scripts/bot-home.mjs office --go           move the home to "office" (Nathan's GO only, NO-SERVER 4.5 M-BOT)
 *   node scripts/bot-home.mjs backup --go           move the home back to "backup"
 *
 * This is the ONLY writer of the row: the trigger settings_bot_home_check refuses every write without the session
 * setting lptcg.bot_home_writer = 'bot-home.mjs', which this script sets inside the same single statement (one
 * autocommit statement, so updated_at = the time of the write). The Admin settings editor cannot move the bot.
 * ops/deploy.sh deploys the bot only to the host that the row names. Follow the M-BOT order (spec 4.5): the old bot
 * is stopped BEFORE a move to the office, and the move back starts with "docker stop tcg-bot" on the office.
 * It acts on the database that .env points to (the LIVE project). Local copy: LOCALDB=1 with the preload.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { pathToFileURL } from 'node:url';

const q = async (sql) => {
  const t = process.env.SUPABASE_ACCESS_TOKEN, ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)/)?.[1];
  if (!t || !ref) throw new Error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_URL in .env');
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
  return j;
};

// The one write statement. set_config in the WHERE runs for the bot_home row before its BEFORE UPDATE trigger, and
// is_local = true ends the setting with this statement's transaction. Exported for test-bot-home.mjs (C9).
export const writeSql = (home) => {
  if (!['backup', 'office'].includes(home)) throw new Error(`bot-home: the home must be backup or office (got ${home})`);
  return `update public.settings set value = '"${home}"'::jsonb where key = 'bot_home' and set_config('lptcg.bot_home_writer', 'bot-home.mjs', true) is not null returning value #>> '{}' as home;`;
};

const main = async () => {
  const [home] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const show = async (label) => console.log(`${label}: ${JSON.stringify((await q('select public.bot_home_state() as s;'))[0]?.s ?? null)}`);
  await show('bot_home_state()');
  if (!home) return;
  if (!process.argv.includes('--go')) {
    console.log(`Not changed. Moving the bot home to "${home}" needs --go (Nathan's GO, NO-SERVER 4.5 M-BOT).`); process.exit(2);
  }
  const rows = await q(writeSql(home));
  if (rows.length !== 1 || rows[0].home !== home) { console.error(`bot-home: the write changed ${rows.length} rows (the row is missing?)`); process.exit(1); }
  await show('after');
  console.log(`bot_home = ${home}. A bot deploy to "${home}" waits until age_s >= 130 (TARGET=${home} ops/deploy.sh bot).`);
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
