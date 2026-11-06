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
import { r2FromLogical } from './art-url.js';

// R2-MOVE: GALLERY_ART picks the address of the art sent to the browser. REQUIRED (unset or unknown = no start, spec H4):
//   supabase  the stored URL (the logical Supabase address, I-4) and the Supabase card back, as before
//   r2        every image_url and backUrl on the R2 public domain (R2_PUBLIC_BASE/card-art/<name>?v=<v>)
const GALLERY_ART = process.env.GALLERY_ART;
const R2_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
if (!['supabase', 'r2'].includes(GALLERY_ART)) { console.error(`refused: GALLERY_ART${GALLERY_ART ? `=${GALLERY_ART} unknown` : ' unset'} (supabase | r2)`); process.exit(1); }
if (GALLERY_ART === 'r2' && !/^https?:\/\/[^/]+$/.test(R2_BASE)) { console.error('refused: GALLERY_ART=r2 needs R2_PUBLIC_BASE'); process.exit(1); }
const artUrl = (u) => (GALLERY_ART === 'r2' ? r2FromLogical(u, R2_BASE) : u);
// The card back: the LOGICAL address (the same string getPublicUrl gave before), then mapped like every image.
const BACK = `${String(process.env.SUPABASE_URL || '').replace(/\/+$/, '')}/storage/v1/object/public/card-art/cards/card-back.png`;

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const app = express();
app.disable('x-powered-by');
// No caching, so visitors always get the latest gallery code.
app.use(express.static(join(ROOT, 'public-gallery'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

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
      image_url: artUrl(c.image_url),
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
  const backUrl = artUrl(BACK);
  res.json({ subjects, backUrl, count: (data || []).length, tiers: tiersPublic() });
});

const PORT = Number(process.env.GALLERY_PORT) || 4331;
app.listen(PORT, () => console.log(`Card Gallery (public, read-only) art=${GALLERY_ART} -> http://localhost:${PORT}`));
