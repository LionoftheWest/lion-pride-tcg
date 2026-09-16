/**
 * Per-art-slot framing: how the artwork is panned/zoomed inside the card window.
 * Stored as { x, y, scale } where x/y are object-position percentages (0-100,
 * 50 = centered) and scale is the zoom (1 = fit/cover). One entry per id-slot,
 * so every tier that shares a slot's art shares its framing.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'art', '_frames.json');

export const DEFAULT_FRAME = { x: 50, y: 50, scale: 1 };

function readAll() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

function clamp(value, lo, hi) {
  const n = Number(value);
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** The saved frame for a card's art slot, or the centered default. */
export function getFrame(id, slot) {
  return { ...DEFAULT_FRAME, ...(readAll()[`${id}-${slot}`] || {}) };
}

/** Save (and clamp) the frame for a card's art slot. */
export function setFrame(id, slot, frame) {
  const all = readAll();
  const clean = {
    x: clamp(frame.x, 0, 100),
    y: clamp(frame.y, 0, 100),
    scale: clamp(frame.scale, 1, 4),
  };
  all[`${id}-${slot}`] = clean;
  writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
  return clean;
}
