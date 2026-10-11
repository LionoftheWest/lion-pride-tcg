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
//
// Screenshots (report_shots.sql, 2026-10-11): after the report is sent, the client uploads up to 3 images to
// POST /api/feedback/:id/shot. They go to the PRIVATE bucket report-shots, never to GitHub. The Issue only counts them;
// images that arrive after the Issue get one comment ("1 more screenshot ..."). The Activity removes the images
// after balance report_shots.keep_days (pruneShotsOnce).
import express from 'express';

export const REPORTS_ON = process.env.FEATURE_REPORTS === '1';
const TOKEN = process.env.GITHUB_ISSUES_TOKEN || '';
const REPO = process.env.GITHUB_ISSUES_REPO || 'LionoftheWest/lion-pride-tcg';
const KINDS = { bug: 'Bug', feedback: 'Feedback', idea: 'Idea' };
const MAX_TRIES = 8;
export const SHOT_BUCKET = 'report-shots';
// The most bytes the route reads before it refuses (413). The real limit is balance report_shots.max_bytes, checked in
// reserve_report_shot; balance_check_report_shots keeps that value at or below this one.
export const SHOT_READ_LIMIT = 5 * 1024 * 1024;
const shotWord = (n) => `${n} screenshot${n === 1 ? '' : 's'}`;
// The device facts in the Issue table: [context key, row name].
const DEVICE_ROWS = [['app', 'App'], ['device', 'Device'], ['os', 'System'], ['engine', 'Engine'], ['layout', 'Layout'], ['dpr', 'Pixel ratio']];

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
  const rows = [['Screen', c.screen], ['App version', c.version], ['Window', c.window]];
  // The device facts (src/device-facts.js): only the ones the client sent.
  for (const [k, label] of DEVICE_ROWS) if (c[k]) rows.push([label, c[k]]);
  rows.push(['Sent', mtTime(r.created_at)]);
  if (c.error) rows.push(['Last error', c.error]);
  const shots = Number(r.shots) > 0 ? `\n\n${shotWord(Number(r.shots))}, see the Admin page (private).` : '';
  const body = `${quote}\n\n| | |\n|---|---|\n${rows.map(([k, v]) => `| ${k} | ${cell(v, k === 'Last error' ? 300 : 120)} |`).join('\n')}\n\n`
    + `Sent from the in-game report button by a member (report #${r.id}).${shots}`;
  return { title, body, labels: ['player-report', r.kind] };
}

// The context the client sends: a few short strings only (the screen, the version, the window size, the last error,
// and the device facts of src/device-facts.js). Anything else is dropped (never the raw user agent).
const CONTEXT_KEYS = [['screen', 40], ['version', 40], ['window', 20], ['error', 300],
  ['app', 20], ['device', 12], ['os', 24], ['engine', 12], ['layout', 32], ['dpr', 8]];
export function cleanContext(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const out = {};
  for (const [k, max] of CONTEXT_KEYS) {
    if (c[k] != null && String(c[k]).trim()) out[k] = String(c[k]).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
  }
  return out;
}

const ghHeaders = (token) => ({ authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' });

// The stored screenshots of a report that no Issue text counted yet (ids). A failed read counts none: the report
// still syncs, and syncShotNotes adds the comment later (noted_at stays null).
async function storedShots(supabase, reportId) {
  try {
    const { data, error } = await supabase.from('player_report_shots').select('id').eq('report_id', reportId).not('stored_at', 'is', null).is('noted_at', null);
    return error ? [] : (data || []).map((x) => x.id);
  } catch { return []; }
}
const markNoted = (supabase, ids) => supabase.from('player_report_shots').update({ noted_at: new Date().toISOString() }).in('id', ids);

// One flag for both GitHub jobs, so a screenshot cannot be counted by the Issue text and by a comment at the same time.
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
        const shots = await storedShots(supabase, r.id);
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
          method: 'POST',
          headers: ghHeaders(token),
          body: JSON.stringify(issueFor({ ...r, shots: shots.length })),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j.number) throw new Error(`${res.status} ${String(j.message || '').slice(0, 200)}`);
        await supabase.from('player_reports').update({ issue_number: j.number, issue_url: j.html_url, synced_at: new Date().toISOString(), last_error: null }).eq('id', r.id);
        if (shots.length) await markNoted(supabase, shots);
        done += 1;
      } catch (e) {
        await supabase.from('player_reports').update({ attempts: (r.attempts || 0) + 1, last_error: String(e.message || e).slice(0, 300) }).eq('id', r.id);
      }
    }
  } finally { syncing = false; }
  return done;
}

/** Screenshots stored after their Issue was made: one comment per report, then noted_at. A failed comment stays
 *  waiting for the next pass. Exported (with injectable token/fetch) for the test. */
export async function syncShotNotes(supabase, { token = TOKEN, repo = REPO, fetchImpl = fetch } = {}) {
  if (!token || syncing) return 0;
  syncing = true;
  let done = 0;
  try {
    const { data: shots } = await supabase.from('player_report_shots').select('id, report_id')
      .not('stored_at', 'is', null).is('noted_at', null).order('id').limit(50);
    const byReport = new Map();
    for (const s of shots || []) byReport.set(s.report_id, [...(byReport.get(s.report_id) || []), s.id]);
    if (!byReport.size) return 0;
    const { data: reps } = await supabase.from('player_reports').select('id, issue_number').in('id', [...byReport.keys()]).not('issue_number', 'is', null);
    for (const r of reps || []) {
      const ids = byReport.get(r.id) || [];
      try {
        const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues/${r.issue_number}/comments`, {
          method: 'POST', headers: ghHeaders(token),
          body: JSON.stringify({ body: `${shotWord(ids.length)} added to report #${r.id} after this Issue, see the Admin page (private).` }),
        });
        if (!res.ok) continue;
        await markNoted(supabase, ids);
        done += 1;
      } catch { /* the next pass tries again */ }
    }
  } finally { syncing = false; }
  return done;
}

/** The image type from the first bytes of the file: image/webp, image/png, image/jpeg, or null. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 8).toString('latin1') === 'PNG\r\n\x1a\n') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** At most `max` screenshot uploads per member in `windowMs` (a refused upload counts too). */
export function makeShotLimiter({ max = 6, windowMs = 10 * 60_000, now = Date.now } = {}) {
  const seen = new Map();
  return (id) => {
    const t = now(), k = String(id);
    const list = (seen.get(k) || []).filter((x) => t - x < windowMs);
    const ok = list.length < max;
    if (ok) list.push(t);
    seen.set(k, list);
    if (seen.size > 5000) for (const [key, l] of seen) if (!l.some((x) => t - x < windowMs)) seen.delete(key);
    return ok;
  };
}

/** Remove the screenshots older than balance report_shots.keep_days: the files (storage API) first, then the rows.
 *  The storage API does not fail on a file that is gone already, so a pass that stops halfway is safe to run again. */
export async function pruneShotsOnce(supabase) {
  const { data, error } = await supabase.rpc('report_shots_expired', { p_limit: 100 });
  if (error || !data?.length) return 0;
  const { error: rmErr } = await supabase.storage.from(SHOT_BUCKET).remove(data.map((x) => x.path));
  if (rmErr) return 0;
  const { error: delErr } = await supabase.from('player_report_shots').delete().in('id', data.map((x) => x.id));
  return delErr ? 0 : data.length;
}

// reserve_report_shot errors -> HTTP status.
const SHOT_ERRORS = { type: 415, big: 413, report: 404, full: 409 };

// The member a report is about (optional, player_reports.target_id): a Discord id, not the reporter. Else null.
export function reportTarget(raw, reporterId) {
  const id = raw == null ? '' : String(raw).trim();
  return /^\d{17,20}$/.test(id) && id !== String(reporterId) ? id : null;
}

// targets: store the optional target member (logs_app.sql adds the column; the Activity passes FEATURE_APP_LOGS).
// on: the flag (a test passes it). shotLimit: the upload limiter. prune: run the screenshot cleanup (a test passes false).
export function registerReportRoutes(app, { supabase, caller, rateLimit, targets = false, on = REPORTS_ON, shotLimit = makeShotLimiter(), token = TOKEN, prune = true }) {
  app.post('/api/feedback', async (req, res) => {
    if (!on) return res.status(403).json({ error: 'reports are off' });
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

  // One screenshot for the member's own report: the raw image is the body (Content-Type image/webp, png or jpeg).
  // The report is stored already, so it never waits for an image. The first bytes must match the Content-Type.
  const readShot = express.raw({ type: () => true, limit: SHOT_READ_LIMIT });
  app.post('/api/feedback/:id/shot', (req, res, next) => readShot(req, res, (err) => {
    if (!err) return next();
    const big = err.status === 413 || err.type === 'entity.too.large';
    return res.status(big ? 413 : 400).json({ ok: false, error: big ? 'big' : 'body' });
  }), async (req, res) => {
    if (!on) return res.status(403).json({ error: 'reports are off' });
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!shotLimit(me.id)) return res.status(429).json({ ok: false, error: 'slow down' });
    if (!/^\d{1,18}$/.test(String(req.params.id))) return res.status(404).json({ ok: false, error: 'report' });
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = sniffImage(buf);
    const declared = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!mime || mime !== declared) return res.status(415).json({ ok: false, error: 'type' });
    // SQL checks the owner, the size, the age and the count (balance report_shots), one upload at a time per report.
    const { data, error } = await supabase.rpc('reserve_report_shot', { p_player: String(me.id), p_report: Number(req.params.id), p_mime: mime, p_bytes: buf.length });
    if (error) return res.status(500).json({ ok: false, error: 'server' });
    if (!data?.ok) return res.status(SHOT_ERRORS[data?.error] || 400).json(data || { ok: false });
    const up = await supabase.storage.from(SHOT_BUCKET).upload(data.path, buf, { contentType: mime, upsert: false });
    if (up.error) {
      await supabase.from('player_report_shots').delete().eq('id', data.id);   // free the place, so the member can try again
      return res.status(502).json({ ok: false, error: 'upload' });
    }
    await supabase.from('player_report_shots').update({ stored_at: new Date().toISOString() }).eq('id', data.id);
    syncShotNotes(supabase).catch(() => {});
    res.json({ ok: true, n: data.n });
  });

  if (on && token) setInterval(() => { syncOnce(supabase).then(() => syncShotNotes(supabase)).catch(() => {}); }, 60000).unref();
  // The cleanup runs with the flag off too: a screenshot is member data, so it must still end after keep_days.
  if (prune) {
    setTimeout(() => pruneShotsOnce(supabase).catch(() => {}), 60000).unref();
    setInterval(() => pruneShotsOnce(supabase).catch(() => {}), 6 * 3600_000).unref();
  }
  if (on && !token) console.log('reports: on, but no GITHUB_ISSUES_TOKEN - reports wait in player_reports');
}
