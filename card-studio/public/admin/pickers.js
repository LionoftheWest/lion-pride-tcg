// The dropdown pickers of the card editor (F-2 item 7, Nathan 2026-10-11: "drop down menus for things to select already in
// the library ... and the ability to add a new tag/genre/etc. rather than typing it in").
// A picker shows the chosen values as chips. "Choose" opens the library of the facet (GET /api/tag-vocab): a filter, every
// value with the number of cards that use it, a checkmark on the chosen ones, and "+ Add new" (POST /api/tag-vocab, which
// refuses a near duplicate and names the existing value). A value that cards use but the library lacks is marked.
// Every text goes in as textContent.

const JSON_HEAD = { 'content-type': 'application/json' };

/**
 * picker({ h, icon, id, facet, values, label, onChange, getFacet, setFacets })
 *   facet: the facet key (origin, genre, realm, traits, subject); getFacet() = the current library view of it;
 *   setFacets(f) = keep a new library view after "+ Add new". Returns { el, get(), set(values) }.
 */
export function picker({ h, icon, id, facet, label, onChange, getFacet, setFacets }) {
  let chosen = [];
  const def = () => getFacet() || { multi: true, values: [], kind: 'slug' };
  const same = (a, b) => normKey(a) === normKey(b);
  const chips = h('div', { class: 'pk-chips' });
  const openBtn = h('button', { class: 'btn pk-open', type: 'button', id: `${id}-open`, 'aria-haspopup': 'listbox', 'aria-expanded': 'false' }, icon('plus'), 'Choose');
  const filter = h('input', { class: 'field pk-filter', id: `${id}-filter`, type: 'search', placeholder: `Search or add a ${label.toLowerCase()}`, 'aria-label': `Search ${label}` });
  const list = h('div', { class: 'pk-list', role: 'listbox', 'aria-label': label, 'aria-multiselectable': String(def().multi) });
  const addBtn = h('button', { class: 'btn pk-new', type: 'button', id: `${id}-new`, hidden: true });
  const msg = h('p', { class: 'pk-msg', role: 'status' });
  const pop = h('div', { class: 'pk-pop', id: `${id}-pop`, hidden: true }, filter, list, addBtn, msg);
  const el = h('div', { class: 'pk', id, 'data-facet': facet }, chips, openBtn, pop);

  const emit = () => { renderChips(); onChange && onChange(get()); };
  function renderChips() {
    const f = def();
    chips.replaceChildren(...(chosen.length ? chosen.map((v) => {
      const lib = f.values.find((x) => same(x.value, v));
      const off = !lib || !lib.library;
      return h('span', { class: `pk-chip${off ? ' off' : ''}`, title: off ? 'Not in the library' + (lib && lib.near ? `: near "${lib.near}"` : '') : null },
        h('span', null, lib && lib.library && f.kind !== 'text' && lib.label !== lib.value ? lib.label : v),
        h('button', { class: 'pk-x', type: 'button', 'aria-label': `Remove ${v}`, onclick: () => { chosen = chosen.filter((x) => x !== v); emit(); renderList(); } }, icon('x')));
    }) : [h('span', { class: 'pk-none' }, 'None')]));
  }
  function pick(v) {
    const f = def();
    if (f.multi) chosen = chosen.some((x) => same(x, v)) ? chosen.filter((x) => !same(x, v)) : [...chosen, v];
    else { chosen = [v]; close(); }
    emit();
    renderList();
    if (!pop.hidden) filter.focus(); // the list was drawn again: keep the focus in the picker
  }
  function renderList() {
    const f = def();
    const q = filter.value.trim();
    const shown = f.values.filter((x) => !q || normKey(`${x.value} ${x.label}`).includes(normKey(q)))
      .sort((a, b) => (b.library - a.library) || (a.group || '').localeCompare(b.group || '') || b.cards - a.cards || a.value.localeCompare(b.value));
    let group = null;
    const rows = [];
    for (const x of shown) {
      if (x.library && x.group && x.group !== group) { group = x.group; rows.push(h('div', { class: 'pk-group' }, `${x.group}s`)); }
      if (!x.library && group !== '-') { group = '-'; rows.push(h('div', { class: 'pk-group' }, 'Used by cards, not in the library')); }
      const on = chosen.some((v) => same(v, x.value));
      rows.push(h('button', { class: `pk-opt${on ? ' on' : ''}${x.library ? '' : ' off'}`, type: 'button', role: 'option', 'aria-selected': String(on), 'data-value': x.value, onclick: () => pick(x.value) },
        h('span', { class: 'pk-check' }, on ? icon('check') : null),
        h('span', { class: 'pk-label' }, x.label !== x.value && f.kind !== 'text' ? `${x.label} (${x.value})` : x.value),
        x.near ? h('span', { class: 'pk-near' }, `near ${x.near}`) : null,
        h('span', { class: 'pk-count num' }, `${x.cards} card${x.cards === 1 ? '' : 's'}`)));
    }
    list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'pk-empty' }, 'No value matches')]));
    const exact = q && f.values.some((x) => same(x.value, q) || same(x.label, q));
    addBtn.hidden = !q || exact;
    addBtn.replaceChildren(icon('plus'), `Add new "${q}"`);
  }
  async function addNew() {
    const q = filter.value.trim();
    if (!q) return;
    msg.textContent = 'Checking';
    let r;
    try { r = await (await fetch('/api/tag-vocab', { method: 'POST', headers: JSON_HEAD, body: JSON.stringify({ facet, value: q }) })).json(); } catch (e) { r = { ok: false, error: e.message || String(e) }; }
    if (!r.ok) {
      msg.textContent = r.error;
      if (r.suggest) { filter.value = r.suggest; renderList(); }
      return;
    }
    if (r.facets) setFacets(r.facets);
    msg.textContent = r.existed ? `"${r.value}" is in the library: chosen.` : `Added "${r.value}" to the library.`;
    filter.value = '';
    if (!chosen.some((v) => same(v, r.value))) pick(r.value); else renderList();
  }
  function open() { pop.hidden = false; openBtn.setAttribute('aria-expanded', 'true'); msg.textContent = ''; renderList(); filter.focus(); }
  function close() { pop.hidden = true; openBtn.setAttribute('aria-expanded', 'false'); filter.value = ''; }
  openBtn.addEventListener('click', () => (pop.hidden ? open() : close()));
  filter.addEventListener('input', () => { msg.textContent = ''; renderList(); });
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (!addBtn.hidden) addNew(); }
  });
  // Escape closes the list from anywhere in the picker (the filter, an option, Add new).
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { e.stopPropagation(); close(); openBtn.focus(); } });
  addBtn.addEventListener('click', addNew);
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !el.contains(e.target)) close(); });

  function get() { return def().multi ? [...chosen] : (chosen[0] || ''); }
  function set(values) { chosen = (Array.isArray(values) ? values : values ? [values] : []).map((v) => String(v).trim()).filter(Boolean); renderChips(); if (!pop.hidden) renderList(); }
  renderChips();
  return { el, get, set };
}

// The same exact key as src/tag-vocab.js normKey (case, accents, spaces, - and _).
export const normKey = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  .replace(/[\s_-]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
