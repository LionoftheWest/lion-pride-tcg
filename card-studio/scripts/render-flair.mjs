/**
 * Render the ascension flair overlays (border ring + corner star-gems) and a
 * preview of each composited over a real card, via headless Edge (transparent PNG).
 *
 *   node scripts/render-flair.mjs
 *
 * Outputs to out/flair/: flair-{1..5,p}.png (transparent overlays) and
 * preview-{1..5,p}.png (overlay on a sample card, for eyeballing the look).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'out', 'flair');
mkdirSync(OUT, { recursive: true });

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);

const TEMPLATE = readFileSync(join(ROOT, 'templates', 'flair.template.html'), 'utf8');
const SAMPLE = join(ROOT, 'out', 'blastninja-s-blastoise-gold.png'); // a real rendered card

async function shoot(html, outPng, tag) {
  const tmp = join(OUT, `_tmp_${tag}.html`);
  writeFileSync(tmp, html, 'utf8');
  const profile = `${process.env.TEMP}\\edge-flair-${tag}`;
  await execFileP(EDGE, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--virtual-time-budget=4000',
    `--screenshot=${outPng}`, '--window-size=500,700',
    'file:///' + tmp.replace(/\\/g, '/'),
  ]);
  return outPng;
}

// A big holographic crown superimposed over the whole card (prestige only).
const CROWN_SVG = `<div class="crown-big"><svg viewBox="0 0 140 110" preserveAspectRatio="xMidYMid meet">
  <defs><linearGradient id="holo" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#b8862a"/><stop offset=".2" stop-color="#ffe9a8"/>
    <stop offset=".4" stop-color="#fff6cf"/><stop offset=".55" stop-color="#9be7ff"/>
    <stop offset=".7" stop-color="#ffd76e"/><stop offset=".85" stop-color="#ff9be3"/>
    <stop offset="1" stop-color="#b8862a"/></linearGradient></defs>
  <path class="cbody" d="M12 84 L12 30 L41 60 L70 14 L99 60 L128 30 L128 84 Z"/>
  <rect class="cband" x="12" y="82" width="116" height="20" rx="5"/>
</svg></div>`;

function fill(tier, gems, crown) {
  return TEMPLATE
    .replaceAll('%%TIER%%', tier)
    .replaceAll('%%GEMS%%', '<div class="gem">★</div>'.repeat(gems))
    .replaceAll('%%CROWN%%', crown ? CROWN_SVG : '');
}

// Preview = the flair over a card. Insert a card image behind .flair + a dark page.
function preview(html) {
  return html
    .replace('<body>', `<body><img class="cardbg" src="file:///${SAMPLE.replace(/\\/g, '/')}">`)
    .replace('</style>', '  .cardbg { position: absolute; inset: 0; width: 500px; height: 700px; object-fit: cover; border-radius: 32px; }\n  html, body { background: #0a0d14 !important; }\n</style>');
}

// 5 levels total. Level 5 IS the prestige level (the crown). No separate 6th tier.
const TIERS = [['f1', 1, false], ['f2', 2, false], ['f3', 3, false], ['f4', 4, false], ['f5', 5, true]];

// Face = card + flair baked into one 500x700 with transparent corners (a Blender
// card-face texture). Same as preview but WITHOUT the dark page background.
function face(html) {
  return html
    .replace('<body>', `<body><img class="cardbg" src="file:///${SAMPLE.replace(/\\/g, '/')}">`)
    .replace('</style>', '  .cardbg { position: absolute; inset: 0; width: 500px; height: 700px; object-fit: cover; border-radius: 32px; }\n</style>');
}

for (const [tier, gems, crown] of TIERS) {
  const label = tier === 'fp' ? 'p' : tier.slice(1);
  const html = fill(tier, gems, crown);
  await shoot(html, join(OUT, `flair-${label}.png`), `o${label}`);
  await shoot(preview(html), join(OUT, `preview-${label}.png`), `p${label}`);
  await shoot(face(html), join(OUT, `face-${label}.png`), `f${label}`);
  console.log(`rendered ${tier}`);
}
console.log('done -> out/flair/');
