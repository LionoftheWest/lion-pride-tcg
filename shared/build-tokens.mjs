// The token generator (docs/design.md 4.1). One source: shared/tokens.json. It writes:
//   tcg-activity/public/tokens.css                    the Activity CSS custom properties (:root)
//   tcg-activity/src/tokens.js                        the Activity JS constants (canvas, three.js)
//   tcg-bot/src/tokens.ts                             the bot picture constants
//   card-studio/gallery-deploy/public-gallery/tokens.css   the gallery CSS custom properties
// Each output is inside its own service folder, because each Docker build sees only that folder (ops/deploy.sh).
//   node shared/build-tokens.mjs           write the generated files
//   node shared/build-tokens.mjs --check   fail (exit 1) when a token is missing or invalid, or a generated file
//                                          is stale or was changed by hand. Gate G4 runs it (ci/gates/g4-literals.mjs).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = 'shared/tokens.json';
export const OUTPUTS = {
  activityCss: 'tcg-activity/public/tokens.css',
  activityJs: 'tcg-activity/src/tokens.js',
  botTs: 'tcg-bot/src/tokens.ts',
  galleryCss: 'card-studio/gallery-deploy/public-gallery/tokens.css',
};

// Every token that the approved library (UI-00) and design.md section 4 name. A missing name fails the build.
// (CSS names without "--".) Rarity, element, effect and type tokens are checked through their tables below.
export const REQUIRED = [
  'gold', 'gold-hi', 'gold-strong', 'gold-deep', 'on-gold', 'gold-a10', 'gold-a20', 'gold-a35', 'gold-a50',
  'bg-base', 'bg-raised', 'surface-1', 'surface-2', 'surface-3', 'overlay', 'scrim',
  'text-primary', 'text-secondary', 'text-muted', 'text-on-color', 'border', 'border-strong',
  'danger', 'danger-text', 'danger-soft', 'danger-strong', 'warning', 'warning-soft', 'success', 'success-soft', 'info', 'info-soft',
  'hunt', 'hunt-text', 'cur-shards', 'cur-shards-deep', 'cur-shards-hi', 'cur-shards-soft',
  'avatar-fallback-start', 'avatar-fallback-end', 'boss-hp-track', 'boss-hp-low', 'boss-hp-high',
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `name-color-${i}`),
  'font-display', 'font-ui', 'font-num', 'font-flavor',
  'sp-half', 'sp-1', 'sp-1-5', 'sp-2', 'sp-3', 'sp-4', 'sp-5', 'sp-6', 'sp-7',
  'rad-sm', 'rad-md', 'rad-lg', 'rad-sheet', 'rad-card-ratio', 'rad-pill', 'rad-round', 'bw-1', 'bw-2', 'bw-focus',
  'elev-1', 'elev-2', 'elev-3', 'glow-focus', 'glow-action',
  'item-disabled', 'item-locked', 'item-not-owned', 'item-down',
  'z-base', 'z-shell', 'z-sheet', 'z-modal', 'z-toast', 'z-system',
  'dur-instant', 'dur-fast', 'dur-base', 'dur-slow', 'dur-reveal', 'dur-celebrate',
  'ease-out', 'ease-spring', 'ease-in-out', 'ease-linear',
];
export const RARITY_KEYS = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'event', 'promo'];
export const ELEMENT_KEYS = ['fire', 'water', 'lightning', 'ice', 'nature', 'earth', 'shadow', 'air', 'arcane', 'psychic', 'toxic', 'metal', 'physical', 'light'];
export const EFFECT_KEYS = ['boon', 'prank', 'shield'];
export const TYPE_KEYS = ['display', 'title', 'heading', 'stat', 'body', 'small', 'caption', 'label'];

const HEX = /^#[0-9A-F]{6}(?:[0-9A-F]{2})?$/;
const TABLES = { rarity: RARITY_KEYS, element: ELEMENT_KEYS, effect: EFFECT_KEYS, type: TYPE_KEYS };
const meta = (k) => k.startsWith('_');

/** Read the source file. */
export const load = (root = ROOT) => JSON.parse(readFileSync(join(root, SOURCE), 'utf8'));

/** The plain tokens (not a table row): { name: token }. */
function plain(src) {
  const out = {};
  for (const [g, group] of Object.entries(src)) {
    if (meta(g) || TABLES[g]) continue;
    for (const [k, t] of Object.entries(group)) if (!meta(k)) out[k] = t;
  }
  return out;
}

/** A color value or a '{name}' reference -> uppercase hex. */
function resolveColor(v, flat, seen = []) {
  const ref = /^\{([a-z0-9-]+)\}$/.exec(v);
  if (!ref) return v;
  if (seen.includes(ref[1])) throw new Error(`token reference loop: ${[...seen, ref[1]].join(' -> ')}`);
  const t = flat[ref[1]];
  if (!t || t.type !== 'color') throw new Error(`unknown color reference ${v}`);
  return resolveColor(t.value, flat, [...seen, ref[1]]);
}
const cssColor = (v) => (/^\{([a-z0-9-]+)\}$/.test(v) ? `var(--${v.slice(1, -1)})` : v);

/** Throw on a missing or invalid token. Returns the source. */
export function validate(src) {
  const errors = [];
  const flat = plain(src);
  for (const name of REQUIRED) if (!flat[name]) errors.push(`missing token: ${name}`);
  for (const [table, keys] of Object.entries(TABLES)) {
    const rows = Object.keys(src[table] || {}).filter((k) => !meta(k));
    for (const k of keys) if (!rows.includes(k)) errors.push(`missing ${table} row: ${k}`);
    for (const k of rows) if (!keys.includes(k)) errors.push(`unknown ${table} row: ${k} (add it to ${table.toUpperCase()}_KEYS)`);
  }
  const color = (where, v) => {
    if (typeof v !== 'string') { errors.push(`${where}: no color`); return; }
    try { if (!HEX.test(resolveColor(v, flat))) errors.push(`${where}: "${v}" is not uppercase hex6 or hex8 (4.1)`); } catch (e) { errors.push(`${where}: ${e.message}`); }
  };
  const num = (where, v) => { if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${where}: not a number`); };
  for (const [k, t] of Object.entries(flat)) {
    switch (t.type) {
      case 'color': color(k, t.value); break;
      case 'px': case 'ms': case 'number': num(k, t.value); break;
      case 'string': if (typeof t.value !== 'string' || !t.value) errors.push(`${k}: empty string`); break;
      case 'font': if (!t.value || !Array.isArray(t.stack) || !t.stack.length) errors.push(`${k}: a font needs value and stack`); break;
      case 'shadow': for (const p of ['x', 'y', 'blur']) num(`${k}.${p}`, t[p]); if (t.color !== 'rarity') color(`${k}.color`, t.color); break;
      default: errors.push(`${k}: unknown type "${t.type}"`);
    }
  }
  for (const k of RARITY_KEYS) { const r = src.rarity?.[k]; if (!r) continue; color(`rarity.${k}.color`, r.color); color(`rarity.${k}.soft`, r.soft); if (r.text) color(`rarity.${k}.text`, r.text); if (!r.label || !r.short) errors.push(`rarity.${k}: label and short`); }
  for (const k of ELEMENT_KEYS) { const r = src.element?.[k]; if (!r) continue; color(`element.${k}.color`, r.color); if (r.text) color(`element.${k}.text`, r.text); }
  for (const k of EFFECT_KEYS) { const r = src.effect?.[k]; if (!r) continue; for (const p of ['color', 'gradStart', 'gradEnd', 'soft']) color(`effect.${k}.${p}`, r[p]); }
  for (const k of TYPE_KEYS) { const r = src.type?.[k]; if (!r) continue; for (const p of ['size', 'weight', 'lineHeight']) num(`type.${k}.${p}`, r[p]); }
  if (errors.length) throw new Error(`shared/tokens.json is not valid:\n- ${errors.join('\n- ')}`);
  return src;
}

const shadowCss = (t, color) => `${t.x}px ${t.y}px ${t.blur}px${t.spread != null ? ` ${t.spread}px` : ''} ${color}`.replace(/(^|\s)0px/g, '$10');

/** The flat CSS list: [{ name, css, value, note }] in source order. value = the resolved JS value. */
export function flatten(src) {
  validate(src);
  const flat = plain(src);
  const out = [];
  const add = (name, css, value, note) => out.push({ name, css, value, note });
  for (const [g, group] of Object.entries(src)) {
    if (meta(g)) continue;
    for (const [k, t] of Object.entries(group)) {
      if (meta(k)) continue;
      if (g === 'rarity') {
        add(`rarity-${k}`, cssColor(t.color), resolveColor(t.color, flat), t.label);
        if (t.text) add(`rarity-${k}-text`, t.text, t.text);
        add(`rarity-${k}-soft`, t.soft, t.soft);
      } else if (g === 'element') {
        add(`element-${k}`, t.color, t.color, t.label);
        if (t.text) add(`element-${k}-text`, t.text, t.text);
      } else if (g === 'effect') {
        add(`effect-${k}`, t.color, t.color, t.note);
        add(`effect-${k}-grad-start`, t.gradStart, t.gradStart);
        add(`effect-${k}-grad-end`, t.gradEnd, t.gradEnd);
        add(`effect-${k}-soft`, t.soft, t.soft);
      } else if (g === 'type') {
        add(`fs-${k}`, `${t.size}px`, t.size, t.note);
        add(`fw-${k}`, String(t.weight), t.weight);
        if (t.weightStrong) add(`fw-${k}-strong`, String(t.weightStrong), t.weightStrong);
        add(`lh-${k}`, String(t.lineHeight), t.lineHeight);
        if (t.tracking != null) add(`ls-${k}`, `${t.tracking}px`, t.tracking);
      } else if (t.type === 'color') add(k, cssColor(t.value), resolveColor(t.value, flat), t.note);
      else if (t.type === 'px') add(k, `${t.value}px`, t.value, t.note);
      else if (t.type === 'ms') add(k, `${t.value}ms`, t.value, t.note);
      else if (t.type === 'number') add(k, String(t.value), t.value, t.note);
      else if (t.type === 'string') add(k, t.value, t.value, t.note);
      else if (t.type === 'font') add(k, t.stack.join(', '), t.value, t.note);
      else if (t.type === 'shadow' && t.color === 'rarity') {
        for (const r of RARITY_KEYS) {
          const c = src.rarity[r].color;
          add(`${k}-${r}`, shadowCss(t, cssColor(c)), shadowCss(t, resolveColor(c, flat)), r === RARITY_KEYS[0] ? t.note : undefined);
        }
      } else if (t.type === 'shadow') add(k, shadowCss(t, cssColor(t.color)), shadowCss(t, resolveColor(t.color, flat)), t.note);
    }
  }
  return out;
}

const HEADER = 'Generated by shared/build-tokens.mjs from shared/tokens.json. Do not edit: change shared/tokens.json, then run `node shared/build-tokens.mjs`.';

function css(src) {
  const lines = [`/* ${HEADER}`, '   The design tokens of docs/design.md section 4 (approved library UI-00). */', ':root {'];
  for (const t of flatten(src)) lines.push(`  --${t.name}: ${t.css};${t.note ? ` /* ${t.note.replace(/\*\//g, '* /')} */` : ''}`);
  lines.push('}', '');
  return lines.join('\n');
}

/** The JS data: tables for code (canvas, three.js, bot pictures). */
function data(src) {
  const flat = plain(src);
  const TOKENS = Object.fromEntries(flatten(src).map((t) => [t.name, t.value]));
  const row = (o, extra) => Object.fromEntries(Object.entries({ ...o, ...extra }).filter(([k, v]) => k !== 'type' && k !== 'note' && v !== undefined));
  const RARITIES = RARITY_KEYS.map((k) => row(src.rarity[k], { key: k, color: resolveColor(src.rarity[k].color, flat) }));
  const ELEMENTS = Object.fromEntries(ELEMENT_KEYS.map((k) => [k, row(src.element[k])]));
  const EFFECTS = Object.fromEntries(EFFECT_KEYS.map((k) => [k, row(src.effect[k])]));
  const TYPE = Object.fromEntries(TYPE_KEYS.map((k) => [k, row(src.type[k])]));
  const NAME_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => TOKENS[`name-color-${i}`]);
  return { TOKENS, RARITIES, ELEMENTS, EFFECTS, TYPE, NAME_COLORS };
}

function module(src, ts) {
  const d = data(src);
  const asConst = ts ? ' as const' : '';
  const j = (v) => JSON.stringify(v, null, 2);
  return [
    `// ${HEADER}`,
    '// The design tokens of docs/design.md section 4 (approved library UI-00).',
    '',
    '/** Every token by its CSS name (without "--"): colors as hex strings, px / ms / numbers as numbers. */',
    `export const TOKENS = ${j(d.TOKENS)}${asConst};`,
    '',
    '/** The 7 rarities in rank order (4.6, D-01, D-02). rank null = special (Event, Promo). */',
    `export const RARITIES = ${j(d.RARITIES)}${asConst};`,
    '',
    '/** The 14 element colors (4.6): the only source for CSS, canvas and three.js. */',
    `export const ELEMENTS = ${j(d.ELEMENTS)}${asConst};`,
    '',
    '/** The effect kinds (4.6, D-03). */',
    `export const EFFECTS = ${j(d.EFFECTS)}${asConst};`,
    '',
    '/** The 8 type styles (4.7): size px, weight, line-height, tracking px. */',
    `export const TYPE = ${j(d.TYPE)}${asConst};`,
    '',
    '/** The 8 name colors (4.6). */',
    `export const NAME_COLORS = ${j(d.NAME_COLORS)}${asConst};`,
    '',
    '/** A hex color token as a number for three.js (alpha dropped): hexNum(TOKENS.gold). */',
    `export function hexNum(color${ts ? ': string' : ''})${ts ? ': number' : ''} { return parseInt(color.slice(1, 7), 16); }`,
    '',
  ].join('\n');
}

/** Every generated file: { path: text }. */
export function render(src) {
  validate(src);
  const c = css(src);
  return {
    [OUTPUTS.activityCss]: c,
    [OUTPUTS.activityJs]: module(src, false),
    [OUTPUTS.botTs]: module(src, true),
    [OUTPUTS.galleryCss]: c,
  };
}

const lf = (s) => s.replace(/\r\n/g, '\n');

/** The stale or hand-changed outputs: [{ path, reason }]. Line endings do not count (core.autocrlf). */
export function stale(root = ROOT, src = load(root)) {
  const out = [];
  for (const [p, text] of Object.entries(render(src))) {
    const f = join(root, p);
    if (!existsSync(f)) out.push({ path: p, reason: 'missing' });
    else if (lf(readFileSync(f, 'utf8')) !== text) out.push({ path: p, reason: 'differs from shared/tokens.json (stale, or changed by hand)' });
  }
  return out;
}

export function write(root = ROOT) {
  const files = render(load(root));
  for (const [p, text] of Object.entries(files)) writeFileSync(join(root, p), text);
  return Object.keys(files);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--check')) {
      const bad = stale();
      if (bad.length) {
        console.error(`Token check: FAIL\n${bad.map((b) => `- ${b.path}: ${b.reason}`).join('\n')}\nRun: node shared/build-tokens.mjs`);
        process.exit(1);
      }
      console.log(`Token check: PASS (${flatten(load()).length} CSS tokens, ${Object.keys(OUTPUTS).length} generated files current)`);
    } else {
      for (const p of write()) console.log(`wrote ${p}`);
    }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
