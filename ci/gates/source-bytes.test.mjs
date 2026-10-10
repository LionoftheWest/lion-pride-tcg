// No control characters in the text sources. A shell heredoc or echo can turn the two characters "\b" into a
// backspace byte (0x08): a regex word boundary then silently never matches (2026-10-09: the UI-63 owner rule in
// ci/ui-check/screens.mjs, and a dead duplicate line in tcg-activity/src/main.js). Tab, LF and CR are allowed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TEXT = /\.(m?js|cjs|ts|css|html|json|md|sql|ya?ml|sh|py)$/;

test('the tracked text sources have no control characters (only tab, LF, CR)', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => TEXT.test(f));
  const bad = [];
  for (const f of files) {
    let s; try { s = readFileSync(f, 'utf8'); } catch { continue; }
    const i = s.search(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    if (i >= 0) bad.push(`${f}:${s.slice(0, i).split('\n').length} (0x${s.charCodeAt(i).toString(16).padStart(2, '0')})`);
  }
  assert.deepEqual(bad, []);
});
