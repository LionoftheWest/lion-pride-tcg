import 'dotenv/config';
import express from 'express';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { fillHtml, renderPng } from './render.js';
import { pushCard, renderTier } from './push.js';
import { removeTiers } from './tier-delete.js';
import { deleteWholeCard, removeLocalFiles } from './card-delete.js';
import { supabase } from './supabase.js';
import { syncAbilityLive } from './ability-sync.js';
import { adminRouter } from './admin-routes.js';
import { eventsRouter } from './admin-events-routes.js';
import { adminWriteRouter } from './admin-write.js';
import { setsRouter } from './sets-routes.js';
import { abilityBuilderRouter } from './ability-builder-routes.js';
import { combatLabRouter } from './combat-lab-routes.js';
import { loadVocab, saveVocab, vocabView, addValue } from './tag-vocab.js';
import { studioAuth, loadSecret } from './studio-auth.js';
import { artKeyFor, artSlots, SLOT_LABEL, ORDER, slugify, needsPeriod, tiersPublic, ANIMATED } from './rarity.js';
import { getFrame, setFrame } from './frames.js';
import { getArtist, setArtist } from './artists.js';
import { getSource, setSource } from './artsources.js';
import { checkTierSetChange, homeLiveSet, tierSetOrNull } from './tier-set.js';
import { getCards, getCard, addCard, updateCard, deleteCard, slotDetails, setSlotDetails, subjectType, isSetId } from './cardstore.js';

// Injected into a card render when ?edit=1: drag to pan, scroll to zoom, and
// report the framing back to the studio window.
const EDIT_SCRIPT = `<script>
(function(){
  var img=document.querySelector('.art-img'); if(!img) return;
  function num(a,d){ var v=parseFloat(img.getAttribute(a)); return isNaN(v)?d:v; }
  var x=num('data-ax',50), y=num('data-ay',50), z=num('data-az',1);
  function apply(){
    img.setAttribute('data-ax',x); img.setAttribute('data-ay',y); img.setAttribute('data-az',z);
    if(window.__placeArt) window.__placeArt();
    parent.postMessage({type:'frame',x:x,y:y,scale:z},'*');
  }
  var drag=false,lx=0,ly=0;
  document.body.style.cursor='grab';
  document.addEventListener('pointerdown',function(e){drag=true;lx=e.clientX;ly=e.clientY;document.body.style.cursor='grabbing';e.preventDefault();});
  document.addEventListener('pointermove',function(e){
    if(!drag)return;
    var dw=img.offsetWidth||500, dh=img.offsetHeight||700;
    x=Math.min(100,Math.max(0,x-(e.clientX-lx)/dw*100));
    y=Math.min(100,Math.max(0,y-(e.clientY-ly)/dh*100));
    lx=e.clientX;ly=e.clientY;apply();
  });
  document.addEventListener('pointerup',function(){drag=false;document.body.style.cursor='grab';});
  document.addEventListener('wheel',function(e){e.preventDefault();z=Math.min(4,Math.max(1,z-e.deltaY*0.001));apply();},{passive:false});
  window.addEventListener('message',function(e){
    var d=e.data||{};
    if(d.type==='frameReset'){x=50;y=50;z=1;apply();}
    else if(d.type==='frameZoom'){z=Math.min(4,Math.max(1,d.scale));apply();}
  });
  if(img.complete && img.naturalWidth) apply(); else img.addEventListener('load',apply);
})();
</script>`;

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const ART = join(ROOT, 'art');
const OUT = join(ROOT, 'out');
const BUCKET = 'card-art';
mkdirSync(ART, { recursive: true });
mkdirSync(OUT, { recursive: true });

export const app = express();
// The login of the WHOLE studio (src/studio-auth.js): first, before every route and the static files.
// STUDIO_PASS set = a session cookie (the /login page) or Basic Auth; STUDIO_PASS empty = this PC only.
app.use(studioAuth({ secret: loadSecret(join(ROOT, '.studio-secret')) }));
app.use(express.json({ limit: '30mb' }));
// The ability builder (combat v2 PR T1, src/ability-builder-routes.js): checks on the LOCAL copy, writes a private batch file. Before the read-only router.
app.use('/api/admin/abilities', abilityBuilderRouter());
// The Combat v2 Lab (src/combat-lab-routes.js): v2 fights of a member's cards on the LOCAL copy, in a block that rolls back. Before the read-only router.
app.use('/api/admin/combat-lab', combatLabRouter());
// The Events editor (writes; src/admin-events-routes.js): mounted before the read-only router, which refuses POST.
app.use('/api/admin/events', eventsRouter({ rpc: (fn, args) => supabase.rpc(fn, args), db: supabase }));
// The Admin view data (read only): flag ADMIN_VIEW=1 (src/admin-routes.js). The pages: public/admin/ (/admin/).
// The Admin view editors (Phase 2: preview, test on the LOCAL copy, apply, undo): flag ADMIN_EDIT=1 (src/admin-write.js).
app.use('/api/admin/edit', adminWriteRouter({ live: supabase }));
// The Sets section (F-2 PR 3, src/sets-routes.js): the sets, pack art, set pools. No flag, like the Cards section.
app.use('/api/sets', setsRouter({ db: supabase }));
app.use('/api/admin', adminRouter({ rpc: (fn, args) => supabase.rpc(fn, args), db: supabase }));
// One page (F-2): the card editor (the old Card Portal) is the Cards section of the Admin page, /admin/#/cards.
// The start page is the Overview when the Admin data is on (ADMIN_VIEW=1), else the Cards section, which needs no flag.
// /index.html was the portal: an old bookmark lands on the Cards section.
const startPage = () => (process.env.ADMIN_VIEW === '1' ? '/admin/' : '/admin/#/cards');
app.get('/', (req, res) => res.redirect(302, startPage()));
app.get('/index.html', (req, res) => res.redirect(302, '/admin/#/cards'));
// Never cache the studio UI, so a browser always loads the latest code.
app.use(express.static(join(ROOT, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// The portal card store is the single source of truth (stable ids).
const allCards = () => getCards();
const cardById = (id) => getCard(id);
// Mark a card as changed since its last render, so the portal can flag it as
// having "unpushed changes". Cleared (pushedAt bumped) when it renders.
const touch = (id) => { updateCard(id, { updatedAt: Date.now() }); };
const artFile = (id, slot) => {
  const f = readdirSync(ART).find((n) => n.startsWith(`${id}-${slot}.`));
  return f ? join(ART, f) : null;
};
// The art file for a slot, following a "pull from another card" source if set.
const resolveArtFile = (id, slot) => {
  const src = getSource(id, slot);
  return src ? artFile(src.fromId, src.fromSlot) : artFile(id, slot);
};

// The full card list, tagged with per-slot art + pushed status.
// The tier catalog (labels, colors, order, flags) — the studio reads this so a
// new tier added in rarity.js appears here with no front-end edits.
app.get('/api/tiers', (req, res) => res.json(tiersPublic()));

app.get('/api/cards', async (req, res) => {
  const cards = allCards();
  const { data: subs } = await supabase.from('subjects').select('key');
  const pushed = new Set((subs || []).map((s) => s.key));

  // live image URLs per pushed card, so the gallery can show real (animated) faces; and the live home set of each card
  // (F-2: cards.set_id of its rows) and the sets whose pool holds it (set_pool, set_pools.sql).
  const { data: dbCards } = await supabase
    .from('cards')
    .select('rarity, image_url, set_id, set_number, subject:subjects(key)');
  const live = {};
  const liveSet = {};
  for (const row of dbCards || []) {
    const key = row.subject?.key;
    if (!key) continue;
    (live[key] ||= {})[row.rarity] = row.image_url;
    (liveSet[key] ||= {})[row.rarity] = { set: row.set_id, number: row.set_number };
  }
  const pools = {};
  const { data: poolRows, error: poolErr } = await supabase.from('set_pool').select('set_id, card:cards(subject:subjects(key))');
  if (!poolErr) for (const p of poolRows || []) { const key = p.card?.subject?.key; if (key) (pools[key] ||= new Set()).add(p.set_id); }

  res.json(
    cards.map((c) => {
      const slots = artSlots(c.finishes).map((slot) => ({
        slot,
        label: SLOT_LABEL[slot],
        hasArt: Boolean(resolveArtFile(c.id, slot)),
        artist: getArtist(c.id, slot),
        source: getSource(c.id, slot),
        details: slotDetails(c, slot), // per-tier subject / description / season / event / own set (tierSet)
        set: tierSetOrNull(c, slot), // the set this tier is printed in: its own set, else the home set
      }));
      const arted = slots.filter((s) => s.hasArt).length;
      const isLive = pushed.has(c.id);
      // "Unpushed changes": the card is fully arted AND either has never rendered
      // live, or has been edited since its last render.
      const dirty = slots.length > 0 && arted === slots.length && (
        !isLive || (c.updatedAt && (!c.pushedAt || c.updatedAt > c.pushedAt))
      );
      return {
        ...c,
        slots,
        filled: arted,
        total: slots.length,
        pushed: isLive,
        live: live[c.id] || {},
        liveSet: liveSet[c.id] || {},
        pools: [...(pools[c.id] || [])].sort(),
        manual: true, // every card lives in the portal store now (editable + deletable)
        dirty: Boolean(dirty),
      };
    }),
  );
});

// Create a new card in the portal (the portal is the source of truth).
app.post('/api/cards', (req, res) => {
  const { name, genre, lore, season, event, finishes, set } = req.body || {};
  const cleanName = (name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'A card name is required.' });
  // F-2: every new card has its home set (no default: a card never lands in S1 by accident).
  if (!isSetId(set)) return res.status(400).json({ error: 'Choose the set of the card.' });
  if (!(season || '').trim()) return res.status(400).json({ error: 'A season / origin is required.' });
  // A new card starts with zero tiers — they are added on the card screen.
  const validFinishes = [...new Set((finishes || []).filter((f) => ORDER.includes(f)))]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (validFinishes.some(needsPeriod) && !(event || '').trim()) {
    return res.status(400).json({ error: 'An Event / Promo period is required for the Event and Promo tiers.' });
  }

  const existing = new Set(allCards().map((c) => c.id));
  const base = slugify(cleanName);
  let id = base;
  let n = 2;
  while (existing.has(id)) id = `${base}-${n++}`;

  const card = {
    id,
    name: cleanName,
    genre: (genre || '').trim(),
    lore: (lore || '').trim(),
    season: (season || '').trim(),
    set,
    event: (event || '').trim(),
    finishes: validFinishes,
    updatedAt: Date.now(),
  };
  addCard(card);
  res.json({ ok: true, card });
});

// Edit a card's name, description, and tiers. Works for any card (a portal
// edit overrides the sheet by id). Removing a tier also removes it from the live
// bot; name/description edits are reflected live too.
app.put('/api/cards/:id', async (req, res) => {
  const id = req.params.id;
  const existing = cardById(id);
  if (!existing) return res.status(404).json({ error: 'no card' });

  // The card level holds only the Title + the tier list now. The subject /
  // description / season / event are per-tier (see /api/details).
  const { name, finishes } = req.body || {};
  const cleanName = (name ?? existing.name).trim();
  if (!cleanName) return res.status(400).json({ error: 'A card name is required.' });
  const nextFinishes = [...new Set((finishes || existing.finishes).filter((f) => ORDER.includes(f)))]
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));

  const removed = existing.finishes.filter((f) => !nextFinishes.includes(f));
  const card = { id, name: cleanName, finishes: nextFinishes, updatedAt: Date.now() };

  // A removed tier is deleted from the live game FIRST (src/tier-delete.js): the rows, then the images, and
  // only if the database accepts. A card with history (Hunt, Shop, combat, plays, auctions) is refused: then
  // nothing changes, here or live, and the studio shows why.
  let subject = null, lookupErr = '';
  try {
    const q = await supabase.from('subjects').select('id').eq('key', id).maybeSingle();
    if (q.error) throw new Error(q.error.message);
    subject = q.data;
  } catch (e) {
    lookupErr = e.message || String(e);
    if (removed.length) return res.status(502).json({ ok: false, error: 'Could not reach the live game, so no tier was removed: ' + (e.message || e) });
  }
  let warning = '';
  if (subject && removed.length) {
    let r;
    try {
      r = await removeTiers({ db: supabase, bucket: BUCKET, cardId: id, subjectId: subject.id, tiers: removed });
    } catch (e) {
      r = { ok: false, error: 'The live delete failed, so no tier was removed: ' + (e.message || e) };
    }
    if (!r.ok) return res.status(409).json({ ok: false, error: r.error });
    if (r.warning) warning = `; ${r.warning}`;
    for (const f of readdirSync(OUT).filter((n) => removed.some((t) => n === `gallery-${id}-${t}.png`))) {
      try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
    }
  }
  updateCard(id, card);

  // Best-effort: reflect the name in the live bot, if this card was pushed. Only
  // the name is card-wide; per-tier text syncs through /api/details.
  let sync = lookupErr ? 'saved locally; live sync failed: ' + lookupErr : 'saved (not live yet)';
  if (subject) {
    try {
      await supabase.from('subjects').update({ name: card.name }).eq('id', subject.id);
      await supabase.from('cards').update({ name: card.name }).eq('subject_id', subject.id);
      sync = (removed.length ? `live: updated, removed ${removed.join(', ')}` : 'live: updated') + warning;
    } catch (e) {
      sync = 'saved locally; live sync failed: ' + (e.message || e);
    }
  }
  res.json({ ok: true, card, sync });
});

// Change the HOME set of a card (F-2): the card is printed and numbered in that set. A live card gets a NEW number in
// the new set at its next push; push.js allows the move only when it was recorded here (setMoveFrom = the live set).
// Adding a card to another set's pull pool is NOT this: that is POST /api/sets/:id/pool.
app.put('/api/cards/:id/set', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const set = (req.body || {}).set;
  if (!isSetId(set)) return res.status(400).json({ error: 'Choose a set.' });
  const { data: s, error: se } = await supabase.from('card_sets').select('id, season').eq('id', set).maybeSingle();
  if (se) return res.status(502).json({ error: 'Could not reach the game database: ' + se.message });
  if (!s) return res.status(400).json({ error: `No set ${set}.` });
  const { data: subject } = await supabase.from('subjects').select('id').eq('key', c.id).maybeSingle();
  let liveSet = null;
  if (subject) {
    const { data: rows, error: re } = await supabase.from('cards').select('rarity, set_id').eq('subject_id', subject.id);
    if (re) return res.status(502).json({ error: 'Could not reach the game database: ' + re.message });
    liveSet = homeLiveSet(c, rows); // the tiers with their own set do not count (a tier in another set is not the home set)
  }
  // setMoveFrom: the live set the card leaves (cleared when it goes back, or after the push that moves it).
  const card = updateCard(c.id, { set, setMoveFrom: liveSet && liveSet !== set ? liveSet : undefined, updatedAt: Date.now() });
  res.json({ ok: true, card, moving: Boolean(card.setMoveFrom), liveSet });
});

// Delete a whole card (src/card-delete.js). A card that is not live goes with its local files. A live card is deleted
// from the live game first (rows, subject, images); a card with history is refused (409) and nothing changes.
app.delete('/api/cards/:id', async (req, res) => {
  const card = cardById(req.params.id);
  if (!card) return res.status(404).json({ error: 'No such card.' });
  const id = card.id;
  let r;
  try {
    r = await deleteWholeCard({
      db: supabase, bucket: BUCKET, card, actor: `studio:${process.env.STUDIO_USER || 'studio'}`,
      removeLocal: () => { const l = removeLocalFiles({ id, artDir: ART, outDir: OUT }); deleteCard(id); return l; },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'The delete failed: ' + (e.message || e) });
  }
  if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error });
  res.json({ ok: true, live: r.live, warning: r.warnings.length ? r.warnings.join('; ') : undefined });
});

// Serve a card's uploaded art for a slot.
app.get('/art/:id/:slot', (req, res) => {
  const f = resolveArtFile(req.params.id, req.params.slot);
  if (!f) return res.status(404).end();
  res.sendFile(f);
});

// A rendered PNG thumbnail for one finish (gallery). Cached; re-rendered when
// the art is newer than the cache.
app.get('/face/:id/:rarity', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).end();
  const { rarity } = req.params;
  const slot = artKeyFor(rarity);
  const art = resolveArtFile(c.id, slot);
  const outPng = join(OUT, `gallery-${c.id}-${rarity}.png`);
  const artM = art ? statSync(art).mtimeMs : 0;
  const cacheM = existsSync(outPng) ? statSync(outPng).mtimeMs : -1;
  if (cacheM < artM || !existsSync(outPng)) {
    try {
      const eff = { ...c, ...slotDetails(c, slot) };
      await renderPng(eff, rarity, art, outPng, 1, false, getFrame(c.id, slot), getArtist(c.id, slot));
    } catch {
      return res.status(500).end();
    }
  }
  res.sendFile(outPng);
});

// Live preview HTML for one finish (used in the UI iframes).
app.get('/card/:id/:rarity', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).end();
  const slot = artKeyFor(req.params.rarity);
  const art = resolveArtFile(c.id, slot) ? `/art/${c.id}/${slot}?t=${Date.now()}` : null;
  const eff = { ...c, ...slotDetails(c, slot) };
  let html = fillHtml(eff, req.params.rarity, art, req.query.mask === '1', getFrame(c.id, slot), getArtist(c.id, slot));
  if (req.query.edit === '1') html = html.replace('</body>', `${EDIT_SCRIPT}</body>`);
  res.type('html').send(html);
});

// Save the framing (pan/zoom) for a card's art slot, and drop stale gallery
// thumbnails so they re-render with the new framing.
app.post('/api/frame/:id/:slot', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const frame = setFrame(c.id, req.params.slot, req.body || {});
  for (const f of readdirSync(OUT).filter((n) => n.startsWith(`gallery-${c.id}-`))) {
    try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
  }
  touch(c.id);
  res.json({ ok: true, frame });
});

// Read the framing for a card's art slot.
app.get('/api/frame/:id/:slot', (req, res) => {
  res.json(getFrame(req.params.id, req.params.slot));
});

// Save the artist credit for a card's art slot (per tier). Drops stale gallery
// thumbnails so they re-render with the new credit.
app.post('/api/artist/:id/:slot', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const artist = setArtist(c.id, req.params.slot, (req.body && req.body.name) || '');
  for (const f of readdirSync(OUT).filter((n) => n.startsWith(`gallery-${c.id}-`))) {
    try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
  }
  touch(c.id);
  res.json({ ok: true, artist });
});

// Save the per-tier details (subject / description / season / event) for one
// slot. Drops stale gallery thumbnails and updates this tier's live Supabase row
// in place, so the portal stays the source of truth.
app.post('/api/details/:id/:slot', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const slot = req.params.slot;
  const { genre, lore, season, event, set } = req.body || {};
  const patch = {};
  // A set for this tier (src/tier-set.js): '' or the home set clears it (the tier follows the card). A tier that is live in
  // another set is refused: a push does not move it.
  if (set !== undefined) {
    const chk = await checkTierSetChange({ db: supabase, card: c, slot, set });
    if (!chk.ok) return res.status(chk.status).json({ ok: false, error: chk.error });
    patch.set = chk.value ?? undefined; // undefined: the key is not written to cards.json
  }
  if (genre !== undefined) patch.genre = String(genre).trim();
  if (lore !== undefined) patch.lore = String(lore).trim();
  if (season !== undefined) patch.season = String(season).trim();
  if (event !== undefined) patch.event = String(event).trim();
  const updated = setSlotDetails(c.id, slot, patch);
  for (const f of readdirSync(OUT).filter((n) => n.startsWith(`gallery-${c.id}-`))) {
    try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
  }
  const det = slotDetails(updated, slot);
  // Best-effort: reflect this tier's text in the live bot, if it was pushed.
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', c.id).maybeSingle();
    if (subject) {
      const rowEvent = needsPeriod(slot) ? (det.event || null) : null;
      await supabase.from('cards')
        .update({ lore: det.lore, season: det.season || null, event: rowEvent })
        .eq('subject_id', subject.id).eq('rarity', slot);
    }
  } catch { /* live sync is best-effort */ }
  touch(c.id);
  res.json({ ok: true, details: det });
});

// Lock / unlock a card from trading (all its tiers). Reflects immediately in the
// live DB so the Activity's trading rules pick it up without a full re-render.
app.post('/api/tradeable/:id', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const tradeable = req.body?.tradeable !== false;
  updateCard(c.id, { tradeable });
  touch(c.id);
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', c.id).maybeSingle();
    if (subject) await supabase.from('cards').update({ tradeable }).eq('subject_id', subject.id);
  } catch { /* live sync is best-effort */ }
  res.json({ ok: true, tradeable });
});

// The tag library of the pickers (F-2 item 7, src/tag-vocab.js): each facet with its values and how many cards use each.
app.get('/api/tag-vocab', (req, res) => {
  try { res.json({ ok: true, facets: vocabView(loadVocab(), allCards()) }); } catch (e) { res.status(500).json({ ok: false, error: e.message || String(e) }); }
});
// "+ Add new": checked against the library first (the same value, or a near duplicate = refused with a suggestion).
app.post('/api/tag-vocab', (req, res) => {
  const { facet, value } = req.body || {};
  let vocab;
  try { vocab = loadVocab(); } catch (e) { return res.status(500).json({ ok: false, error: e.message || String(e) }); }
  const r = addValue(vocab, String(facet || ''), value);
  if (!r.ok) return res.status(r.suggest ? 409 : 400).json(r);
  if (!r.existed) saveVocab(vocab);
  res.json({ ...r, facets: vocabView(vocab, allCards()) });
});

// Set the faceted tags for a card (subject-level: class, type, origin, genre,
// realm, traits). Reflects into subjects.tags; the DB trigger recomputes
// subjects.tag_slugs. The tags are hidden on the card face — they show in the
// Card Information view and drive the battle engine.
app.post('/api/tags/:id', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const b = req.body || {};
  const arr = (v) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const tags = {
    class: String(b.class || 'attacker').trim().toLowerCase(),
    type: String(b.type || c.type || '').trim().toLowerCase(),
    origin: arr(b.origin),
    genre: arr(b.genre),
    realm: arr(b.realm),
    traits: arr(b.traits),
  };
  // The Card Info type is the card type too (subjects.type), so a new card can be pushed.
  const type = subjectType({ tags }) || subjectType(c);
  updateCard(c.id, type ? { tags, type } : { tags });
  touch(c.id);
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', c.id).maybeSingle();
    if (subject) await supabase.from('subjects').update(type ? { tags, type } : { tags }).eq('id', subject.id);
  } catch { /* live sync is best-effort */ }
  res.json({ ok: true, tags });
});

// Set (or clear) the ability for a card (subject-level). An empty name clears it.
// Reflects into subjects.ability.
app.post('/api/ability/:id', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const b = req.body || {};
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const name = String(b.name || '').trim();
  const ability = name ? {
    name,
    kind: String(b.kind || 'support').trim(),
    effect: String(b.effect || '').trim(),
    amount: num(b.amount),
    target: String(b.target || '').trim() || null,
    cooldown: num(b.cooldown),
    desc: String(b.desc || '').trim(),
  } : null;
  // The database checks the ability against its kind (f3_ability_kinds.sql). Live first: a refusal reaches the owner with the reason
  // and nothing is saved in the card file (cards.json must stay valid). A network failure stays best-effort.
  const live = await syncAbilityLive(supabase, c.id, ability);
  if (live.refused) return res.status(400).json({ ok: false, error: live.refused });
  updateCard(c.id, { ability });
  touch(c.id);
  res.json({ ok: true, ability });
});

// Lock / unlock ONE tier from trading. Gold never trades (a hard rule), so it is
// always locked and cannot be toggled. Updates that tier's live Supabase row.
app.post('/api/tradeable/:id/:slot', async (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const slot = req.params.slot;
  if (slot === 'gold') return res.json({ ok: true, tradeable: false, locked: true });
  const tradeable = req.body?.tradeable !== false;
  setSlotDetails(c.id, slot, { tradeable });
  touch(c.id);
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', c.id).maybeSingle();
    if (subject) await supabase.from('cards').update({ tradeable }).eq('subject_id', subject.id).eq('rarity', slot);
  } catch { /* live sync is best-effort */ }
  res.json({ ok: true, tradeable });
});

// Set (or clear) the "pull art from another card" source for a slot.
app.post('/api/artsource/:id/:slot', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const { fromId, fromSlot } = req.body || {};
  const source = setSource(c.id, req.params.slot, fromId, fromSlot);
  for (const f of readdirSync(OUT).filter((n) => n.startsWith(`gallery-${c.id}-`))) {
    try { unlinkSync(join(OUT, f)); } catch { /* ignore */ }
  }
  touch(c.id);
  res.json({ ok: true, source });
});

// Upload art for one slot of a card (base64 data URL).
app.post('/api/art/:id/:slot', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const slot = req.params.slot;
  const m = /^data:(image\/\w+);base64,(.+)$/s.exec(req.body.dataUrl || '');
  if (!m) return res.status(400).json({ error: 'bad image' });
  const ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
  for (const f of readdirSync(ART).filter((n) => n.startsWith(`${c.id}-${slot}.`))) unlinkSync(join(ART, f));
  writeFileSync(join(ART, `${c.id}-${slot}.${ext}`), Buffer.from(m[2], 'base64'));
  setSource(c.id, slot, '', ''); // uploading own art overrides any "pull from" source
  touch(c.id);
  res.json({ ok: true });
});

// Pushes run in the background, one at a time, so the studio stays responsive:
// upload art, frame, and queue other cards while a card renders.
const pushStatus = new Map(); // card id -> 'queued' | 'rendering' | 'done' | 'error: …'
const pushProgress = new Map(); // card id -> 0..1 while rendering
const pushQueue = [];
// How many cards render at once. Each render uses Blender (CPU-heavy), so keep
// this modest; override with PUSH_CONCURRENCY.
const CONCURRENCY = Number(process.env.PUSH_CONCURRENCY) || 2;
let active = 0;

function processQueue() {
  while (active < CONCURRENCY && pushQueue.length) {
    active += 1;
    runPush(pushQueue.shift());
  }
}

async function runPush(id) {
  pushStatus.set(id, 'rendering');
  pushProgress.set(id, 0);
  try {
    const c = cardById(id);
    const artFor = (rarity) => resolveArtFile(c.id, artKeyFor(rarity));
    await pushCard(c, artFor, OUT, (done, total) => {
      pushProgress.set(id, total ? done / total : 0);
    });
    pushStatus.set(id, 'done');
    pushProgress.set(id, 1);
    updateCard(id, { pushedAt: Date.now(), setMoveFrom: undefined }); // now live + up to date (clears "dirty"; a home set move is done)
  } catch (e) {
    pushStatus.set(id, `error: ${e.message || e}`);
  } finally {
    active -= 1;
    processQueue();
  }
}

// Queue one card for push (each finish uses its own slot's art + framing).
app.post('/api/push/:id', (req, res) => {
  const c = cardById(req.params.id);
  if (!c) return res.status(404).json({ error: 'no card' });
  const state = pushStatus.get(c.id);
  if (state !== 'rendering' && !pushQueue.includes(c.id)) {
    pushQueue.push(c.id);
    pushStatus.set(c.id, 'queued');
  }
  processQueue();
  res.json({ ok: true, status: pushStatus.get(c.id) });
});

// Current push queue/render status + progress for every card, for the UI poll.
app.get('/api/push-status', (req, res) => {
  res.json({
    statuses: Object.fromEntries(pushStatus),
    progress: Object.fromEntries(pushProgress),
    busy: active > 0,
  });
});

// "Render real look" (the tier editor): render one animated tier exactly as a push does (renderTier), with NO
// upload, so the real foil / Full Art / Gold look shows before a push. One render at a time (Blender is slow, ~1 min).
// The result stays in out/preview/; GET answers it while it is newer than the card's last edit and its art.
const PREVIEW = join(OUT, 'preview');
mkdirSync(PREVIEW, { recursive: true });
let previewBusy = null; // "<id>/<rarity>" while a render runs
const previewFile = (id, rarity) => join(PREVIEW, `${id}-${rarity}.webp`);
const previewFresh = (c, rarity) => {
  const f = previewFile(c.id, rarity);
  if (!existsSync(f)) return false;
  const at = statSync(f).mtimeMs;
  const art = resolveArtFile(c.id, artKeyFor(rarity));
  return at > (c.updatedAt || 0) && (!art || at > statSync(art).mtimeMs);
};
const previewUrl = (id, rarity) => `/api/preview/${encodeURIComponent(id)}/${rarity}/image?t=${Math.round(statSync(previewFile(id, rarity)).mtimeMs)}`;
app.get('/api/preview/:id/:rarity', (req, res) => {
  const c = cardById(req.params.id);
  if (!c || !c.finishes.includes(req.params.rarity)) return res.status(404).json({ ok: false, error: 'no such tier' });
  const fresh = previewFresh(c, req.params.rarity);
  res.json({ ok: true, fresh, url: fresh ? previewUrl(c.id, req.params.rarity) : null, busy: previewBusy });
});
app.get('/api/preview/:id/:rarity/image', (req, res) => {
  const c = cardById(req.params.id);
  if (!c || !existsSync(previewFile(c.id, req.params.rarity))) return res.status(404).end();
  res.type('image/webp').sendFile(previewFile(c.id, req.params.rarity));
});
app.post('/api/preview/:id/:rarity', async (req, res) => {
  const c = cardById(req.params.id);
  const { rarity } = req.params;
  if (!c || !c.finishes.includes(rarity)) return res.status(404).json({ ok: false, error: 'no such tier' });
  if (!ANIMATED.has(rarity)) return res.status(400).json({ ok: false, error: 'This tier is not animated: the preview is already its real look.' });
  if (!resolveArtFile(c.id, artKeyFor(rarity))) return res.status(400).json({ ok: false, error: 'Add art to this tier first.' });
  if (previewBusy) return res.status(409).json({ ok: false, error: `Another render runs (${previewBusy}). Try again in a minute.` });
  previewBusy = `${c.id}/${rarity}`;
  const work = join(PREVIEW, 'work');
  try {
    mkdirSync(work, { recursive: true });
    const { file } = await renderTier(c, rarity, (r) => resolveArtFile(c.id, artKeyFor(r)), work);
    writeFileSync(previewFile(c.id, rarity), readFileSync(file));
    res.json({ ok: true, url: previewUrl(c.id, rarity) });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'The render failed: ' + (e.message || e) });
  } finally {
    previewBusy = null;
  }
});

// Listen only when run as the program (node src/server.js); a test imports the app.
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const PORT = Number(process.env.PORT) || 4321;
  app.listen(PORT, () => console.log(`Card Studio -> http://localhost:${PORT}/admin/  (the cards: /admin/#/cards)`));
}
