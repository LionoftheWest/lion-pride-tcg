/**
 * Generate the database documentation in docs/data/ from the catalog of a database (Nathan, 2026-10-03:
 * the database is the documented "brain"; the comments live in the database, these pages are made from them).
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/gen-data-docs.mjs     (from card-studio/)
 * Without LOCALDB=1 it reads the live catalog (read-only SELECTs). Use the local copy.
 *
 * It writes:
 *   docs/data/README.md                       what the pages are, how to make them again, the index and the coverage
 *   docs/data/<domain>.md                     one page per domain (DOMAINS below): tables and functions
 *   docs/data/balance.md                      every balance key: the note, the shape, the current value
 * It reads ONLY the catalog (names, types, constraints, policies, comments) and the balance table (game numbers).
 * It never reads a member row, a row count or a function body. The output is sorted and has LF line endings,
 * so a second run with no database change gives no diff (test-db-docs.mjs checks that every table is listed).
 */
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const OUT = fileURLToPath(new URL('../../docs/data/', import.meta.url));
const ref = (process.env.SUPABASE_URL || '').match(/https:\/\/([a-z0-9]+)/)?.[1];
if (!ref || !process.env.SUPABASE_ACCESS_TOKEN) { console.error('gen-data-docs: SUPABASE_URL and SUPABASE_ACCESS_TOKEN are needed in card-studio/.env'); process.exit(2); }
const q = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`query failed: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};

// ---- The domains. An explicit name wins over a prefix. Anything not mapped goes to "other". ----
const DOMAINS = [
  { slug: 'cards-and-trading', title: 'Cards and trading', about: 'The card catalog, the copies that members hold, packs, the ledgers, trades, the Trading Hall, auctions, wishlists, gifts, stars and stat points, collection power.',
    names: ['cards', 'subjects', 'player_cards', 'card_ledger', 'pack_ledger', 'card_trades', 'trade_listings', 'trade_offers', 'auctions', 'auction_bids', 'wishlists', 'wish_grants', 'gift_claims', 'artist_submissions', 'roster_power_history',
      'accept_bid', 'accept_trade', 'add_card_to_player', 'add_cards_to_player', 'ascend_card', 'ascend_cost', 'claim_gift', 'close_auction', 'confirm_bid', 'convert_dupes', 'convertible_copies', 'counter_trade', 'create_trade', 'create_trade_open',
      'decline_accepted_bid', 'expire_auctions', 'free_copies', 'give_card_gift', 'launch_player_gift', 'launch_raider_gift', 'list_for_trade', 'my_collection_power', 'offer_on_listing', 'open_packs', 'pack_ledger_reconcile', 'place_bid', 'rarity_rank',
      'remove_card_from_player', 'reset_stat_points', 'return_bids', 'set_launch_player_card', 'set_trade_status', 'set_wish_top', 'set_wishlist', 'spend_pack', 'spend_stat_points', 'start_auction', 'subjects_flatten_tags', 'top_collection_power',
      'unlist_for_trade', 'welcome_packs', 'withdraw_bid', 'draw_pool', 'pullable_sets', 'season_number'],
    prefixes: ['card_', 'cards_', 'trade_', 'auction_', 'wish', 'gift_card', 'gift_packs', 'grant_packs', 'stat_', 'roster_', 'collection_power'] },
  { slug: 'hunt-and-combat', title: 'Hunt and combat', about: 'The weekly Hunt (raid boss), squads, the combat rules, the logs of each fight, pranks, boons and the Discord effects.',
    names: ['hunts', 'combat_actions', 'card_plays', 'card_effect_cooldowns', 'player_effects', 'discord_effects', 'effect_primitives',
      'adventure_gate', 'arm_on_open', 'arm_player_effects', 'card_combat', 'card_effect_active', 'card_element', 'element_aliases', 'element_of', 'card_max_hp', 'close_due_hunts', 'close_hunt', 'close_weekly_boss', 'daily_raid_board', 'deployable_power', 'effect_preview', 'effect_preview_card', 'lock_hunt_squad',
      'next_hunt_close', 'next_hunt_spawn', 'nudge_hunt', 'play_card_effect', 'play_card_effect_choice', 'refund_card_play', 'settle_hunt', 'spawn_hunt', 'spawn_weekly_boss', 'take_player_effect', 'use_effect_charge',
      'weekly_boss_tick'],
    prefixes: ['hunt_', 'combat_'] },
  { slug: 'dungeon-shards-achievements', title: 'Dungeon, Shards and achievements', about: 'The daily Dungeon, the weekly Gauntlet, the Shards and the Shop, the achievement tracks.',
    names: ['shard_ledger', 'grant_shards', 'buy_shop_item', 'claim_achievement', 'claim_achievement_tiers', 'give_shards_gift_all'],
    prefixes: ['dungeon_', 'gauntlet_', 'shard_', 'shop_', 'ach_', 'achievement_'] },
  { slug: 'members-and-platform', title: 'Members and platform', about: 'Members, the Dailies, the bell notes, reports, the app logs (visits, screen views, walkthrough steps, server joins), the balance numbers, the flags and the platform jobs.',
    names: ['players', 'daily_activity', 'daily_claims', 'voice_minutes', 'notifications', 'playing_posts', 'player_reports', 'settings', 'balance', 'balance_log', 'schema_migrations',
      'add_voice_minutes', 'bot_work', 'checkin_streak', 'claim_daily', 'claim_daily_earn', 'claim_first_pack_ping', 'claim_tutorial_reward', 'dailies_tasks', 'dailies_view', 'earned_today', 'game_day', 'game_day_start', 'gift_all_members', 'give_gift', 'give_gift_all',
      'notify_player', 'playing_today', 'prune_old_rows', 'record_activity', 'rls_auto_enable', 'streak_shield_waiting', 'submit_report',
      'app_sessions', 'app_session_touch', 'tutorial_steps', 'page_views', 'guild_joined', 'guild_left',
      'settings_log', 'settings_log_write', 'profile_log', 'profile_log_write'],
    prefixes: ['balance_', 'ledger_'] },
  { slug: 'admin', title: 'Admin view', about: 'The read only functions of the Admin view in the card studio (admin_read.sql, /api/admin/*): metrics, the economy, growth, members and their history, cards, Hunts, data health and reports. Only the service role can call them. Also the admin audit log (admin_actions, admin_log_action, the gift_admin_log trigger).',
    names: ['gift_admin_log'], prefixes: ['admin_'] },
  { slug: 'events', title: 'Events', about: 'The Events system (events.sql): the events with their audience, rewards and rules, the change log, the payouts, the pg_cron job event-tick that starts, pays and ends them through the bell gifts (gift_claims.event_id). The Admin view functions (admin_event*) are on the Admin page.',
    names: ['events', 'events_touch', 'gift_claims_event_link'], prefixes: ['event_'] },
];
const OTHER = { slug: 'other', title: 'Other', about: 'Tables and functions that the domain map in gen-data-docs.mjs does not place yet. Add each one to a domain.', names: [], prefixes: [] };
const domainOf = (name) => DOMAINS.find((d) => d.names.includes(name)) || DOMAINS.find((d) => d.prefixes.some((p) => name.startsWith(p))) || OTHER;

// ---- The catalog. ----
const tables = await q(`
  select c.relname as name, c.relkind as kind, c.relrowsecurity as rls, c.relforcerowsecurity as rls_force,
         obj_description(c.oid, 'pg_class') as comment,
         coalesce((select json_agg(p.polname order by p.polname) from pg_policy p where p.polrelid = c.oid), '[]'::json) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
   order by c.relname`);
const columns = await q(`
  select c.relname as tbl, a.attnum as num, a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
         pg_get_expr(d.adbin, d.adrelid) as def, col_description(c.oid, a.attnum) as comment
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
   order by c.relname, a.attnum`);
const constraints = await q(`
  select c.relname as tbl, k.conname as name, k.contype as type, pg_get_constraintdef(k.oid) as def,
         case when k.contype = 'f' then k.confrelid::regclass::text end as ref
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and k.contype in ('p', 'f', 'c', 'u')
   order by c.relname, k.contype, k.conname`);
const functions = await q(`
  select p.proname as name, p.oid::regprocedure::text as ident, pg_get_function_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as returns, p.prosecdef as secdef, p.prokind as kind,
         obj_description(p.oid, 'pg_proc') as comment
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
   order by p.proname, p.oid::regprocedure::text`);
const balanceCols = await q(`select a.attname as name from pg_attribute a where a.attrelid = 'public.balance'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`);
const balanceTriggers = await q(`
  select t.tgname as name, p.oid::regprocedure::text as fn, obj_description(p.oid, 'pg_proc') as comment
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.balance'::regclass and not t.tgisinternal order by t.tgname`);

// ---- Helpers. ----
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cell = (s) => (s == null || s === '' ? '' : String(s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|'));
const text = (s) => (s == null || s === '' ? '_No comment._' : String(s).replace(/\r\n/g, '\n'));
const code = (s) => '`' + String(s).replace(/`/g, "'") + '`';
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const KIND = { r: 'Table', p: 'Partitioned table', v: 'View', m: 'Materialized view' };
const anchor = (prefix, s) => `${prefix}-${s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}`;
const write = (file, lines) => writeFileSync(join(OUT, file), lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n');
const HEAD = (title) => [`# ${title}`, '', '> Generated by `card-studio/scripts/gen-data-docs.mjs` from the database catalog. Do not edit this file by hand: change the', '> `COMMENT ON` in a migration, apply it, and run the generator again.', ''];

const colsBy = new Map(), consBy = new Map();
for (const c of columns) { if (!colsBy.has(c.tbl)) colsBy.set(c.tbl, []); colsBy.get(c.tbl).push(c); }
for (const k of constraints) { if (!consBy.has(k.tbl)) consBy.set(k.tbl, []); consBy.get(k.tbl).push(k); }

// ---- One page per domain. ----
const pages = [...DOMAINS, OTHER].map((d) => ({ ...d, tables: tables.filter((t) => domainOf(t.name) === d), functions: functions.filter((f) => domainOf(f.name) === d) }));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.md')) unlinkSync(join(OUT, f)); // a removed domain leaves no old page

const stats = [];
for (const d of pages) {
  if (d.slug === OTHER.slug && !d.tables.length && !d.functions.length) continue;
  const L = [...HEAD(d.title), d.about, ''];
  L.push('## Contents', '', `Tables (${d.tables.length}): ${d.tables.map((t) => `[${t.name}](#${anchor('table', t.name)})`).join(', ') || 'none'}`, '',
    `Functions (${d.functions.length}): ${d.functions.map((f) => `[${f.ident}](#${anchor('fn', f.ident)})`).join(', ') || 'none'}`, '');
  let cols = 0, colsDone = 0;
  if (d.tables.length) L.push('## Tables', '');
  for (const t of d.tables) {
    const cs = colsBy.get(t.name) || [], ks = consBy.get(t.name) || [];
    cols += cs.length; colsDone += cs.filter((c) => c.comment).length;
    L.push(`<a id="${anchor('table', t.name)}"></a>`, '', `### ${t.name}`, '', `${KIND[t.kind] || t.kind}. ${text(t.comment)}`, '');
    L.push('| Column | Type | Null | Default | Comment |', '|---|---|---|---|---|');
    for (const c of cs) L.push(`| ${code(c.name)} | ${cell(c.type)} | ${c.notnull ? 'not null' : 'null'} | ${c.def == null ? '' : code(cell(c.def))} | ${cell(c.comment)} |`);
    L.push('');
    const pk = ks.filter((k) => k.type === 'p'), uq = ks.filter((k) => k.type === 'u'), fk = ks.filter((k) => k.type === 'f'), ck = ks.filter((k) => k.type === 'c');
    L.push(`- Primary key: ${pk.map((k) => code(k.def)).join(', ') || 'none'}`);
    if (uq.length) L.push(`- Unique: ${uq.map((k) => `${code(k.name)} ${code(k.def)}`).join(', ')}`);
    L.push(`- Foreign keys: ${fk.length ? '' : 'none'}`);
    for (const k of fk) L.push(`  - ${code(k.name)} to [${k.ref}](${domainOf(k.ref.replace(/^public\./, '')).slug}.md#${anchor('table', k.ref.replace(/^public\./, ''))}): ${code(k.def)}`);
    L.push(`- Check constraints: ${ck.length ? '' : 'none'}`);
    for (const k of ck) L.push(`  - ${code(k.name)}: ${code(k.def)}`);
    const pol = t.policies || [];
    L.push(`- Row level security: ${t.rls ? 'on' : 'OFF'}${t.rls_force ? ' (forced)' : ''}. Policies: ${pol.length ? pol.map(code).join(', ') : 'none'}`, '');
  }
  if (d.functions.length) L.push('## Functions', '');
  for (const f of d.functions) {
    const kind = f.kind === 'p' ? 'Procedure' : f.kind === 'a' ? 'Aggregate' : f.kind === 'w' ? 'Window function' : 'Function';
    L.push(`<a id="${anchor('fn', f.ident)}"></a>`, '', `### ${f.ident}`, '', `- ${kind}: ${code(`${f.name}(${f.args})`)}`, `- Returns: ${code(f.returns || 'void')}`,
      `- Security definer: ${f.secdef ? 'yes' : 'no'}`, '', text(f.comment), '');
  }
  write(`${d.slug}.md`, L);
  stats.push({ d, tables: d.tables.length, tablesDone: d.tables.filter((t) => t.comment).length, cols, colsDone,
    fns: d.functions.length, fnsDone: d.functions.filter((f) => f.comment).length });
}

// ---- balance.md: the game numbers. Refuse anything that could be member data. ----
const BAL_COLS = ['key', 'value', 'note'];
const balCols = balanceCols.map((c) => c.name);
for (const c of BAL_COLS) if (!balCols.includes(c)) throw new Error(`balance has no column ${c}: read the table again before this page is made`);
const balLinks = constraints.filter((k) => k.tbl === 'balance' && k.type === 'f');
if (balLinks.length) throw new Error(`balance links to another table (${balLinks.map((k) => k.ref).join(', ')}): it may hold member data, the page is not made`);
const balance = (await q('select key, value, note from public.balance order by key')).sort((a, b) => cmp(a.key, b.key));
const leaves = (v, path = []) => (v !== null && typeof v === 'object'
  ? (Array.isArray(v) ? v.flatMap((x, i) => leaves(x, [...path, String(i)])) : Object.keys(v).sort().flatMap((k) => leaves(v[k], [...path, k])))
  : [{ path, v }]);
for (const b of balance) for (const l of leaves(b.value)) {
  if (typeof l.v === 'string' && /^\d{17,20}$/.test(l.v)) throw new Error(`balance ${b.key}.${l.path.join('.')} looks like a Discord id: the page is not made`);
}
const shape = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) { const inner = [...new Set(v.map(shape))]; return `array(${v.length}) of ${inner.length === 1 ? inner[0] : inner.join(' | ') || 'nothing'}`; }
  if (typeof v === 'object') return `object { ${Object.keys(v).sort().map((k) => `${k}: ${shape(v[k])}`).join(', ')} }`;
  return typeof v;
};
const B = [...HEAD('Balance numbers'),
  'Every number that changes card power, combat or rewards is in the `balance` table (one row per key). The SQL functions read it with',
  '`balance_get` and `balance_num`. The Activity and the bot read it with a 60 s cache. Each change writes a `balance_log` row.',
  'The values below are the values of the database that made this page.', '',
  '## The rules for a change', '', 'The triggers on `balance` check each change:', ''];
for (const t of balanceTriggers) B.push(`- ${code(t.name)} (${code(t.fn)}): ${cell(t.comment) || '_No comment._'}`);
B.push('', `- The shape of a value stays the same: an update cannot remove a leaf or change its type (see ${code('balance_check')}).`, '', '## Keys', '',
  balance.map((b) => `[${b.key}](#${anchor('key', b.key)})`).join(', '), '');
for (const b of balance) {
  B.push(`<a id="${anchor('key', b.key)}"></a>`, '', `### ${b.key}`, '', text(b.note), '', `Shape: ${code(shape(b.value))}`, '', '```json', JSON.stringify(b.value, null, 2), '```', '');
}
write('balance.md', B);

// ---- README.md: the index and the coverage. ----
const sum = (k) => stats.reduce((a, s) => a + s[k], 0);
const R = [...HEAD('Database documentation'),
  'These pages describe the PUBLIC schema of the Lion Pride TCG Supabase database: each table with its columns, keys, checks and row level',
  'security, and each function with its signature. The text comes from the `COMMENT ON` of each object (the migrations in',
  '`tcg-bot/supabase/`, most of them in `tcg-bot/supabase/db_comments.sql`). The pages hold no member data, no row counts and no function bodies.', '',
  '## Make the pages again', '',
  'Run this from `card-studio/` on the local copy (the Supabase CLI stack in WSL), after you apply the migrations:', '',
  '```sh', 'LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/gen-data-docs.mjs', '```', '',
  'Then commit the changed pages. `scripts/test-db-docs.mjs` (in `test-all-local.mjs`) fails when a table, a column or a function has no',
  'comment, or when a table or a function is not on these pages.', '',
  '## Domains', '', '| Page | Tables | Tables with a comment | Columns with a comment | Functions | Functions with a comment |', '|---|---|---|---|---|---|'];
for (const s of stats) R.push(`| [${s.d.title}](${s.d.slug}.md) | ${s.tables} | ${s.tablesDone} (${pct(s.tablesDone, s.tables)}) | ${s.colsDone} of ${s.cols} (${pct(s.colsDone, s.cols)}) | ${s.fns} | ${s.fnsDone} (${pct(s.fnsDone, s.fns)}) |`);
R.push(`| **All** | ${sum('tables')} | ${sum('tablesDone')} (${pct(sum('tablesDone'), sum('tables'))}) | ${sum('colsDone')} of ${sum('cols')} (${pct(sum('colsDone'), sum('cols'))}) | ${sum('fns')} | ${sum('fnsDone')} (${pct(sum('fnsDone'), sum('fns'))}) |`, '',
  `[Balance numbers](balance.md): ${balance.length} keys with the note, the shape and the current value.`, '');
write('README.md', R);
console.log(`docs/data: ${stats.length} domain pages, ${sum('tables')} tables, ${sum('fns')} functions, ${balance.length} balance keys`);
