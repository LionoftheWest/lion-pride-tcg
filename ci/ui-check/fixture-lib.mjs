// Fixture helpers for the G3 UI check: the request key, the long-data variant, and the anonymizer that the
// recorder (record.mjs) uses so that no real member name, id or avatar reaches this public repository (G5).

const DROP = new Set(['token', 't', '_', 'v', 'ts', 'nocache']);
/** The fixture key of a request: the path and the sorted query, without tokens and cache busters. */
export function keyOf(path, search) {
  const q = new URLSearchParams(search || '');
  const kept = [...q.entries()].filter(([k]) => !DROP.has(k)).sort(([a], [b]) => a.localeCompare(b));
  return path + (kept.length ? '?' + new URLSearchParams(kept).toString() : '');
}

// ---- The long-data variant (design.md 12.6: a 32-character name and a 9-digit number) ----------------------
export const LONG_NAME = 'Maximilian_Thunderclaw_Champion1';   // 32 characters
export const LONG_NUMBER = 123456789;                             // 9 digits
const NAME_KEYS = new Set(['username', 'global_name', 'display_name', 'player', 'from_name', 'to_name', 'seller_name', 'bidder_name',
  'member_name', 'owner_name', 'by_name', 'winner_name', 'top_name', 'aimer_name', 'target_name', 'name_of']);
const NUMBER_KEY = /(shard|balance|damage|myDamage|power|score|points|earned|total)/i;
const isMember = (o) => o && typeof o === 'object' && ('player_id' in o || 'member_id' in o || 'avatar' in o || 'username' in o);

export function longData(v, key = '', parent = null) {
  if (Array.isArray(v)) return v.map((x) => longData(x, key, parent));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, longData(x, k, v)]));
  if (typeof v === 'string' && (NAME_KEYS.has(key) || (key === 'name' && isMember(parent)))) return LONG_NAME;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && NUMBER_KEY.test(key)) return LONG_NUMBER;
  return v;
}

// ---- The anonymizer ------------------------------------------------------------------------------------------
const TEXT_KEYS = /^(message|text|note|body|msg|detail|title|desc|description|line|label|caption)$/i;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A notification names the other member by the Discord DISPLAY name (server.js and hall-routes.js notify(): `${who}`,
// `${from}`, global_name), which the players table does not hold, so the name list above cannot find it. The name
// sits between the leading emoji and one of these fixed phrases.
const SLOT_TAIL = ['accepted your', 'picked a card for your trade', 'sent you a trade offer', 'made an offer on your',
  'bid on your auction', 'declined your accepted bid', 'confirmed: your auction'];
export const NAME_SLOT = new RegExp(`^([^\\p{L}\\p{N}]*\\s)(.+?)(?= (?:${SLOT_TAIL.map(esc).join('|')}))`, 'u');
const ANON = /^(?:Member A|Member \d{3})$/;

/**
 * Make an anonymizer from the real members (id, username): the signed-in member becomes "Member A" with the id
 * 100000000000000001, the others "Member 002", "Member 003" ... (by id order). Ids are replaced everywhere they
 * occur, names where a value is exactly a name or inside a text field, and every Discord avatar becomes null.
 */
export function anonymizer(members, meId) {
  const sorted = [...members].sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : a.id.localeCompare(b.id)));
  const ids = new Map(), names = new Map();
  sorted.forEach((m, i) => {
    ids.set(m.id, String(100000000000000001n + BigInt(i)));
    if (m.username && m.username.length >= 2) names.set(m.username.toLowerCase(), i === 0 ? 'Member A' : `Member ${String(i + 1).padStart(3, '0')}`);
  });
  const idRe = ids.size ? new RegExp([...ids.keys()].sort((a, b) => b.length - a.length).map(esc).join('|'), 'g') : null;
  const longNames = [...names.keys()].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  const nameRe = longNames.length ? new RegExp(`(?<![\\w])(?:${longNames.map(esc).join('|')})(?![\\w])`, 'gi') : null;
  const shown = new Map();   // a display name in a notification -> "Member 901", "Member 902" ...
  const slot = (s) => s.replace(NAME_SLOT, (m, pre, n) => (ANON.test(n) ? m
    : pre + (shown.get(n.toLowerCase()) || shown.set(n.toLowerCase(), `Member ${901 + shown.size}`).get(n.toLowerCase()))));
  const walk = (v, key = '') => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [idRe ? k.replace(idRe, (m) => ids.get(m)) : k, walk(x, k)]));
    if (typeof v !== 'string') return v;
    if (/cdn\.discordapp\.com|discord\.com\/avatars|media\.discordapp\.net/.test(v)) return null;
    let s = idRe ? v.replace(idRe, (m) => ids.get(m)) : v;
    const exact = names.get(s.toLowerCase());
    if (exact) return exact;
    if (nameRe && TEXT_KEYS.test(key)) s = s.replace(nameRe, (m) => names.get(m.toLowerCase()));
    if (TEXT_KEYS.test(key)) s = slot(s);
    return s;
  };
  return { walk, ids, names };
}

/**
 * A copy without the card catalog: the name, lore, artist and image of every card object (an object with a
 * "rarity"), and every card-art image path. Card names such as "R2VQ's Talonflame" carry a member handle, but
 * they are the public catalog (card-studio/cards.json is in this repository). The residue check reads this copy.
 */
export function withoutCatalog(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => withoutCatalog(x, key));
  if (v && typeof v === 'object') {
    const card = typeof v.rarity === 'string';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, card && /^(name|card|card_name|subject|lore|artist|artist_credit|image_url|image)$/.test(k) ? '' : withoutCatalog(x, k)]));
  }
  if (typeof v === 'string' && /\/storage\/v1\/object\/public\/card-art\//.test(v)) return '';
  return v;
}

/** The real names and ids that are still in a fixture text (the recorder fails when this is not empty). */
export function residue(text, members) {
  const hits = [];
  for (const m of members) {
    if (text.includes(m.id)) hits.push(`id ${m.id}`);
    if (m.username && m.username.length >= 4) {
      const re = new RegExp(`(?<![\\w])${esc(m.username)}(?![\\w])`, 'i');
      const at = text.search(re);
      if (at >= 0) hits.push(`name "${m.username}" near: ${text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, ' ')}`);
    }
  }
  // a display name left in a notification name slot (it is in no members list)
  for (const [, msg] of text.matchAll(/"(?:message|text|body|msg)":"((?:[^"\\]|\\.)*)"/g)) {
    const m = msg.match(NAME_SLOT);
    if (m && !ANON.test(m[2])) hits.push(`display name in a notification: ${msg.slice(0, 80)}`);
  }
  return hits;
}
