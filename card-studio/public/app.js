const el = (id) => document.getElementById(id);
let cards = [];
let current = null;
let view = 'grid';

// The tier catalog comes from the server (rarity.js is the single source of
// truth). initTiers() fills these before the first render, so adding a tier in
// rarity.js needs NO edit here — its label, order, color, and flags flow in.
let TIERS = [];
let RARITY_ORDER = [];
let SPECIAL_TIERS = []; // manual tiers (out of the draw pool; need a period)
let HOLO_TIERS = new Set(); // foil tiers that get the holographic sheen overlay
let FINISH_LABEL = {};

async function initTiers() {
  TIERS = await (await fetch('/api/tiers')).json();
  RARITY_ORDER = TIERS.map((t) => t.key);
  SPECIAL_TIERS = TIERS.filter((t) => t.needsPeriod).map((t) => t.key);
  HOLO_TIERS = new Set(TIERS.filter((t) => t.animated).map((t) => t.key));
  FINISH_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]));
  // Chip + gallery-finish colors are generated from each tier's accent, so a
  // new tier is colored automatically with no CSS edit.
  const css = TIERS.map((t) => `.chip.${t.key}{background:${t.accent}}.gfin.${t.key}{background:${t.accent}}`).join('');
  let tag = document.getElementById('tier-colors');
  if (!tag) { tag = document.createElement('style'); tag.id = 'tier-colors'; document.head.appendChild(tag); }
  tag.textContent = css;
}

async function load() {
  cards = await (await fetch('/api/cards')).json();
  render();
}

function updateStats() {
  const fully = cards.filter((c) => c.total > 0 && c.filled === c.total).length;
  const live = cards.filter((c) => c.pushed).length;
  el('stats').textContent = `${cards.length} cards · ${fully} fully arted · ${live} live`;
  updateBadge();
}

// Red count on the "Queue Render" button = cards with unpushed changes.
function updateBadge() {
  const n = cards.filter((c) => c.dirty).length;
  const b = el('push-badge');
  if (!b) return;
  b.textContent = n;
  b.classList.toggle('hidden', n === 0);
}

// Re-pull the card list (fresh "dirty" flags) and update the badge live, so an
// edit like reframing lights up the count immediately without a page reload.
async function refreshBadge() {
  try {
    cards = await (await fetch('/api/cards')).json();
    updateBadge();
  } catch { /* ignore */ }
}

function render() {
  updateStats();
  el('grid').classList.toggle('hidden', view !== 'grid');
  el('gallery').classList.toggle('hidden', view !== 'gallery');
  if (view === 'grid') renderGrid();
  else renderGallery();
}

function bestFinish(c) {
  return [...c.finishes].sort((a, b) => RARITY_ORDER.indexOf(b) - RARITY_ORDER.indexOf(a))[0];
}

function renderGallery() {
  const q = el('search').value.trim().toLowerCase();
  const box = el('gallery');
  box.innerHTML = '';
  for (const c of cards) {
    if (q && !`${c.name} ${c.genre}`.toLowerCase().includes(q)) continue;
    for (const f of c.finishes) {
      // pushed finishes use the live Supabase file (specials animate);
      // everything else renders on demand from /face.
      const liveUrl = c.pushed && c.live && c.live[f];
      const src = liveUrl || `/face/${c.id}/${f}`;
      const g = document.createElement('div');
      g.className = 'gcard';
      g.innerHTML =
        `<div class="gframe"><canvas class="thumb" data-src="${src}"></canvas></div>` +
        `<div class="gcap">${c.name}<br><span class="gfin ${f}">${f.replace(/_/g, ' ')}</span></div>`;
      g.onclick = () => openCard(c);
      box.appendChild(g);
    }
  }
  // Freeze animated foils so the grid sits still (one frame drawn to a canvas).
  box.querySelectorAll('canvas.thumb').forEach((cv) => {
    const im = new Image();
    im.onload = () => {
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
    };
    im.src = cv.dataset.src;
  });
}

function renderGrid() {
  const q = el('search').value.trim().toLowerCase();
  const grid = el('grid');
  grid.innerHTML = '';
  for (const c of cards) {
    if (q && !(`${c.name} ${c.genre}`.toLowerCase().includes(q))) continue;
    const tile = document.createElement('div');
    tile.className = 'tile' + (c.pushed ? ' live' : '');
    tile.innerHTML =
      `<div class="tname">${c.name}</div>` +
      `<div class="tgenre">${c.genre}</div>` +
      `<div class="chips">${c.finishes.map((f) => `<span class="chip ${f}"></span>`).join('')}</div>` +
      `<div class="tstatus">🎨 ${c.filled}/${c.total} art${c.pushed ? ' · 🟢 live' : ''}</div>`;
    tile.onclick = () => openCard(c);
    grid.appendChild(tile);
  }
}

function openCard(c) {
  current = c;
  el('d-name').value = c.name || ''; // the Title is the only card-wide field
  el('d-tradeable').checked = c.tradeable !== false; // card-level trade lock
  el('push-status').textContent = '';
  el('pbar-row').classList.add('hidden');
  renderPreviews();
  el('overlay').classList.remove('hidden');
}

// The card level holds only the Title + the tier list (finishes).
function cardBody(finishes) {
  return { name: el('d-name').value.trim(), finishes: finishes || current.finishes };
}
async function saveCardDetails() {
  if (!current) return;
  const r = await (await fetch('/api/cards/' + current.id, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cardBody()),
  })).json();
  if (!r.ok) { el('push-status').textContent = '❌ ' + r.error; return; }
  Object.assign(current, r.card);
  // The Title renders on every tier's face, so refresh the previews.
  renderPreviews();
  if (tierRarity && !el('tier-editor').classList.contains('hidden')) refreshTierFrame(false);
  load();
}
// The Title saves at the card level; the subject / description / season / event
// are per tier and save to that tier (see saveTierDetails).
el('d-name').addEventListener('change', saveCardDetails);
// Card-level trade lock. Applies to all tiers; reflects in the live DB at once.
el('d-tradeable').addEventListener('change', async () => {
  if (!current) return;
  const tradeable = el('d-tradeable').checked;
  await fetch(`/api/tradeable/${current.id}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tradeable }),
  });
  current.tradeable = tradeable;
  load();
});
['d-genre', 'd-lore', 'd-season', 'd-event'].forEach((id) =>
  el(id).addEventListener('change', saveTierDetails));

// Save the per-tier subject / description / season / event for the open tier.
async function saveTierDetails() {
  if (!current || !tierSlot) return;
  const body = {
    genre: el('d-genre').value.trim(),
    lore: el('d-lore').value.trim(),
    season: el('d-season').value.trim(),
    event: el('d-event').value.trim(),
  };
  const r = await (await fetch(`/api/details/${current.id}/${tierSlot}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  if (!r.ok) { el('push-status').textContent = '❌ ' + r.error; return; }
  const s = current.slots.find((x) => x.slot === tierSlot);
  if (s) s.details = r.details;
  refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
}

const slotOf = (rarity) => rarity; // each tier has its own art slot now

// --- Framing editor: drag to pan, scroll / buttons to zoom, then save. ---
let framerSlot = null;
let framerState = { x: 50, y: 50, scale: 1 };

function openFramer(slot) {
  framerSlot = slot;
  el('framer-title').textContent = 'Frame · ' + slot.replace(/_/g, ' ');
  el('framer-frame').src = `/card/${current.id}/${slot}?edit=1&t=${Date.now()}`;
  el('framer').classList.remove('hidden');
}

function frameMsg(msg) {
  const f = el('framer-frame');
  if (f.contentWindow) f.contentWindow.postMessage(msg, '*');
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'frame') {
    framerState = { x: e.data.x, y: e.data.y, scale: e.data.scale };
    el('zoom-range').value = e.data.scale;
  }
});

el('zoom-in').onclick = () => frameMsg({ type: 'frameZoom', scale: Math.min(4, framerState.scale + 0.1) });
el('zoom-out').onclick = () => frameMsg({ type: 'frameZoom', scale: Math.max(1, framerState.scale - 0.1) });
el('zoom-range').oninput = (e) => frameMsg({ type: 'frameZoom', scale: parseFloat(e.target.value) });
el('framer-reset').onclick = () => frameMsg({ type: 'frameReset' });
el('framer-close').onclick = () => el('framer').classList.add('hidden');
el('framer-save').onclick = async () => {
  await fetch(`/api/frame/${current.id}/${framerSlot}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(framerState),
  });
  el('framer').classList.add('hidden');
  if (typeof refreshTierFrame === 'function' && tierSlot === framerSlot) refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
};

function renderPreviews() {
  const box = el('previews');
  box.innerHTML = '';
  for (const f of current.finishes) {
    const slot = current.slots.find((s) => s.slot === slotOf(f));
    const hasArt = slot ? slot.hasArt : false;
    // A pushed tier has a live rendered image (the real foil / gold / holo look).
    // Show that (frozen to a still); otherwise show the flat editable preview.
    const liveUrl = current.live && current.live[f];
    const pv = document.createElement('div');
    pv.className = 'pv' + (hasArt ? '' : ' empty');
    const frame = liveUrl
      ? `<div class="frame"><canvas class="thumb" data-src="${liveUrl}"></canvas></div>`
      : `<div class="frame"><iframe src="/card/${current.id}/${f}?t=${Date.now()}"></iframe>` +
        `${hasArt ? '' : '<div class="pv-empty">＋ Add art</div>'}</div>`;
    pv.innerHTML = frame + `<div class="pvlabel">${f.replace(/_/g, ' ')}</div>`;
    pv.onclick = () => openTier(f);
    box.appendChild(pv);
  }
  // "+ Add Tier" card at the end of the row (if any tier isn't on the card yet).
  const addable = RARITY_ORDER.filter((r) => !current.finishes.includes(r));
  if (addable.length) {
    const add = document.createElement('div');
    add.className = 'pv addtier-card';
    add.innerHTML = '<div class="frame add-frame"><span>＋ Add Tier</span></div><div class="pvlabel">&nbsp;</div>';
    add.onclick = openAddTier;
    box.appendChild(add);
  }
  freezeThumbs(box);
}

// Draw one frame of each live (animated) image to a canvas, so the rendered
// foil look sits still in the tier row.
function freezeThumbs(root) {
  root.querySelectorAll('canvas.thumb').forEach((cv) => {
    const im = new Image();
    im.onload = () => {
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
    };
    im.src = cv.dataset.src;
  });
}

function openAddTier() {
  const addable = RARITY_ORDER.filter((r) => !current.finishes.includes(r));
  el('addtier-list').innerHTML = addable
    .map((r) => `<button class="addtier-opt" data-r="${r}"><span class="chip ${r}"></span>${FINISH_LABEL[r]}</button>`)
    .join('');
  el('addtier-list').querySelectorAll('.addtier-opt').forEach((b) => { b.onclick = () => addTier(b.dataset.r); });
  el('addtier').classList.remove('hidden');
}

async function addTier(rarity) {
  const finishes = [...current.finishes, rarity];
  const r = await (await fetch('/api/cards/' + current.id, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cardBody(finishes)),
  })).json();
  el('addtier').classList.add('hidden');
  if (!r.ok) { el('push-status').textContent = '❌ ' + r.error; return; }
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  renderPreviews();
  openTier(rarity); // jump straight into the new tier (art + its own details)
}

el('addtier-close').onclick = () => el('addtier').classList.add('hidden');

// --- Per-tier editor: upload art, frame it, set the artist for one tier. ---
let tierRarity = null;
let tierSlot = null;

// The main preview shows the real rendered card (the live animated foil / gold /
// holo) for a pushed tier. Right after an edit (upload / frame / details) we pass
// preferLive=false to show the flat editable preview, so the change is visible
// until it is pushed again.
function refreshTierFrame(preferLive = true) {
  const stage = el('tier-stage');
  const liveUrl = preferLive && current.live && current.live[tierRarity];
  if (liveUrl) {
    // Freeze the live render to a still (one frame), so the foil look shows
    // without the animated card rocking and opening a gap at the frame edge.
    // A holographic sheen overlay (foil tiers) follows the mouse over the card.
    const foil = HOLO_TIERS.has(tierRarity);
    stage.innerHTML = `<canvas class="tier-live thumb" data-src="${liveUrl}"></canvas>` +
      (foil ? '<div class="holo"></div><div class="glare"></div>' : '');
    stage.classList.toggle('holo-on', foil);
    freezeThumbs(stage);
  } else {
    stage.classList.remove('holo-on');
    stage.innerHTML = '<iframe id="tier-frame"></iframe>';
    el('tier-frame').src = `/card/${current.id}/${tierRarity}?t=${Date.now()}`;
  }
}

// The holographic sheen follows the mouse over the studio's tier preview.
(() => {
  const stage = el('tier-stage');
  stage.addEventListener('mousemove', (e) => {
    if (!stage.classList.contains('holo-on')) return;
    const r = stage.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100;
    const py = ((e.clientY - r.top) / r.height) * 100;
    stage.style.setProperty('--hx', px + '%');
    stage.style.setProperty('--hy', py + '%');
    stage.style.setProperty('--gx', px + '%');
    stage.style.setProperty('--gy', py + '%');
    const mag = Math.min(1, Math.hypot((px - 50) / 50, (py - 50) / 50));
    stage.style.setProperty('--holo-opacity', (0.18 + mag * 0.55).toFixed(3));
  });
  stage.addEventListener('mouseleave', () => {
    stage.style.setProperty('--holo-opacity', '0.28');
    stage.style.setProperty('--hx', '50%'); stage.style.setProperty('--hy', '50%');
    stage.style.setProperty('--gx', '50%'); stage.style.setProperty('--gy', '50%');
  });
})();

function openTier(rarity) {
  tierRarity = rarity;
  tierSlot = slotOf(rarity);
  const slot = current.slots.find((s) => s.slot === tierSlot);
  el('tier-title').textContent = rarity.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
  el('tier-artist').value = (slot && slot.artist) || '';
  // This tier's own subject / description / season / event.
  const det = (slot && slot.details) || {};
  el('d-genre').value = det.genre || '';
  el('d-lore').value = det.lore || '';
  el('d-season').value = det.season || '';
  el('d-event').value = det.event || '';
  // The Event / Promo period only applies to a manual tier.
  el('d-event').classList.toggle('hidden', !SPECIAL_TIERS.includes(rarity));
  populateSource(slot);
  populateDetailSource();
  refreshTierFrame();
  el('tier-editor').classList.remove('hidden');
}

// The "pull details from another tier" list — the OTHER tiers of this card.
// Choosing one copies its subject / description / season / event into this tier.
function populateDetailSource() {
  const sel = el('cd-source');
  let html = "<option value=''>— This tier's own details —</option>";
  for (const s of current.slots) {
    if (s.slot === tierSlot) continue;
    html += `<option value="${s.slot}">${s.label}</option>`;
  }
  sel.innerHTML = html;
  sel.value = '';
}

el('cd-source').onchange = async () => {
  const fromSlot = el('cd-source').value;
  el('cd-source').value = '';
  if (!fromSlot) return;
  const s = current.slots.find((x) => x.slot === fromSlot);
  const det = (s && s.details) || {};
  el('d-genre').value = det.genre || '';
  el('d-lore').value = det.lore || '';
  el('d-season').value = det.season || '';
  el('d-event').value = det.event || '';
  await saveTierDetails();
};

function populateSource(slot) {
  const sel = el('tier-source');
  let html = "<option value=''>— Use this tier's own uploaded art —</option>";
  // Only pull art from OTHER tiers of THIS card.
  const arted = current.slots.filter((s) => s.hasArt && s.slot !== tierSlot);
  for (const s of arted) html += `<option value="${current.id}|${s.slot}">${s.label}</option>`;
  sel.innerHTML = html;
  const src = slot && slot.source;
  sel.value = src ? `${src.fromId}|${src.fromSlot}` : '';
}

el('tier-source').onchange = async () => {
  const v = el('tier-source').value;
  const [fromId, fromSlot] = v ? v.split('|') : ['', ''];
  await fetch(`/api/artsource/${current.id}/${tierSlot}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromId, fromSlot }),
  });
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  refreshTierFrame(false);
  renderPreviews();
};

el('tier-close').onclick = () => el('tier-editor').classList.add('hidden');
el('tier-upload').onclick = () => pickFile(tierSlot);
el('tier-framebtn').onclick = () => openFramer(tierSlot);
el('tier-delete').onclick = async () => {
  const label = FINISH_LABEL[tierRarity] || tierRarity;
  const finishes = current.finishes.filter((f) => f !== tierRarity);
  if (!finishes.length) { el('push-status').textContent = 'A card needs at least one tier.'; return; }
  if (!confirm(`Remove the ${label} tier from this card?`)) return;
  if (!confirm(`Final check — this deletes ${label} from the LIVE game (and anyone who owns it). Remove for good?`)) return;
  const r = await (await fetch('/api/cards/' + current.id, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cardBody(finishes)),
  })).json();
  el('tier-editor').classList.add('hidden');
  if (!r.ok) { el('push-status').textContent = '❌ ' + r.error; return; }
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  renderPreviews();
};
el('tier-artist').onchange = async () => {
  await fetch(`/api/artist/${current.id}/${tierSlot}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: el('tier-artist').value.trim() }),
  });
  const s = current.slots.find((x) => x.slot === tierSlot);
  if (s) s.artist = el('tier-artist').value.trim();
  refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
};
// Drag-and-drop onto the tier editor
const tierDrop = el('tier-drop');
['dragover', 'drop'].forEach((ev) =>
  tierDrop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' && e.dataTransfer.files[0]) upload(tierSlot, e.dataTransfer.files[0]);
  }),
);

function pickFile(slot) {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = 'image/*';
  i.onchange = () => i.files[0] && upload(slot, i.files[0]);
  i.click();
}

async function upload(slot, file) {
  const dataUrl = await new Promise((r) => {
    const fr = new FileReader();
    fr.onload = () => r(fr.result);
    fr.readAsDataURL(file);
  });
  await fetch(`/api/art/${current.id}/${slot}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  });
  const s = current.slots.find((x) => x.slot === slot);
  if (s) s.hasArt = true;
  if (tierSlot === slot) refreshTierFrame(false);
  renderPreviews();
  load();
}

el('close').onclick = () => el('overlay').classList.add('hidden');

let polling = null;
function nameFor(id) {
  const c = cards.find((x) => x.id === id);
  return c ? c.name : id;
}
function ensurePolling() {
  if (!polling) polling = setInterval(refreshStatus, 1500);
  refreshStatus();
}
async function refreshStatus() {
  const { statuses, progress } = await (await fetch('/api/push-status')).json();
  const renderingIds = Object.keys(statuses).filter((k) => statuses[k] === 'rendering');
  const queued = Object.keys(statuses).filter((k) => statuses[k] === 'queued');

  const parts = [];
  for (const id of renderingIds) {
    const pct = Math.round((progress[id] || 0) * 100);
    parts.push(`⚙ ${nameFor(id)} ${pct}%`);
  }
  if (queued.length) parts.push(`⏳ ${queued.length} queued`);
  el('pushq').textContent = parts.join(' · ');

  // Progress bar + status for the card currently open in the overlay.
  if (current && statuses[current.id]) {
    const s = statuses[current.id];
    const pct = Math.round((progress[current.id] || 0) * 100);
    const showBar = s === 'rendering' || (s === 'queued' && renderingIds.length);
    el('pbar-row').classList.toggle('hidden', !showBar);
    el('pfill').style.width = `${s === 'rendering' ? pct : 0}%`;
    el('push-status').textContent =
      s === 'done' ? '✅ pushed live' :
      s === 'rendering' ? `⚙ rendering… ${pct}%` :
      s === 'queued' ? '⏳ queued — you can keep working on other cards' :
      `❌ ${s}`;
  } else if (current) {
    el('pbar-row').classList.add('hidden');
  }

  if (!renderingIds.length && !queued.length) {
    clearInterval(polling);
    polling = null;
    el('pushq').textContent = '';
    load(); // refresh live badges once the queue drains
  }
}

// The one place to render: queue every card that has unpushed changes.
el('pushall').onclick = async () => {
  const ready = cards.filter((c) => c.dirty);
  if (!ready.length) {
    el('pushq').textContent = 'Everything is up to date — nothing to render.';
    setTimeout(() => { if (!polling) el('pushq').textContent = ''; }, 4000);
    return;
  }
  el('pushall').disabled = true;
  for (const c of ready) {
    await fetch('/api/push/' + c.id, { method: 'POST' });
  }
  el('pushall').disabled = false;
  ensurePolling();
};

// --- Create a new card in the portal ---
// A new card starts with just a name + season. The subject, description,
// artwork, and tiers are all added on the card screen that opens next — the
// tiers via each preview and the "+ Add Tier" card.
function openCreator() {
  el('creator-title').textContent = 'Create a new card';
  el('c-name').value = '';
  el('c-season').value = 'Season 1';
  el('creator-status').textContent = '';
  el('creator').classList.remove('hidden');
  el('c-name').focus();
}

el('newcard').onclick = openCreator;
el('creator-close').onclick = () => el('creator').classList.add('hidden');
el('creator-save').onclick = async () => {
  const name = el('c-name').value.trim();
  const season = el('c-season').value.trim();
  if (!name) return (el('creator-status').textContent = 'Enter a card name.');
  if (!season) return (el('creator-status').textContent = 'Enter a season / origin.');
  el('creator-save').disabled = true;
  const r = await (await fetch('/api/cards', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, season, finishes: [] }),
  })).json();
  el('creator-save').disabled = false;
  if (!r.ok) return (el('creator-status').textContent = `❌ ${r.error}`);
  el('creator').classList.add('hidden');
  await load();
  const card = cards.find((c) => c.id === r.card.id);
  if (card) openCard(card);
};

el('search').oninput = render;
el('view').onclick = () => {
  view = view === 'grid' ? 'gallery' : 'grid';
  el('view').textContent = view === 'grid' ? '🖼 Gallery' : '▦ Grid';
  render();
};

initTiers().then(load).then(() => {
  // Deep-link: /#card=<id> opens that card's panel.
  const m = location.hash.match(/card=(.+)/);
  if (m) {
    const c = cards.find((x) => x.id === decodeURIComponent(m[1]));
    if (c) openCard(c);
  }
});
