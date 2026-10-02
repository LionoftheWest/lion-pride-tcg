import { createCanvas, loadImage, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { join } from 'node:path';
import { ASSETS, fonts, img, rounded, cover, fitText, RARITY } from './playing-card.js';

// The raid pictures (Nathan, 2026-10-02): the daily 6 AM MT leaderboard and the end-of-day squad
// summary. Drawn like the "is playing" picture (playing-card.ts): the same fonts, colors and brand.

const BG = '#0d0f16';
const GOLD = '#F4B73C';
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export async function brand(ctx: SKRSContext2D, x: number, y: number): Promise<void> {
  const icon = await loadImage(join(ASSETS, 'icon-128.png')).catch(() => null);
  if (icon) { ctx.save(); rounded(ctx, x, y, 40, 40, 10); ctx.clip(); ctx.drawImage(icon, x, y, 40, 40); ctx.restore(); }
  ctx.fillStyle = GOLD;
  ctx.font = '800 20px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText('LION PRIDE TCG', x + 54, y + 28);
}

export function glow(ctx: SKRSContext2D, w: number, h: number, color: string, cx: number, cy: number): void {
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.7);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(13, 15, 22, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function hpBar(ctx: SKRSContext2D, x: number, y: number, w: number, left: number, max: number): void {
  const pct = max > 0 ? Math.max(0, Math.min(1, left / max)) : 0;
  rounded(ctx, x, y, w, 16, 8); ctx.fillStyle = '#26283a'; ctx.fill();
  if (pct > 0) { rounded(ctx, x, y, Math.max(16, w * pct), 16, 8); ctx.fillStyle = '#FF5A6E'; ctx.fill(); }
}

export function avatarCircle(ctx: SKRSContext2D, im: Image | null, name: string, x: number, y: number, s: number, ring = '#3a3d55'): void {
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2 + 3, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); ctx.clip();
  if (im) cover(ctx, im, x, y, s, s);
  else {
    ctx.fillStyle = '#6b4dff'; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(s * 0.48)}px Bricolage, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10`; ctx.textAlign = 'center';
    ctx.fillText((name[0] ?? '?').toUpperCase(), x + s / 2, y + s * 0.66);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

export type BoardRow = { name: string; damage: number; avatar: Buffer | null };
export type BoardInput = { boss: string; tier: string; hpLeft: number; hpMax: number; closesIn: string; rows: BoardRow[] };

/** The daily leaderboard: the top 10 by damage, the boss HP and the time left. 1200 x 675. */
export async function renderRaidBoard(p: BoardInput): Promise<Buffer> {
  fonts();
  const W = 1200, H = 675;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  glow(ctx, W, H, 'rgba(255, 90, 110, 0.20)', 1050, 80);
  await brand(ctx, 56, 40);
  ctx.fillStyle = '#FF8A98'; ctx.font = '800 18px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText('RAID LEADERBOARD', 56, 124);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, p.boss, (px) => `800 ${px}px Bricolage, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10`, 46, 640);
  ctx.fillText(p.boss, 56, 176);
  ctx.fillStyle = '#b9bdd0'; ctx.font = '600 20px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText(`${p.tier} · ${fmt(p.hpLeft)} / ${fmt(p.hpMax)} HP · closes in ${p.closesIn}`, 56, 212);
  hpBar(ctx, 56, 228, 640, p.hpLeft, p.hpMax);

  const rows = p.rows.slice(0, 10);
  const top = Math.max(1, ...rows.map((r) => r.damage));
  const ims = await Promise.all(rows.map((r) => img(r.avatar)));
  const medal = ['#FFD66B', '#D9DEE8', '#E0A06A'];
  const colW = 528, rowH = 70, x0 = 56, y0 = 280;
  rows.forEach((r, i) => {
    const col = i < 5 ? 0 : 1, row = i % 5;
    const x = x0 + col * (colW + 32), y = y0 + row * rowH;
    rounded(ctx, x, y, colW, rowH - 10, 14); ctx.fillStyle = i < 3 ? 'rgba(244, 183, 60, 0.10)' : '#151826'; ctx.fill();
    ctx.fillStyle = medal[i] ?? '#8a8fa8'; ctx.font = '800 24px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10'; ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 30, y + 39); ctx.textAlign = 'left';
    avatarCircle(ctx, ims[i] ?? null, r.name, x + 56, y + 9, 42, medal[i] ?? '#3a3d55');
    ctx.fillStyle = '#ffffff';
    fitText(ctx, r.name, (px) => `700 ${px}px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10`, 22, 250);
    ctx.fillText(r.name, x + 112, y + 30);
    rounded(ctx, x + 112, y + 40, 260, 6, 3); ctx.fillStyle = '#26283a'; ctx.fill();
    rounded(ctx, x + 112, y + 40, Math.max(6, 260 * (r.damage / top)), 6, 3); ctx.fillStyle = i < 3 ? GOLD : '#FF5A6E'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = '800 24px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10'; ctx.textAlign = 'right';
    ctx.fillText(fmt(r.damage), x + colW - 18, y + 39); ctx.textAlign = 'left';
  });
  if (!rows.length) { ctx.fillStyle = '#b9bdd0'; ctx.font = '600 24px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10'; ctx.fillText('No hunters yet today. Be the first!', 56, 320); }
  return canvas.toBuffer('image/png');
}

export type SummaryInput = { name: string; avatar: Buffer | null; total: number; cards: number; topCard: string | null;
  topDamage: number; topArt: Buffer | null; topRarity: string | null; boss: string; hpLeft: number; hpMax: number };

/** The end-of-day squad summary: the member, the damage, the cards, the top card, the boss HP. 1200 x 630. */
export async function renderSquadSummary(p: SummaryInput): Promise<Buffer> {
  fonts();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [avatar, art] = await Promise.all([img(p.avatar), img(p.topArt)]);
  const color = (p.topRarity && RARITY[p.topRarity]?.color) || '#FF5A6E';
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  if (art) { ctx.save(); ctx.filter = 'blur(26px) brightness(0.5) saturate(1.2)'; cover(ctx, art, 360, -60, W - 300, H + 120); ctx.restore(); }
  const fade = ctx.createLinearGradient(0, 0, 780, 0);
  fade.addColorStop(0, 'rgba(13, 15, 22, 1)'); fade.addColorStop(0.6, 'rgba(13, 15, 22, 0.92)'); fade.addColorStop(1, 'rgba(13, 15, 22, 0)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  await brand(ctx, 64, 52);
  avatarCircle(ctx, avatar, p.name, 64, 128, 112, GOLD);
  ctx.fillStyle = '#ffffff';
  fitText(ctx, p.name, (px) => `800 ${px}px Bricolage, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10`, 52, 480);
  ctx.fillText(p.name, 196, 182);
  ctx.fillStyle = '#7CF0B0'; ctx.font = '600 24px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText('finished the hunt for today', 196, 220);

  ctx.fillStyle = '#b9bdd0'; ctx.font = '800 16px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText('DAMAGE TODAY', 64, 300);
  ctx.fillStyle = GOLD; ctx.font = '800 76px Bricolage, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText(fmt(p.total), 64, 378);
  ctx.fillStyle = '#ffffff'; ctx.font = '600 24px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText(`${p.cards} card${p.cards === 1 ? '' : 's'}${p.topCard ? ` · top card ${p.topCard} (${fmt(p.topDamage)})` : ''}`, 64, 420);
  ctx.fillStyle = '#b9bdd0'; ctx.font = '600 20px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
  ctx.fillText(`${p.boss} · ${fmt(p.hpLeft)} / ${fmt(p.hpMax)} HP left`, 64, 500);
  hpBar(ctx, 64, 516, 560, p.hpLeft, p.hpMax);

  const cw = 300, ch = Math.round(cw * 7 / 5), cx = W - cw - 88, cy = (H - ch) / 2 + 10;
  ctx.fillStyle = color; ctx.font = '800 17px Inter, NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10'; ctx.textAlign = 'right';
  ctx.fillText('TOP CARD', cx + cw, cy - 16); ctx.textAlign = 'left';
  ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 40; rounded(ctx, cx - 5, cy - 5, cw + 10, ch + 10, 22); ctx.fillStyle = color; ctx.fill(); ctx.restore();
  ctx.save(); rounded(ctx, cx, cy, cw, ch, 18); ctx.clip();
  if (art) cover(ctx, art, cx, cy, cw, ch); else { ctx.fillStyle = '#161826'; ctx.fillRect(cx, cy, cw, ch); }
  ctx.restore();
  return canvas.toBuffer('image/png');
}
