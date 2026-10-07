/**
 * The Admin view data API (Phase 1, READ ONLY): GET /api/admin/* calls the admin_ SQL functions
 * (tcg-bot/supabase/admin_read.sql) with the service role and returns their small JSON answers.
 *
 * Protection (member data):
 *   - Flag ADMIN_VIEW=1 in card-studio/.env. Off (the default) = every /api/admin route answers 404.
 *   - The studio login (src/studio-auth.js) runs first in server.js and marks a request it let in (req.studioAuthed).
 *     Without it (this router alone, for example in a test): HTTP Basic Auth with STUDIO_USER / STUDIO_PASS on every
 *     request; with no STUDIO_PASS set, only a request from this PC (loopback) is served.
 *   - GET only, no-store, small JSON. The SQL functions page every list.
 * Also: GET /source (LIVE or LOCAL), /search (members, cards, tables), /tables and /table/:name (the Data page: only the
 * tables in docs/data, 50 rows a page, secrets hidden and member-id lists cut to a count: src/admin-tables.js).
 * Usage in server.js: app.use('/api/admin', adminRouter({ rpc: (fn, args) => supabase.rpc(fn, args), db: supabase }));
 */
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTableCatalog, redactRow } from './admin-tables.js';

const DOCS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'data');
export const TABLE_PAGE = 50;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

class BadRequest extends Error {}
const date = (v, name) => {
  if (v == null || v === '') return null;
  if (!DATE.test(String(v))) throw new BadRequest(`${name} must be YYYY-MM-DD`);
  return String(v);
};
const int = (v, name, min, max) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BadRequest(`${name} must be a whole number from ${min} to ${max}`);
  return n;
};
const text = (v, name, max) => {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.length > max) throw new BadRequest(`${name} is longer than ${max} characters`);
  return s;
};
const word = (v, name) => {
  const s = text(v, name, 40);
  if (s != null && !/^[a-z0-9_]+$/.test(s)) throw new BadRequest(`${name} has a character that is not allowed`);
  return s;
};
const stamp = (v, name) => {
  if (v == null || v === '') return null;
  if (Number.isNaN(Date.parse(String(v)))) throw new BadRequest(`${name} must be a time`);
  return String(v);
};

// One CSV cell. A cell that a spreadsheet could read as a formula (= + - @, tab, CR) gets a leading quote.
export const csvCell = (v) => {
  if (v == null) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (columns, rows) => [columns.map(csvCell).join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

// The report params from the query string: numbers stay numbers; every value is short.
const reportParams = (query) => {
  const p = {};
  for (const [k, v] of Object.entries(query)) {
    if (!/^[a-z_]{1,30}$/.test(k)) throw new BadRequest(`parameter ${k} is not allowed`);
    const s = text(v, k, 40);
    p[k] = s != null && /^-?\d+$/.test(s) ? Number(s) : s;
  }
  return p;
};

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function adminGate(env = process.env) {
  return (req, res, next) => {
    if (env.ADMIN_VIEW !== '1') return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'no-store');
    if (req.studioAuthed === true) return next();
    const pass = env.STUDIO_PASS || '';
    if (!pass) {
      if (LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for']) return next();
      return res.status(403).json({ error: 'Set STUDIO_PASS in card-studio/.env to open the Admin view from another device.' });
    }
    const expected = 'Basic ' + Buffer.from(`${env.STUDIO_USER || 'studio'}:${pass}`).toString('base64');
    if (!same(req.headers.authorization || '', expected)) {
      res.set('WWW-Authenticate', 'Basic realm="Card Studio Admin"');
      return res.status(401).json({ error: 'authentication required' });
    }
    return next();
  };
}

export function adminRouter({ rpc, db = null, env = process.env, docsDir = DOCS_DIR }) {
  if (typeof rpc !== 'function') throw new Error('adminRouter needs rpc(fn, args)');
  let catalog = null;
  const tables = () => (catalog ||= loadTableCatalog(docsDir));
  const r = express.Router();
  r.use(adminGate(env));
  r.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : res.status(405).json({ error: 'read only' })));

  const call = async (res, fn, args) => {
    const { data, error } = await rpc(fn, args);
    if (error) return res.status(400).json({ error: error.message || String(error) });
    return res.json(data);
  };
  const route = (path, fn, args) => r.get(path, async (req, res) => {
    try { return await call(res, fn, args(req)); } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'admin route failed' });
    }
  });

  r.get('/', (req, res) => res.json({ read_only: true, routes: [
    'GET /api/admin/overview?from&to', 'GET /api/admin/economy?from&to&bucket=day|week', 'GET /api/admin/growth?from&to',
    'GET /api/admin/members?search&sort&limit&offset', 'GET /api/admin/member/:id', 'GET /api/admin/member/:id/timeline?before&before_key&limit',
    'GET /api/admin/cards?from&to&sort&limit&offset', 'GET /api/admin/hunts?limit&offset', 'GET /api/admin/hunt/:id', 'GET /api/admin/health',
    'GET /api/admin/reports', 'GET /api/admin/report/:key?<params>', 'GET /api/admin/report/:key.csv?<params>',
    'GET /api/admin/source', 'GET /api/admin/search?q', 'GET /api/admin/tables', 'GET /api/admin/table/:name?offset&key'] }));

  r.get('/source', (req, res) => res.json({ source: env.LOCALDB === '1' ? 'LOCAL' : 'LIVE', login: Boolean(env.STUDIO_PASS) }));

  r.get('/tables', (req, res) => {
    try { return res.json({ tables: tables() }); } catch { return res.status(500).json({ error: 'the table docs could not be read' }); }
  });

  r.get('/table/:name', async (req, res) => {
    try {
      const t = tables().find((x) => x.name === req.params.name);
      if (!t) return res.status(404).json({ error: 'not a documented table' });
      if (!db) return res.status(500).json({ error: 'no database client' });
      const offset = int(req.query.offset, 'offset', 0, 1e7) ?? 0;
      const key = text(req.query.key, 'key', 80);
      let q = db.from(t.name).select('*', { count: 'estimated' });
      if (key != null) {
        if (t.pk.length !== 1) throw new BadRequest('key works only on a table with a one-column primary key');
        q = q.eq(t.pk[0], key);
      }
      for (const c of t.pk) q = q.order(c, { ascending: false });
      const { data, error, count } = await q.range(offset, offset + TABLE_PAGE - 1);
      if (error) return res.status(400).json({ error: error.message || String(error) });
      return res.json({ table: t.name, pk: t.pk, columns: t.columns.map((c) => c.name), offset, limit: TABLE_PAGE,
        total_estimate: count ?? null, rows: (data || []).map((row) => redactRow(t.name, row)) });
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'admin route failed' });
    }
  });

  r.get('/search', async (req, res) => {
    try {
      const q = text(req.query.q, 'q', 60);
      if (!q || q.trim().length < 2) return res.json({ q: q || '', members: [], cards: [], tables: [] });
      const needle = q.trim();
      const m = await rpc('admin_members', { p_search: needle, p_sort: 'last_active', p_limit: 8, p_offset: 0 });
      if (m.error) return res.status(400).json({ error: m.error.message || String(m.error) });
      let cards = [];
      if (db) {
        const like = needle.replace(/[\\%_]/g, (c) => `\\${c}`);
        const c = await db.from('cards').select('id,name,rarity').ilike('name', `%${like}%`).order('id').limit(8);
        if (c.error) return res.status(400).json({ error: c.error.message || String(c.error) });
        cards = c.data || [];
      }
      const lower = needle.toLowerCase();
      return res.json({ q: needle,
        members: (m.data?.rows || []).map((x) => ({ id: x.id, username: x.username, last_active: x.last_active })),
        cards, tables: tables().filter((t) => t.name.includes(lower)).slice(0, 8).map((t) => t.name) });
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'admin route failed' });
    }
  });

  const period = (q) => ({ p_from: date(q.from, 'from'), p_to: date(q.to, 'to') });
  route('/overview', 'admin_overview', (q) => period(q.query));
  route('/economy', 'admin_economy', (q) => ({ ...period(q.query), p_bucket: q.query.bucket === 'week' ? 'week' : (q.query.bucket ? word(q.query.bucket, 'bucket') : 'day') }));
  route('/growth', 'admin_growth', (q) => period(q.query));
  route('/members', 'admin_members', (q) => ({ p_search: text(q.query.search, 'search', 60), p_sort: word(q.query.sort, 'sort') || 'last_active',
    p_limit: int(q.query.limit, 'limit', 1, 200) ?? 50, p_offset: int(q.query.offset, 'offset', 0, 1e6) ?? 0 }));
  route('/member/:id/timeline', 'admin_member_timeline', (q) => ({ p_player: text(q.params.id, 'id', 40), p_before: stamp(q.query.before, 'before'),
    p_limit: int(q.query.limit, 'limit', 1, 200) ?? 50, p_before_key: text(q.query.before_key, 'before_key', 120) }));
  route('/member/:id', 'admin_member', (q) => ({ p_player: text(q.params.id, 'id', 40) }));
  route('/cards', 'admin_cards', (q) => ({ ...period(q.query), p_sort: word(q.query.sort, 'sort') || 'copies',
    p_limit: int(q.query.limit, 'limit', 1, 200) ?? 50, p_offset: int(q.query.offset, 'offset', 0, 1e6) ?? 0 }));
  route('/hunts', 'admin_hunts', (q) => ({ p_limit: int(q.query.limit, 'limit', 1, 100) ?? 20, p_offset: int(q.query.offset, 'offset', 0, 1e6) ?? 0 }));
  route('/hunt/:id', 'admin_hunt', (q) => ({ p_hunt: int(q.params.id, 'id', 1, Number.MAX_SAFE_INTEGER) }));
  route('/health', 'admin_health', () => ({}));
  route('/reports', 'admin_report_catalog', () => ({}));

  r.get('/report/:key', async (req, res) => {
    try {
      const csv = req.params.key.endsWith('.csv');
      const key = word(csv ? req.params.key.slice(0, -4) : req.params.key, 'key');
      const { data, error } = await rpc('admin_report', { p_key: key, p_params: reportParams(req.query) });
      if (error) return res.status(400).json({ error: error.message || String(error) });
      if (!csv) return res.json(data);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="lptcg-${key}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send('﻿' + toCsv(data.columns || [], data.rows || []));
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'admin route failed' });
    }
  });
  return r;
}
