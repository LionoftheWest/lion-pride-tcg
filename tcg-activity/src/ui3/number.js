// The one number module (docs/design.md 10.5, G-148): the full form "12,345" and the compact form "12.3k", en-US.
const FULL = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtFull = (n) => FULL.format(Number(n) || 0);
/** "12.3k", "123.5M", "1.2B". */
export const fmtCompact = (n) => COMPACT.format(Number(n) || 0).replace('K', 'k');
/** The form for a size class: on the compact classes, 10,000 or more uses the compact form (G-168). */
export const fmtFor = (n, cls) => (/^(compact|tiny)/.test(cls || '') && Math.abs(Number(n) || 0) >= 10000 ? fmtCompact(n) : fmtFull(n));
