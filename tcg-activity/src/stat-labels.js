// The names of the five stat points as a player reads them (F-3, docs/foundations.md item 9 + 11; f3_stat_labels.sql).
// The words and the one-line explainers live in the balance key `stat_labels` (public balance, /api/flags); the numbers in the
// explainers come from balance `stat_points` ({n} = the percent of that stat). No stat name and no stat number is typed in the screens.
// The stored stat keys (attack, vitality, precision, potency, haste) do not change: only the words that a player reads.
// With no stat_labels in the balance (the migration f3_stat_labels.sql is not applied yet, or the flags call failed) a stat shows its stored key
// with a capital letter (Vitality, Precision, Potency, Haste: the names before the change), so the Activity can go live before the migration.
// No number is ever invented: the explainer text stays empty and the summary line has no numbers.

export const STAT_KEYS = ['attack', 'vitality', 'precision', 'potency', 'haste'];

let bal = null;
/** From main.js, once the flags are read: the public balance of /api/flags. */
export function setStatBalance(b) { bal = b && typeof b === 'object' ? b : null; }

// 0.05 -> '5', 0.035 -> '3.5' (the SQL stat_labels() does the same: no trailing zero)
const pct = (v) => String(+(Number(v) * 100).toFixed(1));

/** { key: { label, short, text } } with {n} filled from stat_points (the same answer as the SQL function stat_labels()). */
export function statLabelsFrom(b) {
  const out = {};
  const L = b?.stat_labels, S = b?.stat_points;
  if (!L || !S) return out;
  for (const k of STAT_KEYS) {
    const l = L[k];
    if (!l || typeof l.label !== 'string' || typeof l.text !== 'string' || S[k] == null) continue;
    out[k] = { label: l.label, short: l.short || l.label, text: l.text.replace('{n}', pct(S[k])) };
  }
  return out;
}

const all = () => statLabelsFrom(bal);
/** The name of a stat (Attack, Health, Crit, Support, Recharge). */
export const statLabel = (k) => (V2_STAT_KEYS.includes(k) ? v2StatLabel(k) : all()[k]?.label ?? (k ? k[0].toUpperCase() + k.slice(1) : ''));
/** The chip form (ATK, HP, CRT, SUP, RCH). */
// The fallback is the chip of before the change (a 3-letter cut of the key was one letter wider: ATT, HAS clipped a caption in WebKit at 412x915).
const OLD_SHORT = { attack: 'ATK', vitality: 'VIT', precision: 'PRE', potency: 'POT', haste: 'HST' };
export const statShort = (k) => (V2_STAT_KEYS.includes(k) ? v2StatShort(k) : all()[k]?.short ?? OLD_SHORT[k] ?? String(k).slice(0, 3).toUpperCase());
/** The one-line explainer, for example "supports are ready sooner (-4% cooldown for each point)". */
export const statText = (k) => all()[k]?.text ?? '';
/** [[key, label], ...] in the stored order: the rows of the stat screens. */
export const statDefs = () => STAT_KEYS.map((k) => [k, statLabel(k)]);
/** "Attack, Health, Crit, Support and Recharge" */
export function statNames() {
  const n = STAT_KEYS.map(statLabel);
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
/** The line of the Stat points explain slide: the stars, then what the three main stats add (all from balance). */
export function statSummary() {
  const S = bal?.stat_points, a = all();
  if (!S || !a.attack || !a.vitality || !a.precision) return 'Each star gives points to this card.';
  return `Each star gives ${S.per_star} points to this card. ${a.attack.label} adds ${pct(S.attack)}% power, ${a.vitality.label} ${pct(S.vitality)}% HP, ${a.precision.label} ${pct(S.precision)}% chance.`;
}

// STAT-V2 (UI-10 review-3, approved 2026-11-06): the 9 combat v2 stats. The keys and order are plan 2.2 (the card_progress_v2 columns).
// The names come from the public balance key stat_labels_v2 (stat_v2.sql); with no key a stat shows its key in capitals. The icons are UI-67 03.
export const V2_STAT_KEYS = ['atk', 'def', 'hp', 'crd', 'crt', 'abl', 'ddg', 'acc', 'spd'];
export const V2_STAT_ICONS = { atk: 'dumbbell', def: 'shield-half', hp: 'heart', crd: 'bomb', crt: 'dices', abl: 'wand-sparkles', ddg: 'footprints', acc: 'crosshair', spd: 'gauge' };
const v2Label = (k) => { const l = bal?.stat_labels_v2?.[k]; return l && typeof l.label === 'string' ? l : null; };
/** The name of a v2 stat (Attack, Defense, ... from stat_labels_v2), or the key in capitals. */
export const v2StatLabel = (k) => v2Label(k)?.label ?? String(k).toUpperCase();
/** The chip form of a v2 stat (ATK, DEF, ...), or the key in capitals. */
export const v2StatShort = (k) => (typeof v2Label(k)?.short === 'string' ? v2Label(k).short : String(k).toUpperCase());
/** [[key, label, icon], ...] in the plan 2.2 order: the 9 rows of the v2 stat screen. */
export const v2StatDefs = () => V2_STAT_KEYS.map((k) => [k, v2StatLabel(k), V2_STAT_ICONS[k]]);
