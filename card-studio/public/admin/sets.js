// Lion Pride TCG - Admin view: the Sets section (F-2 PR 3, docs/foundations.md F-2 items 2 and 5).
// #/sets = every set (card_sets order) and "New set"; #/sets/<id> = one set: its fields, pack art, cover card, home cards,
// its pool ("Add cards from other sets") and the sets it includes ("Include a whole set").
// Data: the studio API (src/sets-routes.js: /api/sets ...; src/server.js: /api/cards). Every write goes through the admin
// functions of set_pools.sql (checked input, a stale edit refused, an admin_actions row). Every text goes in as textContent.

const $ = (id) => document.getElementById(id);
const JSON_HEAD = { 'content-type': 'application/json' };
const post = async (url, body) => (await fetch(url, { method: 'POST', headers: JSON_HEAD, body: JSON.stringify(body) })).json();

let k = null;
let data = null; // GET /api/sets
let cards = []; // GET /api/cards (cards.json + the live state)
const h = (...a) => k.h(...a);
const icon = (n) => k.icon(n);

let cssOnce = false;
function css() {
  if (cssOnce) return;
  cssOnce = true;
  document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/admin/cards.css' }));
}

export async function pageSets(main, args, q, helpers) {
  k = helpers;
  css();
  const id = args[0] && args[0] !== 'undefined' ? args[0] : null;
  main.append(h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading'));
  try {
    await reload();
  } catch (e) {
    main.replaceChildren(k.errorState(e, () => k.render()));
    return;
  }
  main.replaceChildren();
  if (id) setPage(main, id); else listPage(main);
}

async function reload() {
  const [s, c] = await Promise.all([fetch('/api/sets').then((r) => r.json()), fetch('/api/cards').then((r) => r.json())]);
  if (!s.ok) throw new Error(s.error || 'the sets did not load');
  data = s;
  cards = c;
}

const FIELDS = ['id', 'name', 'code', 'pack_color', 'released_at', 'pullable', 'sort', 'season', 'pack_art_url', 'cover_card_id'];
const fieldsOf = (s) => Object.fromEntries(FIELDS.map((f) => [f, s[f] ?? null]));
const setOf = (id) => data.sets.find((s) => s.id === id) || null;
const swatch = (color) => h('span', { class: 'cs-swatch', style: color ? `background:${color}` : null });
const field = (lbl, input, note) => h('label', { class: 'cs-field' }, h('span', { class: 'lbl' }, lbl, note ? h('span', { class: 'cs-note' }, ` ${note}`) : null), input);
// datetime-local <-> the ISO time of the database (the admin's own time zone in the field).
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).toISOString() : null);
const homeCards = (id) => cards.filter((c) => c.set === id);
// One set per season (set_season_one_set.sql): cards_set_rules gives a card with no set the ONE set of its season.
const nextSeason = () => Math.max(0, ...data.sets.map((s) => s.season)) + 1;
const seasonOwner = (season, self) => data.sets.find((s) => s.season === season && s.id !== self) || null;
// The Season field: a whole number. The mouse wheel does not change it (a focused number field steps on each wheel turn).
const seasonInput = (id, value) => h('input', { class: 'field', id, type: 'number', min: '1', step: '1', value: String(value), onwheel: (e) => e.currentTarget.blur() });
// A refused season, before the request: the same words as the server.
const seasonError = (season, self) => {
  if (!Number.isInteger(season) || season < 1) return 'the season is a whole number of 1 or more';
  const o = seasonOwner(season, self);
  return o ? `season ${season} is already used by set ${o.id} (${o.name}). Each season has one set. The next free season is ${nextSeason()}.` : null;
};
const poolKeys = (id) => [...new Set(data.pool.filter((p) => p.set_id === id).map((p) => p.key).filter(Boolean))];

/* ================= every set ================= */
function listPage(main) {
  main.append(k.pageHead('Sets', `${data.sets.length} set${data.sets.length === 1 ? '' : 's'}. A card has one home set; other sets can add it to their pool.`,
    h('div', { class: 'range' }, h('button', { class: 'btn primary', id: 'st-new', type: 'button', onclick: openNew }, icon('plus'), 'New set'))));
  if (!data.pools_ready) main.append(h('p', { class: 'cs-warn' }, `Set pools are not in this database yet (${data.pools_error}). Apply set_pools.sql.`));
  const rows = data.sets.map((s) => {
    const home = data.rows.filter((r) => r.set_id === s.id).length;
    const pool = data.pool.filter((p) => p.set_id === s.id).length;
    const inc = data.includes.filter((i) => i.set_id === s.id).map((i) => i.included_set_id);
    const tr = h('tr', { class: 'link', 'data-set': s.id, onclick: () => { location.hash = `#/sets/${encodeURIComponent(s.id)}`; } },
      h('td', null, h('span', { class: 'cs-setpill' }, swatch(s.pack_color), h('a', { href: `#/sets/${encodeURIComponent(s.id)}` }, s.name))),
      h('td', { class: 'num' }, s.id), h('td', { class: 'num' }, s.code), h('td', { class: 'num r' }, s.season),
      h('td', null, s.pullable ? h('span', { class: 'status pass' }, 'pullable') : h('span', { class: 'status idle' }, 'not pullable')),
      h('td', { class: 'num' }, s.released_at ? new Date(s.released_at).toLocaleDateString() : '-'),
      h('td', { class: 'num r' }, home), h('td', { class: 'num r' }, pool), h('td', null, inc.join(', ') || '-'),
      h('td', null, s.pack_art_url ? h('img', { class: 'st-thumb', src: s.pack_art_url, alt: `${s.name} pack` }) : '-'));
    return tr;
  });
  main.append(h('section', { class: 'panel' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl', id: 'st-table' },
    h('thead', null, h('tr', null, ...['Set', 'Id', 'Code', 'Season', 'Packs', 'Released', 'Home tiers', 'Pool tiers', 'Includes', 'Pack art'].map((t, i) => h('th', { class: [3, 6, 7].includes(i) ? 'r' : null }, t)))),
    h('tbody', null, ...rows)))));
  main.append(newDialog());
}

function newDialog() {
  const close = () => { $('st-newdlg').hidden = true; };
  return h('div', { class: 'cs-back', id: 'st-newdlg', hidden: true },
    h('div', { class: 'cs-dialog narrow', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'New set' },
      h('div', { class: 'cs-dhead' }, h('h2', { text: 'New set' }), h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'cs-fgrid two' },
        field('Id', h('input', { class: 'field', id: 'st-n-id', placeholder: 'S2', maxlength: '8' }), '(fixed)'),
        field('Code', h('input', { class: 'field', id: 'st-n-code', placeholder: 'e.g. RIS', maxlength: '8' }), '(on the card)'),
        h('div', { class: 'cs-wide' }, field('Name', h('input', { class: 'field', id: 'st-n-name', placeholder: 'e.g. Rising' }))),
        field('Season', seasonInput('st-n-season', nextSeason()), '(one set per season)'),
        field('Order', h('input', { class: 'field', id: 'st-n-sort', type: 'number', step: '1', value: String(Math.max(0, ...data.sets.map((s) => s.sort)) + 1) })),
        field('Pack color', h('input', { class: 'field', id: 'st-n-color', type: 'color', value: '#3366cc' })),
        field('Release date', h('input', { class: 'field', id: 'st-n-released', type: 'datetime-local' }), '(optional)')),
      h('label', { class: 'cs-check' }, h('input', { type: 'checkbox', id: 'st-n-pullable' }), 'Pullable (packs and rewards give its cards)'),
      h('p', { class: 'subtitle' }, 'A new set starts NOT pullable, so its cards stay out of packs and rewards until you release it.'),
      h('div', { class: 'cs-dfoot' }, h('span', { class: 'subtitle', id: 'st-n-status', role: 'status' }),
        h('button', { class: 'btn primary', id: 'st-n-save', type: 'button', onclick: createSet }, 'Create set'))));
}
function openNew() {
  for (const x of ['st-n-id', 'st-n-code', 'st-n-name', 'st-n-released']) $(x).value = '';
  $('st-n-pullable').checked = false;
  $('st-n-season').value = String(nextSeason());
  say('st-n-status', '');
  $('st-newdlg').hidden = false;
  $('st-n-id').focus();
}
async function createSet() {
  const set = {
    id: $('st-n-id').value.trim().toUpperCase(), name: $('st-n-name').value.trim(), code: $('st-n-code').value.trim().toUpperCase(),
    season: Number($('st-n-season').value), sort: Number($('st-n-sort').value), pack_color: $('st-n-color').value.toLowerCase(),
    pullable: $('st-n-pullable').checked, released_at: fromLocal($('st-n-released').value),
  };
  const bad = seasonError(set.season, set.id);
  if (bad) return say('st-n-status', `Error: ${bad}`, true);
  $('st-n-save').disabled = true;
  const r = await post('/api/sets', { set, before: null, reason: 'new set' });
  $('st-n-save').disabled = false;
  if (!r.ok) return say('st-n-status', `Error: ${r.error}`, true);
  location.hash = `#/sets/${encodeURIComponent(r.set.id)}`;
}

/* ================= one set ================= */
let cur = null;

function panel(title, sub, id) {
  const body = h('div', { class: 'pbody' });
  const el = h('section', { class: 'panel cs-panel', id }, h('div', { class: 'phead' }, h('div', { class: 'ptitles' }, h('h2', { text: title }), sub ? h('p', { class: 'subtitle', text: sub }) : null)), body);
  return { el, body };
}
// A status line; bad = an error (the .err color), so a refusal does not look like a normal note.
const say = (id, t, bad = false) => { const el = $(id); if (!el) return; el.textContent = t; el.classList.toggle('err', bad); };

function setPage(main, id) {
  cur = setOf(id);
  main.append(k.pageHead(cur ? cur.name : 'Set', h('span', { class: 'crumb' }, h('a', { href: '#/sets' }, 'Sets'), ' / ', id)));
  if (!cur) { main.append(h('div', { class: 'panel' }, h('div', { class: 'empty' }, 'No set with this id'))); return; }
  document.title = `${cur.name} - Sets - Lion Pride TCG Admin`;
  const rows = data.rows.filter((r) => r.set_id === id);

  // The fields
  const f = panel('Set', `Id ${cur.id}: fixed. The code and the number show on each card ("${cur.code} · #014").`, 'st-fields');
  f.body.append(h('div', { class: 'cs-fgrid' },
    field('Name', h('input', { class: 'field', id: 'st-name', value: cur.name })),
    field('Code', h('input', { class: 'field', id: 'st-code', value: cur.code, maxlength: '8' })),
    field('Season', seasonInput('st-season', cur.season), '(one set per season)'),
    field('Pack color', h('input', { class: 'field', id: 'st-color', type: 'color', value: cur.pack_color })),
    field('Release date', h('input', { class: 'field', id: 'st-released', type: 'datetime-local', value: toLocal(cur.released_at) })),
    field('Order', h('input', { class: 'field', id: 'st-sort', type: 'number', step: '1', value: String(cur.sort) }))),
  h('label', { class: 'cs-check' }, h('input', { type: 'checkbox', id: 'st-pullable', checked: cur.pullable }), 'Pullable (packs and rewards give its cards)'),
  h('div', { class: 'cs-dfoot start' }, h('button', { class: 'btn primary', id: 'st-save', type: 'button', onclick: saveFields }, 'Save set'), h('span', { class: 'subtitle', id: 'st-status', role: 'status' })));

  // Pack art and cover card
  const art = panel('Pack art and cover', 'The still is the pack picture (pack_art_url). The clip is optional.', 'st-art');
  const cover = h('select', { class: 'field', id: 'st-cover' }, h('option', { value: '' }, 'No cover card'),
    ...rows.map((r) => h('option', { value: String(r.id) }, `${r.name} - ${r.rarity.replace(/_/g, ' ')} - #${String(r.number).padStart(3, '0')}`)));
  cover.value = cur.cover_card_id ? String(cur.cover_card_id) : '';
  const coverRow = rows.find((r) => r.id === cur.cover_card_id);
  art.body.append(h('div', { class: 'st-artrow' },
    h('div', { class: 'st-art', id: 'st-art-still' }, cur.pack_art_url ? h('img', { src: cur.pack_art_url, alt: `${cur.name} pack art` }) : h('span', { class: 'cs-note' }, 'No pack art: the pack shows its color')),
    h('div', { class: 'st-art' }, coverRow?.image_url ? h('img', { src: coverRow.image_url, alt: 'Cover card', id: 'st-cover-img' }) : h('span', { class: 'cs-note' }, 'No cover card')),
    h('div', { class: 'st-artctl' },
      h('div', { class: 'cs-row' },
        h('button', { class: 'btn primary', id: 'st-up-still', type: 'button', onclick: () => pick('still') }, icon('upload'), 'Upload still'),
        h('button', { class: 'btn', id: 'st-up-clip', type: 'button', onclick: () => pick('clip') }, icon('upload'), 'Upload clip')),
      h('p', { class: 'subtitle', id: 'st-art-status', role: 'status' }),
      field('Cover card', cover, '(a card of this set)'),
      h('button', { class: 'btn', id: 'st-cover-save', type: 'button', onclick: saveCover }, 'Save cover'))));

  // Home cards
  const home = homeCards(id);
  const hc = panel(`Home cards (${home.length})`, 'Printed and numbered in this set (cards.json "set").', 'st-home');
  hc.body.append(h('div', { class: 'cs-row' }, h('a', { class: 'btn primary', id: 'st-newcard', href: `#/cards?new=${encodeURIComponent(id)}` }, icon('plus'), 'New card in this set')),
    home.length ? h('div', { class: 'cs-grid st-cards' }, ...home.map((c) => cardTile(c))) : h('p', { class: 'empty' }, 'No card in this set yet.'));

  // The pool
  const keys = poolKeys(id);
  const pc = panel(`Pool: cards from other sets (${keys.length})`, 'An S2 pack can give these cards. They keep their own set and number.', 'st-pool');
  pc.body.append(
    keys.length ? h('div', { class: 'cs-grid st-cards' }, ...keys.map((key) => {
      const c = cards.find((x) => x.id === key);
      return cardTile(c || { id: key, name: key, finishes: [] }, h('button', { class: 'btn st-remove', type: 'button', 'data-key': key, onclick: () => removePool(key) }, icon('trash'), 'Remove'));
    })) : h('p', { class: 'empty' }, 'No card from another set.'),
    h('div', { class: 'cs-h3' }, 'Add cards from other sets'),
    h('div', { class: 'cs-row' }, h('input', { class: 'field cs-grow', id: 'st-find', type: 'search', placeholder: 'Search cards of other sets', 'aria-label': 'Search cards of other sets', oninput: renderFind }),
      h('button', { class: 'btn primary', id: 'st-add', type: 'button', onclick: addPool, disabled: !data.pools_ready }, icon('plus'), 'Add selected')),
    h('div', { class: 'st-find', id: 'st-find-list' }),
    h('p', { class: 'subtitle', id: 'st-pool-status', role: 'status' }, data.pools_ready ? '' : `Set pools are not in this database yet (${data.pools_error}).`));

  // Includes
  const inc = data.includes.filter((i) => i.set_id === id).map((i) => i.included_set_id);
  const ic = panel('Include a whole set', 'Every card of the included set (and its own pool) is in this pool, also the cards it gets later.', 'st-inc');
  const other = h('select', { class: 'field', id: 'st-inc-sel' }, h('option', { value: '' }, 'Choose a set'),
    ...data.sets.filter((s) => s.id !== id && !inc.includes(s.id)).map((s) => h('option', { value: s.id }, `${s.name} (${s.id})`)));
  ic.body.append(
    inc.length ? h('ul', { class: 'st-inclist' }, ...inc.map((x) => h('li', null, swatch(setOf(x)?.pack_color), `${setOf(x)?.name || x} (${x})`,
      h('button', { class: 'btn', type: 'button', 'data-inc': x, onclick: () => include(x, false) }, 'Exclude')))) : h('p', { class: 'empty' }, 'No included set.'),
    h('div', { class: 'cs-row' }, other, h('button', { class: 'btn primary', id: 'st-inc-add', type: 'button', disabled: !data.pools_ready, onclick: () => include($('st-inc-sel').value, true) }, 'Include')),
    h('p', { class: 'subtitle', id: 'st-inc-status', role: 'status' }));

  main.append(f.el, art.el, hc.el, pc.el, ic.el);
  renderFind();
}

function cardTile(c, extra) {
  return h('div', { class: `cs-tile${c.pushed ? ' live' : ''}` },
    h('a', { class: 'cs-tname', href: `#/cards/${encodeURIComponent(c.id)}` }, c.name),
    c.set && c.set !== cur.id ? h('span', { class: 'cs-from' }, `from ${c.set}`) : null,
    h('span', { class: 'cs-tstatus' }, `${(c.finishes || []).length} tier${(c.finishes || []).length === 1 ? '' : 's'}`, c.pushed ? h('span', { class: 'cs-live' }, 'Live') : h('span', { class: 'cs-note' }, 'not live')),
    extra || null);
}

// The search list: live cards of OTHER home sets, not in this pool yet.
function renderFind() {
  const q = ($('st-find')?.value || '').trim().toLowerCase();
  const inPool = new Set(poolKeys(cur.id));
  const list = cards.filter((c) => c.set !== cur.id && !inPool.has(c.id) && (!q || `${c.name} ${c.genre || ''} ${c.set || ''}`.toLowerCase().includes(q)));
  $('st-find-list').replaceChildren(...(list.length ? list.slice(0, 60).map((c) => h('label', { class: `cs-check st-findrow${c.pushed ? '' : ' off'}` },
    h('input', { type: 'checkbox', 'data-key': c.id, disabled: !c.pushed }), h('span', null, c.name), h('span', { class: 'cs-from' }, `from ${c.set || '?'}`),
    c.pushed ? null : h('span', { class: 'cs-note' }, 'not live: push it first'))) : [h('p', { class: 'empty' }, q ? 'No card matches.' : 'No card of another set.')]),
  list.length > 60 ? h('p', { class: 'cs-note' }, `${list.length - 60} more: search to narrow the list.`) : null);
}

async function after(msgId, msg) {
  const id = cur.id;
  await reload();
  const main = document.getElementById('main');
  main.replaceChildren();
  setPage(main, id);
  say(msgId, msg);
}

async function saveFields() {
  const set = { id: cur.id, name: $('st-name').value.trim(), code: $('st-code').value.trim().toUpperCase(), season: Number($('st-season').value),
    pack_color: $('st-color').value.toLowerCase(), released_at: fromLocal($('st-released').value), sort: Number($('st-sort').value), pullable: $('st-pullable').checked };
  if (set.season !== cur.season) {
    const bad = seasonError(set.season, cur.id);
    if (bad) return say('st-status', `Error: ${bad}`, true);
    if (!window.confirm(`Change the season of ${cur.name} from ${cur.season} to ${set.season}? Its cards will say Season ${set.season}.`)) return;
  }
  if (set.pullable !== cur.pullable && !window.confirm(set.pullable
    ? `Make ${cur.name} pullable? Packs and rewards start to give its cards now.`
    : `Stop ${cur.name}? Packs of this set close, and rewards stop giving its cards.`)) return;
  say('st-status', 'Saving');
  const r = await post('/api/sets', { set, before: fieldsOf(cur), reason: 'set edit' });
  if (!r.ok) return say('st-status', `Error: ${r.error}`, true);
  await after('st-status', 'Saved.');
}

async function saveCover() {
  const v = $('st-cover').value;
  const r = await post('/api/sets', { set: { id: cur.id, cover_card_id: v ? Number(v) : null }, before: fieldsOf(cur), reason: 'cover card' });
  if (!r.ok) return say('st-art-status', `Error: ${r.error}`, true);
  await after('st-art-status', 'Cover saved.');
}

function pick(kind) {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = kind === 'still' ? 'image/png,image/webp,image/jpeg' : 'image/webp,video/webm,video/mp4';
  i.onchange = () => i.files[0] && uploadArt(kind, i.files[0]);
  i.click();
}
export async function uploadArt(kind, file) {
  say('st-art-status', `Uploading the ${kind}`);
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
  const r = await post(`/api/sets/${encodeURIComponent(cur.id)}/pack-art`, { kind, dataUrl });
  if (!r.ok) return say('st-art-status', `Error: ${r.error}`, true);
  if (kind === 'clip') return say('st-art-status', `Clip stored: ${r.url}`);
  await after('st-art-status', 'Pack art saved.');
}

async function addPool() {
  const keys = [...document.querySelectorAll('#st-find-list input[type=checkbox]:checked')].map((x) => x.dataset.key);
  if (!keys.length) return say('st-pool-status', 'Select one or more cards.');
  say('st-pool-status', 'Adding');
  const r = await post(`/api/sets/${encodeURIComponent(cur.id)}/pool`, { keys, add: true, reason: 'set page: add cards' });
  if (!r.ok) return say('st-pool-status', `Error: ${r.error}`, true);
  await after('st-pool-status', `Added ${keys.length} card${keys.length === 1 ? '' : 's'} (${r.changed} tiers). The pool has ${r.pool} tiers.`);
}
async function removePool(key) {
  const r = await post(`/api/sets/${encodeURIComponent(cur.id)}/pool`, { keys: [key], add: false, reason: 'set page: remove a card' });
  if (!r.ok) return say('st-pool-status', `Error: ${r.error}`, true);
  await after('st-pool-status', `Removed (${r.changed} tiers).`);
}
async function include(other, add) {
  if (!other) return say('st-inc-status', 'Choose a set.');
  const r = await post(`/api/sets/${encodeURIComponent(cur.id)}/include`, { set: other, add, reason: add ? 'include a set' : 'exclude a set' });
  if (!r.ok) return say('st-inc-status', `Error: ${r.error}`, true);
  await after('st-inc-status', add ? `Included ${other}.` : `Excluded ${other}.`);
}
