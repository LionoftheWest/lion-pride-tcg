// Combat check 2: no effect-name comparison outside combat_effect* (docs/f3-effect-engine.md section 3, "The three CI checks", item 2; traps 12, 13).
// No database.
//   Reads: every function of the live snapshot (db/schema/functions) and of the migrations that the PR adds or changes (tcg-bot/supabase). The old
//   migration files keep their old branches and are not read (trap 13).
//   A comparison: an operand that names an ability effect (a name that contains "eff": v_eff, p_aeff, r.eff, a.effect; or ->>'effect') compared
//   with the name of an ability kind (c2-effect-names.json "effects": the keys of ability_kinds) by =, <>, !=, IS [NOT] DISTINCT FROM, [NOT] IN (...)
//   or CASE <operand> WHEN '<name>'. The engine reads the kinds as data (ability_kinds); a branch on the name outside it is the old code.
//   Boons and pranks (play_card_effect, effect_primitives) compare a PRIMITIVE (v_prim.primitive = 'cleanse'): not an ability effect, not flagged (trap 12).
//   Not flagged: the functions whose name starts with combat_effect (the engine), and c2-effect-names.json "allow" (a function with its count and reason).
//   The check FAILS on a comparison above the allowlist, on an entry with no reason, and on an entry above the live count (the ratchet).
//   node ci/combat/c2-effect-names.mjs        env: BASE_SHA, HEAD_SHA (defaults: origin/main, HEAD) for the changed migrations
import { pathToFileURL } from 'node:url';
import { stripSqlComments, snapshotFunctions, changedMigrationFunctions, readJson, summary } from './lib.mjs';

const OPERAND = String.raw`(?:\b[a-z_][a-z0-9_]*\.)?\b[a-z0-9_]*eff[a-z0-9_]*\b|->>?\s*'effect'\s*\)?`;

/** The effect-name comparisons of one body: [text]. */
export function comparisons(body, effects) {
  const code = stripSqlComments(body).replace(/\s+/g, ' ');
  const names = effects.map((e) => e.replace(/[^a-z0-9_]/g, '')).join('|');
  const lit = String.raw`'(?:${names})'`;
  const res = [
    new RegExp(String.raw`(?:${OPERAND})\s*(?:=|<>|!=|\bis\s+(?:not\s+)?distinct\s+from)\s*${lit}`, 'gi'),
    new RegExp(String.raw`${lit}\s*(?:=|<>|!=|\bis\s+(?:not\s+)?distinct\s+from)\s*(?:${OPERAND})`, 'gi'),
    new RegExp(String.raw`(?:${OPERAND})\s+(?:not\s+)?in\s*\([^)]*${lit}[^)]*\)`, 'gi'),
    new RegExp(String.raw`(?:${OPERAND})\s*=\s*any\s*\(\s*(?:array\s*)?\[?[^)]*${lit}`, 'gi'),
    new RegExp(String.raw`\bcase\s+(?:${OPERAND})\s+when\s+${lit}`, 'gi'),
  ];
  const out = [];
  for (const re of res) for (const m of code.matchAll(re)) out.push(m[0].slice(0, 120));
  return out;
}

/** The check. snapshot / migrations: [{ name, body, where }]. cfg: c2-effect-names.json. Returns { problems, counted }. */
export function check(snapshot, migrations, cfg) {
  const allow = cfg.allow || {};
  const engine = new RegExp(cfg.engine);
  const problems = [];
  for (const [fn, e] of Object.entries(allow)) {
    if (!e || typeof e.reason !== 'string' || e.reason.trim().length < 10) problems.push(`allowlist ${fn}: no reason`);
    if (!Number.isInteger(e?.count) || e.count < 1) problems.push(`allowlist ${fn}: the count must be a whole number of at least 1`);
  }
  const seen = {};
  let counted = 0;
  for (const [list, isSnap] of [[snapshot, true], [migrations, false]]) {
    for (const f of list) {
      if (engine.test(f.name)) continue;
      counted += 1;
      const hits = comparisons(f.body, cfg.effects);
      if (isSnap) seen[f.name] = Math.max(seen[f.name] || 0, hits.length);
      const ok = allow[f.name]?.count || 0;
      if (hits.length > ok) problems.push(`${f.where}: ${f.name} compares an ability effect by its name ${hits.length} time(s), the allowlist permits ${ok}: ${hits.slice(0, 3).join(' | ')}. Put the rule in ability_kinds / combat_effect (data), or allow it in ci/combat/c2-effect-names.json with a reason.`);
    }
  }
  for (const [fn, e] of Object.entries(allow)) {
    if ((seen[fn] || 0) < (e?.count || 0)) problems.push(`ratchet: the live snapshot has ${seen[fn] || 0} effect-name comparison(s) in ${fn}, the allowlist permits ${e.count}. Lower the count in ci/combat/c2-effect-names.json (remove the entry at 0).`);
  }
  return { problems, counted };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = readJson('c2-effect-names.json');
  const mig = changedMigrationFunctions();
  const r = check(snapshotFunctions(), mig.functions, cfg);
  summary(`## Combat check 2: no effect-name comparison outside combat_effect*\n\n${r.counted} function texts read (the snapshot and ${mig.files.length} changed migration file(s)).\n`);
  if (r.problems.length) { summary(r.problems.map((p) => `- FAIL ${p}`).join('\n')); process.exit(1); }
  summary('PASS no effect-name comparison outside the engine, and the allowlist is current.');
}
