// The v3 stylesheet that the page loads at /ui3.css: public/ui3.css (the library, the shell and the first screens),
// then every public/ui3/*.css file in name order. A new screen puts its CSS in its own file (public/ui3/90-ui-48.css),
// so two screen PRs do not change the same lines and do not conflict. Used by server.js (served at /ui3.css with a
// content version), the G3 check server (ci/ui-check/serve.mjs) and the token test (ui3.test.js).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** The file names of the parts after ui3.css, in the order they are joined. */
export function ui3PartNames(publicDir) {
  const dir = join(publicDir, 'ui3');
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.css')).sort() : [];
}

/** The joined stylesheet text. */
export function ui3Css(publicDir) {
  return [readFileSync(join(publicDir, 'ui3.css'), 'utf8'),
    ...ui3PartNames(publicDir).map((f) => `\n/* ---- ui3/${f} ---- */\n${readFileSync(join(publicDir, 'ui3', f), 'utf8')}`)].join('');
}
