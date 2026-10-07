/**
 * The table list of the Admin view Data page: read from the generated docs (docs/data/*.md, gen-data-docs.mjs).
 * The documented tables ARE the allowlist: a table that is not in the docs cannot be read through /api/admin/table.
 * Each table: name, group (the docs page title), note (the COMMENT ON), columns (name, type, comment), pk (columns).
 *
 * Secrets: no documented table holds a key or a password. As a second wall, a column or a jsonb key whose name
 * says secret, token, password or salt is shown as "[hidden]", and in the settings table a list of member ids is
 * shown as a count only (redactRow).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadTableCatalog(dir) {
  const tables = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()) {
    const md = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    const group = (/^# (.+)$/m.exec(md) || [, file])[1].trim();
    const parts = md.split(/\n<a id="table-[^"]+"><\/a>\n/).slice(1);
    for (const part of parts) {
      const name = (/^### ([a-z0-9_]+)\s*$/m.exec(part) || [])[1];
      if (!name) continue;
      const body = part.split(/\n<a id="fn-/)[0].split(/\n## Functions/)[0];
      const note = (/^\s*### [a-z0-9_]+\n\n([^\n]+)/.exec(body) || [, ''])[1].replace(/^Table\.\s*/, '').trim();
      const columns = [];
      for (const line of body.split('\n')) {
        const m = /^\| `([a-z0-9_]+)` \| ([^|]+) \| ([^|]+) \| ([^|]*) \| (.*) \|$/.exec(line);
        if (m) columns.push({ name: m[1], type: m[2].trim(), nullable: m[3].trim() === 'null', comment: m[5].trim() });
      }
      const pkm = /Primary key: `PRIMARY KEY \(([^)]+)\)`/.exec(body);
      const pk = pkm ? pkm[1].split(',').map((s) => s.trim()) : [];
      tables.push({ name, group, note, columns, pk });
    }
  }
  return tables;
}

const SECRET = /(secret|token|password|passwd|salt|api_?key|private_?key)/i;
const ID_LIKE = /^\d{15,21}$/;

// A jsonb value with the secrets hidden and member-id lists cut to a count.
export function redactValue(v, depth = 0) {
  if (depth > 20) return '[too deep]';
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => (typeof x === 'string' || typeof x === 'number') && ID_LIKE.test(String(x)))) return `[${v.length} member ids]`;
    return v.map((x) => redactValue(x, depth + 1));
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (SECRET.test(k)) o[k] = '[hidden]';
      else if (ID_LIKE.test(k)) { o['[member id]'] = (o['[member id]'] || 0) + 1; } // an object keyed by member ids: count only
      else o[k] = redactValue(x, depth + 1);
    }
    return o;
  }
  return v;
}

export function redactRow(table, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET.test(k)) out[k] = '[hidden]';
    else if (table === 'settings' && k === 'value') out[k] = redactValue(v);
    else out[k] = v && typeof v === 'object' ? redactValue(v) : v;
  }
  return out;
}
