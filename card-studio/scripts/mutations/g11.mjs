// R2-MOVE G11 mutations: planted FAKE values must make the CI scan FAIL; a broken pre-push check must FAIL its tests.
// The fake values are built here from parts, so this file itself holds no value that the scan would match.
const T = { cmd: 'node --test ci/gates/secret-values.test.mjs', cwd: '.' };
const FAKE40 = ['AbCdEfGhIj', 'KlMnOpQrSt', 'UvWxYz0123', '456789AbCd'].join('');
const FAKE64 = '0123456789abcdef'.repeat(4);
export default {
  baseline: [{ name: 'G11 secret-values + r2-secret-check', ...T }],
  mutations: [
    { id: 'm_g11_assign', file: 'card-studio/src/art-store.js', find: "export const BUCKET = 'card-art';", replace: `export const BUCKET = 'card-art';\n// R2_SECRET_ACCESS_KEY=${FAKE40}`, ...T, expect: 'R2 key assignment' },
    { id: 'm_g11_hex64', file: 'card-studio/src/art-store.js', find: "export const BUCKET = 'card-art';", replace: `export const BUCKET = 'card-art';\nconst k = '${FAKE64}';`, ...T, expect: '64-hex' },
    { id: 'm_g11_tmp_left', file: 'card-studio/scripts/r2-secret-check.mjs', find: '  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });', replace: '', ...T, expect: 'the temp patterns file is gone' },
    { id: 'm_g11_no_history', file: 'card-studio/scripts/r2-secret-check.mjs', find: 'const s = gitGrep(patterns, list.slice(i, i + 200));', replace: 'const s = 1;', ...T, expect: 'later removed -> FAIL' },
  ],
};
