// The player side of the event calendar (docs/foundations.md F-1 item 10): ONE read-only route, GET /api/events.
// It returns the events that are scheduled or live (never a draft, an ended or a cancelled event) with ONLY the public
// fields: id, kind, title, description, starts_at, ends_at, status, theme and changes. No audience, rewards, rules,
// key, created_by, log or raw vars: the select names the columns, so a new admin column never leaks.
// changes = [{ key, label, text }]: the plain words of each variable. The label comes from the event_vars registry
// (data), the text is built here from the registry's combine rule and the event's value, so a new variable needs no code.
// Flag: eventsOn(id) (EVENTS_USERS = ids first, FEATURE_EVENTS=1 = everyone). Default OFF.

export const PUBLIC_COLUMNS = 'id, kind, title, description, starts_at, ends_at, status, theme, vars';
const THEME_KEYS = ['name', 'color', 'art', 'banner'];

const lower = (s) => (s.length > 1 && s[1] === s[1].toLowerCase() ? s[0].toLowerCase() + s.slice(1) : s); // "Rare pull odds" -> "rare pull odds"; an acronym ("RLS") keeps its capital
const num = (n) => String(Math.round(n * 100) / 100);

// "2x rare pull odds" (multiply), "Dungeon runs a day: up to 3" (max), "Dungeon card drop chance: up to 30%" (max, a chance).
export function changeText(def, value) {
  const label = String(def.label);
  if (def.combine === 'multiply') return `${num(value)}x ${lower(label)}`;
  const shown = Number(def.max_value) <= 1 ? `${num(value * 100)}%` : num(value);
  return `${label}: up to ${shown}`;
}

// art: a function url -> a URL the Activity may load, or null (the CSP allows img-src 'self' only, so the server proxies storage art
// and drops every other host; the page then draws the theme color and the kind icon).
export function publicEvent(row, defs, art = () => null) {
  const vars = row.vars && typeof row.vars === 'object' ? row.vars : {};
  const changes = Object.keys(vars).sort().filter((k) => defs.has(k) && Number.isFinite(Number(vars[k])))
    .map((k) => ({ key: k, label: defs.get(k).label, text: changeText(defs.get(k), Number(vars[k])) }));
  const theme = {};
  for (const k of THEME_KEYS) if (row.theme && typeof row.theme[k] === 'string') theme[k] = row.theme[k];
  if (theme.art) { const u = art(theme.art); if (u) theme.art = u; else delete theme.art; }
  return {
    id: row.id, kind: row.kind, title: row.title, description: row.description,
    starts_at: row.starts_at, ends_at: row.ends_at, status: row.status, theme, changes,
  };
}

export function registerEventsRoutes(app, { supabase, caller, eventsOn, sharedCache, artUrl, now = () => Date.now() }) {
  // The same answer for every member (no member data in it): one load at a time, kept 45 s.
  const cache = sharedCache ? sharedCache('events', { ttl: 45000 }) : null;
  const load = async () => {
    const [ev, vd] = await Promise.all([
      supabase.from('events').select(PUBLIC_COLUMNS).in('status', ['scheduled', 'live']).order('starts_at', { ascending: true }).limit(500),
      supabase.from('event_vars').select('key, label, combine, max_value'),
    ]);
    if (ev.error) throw new Error(ev.error.message);
    if (vd.error) throw new Error(vd.error.message);
    return { rows: ev.data || [], defs: new Map((vd.data || []).map((d) => [d.key, d])) };
  };
  app.get('/api/events', async (req, res) => {
    const me = await caller(req);
    if (!me) return res.status(401).json({ error: 'not authenticated' });
    if (!eventsOn(me.id)) return res.status(403).json({ error: 'off' });
    try {
      const { rows, defs } = await (cache ? cache.get('all', load) : load());
      const t = now();
      // The tick moves status once a minute: an event past its end is not shown while it still says live.
      const events = rows.filter((r) => Date.parse(r.ends_at) > t).map((r) => publicEvent(r, defs, artUrl));
      res.json({ events, now: new Date(t).toISOString() });
    } catch (e) {
      res.status(500).json({ error: 'events unavailable' });
    }
  });
}
