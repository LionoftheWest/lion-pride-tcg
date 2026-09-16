import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { fillHtml, renderPng } from './render.js';
import { pushCard } from './push.js';
import { supabase } from './supabase.js';
import { artKeyFor, artSlots, SLOT_LABEL, ORDER, slugify, needsPeriod, tiersPublic } from './rarity.js';
import { getFrame, setFrame } from './frames.js';
import { getArtist, setArtist } from './artists.js';
import { getSource, setSource } from './artsources.js';
import { getCards, getCard, addCard, updateCard, deleteCard, slotDetails, setSlotDetails } from './cardstore.js';

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

const app = express();
app.use(express.json({ limit: '30mb' }));
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

  // live image URLs per pushed card, so the gallery can show real (animated) faces
  const { data: dbCards } = await supabase
    .from('cards')
    .select('rarity, image_url, subject:subjects(key)');
  const live = {};
  for (const row of dbCards || []) {
    const key = row.subject?.key;
    if (!key) continue;
    (live[key] ||= {})[row.rarity] = row.image_url;
  }

  res.json(
    cards.map((c) => {
      const slots = artSlots(c.finishes).map((slot) => ({
        slot,
        label: SLOT_LABEL[slot],
        hasArt: Boolean(resolveArtFile(c.id, slot)),
        artist: getArtist(c.id, slot),
        source: getSource(c.id, slot),
        details: slotDetails(c, slot), // per-tier subject / description / season / event
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
        manual: true, // every card lives in the portal store now (editable + deletable)
        dirty: Boolean(dirty),
      };
    }),
  );
});

// Create a new card in the portal (the portal is the source of truth).
app.post('/api/cards', (req, res) => {
  const { name, genre, lore, season, event, finishes } = req.body || {};
  const cleanName = (name || '').trim();
  if (!cleanName) return res.status(400).json({ error: 'A card name is required.' });
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
  updateCard(id, card);

  // Best-effort: reflect the edit in the live bot, if this card was pushed. Only
  // the name is card-wide; per-tier text syncs through /api/details.
  let sync = 'saved (not live yet)';
  try {
    const { data: subject } = await supabase.from('subjects').select('id').eq('key', id).maybeSingle();
    if (subject) {
      await supabase.from('subjects').update({ name: card.name }).eq('id', subject.id);
      await supabase.from('cards').update({ name: card.name }).eq('subject_id', subject.id);
      if (removed.length) {
        const { data: rows } = await supabase
          .from('cards').select('id').eq('subject_id', subject.id).in('rarity', removed);
        const rowIds = (rows || []).map((r) => r.id);
        if (rowIds.length) {
          await supabase.from('player_cards').delete().in('card_id', rowIds);
          await supabase.from('cards').delete().in('id', rowIds);
        }
        await supabase.storage.from(BUCKET).remove(removed.flatMap((r) => [`cards/${id}-${r}.webp`, `cards/${id}-${r}.png`]));
      }
      sync = removed.length ? `live: updated, removed ${removed.join(', ')}` : 'live: updated';
    }
  } catch (e) {
    sync = 'saved locally; live sync failed: ' + (e.message || e);
  }
  res.json({ ok: true, card, sync });
});

// Remove a card from the portal store.
app.delete('/api/cards/:id', (req, res) => {
  const ok = deleteCard(req.params.id);
  if (!ok) return res.status(404).json({ error: 'No such card.' });
  res.json({ ok: true });
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
  const { genre, lore, season, event } = req.body || {};
  const patch = {};
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
    updateCard(id, { pushedAt: Date.now() }); // now live + up to date (clears "dirty")
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

const PORT = Number(process.env.PORT) || 4321;
app.listen(PORT, () => console.log(`Card Studio -> http://localhost:${PORT}`));
