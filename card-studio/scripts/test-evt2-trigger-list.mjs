/**
 * EVT-2 C14 (items/EVT-2/SPEC.md v2.4): the Studio editor trigger list = the SQL trigger list. No database, no jsdom.
 *   node scripts/test-evt2-trigger-list.mjs [<events.js>] [<event_shape_errors.sql>]
 * Defaults: card-studio/public/admin/events.js and db/schema/functions/event_shape_errors.sql (generated: run the schema
 * snapshot after a change of the SQL function). The SQL list is read only inside the 4-argument function block (the text
 * before the line "-- @function public.event_shape_errors(text, jsonb, jsonb, jsonb, jsonb, jsonb)"), after
 * "coalesce(p_rules->>'trigger', '') not in (". Why: the editor <select> shows only the TRIGGERS ids, so an unknown SQL
 * trigger shows as the first option and a save changes it.
 * Prints "TRIGGERS PASS <ids>" or "TRIGGERS FAIL missing <id>" (in SQL, not in the editor) / "TRIGGERS FAIL extra <id>" (in the editor, not in SQL).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const jsFile = process.argv[2] || join(root, 'card-studio', 'public', 'admin', 'events.js');
const sqlFile = process.argv[3] || join(root, 'db', 'schema', 'functions', 'event_shape_errors.sql');

const js = readFileSync(jsFile, 'utf8');
const line = js.split(/\r?\n/).find((l) => /^const TRIGGERS = \[/.test(l));
if (!line) { console.log('TRIGGERS FAIL no "const TRIGGERS = [" line in ' + jsFile); process.exit(1); }
const editor = [...line.matchAll(/\[\s*'([a-z_]+)'\s*,\s*'[^']*'\s*\]/g)].map((m) => m[1]);

const sql = readFileSync(sqlFile, 'utf8');
const stop = '-- @function public.event_shape_errors(text, jsonb, jsonb, jsonb, jsonb, jsonb)';
const block = sql.includes(stop) ? sql.slice(0, sql.indexOf(stop)) : sql;
const anchor = "coalesce(p_rules->>'trigger', '') not in (";
const i = block.indexOf(anchor);
if (i < 0) { console.log('TRIGGERS FAIL no trigger list in the 4-argument block of ' + sqlFile); process.exit(1); }
const list = block.slice(i + anchor.length, block.indexOf(')', i + anchor.length));
const db = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const missing = db.filter((x) => !editor.includes(x));
const extra = editor.filter((x) => !db.includes(x));
for (const x of missing) console.log(`TRIGGERS FAIL missing ${x}`);
for (const x of extra) console.log(`TRIGGERS FAIL extra ${x}`);
if (!editor.length || !db.length) console.log('TRIGGERS FAIL an empty list');
if (missing.length || extra.length || !editor.length || !db.length) process.exit(1);
console.log(`TRIGGERS PASS ${[...db].sort().join(', ')} (editor ${editor.length} = SQL ${db.length})`);
