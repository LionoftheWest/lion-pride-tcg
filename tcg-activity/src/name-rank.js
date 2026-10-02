// Rank member names for a search (Nathan, 2026-10-02: suggest names as people type). The exact
// name first, then a name that starts with the text, then a word that starts with it (after a
// space _ . - or a small-to-capital change), then the text anywhere. Shorter names first in a
// group (closer to what was typed), then A-Z.
export function nameScore(name, q) {
  const n = String(name || ''), lo = n.toLowerCase(), t = String(q || '').trim().toLowerCase();
  if (!t) return 9;
  if (lo === t) return 0;
  if (lo.startsWith(t)) return 1;
  const words = n.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[\s_.\-]+/);
  if (words.some((w) => w.startsWith(t))) return 2;
  return lo.includes(t) ? 3 : 9;
}

export function rankByName(rows, q, key = 'username') {
  return rows.map((r) => ({ r, s: nameScore(r[key], q) })).filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || String(a.r[key]).length - String(b.r[key]).length || String(a.r[key]).localeCompare(String(b.r[key])))
    .map((x) => x.r);
}
