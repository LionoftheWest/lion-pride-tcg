/**
 * The Admin page "Player reports" (READ ONLY; Nathan, 2026-10-11; docs/player-reports.md): the newest reports with the
 * kind, the text, the device facts, the GitHub Issue, the reporter and the target, and the private screenshots
 * (player_report_shots, bucket report-shots) as signed links that end after SIGNED_SECONDS.
 * The reporter and the target are member ids: this page is private (adminGate), they never go to the public Issue.
 * Usage: adminRouter mounts GET /api/admin/player-reports?before=<id>&limit=<n> (src/admin-routes.js).
 */
export const SHOT_BUCKET = 'report-shots';
export const SIGNED_SECONDS = 300;
export const PAGE_MAX = 50;

const COLS = 'id, player_id, target_id, kind, body, context, created_at, issue_number, issue_url, synced_at, attempts, last_error';

/** One page of reports, newest first. before = the smallest id of the last page (keyset). */
export async function playerReportsPage(db, { before = null, limit = 20 } = {}) {
  let q = db.from('player_reports').select(COLS).order('id', { ascending: false }).limit(limit);
  if (before != null) q = q.lt('id', before);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message || String(error));
  const reports = rows || [];
  const ids = reports.map((r) => r.id);
  const members = [...new Set(reports.flatMap((r) => [r.player_id, r.target_id]).filter(Boolean))];
  let shots = [], names = new Map();
  if (ids.length) {
    const s = await db.from('player_report_shots').select('id, report_id, n, path, mime, bytes, created_at').in('report_id', ids).not('stored_at', 'is', null).order('n');
    if (s.error) throw new Error(s.error.message || String(s.error));
    shots = s.data || [];
  }
  if (members.length) {
    const p = await db.from('players').select('id, username').in('id', members);
    if (!p.error) names = new Map((p.data || []).map((x) => [x.id, x.username]));
  }
  // Signed links: the bucket is private, so a link works only for SIGNED_SECONDS and only for these files.
  const urls = new Map();
  if (shots.length) {
    const { data, error: sErr } = await db.storage.from(SHOT_BUCKET).createSignedUrls(shots.map((x) => x.path), SIGNED_SECONDS);
    if (!sErr) for (const u of data || []) if (u.signedUrl && !u.error) urls.set(u.path, u.signedUrl);
  }
  return {
    rows: reports.map((r) => ({
      ...r,
      player_name: names.get(r.player_id) || null,
      target_name: r.target_id ? names.get(r.target_id) || null : null,
      shots: shots.filter((x) => x.report_id === r.id).map((x) => ({ n: x.n, mime: x.mime, bytes: x.bytes, created_at: x.created_at, url: urls.get(x.path) || null })),
    })),
    next: reports.length === limit ? reports.at(-1).id : null,
    signed_seconds: SIGNED_SECONDS,
  };
}
