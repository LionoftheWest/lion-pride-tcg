import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RARITY } from './rarity.js';

const execFileP = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

const TEMPLATES = {
  framed: readFileSync(join(ROOT, 'templates', 'card.template.html'), 'utf8'),
  fullart: readFileSync(join(ROOT, 'templates', 'card.fullart.html'), 'utf8'),
};

// The shared card back is the same for every card and every tier.
const BACK_HTML = readFileSync(join(ROOT, 'templates', 'card.back.html'), 'utf8');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Fill a template for one card + rarity. artUrl may be a web path or file:// URL. */
export function fillHtml(card, rarity, artUrl, mask = false, frame = null, artist = '') {
  const meta = RARITY[rarity];
  const template = TEMPLATES[meta.template];
  const f = frame || { x: 50, y: 50, scale: 1 };
  // x/y are the focal point of the image (%), 50 = centered; scale is the zoom.
  // A small script in the template places the image from its natural size.
  const art = artUrl
    ? `<img class="art-img" data-ax="${f.x}" data-ay="${f.y}" data-az="${f.scale}" src="${artUrl}">`
    : 'ART';
  return template
    .replaceAll('%%ACCENT%%', meta.accent)
    .replaceAll('%%ACCENT_SOFT%%', meta.soft)
    .replaceAll('%%CLASS%%', mask ? `${rarity} maskmode` : rarity)
    .replaceAll('%%NAME%%', esc(card.name))
    .replaceAll('%%GENRE%%', esc((card.genre || '').toUpperCase()))
    .replaceAll('%%LORE%%', esc(card.lore))
    .replaceAll('%%PIP%%', esc(meta.pip))
    .replaceAll('%%FINISH%%', meta.finish)
    .replaceAll('%%ARTIST%%', artist ? esc(artist) : '')
    .replaceAll('%%ART%%', art);
}

/** Wait until a file exists, is not empty and its size is the same on two reads in a row.
 * Throws when the file is not complete after tries x ms. */
export async function waitForFile(path, tries = 120, ms = 250) {
  let last = -1;
  for (let t = 0; t < tries; t++) {
    const size = existsSync(path) ? statSync(path).size : -1;
    if (size > 0 && size === last) return path;
    last = size;
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error(`no screenshot: ${path}`);
}

/** Screenshot an HTML string to a transparent PNG via headless Edge (async, so
 * the studio server stays responsive while a card renders).
 * Headless Edge sometimes returns before it writes the screenshot (observed 2026-10-20): the face, mask and
 * text-mask renders of one card then mixed. So each call gets its own HTML file and its own Edge profile,
 * the old PNG is removed first, and the call waits for the complete new file. The pixels do not change.
 * exec is a parameter for the test only (scripts/render-wait.test.mjs). */
export async function shootHtml(html, outPng, scale, tmpName, { exec = execFileP, tries, ms } = {}) {
  mkdirSync(dirname(outPng), { recursive: true });
  const uniq = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const tmp = join(dirname(outPng), tmpName.replace(/\.html$/, `-${uniq}.html`));
  writeFileSync(tmp, html, 'utf8');
  try { unlinkSync(outPng); } catch {}

  // A unique Edge profile per render, so parallel renders never collide on a
  // shared --user-data-dir (which fails with "Command failed").
  const profile = `${process.env.TEMP}\\edge-cardgen-${tmpName.replace(/[^a-z0-9]/gi, '_')}-${uniq}`;
  try {
    await exec(
      EDGE,
      [
        '--headless=new', '--disable-gpu', '--no-sandbox',
        `--user-data-dir=${profile}`,
        '--hide-scrollbars', `--force-device-scale-factor=${scale}`,
        '--default-background-color=00000000',
        '--virtual-time-budget=4000',
        `--screenshot=${outPng}`, '--window-size=500,700',
        'file:///' + tmp.replace(/\\/g, '/'),
      ],
    );
    return await waitForFile(outPng, tries, ms);
  } finally {
    // The names are unique now, so remove them (no growth of the out folder and TEMP).
    try { unlinkSync(tmp); } catch {}
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  }
}

/** Render one card face to a PNG via headless Edge. Returns the output path. */
export async function renderPng(card, rarity, artFilePath, outPng, scale = 2, mask = false, frame = null, artist = '') {
  const artUrl = artFilePath ? 'file:///' + artFilePath.replace(/\\/g, '/') : null;
  const html = fillHtml(card, rarity, artUrl, mask, frame, artist);
  return shootHtml(html, outPng, scale, `_tmp_${card.id}_${rarity}.html`);
}

/** Render the shared lion card back to a PNG. Same for every card and tier. */
export async function renderBack(outPng, scale = 2) {
  return shootHtml(BACK_HTML, outPng, scale, '_tmp_back.html');
}
