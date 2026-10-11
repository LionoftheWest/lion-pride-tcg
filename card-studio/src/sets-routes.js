/**
 * The Sets section of the Admin page (F-2 PR 3, docs/foundations.md F-2 items 2 and 5). The database owns the sets and the
 * set membership (card_sets, set_pool, set_includes); cards.json keeps each card's HOME set (`set`).
 *   GET  /api/sets                      the sets (card_sets order: sort, id), the includes, the pool rows, the live rows of each set
 *   POST /api/sets                      admin_set_save(actor, set, before, reason): create (before null) or edit a set
 *   POST /api/sets/:id/pool             admin_set_pool: add or remove cards ({ keys: [card ids of cards.json] } or { cards: [db ids] })
 *   POST /api/sets/:id/include          admin_set_include: include or exclude a whole set ({ set, add })
 *   POST /api/sets/:id/pack-art         upload the pack still (fills pack_art_url) or the clip to storage card-art/packs/
 * Every write goes through the admin functions of set_pools.sql (checked input, LP409 stale, LP400 bad request, an
 * admin_actions row). The actor: studio:<STUDIO_USER>, as the Events editor. The studio login covers these routes.
 */
import express from 'express';
import { isSetId } from './cardstore.js';
import { publicUrl } from './storage-url.js';

const BUCKET = 'card-art';
const MAX_ART = 20 * 1024 * 1024; // 20 MB, before base64

// An answer of the admin functions: { status, error } with the message of the database ("admin: ...").
const fail = (res, error) => {
  const code = error?.code === 'LP409' ? 409 : error?.code === 'LP400' ? 400 : 502;
  return res.status(code).json({ ok: false, error: String(error?.message || error).replace(/^admin: /, '') });
};

export function setsRouter({ db, env = process.env }) {
  const r = express.Router();
  const actor = () => `studio:${env.STUDIO_USER || 'studio'}`;

  r.get('/', async (req, res) => {
    const [sets, inc, pool, rows] = await Promise.all([
      db.from('card_sets').select('*').order('sort').order('id'),
      db.from('set_includes').select('set_id, included_set_id'),
      db.from('set_pool').select('set_id, card_id, card:cards(id, rarity, set_id, set_number, subject:subjects(key))'),
      db.from('cards').select('id, rarity, name, set_id, set_number, image_url, subject:subjects(key)').order('set_id').order('set_number'),
    ]);
    if (sets.error) return fail(res, sets.error);
    if (rows.error) return fail(res, rows.error);
    // set_pools.sql not applied yet: the sets still list; the pool parts say why they are empty.
    const poolsReady = !inc.error && !pool.error;
    res.json({
      ok: true,
      sets: sets.data,
      pools_ready: poolsReady,
      pools_error: poolsReady ? null : (inc.error || pool.error).message,
      includes: inc.data || [],
      pool: (pool.data || []).map((p) => ({ set_id: p.set_id, card_id: p.card_id, key: p.card?.subject?.key || null, rarity: p.card?.rarity,
        home: p.card?.set_id, number: p.card?.set_number })),
      rows: (rows.data || []).map((c) => ({ id: c.id, key: c.subject?.key || null, name: c.name, rarity: c.rarity, set_id: c.set_id, number: c.set_number, image_url: c.image_url })),
    });
  });

  r.post('/', async (req, res) => {
    const b = req.body || {};
    if (!b.set || typeof b.set !== 'object' || !isSetId(b.set.id)) return res.status(400).json({ ok: false, error: 'the set id is 1 to 8 capital letters or digits (for example S2)' });
    const { data, error } = await db.rpc('admin_set_save', { p_actor: actor(), p_set: b.set, p_before: b.before ?? null, p_reason: b.reason || null });
    if (error) return fail(res, error);
    res.json({ ok: true, ...data });
  });

  r.post('/:id/pool', async (req, res) => {
    const id = req.params.id;
    if (!isSetId(id)) return res.status(400).json({ ok: false, error: 'bad set id' });
    const b = req.body || {};
    let ids = Array.isArray(b.cards) ? b.cards.map(Number).filter(Number.isInteger) : [];
    // cards.json ids (subject keys): every live row (each tier) of those cards.
    if (Array.isArray(b.keys) && b.keys.length) {
      const { data, error } = await db.from('cards').select('id, subject:subjects!inner(key)').in('subjects.key', b.keys.map(String));
      if (error) return fail(res, error);
      ids = ids.concat((data || []).map((c) => c.id));
      if (!ids.length) return res.status(400).json({ ok: false, error: 'these cards are not live yet: push them first' });
    }
    const { data, error } = await db.rpc('admin_set_pool', { p_actor: actor(), p_set: id, p_cards: ids, p_add: b.add !== false, p_reason: b.reason || null });
    if (error) return fail(res, error);
    res.json({ ok: true, ...data });
  });

  r.post('/:id/include', async (req, res) => {
    const id = req.params.id, other = (req.body || {}).set;
    if (!isSetId(id) || !isSetId(other)) return res.status(400).json({ ok: false, error: 'bad set id' });
    const { data, error } = await db.rpc('admin_set_include', { p_actor: actor(), p_set: id, p_included: other, p_add: req.body.add !== false, p_reason: req.body.reason || null });
    if (error) return fail(res, error);
    res.json({ ok: true, ...data });
  });

  // The pack art: a still image (png / webp / jpeg) fills card_sets.pack_art_url through admin_set_save; a clip (webp / webm /
  // mp4) is stored next to it at packs/<id>-clip.<ext> (card_sets has no clip column yet: the Activity uses the still).
  r.post('/:id/pack-art', async (req, res) => {
    const id = req.params.id;
    if (!isSetId(id)) return res.status(400).json({ ok: false, error: 'bad set id' });
    const b = req.body || {};
    const kind = b.kind === 'clip' ? 'clip' : 'still';
    const m = /^data:((?:image|video)\/[\w.+-]+);base64,(.+)$/s.exec(b.dataUrl || '');
    if (!m) return res.status(400).json({ ok: false, error: 'not an image or a video file' });
    const types = kind === 'still' ? { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' } : { 'image/webp': 'webp', 'video/webm': 'webm', 'video/mp4': 'mp4' };
    const ext = types[m[1]];
    if (!ext) return res.status(400).json({ ok: false, error: `the ${kind} must be ${Object.keys(types).join(', ')}` });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_ART) return res.status(400).json({ ok: false, error: 'the file must be 1 byte to 20 MB' });
    const { data: set, error: se } = await db.from('card_sets').select('*').eq('id', id).maybeSingle();
    if (se) return fail(res, se);
    if (!set) return res.status(404).json({ ok: false, error: `no set ${id}` });
    const object = `packs/${id}-${kind}.${ext}`;
    const { error: be } = await db.storage.createBucket(BUCKET, { public: true }); // as push.js ensureBucket
    if (be && !/exist/i.test(be.message)) return fail(res, `bucket: ${be.message}`);
    const { error: ue } = await db.storage.from(BUCKET).upload(object, buf, { contentType: m[1], upsert: true });
    if (ue) return fail(res, `upload: ${ue.message}`);
    const url = `${publicUrl(db, BUCKET, object)}?v=${Date.now()}`; // the base that received the upload (local or live)
    if (kind === 'clip') return res.json({ ok: true, kind, url });
    const before = (({ id: i, name, code, pack_color, released_at, pullable, sort, season, pack_art_url, cover_card_id }) =>
      ({ id: i, name, code, pack_color, released_at, pullable, sort, season, pack_art_url, cover_card_id }))(set);
    const { data, error } = await db.rpc('admin_set_save', { p_actor: actor(), p_set: { id, pack_art_url: url }, p_before: before, p_reason: 'pack art upload' });
    if (error) return fail(res, error);
    res.json({ ok: true, kind, url, ...data });
  });

  return r;
}
