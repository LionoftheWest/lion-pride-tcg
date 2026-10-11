// Lion Pride TCG - Admin view: the Cards section (the card editor, formerly the Card Portal at /, F-2 PR 1).
// #/cards = the card list (grid or gallery), #/cards/<id> = one card (name, card info, tiers).
// Data: the studio API in src/server.js (/api/tiers, /api/cards, /api/details, /api/art, /api/push ...). These routes do not
// need ADMIN_VIEW: the Cards section works with the flag off, like the old portal. The studio login (src/studio-auth.js) covers them.
// The shell (admin.js) passes its helpers in `k`. Every card text goes in as textContent or a value, never as HTML.

// The grid copy of a card image (card-studio/src/thumbs.js; the same rule as tcg-activity/src/thumb.js).
const GRID_PARTS = /\/card-art\/(cards\/[^?]+?)\.(png|webp|jpe?g)(\?|$)/i;
const gridThumb = (url) => (url ? url.replace(GRID_PARTS, '/card-art/grid/$1.webp$3') : url);
const $ = (id) => document.getElementById(id);
const JSON_HEAD = { 'content-type': 'application/json' };
const post = (url, body, method = 'POST') => fetch(url, { method, headers: JSON_HEAD, body: JSON.stringify(body) });

let k = null; // the shell helpers
let mode = null; // 'list' | 'card'
let cards = [];
let current = null;
let view = 'grid';
let query = '';

// The tier catalog comes from the server (src/rarity.js is the single source of truth), so a new tier needs no edit here.
let TIERS = [];
let RARITY_ORDER = [];
let SPECIAL_TIERS = []; // manual tiers (out of the draw pool; need a period)
let HOLO_TIERS = new Set(); // foil tiers that get the holographic sheen overlay
let FINISH_LABEL = {};

async function initTiers() {
  if (TIERS.length) return;
  TIERS = await (await fetch('/api/tiers')).json();
  RARITY_ORDER = TIERS.map((t) => t.key);
  SPECIAL_TIERS = TIERS.filter((t) => t.needsPeriod).map((t) => t.key);
  HOLO_TIERS = new Set(TIERS.filter((t) => t.animated).map((t) => t.key));
  FINISH_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]));
  // The tier dot and the gallery label colors come from each tier's accent, so a new tier is colored with no CSS edit.
  const css = TIERS.map((t) => `.cs-dot.${t.key}{background:${t.accent}}.cs-fin.${t.key}{background:${t.accent}}`).join('');
  let tag = $('cs-tier-colors');
  if (!tag) { tag = document.createElement('style'); tag.id = 'cs-tier-colors'; document.head.appendChild(tag); }
  tag.textContent = css;
}

let cssOnce = false;
function css() {
  if (cssOnce) return;
  cssOnce = true;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/admin/cards.css' }));
}

const tierName = (r) => r.replace(/_/g, ' ');

export async function pageCardEditor(main, args, q, helpers) {
  k = helpers;
  css();
  const id = args[0] && args[0] !== 'undefined' ? args[0] : null;
  main.append(h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading'));
  try {
    await initTiers();
    cards = await (await fetch('/api/cards')).json();
  } catch (e) {
    main.replaceChildren(k.errorState(e, () => k.render()));
    return;
  }
  main.replaceChildren();
  if (id) cardPage(main, id);
  else listPage(main);
}

const h = (...a) => k.h(...a);
const icon = (n) => k.icon(n);

// A dialog over the page (the tier editor, the framer, add a tier, new card). It lives in <main>, so a route change removes it.
function dialog(id, title, body, { cls = '' } = {}) {
  const close = () => { wrap.hidden = true; };
  const wrap = h('div', { class: 'cs-back', id, hidden: true },
    h('div', { class: `cs-dialog ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'cs-dhead' }, h('h2', { id: `${id}-title`, text: title }),
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', id: `${id}-close`, onclick: close }, icon('x'))),
      body));
  return wrap;
}
const field = (lbl, input, note) => h('label', { class: 'cs-field' }, h('span', { class: 'lbl' }, lbl, note ? h('span', { class: 'cs-note' }, ` ${note}`) : null), input);

/* ================= the list ================= */
function listPage(main) {
  mode = 'list';
  current = null;
  const search = h('input', { class: 'field', id: 'cs-search', type: 'search', placeholder: 'Search cards', 'aria-label': 'Search cards', value: query });
  search.addEventListener('input', () => { query = search.value; renderList(); });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
    [['grid', 'Grid', 'grid'], ['gallery', 'Gallery', 'layers']].map(([v, t, ic]) => h('button', { type: 'button', 'data-view': v, 'aria-pressed': String(view === v), class: view === v ? 'on' : null,
      onclick: () => { view = v; seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.view === v); b.setAttribute('aria-pressed', String(b.dataset.view === v)); }); renderList(); } }, icon(ic), t)));
  const right = h('div', { class: 'range' },
    h('span', { class: 'cs-pushq', id: 'cs-pushq', 'aria-live': 'polite' }),
    search, seg,
    h('button', { class: 'btn', id: 'cs-new', type: 'button', onclick: openCreator }, icon('plus'), 'New card'),
    h('button', { class: 'btn primary cs-render', id: 'cs-pushall', type: 'button', onclick: queueRender, title: 'Queue every card with unpushed changes for render and push' },
      icon('zap'), 'Queue render', h('span', { class: 'cs-badge num', id: 'cs-badge', hidden: true }, '0')));
  main.append(k.pageHead('Cards', h('span', { id: 'cs-stats' }, 'Loading'), right));
  main.append(h('section', { class: 'panel' }, h('div', { class: 'cs-grid', id: 'cs-grid' }), h('div', { class: 'cs-gallery', id: 'cs-gallery', hidden: true })));
  main.append(creatorDialog());
  renderList();
  if (polling) refreshStatus();
}

function updateStats() {
  const fully = cards.filter((c) => c.total > 0 && c.filled === c.total).length;
  const live = cards.filter((c) => c.pushed).length;
  if ($('cs-stats')) $('cs-stats').textContent = `${cards.length} cards, ${fully} fully arted, ${live} live`;
  updateBadge();
}

// The count on the "Queue render" button = cards with unpushed changes.
function updateBadge() {
  const b = $('cs-badge');
  if (!b) return;
  const n = cards.filter((c) => c.dirty).length;
  b.textContent = n;
  b.hidden = n === 0;
}

// Pull the card list again (fresh "dirty" flags) and update the badge, so an edit like reframing shows at once.
async function refreshBadge() {
  try { cards = await (await fetch('/api/cards')).json(); updateBadge(); } catch { /* ignore */ }
}

// Pull the card list again and redraw the page that is open.
async function load() {
  cards = await (await fetch('/api/cards')).json();
  if (mode === 'list' && $('cs-grid')) renderList();
  else if (mode === 'card' && current) setCardTitle(current.name);
}

const matches = (c) => !query.trim() || `${c.name} ${c.genre}`.toLowerCase().includes(query.trim().toLowerCase());
const openCard = (c) => { location.hash = `#/cards/${encodeURIComponent(c.id)}`; };

function renderList() {
  updateStats();
  $('cs-grid').hidden = view !== 'grid';
  $('cs-gallery').hidden = view !== 'gallery';
  if (view === 'grid') renderGrid(); else renderGallery();
}

function renderGrid() {
  const shown = cards.filter(matches);
  $('cs-grid').replaceChildren(...(shown.length ? shown.map((c) => {
    const tile = h('a', { class: `cs-tile${c.pushed ? ' live' : ''}`, href: `#/cards/${encodeURIComponent(c.id)}` },
      h('span', { class: 'cs-tname' }, c.name),
      h('span', { class: 'cs-tgenre' }, c.genre || ''),
      h('span', { class: 'cs-dots' }, c.finishes.map((f) => h('span', { class: `cs-dot ${f}`, title: FINISH_LABEL[f] || f }))),
      h('span', { class: 'cs-tstatus' }, h('span', { class: 'num' }, `${c.filled}/${c.total}`), ' art', c.pushed ? h('span', { class: 'cs-live' }, 'Live') : null));
    return tile;
  }) : [h('div', { class: 'empty' }, 'No card')]));
}

function renderGallery() {
  const box = $('cs-gallery');
  const items = [];
  for (const c of cards) {
    if (!matches(c)) continue;
    for (const f of c.finishes) {
      // A pushed finish uses the live Supabase file; any other finish renders on demand from /face.
      const liveUrl = c.pushed && c.live && c.live[f];
      // The grid copy, not the full image: one studio open downloaded the whole catalog at full
      // size (~250 MB of Supabase egress, 2026-10-01). The full image is the fallback.
      const src = liveUrl ? gridThumb(liveUrl) : `/face/${c.id}/${f}`;
      const cv = h('canvas', { class: 'thumb', 'data-src': src, 'data-full': liveUrl || null });
      items.push(h('a', { class: 'cs-gcard', href: `#/cards/${encodeURIComponent(c.id)}` },
        h('div', { class: 'cs-gframe' }, cv),
        h('div', { class: 'cs-gcap' }, h('span', null, c.name), h('span', { class: `cs-fin ${f}` }, tierName(f)))));
    }
  }
  box.replaceChildren(...(items.length ? items : [h('div', { class: 'empty' }, 'No card')]));
  freezeThumbs(box);
}

// Draw one frame of each (animated) image to a canvas, so a foil sits still.
function freezeThumbs(root) {
  root.querySelectorAll('canvas.thumb').forEach((cv) => {
    const im = new Image();
    im.onload = () => { cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); };
    // A missing grid copy: the full image.
    im.onerror = () => { const full = cv.dataset.full; if (full && im.src !== full) im.src = full; };
    im.src = cv.dataset.src;
  });
}

/* ----- new card ----- */
// A new card starts with a name and a season. The subject, description, art and tiers are added on the card page.
function creatorDialog() {
  return dialog('cs-creator', 'Create a new card', h('div', null,
    field('Card name', h('input', { class: 'field', id: 'cs-c-name', placeholder: "e.g. Ash's Pikachu" })),
    field('Season / origin', h('input', { class: 'field', id: 'cs-c-season', placeholder: 'e.g. Season 1' }), '(required)'),
    h('p', { class: 'subtitle' }, 'Add the subject, description, artwork and tiers on the card page that opens next.'),
    h('div', { class: 'cs-dfoot' }, h('span', { class: 'subtitle', id: 'cs-creator-status', role: 'status' }),
      h('button', { class: 'btn primary', id: 'cs-creator-save', type: 'button', onclick: createCard }, 'Create card'))), { cls: 'narrow' });
}
function openCreator() {
  $('cs-c-name').value = '';
  $('cs-c-season').value = 'Season 1';
  $('cs-creator-status').textContent = '';
  $('cs-creator').hidden = false;
  $('cs-c-name').focus();
}
async function createCard() {
  const name = $('cs-c-name').value.trim();
  const season = $('cs-c-season').value.trim();
  if (!name) return ($('cs-creator-status').textContent = 'Enter a card name.');
  if (!season) return ($('cs-creator-status').textContent = 'Enter a season / origin.');
  $('cs-creator-save').disabled = true;
  const r = await (await post('/api/cards', { name, season, finishes: [] })).json();
  $('cs-creator-save').disabled = false;
  if (!r.ok) return ($('cs-creator-status').textContent = `Error: ${r.error}`);
  $('cs-creator').hidden = true;
  location.hash = `#/cards/${encodeURIComponent(r.card.id)}`;
}

/* ================= one card ================= */
function setCardTitle(name) {
  const t = document.querySelector('#main .page-head .title');
  if (t) t.textContent = name;
  if ($('cs-crumb')) $('cs-crumb').textContent = name;
  document.title = `${name} - Cards - Lion Pride TCG Admin`;
}

function cardPage(main, id) {
  mode = 'card';
  const c = cards.find((x) => x.id === id);
  main.append(k.pageHead('Card', h('span', { class: 'crumb' }, h('a', { href: '#/cards' }, 'Cards'), ' / ', h('span', { id: 'cs-crumb' }, id))));
  if (!c) { current = null; main.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No card with this id'))); return; }
  current = c;
  const sel = (id2, opts) => h('select', { class: 'field', id: id2 }, opts.map(([v, t]) => h('option', { value: v }, t)));
  const inp = (id2, ph, extra = {}) => h('input', { class: 'field', id: id2, placeholder: ph, ...extra });

  // The card name (card-wide; saves on change) and the render status of this card.
  const name = panel('Card', 'The title shows on every tier. It saves when you leave the field.');
  name.body.append(
    field('Card name', inp('cs-name', 'Card name')),
    h('p', { class: 'cs-msg', id: 'cs-push-status', role: 'status', 'aria-live': 'polite' }),
    h('div', { class: 'cs-progress', id: 'cs-pbar-row', hidden: true }, h('div', { class: 'bar thick' }, h('span', { id: 'cs-pfill', style: 'width:0%; background: var(--gold)' }))));

  // Card info: the tags and the ability (subject-level, hidden on the card face, shown in the Card Information view).
  const info = panel('Card info', 'Tags and ability. They are hidden on the card face and show in the Card Information view.');
  info.body.append(
    h('div', { class: 'cs-h3' }, 'Tags'),
    h('div', { class: 'cs-fgrid' },
      field('Class', sel('cs-t-class', [['attacker', 'attacker'], ['support', 'support']])),
      field('Type', sel('cs-t-type', ['Character', 'Creature', 'Item', 'Place', 'Moment'].map((x) => [x, x]))),
      field('Origin', inp('cs-t-origin', 'e.g. pokemon'), '(comma-separated)'),
      field('Genre', inp('cs-t-genre', 'e.g. moba, creature-battler')),
      field('Realm', inp('cs-t-realm', 'e.g. pokemon-world')),
      field('Traits', inp('cs-t-traits', 'e.g. water, armored'))),
    h('div', { class: 'cs-h3' }, 'Ability', h('span', { class: 'cs-note' }, ' A blank name = no ability')),
    h('div', { class: 'cs-fgrid' },
      field('Name', inp('cs-a-name', 'e.g. Tidal Guard')),
      field('Kind', sel('cs-a-kind', [['attack', 'attack'], ['support', 'support']])),
      field('Effect', inp('cs-a-effect', 'e.g. shield / lifesteal')),
      field('Amount', inp('cs-a-amount', 'e.g. 0.3', { type: 'number', step: '0.05' })),
      field('Target', inp('cs-a-target', 'e.g. ally / self / boss')),
      field('Cooldown', inp('cs-a-cooldown', 'rounds', { type: 'number', step: '1' })),
      h('div', { class: 'cs-wide' }, field('What it does', h('textarea', { class: 'field', id: 'cs-a-desc', rows: '2', placeholder: 'What it does (shown to players)' })))),
    h('div', { class: 'cs-dfoot start' }, h('button', { class: 'btn primary', id: 'cs-ci-save', type: 'button', onclick: saveCardInfo }, 'Save card info'),
      h('span', { class: 'subtitle', id: 'cs-ci-status', role: 'status' })));

  const tiers = panel('Tiers', 'Select a tier to upload its art, frame it, and edit its details.');
  tiers.body.append(h('div', { class: 'cs-previews', id: 'cs-previews' }));

  main.append(name.el, info.el, tiers.el, tierDialog(), framerDialog(), addTierDialog());
  $('cs-name').addEventListener('change', saveCardDetails);
  ['cs-d-genre', 'cs-d-lore', 'cs-d-season', 'cs-d-event'].forEach((x) => $(x).addEventListener('change', saveTierDetails));
  setupHolo();

  setCardTitle(c.name);
  $('cs-name').value = c.name || '';
  fillCardInfo(c);
  renderPreviews();
  if (polling) refreshStatus();
}

function panel(title, sub) {
  const body = h('div', { class: 'pbody' });
  const el = h('section', { class: 'panel cs-panel' }, h('div', { class: 'phead' }, h('div', { class: 'ptitles' }, h('h2', { text: title }), sub ? h('p', { class: 'subtitle', text: sub }) : null)), body);
  return { el, body };
}
const setStatus = (t) => { if ($('cs-push-status')) $('cs-push-status').textContent = t; };

// Fill the Card Info editors (tags + ability) from the card.
function fillCardInfo(c) {
  const t = c.tags || {};
  const csv = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));
  $('cs-t-class').value = t.class || (['Item', 'Place', 'Moment'].includes(c.type) ? 'support' : 'attacker');
  $('cs-t-type').value = c.type || (t.type ? t.type[0].toUpperCase() + t.type.slice(1) : 'Character');
  $('cs-t-origin').value = csv(t.origin);
  $('cs-t-genre').value = csv(t.genre);
  $('cs-t-realm').value = csv(t.realm);
  $('cs-t-traits').value = csv(t.traits);
  const a = c.ability || {};
  $('cs-a-name').value = a.name || '';
  $('cs-a-kind').value = a.kind || 'support';
  $('cs-a-effect').value = a.effect || '';
  $('cs-a-amount').value = a.amount == null ? '' : a.amount;
  $('cs-a-target').value = a.target || '';
  $('cs-a-cooldown').value = a.cooldown == null ? '' : a.cooldown;
  $('cs-a-desc').value = a.desc || '';
  $('cs-ci-status').textContent = '';
}

// The card level holds only the Title + the tier list (finishes).
function cardBody(finishes) {
  return { name: $('cs-name').value.trim(), finishes: finishes || current.finishes };
}
async function saveCardDetails() {
  if (!current) return;
  const r = await (await post('/api/cards/' + current.id, cardBody(), 'PUT')).json();
  if (!r.ok) { setStatus('Error: ' + r.error); return; }
  Object.assign(current, r.card);
  setStatus(r.sync ? `Saved: ${r.sync}` : 'Saved');
  // The Title renders on every tier's face, so refresh the previews.
  renderPreviews();
  if (tierRarity && !$('cs-tier').hidden) refreshTierFrame(false);
  load();
}

// Save the Card Info (tags + ability): subject-level, pushes live.
async function saveCardInfo() {
  if (!current) return;
  const list = (id) => $(id).value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  const tags = { class: $('cs-t-class').value, type: $('cs-t-type').value, origin: list('cs-t-origin'), genre: list('cs-t-genre'), realm: list('cs-t-realm'), traits: list('cs-t-traits') };
  const ability = { name: $('cs-a-name').value.trim(), kind: $('cs-a-kind').value, effect: $('cs-a-effect').value.trim(), amount: num('cs-a-amount'),
    target: $('cs-a-target').value.trim(), cooldown: num('cs-a-cooldown'), desc: $('cs-a-desc').value.trim() };
  $('cs-ci-status').textContent = 'Saving';
  try {
    const [r1, r2] = await Promise.all([post(`/api/tags/${current.id}`, tags).then((r) => r.json()), post(`/api/ability/${current.id}`, ability).then((r) => r.json())]);
    current.tags = r1.tags; current.ability = r2.ability;
    $('cs-ci-status').textContent = 'Saved';
    load();
  } catch (e) {
    $('cs-ci-status').textContent = 'Error: ' + (e.message || e);
  }
}

// The tier previews. A pushed tier shows its live render (the real foil / gold / holo look, frozen to a still);
// any other tier shows the flat editable preview.
function renderPreviews() {
  const box = $('cs-previews');
  if (!box || !current) return;
  const items = current.finishes.map((f) => {
    const slot = current.slots.find((s) => s.slot === f);
    const hasArt = slot ? slot.hasArt : false;
    const liveUrl = current.live && current.live[f];
    const frame = liveUrl
      ? h('div', { class: 'cs-pframe' }, h('canvas', { class: 'thumb', 'data-src': liveUrl }))
      : h('div', { class: 'cs-pframe' }, h('iframe', { src: `/card/${current.id}/${f}?t=${Date.now()}`, tabindex: '-1', title: tierName(f) }),
        hasArt ? null : h('div', { class: 'cs-pempty' }, 'Add art'));
    return h('button', { class: `cs-pv${hasArt ? '' : ' empty'}`, type: 'button', 'data-tier': f, onclick: () => openTier(f) }, frame, h('span', { class: 'cs-pvlabel' }, tierName(f)));
  });
  // "Add tier" at the end of the row (if a tier is not on the card yet).
  if (RARITY_ORDER.some((r) => !current.finishes.includes(r))) {
    items.push(h('button', { class: 'cs-pv cs-addtier', type: 'button', id: 'cs-addtier-card', onclick: openAddTier },
      h('div', { class: 'cs-pframe cs-addframe' }, icon('plus'), 'Add tier'), h('span', { class: 'cs-pvlabel' }, ' ')));
  }
  box.replaceChildren(...items);
  freezeThumbs(box);
}

/* ----- add a tier ----- */
function addTierDialog() {
  return dialog('cs-addtier', 'Add a tier', h('div', null, h('p', { class: 'subtitle' }, 'Pick a tier to add to this card.'), h('div', { class: 'cs-addlist', id: 'cs-addtier-list' })), { cls: 'narrow' });
}
function openAddTier() {
  const addable = RARITY_ORDER.filter((r) => !current.finishes.includes(r));
  $('cs-addtier-list').replaceChildren(...addable.map((r) => h('button', { class: 'btn cs-addopt', type: 'button', 'data-r': r, onclick: () => addTier(r) },
    h('span', { class: `cs-dot ${r}` }), FINISH_LABEL[r])));
  $('cs-addtier').hidden = false;
}
async function addTier(rarity) {
  const finishes = [...current.finishes, rarity];
  const r = await (await post('/api/cards/' + current.id, cardBody(finishes), 'PUT')).json();
  $('cs-addtier').hidden = true;
  if (!r.ok) { setStatus('Error: ' + r.error); return; }
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  renderPreviews();
  openTier(rarity); // go straight into the new tier (art + its own details)
}

/* ----- the tier editor: upload art, frame it, artist, details, trade lock, delete ----- */
let tierRarity = null;
let tierSlot = null;

function tierDialog() {
  const drop = h('div', { class: 'cs-drop', id: 'cs-tier-drop' }, 'Drop art here, or select Upload art');
  ['dragover', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault();
    if (ev === 'drop' && e.dataTransfer.files[0]) upload(tierSlot, e.dataTransfer.files[0]);
  }));
  const trade = h('input', { type: 'checkbox', id: 'cs-t-tradeable', checked: true });
  trade.addEventListener('change', saveTierTrade);
  const artist = h('input', { class: 'field', id: 'cs-tier-artist', placeholder: 'e.g. @artisthandle' });
  artist.addEventListener('change', saveArtist);
  const source = h('select', { class: 'field', id: 'cs-tier-source' });
  source.addEventListener('change', saveArtSource);
  const dsource = h('select', { class: 'field', id: 'cs-cd-source' });
  dsource.addEventListener('change', copyDetails);
  return dialog('cs-tier', 'Tier', h('div', { class: 'cs-tiercols' },
    h('div', { class: 'cs-tierleft' },
      h('div', { class: 'cs-stage', id: 'cs-tier-stage' }),
      drop,
      h('div', { class: 'cs-row center' },
        h('button', { class: 'btn primary', id: 'cs-tier-upload', type: 'button', onclick: () => pickFile(tierSlot) }, icon('upload'), 'Upload art'),
        h('button', { class: 'btn', id: 'cs-tier-framebtn', type: 'button', onclick: () => openFramer(tierSlot) }, icon('move'), 'Frame'))),
    h('div', { class: 'cs-tierright' },
      h('label', { class: 'cs-check', title: 'Lock this tier from trading and gifting. Gold never trades.' }, trade, 'Tradeable', h('span', { class: 'cs-note', id: 'cs-t-trade-note' })),
      field('Artist credit', artist, '(optional, blank if none)'),
      field('Or reuse art from another tier', source),
      h('div', { class: 'cs-h3' }, 'Card details', h('span', { class: 'cs-note' }, ' This tier only')),
      field('Subject', h('input', { class: 'field', id: 'cs-d-genre', placeholder: 'Subject (e.g. Pokemon Unite)' })),
      field('Description', h('textarea', { class: 'field', id: 'cs-d-lore', rows: '2', placeholder: 'Description / lore' })),
      h('div', { class: 'cs-row' },
        field('Season / origin', h('input', { class: 'field', id: 'cs-d-season', placeholder: 'Season / origin' })),
        h('div', { id: 'cs-d-event-wrap', class: 'cs-grow' }, field('Event / Promo period', h('input', { class: 'field', id: 'cs-d-event', placeholder: 'Event / Promo period' })))),
      field('Or pull details from another tier', dsource),
      h('button', { class: 'btn cs-danger', id: 'cs-tier-delete', type: 'button', onclick: deleteTier }, icon('trash'), 'Delete this tier'))), { cls: 'wide' });
}

function openTier(rarity) {
  tierRarity = rarity;
  tierSlot = rarity; // each tier has its own art slot
  const slot = current.slots.find((s) => s.slot === tierSlot);
  $('cs-tier-title').textContent = tierName(rarity).replace(/\b\w/g, (m) => m.toUpperCase());
  $('cs-tier-artist').value = (slot && slot.artist) || '';
  const det = (slot && slot.details) || {};
  $('cs-d-genre').value = det.genre || '';
  $('cs-d-lore').value = det.lore || '';
  $('cs-d-season').value = det.season || '';
  $('cs-d-event').value = det.event || '';
  // Per-tier trade lock. Gold never trades, so it is locked and cannot be changed.
  const isGold = rarity === 'gold';
  $('cs-t-tradeable').checked = isGold ? false : (det.tradeable !== false);
  $('cs-t-tradeable').disabled = isGold;
  $('cs-t-trade-note').textContent = isGold ? ' (gold never trades)' : '';
  // The Event / Promo period applies only to a manual tier.
  $('cs-d-event-wrap').hidden = !SPECIAL_TIERS.includes(rarity);
  populateSource(slot);
  populateDetailSource();
  refreshTierFrame();
  $('cs-tier').hidden = false;
}

// The main preview shows the live render for a pushed tier. After an edit (upload / frame / details) preferLive=false
// shows the flat editable preview, so the change shows until the tier is pushed again.
function refreshTierFrame(preferLive = true) {
  const stage = $('cs-tier-stage');
  if (!stage) return;
  const liveUrl = preferLive && current.live && current.live[tierRarity];
  if (liveUrl) {
    const foil = HOLO_TIERS.has(tierRarity);
    stage.replaceChildren(h('canvas', { class: 'cs-live thumb', 'data-src': liveUrl }), ...(foil ? [h('div', { class: 'holo' }), h('div', { class: 'glare' })] : []));
    stage.classList.toggle('holo-on', foil);
    freezeThumbs(stage);
  } else {
    stage.classList.remove('holo-on');
    stage.replaceChildren(h('iframe', { id: 'cs-tier-frame', title: 'Tier preview', src: `/card/${current.id}/${tierRarity}?t=${Date.now()}` }));
  }
}

// The holographic sheen follows the mouse over the tier preview.
function setupHolo() {
  const stage = $('cs-tier-stage');
  stage.addEventListener('mousemove', (e) => {
    if (!stage.classList.contains('holo-on')) return;
    const r = stage.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 100;
    const py = ((e.clientY - r.top) / r.height) * 100;
    for (const [v, x] of [['--hx', px], ['--hy', py], ['--gx', px], ['--gy', py]]) stage.style.setProperty(v, x + '%');
    const mag = Math.min(1, Math.hypot((px - 50) / 50, (py - 50) / 50));
    stage.style.setProperty('--holo-opacity', (0.18 + mag * 0.55).toFixed(3));
  });
  stage.addEventListener('mouseleave', () => {
    stage.style.setProperty('--holo-opacity', '0.28');
    for (const v of ['--hx', '--hy', '--gx', '--gy']) stage.style.setProperty(v, '50%');
  });
}

// Save the per-tier subject / description / season / event for the open tier.
async function saveTierDetails() {
  if (!current || !tierSlot) return;
  const body = { genre: $('cs-d-genre').value.trim(), lore: $('cs-d-lore').value.trim(), season: $('cs-d-season').value.trim(), event: $('cs-d-event').value.trim() };
  const r = await (await post(`/api/details/${current.id}/${tierSlot}`, body)).json();
  if (!r.ok) { setStatus('Error: ' + r.error); return; }
  const s = current.slots.find((x) => x.slot === tierSlot);
  if (s) s.details = r.details;
  refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
}

// "Pull details from another tier": the OTHER tiers of this card. A choice copies its details into this tier.
function populateDetailSource() {
  const opts = [h('option', { value: '' }, "This tier's own details")];
  for (const s of current.slots) if (s.slot !== tierSlot) opts.push(h('option', { value: s.slot }, s.label));
  $('cs-cd-source').replaceChildren(...opts);
  $('cs-cd-source').value = '';
}
async function copyDetails() {
  const fromSlot = $('cs-cd-source').value;
  $('cs-cd-source').value = '';
  if (!fromSlot) return;
  const s = current.slots.find((x) => x.slot === fromSlot);
  const det = (s && s.details) || {};
  $('cs-d-genre').value = det.genre || '';
  $('cs-d-lore').value = det.lore || '';
  $('cs-d-season').value = det.season || '';
  $('cs-d-event').value = det.event || '';
  await saveTierDetails();
}

// "Reuse art from another tier": only the OTHER arted tiers of THIS card.
function populateSource(slot) {
  const opts = [h('option', { value: '' }, "Use this tier's own uploaded art")];
  for (const s of current.slots.filter((x) => x.hasArt && x.slot !== tierSlot)) opts.push(h('option', { value: `${current.id}|${s.slot}` }, s.label));
  $('cs-tier-source').replaceChildren(...opts);
  const src = slot && slot.source;
  $('cs-tier-source').value = src ? `${src.fromId}|${src.fromSlot}` : '';
}
async function saveArtSource() {
  const v = $('cs-tier-source').value;
  const [fromId, fromSlot] = v ? v.split('|') : ['', ''];
  await post(`/api/artsource/${current.id}/${tierSlot}`, { fromId, fromSlot });
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  refreshTierFrame(false);
  renderPreviews();
}

// Per-tier trade lock: saved to this tier's live Supabase row.
async function saveTierTrade() {
  if (!current || !tierSlot) return;
  const tradeable = $('cs-t-tradeable').checked;
  const r = await (await post(`/api/tradeable/${current.id}/${tierSlot}`, { tradeable })).json();
  const s = current.slots.find((x) => x.slot === tierSlot);
  if (s && s.details) s.details.tradeable = r.tradeable;
  load();
}

async function saveArtist() {
  const name = $('cs-tier-artist').value.trim();
  await post(`/api/artist/${current.id}/${tierSlot}`, { name });
  const s = current.slots.find((x) => x.slot === tierSlot);
  if (s) s.artist = name;
  refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
}

async function deleteTier() {
  const lbl = FINISH_LABEL[tierRarity] || tierRarity;
  const finishes = current.finishes.filter((f) => f !== tierRarity);
  if (!finishes.length) { setStatus('A card needs at least one tier.'); return; }
  if (!window.confirm(`Remove the ${lbl} tier from this card?`)) return;
  if (!window.confirm(`Final check: this deletes ${lbl} from the LIVE game (and anyone who owns it). Remove for good?`)) return;
  const r = await (await post('/api/cards/' + current.id, cardBody(finishes), 'PUT')).json();
  $('cs-tier').hidden = true;
  if (!r.ok) { setStatus('Error: ' + r.error); return; }
  await load();
  const c = cards.find((x) => x.id === current.id);
  if (c) current = c;
  renderPreviews();
}

function pickFile(slot) {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = 'image/*';
  i.onchange = () => i.files[0] && upload(slot, i.files[0]);
  i.click();
}
async function upload(slot, file) {
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  await post(`/api/art/${current.id}/${slot}`, { dataUrl });
  const s = current.slots.find((x) => x.slot === slot);
  if (s) s.hasArt = true;
  if (tierSlot === slot) refreshTierFrame(false);
  renderPreviews();
  load();
}

/* ----- the framing editor: drag to pan, scroll / buttons to zoom, then save ----- */
let framerSlot = null;
let framerState = { x: 50, y: 50, scale: 1 };

function framerDialog() {
  const range = h('input', { id: 'cs-zoom-range', type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom' });
  range.addEventListener('input', (e) => frameMsg({ type: 'frameZoom', scale: parseFloat(e.target.value) }));
  return dialog('cs-framer', 'Frame artwork', h('div', null,
    h('div', { class: 'cs-fstage' }, h('iframe', { id: 'cs-framer-frame', title: 'Frame artwork' })),
    h('p', { class: 'subtitle cs-center' }, 'Drag the art to move it. Scroll or use - / + to zoom.'),
    h('div', { class: 'cs-row center' },
      h('button', { class: 'btn icon-only', id: 'cs-zoom-out', type: 'button', 'aria-label': 'Zoom out', onclick: () => frameMsg({ type: 'frameZoom', scale: Math.max(1, framerState.scale - 0.1) }) }, '-'),
      range,
      h('button', { class: 'btn icon-only', id: 'cs-zoom-in', type: 'button', 'aria-label': 'Zoom in', onclick: () => frameMsg({ type: 'frameZoom', scale: Math.min(4, framerState.scale + 0.1) }) }, '+'),
      h('button', { class: 'btn', id: 'cs-framer-reset', type: 'button', onclick: () => frameMsg({ type: 'frameReset' }) }, 'Reset'),
      h('button', { class: 'btn primary', id: 'cs-framer-save', type: 'button', onclick: saveFraming }, 'Save framing'))), { cls: 'auto' });
}
function openFramer(slot) {
  framerSlot = slot;
  $('cs-framer-title').textContent = 'Frame: ' + tierName(slot);
  $('cs-framer-frame').src = `/card/${current.id}/${slot}?edit=1&t=${Date.now()}`;
  $('cs-framer').hidden = false;
}
function frameMsg(msg) {
  const f = $('cs-framer-frame');
  if (f && f.contentWindow) f.contentWindow.postMessage(msg, '*');
}
async function saveFraming() {
  await post(`/api/frame/${current.id}/${framerSlot}`, framerState);
  $('cs-framer').hidden = true;
  if (tierSlot === framerSlot) refreshTierFrame(false);
  renderPreviews();
  refreshBadge();
}
// The card render in the framer reports its framing (server.js EDIT_SCRIPT).
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'frame') {
    framerState = { x: e.data.x, y: e.data.y, scale: e.data.scale };
    if ($('cs-zoom-range')) $('cs-zoom-range').value = e.data.scale;
  }
});

/* ================= render queue (push) ================= */
let polling = null;
const nameFor = (id) => { const c = cards.find((x) => x.id === id); return c ? c.name : id; };
function ensurePolling() {
  if (!polling) polling = setInterval(refreshStatus, 1500);
  refreshStatus();
}
async function refreshStatus() {
  let st;
  try { st = await (await fetch('/api/push-status')).json(); } catch { return; }
  const { statuses, progress } = st;
  const renderingIds = Object.keys(statuses).filter((x) => statuses[x] === 'rendering');
  const queued = Object.keys(statuses).filter((x) => statuses[x] === 'queued');
  const parts = renderingIds.map((id) => `Rendering ${nameFor(id)} ${Math.round((progress[id] || 0) * 100)}%`);
  if (queued.length) parts.push(`${queued.length} queued`);
  if ($('cs-pushq')) $('cs-pushq').textContent = parts.join(', ');

  // The progress bar + status of the card page that is open.
  if (mode === 'card' && current && $('cs-pbar-row')) {
    const s = statuses[current.id];
    if (s) {
      const pct = Math.round((progress[current.id] || 0) * 100);
      $('cs-pbar-row').hidden = !(s === 'rendering' || (s === 'queued' && renderingIds.length));
      $('cs-pfill').style.width = `${s === 'rendering' ? pct : 0}%`;
      setStatus(s === 'done' ? 'Pushed live' : s === 'rendering' ? `Rendering ${pct}%` : s === 'queued' ? 'Queued: you can keep working on other cards' : `Error: ${s}`);
    } else {
      $('cs-pbar-row').hidden = true;
    }
  }

  if (!renderingIds.length && !queued.length) {
    clearInterval(polling);
    polling = null;
    if ($('cs-pushq')) $('cs-pushq').textContent = '';
    load(); // refresh the live marks once the queue is empty
  }
}

// The one place to render: queue every card that has unpushed changes.
async function queueRender() {
  const ready = cards.filter((c) => c.dirty);
  if (!ready.length) {
    $('cs-pushq').textContent = 'Everything is up to date. Nothing to render.';
    setTimeout(() => { if (!polling && $('cs-pushq')) $('cs-pushq').textContent = ''; }, 4000);
    return;
  }
  $('cs-pushall').disabled = true;
  for (const c of ready) await fetch('/api/push/' + c.id, { method: 'POST' });
  if ($('cs-pushall')) $('cs-pushall').disabled = false;
  ensurePolling();
}
