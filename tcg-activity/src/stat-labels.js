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
export const statLabel = (k) => all()[k]?.label ?? (k ? k[0].toUpperCase() + k.slice(1) : '');
/** The chip form (ATK, HP, CRT, SUP, RCH). */
export const statShort = (k) => all()[k]?.short ?? String(k).slice(0, 3).toUpperCase();
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
