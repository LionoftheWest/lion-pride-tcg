// Lion Pride TCG - Admin view, the Test lab (Phase 3). A scenario = balance changes + a simulation. The run: the simulation
// on the LOCAL copy twice (baseline, then the scenario inside a rolled-back block, the same seeds), side by side. Apply live:
// the same changes through the Phase 2 Apply path (/api/admin/edit/apply, one admin_actions row per key, Undo in the Admin log).
// The server: /api/admin/lab/* (card-studio/src/admin-lab.js). The simulations: card-studio/src/sims/.
import { pairChart } from './charts.js';

export async function pageLab(main, k) {
  const { h, icon, api, panel, table, pageHead, N, P, statusTag, errorState, ED } = k;
  const isObj = (v) => v != null && typeof v === 'object';
  const lab = (p) => api(`/lab${p}`);
  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-admin-write': '1' }, body: JSON.stringify(body || {}) });
    if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('Login required'); }
    let j = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok) { const e = new Error(j?.error || `The server answered ${r.status}`); e.status = r.status; throw e; }
    return j;
  }
  const words = (s) => String(s).replace(/_/g, ' ');
  const pathText = (p) => (p.length ? p.map(words).join(' / ') : 'value');
  const show = (v) => (v === undefined || v === null ? '-' : typeof v === 'string' ? v : JSON.stringify(v));
  const fmtv = (v, f) => (v == null ? '-' : f === 'pct' ? P(v) : f === 'pct3' ? P(v, 3) : f === 'pctint' ? `${N(v)}%` : N(v));
  const leaves = (v, path = []) => (isObj(v) ? Object.entries(v).flatMap(([kk, x]) => leaves(x, [...path, kk])) : [{ path, value: v }]);

  main.append(pageHead('Test lab', 'Scenarios on the local copy', ED.state.on ? ED.localLine() : null));
  const grid = h('div', { class: 'lab-grid' });
  main.append(grid);
  let sims, balance, saved;
  try {
    [sims, balance, saved] = await Promise.all([lab('/sims'), lab('/balance'), lab('/scenarios')]);
  } catch (e) { grid.replaceChildren(errorState(e)); return; }
  const SIM = Object.fromEntries(sims.sims.map((s) => [s.id, s]));
  const KEYS = balance.rows;
  const keyRow = (key) => KEYS.find((r) => r.key === key);

  // The scenario being edited.
  const sc = { name: '', sim: 'hunt', params: {}, changes: [] };
  const defaults = (simId) => Object.fromEntries(SIM[simId].fields.map((f) => [f.name, f.def]));
  sc.params = defaults(sc.sim);
  // the form fields only (a run or a saved scenario holds the checked parameters: a list of every boss shows as 'All bosses')
  const pickParams = (simId, p = {}) => ({ ...defaults(simId), ...Object.fromEntries(SIM[simId].fields.filter((f) => p[f.name] !== undefined)
    .map((f) => { const v = Array.isArray(p[f.name]) ? p[f.name] : isObj(p[f.name]) ? Object.keys(p[f.name]) : p[f.name];
      return [f.name, Array.isArray(v) ? (v.length === 1 ? v[0] : '') : v]; })) });

  /* ---------- the scenario panel ---------- */
  const sp = panel('Scenario');
  const savedSel = h('select', { class: 'field', 'aria-label': 'Saved scenarios' });
  const nameIn = h('input', { class: 'field', type: 'text', maxlength: 80, placeholder: 'Name', 'aria-label': 'Scenario name' });
  const delBtn = h('button', { class: 'btn', type: 'button', 'aria-label': 'Delete the saved scenario' }, icon('x'), 'Delete');
  const changesBox = h('div', { class: 'lab-changes' });
  const simSel = h('select', { class: 'field', 'aria-label': 'Simulation' }, sims.sims.map((s) => h('option', { value: s.id }, s.label)));
  const paramsBox = h('div', { class: 'lab-params' });
  const msg = h('div', { class: 'lab-msg', role: 'status' });
  const saveBtn = h('button', { class: 'btn', type: 'button' }, 'Save');
  const runBtn = h('button', { class: 'btn primary', type: 'button' }, icon('flask'), 'Run');
  sp.body.append(
    h('div', { class: 'lab-row' }, h('label', { class: 'lab-lbl' }, h('span', { class: 'lbl' }, 'Saved'), savedSel), delBtn),
    h('label', { class: 'lab-lbl' }, h('span', { class: 'lbl' }, 'Name'), nameIn),
    h('div', { class: 'lbl mt' }, 'Changes'), changesBox,
    h('button', { class: 'btn', type: 'button', onclick: () => { sc.changes.push(newChange()); drawChanges(); syncApply(); } }, '+ Add change'),
    h('label', { class: 'lab-lbl mt' }, h('span', { class: 'lbl' }, 'Simulation'), simSel), paramsBox,
    h('div', { class: 'form-actions' }, msg, saveBtn, runBtn));

  function drawSaved(selectId = '') {
    savedSel.replaceChildren(h('option', { value: '' }, 'New scenario'), ...saved.scenarios.map((s) => h('option', { value: s.id, selected: s.id === selectId || null }, s.name)));
    delBtn.disabled = !savedSel.value;
  }
  savedSel.addEventListener('change', () => {
    const s = saved.scenarios.find((x) => x.id === savedSel.value);
    delBtn.disabled = !s;
    if (!s) return;
    Object.assign(sc, { name: s.name, sim: SIM[s.sim] ? s.sim : 'hunt', params: pickParams(SIM[s.sim] ? s.sim : 'hunt', s.params), changes: structuredClone(s.changes) });
    drawAll();
  });
  delBtn.addEventListener('click', async () => {
    if (!savedSel.value) return;
    try { await post('/api/admin/lab/scenarios/delete', { id: savedSel.value }); saved = await lab('/scenarios'); drawSaved(); msg.replaceChildren(statusTag('pass', 'Deleted')); }
    catch (e) { msg.replaceChildren(statusTag('fail', e.message)); }
  });

  function newChange() {
    const row = keyRow('boss_hp') || KEYS[0];
    const lf = leaves(row.value)[0];
    return { key: row.key, path: lf.path, after: lf.value };
  }
  function drawChanges() {
    changesBox.replaceChildren(...(sc.changes.length ? sc.changes.map((c, i) => changeRow(c, i)) : [h('div', { class: 'empty' }, 'No change')]));
  }
  function changeRow(c, i) {
    const row = keyRow(c.key);
    const lfs = row ? leaves(row.value) : [];
    const keySel = h('select', { class: 'field', 'aria-label': `Change ${i + 1}: balance key` }, KEYS.map((r) => h('option', { value: r.key, selected: r.key === c.key || null }, r.key)));
    const pathSel = h('select', { class: 'field', 'aria-label': `Change ${i + 1}: value` }, lfs.map((l, j) => h('option', { value: String(j), selected: JSON.stringify(l.path) === JSON.stringify(c.path) || null }, pathText(l.path))));
    const cur = lfs.find((l) => JSON.stringify(l.path) === JSON.stringify(c.path));
    const local = cur ? cur.value : undefined;
    let input;
    if (typeof local === 'boolean') {
      input = h('select', { class: 'field', 'aria-label': `Change ${i + 1}: new value` }, [true, false].map((b) => h('option', { value: String(b), selected: c.after === b || null }, b ? 'On' : 'Off')));
      input.addEventListener('change', () => { c.after = input.value === 'true'; syncApply(); });
    } else if (typeof local === 'number') {
      input = h('input', { class: 'field num', type: 'number', step: 'any', value: String(c.after), 'aria-label': `Change ${i + 1}: new value` });
      input.addEventListener('input', () => { c.after = input.value.trim() === '' ? null : Number(input.value); syncApply(); });
    } else {
      input = h('input', { class: 'field', type: 'text', value: c.after == null ? '' : String(c.after), maxlength: 400, 'aria-label': `Change ${i + 1}: new value` });
      input.addEventListener('input', () => { c.after = input.value; syncApply(); });
    }
    keySel.addEventListener('change', () => { const r = keyRow(keySel.value); const lf = leaves(r.value)[0]; Object.assign(c, { key: r.key, path: lf.path, after: lf.value }); drawChanges(); syncApply(); });
    pathSel.addEventListener('change', () => { const lf = lfs[Number(pathSel.value)]; Object.assign(c, { path: lf.path, after: lf.value }); drawChanges(); syncApply(); });
    return h('div', { class: 'lab-change' },
      h('div', { class: 'lab-change-pick' }, keySel, pathSel),
      h('div', { class: 'lab-change-val' }, h('span', { class: 'num lab-local' }, h('span', { class: 'lbl' }, 'Local'), show(local)), icon('back', 'ico flip'), input,
        h('button', { class: 'btn icon-only', type: 'button', 'aria-label': `Remove change ${i + 1}`, onclick: () => { sc.changes.splice(i, 1); drawChanges(); syncApply(); } }, icon('x'))));
  }
  function drawParams() {
    paramsBox.replaceChildren(...SIM[sc.sim].fields.map((f) => {
      let el;
      if (f.type === 'select') {
        el = h('select', { class: 'field', 'aria-label': f.label }, f.options.map((o) => h('option', { value: o, selected: String(sc.params[f.name] ?? '') === o || null }, f.optionLabels?.[o] ?? o)));
        el.addEventListener('change', () => { sc.params[f.name] = el.value; syncApply(); });
      } else {
        el = h('input', { class: 'field num', type: 'number', min: f.min, max: f.max, step: f.step || 1, value: String(sc.params[f.name] ?? f.def), 'aria-label': f.label });
        el.addEventListener('input', () => { sc.params[f.name] = el.value === '' ? null : Number(el.value); syncApply(); });
      }
      return h('label', { class: 'lab-lbl' }, h('span', { class: 'lbl' }, f.label), el);
    }));
  }
  simSel.addEventListener('change', () => { sc.sim = simSel.value; sc.params = defaults(sc.sim); drawParams(); syncApply(); });
  nameIn.addEventListener('input', () => { sc.name = nameIn.value; });
  function drawAll() { nameIn.value = sc.name; simSel.value = sc.sim; drawChanges(); drawParams(); syncApply(); }

  const body = () => ({ sim: sc.sim, params: Object.fromEntries(Object.entries(sc.params).filter(([, v]) => v !== null && v !== '')), changes: sc.changes });
  saveBtn.addEventListener('click', async () => {
    if (sc.name.trim().length < 2) { msg.replaceChildren(statusTag('fail', 'Write a name')); nameIn.focus(); return; }
    try {
      const r = await post('/api/admin/lab/scenarios', { name: sc.name, ...body() });
      saved = await lab('/scenarios'); drawSaved(r.scenario.id); msg.replaceChildren(statusTag('pass', 'Saved'));
    } catch (e) { msg.replaceChildren(statusTag('fail', e.message)); }
  });
  runBtn.addEventListener('click', async () => {
    msg.replaceChildren();
    try { job = await post('/api/admin/lab/run', body()); drawJob(); poll(); } catch (e) { msg.replaceChildren(statusTag('fail', e.message)); }
  });

  /* ---------- the result panel ---------- */
  const rp = panel('Result');
  const jobBox = h('div', { class: 'lab-job' });
  const applyBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('check'), 'Apply live');
  const applyNote = h('span', { class: 'subtitle' });
  rp.body.append(jobBox, h('div', { class: 'form-actions' }, applyNote, applyBtn));
  grid.append(sp.el, rp.el);

  let job = null, timer = null;
  const sameChanges = () => job?.changes && JSON.stringify(job.changes.map((c) => [c.key, c.path, c.after])) === JSON.stringify(sc.changes.map((c) => [c.key, c.path, c.after]));
  function syncApply() {
    const ready = job?.state === 'done' && job.result?.compare && sameChanges();
    applyBtn.disabled = !(ready && ED.state.on);
    applyNote.textContent = !ED.state.on ? 'Apply needs the editors (ADMIN_EDIT=1)' : job?.state === 'done' && !sameChanges() ? 'The changes differ from the run' : '';
  }
  function poll() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!document.body.contains(jobBox)) return;
      try { job = await lab('/job'); } catch { /* next poll */ }
      drawJob();
      if (job?.state === 'running') poll();
    }, 1000);
  }
  function progressView(j) {
    const pr = j.progress || {};
    const share = ((pr.phase === 'scenario' ? 1 : 0) + (pr.total ? pr.done / pr.total : 0)) / (SIM[j.sim]?.compare ? 2 : 1);
    return h('div', { class: 'lab-progress' },
      h('div', { class: 'lab-progress-top' }, h('span', { class: 'status idle' }, h('span', { class: 'spin' }), `Running: ${pr.phase === 'scenario' ? 'scenario' : 'baseline'}${pr.item ? `, ${pr.item}` : ''}`),
        h('span', { class: 'num' }, `${Math.round(100 * Math.min(1, share))}%`),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await post('/api/admin/lab/job/cancel', {}); } catch (e) { msg.replaceChildren(statusTag('fail', e.message)); } } }, icon('x'), 'Cancel')),
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(100 * share) },
        h('span', { style: `width:${Math.round(100 * Math.min(1, share))}%` })));
  }
  function drawJob() {
    syncApply();
    runBtn.disabled = job?.state === 'running';
    if (!job || job.state === 'idle') { jobBox.replaceChildren(h('div', { class: 'empty' }, 'No run yet')); return; }
    const head = h('div', { class: 'lab-job-head' }, h('strong', null, SIM[job.sim]?.label || job.sim),
      h('span', { class: 'num subtitle' }, job.changes.map((c) => `${c.key} ${pathText(c.path)} = ${show(c.after)}`).join(', ')));
    if (job.state === 'running') { jobBox.replaceChildren(head, progressView(job)); return; }
    if (job.state !== 'done') { jobBox.replaceChildren(head, h('div', { class: 'state error' }, icon('fail'), job.error || job.state)); return; }
    jobBox.replaceChildren(head, statusTag('pass', job.result.compare ? 'Baseline and scenario finished' : 'Finished (recorded data: the scenario does not change it)'), ...resultView(job));
  }
  function resultView(j) {
    const res = j.result, cmp = res.compare;
    const ms = res.metrics;
    const out = [];
    // charts: one per group of metrics (a shared scale)
    const groups = [...new Set(ms.filter((m) => m.chart).map((m) => m.chart))];
    for (const g of groups) {
      const rows = ms.filter((m) => m.chart === g);
      if (!cmp) continue;
      out.push(h('div', { class: 'lab-chart' }, h('div', { class: 'lbl' }, g),
        pairChart({ rows: rows.map((m) => ({ label: m.short || m.label, a: m.before, b: m.after })), fmt: (v) => N(v), name: g })));
    }
    out.push(table({ phone: 'recs', title: 'label', rows: ms, cols: [
      { key: 'label', label: 'Number' },
      { key: 'before', label: cmp ? 'Baseline' : 'Value', r: true, fmt: (m) => fmtv(m.before, m.fmt) },
      ...(cmp ? [{ key: 'after', label: 'Scenario', r: true, fmt: (m) => fmtv(m.after, m.fmt) },
        { key: 'diff', label: 'Change', r: true, fmt: (m) => (m.diff == null || m.diff === 0 ? h('span', { class: 'muted' }, m.diff === 0 ? '0' : '-')
          : `${m.diff > 0 ? '+' : ''}${fmtv(m.diff, m.fmt)}${m.pct != null && m.fmt == null ? ` (${m.pct > 0 ? '+' : ''}${(100 * m.pct).toFixed(1)}%)` : ''}`) }] : [])] }));
    out.push(...details(j));
    return out;
  }
  function details(j) {
    const b = j.result.baseline, s = j.result.scenario;
    if (j.sim === 'dungeon') {
      return b.groups.map((g) => {
        const sg = s?.groups.find((x) => x.tier === g.tier);
        const names = [...new Set([...g.card_damage.map((c) => c.card), ...(sg?.card_damage || []).map((c) => c.card)])];
        const rows = names.map((id) => ({ name: (g.card_damage.find((c) => c.card === id) || sg?.card_damage.find((c) => c.card === id)).name,
          a: g.card_damage.find((c) => c.card === id)?.damage ?? null, b: sg?.card_damage.find((c) => c.card === id)?.damage ?? null }));
        return h('details', { class: 'lab-details' }, h('summary', null, `Damage per card per run, ${g.tier}${g.power ? ` (power ${N(g.power)})` : ''}`),
          table({ phone: 'recs', title: 'name', rows, cols: [{ key: 'name', label: 'Card' }, { key: 'a', label: 'Baseline', r: true, fmt: (x) => N(x.a) },
            ...(s ? [{ key: 'b', label: 'Scenario', r: true, fmt: (x) => N(x.b) }] : [])] }));
      });
    }
    if (j.sim === 'combat_stats') {
      return [h('details', { class: 'lab-details' }, h('summary', null, `Recorded Hunts (${b.fights.length})`),
        table({ phone: 'recs', title: 'name', rows: b.fights, cols: [{ key: 'name', label: 'Boss' }, { key: 'tier', label: 'Tier' }, { key: 'hp_max', label: 'HP', r: true, fmt: (x) => N(x.hp_max) },
          { key: 'attacks', label: 'Attacks', r: true, fmt: (x) => N(x.attacks) }, { key: 'hunters', label: 'Hunters', r: true, fmt: (x) => N(x.hunters) }, { key: 'status', label: 'Status' }] }))];
    }
    if (j.sim === 'economy') return [h('p', { class: 'subtitle' }, `Estimates: pull rates x pack size; the averages of the last ${b.days} days.`)];
    return [];
  }

  /* ---------- Apply live: the plan, then the Phase 2 Apply path per key ---------- */
  applyBtn.addEventListener('click', async () => {
    const back = h('div', { class: 'modal-back' });
    const mbody = h('div', { class: 'modal-body' });
    const close = () => { back.remove(); dlg.remove(); };
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Apply live' },
      h('div', { class: 'modal-head' }, h('strong', null, 'Apply live'), h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))), mbody);
    back.addEventListener('click', close);
    document.body.append(back, dlg);
    mbody.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Reading the live values'));
    let plan;
    try { plan = (await post('/api/admin/lab/plan', { changes: sc.changes })).plan; } catch (e) { mbody.replaceChildren(h('div', { class: 'state error' }, icon('fail'), e.message)); return; }
    const reason = h('textarea', { class: 'field reason', rows: 2, maxlength: 500, placeholder: 'Reason', 'aria-label': 'Reason' }, sc.name ? `Test lab: ${sc.name}` : '');
    const out = h('div', { role: 'status' });
    const go = h('button', { class: 'btn primary', type: 'button' }, icon('check'), plan.length > 1 ? `Apply ${plan.length} keys live` : 'Apply live');
    mbody.replaceChildren(...plan.map((p) => h('div', null, h('div', { class: 'diff-target' }, `Balance ${p.key}`),
      h('div', { class: 'diff' }, p.leaves.map((l) => h('div', { class: 'diff-row' }, h('span', { class: 'diff-path' }, pathText(l.path)), h('span', { class: 'num diff-before' }, show(l.live)),
        icon('back', 'ico flip'), h('span', { class: 'num diff-after' }, show(l.after))))),
      p.live_matches_tested ? null : h('div', { class: 'check-line' }, statusTag('warn', 'Live differs from the tested local value'),
        h('span', { class: 'num' }, p.leaves.filter((l) => !l.live_matches_tested).map((l) => `${pathText(l.path)}: local ${show(l.tested_before)}, live ${show(l.live)}`).join('; '))))),
    h('label', { class: 'reason-row' }, h('span', { class: 'lbl' }, 'Reason'), reason), h('div', { class: 'modal-actions' }, go), out);
    go.addEventListener('click', async () => {
      if (reason.value.trim().length < 3) { out.replaceChildren(statusTag('fail', 'Write a reason (3 characters or more)')); reason.focus(); return; }
      go.disabled = true;
      const done = [];
      for (const p of plan) {
        out.replaceChildren(...done, h('div', { class: 'state' }, h('span', { class: 'spin' }), `Applying ${p.key}`));
        try {
          const r = await post('/api/admin/edit/apply', { change: { kind: 'balance', key: p.key, path: [], after: p.after, reason: reason.value.trim() }, before: p.before });
          done.push(h('div', null, statusTag('pass', `${p.key}: applied. Action #${r.result?.action_id}`)));
        } catch (e) {
          done.push(h('div', { class: 'state error' }, icon('fail'), `${p.key}: ${e.message}`));
          break;
        }
      }
      out.replaceChildren(...done, h('a', { class: 'btn', href: '#/log', onclick: close }, icon('scroll'), 'Admin log'));
    });
  });

  drawSaved();
  drawAll();
  try { job = await lab('/job'); } catch { job = null; }
  if (job?.state && job.state !== 'idle' && job.changes) {
    // the last run (or the run now): show it and load its changes into the form
    Object.assign(sc, { sim: SIM[job.sim] ? job.sim : sc.sim, params: pickParams(SIM[job.sim] ? job.sim : sc.sim, job.params), changes: structuredClone(job.changes) });
    drawAll();
  } else if (!sc.changes.length) { sc.changes.push(newChange()); drawChanges(); }
  drawJob();
  if (job?.state === 'running') poll();
}
