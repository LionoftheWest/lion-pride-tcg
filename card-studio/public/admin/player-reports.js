// Lion Pride TCG - Admin view: the Player reports page (READ ONLY; docs/player-reports.md). The newest reports from the
// in-game Feedback window: the kind, the text, the device facts, the GitHub Issue, the reporter and the target, and the
// private screenshots. Data: GET /api/admin/player-reports (src/admin-player-reports.js). A screenshot link is signed
// and ends after a few minutes: press Refresh for new links. Every text goes in as textContent (member text is data).
// The shell (admin.js) passes its helpers in `k`.

const KIND = { bug: ['Bug', 'warn'], feedback: ['Feedback', 'info'], idea: ['Idea', 'sparkles'] };
const FACTS = [['screen', 'Screen'], ['version', 'App version'], ['window', 'Window'], ['app', 'App'], ['device', 'Device'], ['os', 'System'],
  ['engine', 'Engine'], ['layout', 'Layout'], ['dpr', 'Pixel ratio'], ['error', 'Last error']];
const CSS = `
.prp-list { display: grid; gap: 12px; }
.prp-head { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-bottom: 8px; }
.prp-head .when { color: var(--text-2); font-size: 13px; }
.prp-body { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 12px; }
.prp-facts { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.prp-fact { border: 1px solid var(--edge); border-radius: 6px; padding: 2px 8px; font-size: 12px; color: var(--text-2); }
.prp-fact b { color: var(--text); font-weight: 600; }
.prp-shots { display: flex; flex-wrap: wrap; gap: 8px; }
.prp-shots a { display: block; border: 1px solid var(--edge); border-radius: 8px; overflow: hidden; }
.prp-shots img { display: block; width: 160px; height: 120px; object-fit: contain; background: var(--bg); }
.prp-foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 12px; }
`;

export async function pagePlayerReports(main, _args, _q, k) {
  const { h, icon, api, panel, pageHead, when, errorState } = k;
  if (!document.getElementById('prp-css')) document.head.append(h('style', { id: 'prp-css' }, CSS));
  main.append(pageHead('Player reports', 'Bug, Feedback and Idea reports from the game, newest first. Read only. The screenshots are private.'));
  const p = panel(null);
  main.append(p.el);
  const list = h('div', { class: 'prp-list' });
  const status = h('div');
  const more = h('button', { class: 'btn', type: 'button' }, icon('older'), 'Load older');
  const note = h('span', { class: 'when' });
  const state = { next: null, busy: false, count: 0 };

  const member = (id, name) => (id ? h('a', { href: `#/member/${encodeURIComponent(id)}` }, name || id) : '-');
  const card = (r) => {
    const [kt, kic] = KIND[r.kind] || [r.kind, 'info'];
    const c = r.context || {};
    const facts = FACTS.filter(([key]) => c[key]).map(([key, t]) => h('span', { class: 'prp-fact' }, `${t}: `, h('b', null, String(c[key]))));
    const issue = r.issue_url ? h('a', { href: r.issue_url, target: '_blank', rel: 'noopener noreferrer' }, `Issue #${r.issue_number}`, ' ', icon('external'))
      : h('span', { class: 'status warn' }, icon('warn'), r.last_error ? `Not synced (${r.attempts} tries): ${r.last_error}` : 'Waiting for the GitHub sync');
    const shots = (r.shots || []).map((s) => (s.url
      ? h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: `Screenshot ${s.n}` }, h('img', { src: s.url, alt: `Screenshot ${s.n} of report ${r.id}`, loading: 'lazy' }))
      : h('span', { class: 'prp-fact' }, `Screenshot ${s.n}: no link`)));
    return h('article', { class: 'panel' },
      h('div', { class: 'prp-head' }, h('span', { class: 'kind' }, icon(kic), kt), h('b', null, `#${r.id}`), h('span', { class: 'when' }, when(r.created_at, true)), issue),
      h('p', { class: 'prp-body', text: r.body }),
      facts.length ? h('div', { class: 'prp-facts' }, facts) : null,
      h('div', { class: 'prp-head' }, h('span', null, 'From: ', member(r.player_id, r.player_name)), r.target_id ? h('span', null, 'About: ', member(r.target_id, r.target_name)) : null,
        h('span', { class: 'when' }, shots.length ? `${shots.length} screenshot${shots.length === 1 ? '' : 's'}` : 'No screenshots')),
      shots.length ? h('div', { class: 'prp-shots' }, shots) : null);
  };
  const load = async () => {
    state.busy = true; more.disabled = true;
    status.replaceChildren(h('div', { class: 'state', role: 'status' }, h('span', { class: 'spin' }), 'Loading'));
    try {
      const d = await api(`/player-reports?limit=20${state.next ? `&before=${state.next}` : ''}`);
      list.append(...(d.rows || []).map(card));
      state.count += (d.rows || []).length;
      state.next = d.next;
      note.textContent = `The screenshot links end ${Math.round((d.signed_seconds || 300) / 60)} minutes after loading. Press Refresh for new links.`;
      status.replaceChildren(state.count ? '' : h('div', { class: 'empty' }, 'No reports'));
    } catch (e) { status.replaceChildren(errorState(e, load)); }
    state.busy = false;
    more.hidden = !state.next;
    more.disabled = !state.next;
  };
  more.addEventListener('click', load);
  p.body.append(list, status, h('div', { class: 'prp-foot' }, note, more));
  load();
}
