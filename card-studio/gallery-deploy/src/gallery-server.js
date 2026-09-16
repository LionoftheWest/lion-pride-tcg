/**
 * Public, READ-ONLY card gallery. A separate app from the studio: it can only
 * list live cards from Supabase and serve the gallery page. There are no
 * upload / push / sync / edit / create endpoints here at all, so a shared link
 * lets people view the cards and nothing else.
 *
 *   GALLERY_PORT=4331 node src/gallery-server.js
 */
import 'dotenv/config';
import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabase } from './supabase.js';
import { ORDER, tiersPublic } from './rarity.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const app = express();
app.disable('x-powered-by');
// No caching, so visitors always get the latest gallery code.
app.use(express.static(join(ROOT, 'public-gallery'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// Clean aliases for the legal pages (also served as /privacy.html, /terms.html).
// These public URLs go in the Discord Developer Portal (Privacy Policy / ToS).
app.get('/privacy', (req, res) => res.sendFile(join(ROOT, 'public-gallery', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(join(ROOT, 'public-gallery', 'terms.html')));

// The only data endpoint: live cards grouped by subject. Read-only.
app.get('/api/gallery', async (req, res) => {
  const { data, error } = await supabase
    .from('cards')
    .select('name, rarity, image_url, lore, artist_credit, season, event, subject:subjects(name, key)');
  if (error) return res.status(500).json({ error: error.message });

  const bySub = {};
  for (const c of data || []) {
    if (!c.image_url) continue;
    const key = c.subject?.key || c.name;
    (bySub[key] ||= { key, name: c.subject?.name || c.name, cards: [] }).cards.push({
      name: c.name,
      rarity: c.rarity,
      image_url: c.image_url,
      lore: c.lore,
      artist: c.artist_credit,
      season: c.season,
      event: c.event,
    });
  }
  const subjects = Object.values(bySub).sort((a, b) => a.name.localeCompare(b.name));
  for (const s of subjects) {
    s.cards.sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));
  }
  const backUrl = supabase.storage.from('card-art').getPublicUrl('cards/card-back.png').data.publicUrl;
  res.json({ subjects, backUrl, count: (data || []).length, tiers: tiersPublic() });
});

const PORT = Number(process.env.GALLERY_PORT) || 4331;
// Bind loopback only — Caddy proxies to localhost. Defense in depth.
const HOST = process.env.BIND_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => console.log(`Card Gallery (public, read-only) -> http://${HOST}:${PORT}`));
