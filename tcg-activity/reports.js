// Player reports (Nathan, 2026-10-01; design 23): the wrench in the top bar. A member sends a
// Bug, Feedback or Idea; player_reports.sql stores it (3 a day, checked in SQL), and this
// module turns each report into a GitHub Issue in the PUBLIC game repo.
//
// The Issue never names the member: it says "a member (report #N)". The reporter stays in the
// database, which no member can read. Every "@" is broken so an Issue cannot ping anyone, and
// "<" is escaped so the text cannot carry HTML.
//
// Flags (default OFF, fail closed):
//   FEATURE_REPORTS=1        the wrench shows and POST /api/feedback accepts reports
//   GITHUB_ISSUES_TOKEN=...  a fine-grained token (Issues: read/write on the game repo only).
//                            Without it, reports wait in the table and sync when it is set.
//   GITHUB_ISSUES_REPO       owner/name (default LionoftheWest/lion-pride-tcg)

export const REPORTS_ON = process.env.FEATURE_REPORTS === '1';
const TOKEN = process.env.GITHUB_ISSUES_TOKEN || '';
const REPO = process.env.GITHUB_ISSUES_REPO || 'LionoftheWest/lion-pride-tcg';
const KINDS = { bug: 'Bug', feedback: 'Feedback', idea: 'Idea' };
const MAX_TRIES = 8;

// Text that came from a member: no pings, no HTML, no table breaks.
const safe = (s) => String(s ?? '').replace(/@/g, '@\u200b').replace(/</g, '&lt;');
const cell = (s, max = 120) => safe(String(s ?? '').replace(/[\r\n|`]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)) || '—';

const mtTime = (iso) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}) + ' MT';

/** The GitHub Issue for one report row: { title, body, labels }. Pure, so it is unit-tested. */
export function issueFor(r) {
  const kind = KINDS[r.kind] || 'Report';
  const first = String(r.body || '').trim().split(/\r?\n/)[0].replace(/\s+/g, ' ');
  const title = `[${kind}] ${safe(first.length > 70 ? first.slice(0, 69) + '…' : first)}`;
  const quote = String(r.body || '').trim().split(/\r?\n/).map((l) => `> ${safe(l)}`).join('\n');
  const c = r.context || {};
  const rows = [['Screen', c.screen], ['App version', c.version], ['Window', c.window], ['Sent', mtTime(r.created_at)]];
  if (c.error) rows.push(['Last error', c.error]);
  const body = `${quote}\n\n| | |\n|---|---|\n${rows.map(([k, v]) => `| ${k} | ${cell(v, k === 'Last error' ? 300 : 120)} |`).join('\n')}\n\n`
    + `Sent from the in-game report button by a member (report #${r.id}).`;
  return { title, body, labels: ['player-report', r.kind] };
}

// The context the client sends: a few short strings only (the screen, the version, the
// window size, the last error). Anything else is dropped.
export function cleanContext(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const out = {};
  for (const [k, max] of [['screen', 40], ['version', 40], ['window', 20], ['error', 300]]) {
    if (c[k] != null && String(c[k]).trim()) out[k] = String(c[k]).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  }
  return out;
}

let syncing = false;
/** Send up to 5 waiting reports to GitHub. Exported (with injectable token/fetch) for the test. */
export async function syncOnce(supabase, { token = TOKEN, repo = REPO, fetchImpl = fetch } = {}) {
  if (!token || syncing) return 0;
  syncing = true;
  let done = 0;
  try {
    const { data: rows } = await supabase.from('player_reports')
      .select('id, kind, body, context, created_at, attempts')
      .is('synced_at', null).lt('attempts', MAX_TRIES).order('id').limit(5);
    for (const r of rows || []) {
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
          body: JSON.stringify(issueFor(r)),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.number) throw new Error(`${res.status} ${String(j.message || '').slice(0, 200)}`);
        await supabase.from('player_reports').update({ issue_number: j.number, issue_url: j.html_url, synced_at: new Date().toISOString(), last_error: null }).eq('id', r.id);
        done += 1;
      } catch (e) {
        await supabase.from('player_reports').update({ attempts: (r.attempts || 0) + 1, last_error: String(e.message || e).slice(0, 300) }).eq('id', r.id);
      }
    }
  } finally { syncing = false; }
  return done;
}

// The member a report is about (optional, player_reports.target_id): a Discord id, not the reporter. Else null.
export function reportTarget(raw, reporterId) {
  const id = raw == null ? '' : String(raw).trim();
  return /^\d{17,20}$/.test(id) && id !== String(reporterId) ? id : null;
}

// targets: store the optional target member (logs_app.sql adds the column; the Activity passes FEATURE_APP_LOGS).
export function registerReportRoutes(app, { supabase, caller, rateLimit, targets = false }) {
  app.post('/api/feedback', async (req, res) => {
    if (!REPORTS_ON) return res.status(403).json({ error: 'reports are off' });
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!rateLimit(me.id)) return res.status(429).json({ error: 'slow down' });
    const kind = String(req.body?.kind || '');
    const text = String(req.body?.body || '').slice(0, 2000);
    // The target must be an existing member (checked before the report is stored). It never goes into the Issue.
    const target = targets ? reportTarget(req.body?.target, me.id) : null;
    if (targets && req.body?.target != null && req.body.target !== '' && !target) return res.status(400).json({ ok: false, error: 'target' });
    if (target) {
      const { data: tp } = await supabase.from('players').select('id').eq('id', target).maybeSingle();
      if (!tp) return res.status(400).json({ ok: false, error: 'target' });
    }
    // The member is the verified caller; SQL checks the kind, the length and the daily limit.
    const { data, error } = await supabase.rpc('submit_report', { p_player: String(me.id), p_kind: kind, p_body: text, p_context: cleanContext(req.body?.context) });
    if (error) return res.status(500).json({ error: error.message });
    if (data?.ok && target && data.id) await supabase.from('player_reports').update({ target_id: target }).eq('id', data.id).eq('player_id', String(me.id));
    if (data?.ok) syncOnce(supabase).catch(() => {});
    res.json(data);
  });
  if (REPORTS_ON && TOKEN) setInterval(() => syncOnce(supabase).catch(() => {}), 60000).unref();
  if (REPORTS_ON && !TOKEN) console.log('reports: on, but no GITHUB_ISSUES_TOKEN - reports wait in player_reports');
}
