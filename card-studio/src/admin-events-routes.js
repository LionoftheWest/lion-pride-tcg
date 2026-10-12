/**
 * The Events API of the Admin view: /api/admin/events* calls the admin_event* SQL functions (tcg-bot/supabase/events.sql)
 * with the service role. The only Admin routes that WRITE (the rest of /api/admin is read only).
 *
 *   GET  /api/admin/events                 admin_events()                 the list
 *   GET  /api/admin/events/:id             admin_event(id)                one event, payouts, claims, log
 *   GET  /api/admin/events/:id/preview     admin_event_preview(id)        who would get what now (no side effects)
 *   POST /api/admin/events/test            admin_event_preview_draft(ev)  "Test": the preview of the form, nothing saved
 *   POST /api/admin/events                 admin_event_save(ev, expected_updated_at, actor, reason)   "Apply": save a draft or an edit
 *   POST /api/admin/events/:id/schedule    admin_event_schedule(id, expected_updated_at, actor, on)
 *   POST /api/admin/events/:id/cancel      admin_event_cancel(id, expected_updated_at, actor, reason)
 *   POST /api/admin/events/:id/end         admin_event_end_now(id, expected_updated_at, actor, reason)
 * The calendar and the event library (F-1 PR 5; tcg-bot/supabase/event_vars.sql):
 *   GET  /api/admin/events/calendar?from&to   the events that overlap from..to (table events, read with db)
 *   GET  /api/admin/events/vars               the registry event_vars with each base value (balance) and the value now (game_vars)
 *   GET  /api/admin/events/templates          admin_event_templates()          the library
 *   POST /api/admin/events/templates          admin_event_template_save(t, expected_updated_at, actor, reason)
 *   POST /api/admin/events/:id/template       admin_event_template_from_event(id, name, actor, reason)   "Save as template"
 *   POST /api/admin/events/templates/:id/create   admin_event_from_template(id, key, starts_at, actor, title, reason)   a new draft
 *
 * Protection: the same gate as the read routes (adminGate: flag ADMIN_VIEW=1, the studio login or Basic Auth, this PC
 * only without STUDIO_PASS). A write also needs Content-Type application/json and the header X-Admin-Write: 1: a page
 * on another site cannot send either without a CORS preflight, which this server never answers (no CSRF, also in
 * the no-password mode on this PC). The actor in admin_actions and event_log: studio:<STUDIO_USER>.
 * Usage in server.js, BEFORE the read router (it answers 405 to every POST):
 *   app.use('/api/admin/events', eventsRouter({ rpc: (fn, args) => supabase.rpc(fn, args), db: supabase }));
 */
import express from 'express';
import { adminGate } from './admin-routes.js';

class BadRequest extends Error {}
const ID = /^[1-9]\d{0,17}$/;
const id = (v) => {
  if (!ID.test(String(v ?? ''))) throw new BadRequest('id must be an event id');
  return Number(v);
};
const stamp = (v, name) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) throw new BadRequest(`${name} must be a time`);
  return v;
};
const reason = (v) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length > 300) throw new BadRequest('reason must be a text of at most 300 characters');
  return v;
};
const EVENT_KEYS = new Set(['id', 'key', 'kind', 'title', 'description', 'starts_at', 'ends_at', 'audience', 'rewards', 'rules', 'vars', 'theme', 'template_id']);
const eventBody = (ev) => {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw new BadRequest('event must be an object');
  for (const k of Object.keys(ev)) if (!EVENT_KEYS.has(k)) throw new BadRequest(`event.${k} is not allowed`);
  if (ev.id != null) id(ev.id);
  if (JSON.stringify(ev).length > 64 * 1024) throw new BadRequest('event is too large');
  return ev;
};

const TEMPLATE_KEYS = new Set(['id', 'name', 'kind', 'description', 'audience', 'rewards', 'rules', 'vars', 'theme', 'default_length']);
const templateBody = (t) => {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new BadRequest('template must be an object');
  for (const k of Object.keys(t)) if (!TEMPLATE_KEYS.has(k)) throw new BadRequest(`template.${k} is not allowed`);
  if (t.id != null) id(t.id);
  if (JSON.stringify(t).length > 64 * 1024) throw new BadRequest('template is too large');
  return t;
};
const text = (v, name, max) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new BadRequest(`${name} must be a text of 1 to ${max} characters`);
  return v;
};
/** The base value of a variable (game_var with no live event): balance_path null = a factor (1); '{}' = the whole value; else the path. */
export const baseValue = (v, balance) => {
  if (v.balance_path == null) return 1;
  let x = balance;
  for (const p of v.balance_path) x = x == null ? undefined : x[p];
  return typeof x === 'number' ? x : x != null && x !== '' && Number.isFinite(Number(x)) ? Number(x) : null;
};
// The repeat rules (event_repeats) and kind hunt come with F-1 PR 2: the calendar shows the Repeat control off until then.
const FEATURES = { repeats: false };

export function eventsRouter({ rpc, db = null, env = process.env }) {
  if (typeof rpc !== 'function') throw new Error('eventsRouter needs rpc(fn, args)');
  const actor = () => `studio:${env.STUDIO_USER || 'studio'}`;
  const r = express.Router();
  r.use(adminGate(env));
  r.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '') || req.headers['x-admin-write'] !== '1') {
      return res.status(403).json({ error: 'a write needs Content-Type application/json and X-Admin-Write: 1' });
    }
    return next();
  });
  r.use(express.json({ limit: '100kb' }));

  const handle = (fn, args) => async (req, res) => {
    try {
      const a = args(req);
      const { data, error } = await rpc(fn, a);
      if (error) return res.status(400).json({ error: error.message || String(error) });
      return res.json(data);
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: 'events route failed' });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  r.get('/', handle('admin_events', () => ({})));
  // The calendar and the registry read tables with db (the Data page does the same): no SQL function lists them.
  const read = (fn) => async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: 'no database client' });
      return res.json(await fn(req));
    } catch (e) {
      if (e instanceof BadRequest) return res.status(400).json({ error: e.message });
      return res.status(500).json({ error: e?.message || 'events route failed' });
    }
  };
  const must = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  r.get('/calendar', read(async (req) => {
    const from = stamp(req.query.from, 'from'), to = stamp(req.query.to, 'to');
    if (!from || !to || Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 100 * 86400000) {
      throw new BadRequest('from and to must be times, to after from, at most 100 days apart');
    }
    const rows = must(await db.from('events').select('id,key,kind,title,status,starts_at,ends_at,ended_at,vars,theme,template_id,repeat_id,updated_at')
      .lt('starts_at', to).gt('ends_at', from).order('starts_at').limit(500));
    return { from, to, now: new Date().toISOString(), rows, features: FEATURES };
  }));
  r.get('/vars', read(async () => {
    const vars = must(await db.from('event_vars').select('key,label,note,balance_key,balance_path,combine,min_value,max_value,whole').order('key'));
    const keys = [...new Set(vars.map((v) => v.balance_key))];
    const bal = keys.length ? must(await db.from('balance').select('key,value').in('key', keys)) : [];
    const byKey = Object.fromEntries(bal.map((b) => [b.key, b.value]));
    const cur = await rpc('game_vars', {});
    const now = cur.error ? {} : cur.data || {};
    return { rows: vars.map((v) => ({ ...v, min_value: Number(v.min_value), max_value: Number(v.max_value), base: baseValue(v, byKey[v.balance_key]), now: now[v.key] ?? null })) };
  }));
  r.get('/templates', handle('admin_event_templates', () => ({})));
  r.post('/templates', handle('admin_event_template_save', (req) => {
    const b = body(req);
    return { p_template: templateBody(b.template), p_expected_updated_at: stamp(b.expected_updated_at, 'expected_updated_at'), p_actor: actor(), p_reason: reason(b.reason) };
  }));
  r.post('/templates/:id/create', handle('admin_event_from_template', (req) => {
    const b = body(req);
    const key = text(b.key, 'key', 48), at = stamp(b.starts_at, 'starts_at');
    if (!at) throw new BadRequest('starts_at must be a time');
    if (b.title != null && b.title !== '') text(b.title, 'title', 80);
    return { p_template_id: id(req.params.id), p_key: key, p_starts_at: at, p_actor: actor(), p_title: b.title || null, p_reason: reason(b.reason) };
  }));
  r.post('/:id/template', handle('admin_event_template_from_event', (req) => {
    const b = body(req);
    return { p_event_id: id(req.params.id), p_name: text(b.name, 'name', 80), p_actor: actor(), p_reason: reason(b.reason) };
  }));
  r.post('/test', handle('admin_event_preview_draft', (req) => ({ p_event: eventBody(body(req).event) })));
  r.post('/', handle('admin_event_save', (req) => {
    const b = body(req);
    return { p_event: eventBody(b.event), p_expected_updated_at: stamp(b.expected_updated_at, 'expected_updated_at'), p_actor: actor(), p_reason: reason(b.reason) };
  }));
  r.get('/:id', handle('admin_event', (req) => ({ p_id: id(req.params.id) })));
  r.get('/:id/preview', handle('admin_event_preview', (req) => ({ p_id: id(req.params.id) })));
  r.post('/:id/schedule', handle('admin_event_schedule', (req) => {
    const b = body(req);
    if (b.on != null && typeof b.on !== 'boolean') throw new BadRequest('on must be true or false');
    return { p_id: id(req.params.id), p_expected_updated_at: stamp(b.expected_updated_at, 'expected_updated_at'), p_actor: actor(), p_on: b.on !== false };
  }));
  r.post('/:id/cancel', handle('admin_event_cancel', (req) => {
    const b = body(req);
    return { p_id: id(req.params.id), p_expected_updated_at: stamp(b.expected_updated_at, 'expected_updated_at'), p_actor: actor(), p_reason: reason(b.reason) };
  }));
  r.post('/:id/end', handle('admin_event_end_now', (req) => {
    const b = body(req);
    return { p_id: id(req.params.id), p_expected_updated_at: stamp(b.expected_updated_at, 'expected_updated_at'), p_actor: actor(), p_reason: reason(b.reason) };
  }));
  // A bad JSON body: 400, not the default HTML error page.
  r.use((err, req, res, next) => (err && err.type === 'entity.parse.failed' ? res.status(400).json({ error: 'the body is not valid JSON' }) : next(err)));
  return r;
}
