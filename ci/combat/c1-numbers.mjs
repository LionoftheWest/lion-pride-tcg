// Combat check 1: no combat number outside `balance` (docs/f3-effect-engine.md section 3, "The three CI checks", item 1). No database.
//   Reads: the fight functions of the live snapshot (db/schema/functions) and of the migrations that the PR adds or changes (tcg-bot/supabase).
//   A fight function is a name that matches one pattern of c1-numbers.json "scope".
//   A number is a numeric literal of the function body, outside comments and strings ("0" and "1" are always allowed: c1-numbers.json "always").
//   A RATCHET with an allowlist: c1-numbers.json "allow" gives, for each function and literal, the count that may stay, and the reason.
//   The check FAILS when
//     - a fight function has a literal more often than the allowlist permits (a new combat number: put it in balance, or allow it with a reason);
//     - an allowlist entry has no reason;
//     - the snapshot has FEWER of a literal than the allowlist (the ratchet: lower the count or remove the entry, so it cannot come back).
//   node ci/combat/c1-numbers.mjs        env: BASE_SHA, HEAD_SHA (defaults: origin/main, HEAD) for the changed migrations
import { pathToFileURL } from 'node:url';
import { stripSqlComments, stripSqlStrings, snapshotFunctions, changedMigrationFunctions, readJson, summary } from './lib.mjs';

/** The numeric literals of one function body: { literal: count }. */
export function literals(body) {
  const code = stripSqlStrings(stripSqlComments(body));
  const out = {};
  for (const m of code.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?(?:e[-+]?\d+)?)(?![\w.])/gi)) out[m[1].toLowerCase()] = (out[m[1].toLowerCase()] || 0) + 1;
  return out;
}

/**
 * The check. snapshot / migrations: [{ name, body, where }]. cfg: c1-numbers.json. Returns { problems: [text], counted: n }.
 */
export function check(snapshot, migrations, cfg) {
  const scope = cfg.scope.map((s) => new RegExp(s));
  const inScope = (n) => scope.some((r) => r.test(n));
  const always = new Set(cfg.always);
  const allow = cfg.allow || {};
  const problems = [];
  for (const [fn, lits] of Object.entries(allow)) {
    for (const [lit, e] of Object.entries(lits)) {
      if (!e || typeof e.reason !== 'string' || e.reason.trim().length < 10) problems.push(`allowlist ${fn} ${lit}: no reason`);
      if (!Number.isInteger(e?.count) || e.count < 1) problems.push(`allowlist ${fn} ${lit}: the count must be a whole number of at least 1`);
    }
  }
  const seen = {};   // the snapshot counts, for the ratchet
  let counted = 0;
  for (const [list, isSnap] of [[snapshot, true], [migrations, false]]) {
    for (const f of list) {
      if (!inScope(f.name)) continue;
      counted += 1;
      const lits = literals(f.body);
      if (isSnap) seen[f.name] = Object.fromEntries(Object.entries(lits).map(([k, v]) => [k, Math.max(v, seen[f.name]?.[k] || 0)]));
      for (const [lit, n] of Object.entries(lits)) {
        if (always.has(lit)) continue;
        const ok = allow[f.name]?.[lit]?.count || 0;
        if (n > ok) problems.push(`${f.where}: ${f.name} has the number ${lit} ${n} time(s), the allowlist permits ${ok}. Put a combat number in balance (balance_num), or allow it in ci/combat/c1-numbers.json with a reason.`);
      }
    }
  }
  for (const [fn, lits] of Object.entries(allow)) {
    for (const [lit, e] of Object.entries(lits)) {
      const n = seen[fn]?.[lit] || 0;
      if (n < (e?.count || 0)) problems.push(`ratchet: the live snapshot has ${fn} ${lit} ${n} time(s), the allowlist permits ${e.count}. Lower the count in ci/combat/c1-numbers.json (remove the entry at 0).`);
    }
  }
  return { problems, counted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = readJson('c1-numbers.json');
  const mig = changedMigrationFunctions();
  const r = check(snapshotFunctions(), mig.functions, cfg);
  summary(`## Combat check 1: no combat number outside balance\n\n${r.counted} fight function texts read (the snapshot and ${mig.files.length} changed migration file(s)).\n`);
  if (r.problems.length) { summary(r.problems.map((p) => `- FAIL ${p}`).join('\n')); process.exit(1); }
  summary('PASS no new combat number, and the allowlist is current.');
}
