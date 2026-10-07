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
 *
 * Protection: the same gate as the read routes (adminGate: flag ADMIN_VIEW=1, the studio login or Basic Auth, this PC
 * only without STUDIO_PASS). A write also needs Content-Type application/json and the header X-Admin-Write: 1: a page
 * on another site cannot send either without a CORS preflight, which this server never answers (no CSRF, also in
 * the no-password mode on this PC). The actor in admin_actions and event_log: studio:<STUDIO_USER>.
 * Usage in server.js, BEFORE the read router (it answers 405 to every POST):
 *   app.use('/api/admin/events', eventsRouter({ rpc: (fn, args) => supabase.rpc(fn, args) }));
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
const EVENT_KEYS = new Set(['id', 'key', 'kind', 'title', 'description', 'starts_at', 'ends_at', 'audience', 'rewards', 'rules']);
const eventBody = (ev) => {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) throw new BadRequest('event must be an object');
  for (const k of Object.keys(ev)) if (!EVENT_KEYS.has(k)) throw new BadRequest(`event.${k} is not allowed`);
  if (ev.id != null) id(ev.id);
  if (JSON.stringify(ev).length > 64 * 1024) throw new BadRequest('event is too large');
  return ev;
};

export function eventsRouter({ rpc, env = process.env }) {
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
