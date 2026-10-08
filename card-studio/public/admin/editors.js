// Lion Pride TCG - Admin view, Phase 2: the editors (Balance, Pull rates, Settings, Rewards, Member actions, Admin log).
// Every change: Review (the live value now) -> Test on the local copy (rolled back) -> Apply live -> Undo from the Admin log.
// The server: /api/admin/edit/* (card-studio/src/admin-write.js). The SQL: tcg-bot/supabase/admin_write.sql.

export function editors(k) {
  const { h, icon, api, panel, table, fill, pageHead, statusTag, N, P, when, label, RARITY, rarityDot, qs, mtDay, addDays } = k;
  const state = { on: false, status: null };
  const SECRET = /secret|token|password|salt/i;

  /* ---------- API (writes: JSON + X-Admin-Write) ---------- */
  async function post(path, body) {
    const r = await fetch(`/api/admin/edit${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-admin-write': '1' }, body: JSON.stringify(body || {}) });
    if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; throw new Error('Login required'); }
    let j = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    if (!r.ok && !(r.status === 409 && j && 'ok' in j)) { const e = new Error(j?.error || `The server answered ${r.status}`); e.status = r.status; e.body = j; throw e; }
    return j;
  }
  const get = (path) => api(`/edit${path}`);
  async function init() {
    try { state.status = await get('/status'); state.on = Boolean(state.status?.edit); } catch { state.on = false; }
    return state.on;
  }

  /* ---------- small helpers ---------- */
  const isObj = (v) => v != null && typeof v === 'object';
  const show = (v) => (v === undefined ? '-' : typeof v === 'string' ? v : JSON.stringify(v));
  const pathText = (p) => (p.length ? p.join('.') : 'whole value');
  const ago = (ts) => {
    if (!ts) return '-';
    const m = Math.round((Date.now() - Date.parse(ts)) / 60000);
    return m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const setAt = (o, path, v) => { if (!path.length) return v; let x = o; for (const p of path.slice(0, -1)) x = x[p]; x[path.at(-1)] = v; return o; };
  const getAt = (o, path) => path.reduce((x, p) => (isObj(x) ? x[p] : undefined), o);
  const TIER_NAMES = ['Bronze', 'Silver', 'Platinum', 'Diamond', 'Obsidian'];
  const seg = (s, parentKey) => (/^\d+$/.test(s) ? (parentKey === 'tiers' ? TIER_NAMES[+s] || `#${+s + 1}` : parentKey === 'ranks' || parentKey === 'daily' || parentKey === 'weekly' ? `Place ${+s + 1}` : `#${+s + 1}`)
    : RARITY[s] || label(s));
  const pathLabel = (path) => path.map((s, i) => seg(s, path[i - 1])).join(' / ');

  /* ---------- the local copy (age, refresh) ---------- */
  function localLine({ compact = false } = {}) {
    const box = h('div', { class: 'local-line' });
    const draw = (st, job) => {
      const lc = st?.local || {};
      const txt = !lc.configured ? 'Local copy: not set up' : !lc.reachable ? 'Local copy: not answering'
        : `Local copy: data to ${when(lc.newest_row, true)} (${ago(lc.newest_row)})`;
      const running = job?.state === 'running';
      box.replaceChildren(...[h('span', { class: 'num local-txt' }, icon('database'), txt),
        lc.configured && lc.reachable && !lc.has_admin_write ? statusTag('warn', 'No admin_write.sql') : null,
        running ? h('span', { class: 'status idle' }, h('span', { class: 'spin' }), `Refreshing since ${when(job.started_at)}`)
          : job?.state === 'failed' ? statusTag('fail', 'Refresh failed') : null,
        h('button', { class: 'btn', type: 'button', disabled: running, onclick: refresh }, icon('refresh'), compact ? 'Refresh' : 'Refresh local copy')].filter(Boolean));
      if (job?.state === 'failed' && job.tail?.length) box.append(h('div', { class: 'local-tail num' }, job.tail.slice(-3).join('\n')));
    };
    const poll = async () => {
      const job = await get('/local/refresh').catch(() => null);
      if (job?.state === 'running') { draw(state.status, job); setTimeout(poll, 4000); return; }
      state.status = await get('/status').catch(() => state.status);
      draw(state.status, job);
    };
    async function refresh() {
      try { const job = await post('/local/refresh'); draw(state.status, job); setTimeout(poll, 3000); } catch (e) { box.append(h('span', { class: 'err' }, e.message)); }
    }
    draw(state.status, state.status?.refresh);
    if (state.status?.refresh?.state === 'running') setTimeout(poll, 3000);
    return box;
  }

  /* ---------- the change dialog: Review -> Test -> Apply ---------- */
  function openChange(change, { title, onDone } = {}) {
    const back = h('div', { class: 'modal-back' });
    const body = h('div', { class: 'modal-body' });
    const close = () => { back.remove(); dlg.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Review change' },
      h('div', { class: 'modal-head' }, h('strong', null, title || 'Review change'), h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
      body);
    back.addEventListener('click', close);
    document.addEventListener('keydown', esc);
    document.body.append(back, dlg);
    const reason = h('textarea', { class: 'field reason', rows: 2, maxlength: 500, placeholder: 'Reason', 'aria-label': 'Reason' }, change.reason || '');
    const live = h('div'), test = h('div', { class: 'test-out' }), msg = h('div', { role: 'status' });
    const btnTest = h('button', { class: 'btn', type: 'button' }, icon('flask'), 'Test on local copy');
    const btnApply = h('button', { class: 'btn primary', type: 'button', disabled: true }, icon('check'), 'Apply live');
    let preview = null, tested = false;
    body.append(h('div', { class: 'lbl' }, 'Change'), live, h('label', { class: 'reason-row' }, h('span', { class: 'lbl' }, 'Reason'), reason),
      h('div', { class: 'modal-actions' }, btnTest, btnApply), msg, test, h('div', { class: 'modal-foot' }, localLine({ compact: true })));
    const ch = () => ({ ...change, reason: reason.value.trim() });
    const needReason = () => { if (reason.value.trim().length >= 3) return false; msg.replaceChildren(statusTag('fail', 'Write a reason (3 characters or more)')); reason.focus(); return true; };
    const loadPreview = async () => {
      live.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Reading the live value'));
      try {
        preview = await post('/preview', { change: { ...change, reason: change.reason || 'preview' } });
        live.replaceChildren(changeView(change, preview));
      } catch (e) { live.replaceChildren(h('div', { class: 'state error' }, icon('fail'), e.message)); }
    };
    btnTest.addEventListener('click', async () => {
      if (needReason()) return;
      tested = false; btnApply.disabled = true; msg.replaceChildren();
      test.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Testing on the local copy'));
      btnTest.disabled = true;
      try {
        const t = await post('/test', { change: ch() });
        test.replaceChildren(...[testView(change, t, preview)].flat(Infinity).filter(Boolean));
        tested = t.ok === true;
        btnApply.disabled = !tested || !preview;
      } catch (e) { test.replaceChildren(h('div', { class: 'state error' }, icon('fail'), e.message)); }
      btnTest.disabled = false;
    });
    btnApply.addEventListener('click', async () => {
      if (needReason() || !tested || !preview) return;
      btnApply.disabled = true; btnTest.disabled = true;
      msg.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Applying live'));
      try {
        const r = await post('/apply', { change: ch(), before: preview.live.before });
        msg.replaceChildren(h('div', { class: 'applied' }, statusTag('pass', `Applied. Action #${r.result?.action_id}`), h('a', { class: 'btn', href: '#/log', onclick: close }, icon('scroll'), 'Admin log')));
        onDone?.(r);
      } catch (e) {
        const stale = e.status === 409;
        msg.replaceChildren(h('div', { class: 'state error' }, icon('fail'), e.message,
          stale ? h('button', { class: 'btn', type: 'button', onclick: () => { msg.replaceChildren(); test.replaceChildren(); tested = false; btnTest.disabled = false; loadPreview(); } }, 'Review again') : null));
        if (!stale) { btnApply.disabled = false; btnTest.disabled = false; }
      }
    });
    loadPreview();
    setTimeout(() => reason.focus(), 0);
    return { close };
  }

  function changeView(change, pv) {
    const lv = pv.live || {};
    const row = (k2, a, b) => h('div', { class: 'diff-row' }, h('span', { class: 'diff-path' }, k2), h('span', { class: 'num diff-before' }, show(a)), icon('back', 'ico flip'), h('span', { class: 'num diff-after' }, show(b)));
    const head = (t) => h('div', { class: 'diff-target' }, t);
    switch (change.kind) {
      case 'balance': case 'setting': {
        const diff = lv.diff || [];
        return h('div', null, head(`${change.kind === 'balance' ? 'Balance' : 'Setting'} ${change.key}${change.path.length ? ` / ${pathLabel(change.path)}` : ''}`),
          h('div', { class: 'diff' }, diff.length ? diff.map((d) => row(pathLabel(d.path) || change.key, d.before, d.after)) : h('div', { class: 'empty' }, 'No difference with live')),
          pv.pulls ? pullsMini(pv.pulls_now, pv.pulls) : null);
      }
      case 'setting_member':
        return h('div', null, head(`Setting ${change.key}${change.path.length ? ` / ${pathLabel(change.path)}` : ''}`),
          h('div', { class: 'diff' }, row(`${change.op === 'add' ? 'Add' : 'Remove'} ${lv.member_name || change.member}`, lv.before ? 'in the list' : 'not in the list', change.op === 'add' ? 'in the list' : 'not in the list')),
          h('div', { class: 'subtitle' }, `${N(lv.count)} members in the list now`));
      case 'member_packs': case 'member_shards':
        return h('div', null, head(`${lv.member_name || change.player}: ${change.kind === 'member_packs' ? 'packs' : 'Shards'}`),
          h('div', { class: 'diff' }, row(`${change.amount > 0 ? '+' : ''}${N(change.amount)}`, N(lv.before), N(lv.after))));
      case 'member_card':
        return h('div', null, head(`${lv.member_name || change.player}: ${lv.card?.name || `card ${change.card}`}`),
          h('div', { class: 'diff' }, row(`${change.amount > 0 ? '+' : ''}${N(change.amount)} copies`, N(lv.before), N(lv.after))),
          lv.ascension ? h('div', { class: 'subtitle' }, `${lv.ascension} stars on this card`) : null);
      default: return h('div', null, JSON.stringify(change));
    }
  }

  function testView(change, t, pv) {
    const out = [h('div', { class: 'test-head' }, t.ok ? statusTag('pass', 'Test passed on the local copy') : statusTag('fail', 'Test failed on the local copy'))];
    if (t.error) out.push(h('div', { class: 'state error' }, icon('fail'), t.error));
    const lb = pv?.live?.before;
    if (t.ok && ['balance', 'setting', 'member_packs', 'member_shards', 'member_card'].includes(change.kind) && JSON.stringify(t.before) !== JSON.stringify(lb)) {
      out.push(h('div', { class: 'check-line' }, statusTag('warn', 'Local differs from live'), h('span', { class: 'num' }, `local ${show(t.before)}, live ${show(lb)}`)));
    }
    const c = t.checks || {};
    if (c.admin_action) out.push(h('div', { class: 'check-line' }, statusTag('pass', 'Admin log row'), h('span', { class: 'num' }, c.admin_action.action)));
    if (c.balance_log != null) out.push(h('div', { class: 'check-line' }, statusTag(c.balance_log ? 'pass' : 'fail', 'Balance log row'), h('span', { class: 'num' }, N(c.balance_log))));
    if (c.settings_log != null) out.push(h('div', { class: 'check-line' }, statusTag(c.settings_log ? 'pass' : 'fail', 'Settings log row'), h('span', { class: 'num' }, N(c.settings_log))));
    if (c.readers) {
      const ran = c.readers.filter((x) => x.ran), bad = c.readers.filter((x) => x.error);
      out.push(h('div', { class: 'check-line' }, statusTag(bad.length ? 'fail' : 'pass', 'Readers'), h('span', { class: 'num' }, `${ran.length} ran, ${bad.length} failed`)));
      for (const b of bad) out.push(h('div', { class: 'state error' }, icon('fail'), `${b.fn}: ${b.error}`));
      out.push(h('details', { class: 'readers' }, h('summary', null, `Read by ${c.readers.length} functions`), h('div', { class: 'num reader-list' }, c.readers.map((x) => x.fn).join(', '))));
    }
    if (t.pulls) out.push(pullsMini(null, t.pulls));
    if (t.prizes) {
      out.push(h('div', { class: 'check-line' }, statusTag('info', `Hunt ${t.prizes.hunt}`),
        h('span', { class: 'num' }, `${N(t.prizes.participants)} fighters: ${N(t.prizes.before)} packs now, ${N(t.prizes.after)} packs after`)));
    }
    if (t.sim) {
      if (t.sim.error) out.push(h('div', { class: 'state error' }, icon('fail'), `Hunt simulation: ${t.sim.error}`));
      else {
        out.push(h('div', { class: 'lbl mt' }, `Hunt simulation, ${t.sim.tier} boss, ${t.sim.trials} fights per squad`));
        out.push(table({ phone: 'recs', title: 'squad', rows: t.sim.rows, cols: [
          { key: 'squad', label: 'Squad' },
          { key: 'before', label: 'Damage now', r: true, fmt: (x) => N(x.before.mean) },
          { key: 'after', label: 'Damage after', r: true, fmt: (x) => N(x.after.mean) },
          { key: 'change', label: 'Change', r: true, fmt: (x) => h('span', { class: 'num' }, x.change == null ? '-' : `${x.change > 0 ? '+' : ''}${(x.change * 100).toFixed(1)}%`) },
          { key: 'attacks', label: 'Attacks', r: true, fmt: (x) => `${N(x.before.attacks, 1)} / ${N(x.after.attacks, 1)}` }] }));
      }
    }
    if (c.member_after) {
      const a = c.member_after, b = c.member_before || {};
      const rows = [['Packs', b.packs, a.packs], ['Shards', b.shards, a.shards], ...(a.copies != null ? [['Copies', b.copies, a.copies]] : [])];
      out.push(h('div', { class: 'diff' }, rows.map(([n2, x, y]) => h('div', { class: 'diff-row' }, h('span', { class: 'diff-path' }, n2), h('span', { class: 'num diff-before' }, N(x)), icon('back', 'ico flip'), h('span', { class: 'num diff-after' }, N(y))))));
      for (const [n2, key] of [['Pack ledger', 'pack_ledger_ok'], ['Shards ledger', 'shard_ledger_ok'], ['Card ledger', 'card_ledger_ok']]) {
        out.push(h('div', { class: 'check-line' }, statusTag(a[key] ? 'pass' : b[key] === false ? 'warn' : 'fail', n2), h('span', { class: 'num' }, `${b[key] ? 'ok' : 'not ok'} before, ${a[key] ? 'ok' : 'not ok'} after`)));
      }
      out.push(h('div', { class: 'check-line' }, statusTag(c.ledger_rows === 1 ? 'pass' : 'fail', 'Ledger row with the action ref'), h('span', { class: 'num' }, N(c.ledger_rows))));
    }
    return out;
  }

  function pullsMini(now, next) {
    const rows = next.rows.map((x, i) => ({ ...x, now: now?.rows?.[i] }));
    return h('div', { class: 'mt' }, table({ phone: 'table', rows, cols: [
      { key: 'rarity', label: 'Rarity', fmt: (x) => [rarityDot(x.rarity), RARITY[x.rarity] || x.rarity] },
      ...(now ? [{ key: 'now', label: 'Now', r: true, fmt: (x) => P(x.now?.rate, 3) }] : []),
      { key: 'rate', label: now ? 'After' : 'Rate', r: true, fmt: (x) => P(x.rate, 3) },
      { key: 'one_in_packs', label: 'Per pack', r: true, fmt: (x) => (x.one_in_packs ? `1 in ${N(x.one_in_packs, 1)}` : '-') }] }),
    h('div', { class: 'check-line' }, statusTag(next.sum_ok ? 'pass' : 'fail', 'Sum = 1'), h('span', { class: 'num' }, `${N(next.sum * 100, 6)}%`)));
  }

  /* ---------- the value form (Balance, Rewards, Settings) ---------- */
  // fields: every leaf of a value as an input. mode 'key' = one Review for the whole key; 'leaf' = a Review per field.
  function valueForm(value, { onReview, mode = 'key', keyName }) {
    const inputs = [];
    const fieldFor = (v, path) => {
      if (isObj(v) && v.$hidden) return h('span', { class: 'muted' }, 'hidden');
      if (typeof v === 'boolean') {
        const el = h('div', { class: 'seg toggle', role: 'group', 'aria-label': pathLabel(path) || keyName },
          ...[[true, 'On'], [false, 'Off']].map(([b, t]) => h('button', { type: 'button', class: v === b ? 'on' : null, 'aria-pressed': String(v === b),
            onclick: () => { if (v !== b) onReview(path, b, v); } }, t)));
        return el;
      }
      if (typeof v === 'number') {
        const el = h('input', { class: 'field num', type: 'number', step: 'any', value: String(v), 'aria-label': pathLabel(path) || keyName });
        inputs.push({ el, path, orig: v, parse: (s) => (s.trim() === '' ? NaN : Number(s)) });
        return el;
      }
      if (typeof v === 'string') {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(v);
        const el = h('input', { class: `field${date ? ' num' : ''}`, type: date ? 'date' : 'text', value: v, 'aria-label': pathLabel(path) || keyName, maxlength: 400 });
        inputs.push({ el, path, orig: v, parse: (s) => s });
        return el;
      }
      return h('span', { class: 'muted num' }, show(v));
    };
    const review = (it) => {
      const n = it.parse(it.el.value);
      if (typeof it.orig === 'number' && !Number.isFinite(n)) { it.el.focus(); return; }
      onReview(it.path, n, it.orig);
    };
    const leafRow = (lbl, v, path) => {
      const f = fieldFor(v, path);
      const it = inputs.find((x) => x.el === f);
      const btn = mode === 'leaf' && it ? h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => review(it) }, 'Review') : null;
      if (btn) f.addEventListener('input', () => { btn.hidden = String(it.parse(f.value)) === String(it.orig); });
      return h('div', { class: 'leaf' }, h('span', { class: 'leaf-name' }, lbl), f, btn);
    };
    const scalar = (v) => !isObj(v) || v.$hidden;
    // An object (or array) of objects that share leaf keys -> a table of inputs. Else nested groups.
    const build = (v, path) => {
      if (scalar(v)) return leafRow(pathLabel(path) || keyName, v, path);
      if (v.$members) return h('div', { class: 'muted' }, 'member list');
      const entries = Object.entries(v);
      const rowsOfObjects = mode === 'key' && entries.length > 1 && entries.every(([, x]) => isObj(x) && !Array.isArray(x) && !x.$members && Object.values(x).every((y) => scalar(y) || (isObj(y) && Object.values(y).every(scalar))));
      if (rowsOfObjects) {
        const cols = [...new Set(entries.flatMap(([, x]) => Object.entries(x).flatMap(([c, y]) => (scalar(y) ? [c] : Object.keys(y).map((z) => `${c}.${z}`)))))];
        return h('div', { class: 'vgroup' }, h('div', { class: 'vgroup-title' }, pathLabel(path) || keyName),
          h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl vtable' },
            h('thead', null, h('tr', null, h('th', { scope: 'col' }, ''), cols.map((c) => h('th', { scope: 'col' }, c.split('.').map((s) => seg(s)).join(' '))))),
            h('tbody', null, entries.map(([rk, x]) => h('tr', null, h('th', { scope: 'row' }, seg(rk, path.at(-1))),
              cols.map((c) => { const p = c.split('.'); const y = getAt(x, p); return h('td', null, y === undefined ? h('span', { class: 'muted' }, '-') : fieldFor(y, [...path, rk, ...p])); })))))));
      }
      const arrayOfScalars = mode === 'key' && Array.isArray(v) && v.every(scalar);
      if (arrayOfScalars) {
        return h('div', { class: 'leaf' }, h('span', { class: 'leaf-name' }, pathLabel(path) || keyName),
          h('div', { class: 'leaf-array' }, v.map((x, i) => { const f = fieldFor(x, [...path, String(i)]); f.setAttribute('aria-label', `${pathLabel(path) || keyName} ${seg(String(i), path.at(-1))}`); return f; })));
      }
      return h('div', { class: path.length ? 'vgroup' : 'vroot' }, path.length ? h('div', { class: 'vgroup-title' }, pathLabel(path)) : null,
        entries.map(([kk, x]) => build(x, [...path, kk])));
    };
    const el = h('div', { class: 'vform' }, build(value, []));
    const changed = () => inputs.filter((it) => String(it.parse(it.el.value)) !== String(it.orig));
    const collect = () => {
      const bad = inputs.find((it) => typeof it.orig === 'number' && !Number.isFinite(it.parse(it.el.value)));
      if (bad) { bad.el.focus(); return null; }
      const next = clone(value);
      for (const it of changed()) setAt(next, it.path, it.parse(it.el.value));
      return { next, changed: changed() };
    };
    return { el, collect, changed, inputs };
  }

  function keyPanel(row, { onDone, open = false, title, mode = 'key' }) {
    const p = h('details', { class: 'panel keypanel', open: open || null });
    const right = h('span', { class: 'num key-meta' }, `${when(row.updated_at, true)}${row.updated_by ? ` by ${row.updated_by}` : ''}`);
    p.append(h('summary', null, h('span', { class: 'key-name' }, title || row.key), title ? h('span', { class: 'num key-code' }, row.key) : null, right));
    const body = h('div', { class: 'keybody' });
    p.append(body);
    const draw = () => {
      body.replaceChildren();
      if (row.note) body.append(h('p', { class: 'note' }, row.note));
      const form = valueForm(row.value, { keyName: row.key, mode, onReview: (path, v) => openChange({ kind: 'balance', key: row.key, path, after: v }, { onDone }) });
      body.append(form.el);
      if (mode === 'key') {
        const btn = h('button', { class: 'btn primary', type: 'button' }, 'Review change');
        const info = h('span', { class: 'subtitle' });
        btn.addEventListener('click', () => {
          const c = form.collect();
          if (!c) return;
          if (!c.changed.length) { info.textContent = 'No value changed'; return; }
          const one = c.changed.length === 1 ? c.changed[0] : null;
          openChange(one ? { kind: 'balance', key: row.key, path: one.path, after: one.parse(one.el.value) } : { kind: 'balance', key: row.key, path: [], after: c.next }, { onDone });
        });
        body.append(h('div', { class: 'form-actions' }, info, btn));
      }
    };
    p.addEventListener('toggle', () => { if (p.open && !body.childNodes.length) draw(); });
    if (open) draw();
    return p;
  }

  const editHead = (title, sub) => pageHead(title, sub, localLine());

  /* ================= pages ================= */
  async function pageBalance(main) {
    main.append(editHead('Balance', 'Every number in the balance table'));
    const filter = h('input', { class: 'field', type: 'search', placeholder: 'Filter keys', 'aria-label': 'Filter keys' });
    main.append(h('div', { class: 'form-row' }, filter, h('a', { class: 'btn', href: '#/balance/pulls' }, icon('layers'), 'Pull rates'), h('a', { class: 'btn', href: '#/rewards' }, icon('gift'), 'Rewards')));
    const list = h('div', { class: 'stack' });
    main.append(list);
    fill(list, async () => {
      const d = await get('/balance');
      const items = d.rows.map((row) => ({ row, el: keyPanel(row, { onDone: () => setTimeout(() => k.render(), 600) }) }));
      filter.addEventListener('input', () => { const f = filter.value.trim().toLowerCase(); for (const it of items) it.el.hidden = Boolean(f) && !it.row.key.includes(f) && !(it.row.note || '').toLowerCase().includes(f); });
      return items.map((x) => x.el);
    });
  }

  async function pagePulls(main) {
    main.append(editHead('Pull rates', h('span', { class: 'crumb' }, h('a', { href: '#/balance' }, 'Balance'), ' / pulls')));
    const box = h('div');
    main.append(box);
    fill(box, async () => {
      const to = mtDay(), from = addDays(to, -29);
      const [b, ov] = await Promise.all([get('/balance'), api(`/overview?${qs({ from, to })}`).catch(() => null)]);
      const row = b.rows.find((x) => x.key === 'pulls');
      if (!row) throw new Error('No pulls key in the balance table');
      const v = row.value;
      const RS = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];
      const actual = Object.fromEntries((ov?.pulls?.by_rarity || []).map((x) => [x.rarity, x]));
      const total = ov?.pulls?.cards_pulled || 0;
      const ins = {};
      const size = h('input', { class: 'field num', type: 'number', min: 1, max: 20, step: 1, value: String(v.pack_size), 'aria-label': 'Pack size' });
      const sumCell = h('span', { class: 'num' }), sumTag = h('span'), perPack = {};
      const rate = (r) => Number((Number(ins[r].value) / 100).toFixed(10));
      const recalc = () => {
        const s = RS.reduce((a, r) => a + (Number.isFinite(rate(r)) ? rate(r) : 0), 0);
        sumCell.textContent = `${N(s * 100, 6)}%`;
        sumTag.replaceChildren(statusTag(Math.abs(s - 1) <= 1e-9 ? 'pass' : 'fail', Math.abs(s - 1) <= 1e-9 ? 'Sum = 100%' : 'Sum is not 100%'));
        const n = Number(size.value) || 0;
        for (const r of RS) { const pp = 1 - (1 - rate(r)) ** n; perPack[r].textContent = pp > 0 ? `1 in ${N(1 / pp, 1)}` : '-'; }
        return Math.abs(s - 1) <= 1e-9;
      };
      const rows = RS.map((r) => {
        ins[r] = h('input', { class: 'field num rate-in', type: 'number', step: 'any', min: 0, max: 100, value: String(Number(((v.rates?.[r] ?? 0) * 100).toFixed(8))), 'aria-label': `${RARITY[r]} rate in percent` });
        ins[r].addEventListener('input', recalc);
        const a = actual[r];
        const pp2 = h('span', { class: 'num' });
        perPack[r] = { set textContent(t) { cell.textContent = t; pp2.textContent = t; } };
        const cell = h('span', { class: 'num' });
        return h('tr', null, h('td', null, rarityDot(r), RARITY[r], h('div', { class: 'phone-only muted' }, pp2)), h('td', { class: 'r' }, h('span', { class: 'pct' }, ins[r], '%')),
          h('td', { class: 'r hide-phone' }, cell), h('td', { class: 'r num' }, a && total ? P(a.actual / total, 3) : '-'), h('td', { class: 'r num hide-phone' }, a ? N(a.actual) : '-'));
      });
      size.addEventListener('input', recalc);
      const p = panel('Pull rates', { sub: `Expected rate per card, per pack of ${v.pack_size}; actual = the last 30 days (${N(total)} cards pulled)` });
      p.body.append(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl pulls-edit' },
        h('thead', null, h('tr', null, ['Rarity', 'Expected', 'Per pack', 'Actual 30d', 'N'].map((t, i) => h('th', { scope: 'col', class: [i ? 'r' : '', i === 2 || i === 4 ? 'hide-phone' : ''].join(' ').trim() || null }, t)))),
        h('tbody', null, rows, h('tr', { class: 'sum' }, h('td', null, 'Sum'), h('td', { class: 'r' }, sumCell), h('td', { class: 'r hide-phone' }), h('td', { colspan: 2, class: 'r' }, sumTag))))));
      const btn = h('button', { class: 'btn primary', type: 'button', onclick: () => {
        if (!recalc()) return;
        const after = clone(v);
        for (const r of RS) after.rates[r] = rate(r);
        after.pack_size = Number(size.value);
        openChange({ kind: 'balance', key: 'pulls', path: [], after }, { title: 'Review pull rates', onDone: () => setTimeout(() => k.render(), 600) });
      } }, 'Review change');
      p.body.append(h('div', { class: 'form-actions' }, h('label', { class: 'inline' }, h('span', { class: 'lbl' }, 'Pack size'), size), btn));
      recalc();
      p.body.append(h('p', { class: 'note mt' }, row.note || ''));
      return p.el;
    });
  }

  async function pageSettings(main) {
    main.append(editHead('Settings', 'Flags, dates and member lists'));
    const box = h('div', { class: 'stack' });
    main.append(box);
    fill(box, async () => {
      const d = await get('/settings');
      const done = () => setTimeout(() => k.render(), 600);
      return d.rows.map((s) => {
        const p = panel(s.key, { sub: `Updated ${when(s.updated_at, true)}` });
        const lists = [];
        const strip = (v, path) => {
          if (isObj(v) && v.$members) { lists.push({ path, members: v.$members }); return undefined; }
          if (isObj(v) && !v.$hidden && !Array.isArray(v)) return Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, strip(x, [...path, kk])]).filter(([, x]) => x !== undefined));
          return v;
        };
        const rest = strip(s.value, []);
        const big = JSON.stringify(rest || '').length > 1500;
        if (rest !== undefined && !(isObj(rest) && !Object.keys(rest).length)) {
          const form = valueForm(rest, { mode: 'leaf', keyName: s.key, onReview: (path, v) => openChange({ kind: 'setting', key: s.key, path, after: v }, { onDone: done }) });
          p.body.append(big ? h('details', { class: 'big' }, h('summary', null, `${form.inputs.length} values`), form.el) : form.el);
        }
        for (const l of lists) p.body.append(memberList(s.key, l.path, l.members, done));
        return p.el;
      });
    });
  }

  function memberList(key, path, members, onDone) {
    const box = h('div', { class: 'mlist' }, h('div', { class: 'lbl' }, `${path.length ? pathLabel(path) : 'Members'} (${N(members.length)})`));
    box.append(h('div', { class: 'chips wrap' }, members.length ? members.map((m) => h('span', { class: 'mchip' }, m.username || 'Unknown member',
      h('button', { class: 'mchip-x', type: 'button', 'aria-label': `Remove ${m.username || 'member'}`, onclick: () => openChange({ kind: 'setting_member', key, path, member: m.id, op: 'remove' }, { onDone }) }, icon('x'))))
      : h('span', { class: 'muted' }, 'Empty')));
    box.append(memberPicker((m) => openChange({ kind: 'setting_member', key, path, member: m.id, op: 'add' }, { onDone }), 'Add a member'));
    return box;
  }

  // Search members (or cards) by name; pick one.
  function picker({ placeholder, search, item, onPick }) {
    const input = h('input', { class: 'field', type: 'search', placeholder, 'aria-label': placeholder, autocomplete: 'off' });
    const out = h('div', { class: 'pick-results', hidden: true });
    let t = 0, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { out.hidden = true; return; }
        const my = ++seq;
        try {
          const rows = await search(q);
          if (my !== seq) return;
          out.hidden = false;
          out.replaceChildren(...(rows.length ? rows.map((x) => h('button', { class: 'gs-item', type: 'button', onclick: () => { out.hidden = true; input.value = ''; onPick(x); } }, ...item(x)))
            : [h('div', { class: 'gs-empty' }, 'No match')]));
        } catch (e) { out.hidden = false; out.replaceChildren(h('div', { class: 'gs-empty' }, e.message)); }
      }, 250);
    });
    return h('div', { class: 'picker' }, input, out);
  }
  const memberPicker = (onPick, placeholder = 'Find a member') => picker({ placeholder, search: async (q) => (await api(`/search?${qs({ q })}`)).members,
    item: (m) => [h('span', null, m.username || 'Unknown member'), m.last_active ? h('span', { class: 'sub' }, `active ${String(m.last_active).slice(5, 10)}`) : null], onPick });
  const cardPicker = (onPick) => picker({ placeholder: 'Find a card', search: async (q) => (await api(`/search?${qs({ q })}`)).cards,
    item: (c) => [rarityDot(c.rarity), h('span', null, c.name), h('span', { class: 'sub' }, RARITY[c.rarity] || c.rarity)], onPick });

  /* ----- Rewards: friendly forms over the balance keys ----- */
  const REWARDS = [
    ['hunt_prizes', 'Hunt prizes'], ['dungeon_prizes', 'Dungeon and Gauntlet prizes'], ['dungeon_rewards', 'Dungeon run rewards'],
    ['daily', 'Dailies'], ['welcome_packs', 'Welcome packs'], ['achievement_rewards', 'Achievement rewards'], ['shards', 'Shards and Shop'],
  ];
  async function pageRewards(main) {
    main.append(editHead('Rewards', 'Prizes, dailies, welcome packs, achievements and the Shop'));
    const box = h('div', { class: 'stack' });
    main.append(box);
    fill(box, async () => {
      const d = await get('/balance');
      const by = Object.fromEntries(d.rows.map((r) => [r.key, r]));
      return REWARDS.filter(([key]) => by[key]).map(([key, title], i) => keyPanel(by[key], { title, open: i === 0, onDone: () => setTimeout(() => k.render(), 600) }));
    });
  }

  /* ----- Member actions (on the Member page) ----- */
  function memberActions(d, onDone) {
    const id = d.profile.id, b = d.balances;
    const area = h('div', { class: 'act-form' });
    const amountForm = (kind, lbl, signHint) => {
      const amt = h('input', { class: 'field num', type: 'number', step: 1, value: '1', 'aria-label': lbl });
      return [h('label', { class: 'inline' }, h('span', { class: 'lbl' }, lbl), amt), h('button', { class: 'btn primary', type: 'button', onclick: () => {
        const n = Number(amt.value);
        if (!Number.isInteger(n) || n === 0) { amt.focus(); return; }
        openChange({ kind, player: id, amount: signHint * Math.abs(n) }, { onDone });
      } }, 'Review')];
    };
    const forms = {
      packs: () => amountForm('member_packs', 'Packs to grant', 1),
      shards: () => amountForm('member_shards', 'Shards to grant', 1),
      give: () => {
        const sel = h('div', { class: 'picked' });
        let card = null;
        const n = h('input', { class: 'field num', type: 'number', min: 1, max: 100, step: 1, value: '1', 'aria-label': 'Copies' });
        return [cardPicker((c) => { card = c; sel.replaceChildren(rarityDot(c.rarity), c.name); }), sel,
          h('label', { class: 'inline' }, h('span', { class: 'lbl' }, 'Copies'), n),
          h('button', { class: 'btn primary', type: 'button', onclick: () => { const x = Number(n.value); if (!card || !Number.isInteger(x) || x < 1) return; openChange({ kind: 'member_card', player: id, card: card.id, amount: x }, { onDone }); } }, 'Review')];
      },
      remove: () => {
        const box = h('div');
        fill(box, async () => {
          const r = await get(`/member/${encodeURIComponent(id)}/cards`);
          if (!r.rows.length) return h('div', { class: 'empty' }, 'No cards');
          const sel = h('select', { class: 'field', 'aria-label': 'Card' }, r.rows.map((c) => h('option', { value: c.card_id }, `${c.name} (${RARITY[c.rarity] || c.rarity}) x${c.quantity}${c.ascension ? `, ${c.ascension} stars` : ''}`)));
          const n = h('input', { class: 'field num', type: 'number', min: 1, max: 100, step: 1, value: '1', 'aria-label': 'Copies' });
          return [sel, h('label', { class: 'inline' }, h('span', { class: 'lbl' }, 'Copies'), n),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { const x = Number(n.value); if (!Number.isInteger(x) || x < 1) return; openChange({ kind: 'member_card', player: id, card: Number(sel.value), amount: -x }, { onDone }); } }, 'Review')];
        });
        return [box];
      },
      fix: () => {
        const what = h('select', { class: 'field', 'aria-label': 'Balance' }, h('option', { value: 'packs' }, `Packs (${N(b.packs)})`), h('option', { value: 'shards' }, `Shards (${N(b.shards)})`));
        const to = h('input', { class: 'field num', type: 'number', min: 0, step: 1, value: String(b.packs), 'aria-label': 'New balance' });
        what.addEventListener('change', () => { to.value = String(what.value === 'packs' ? b.packs : b.shards); });
        return [what, h('label', { class: 'inline' }, h('span', { class: 'lbl' }, 'New balance'), to), h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const x = Number(to.value), cur = what.value === 'packs' ? b.packs : b.shards;
          if (!Number.isInteger(x) || x < 0 || x === cur) { to.focus(); return; }
          openChange({ kind: what.value === 'packs' ? 'member_packs' : 'member_shards', player: id, amount: x - cur }, { title: 'Review balance fix', onDone });
        } }, 'Review')];
      },
    };
    let open = null;
    const btns = [['packs', 'Grant packs', 'package'], ['shards', 'Grant Shards', 'gem'], ['give', 'Give a card', 'gift'], ['remove', 'Remove a card', 'layers'], ['fix', 'Fix a balance', 'scale']]
      .map(([key, t, ic]) => h('button', { class: 'action-btn on', type: 'button', 'aria-expanded': 'false', onclick: (e) => {
        const btn = e.currentTarget;
        for (const x of btns) x.setAttribute('aria-expanded', 'false');
        if (open === key) { open = null; area.replaceChildren(); return; }
        open = key; btn.setAttribute('aria-expanded', 'true');
        area.replaceChildren(h('div', { class: 'act-row' }, ...forms[key]()));
        btn.after(area);
      } }, icon(ic), t));
    return btns;
  }

  /* ----- Admin log ----- */
  const ACTIONS = ['balance_set', 'setting_set', 'setting_member', 'member_packs', 'member_shards', 'member_card', 'gift'];
  function summary(x) {
    const b = x.before || {}, a = x.after || {};
    switch (x.action) {
      case 'balance_set': case 'setting_set': return `${x.target_id}${(a.path || []).length ? ` / ${pathLabel(a.path)}` : ''}: ${show(b.value)} -> ${show(a.value)}`;
      case 'setting_member': return `${x.target_id}${(a.path || []).length ? ` / ${pathLabel(a.path)}` : ''}: ${a.in_list ? 'add' : 'remove'} ${x.member_name || 'a member'}`;
      case 'member_packs': return `${x.target_name || 'member'}: packs ${N(b.packs)} -> ${N(a.packs)}`;
      case 'member_shards': return `${x.target_name || 'member'}: Shards ${N(b.shards)} -> ${N(a.shards)}`;
      case 'member_card': return `${x.target_name || 'member'}: card ${a.card} copies ${N(b.copies)} -> ${N(a.copies)}`;
      case 'gift': return `${label(a.kind)} ${N(a.amount)} packs${a.shards ? `, ${N(a.shards)} Shards` : ''} to ${x.target_kind === 'player' ? x.target_name || 'a member' : `${N(a.count)} members`}`;
      default: return show(a).slice(0, 160);
    }
  }
  async function pageLog(main, _, q) {
    const action = q.get('action') || '', source = q.get('source') || '', page = Math.max(0, Number(q.get('page')) || 0);
    const go = (o) => { location.hash = `#/log?${qs({ action, source, page: 0, ...o })}`; };
    const sa = h('select', { class: 'field', 'aria-label': 'Action', onchange: (e) => go({ action: e.target.value }) }, h('option', { value: '' }, 'All actions'), ACTIONS.map((x) => h('option', { value: x, selected: x === action }, label(x))));
    const ss = h('select', { class: 'field', 'aria-label': 'Source', onchange: (e) => go({ source: e.target.value }) }, h('option', { value: '' }, 'All sources'), ['studio', 'bot', 'sql'].map((x) => h('option', { value: x, selected: x === source }, label(x))));
    main.append(pageHead('Admin log', 'Every admin action, newest first', h('div', { class: 'form-row', style: 'margin:0' }, sa, ss)));
    const p = panel(null);
    main.append(p.el);
    fill(p.body, async () => {
      const d = await get(`/log?${qs({ action, source, offset: page * 50 })}`);
      if (!d.rows.length) return h('div', { class: 'empty' }, 'No action');
      const undoCell = (x) => (x.undone_by ? h('span', { class: 'muted' }, `Undone by #${x.undone_by}`) : x.undoable
        ? h('button', { class: 'btn', type: 'button', onclick: (e) => { e.stopPropagation(); openUndo(x); } }, icon('refresh'), 'Undo') : h('span', { class: 'muted' }, '-'));
      return [table({ rows: d.rows, title: 'action', cols: [
        { key: 'id', label: '#', r: true, fmt: (x) => h('span', { class: 'num' }, x.id) },
        { key: 'at', label: 'When', fmt: (x) => h('span', { class: 'num' }, when(x.at, true)) },
        { key: 'action', label: 'Action', fmt: (x) => [label(x.action), x.undo_of ? h('span', { class: 'badge' }, `undo of #${x.undo_of}`) : null] },
        { key: 'summary', label: 'Change', fmt: (x) => h('span', { class: 'num log-sum' }, summary(x)) },
        { key: 'reason', label: 'Reason' },
        { key: 'actor', label: 'Who', fmt: (x) => [x.actor, ' ', h('span', { class: 'muted' }, x.source)] },
        { key: 'undo', label: 'Undo', fmt: undoCell }] }),
      k.pager(d.offset, d.rows.length, d.total, (pg) => go({ page: pg }), 50)];
    });
  }
  function openUndo(x) {
    const back = h('div', { class: 'modal-back' });
    const close = () => { back.remove(); dlg.remove(); };
    const reason = h('textarea', { class: 'field reason', rows: 2, maxlength: 500, 'aria-label': 'Reason' }, `Undo #${x.id}`);
    const msg = h('div', { role: 'status' });
    const btn = h('button', { class: 'btn primary', type: 'button' }, icon('refresh'), 'Undo live');
    btn.addEventListener('click', async () => {
      if (reason.value.trim().length < 3) { reason.focus(); return; }
      btn.disabled = true;
      msg.replaceChildren(h('div', { class: 'state' }, h('span', { class: 'spin' }), 'Undoing live'));
      try {
        const r = await post('/undo', { id: x.id, reason: reason.value.trim() });
        msg.replaceChildren(statusTag('pass', `Undone. Action #${r.result?.action_id}`));
        setTimeout(() => { close(); k.render(); }, 900);
      } catch (e) { msg.replaceChildren(h('div', { class: 'state error' }, icon('fail'), e.message)); }
    });
    const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Undo' },
      h('div', { class: 'modal-head' }, h('strong', null, `Undo #${x.id}`), h('button', { class: 'btn icon-only', type: 'button', 'aria-label': 'Close', onclick: close }, icon('x'))),
      h('div', { class: 'modal-body' }, h('div', { class: 'diff-target' }, label(x.action)), h('div', { class: 'num log-sum' }, summary(x)),
        h('label', { class: 'reason-row' }, h('span', { class: 'lbl' }, 'Reason'), reason), h('div', { class: 'modal-actions' }, btn), msg));
    back.addEventListener('click', close);
    document.body.append(back, dlg);
  }

  return {
    state, init, memberActions, localLine,
    nav: [
      { id: 'balance', label: 'Balance', icon: 'scale', match: /^\/balance(\/|$)/ },
      { id: 'settings', label: 'Settings', icon: 'cog' },
      { id: 'rewards', label: 'Rewards', icon: 'gift' },
      { id: 'log', label: 'Admin log', icon: 'scroll' },
    ],
    routes: [[/^\/balance$/, pageBalance], [/^\/balance\/pulls$/, pagePulls], [/^\/settings$/, pageSettings], [/^\/rewards$/, pageRewards], [/^\/log$/, pageLog]],
    SECRET,
  };
}
