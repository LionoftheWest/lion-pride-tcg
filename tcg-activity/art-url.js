// R2-MOVE: the card-art address rules (one rule, 4 copies that share the vectors in shared/art-url-vectors.json):
// card-studio/src/art-url.js, card-studio/gallery-deploy/src/art-url.js (the gallery image ships only its folder),
// tcg-activity/art-url.js, tcg-bot/src/art-url.ts.
// The stored URL stays the LOGICAL address <SUPABASE_URL>/storage/v1/object/public/card-art/<name>?v=<n> (I-4, no row
// rewrite). After the Supabase delete (S7) that host holds no file: each reader maps the name to its store.
// artKey(urlOrPath) -> 'card-art/<name>' or null; r2Url(key, v, base) -> '<base>/card-art/<name>?v=<v>'.
const PUBLIC = /(?:^|\/)storage\/v1\/object\/public\/card-art\/([^?#]*)(?:\?([^#]*))?/;

export function artKey(urlOrPath) {
  if (!urlOrPath) return null;
  const m = PUBLIC.exec(String(urlOrPath));
  if (!m || !m[1] || /\.\.|\x5c|\/\/|%/.test(m[1]) || m[1].startsWith('/')) return null;
  return `card-art/${m[1]}`;
}

export function artVersion(urlOrPath) {
  const m = PUBLIC.exec(String(urlOrPath || ''));
  return (m && m[2] && new URLSearchParams(m[2]).get('v')) || null;
}

export function r2Url(key, v, base) {
  return `${String(base).replace(/\/+$/, '')}/${key}${v ? `?v=${encodeURIComponent(v)}` : ''}`;
}

/** A logical card-art URL -> the same file on the R2 public domain (query v kept). Any other URL is unchanged. */
export function r2FromLogical(url, base) {
  const key = artKey(url);
  return key ? r2Url(key, artVersion(url), base) : url;
}
