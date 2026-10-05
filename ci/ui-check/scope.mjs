// Does this PR run the G3 matrix? Yes when it changes a file in the UI scope (ci/gates/scope.json), the UI
// check itself, the register, or the workflow. Prints "run=true" or "run=false" (for $GITHUB_OUTPUT).
import { isUiFile, git, range } from '../gates/lib.mjs';
const { base, head } = range();
const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
const own = (p) => p.startsWith('ci/ui-check/') || p === 'docs/ui-register.md' || p === '.github/workflows/ui-gates.yml';
const hits = changed.filter((p) => isUiFile(p) || own(p));
console.error(hits.length ? `G3 runs: ${hits.length} file(s), first ${hits[0]}` : 'G3 does not run: no UI file changed');
console.log(`run=${hits.length > 0}`);
