import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// The "is playing" picture (design 20, option B, Nathan 2026-09-30): the member's avatar
// and name on the left, their best pull of the day framed on the right, over that card's
// art, blurred. 1200x630. The fonts are the Activity's own (OFL, src/assets/fonts).
export const W = 1200;
export const H = 630;

export const RARITY: Record<string, { label: string; color: string; rank: number }> = {
  normal: { label: 'Normal', color: '#9aa3b5', rank: 0 },
  illustrated_rare: { label: 'Illustrated Rare', color: '#4DA3FF', rank: 1 },
  secret_rare: { label: 'Secret Rare', color: '#B18CFF', rank: 2 },
  full_art: { label: 'Full Art', color: '#FF5CA8', rank: 3 },
  gold: { label: 'Gold', color: '#F4B73C', rank: 4 },
};

// dist/ (the image) keeps the assets beside it; src/ runs under tsx in the tests.
const ASSETS = [join(process.cwd(), 'assets'), join(process.cwd(), 'src', 'assets')].find((p) => existsSync(p)) ?? 'assets';
let fontsReady = false;
function fonts(): void {
  if (fontsReady) return;
  GlobalFonts.registerFromPath(join(ASSETS, 'fonts', 'bricolage-grotesque-latin-wght-normal.woff2'), 'Bricolage');
  GlobalFonts.registerFromPath(join(ASSETS, 'fonts', 'inter-latin-wght-normal.woff2'), 'Inter');
  fontsReady = true;
}

export type PlayingCardInput = {
  name: string;
  playing: boolean;
  avatar: Buffer | null;
  card: { name: string; rarity: string; art: Buffer | null } | null;
  packs: number;
  damage: number;
};

async function img(buf: Buffer | null): Promise<Image | null> {
  if (!buf) return null;
  try { return await loadImage(buf); } catch { return null; }
}

function rounded(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw an image to cover the box (like CSS object-fit: cover).
function cover(ctx: SKRSContext2D, im: Image, x: number, y: number, w: number, h: number): void {
  const s = Math.max(w / im.width, h / im.height);
  const iw = im.width * s, ih = im.height * s;
  ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

function fitText(ctx: SKRSContext2D, text: string, font: (px: number) => string, start: number, maxW: number): void {
  let px = start;
  ctx.font = font(px);
  while (px > 28 && ctx.measureText(text).width > maxW) { px -= 2; ctx.font = font(px); }
}

export async function renderPlayingCard(p: PlayingCardInput): Promise<Buffer> {
  fonts();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [art, avatar, icon] = await Promise.all([img(p.card?.art ?? null), img(p.avatar), loadImage(join(ASSETS, 'icon-128.png')).catch(() => null)]);
  const r = RARITY[p.card?.rarity ?? ''] ?? RARITY.normal!;

  // Background: the card's art, blurred and darkened, fading into the panel on the left.
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 0, W, H);
  if (art) {
    ctx.save();
    ctx.filter = 'blur(26px) brightness(0.55) saturate(1.2)';
    cover(ctx, art, 300, -60, W - 240, H + 120);
    ctx.restore();
  } else {
    const g = ctx.createRadialGradient(900, 315, 20, 900, 315, 520);
    g.addColorStop(0, 'rgba(124, 92, 255, 0.35)');
    g.addColorStop(1, 'rgba(13, 15, 22, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  const fade = ctx.createLinearGradient(0, 0, 760, 0);
  fade.addColorStop(0, 'rgba(13, 15, 22, 1)');
  fade.addColorStop(0.55, 'rgba(13, 15, 22, 0.92)');
  fade.addColorStop(1, 'rgba(13, 15, 22, 0)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);

  // The brand chip.
  if (icon) { ctx.save(); rounded(ctx, 64, 56, 44, 44, 11); ctx.clip(); ctx.drawImage(icon, 64, 56, 44, 44); ctx.restore(); }
  ctx.fillStyle = '#F4B73C';
  ctx.font = '800 22px Inter';
  ctx.fillText('LION PRIDE TCG', 122, 87);

  // The avatar with a gold ring (the initial when there is no picture).
  const ax = 64, ay = 178, as = 150;
  const ring = ctx.createLinearGradient(ax, ay, ax + as, ay + as);
  ring.addColorStop(0, '#FFD66B');
  ring.addColorStop(1, '#D8901A');
  ctx.beginPath(); ctx.arc(ax + as / 2, ay + as / 2, as / 2 + 6, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(ax + as / 2, ay + as / 2, as / 2, 0, Math.PI * 2); ctx.clip();
  if (avatar) cover(ctx, avatar, ax, ay, as, as);
  else {
    ctx.fillStyle = '#6b4dff'; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = '#fff'; ctx.font = '800 72px Bricolage'; ctx.textAlign = 'center';
    ctx.fillText((p.name[0] ?? '?').toUpperCase(), ax + as / 2, ay + as / 2 + 26);
    ctx.textAlign = 'left';
  }
  ctx.restore();

  // Name, "is playing", and today's numbers.
  ctx.fillStyle = '#ffffff';
  fitText(ctx, p.name, (px) => `800 ${px}px Bricolage`, 68, 560);
  ctx.fillText(p.name, 64, 420);
  ctx.fillStyle = p.playing ? '#7CF0B0' : '#b9bdd0';
  ctx.font = '600 30px Inter';
  if (p.playing) { ctx.beginPath(); ctx.arc(73, 458, 8, 0, Math.PI * 2); ctx.fill(); } // the fonts have no ● glyph
  ctx.fillText(p.playing ? 'is playing' : 'was playing', p.playing ? 92 : 64, 468);
  const bits = [p.packs ? `${p.packs} pack${p.packs === 1 ? '' : 's'} today` : '', p.damage ? `${p.damage.toLocaleString('en-US')} boss damage` : ''].filter(Boolean);
  if (bits.length) {
    ctx.fillStyle = '#8b90a8';
    ctx.font = '500 24px Inter';
    ctx.fillText(bits.join('  ·  '), 64, 520);
  }

  // The best pull of the day, framed in its rarity color (or the brand when none yet).
  const cw = 318, ch = Math.round(cw * 7 / 5), cx = W - cw - 88, cy = (H - ch) / 2 - 8;
  ctx.fillStyle = '#FF7FB6';
  ctx.font = '800 17px Inter';
  ctx.textAlign = 'right';
  ctx.fillText(p.card ? 'BEST PULL TODAY' : 'NO PULLS YET TODAY', cx + cw, cy - 16);
  ctx.textAlign = 'left';
  ctx.save();
  ctx.shadowColor = p.card ? r.color : 'rgba(244, 183, 60, 0.5)';
  ctx.shadowBlur = 40;
  rounded(ctx, cx - 5, cy - 5, cw + 10, ch + 10, 22);
  ctx.fillStyle = p.card ? r.color : '#2a2c3a';
  ctx.fill();
  ctx.restore();
  ctx.save();
  rounded(ctx, cx, cy, cw, ch, 18);
  ctx.clip();
  if (p.card && art) cover(ctx, art, cx, cy, cw, ch);
  else {
    ctx.fillStyle = '#161826'; ctx.fillRect(cx, cy, cw, ch);
    if (icon) { ctx.save(); rounded(ctx, cx + cw / 2 - 64, cy + ch / 2 - 64, 128, 128, 30); ctx.clip(); ctx.drawImage(icon, cx + cw / 2 - 64, cy + ch / 2 - 64, 128, 128); ctx.restore(); }
  }
  ctx.restore();
  // Under the frame (the art already prints the card's name on its face): rarity + name.
  if (p.card) {
    const label = r.label.toUpperCase();
    ctx.font = '800 17px Inter';
    const lw = ctx.measureText(label).width;
    ctx.font = '600 20px Inter';
    let name = p.card.name;
    while (name.length > 4 && lw + 44 + ctx.measureText(name).width > cw + 40) name = `${name.slice(0, -2).trimEnd()}…`;
    const nw = ctx.measureText(name).width, total = 16 + lw + 16 + nw, x0 = cx + cw / 2 - total / 2, y = cy + ch + 42;
    ctx.fillStyle = r.color;
    ctx.save(); ctx.translate(x0 + 6, y - 6); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore(); // the diamond (no ◆ glyph)
    ctx.font = '800 17px Inter';
    ctx.fillText(label, x0 + 16, y);
    ctx.fillStyle = '#e6e8f2';
    ctx.font = '600 20px Inter';
    ctx.fillText(name, x0 + 16 + lw + 16, y);
  }
  return canvas.toBuffer('image/png');
}
