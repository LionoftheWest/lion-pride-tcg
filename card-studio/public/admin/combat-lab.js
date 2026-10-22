// Lion Pride TCG - Admin view: the Combat v2 Lab (docs/combat-redesign-plan.md 20.4). One page, #/combat-lab:
//  1. The flag and the testers: the four modes of balance combat_v2 and the tester list. Add or remove a tester with the balance editor of Phase 2
//     (Review the live value -> Test on the local copy -> Apply live -> the Admin log and balance_log). No other write path.
//  2. The fight viewer: a member of the local copy, a squad of the member's own cards (or auto: the Hunt auto-pick, the best N by v2 CP in the Dungeon), a Hunt boss or Dungeon foes,
//     RUN. The server runs the REAL v2 SQL functions on the LOCAL copy in a block that rolls back (src/combat-lab-routes.js). This page draws the
//     answer only: no combat math here. Compare (Hunt): the same squad in v1 (hunt_attack on a private test boss) and in v2.
//     PR E9: the Power number of each card (card_power_v2, in the card list and the squad table) and the squad value (combat_v2_squad_value) come from SQL.
// Every text goes in as textContent.

const API = '/api/admin/combat-lab';
const WRITE = { 'content-type': 'application/json', 'x-admin-write': '1' };
const getJ = async (url) => { const r = await fetch(url, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (url, body) => { const r = await fetch(url, { method: 'POST', headers: WRITE, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`); return j; };

let k = null; // the helpers of admin.js
const h = (...a) => k.h(...a);
const icon = (n) => k.icon(n);
const MODES = ['gauntlet', 'dungeon', 'hunt', 'progress'];
const STAT = [['atk', 'CP', 0], ['hp', 'HP', 0], ['def', 'DEF', 'p'], ['crt', 'Crit', 'p'], ['crd', 'Crit dmg', 2], ['abl', 'ABL', 2], ['ddg', 'Dodge', 'p'], ['acc', 'ACC', 'p'], ['spd', 'Speed', 1]];
const fmt = (v, d) => (v == null ? '-' : d === 'p' ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const num = (v) => (v == null ? '-' : Math.round(Number(v)).toLocaleString('en-US'));

let cssOnce = false;
function css() {
  if (cssOnce) return;
  cssOnce = true;
  for (const f of ['/admin/cards.css', '/admin/combat-lab.css']) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: f }));
}

export async function pageCombatLab(main, args, q, helpers) {
  k = helpers;
  css();
  main.append(h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading'));
  let setup;
  try { setup = await getJ(`${API}/setup`); } catch (e) { main.replaceChildren(k.errorState(e, () => k.render())); return; }
  main.replaceChildren(k.pageHead('Combat v2 Lab', 'See combat v2 with a member\'s own cards. The fights run the v2 SQL functions on the LOCAL copy and are rolled back: nothing is saved.'));
  const local = setup.local || {};
  main.append(h('p', { class: 'subtitle', id: 'cl-local', style: 'margin-bottom:12px' }, 'Local copy: ',
    local.reachable ? k.statusTag('pass', `${local.file}, refreshed ${local.written_at ? new Date(local.written_at).toLocaleString() : '-'}`) : k.statusTag('fail', local.error || 'not reachable'),
    ' ', setup.ready ? k.statusTag('pass', 'v2 functions found') : k.statusTag('fail', setup.error || 'no v2 E7 functions on the local copy')));
  main.append(testersPanel(setup));
  if (setup.ready) main.append(fightPanel(setup));
}

/* ================= 1. the flag and the testers ================= */
function testersPanel(setup) {
  const p = k.panel('Flag and testers', { sub: 'balance combat_v2. A tester plays every v2 mode before everyone (combat_v2_on(mode, player)). Edits go through the balance editor: review, test, apply, Admin log.' });
  const box = h('div', { id: 'cl-testers' });
  p.body.append(box);
  const draw = async () => {
    box.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Reading combat_v2'));
    const ED = k.ED;
    let value = null, where = 'LOCAL';
    if (ED?.state?.on) {
      try { const r = await k.api('/edit/balance'); value = (r.rows || []).find((x) => x.key === 'combat_v2')?.value ?? null; where = ED.state.status?.source || 'LIVE'; }
      catch (e) { box.replaceChildren(k.errorState(e, draw)); return; }
    } else value = setup.flag;
    const modes = h('div', { class: 'chips', id: 'cl-modes' }, MODES.map((m) => h('span', { class: `chip${value?.[m] === true ? ' on' : ''}` }, `${k.label(m)}: ${value?.[m] === true ? 'on for everyone' : 'off'}`)));
    const has = Array.isArray(value?.testers);
    const list = has ? value.testers : [];
    const names = await Promise.all(list.map((id) => getJ(`${API}/players?q=${encodeURIComponent(id)}`).then((r) => (r.rows || []).find((x) => x.id === id)?.username || null).catch(() => null)));
    const edit = (after, title) => ED.openChange({ kind: 'balance', key: 'combat_v2', path: ['testers'], after, reason: '' }, { title, onDone: () => setTimeout(draw, 600) });
    const canEdit = ED?.state?.on && has;
    const idIn = h('input', { class: 'field', id: 'cl-tester-id', placeholder: 'Discord id (17 to 20 digits)', inputmode: 'numeric', maxlength: '20' });
    const msg = h('p', { class: 'cs-msg', role: 'status' });
    box.replaceChildren(...[
      h('div', { class: 'lbl' }, `Modes (${where})`), modes,
      h('div', { class: 'lbl mt' }, `Testers: ${list.length} of 20`),
      !has ? h('p', { class: 'subtitle' }, `The ${where === 'LOCAL' ? 'local' : 'live'} combat_v2 has no tester list yet: apply combat_v2_testers.sql first.`) : null,
      list.length ? h('ul', { class: 'cl-tlist' }, list.map((id, i) => h('li', null, h('span', { class: 'num' }, id), h('span', { class: 'cs-note' }, names[i] || '(not on the local copy)'),
        canEdit ? h('button', { class: 'btn', type: 'button', onclick: () => edit(list.filter((x) => x !== id), 'Remove a v2 tester') }, icon('x'), 'Remove') : null)))
        : has ? h('p', { class: 'subtitle' }, 'No tester. combat_v2_on(mode, player) is the same as combat_v2_on(mode) for every member.') : null,
      canEdit ? h('div', { class: 'cl-add' }, idIn, h('button', { class: 'btn primary', type: 'button', id: 'cl-tester-add', onclick: () => {
        const id = idIn.value.trim();
        if (!/^[0-9]{17,20}$/.test(id)) { msg.textContent = 'A Discord id is 17 to 20 digits.'; return; }
        if (list.includes(id)) { msg.textContent = 'This id is a tester already.'; return; }
        if (list.length >= 20) { msg.textContent = 'The list has 20 ids (the limit).'; return; }
        msg.textContent = ''; edit([...list, id], 'Add a v2 tester');
      } }, icon('userplus'), 'Add tester'), msg)
        : !ED?.state?.on ? h('p', { class: 'subtitle' }, 'Turn on the editors (ADMIN_EDIT=1) to add or remove a tester.') : null].filter(Boolean));
  };
  draw();
  return p.el;
}

/* ================= 2. the fight viewer ================= */
function fightPanel(setup) {
  const st = { player: null, cards: [], pick: new Set(), auto: true, mode: 'hunt' };
  const sizes = setup.sizes || { hunt: 8, dungeon: 5 };
  const size = () => sizes[st.mode];
  const wrap = h('div', { class: 'stack' });
  const p = k.panel('Fight viewer', { sub: 'Auto v2 (combat_v2_auto, PR E8) makes every card choice: the active or the basic attack, the target and the ally. The log shows the Auto choice of each card action. Stat points: the simulator build of the role at the card level (no live card levels yet).' });
  wrap.append(p.el);

  // member search
  const qIn = h('input', { class: 'field', id: 'cl-q', type: 'search', placeholder: 'Member name or id', autocomplete: 'off' });
  const found = h('div', { class: 'cl-found', id: 'cl-found' });
  const who = h('div', { class: 'cl-who', id: 'cl-who' }, h('span', { class: 'subtitle' }, 'No member chosen.'));
  let tmr = null;
  qIn.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const qv = qIn.value.trim();
      if (!qv) { found.replaceChildren(); return; }
      try {
        const r = await getJ(`${API}/players?q=${encodeURIComponent(qv)}`);
        found.replaceChildren(...(r.rows.length ? r.rows.map((m) => h('button', { class: 'chip', type: 'button', onclick: () => choose(m) }, m.username || m.id, h('span', { class: 'cs-note' }, `${m.cards} cards`)))
          : [h('span', { class: 'subtitle' }, 'No member found on the local copy.')]));
      } catch (e) { found.replaceChildren(h('span', { class: 'err' }, e.message)); }
    }, 250);
  });

  // the squad
  const autoBtn = h('button', { type: 'button', class: 'on', onclick: () => { st.auto = true; drawSquad(); } }, 'Auto: best N');
  const pickBtn = h('button', { type: 'button', onclick: () => { st.auto = false; drawSquad(); } }, 'Choose cards');
  const squadSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Squad' }, autoBtn, pickBtn);
  const cardBox = h('div', { class: 'cl-cards', id: 'cl-cards' });
  const levelIn = h('input', { class: 'field cl-num', id: 'cl-level', type: 'number', min: '0', max: '30', value: '0' });
  let loadedLevel = null; // a blur fires change again: load only when the level moved (a reload moved the Run button under the click)
  levelIn.addEventListener('change', () => { if (st.player && Number(levelIn.value) !== loadedLevel) loadCards(); });
  const drawSquad = () => {
    autoBtn.className = st.auto ? 'on' : ''; pickBtn.className = st.auto ? '' : 'on';
    autoBtn.textContent = st.mode === 'hunt' ? 'Auto-pick' : `Auto: best ${size()}`;
    if (!st.player) { cardBox.replaceChildren(); return; }
    if (st.auto) {
      cardBox.replaceChildren(h('p', { class: 'subtitle' }, st.mode === 'hunt'
        ? `The Hunt auto-pick (combat_v2_autopick) of ${size()} cards at level ${levelIn.value || 0}: offense x the role answers of the boss x the Weak to bonus x the pair score.`
        : `The ${size()} cards with the highest v2 CP at level ${levelIn.value || 0}.`));
      return;
    }
    cardBox.replaceChildren(h('p', { class: 'subtitle' }, `Chosen ${st.pick.size} of ${size()}.`),
      h('div', { class: 'cl-cardlist' }, st.cards.map((c) => {
        const on = st.pick.has(c.card_id);
        return h('label', { class: `cl-card${on ? ' on' : ''}` },
          h('input', { type: 'checkbox', checked: on || null, onchange: (e) => {
            if (e.target.checked) { if (st.pick.size >= size()) { e.target.checked = false; return; } st.pick.add(c.card_id); } else st.pick.delete(c.card_id);
            drawSquad();
          } }),
          h('span', { class: 'cl-cname' }, k.rarityDot(c.rarity), c.name, h('span', { class: 'cs-note' }, ` ${'*'.repeat(c.stars || 0)}`)),
          h('span', { class: 'cs-note' }, `${k.label(c.role)} - Power ${num(c.power)} - CP ${fmt(c.cp, 1)} - ${c.active.name}${c.active.source === 'placeholder' ? ' (placeholder)' : ''}`));
      })));
  };
  async function loadCards() {
    loadedLevel = Number(levelIn.value) || 0;
    if (!cardBox.childNodes.length) cardBox.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Reading the cards'));
    cardBox.classList.add('loading-dim');
    try { st.cards = (await getJ(`${API}/player/${encodeURIComponent(st.player.id)}/cards?level=${Number(levelIn.value) || 0}`)).rows; st.pick = new Set([...st.pick].filter((id) => st.cards.some((c) => c.card_id === id))); drawSquad(); }
    catch (e) { cardBox.replaceChildren(h('span', { class: 'err' }, e.message)); }
    cardBox.classList.remove('loading-dim');
  }
  function choose(m) {
    st.player = m; st.pick = new Set();
    who.replaceChildren(h('strong', null, m.username || m.id), h('span', { class: 'cs-note num' }, ` ${m.id}`));
    found.replaceChildren();
    loadCards();
  }

  // the mode and the enemy
  const opt = (v, t, sel) => h('option', { value: v, selected: sel || null }, t);
  const bossSel = h('select', { class: 'field', id: 'cl-boss' }, (setup.bosses || []).map((b, i) => opt(b.key, b.name, i === 0)), opt('', 'Tier boss (no name)'));
  const tierSel = h('select', { class: 'field', id: 'cl-tier' }, (setup.tiers || []).map((t) => opt(t, t, t === 'Heroic')));
  const hpIn = h('input', { class: 'field cl-num', id: 'cl-hp', type: 'number', min: '5', max: '100', value: '100' });
  const monSel = h('select', { class: 'field', id: 'cl-monster' }, (setup.monsters || []).map((m) => opt(m, k.label(m))));
  const kindSel = h('select', { class: 'field', id: 'cl-kind' }, (setup.kinds || []).map((x) => opt(x, k.label(x), x === 'guardian')));
  const floorIn = h('input', { class: 'field cl-num', id: 'cl-floor', type: 'number', min: '1', max: '50', value: '3' });
  const roomIn = h('input', { class: 'field cl-num', id: 'cl-room', type: 'number', min: '1', max: '10', value: '5' });
  const foesIn = h('input', { class: 'field cl-num', id: 'cl-foes', type: 'number', min: '1', max: '4', value: '1' });
  const seedIn = h('input', { class: 'field cl-num', id: 'cl-seed', type: 'number', min: '1', max: '999999', value: '1' });
  const fld = (lbl, input) => h('label', { class: 'cs-field' }, h('span', { class: 'lbl' }, lbl), input);
  const huntBox = h('div', { class: 'cl-form' }, fld('Boss', bossSel), fld('Tier', tierSel), fld('Boss HP at start %', hpIn));
  const dngBox = h('div', { class: 'cl-form', hidden: true }, fld('Monster', monSel), fld('Room kind', kindSel), fld('Floor', floorIn), fld('Room', roomIn), fld('Foes', foesIn));
  const huntB = h('button', { type: 'button', class: 'on', onclick: () => setMode('hunt') }, icon('swords'), 'Hunt');
  const dngB = h('button', { type: 'button', onclick: () => setMode('dungeon') }, icon('castle'), 'Dungeon');
  const cmpBtn = h('button', { class: 'btn', type: 'button', id: 'cl-compare' }, icon('swap'), 'Compare v1 / v2');
  function setMode(m) {
    st.mode = m; huntB.className = m === 'hunt' ? 'on' : ''; dngB.className = m === 'dungeon' ? 'on' : '';
    huntBox.hidden = m !== 'hunt'; dngBox.hidden = m !== 'dungeon'; cmpBtn.hidden = m !== 'hunt';
    while (st.pick.size > size()) st.pick.delete([...st.pick].at(-1));
    drawSquad();
  }
  const runBtn = h('button', { class: 'btn primary', type: 'button', id: 'cl-run' }, icon('swords'), 'Run fight');
  const msg = h('p', { class: 'cs-msg', id: 'cl-msg', role: 'status' });
  p.body.append(
    h('div', { class: 'cl-step' }, h('div', { class: 'lbl' }, '1. Member'), qIn, found, who),
    h('div', { class: 'cl-step' }, h('div', { class: 'lbl' }, '2. Squad'), h('div', { class: 'cl-row' }, squadSeg, fld('Card level', levelIn)), cardBox),
    h('div', { class: 'cl-step' }, h('div', { class: 'lbl' }, '3. Mode'), h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, huntB, dngB), huntBox, dngBox),
    h('div', { class: 'cl-step' }, h('div', { class: 'cl-row' }, fld('Seed', seedIn), runBtn, cmpBtn), msg));
  drawSquad();

  const out = h('div', { class: 'stack', id: 'cl-out' });
  wrap.append(out);
  const body = () => ({ player: st.player?.id, mode: st.mode, cards: st.auto ? 'auto' : [...st.pick], level: Number(levelIn.value) || 0, seed: Number(seedIn.value) || 1,
    ...(st.mode === 'hunt' ? { boss: bossSel.value || null, tier: tierSel.value, start_hp: Math.max(5, Math.min(100, Number(hpIn.value) || 100)) / 100 }
      : { monster: monSel.value, kind: kindSel.value, floor: Number(floorIn.value) || 1, room: Number(roomIn.value) || 1, foes: Number(foesIn.value) || 1 }) });
  const ready = () => {
    if (!st.player) { msg.textContent = 'Choose a member first.'; return false; }
    if (!st.auto && !st.pick.size) { msg.textContent = 'Choose at least one card, or use Auto.'; return false; }
    msg.textContent = ''; return true;
  };
  runBtn.addEventListener('click', async () => {
    if (!ready()) return;
    runBtn.disabled = true; cmpBtn.disabled = true;
    out.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Running the fight on the local copy'));
    try { const r = await postJ(`${API}/fight`, body()); out.replaceChildren(...result(r)); } catch (e) { out.replaceChildren(k.errorState(e)); }
    runBtn.disabled = false; cmpBtn.disabled = false;
  });
  cmpBtn.addEventListener('click', async () => {
    if (!ready()) return;
    runBtn.disabled = true; cmpBtn.disabled = true;
    out.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Running v1 and v2 on the local copy'));
    try { const r = await postJ(`${API}/compare`, body()); out.replaceChildren(compareView(r)); } catch (e) { out.replaceChildren(k.errorState(e)); }
    runBtn.disabled = false; cmpBtn.disabled = false;
  });
  return wrap;
}

/* ================= the answer ================= */
const kpi = (lbl, val, sub) => h('div', { class: 'kpi' }, h('div', { class: 'lbl' }, lbl), h('div', { class: 'val num' }, val), sub ? h('div', { class: 'sub' }, sub) : null);
const stTxt = (s, v) => `${k.label(s)}${typeof v === 'number' ? ` ${+Number(v).toFixed(2)}` : ''}`;

function result(r) {
  const T = r.totals;
  const names = {};
  for (const s of r.squad) names[s.unit] = s.name;
  const bossName = r.request.mode === 'hunt' ? (r.boss_card?.name || (r.request.boss ? k.label(r.request.boss) : `${r.request.tier} tier boss`)) : null;
  r.enemies.forEach((e, i) => { names[`enemy:${i}`] = bossName || `${k.label(e.monster)}${r.enemies.length > 1 ? ` ${i + 1}` : ''}`; });
  const nm = (u) => names[u] || u;

  const head = h('div', { class: 'kpis', id: 'cl-totals' },
    kpi('Result', r.request.mode === 'hunt' && T.result === 'lost' ? 'squad down' : T.result, r.request.mode === 'hunt' ? 'a Hunt day ends at the step cap' : null),
    kpi(r.request.mode === 'hunt' ? 'Damage (net)' : 'Damage', num(T.net), T.enemy_heal ? `enemy heals ${num(T.enemy_heal)}` : null),
    kpi('Steps', `${T.steps} of ${T.cap ?? '-'}`, `${T.actions} actions`),
    kpi('Crits / misses', `${T.crits} / ${T.misses}`, `${T.actives} actives, ${T.basics} basics, ${T.skips} skips`),
    kpi('Damage taken', num(T.damage_taken), `${T.cards_down} card${T.cards_down === 1 ? '' : 's'} down`),
    kpi('Enemies down', `${T.enemies_down} of ${r.enemies.length}`),
    kpi('Squad value', r.squad_value ? num(r.squad_value.shown) : '-', r.squad_value ? 'the Power of each card x its pair score (combat_v2_squad_value)' : 'no E9 functions on the local copy'));

  // the squad
  const sp = k.panel('Squad', { sub: `${r.squad.length} cards, level ${r.request.level}. v2 stats from card_combat_v2; the active from subjects.ability_v2, else the simulator placeholder.` });
  sp.body.append(...[k.table({ phone: 'recs', title: 'name', rows: r.squad, cols: [
    { key: 'name', label: 'Card', fmt: (s) => h('span', { class: 'cl-cname' }, k.rarityDot(s.rarity), `${s.name} ${'*'.repeat(s.stars || 0)}`) },
    { key: 'role', label: 'Role', fmt: (s) => `${s.v2?.passive?.label || k.label(s.role)} (${s.v2?.class || '-'})` },
    { key: 'power', label: 'Power', r: true, fmt: (s) => (s.power && s.power.power != null ? h('div', null, h('div', { class: 'num' }, num(s.power.power)), h('div', { class: 'cs-note' }, powerNote(s.power)))
      : s.power?.error ? h('span', { class: 'err' }, s.power.error) : '-') },
    ...STAT.map(([key, lbl, d]) => ({ key, label: lbl, r: true, fmt: (s) => fmt(s.v2?.stats?.[key], d) })),
    { key: 'active', label: 'Active', fmt: (s) => h('div', { class: 'cl-active' }, h('strong', null, s.active.name), s.active.source === 'placeholder' ? h('span', { class: 'cs-note' }, ' placeholder') : null,
      h('div', null, s.active.text || s.active.error || '-'), h('div', { class: 'cs-note' }, `Charge: ${s.charge_need} own turns. ${s.passive_text || ''}`)) },
    { key: 'dealt', label: 'Damage', r: true, fmt: (s) => num(s.dealt) },
    ...(r.squad.some((s) => s.pick) ? [{ key: 'pick', label: 'Pick score', r: true, fmt: (s) => (s.pick ? h('div', null, h('div', { class: 'num' }, num(s.pick.score)),
      h('div', { class: 'cs-note' }, pickNote(s.pick))) : '-') }] : []),
  ] })].flat());

  // the enemy card
  const ep = k.panel(r.request.mode === 'hunt' ? 'Boss' : 'Foes', { sub: r.request.mode === 'hunt' ? `${r.request.tier}, HP at start ${Math.round(r.request.start_hp * 100)}%` : `Floor ${r.request.floor}, room ${r.request.room}, ${k.label(r.request.kind)}` });
  ep.body.append(...r.enemies.map((e, i) => enemyCard(e, i, nm(`enemy:${i}`), r)));

  // the turn order
  const tp = k.panel('Turn order', { sub: 'The next 12 actors at the start (combat_v2_turn_order).' });
  tp.body.append(h('ol', { class: 'cl-order' }, (r.turn_order || []).map((a) => h('li', { class: a.side === 'enemy' ? 'enemy' : '' }, nm(`${a.side}:${a.side === 'enemy' ? Number(a.id) : a.id}`), h('span', { class: 'cs-note' }, ` step ${a.clock}`)))));

  // the log
  const lp = k.panel('Action log', { sub: `${r.events.filter((e) => e.kind !== 'step').length} actions. Changes come from the fight state before and after each action.` });
  lp.body.append(h('ol', { class: 'cl-log', id: 'cl-log' }, r.events.map((e) => logRow(e, nm))));
  return [head, sp.el, h('div', { class: 'cols-2' }, ep.el, tp.el), lp.el];
}

function enemyCard(e, i, name, r) {
  // the server fills each text with the unit's OWN numbers (a named boss: hunt_boss_v2_card); no number math here
  const mechs = (e.lines || []).map((m) => h('li', null, h('strong', null, m.label), m.mythic ? h('span', { class: 'cs-note' }, ' (Mythic)') : null, m.text ? ` ${m.text}` : null));
  const bc = i === 0 ? r.boss_card : null;
  const chips = (lbl, list) => (list && list.length ? h('div', { class: 'cl-line' }, h('span', { class: 'lbl' }, lbl), h('div', { class: 'chips' }, list.map((x) => h('span', { class: 'chip' }, typeof x === 'string' ? x : x.label || x.key || JSON.stringify(x))))) : null);
  const moves = (e.moves2 || e.moves || []).map((m) => k.label(m.id || m.k));
  return h('div', { class: 'cl-enemy' },
    h('div', { class: 'cl-ehead' }, h('strong', null, name), h('span', { class: 'cs-note num' }, ` HP ${num(e.hp)} / ${num(e.max)}, ATK ${fmt(e.atk, 1)}, DEF ${fmt(e.def, 'p')}, speed ${fmt(e.speed, 0)}`)),
    e.weak_role ? h('div', { class: 'cl-line' }, h('span', { class: 'lbl' }, 'Weak to'), h('span', { class: 'chip on' }, k.label(e.weak_role))) : chips('Weak to', bc?.weak_to),
    chips('Resists', (e.resists || []).map((x) => k.label(x))),
    mechs.length ? h('div', { class: 'cl-line' }, h('span', { class: 'lbl' }, 'Mechanics'), h('ul', { class: 'cl-mechs' }, mechs)) : null,
    moves.length ? chips(e.moves2 ? 'Counter moves' : 'Moves', moves) : null,
    bc ? chips('Counters', bc.counters) : null, bc ? chips('Bring', bc.bring) : null);
}

function changeText(c, nm) {
  const out = [];
  if (c.hp) { const d = c.hp[1] - c.hp[0]; out.push(`${d < 0 ? '-' : '+'}${num(Math.abs(d))} HP (${num(c.hp[1])})`); }
  if (c.add) out.push(...Object.entries(c.add).map(([s, v]) => `+${stTxt(s, v)}`));
  if (c.drop) out.push(...c.drop.map((s) => `-${k.label(s)}`));
  if (c.charging === true) out.push('Charging');
  if (c.down) out.push('DOWN');
  return out.length ? h('span', { class: `cl-chg${c.down ? ' down' : ''}` }, h('b', null, nm(c.unit)), ` ${out.join(', ')}`) : null;
}

// the Auto v2 choice of a card action (combat_v2_auto why)
const AUTO_WHY = { charging: 'not charged', ready: 'charged', held: 'held too long', useful: 'useful now', not_useful: 'not useful now', hold_pay: 'waits for its status',
  hold_execute: 'waits for the HP line', hold_gate: 'waits for its condition', hold_kinds: 'waits for more statuses', hold_charging: 'waits for Charging', no_enemy: 'no enemy' };
// the parts of a Power number as SQL gives them (card_power_v2): offense, survival, role k, and the value term of a support active (smite, dot, control PP)
const powerNote = (p) => [`offense ${num(p.offense)}`, `survival ${num(p.survival)}`, `k ${+Number(p.k).toFixed(3)}`,
  Number(p.v) > 0 ? `active value ${+Number(p.v).toFixed(2)} (PP smite ${+Number(p.pp?.smite).toFixed(1)}, dot ${+Number(p.pp?.dot).toFixed(1)}, control ${+Number(p.pp?.control).toFixed(1)})` : null].filter(Boolean).join(', ');
const pickNote = (x) => [`offense ${num(x.off)}`, Number(x.weak) !== 1 ? `Weak to x${+Number(x.weak).toFixed(2)}` : null, Number(x.ans) !== 1 ? `answers x${+Number(x.ans).toFixed(2)}` : null,
  Number(x.pair) !== 1 ? `pair x${+Number(x.pair).toFixed(2)}` : null].filter(Boolean).join(', ');

function logRow(e, nm) {
  const chg = (e.changes || []).map((c) => changeText(c, nm)).filter(Boolean);
  if (e.kind === 'step') {
    const ticks = (e.ticks || []).map((t) => `${k.label(t.status)} ${num(t.dmg)} on ${nm(`${t.side}:${t.side === 'enemy' ? Number(t.id) : t.id}`)}`);
    return h('li', { class: 'cl-ev step' }, h('span', { class: 'cl-n num' }, `step ${e.clock}`),
      h('div', null, h('span', { class: 'cs-note' }, ticks.length ? `End of step: ${ticks.join(', ')}` : 'End of step'), chg.length ? h('div', { class: 'cl-chgs' }, chg) : null));
  }
  const who = nm(e.actor);
  let what;
  if (e.kind === 'skip') what = `${who} skips (${k.label(e.reason || 'skip')})`;
  else if (e.kind === 'card') {
    const hits = e.hits.map((x) => `${x.miss ? 'miss' : num(x.dmg)}${x.crit ? ' CRIT' : ''}${x.tag ? ` ${x.tag}` : ''}${x.target ? ` on ${nm(x.target)}` : ''}`);
    what = `${who}: ${e.action === 'active' ? 'ACTIVE' : 'basic'}${hits.length ? ` - ${hits.join(', ')}` : ''}`;
  } else what = `${who}: ${k.label(e.move || 'move')}`;
  const auto = e.kind === 'card' && e.auto ? h('span', { class: 'cs-note cl-auto' }, ` Auto: ${AUTO_WHY[e.auto.why] || e.auto.why}${e.auto.target ? `, target ${nm(e.auto.target)}` : ''}${e.action === 'active' && e.auto.ally ? `, ally ${nm(e.auto.ally)}` : ''}`) : null;
  return h('li', { class: `cl-ev ${e.kind}` }, h('span', { class: 'cl-n num' }, `#${e.n} s${e.clock}`),
    h('div', null, h('div', { class: 'cl-what' }, what, auto), chg.length ? h('div', { class: 'cl-chgs' }, chg) : null));
}

function compareView(r) {
  const p = k.panel('Compare: v1 (live) and v2', { sub: `${r.squad.length} cards: ${r.squad.map((s) => s.name).join(', ')}` });
  const v1 = r.v1, v2 = r.v2;
  const col = (title, rule, rows) => h('div', { class: 'cl-cmp' }, h('h3', null, title), h('p', { class: 'cs-note' }, rule),
    h('dl', null, rows.map(([a, b]) => h('div', null, h('dt', null, a), h('dd', { class: 'num' }, b)))));
  p.body.append(h('div', { class: 'cols-2', id: 'cl-cmp' },
    col('v1 (hunt_attack)', v1.rule, [['Damage', num(v1.damage)], ['Attacks', num(v1.attacks)], ['Cards down', num(v1.downs)], ['Round cap', num(v1.round_cap)], ['Boss HP', num(v1.boss_hp)]]),
    col('v2 (combat v2 SQL)', v2.rule, [['Damage (net)', num(v2.net)], ['Actions', num(v2.actions)], ['Cards down', num(v2.cards_down)], ['Steps', `${v2.steps} of ${v2.cap ?? '-'}`], ['Result', v2.result]])));
  const ratio = v1.damage > 0 ? v2.net / v1.damage : null;
  p.body.append(h('p', { class: 'subtitle mt' }, ratio == null ? 'v1 dealt no damage.' : `v2 / v1 damage: x${ratio.toFixed(2)}. The v1 boss is a private test boss of the tier with no passive; the v2 boss is the chosen boss.`));
  return p.el;
}
