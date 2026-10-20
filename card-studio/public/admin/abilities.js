// Lion Pride TCG - Admin view: the ability builder (combat v2 PR T1, docs/combat-redesign-plan.md 12.1).
// #/abilities = the batch files and "New batch"; #/abilities/<batch> = one batch: its rows, and the editor of one row (card, role, name, blocks, Silver).
// Every check is ONE SQL call on the LOCAL copy (POST /api/admin/abilities/check -> ability_v2_check): the PP meter, the PP of each block, the card
// text, the Silver line, the "Makes / Uses" chips and the errors. No PP or text math here. "Save batch" checks every row again and writes the
// PRIVATE batch file (src/ability-builder-routes.js); scripts/push-abilities.mjs --v2 pushes it later. Every text goes in as textContent.

const API = '/api/admin/abilities';
const WRITE = { 'content-type': 'application/json', 'x-admin-write': '1' };
const getJ = async (url) => { const r = await fetch(url); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: WRITE, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; };

let k = null; // the helpers of admin.js
let lib = null; // GET /library
let cards = []; // GET /api/cards (names for the card keys)
const h = (...a) => k.h(...a);
const icon = (n) => k.icon(n);

let cssOnce = false;
function css() {
  if (cssOnce) return;
  cssOnce = true;
  for (const f of ['/admin/cards.css', '/admin/abilities.css']) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: f }));
}

export async function pageAbilities(main, args, q, helpers) {
  k = helpers;
  css();
  main.append(h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading'));
  try {
    const [l, c] = await Promise.all([getJ(`${API}/library`), fetch('/api/cards').then((r) => (r.ok ? r.json() : [])).catch(() => [])]);
    lib = l; cards = Array.isArray(c) ? c : [];
  } catch (e) {
    main.replaceChildren(k.errorState(e, () => k.render()));
    return;
  }
  main.replaceChildren();
  const name = args[0] && args[0] !== 'undefined' ? args[0] : null;
  if (name) await batchPage(main, name); else await listPage(main);
}

const field = (lbl, input, note) => h('label', { class: 'cs-field' }, h('span', { class: 'lbl' }, lbl, note ? h('span', { class: 'cs-note' }, ` ${note}`) : null), input);
const blockRow = (key) => lib.blocks.find((b) => b.key === key);
const classOf = (role) => (lib.roles.find((r) => r.key === role) || {}).class || null;
const statusesFor = (type) => lib.statuses.filter((s) => {
  if (type === 'status_rider') return s.negative && s.on_enemy && s.verb;
  if (type === 'status_enemy' || type === 'status_list') return s.negative && s.on_enemy;
  if (type === 'status_stack') return s.negative && s.on_enemy && ['add', 'add_decay'].includes(s.stacking);
  if (type === 'status_decay') return s.stacking === 'add_decay';
  if (type === 'status_card') return s.on_card && !['shielded', 'guarded'].includes(s.key);
  if (type === 'cure_list') return s.negative && s.on_card;
  return false;
});
const pp = (x) => (x == null || Number.isNaN(Number(x)) ? '-' : Number(x).toFixed(2));

/* ================= the batch files ================= */
async function listPage(main) {
  const data = await getJ(`${API}/batches`);
  main.append(k.pageHead('Abilities', 'Combat v2 actives. Build each active from the block library; the check runs on the LOCAL copy (ability_v2_check). A batch file is private and goes live only with push-abilities --v2.'));
  const local = lib.local || {};
  main.append(h('p', { class: 'subtitle', style: 'margin-bottom:12px' }, 'Local copy: ',
    local.reachable ? k.statusTag('pass', `${local.file}, refreshed ${local.written_at ? new Date(local.written_at).toLocaleString() : '-'}`) : k.statusTag('fail', local.error || 'not reachable')));
  const nameIn = h('input', { class: 'field', id: 'ab-newname', placeholder: 'for example s1-strikers', maxlength: '61' });
  const msg = h('p', { class: 'cs-msg', id: 'ab-newmsg', role: 'status' });
  const p = k.panel('Batches', { sub: `${data.batches.length} batch file${data.batches.length === 1 ? '' : 's'} in the private folder`,
    right: h('div', { class: 'ab-new' }, nameIn, h('button', { class: 'btn primary', type: 'button', id: 'ab-newbtn', onclick: () => {
      const n = nameIn.value.trim();
      if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(n)) { msg.textContent = 'A name is lower case letters, digits, - or _.'; return; }
      location.hash = `#/abilities/${encodeURIComponent(n)}`;
    } }, icon('plus'), 'New batch')) });
  p.body.append(msg, data.batches.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl', id: 'ab-batches' },
    h('thead', null, h('tr', null, h('th', null, 'Batch'), h('th', { class: 'r' }, 'Rows'), h('th', null, 'Saved'))),
    h('tbody', null, ...data.batches.map((b) => h('tr', { class: 'link', onclick: () => { location.hash = `#/abilities/${encodeURIComponent(b.name)}`; } },
      h('td', null, h('a', { href: `#/abilities/${encodeURIComponent(b.name)}` }, b.name)), h('td', { class: 'num r' }, b.rows ?? '-'),
      h('td', { class: 'num' }, new Date(b.modified).toLocaleString()))))))
    : h('p', { class: 'subtitle' }, 'No batch yet. Make one with "New batch".'));
  main.append(p.el);
}

/* ================= one batch ================= */
async function batchPage(main, name) {
  let rows = [];
  let saved = true;
  try { rows = (await getJ(`${API}/batch/${encodeURIComponent(name)}`)).rows; } catch (e) { if (!/no batch/.test(e.message)) throw e; saved = false; }
  let cur = rows.length ? 0 : -1;
  const checks = new Map(); // row index -> the last check
  const ver = new Map(); // row index -> its edit count (an older check never replaces a newer one)
  let seq = 0;

  const status = h('p', { class: 'cs-msg', id: 'ab-status', role: 'status' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', id: 'ab-save' }, icon('check'), 'Save batch');
  main.append(k.pageHead(name, saved ? `${rows.length} row${rows.length === 1 ? '' : 's'}. Save checks every row on the local copy, then writes the private batch file.` : 'A new batch (not saved yet).',
    h('div', { class: 'range' }, h('a', { class: 'btn', href: '#/abilities' }, icon('back'), 'Batches'), saveBtn)));
  main.append(status);

  const listP = k.panel('Rows', { right: h('button', { class: 'btn', type: 'button', id: 'ab-addrow', onclick: () => {
    rows.push({ key: '', role: lib.roles[0]?.key || 'striker', ability: { name: '', blocks: [] } }); cur = rows.length - 1; saved = false; drawAll(); recheck(); } }, icon('plus'), 'Add row') });
  const edit = h('div', { class: 'ab-edit' });
  main.append(h('div', { class: 'cols-member' }, listP.el, edit));

  const drawList = () => {
    listP.body.replaceChildren(rows.length ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl', id: 'ab-rows' },
      h('thead', null, h('tr', null, h('th', null, 'Card'), h('th', null, 'Role'), h('th', { class: 'r' }, 'PP'), h('th', null, 'Check'))),
      h('tbody', null, ...rows.map((r, i) => { const c = checks.get(i);
        return h('tr', { class: `link${i === cur ? ' ab-cur' : ''}`, onclick: () => { cur = i; drawAll(); if (!checks.has(i)) recheck(); } },
          h('td', null, h('div', null, r.ability?.name || '(no name)'), h('div', { class: 'cs-note' }, r.key || '(no card)')),
          h('td', null, r.role), h('td', { class: 'num r' }, c ? pp(c.pp) : '-'),
          h('td', null, !c ? '-' : c.ok ? k.statusTag('pass', 'OK') : k.statusTag('fail', `${c.errors.length}`))); }))))
      : h('p', { class: 'subtitle' }, 'No row yet. Add one.'));
  };

  // ---- the editor of the current row
  const drawEdit = () => {
    if (cur < 0) { edit.replaceChildren(); return; }
    const r = rows[cur];
    const cls = classOf(r.role);
    const touch = () => { saved = false; ver.set(cur, (ver.get(cur) || 0) + 1); checks.delete(cur); drawList(); recheck(); };
    // card, role, name
    const keyIn = h('input', { class: 'field', id: 'ab-key', value: r.key, list: 'ab-cardlist', placeholder: 'card key', oninput: (e) => { r.key = e.target.value.trim(); cardName.textContent = nameOf(r.key); touch(); } });
    const nameOf = (key) => (cards.find((c) => c.id === key) || {}).name || (key ? 'not a card of cards.json' : '');
    const cardName = h('span', { class: 'cs-note', id: 'ab-cardname' }, nameOf(r.key));
    const roleSel = h('select', { class: 'field', id: 'ab-role', onchange: (e) => { r.role = e.target.value; drawEdit(); touch(); } },
      ...['attacker', 'support'].map((c) => h('optgroup', { label: c === 'attacker' ? 'Attackers' : 'Supports' },
        ...lib.roles.filter((x) => x.class === c).map((x) => h('option', { value: x.key, selected: x.key === r.role }, x.key)))));
    const nameIn = h('input', { class: 'field', id: 'ab-name', value: r.ability.name || '', placeholder: 'the active name', oninput: (e) => { r.ability.name = e.target.value; touch(); } });
    const top = k.panel('Active', { sub: cls ? `Class: ${cls}. The budget is ${lib.budget} +/- ${lib.tolerance} PP (Silver: + ${lib.silver?.pp}).` : null });
    top.body.append(h('datalist', { id: 'ab-cardlist' }, ...cards.slice(0, 600).map((c) => h('option', { value: c.id }, c.name || c.id))),
      h('div', { class: 'cs-fgrid' }, field('Card', keyIn, null), field('Role', roleSel), field('Name', nameIn)), cardName);

    // blocks
    const bp = k.panel('Blocks', { sub: 'In order. An attachment (a condition or a modifier) changes the block right before it.' });
    const list = h('div', { class: 'ab-blocks', id: 'ab-blocks' });
    const c = checks.get(cur);
    r.ability.blocks.forEach((b, i) => list.append(blockEditor(r, b, i, c?.pps?.[i], touch, drawEdit)));
    const avail = lib.blocks.filter((b) => !b.reserved && (!cls || b.classes.includes(cls)));
    const addSel = h('select', { class: 'field', id: 'ab-addblock', 'aria-label': 'Add a block' }, h('option', { value: '' }, 'Add a block ...'),
      ...['main', 'modifier', 'rider', 'trigger', 'payoff', 'scaler', 'condition'].map((g) => {
        const xs = avail.filter((b) => b.grp === g); return xs.length ? h('optgroup', { label: g }, ...xs.map((b) => h('option', { value: b.key }, b.key))) : null; }).filter(Boolean));
    addSel.onchange = () => { if (!addSel.value) return; r.ability.blocks.push(newBlock(addSel.value)); touch(); drawEdit(); };
    bp.body.append(list, h('div', { class: 'ab-add' }, addSel));

    // Silver (type 1: a stronger number on the amount of one block)
    const sp = k.panel('Silver', { sub: `Type 1 only: one amount grows, + ${lib.silver?.pp} PP at ${lib.silver?.stars} stars.` });
    const amounts = r.ability.blocks.map((b, i) => [i, b, blockRow(b.k)?.amount]).filter(([, , a]) => a);
    const sv = r.ability.silver || null;
    const sSel = h('select', { class: 'field', id: 'ab-silver-block', onchange: (e) => {
      const i = e.target.value === '' ? null : Number(e.target.value);
      if (i === null) delete r.ability.silver;
      else { const a = blockRow(r.ability.blocks[i].k).amount; r.ability.silver = { block: i + 1, field: a, value: r.ability.blocks[i][a] ?? 0 }; }
      drawEdit(); touch(); } }, h('option', { value: '' }, 'No Silver'),
      ...amounts.map(([i, b, a]) => h('option', { value: String(i), selected: sv && sv.block === i + 1 }, `${i + 1}. ${b.k} (${a})`)));
    const sVal = h('input', { class: 'field', id: 'ab-silver-value', type: 'number', step: '0.001', value: sv ? String(sv.value) : '', disabled: !sv,
      oninput: (e) => { if (r.ability.silver) { r.ability.silver.value = e.target.value === '' ? null : Number(e.target.value); touch(); } } });
    sp.body.append(h('div', { class: 'cs-fgrid' }, field('Block', sSel), field('Silver value', sVal, sv ? `(base ${r.ability.blocks[sv.block - 1]?.[sv.field] ?? '-'})` : null)));

    // the check (LOCAL copy)
    const cp = k.panel('Check (local copy)', { sub: 'ability_v2_check: the PP, the card text, the Silver line and the chips come from the database.' });
    cp.body.append(checkView(c));
    edit.replaceChildren(top.el, bp.el, sp.el, cp.el);
  };

  const drawAll = () => { drawList(); drawEdit(); };
  const recheck = () => {
    if (cur < 0) return;
    const i = cur, my = ++seq, r = rows[i];
    clearTimeout(recheck.t);
    recheck.t = setTimeout(async () => {
      const out = await postJ(`${API}/check`, { role: r.role, ability: r.ability });
      if (my !== seq) return;
      if (!out.ok) { status.textContent = out.error || 'the check failed'; return; }
      status.textContent = '';
      checks.set(i, out.check);
      drawAll();
    }, 250);
  };

  saveBtn.onclick = async () => {
    status.textContent = 'Saving: every row is checked on the local copy ...';
    const out = await postJ(`${API}/batch/${encodeURIComponent(name)}`, { rows });
    if (out.ok) { saved = true; status.textContent = `Saved: ${out.rows} row${out.rows === 1 ? '' : 's'} in ${name}.json.`; return; }
    status.textContent = out.refused ? `${out.error}. ${out.refused.map((x) => `Row ${x.row} (${x.key}): ${x.errors[0]}`).join(' ')}` : (out.error || 'not saved');
  };
  drawAll();
  // check every row once (the list shows OK / errors)
  for (let i = 0; i < rows.length; i++) {
    const v0 = ver.get(i) || 0;
    const out = await postJ(`${API}/check`, { role: rows[i].role, ability: rows[i].ability });
    if (out.ok && (ver.get(i) || 0) === v0 && !checks.has(i)) checks.set(i, out.check);
  }
  drawAll();
}

/* ---- one block: its key, its fields (by type), up / down / remove, its PP */
function newBlock(key) {
  const b = { k: key }; const row = blockRow(key);
  for (const [f, s] of Object.entries(row.fields || {})) {
    if (!s.required) continue;
    if (['num_pos', 'share'].includes(s.type)) b[f] = 0.1; else if (s.type === 'num_x') b[f] = 1.5; else if (['int_pos', 'int_many'].includes(s.type)) b[f] = s.type === 'int_many' ? 2 : 1;
    else if (s.type === 'int_nonneg') b[f] = 0; else if (s.type === 'status_options') b[f] = [{ status: 'burn', stacks: 1 }, { status: 'slowed' }];
    else if (['status_list', 'cure_list'].includes(s.type)) b[f] = [];
    else { const st = statusesFor(s.type)[0]; if (st) b[f] = st.key; }
  }
  return b;
}
function blockEditor(r, b, i, ppv, touch, redraw) {
  const row = blockRow(b.k) || { fields: {}, rule: 'unknown block' };
  const B = r.ability.blocks;
  const move = (d) => { const j = i + d; if (j < 0 || j >= B.length) return; [B[i], B[j]] = [B[j], B[i]]; touch(); redraw(); };
  const fields = Object.entries(row.fields || {}).map(([f, s]) => fieldEditor(b, f, s, touch, redraw));
  const el = h('div', { class: `ab-block${row.attach ? ' attach' : ''}`, 'data-k': b.k },
    h('div', { class: 'ab-bhead' },
      h('span', { class: 'ab-bkey num' }, `${i + 1}. ${b.k}`),
      row.attach ? h('span', { class: 'ab-tag' }, row.attach === 'gate' ? 'gate' : 'attachment') : null,
      h('span', { class: 'ab-bpp num' }, ppv == null ? '' : `${pp(ppv)} PP`),
      h('span', { class: 'ab-btools' },
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Move up', onclick: () => { move(-1); } }, icon('up')),
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Move down', onclick: () => { move(1); } }, icon('down')),
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Remove', onclick: () => { B.splice(i, 1); if (r.ability.silver && r.ability.silver.block > B.length) delete r.ability.silver; touch(); redraw(); } }, icon('trash')))),
    h('p', { class: 'cs-note ab-rule' }, row.rule || ''),
    fields.length ? h('div', { class: 'cs-fgrid' }, ...fields) : null);
  return el;
}
function fieldEditor(b, f, s, touch, redraw) {
  const label = `${f}${s.required ? '' : ' (optional)'}`;
  const set = (v) => { if (v === undefined || v === '' || (Array.isArray(v) && !v.length && !s.required)) delete b[f]; else b[f] = v; touch(); };
  const t = s.type;
  if (['num_pos', 'num_x', 'num_nonneg', 'share', 'int_pos', 'int_many', 'int_nonneg'].includes(t)) {
    return field(label, h('input', { class: 'field', type: 'number', step: t.startsWith('int') ? '1' : '0.001', value: b[f] ?? '', oninput: (e) => set(e.target.value === '' ? undefined : Number(e.target.value)) }),
      t === 'share' ? '(0 to 1)' : t === 'num_x' ? '(above 1)' : null);
  }
  if (t === 'flag') return h('label', { class: 'cs-check' }, h('input', { type: 'checkbox', checked: !!b[f], onchange: (e) => set(e.target.checked ? true : undefined) }), f);
  if (['to_cured', 'to_shield', 'to_ally', 'per_count'].includes(t)) {
    const opts = t === 'to_cured' ? ['cured'] : t === 'to_shield' ? ['cured', 'most_hurt', 'strongest'] : t === 'to_ally' ? ['most_hurt', 'strongest']
      : ['kinds', ...statusesFor('status_stack').map((x) => x.key)];
    return field(label, h('select', { class: 'field', onchange: (e) => set(e.target.value || undefined) }, h('option', { value: '' }, t === 'per_count' ? '(none)' : '(the picked ally)'),
      ...opts.map((o) => h('option', { value: o, selected: b[f] === o }, o))));
  }
  if (['status_rider', 'status_enemy', 'status_stack', 'status_decay', 'status_card'].includes(t)) {
    return field(label, h('select', { class: 'field', onchange: (e) => set(e.target.value || undefined) }, s.required ? null : h('option', { value: '' }, '(none)'),
      ...statusesFor(t).map((x) => h('option', { value: x.key, selected: b[f] === x.key }, x.label))));
  }
  if (['status_list', 'cure_list'].includes(t)) {
    const cur = new Set(Array.isArray(b[f]) ? b[f] : []);
    const opts = [...(t === 'cure_list' ? [{ key: 'all', label: 'every harmful status' }] : []), ...statusesFor(t)];
    return h('div', { class: 'cs-field cs-wide' }, h('span', { class: 'lbl' }, label), h('div', { class: 'chips' }, ...opts.map((x) => h('button', {
      class: `chip${cur.has(x.key) ? ' on' : ''}`, type: 'button', 'aria-pressed': cur.has(x.key) ? 'true' : 'false',
      onclick: (e) => { if (cur.has(x.key)) cur.delete(x.key); else cur.add(x.key); e.currentTarget.classList.toggle('on'); e.currentTarget.setAttribute('aria-pressed', cur.has(x.key) ? 'true' : 'false');
        set(opts.map((o) => o.key).filter((o) => cur.has(o))); } }, x.label))));
  }
  if (t === 'status_options') {
    const ops = Array.isArray(b[f]) ? b[f] : [];
    const wrap = h('div', { class: 'cs-field cs-wide' }, h('span', { class: 'lbl' }, `${label}: one at random`));
    ops.forEach((o, j) => wrap.append(h('div', { class: 'ab-opt' },
      h('select', { class: 'field', 'aria-label': `Option ${j + 1}`, onchange: (e) => { o.status = e.target.value; if (!['add', 'add_decay'].includes(lib.statuses.find((x) => x.key === o.status)?.stacking)) delete o.stacks; set(ops); } },
        ...statusesFor('status_rider').filter((x) => !['add_cap', 'higher'].includes(x.stacking)).map((x) => h('option', { value: x.key, selected: o.status === x.key }, x.label))),
      h('input', { class: 'field', type: 'number', step: '1', min: '1', placeholder: 'stacks', value: o.stacks ?? '', 'aria-label': `Option ${j + 1} stacks`,
        oninput: (e) => { if (e.target.value === '') delete o.stacks; else o.stacks = Number(e.target.value); set(ops); } }),
      h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Remove the option', onclick: () => { ops.splice(j, 1); set(ops); redraw(); } }, icon('x')))));
    wrap.append(h('button', { class: 'btn', type: 'button', onclick: () => { ops.push({ status: 'slowed' }); set(ops); redraw(); } }, icon('plus'), 'Option'));
    return wrap;
  }
  return field(label, h('span', { class: 'cs-warn' }, `no editor for the type ${t}`));
}

/* ---- the answer of ability_v2_check */
function checkView(c) {
  if (!c) return h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Checking on the local copy');
  const budget = Number(lib.budget), tol = Number(lib.tolerance), v = Number(c.pp);
  const inBand = Number.isFinite(v) && Math.abs(v - budget) <= tol;
  const width = Number.isFinite(v) ? Math.max(0, Math.min(100, (v / (budget * 1.5)) * 100)) : 0;
  const band = { left: ((budget - tol) / (budget * 1.5)) * 100, width: ((2 * tol) / (budget * 1.5)) * 100 };
  const chips = (title, xs) => h('div', { class: 'ab-chiprow' }, h('span', { class: 'lbl' }, title), xs.length ? h('div', { class: 'chips' }, ...xs.map((s) => h('span', { class: 'chip' }, (lib.statuses.find((x) => x.key === s) || {}).label || s))) : h('span', { class: 'cs-note' }, 'none'));
  return h('div', { class: 'ab-check', id: 'ab-check' },
    h('div', { class: 'ab-meter' },
      h('div', { class: 'ab-mhead' }, h('span', { class: 'lbl' }, 'PP'), h('span', { class: 'num ab-ppv', id: 'ab-pp' }, `${pp(c.pp)} of ${budget} +/- ${tol}`),
        c.ok ? k.statusTag('pass', 'Valid') : k.statusTag('fail', `${c.errors.length} problem${c.errors.length === 1 ? '' : 's'}`)),
      h('div', { class: 'bar thick ab-bar' }, h('i', { class: 'ab-band', style: `left:${band.left}%;width:${band.width}%` }), h('span', { style: `width:${width}%;background:${inBand ? 'var(--success)' : 'var(--danger-text)'}` }))),
    h('div', { class: 'ab-text', id: 'ab-text' }, h('span', { class: 'lbl' }, `Card text (${c.words ?? 0} words${c.forms?.length ? `, short forms ${c.forms.join(' ')}` : ''})`),
      h('p', { class: 'ab-cardtext' }, c.text || '-')),
    h('div', { class: 'ab-text' }, h('span', { class: 'lbl' }, `Silver line${c.silver_pp != null ? ` (${pp(c.silver_pp)} PP)` : ''}`), h('p', { class: 'ab-silver' }, c.silver_text || 'No Silver')),
    chips('Makes', c.enables || []), chips('Uses', c.pays || []),
    c.errors?.length ? h('ul', { class: 'ab-errors', id: 'ab-errors' }, ...c.errors.map((e) => h('li', null, k.statusTag('fail', ''), h('span', null, e)))) : null);
}
