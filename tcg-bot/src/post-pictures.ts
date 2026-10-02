import { createCanvas, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { fonts, img, rounded, cover, RARITY } from './playing-card.js';
import { brand, glow, avatarCircle } from './raid-cards.js';

// The post pictures (Nathan, 2026-10-02: "as interactive and cool as possible"): a rare pull,
// a prank / boon play and a trade, drawn like the raid pictures (the same fonts, colors, brand).

const BG = '#0d0f16';
const FALL = 'NS-latin-ext, NS-cyrillic, NS-cyrillic-ext, NS-greek, NS-greek-ext, NE-0, NE-1, NE-2, NE-3, NE-4, NE-5, NE-6, NE-7, NE-8, NE-9, NE-10';
const font = (weight: number, px: number, family = 'Inter'): string => `${weight} ${px}px ${family}, ${FALL}`;

/** The largest size (down to min) at which the text fits maxW. */
function fit(ctx: SKRSContext2D, text: string, weight: number, start: number, min: number, maxW: number, family = 'Inter'): void {
  let px = start;
  ctx.font = font(weight, px, family);
  while (px > min && ctx.measureText(text).width > maxW) { px -= 2; ctx.font = font(weight, px, family); }
}

/** Words into lines of at most maxW (at most `max` lines; a longer text ends with "..."). */
function lines(ctx: SKRSContext2D, text: string, maxW: number, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width <= maxW || !cur) cur = next;
    else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  if (out.length > max) { out.length = max; out[max - 1] = `${out[max - 1].replace(/\s+\S*$/, '')}...`; }
  return out;
}

const rarityColor = (r: string | null | undefined): string => (r && RARITY[r]?.color) || '#9aa3b5';
const rarityLabel = (r: string | null | undefined): string => (r && RARITY[r]?.label) || 'Card';

/** A card face (the image is the whole card), rotated about its center, with a rarity glow. */
function card(ctx: SKRSContext2D, im: Image | null, cx: number, cy: number, w: number, color: string, deg = 0, alpha = 1): void {
  const h = im ? (w * im.height) / im.width : w * 1.4;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy); ctx.rotate((deg * Math.PI) / 180);
  ctx.shadowColor = color; ctx.shadowBlur = 48;
  rounded(ctx, -w / 2, -h / 2, w, h, w * 0.05); ctx.fillStyle = color; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  rounded(ctx, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6, w * 0.045); ctx.clip();
  if (im) ctx.drawImage(im, -w / 2 + 3, -h / 2 + 3, w - 6, h - 6);
  else { ctx.fillStyle = '#1b1e2c'; ctx.fillRect(-w / 2, -h / 2, w, h); }
  ctx.restore();
  ctx.restore();
}

/** An empty card slot (the trade card not picked yet). */
function slot(ctx: SKRSContext2D, cx: number, cy: number, w: number, deg: number): void {
  const h = w * 1.4;
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate((deg * Math.PI) / 180);
  rounded(ctx, -w / 2, -h / 2, w, h, w * 0.05);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)'; ctx.fill();
  ctx.setLineDash([14, 10]); ctx.lineWidth = 4; ctx.strokeStyle = '#4a4e68'; ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#8a8fa8'; ctx.font = font(800, Math.round(w * 0.42), 'Bricolage'); ctx.textAlign = 'center';
  ctx.fillText('?', 0, w * 0.15);
  ctx.font = font(700, 20); ctx.fillText('their pick', 0, w * 0.45);
  ctx.textAlign = 'left';
  ctx.restore();
}

/** Light rays behind a card (a Gold pull). */
function rays(ctx: SKRSContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  const n = 18;
  for (let i = 0; i < n; i++) {
    ctx.rotate((Math.PI * 2) / n);
    const g = ctx.createLinearGradient(0, 0, r, 0);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(244, 183, 60, 0)');
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r, -r * 0.09); ctx.lineTo(r, r * 0.09); ctx.closePath();
    ctx.fillStyle = g; ctx.globalAlpha = i % 2 ? 0.35 : 0.6; ctx.fill();
  }
  ctx.restore();
}

/** Four-point sparkles (seeded, so the same post draws the same picture). */
function sparkles(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color: string, n: number, seed: number): void {
  let s = seed || 1;
  const rnd = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  ctx.save();
  for (let i = 0; i < n; i++) {
    const px = x + rnd() * w, py = y + rnd() * h, r = 5 + rnd() * 13;
    ctx.globalAlpha = 0.5 + rnd() * 0.5;
    ctx.fillStyle = i % 3 ? color : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px, py - r); ctx.quadraticCurveTo(px, py, px + r, py); ctx.quadraticCurveTo(px, py, px, py + r);
    ctx.quadraticCurveTo(px, py, px - r, py); ctx.quadraticCurveTo(px, py, px, py - r); ctx.fill();
  }
  ctx.restore();
}

/** A pill label: "GOLD PULL", "PRANK", "TRADE OFFER". */
function chip(ctx: SKRSContext2D, text: string, x: number, y: number, color: string, align: 'left' | 'right' = 'left'): void {
  ctx.font = font(800, 20);
  const w = ctx.measureText(text).width + 36;
  const x0 = align === 'right' ? x - w : x;
  rounded(ctx, x0, y, w, 40, 20); ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = '#0d0f16'; ctx.fillText(text, x0 + 18, y + 27);
}

/** A curved arrow from (x1, y1) to (x2, y2), bowing up by `bow`. */
function arrow(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number, bow: number, color: string, dashed = true): void {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - bow;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.lineCap = 'round';
  if (dashed) ctx.setLineDash([2, 16]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2); ctx.stroke();
  ctx.setLineDash([]);
  const a = Math.atan2(y2 - my, x2 - mx);
  ctx.translate(x2, y2); ctx.rotate(a);
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-18, -14); ctx.lineTo(-18, 14); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  ctx.restore();
}

/** A tilted stamp across a spot: "BLOCKED", "BOUNCED BACK". */
function stamp(ctx: SKRSContext2D, text: string, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(-0.18);
  ctx.font = font(800, 40, 'Bricolage');
  const w = ctx.measureText(text).width + 40;
  rounded(ctx, -w / 2, -34, w, 64, 12);
  ctx.fillStyle = 'rgba(13, 15, 22, 0.85)'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = color; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, 0, 13);
  ctx.restore();
}

/** A member: the avatar and the name under it, centered on cx. */
function member(ctx: SKRSContext2D, im: Image | null, name: string, cx: number, y: number, s: number, ring: string): void {
  avatarCircle(ctx, im, name, cx - s / 2, y, s, ring);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
  fit(ctx, name, 800, 30, 18, 260);
  ctx.fillText(name, cx, y + s + 44);
  ctx.textAlign = 'left';
}

export type PullCard = { name: string; rarity: string; art: Buffer | null };
export type RarePullInput = { name: string; avatar: Buffer | null; cards: PullCard[] };

/** A rare pull (Full Art / Gold): the member and the card(s), up to 3 fanned. 1200 x 630. */
export async function renderRarePull(p: RarePullInput): Promise<Buffer> {
  fonts();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const cards = [...p.cards].sort((a, b) => (RARITY[b.rarity]?.rank ?? 0) - (RARITY[a.rarity]?.rank ?? 0)).slice(0, 3);
  const top = cards[0];
  const color = rarityColor(top?.rarity);
  const gold = top?.rarity === 'gold';
  const [avatar, ...arts] = await Promise.all([img(p.avatar), ...cards.map((c) => img(c.art))]);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  if (arts[0]) { ctx.save(); ctx.filter = 'blur(30px) brightness(0.45) saturate(1.3)'; cover(ctx, arts[0], 520, -80, W - 460, H + 160); ctx.restore(); }
  const fade = ctx.createLinearGradient(0, 0, 760, 0);
  fade.addColorStop(0, 'rgba(13, 15, 22, 1)'); fade.addColorStop(0.62, 'rgba(13, 15, 22, 0.9)'); fade.addColorStop(1, 'rgba(13, 15, 22, 0)');
  ctx.fillStyle = fade; ctx.fillRect(0, 0, W, H);
  const cx = 900, cy = 318;
  glow(ctx, W, H, gold ? 'rgba(244, 183, 60, 0.35)' : 'rgba(255, 92, 168, 0.28)', cx, cy);
  if (gold) rays(ctx, cx, cy, 520, 'rgba(255, 214, 107, 0.55)');
  const fan = cards.length === 1 ? [[0, 0]] : cards.length === 2 ? [[-70, -8], [70, 8]] : [[-110, -12], [0, 0], [110, 12]];
  // The rarest card on top: draw the others first.
  for (let i = cards.length - 1; i >= 0; i--) {
    const [dx, deg] = fan[i] ?? [0, 0];
    card(ctx, arts[i] ?? null, cx + dx, cy + Math.abs(dx) * 0.18, cards.length === 1 ? 360 : 290, rarityColor(cards[i].rarity), deg - (cards.length === 1 ? 4 : 0));
  }
  sparkles(ctx, 600, 20, 580, 590, gold ? '#FFD66B' : '#FF9CCB', gold ? 26 : 16, top ? top.name.length * 97 : 7);

  await brand(ctx, 64, 52);
  chip(ctx, gold ? 'GOLD PULL' : cards.length > 1 ? 'RARE PULLS' : `${rarityLabel(top?.rarity).toUpperCase()} PULL`, 64, 122, color);
  avatarCircle(ctx, avatar, p.name, 64, 196, 96, color);
  ctx.fillStyle = '#ffffff';
  fit(ctx, p.name, 800, 46, 26, 400, 'Bricolage');
  ctx.fillText(p.name, 180, 244);
  ctx.fillStyle = '#b9bdd0'; ctx.font = font(600, 24);
  ctx.fillText(cards.length > 1 ? `pulled ${cards.length} rare cards!` : 'just pulled', 180, 280);
  let y = 368;
  for (const c of cards) {
    ctx.fillStyle = '#ffffff';
    fit(ctx, c.name, 800, cards.length > 1 ? 34 : 50, 22, 520, 'Bricolage');
    ctx.fillText(c.name, 64, y);
    // The diamond is drawn: Inter has no ◆ glyph.
    ctx.fillStyle = rarityColor(c.rarity);
    ctx.beginPath(); ctx.moveTo(71, y + 18); ctx.lineTo(78, y + 25); ctx.lineTo(71, y + 32); ctx.lineTo(64, y + 25); ctx.closePath(); ctx.fill();
    ctx.font = font(800, 20); ctx.fillText(rarityLabel(c.rarity).toUpperCase(), 88, y + 32);
    y += cards.length > 1 ? 82 : 96;
  }
  return canvas.toBuffer('image/png');
}

export type PlayInput = {
  kind: 'boon' | 'prank' | 'neutral' | string;
  outcome: 'applied' | 'blocked' | 'reflected' | 'decoyed' | 'redirected' | 'delayed' | string;
  sender: string; senderAvatar: Buffer | null; target: string; targetAvatar: Buffer | null;
  card: string; art: Buffer | null; rarity: string | null; effectName: string | null; effectDesc: string | null;
};
const KIND = {
  boon: { label: 'BOON', color: '#7CF0B0', glow: 'rgba(124, 240, 176, 0.18)', verb: 'got a boon' },
  prank: { label: 'PRANK', color: '#C77DFF', glow: 'rgba(199, 125, 255, 0.22)', verb: 'got pranked' },
  neutral: { label: 'CARD PLAY', color: '#6BC5FF', glow: 'rgba(107, 197, 255, 0.18)', verb: 'got hit' },
} as const;

/** A boon / prank play: the sender, the card flying to the target, the effect and the outcome. 1200 x 630. */
export async function renderPlay(p: PlayInput): Promise<Buffer> {
  fonts();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const k = KIND[p.kind as keyof typeof KIND] ?? KIND.neutral;
  const [sa, ta, art] = await Promise.all([img(p.senderAvatar), img(p.targetAvatar), img(p.art)]);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  if (art) { ctx.save(); ctx.filter = 'blur(36px) brightness(0.35) saturate(1.2)'; cover(ctx, art, 0, 0, W, H); ctx.restore(); }
  glow(ctx, W, H, k.glow, 600, 260);
  await brand(ctx, 56, 44);
  chip(ctx, k.label, W - 56, 44, k.color, 'right');

  const s = 150, ly = 150, sx = 190, tx = 1010, cy = ly + s / 2;
  const back = p.outcome === 'reflected', blocked = p.outcome === 'blocked';
  // The card flies from the sender to the target (and back to the sender when reflected).
  arrow(ctx, sx + s / 2 + 16, cy - 10, tx - s / 2 - 26, cy - 10, 120, k.color);
  if (back) arrow(ctx, tx - s / 2 - 16, cy + 40, sx + s / 2 + 26, cy + 40, -70, '#FFD66B');
  card(ctx, art, 600, 250, 190, rarityColor(p.rarity), back ? 8 : -8);
  member(ctx, sa, p.sender, sx, ly, s, back ? '#FFD66B' : '#3a3d55');
  member(ctx, ta, p.target, tx, ly, s, blocked ? '#ff5a6e' : back ? '#3a3d55' : k.color);
  if (blocked) stamp(ctx, 'BLOCKED', tx, cy, '#FF5A6E');
  else if (back) stamp(ctx, 'BOUNCED BACK', sx + 30, cy + 58, '#FFD66B');
  else if (p.outcome === 'decoyed') stamp(ctx, 'DECOY!', tx, cy, '#FFD66B');
  else if (p.outcome === 'redirected') stamp(ctx, 'REDIRECTED', tx, cy, '#6BC5FF');
  else if (p.outcome === 'delayed') stamp(ctx, 'IN 1 HOUR', tx, cy, '#6BC5FF');

  // The effect: the name and the text, centered at the bottom.
  ctx.textAlign = 'center';
  ctx.fillStyle = k.color; ctx.font = font(800, 20);
  const who = back ? p.sender : p.target;
  const line = blocked ? `${p.target} blocked it!` : back ? `It bounced back to ${p.sender}!` : `${who} ${k.verb}!`;
  fit(ctx, line.toUpperCase(), 800, 20, 14, 1000);
  ctx.fillText(line.toUpperCase(), W / 2, 448);
  ctx.fillStyle = '#ffffff';
  const title = p.effectName && p.effectName.trim().toLowerCase() !== p.card.trim().toLowerCase() ? `${p.card}: ${p.effectName}` : p.card;
  fit(ctx, title, 800, 40, 24, 1060, 'Bricolage');
  ctx.fillText(title, W / 2, 498);
  if (p.effectDesc) {
    ctx.fillStyle = '#b9bdd0'; ctx.font = font(600, 22);
    lines(ctx, p.effectDesc, 980, 2).forEach((l, i) => ctx.fillText(l, W / 2, 540 + i * 30));
  }
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}

export type TradeCard = { name: string; rarity: string; art: Buffer | null } | null;
export type TradeInput = {
  kind: 'offer' | 'picked' | 'accepted' | 'gift';
  from: string; fromAvatar: Buffer | null; to: string; toAvatar: Buffer | null;
  offer: TradeCard; request: TradeCard;
};
const TRADE = {
  offer: { label: 'TRADE OFFER', color: '#4DA3FF' },
  picked: { label: 'TRADE COUNTER', color: '#B18CFF' },
  accepted: { label: 'TRADE DONE', color: '#7CF0B0' },
  gift: { label: 'CARD GIFT', color: '#F4B73C' },
} as const;

/** A trade: the two members and the cards between them (or a card gift). 1200 x 630. */
export async function renderTrade(p: TradeInput): Promise<Buffer> {
  fonts();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const t = TRADE[p.kind];
  const [fa, ta, oa, ra] = await Promise.all([img(p.fromAvatar), img(p.toAvatar), img(p.offer?.art ?? null), img(p.request?.art ?? null)]);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  if (oa) { ctx.save(); ctx.filter = 'blur(40px) brightness(0.3) saturate(1.2)'; cover(ctx, oa, 0, 0, W / 2, H); ctx.restore(); }
  if (ra) { ctx.save(); ctx.filter = 'blur(40px) brightness(0.3) saturate(1.2)'; cover(ctx, ra, W / 2, 0, W / 2, H); ctx.restore(); }
  glow(ctx, W, H, 'rgba(77, 163, 255, 0.14)', 600, 300);
  await brand(ctx, 56, 44);
  chip(ctx, t.label, W - 56, 44, t.color, 'right');

  const s = 132, ly = 190, fx = 150, tx = 1050;
  member(ctx, fa, p.from, fx, ly, s, t.color);
  member(ctx, ta, p.to, tx, ly, s, t.color);
  if (p.kind === 'gift') {
    arrow(ctx, fx + s / 2 + 20, ly + s / 2, tx - s / 2 - 26, ly + s / 2, 110, t.color);
    card(ctx, oa, 600, 300, 230, rarityColor(p.offer?.rarity), -5);
    sparkles(ctx, 440, 90, 320, 420, '#FFD66B', 12, (p.offer?.name.length ?? 3) * 31);
  } else {
    // The offered card goes right, the asked card (or the empty slot) comes left.
    arrow(ctx, 420, 470, 770, 470, -40, '#4DA3FF');
    arrow(ctx, 780, 140, 430, 140, 40, '#B18CFF');
    card(ctx, oa, 480, 300, 200, rarityColor(p.offer?.rarity), -7);
    if (p.request) card(ctx, ra, 720, 300, 200, rarityColor(p.request.rarity), 7);
    else slot(ctx, 720, 300, 200, 7);
  }
  // The line under the picture.
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
  const o = p.offer?.name ?? 'a card', r = p.request?.name;
  const text = p.kind === 'gift' ? `${p.from} gave ${p.to} ${o}!`
    : p.kind === 'accepted' ? `${p.from} and ${p.to} swapped cards!`
    : p.kind === 'picked' ? `${p.to} picked ${r ?? 'a card'} for ${o}`
    : r ? `${p.from} offers ${o} for ${r}` : `${p.from} offers ${o}`;
  fit(ctx, text, 800, 34, 20, 1080, 'Bricolage');
  ctx.fillText(text, W / 2, 590);
  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
