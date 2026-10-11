import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { join } from 'node:path';
import { W, H, ASSETS, fonts, img, rounded, cover, drawLeftPanel, RARITY } from './playing-card.js';

// The "is running the Dungeon / the Gauntlet" picture (Nathan 2026-10-11). The same look as the
// boss-fight picture (playing-card.ts): the member on the left, and on the right a framed panel
// with the mode, the current floor (big), the room, and the squad. 1200x630.

export type DungeonMode = 'daily' | 'gauntlet';

export type DungeonScene = {
  mode: DungeonMode;
  title: string;      // the dungeon's name of the day, or the Gauntlet's name of the week
  sub: string;        // the daily rule, or "Week of Oct 4 - <theme>"
  floor: number;      // the member's current floor (1-based)
  floors: number;     // the floors in the run
  room: number;       // the member's current room on that floor (1-based)
  rooms: number;      // the rooms on that floor
  squad: { name: string; rarity: string }[];
};

export type DungeonCardInput = {
  name: string;
  line: string;
  live: boolean;
  avatar: Buffer | null;
  scene: DungeonScene;
  squadArt: (Buffer | null)[]; // one per squad card, same order
};

const SCRIPTS = 'NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
export const ACCENT: Record<DungeonMode, string> = { daily: '#B18CFF', gauntlet: '#FF6B7D' };
export const MODE_TAG: Record<DungeonMode, string> = { daily: 'DUNGEON RUN', gauntlet: 'GAUNTLET RUN' };

/** The line under the member's name ("is on floor 7 of the Dungeon"). */
export function dungeonLine(mode: DungeonMode, floor: number): string {
  return `is on floor ${floor} of the ${mode === 'gauntlet' ? 'Gauntlet' : 'Dungeon'}`;
}

/** "Week of Oct 4" from the week's start date (YYYY-MM-DD), in English, no time zone shift. */
export function weekLabel(week: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(week);
  if (!m) return 'This week';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `Week of ${months[Number(m[2]) - 1] ?? ''} ${Number(m[3])}`;
}

// Text that must fit one line: shrink to a floor, then cut with "...".
function oneLine(ctx: SKRSContext2D, text: string, font: (px: number) => string, start: number, min: number, maxW: number): string {
  let px = start;
  ctx.font = font(px);
  while (px > min && ctx.measureText(text).width > maxW) { px -= 1; ctx.font = font(px); }
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  return t === text ? t : `${t.trimEnd()}...`;
}

export async function renderDungeonCard(p: DungeonCardInput): Promise<Buffer> {
  fonts();
  const s = p.scene;
  const accent = ACCENT[s.mode];
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [avatar, icon, ...arts] = await Promise.all([img(p.avatar), loadImage(join(ASSETS, 'icon-128.png')).catch(() => null), ...p.squadArt.slice(0, 5).map(img)]);

  // Background: the first squad card, blurred and darkened (a radial glow in the mode color when none).
  ctx.fillStyle = '#0d0f16';
  ctx.fillRect(0, 0, W, H);
  if (arts[0]) {
    ctx.save();
    ctx.filter = 'blur(26px) brightness(0.55) saturate(1.2)';
    cover(ctx, arts[0], 300, -60, W - 240, H + 120);
    ctx.restore();
  } else {
    const g = ctx.createRadialGradient(900, 315, 20, 900, 315, 520);
    g.addColorStop(0, s.mode === 'gauntlet' ? 'rgba(255, 107, 125, 0.30)' : 'rgba(124, 92, 255, 0.35)');
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

  drawLeftPanel(ctx, p, avatar, icon);

  // The right panel.
  const px = 640, pw = 472, py = 60, ph = 540, pad = 32, inner = pw - pad * 2;
  ctx.fillStyle = '#FF7FB6';
  ctx.font = `800 17px Inter, ${SCRIPTS}`;
  ctx.textAlign = 'right';
  ctx.fillText(MODE_TAG[s.mode], px + pw, py - 16);
  ctx.textAlign = 'left';
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 40;
  rounded(ctx, px - 5, py - 5, pw + 10, ph + 10, 22);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.restore();
  rounded(ctx, px, py, pw, ph, 18);
  ctx.fillStyle = '#161826';
  ctx.fill();
  ctx.save();
  rounded(ctx, px, py, pw, ph, 18);
  ctx.clip();

  // The mode, the name and the rule or week.
  const x0 = px + pad;
  ctx.fillStyle = accent;
  ctx.font = `800 18px Inter, ${SCRIPTS}`;
  ctx.fillText(s.mode === 'gauntlet' ? 'THE GAUNTLET' : 'THE DUNGEON', x0, py + 50);
  ctx.fillStyle = '#ffffff';
  const title = oneLine(ctx, s.title, (n) => `800 ${n}px Bricolage, ${SCRIPTS}`, 34, 22, inner);
  ctx.fillText(title, x0, py + 90);
  ctx.fillStyle = '#b9bdd0';
  const sub = oneLine(ctx, s.sub, (n) => `600 ${n}px Inter, ${SCRIPTS}`, 21, 15, inner);
  ctx.fillText(sub, x0, py + 124);

  // The current floor, large.
  ctx.fillStyle = '#8a8fa6';
  ctx.font = `800 18px Inter, ${SCRIPTS}`;
  ctx.fillText('FLOOR', x0, py + 178);
  ctx.fillStyle = '#ffffff';
  const fl = String(s.floor);
  ctx.font = `800 150px Bricolage, ${SCRIPTS}`;
  ctx.fillText(fl, x0, py + 316);
  const fw = ctx.measureText(fl).width;
  ctx.fillStyle = '#8a8fa6';
  ctx.font = `700 34px Bricolage, ${SCRIPTS}`;
  ctx.fillText(`of ${s.floors}`, x0 + fw + 16, py + 316);

  // The room: text and one pip per room (filled = done, ring = here).
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 28px Inter, ${SCRIPTS}`;
  ctx.fillText(`Room ${s.room} of ${s.rooms}`, x0, py + 366);
  const gap = 10, pipR = 9, count = Math.max(1, Math.min(s.rooms, 12));
  for (let i = 0; i < count; i++) {
    const cx = x0 + pipR + i * (pipR * 2 + gap), cy = py + 392;
    ctx.beginPath(); ctx.arc(cx, cy, pipR, 0, Math.PI * 2);
    if (i + 1 < s.room) { ctx.fillStyle = accent; ctx.fill(); }
    else if (i + 1 === s.room) { ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = accent; ctx.stroke(); }
    else { ctx.lineWidth = 3; ctx.strokeStyle = '#3a3d52'; ctx.stroke(); }
  }

  // The squad: up to 5 small cards in their rarity colors.
  const n = Math.min(5, s.squad.length);
  if (n) {
    const cw = 62, ch = 87, cg = 12, sy = py + ph - ch - 28;
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * (cw + cg);
      const color = (RARITY[s.squad[i]!.rarity] ?? RARITY.normal!).color;
      rounded(ctx, cx - 3, sy - 3, cw + 6, ch + 6, 9);
      ctx.fillStyle = color; ctx.fill();
      ctx.save();
      rounded(ctx, cx, sy, cw, ch, 7); ctx.clip();
      const a = arts[i];
      if (a) cover(ctx, a, cx, sy, cw, ch);
      else { ctx.fillStyle = '#23263a'; ctx.fillRect(cx, sy, cw, ch); }
      ctx.restore();
    }
  }
  ctx.restore();
  return canvas.toBuffer('image/png');
}
