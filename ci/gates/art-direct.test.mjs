// R2-MOVE G3a: the storage API of the card art is called only where allowed (spec 6.2 G3a), and the R2 domain never
// reaches the Activity client (I-8). node --test ci/gates/art-direct.test.mjs
// - Scope: every tracked .js/.mjs/.ts file (not test-*, not *.test.*) of tcg-activity/ (incl. scripts/ and src/),
//   tcg-bot/src/, card-studio/src/, card-studio/public/, card-studio/gallery-deploy/, card-studio/scripts/.
// - Each file is ONE string (a call split over lines is still found). Patterns, case-insensitive: .storage.from(,
//   getPublicUrl(, and the raw REST object API that is not a public read: /storage/v1/object/(?!public/).
// - The LOGICAL URL string (/storage/v1/object/public/card-art/...) is allowed everywhere (it is a name, I-4).
// - `--ref <commit>` scans that commit instead of the working tree (the base list below is the 14f533ea scan).
//   node ci/gates/art-direct.test.mjs --print [--ref <commit>]   prints ART-DIRECT FAIL <file>:<line> for each hit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPES = ['tcg-activity/', 'tcg-bot/src/', 'card-studio/src/', 'card-studio/public/', 'card-studio/gallery-deploy/', 'card-studio/scripts/'];
const PATTERNS = [/\.storage\s*\.from\s*\(/gi, /getPublicUrl\s*\(/gi, /\/storage\/v1\/object\/(?!public\/)/gi];

// The allow list: each file with its reason (the Reviewer checks it).
export const ALLOW = {
  'card-studio/src/art-store.js': 'THE one store module of the card art (Supabase backend)',
  'card-studio/src/storage-url.js': 'the logical URL of an upload (getPublicUrl; local or live base)',
  'tcg-activity/reports.js': 'bucket report-shots (out of scope)',
  'card-studio/src/admin-player-reports.js': 'bucket report-shots (out of scope)',
  'card-studio/scripts/stage-faces.mjs': 'W6: Supabase only, refused under FROZEN / CUTOVER / ART_STORE!=supabase (G4)',
  'card-studio/scripts/stage-guard.mjs': 'W6 write guard (it names the storage API to block it)',
  'card-studio/scripts/stage-stub.mjs': 'W6 test server',
  'card-studio/scripts/boss-check.mjs': 'read-only check of the Supabase boss copy; retired at S7',
  'card-studio/scripts/r2-copy.mjs': 'the move tool itself (Supabase <-> R2)',
  'card-studio/scripts/r2-lib.mjs': 'the move tools: the storage.objects list (eTag, size, type) of r2-copy and r2-verify',
  'card-studio/scripts/r2-retire-supabase.mjs': 'the move tool itself (the S7 delete)',
};
const ALLOW_DIRS = { 'card-studio/scripts/mutations/': 'the mutation texts of the gate runner (r2-mutations.mjs), not code that runs' };
// The hits of the base 14f533ea outside the allow list (the reviewer's 14 + the script folders). The PR head must have none.
export const BASE_REF = '14f533ea';
export const BASE_HITS = [
  'card-studio/gallery-deploy/src/gallery-server.js:56',
  'card-studio/scripts/make-thumbs.mjs:27', 'card-studio/scripts/make-thumbs.mjs:51',
  'card-studio/src/gallery-server.js:51',
  'card-studio/src/push.js:165', 'card-studio/src/push.js:173',
  'card-studio/src/sets-routes.js:105',
  'card-studio/src/tier-delete.js:58',
  'card-studio/src/upload-back.js:20', 'card-studio/src/upload-back.js:25',
  'tcg-activity/scripts/upload-boss-clips.mjs:28',
  'tcg-activity/scripts/upload-boss-thumbs.mjs:10',
  'tcg-bot/src/upload-anim.ts:28', 'tcg-bot/src/upload-anim.ts:33',
];

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const inScope = (f) => /\.(m?js|ts)$/.test(f) && SCOPES.some((s) => f.startsWith(s)) && !/(^|\/)test-[^/]*$/.test(f) && !/\.test\.[^/]+$/.test(f) && !f.includes('/node_modules/');

/** Every hit outside the allow list: ['file:line', ...]. ref = null: the working tree. */
export function scan(ref = null) {
  const files = (ref ? git('ls-tree', '-r', '--name-only', ref) : git('ls-files', '--cached', '--others', '--exclude-standard')).split('\n').filter(inScope);
  const hits = [];
  for (const f of files) {
    if (ALLOW[f] || Object.keys(ALLOW_DIRS).some((d) => f.startsWith(d))) continue;
    let text;
    try { text = ref ? git('show', `${ref}:${f}`) : readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    const lines = new Set();
    for (const re of PATTERNS) {
      for (const m of text.matchAll(re)) lines.add(text.slice(0, m.index).split('\n').length);
    }
    for (const l of [...lines].sort((a, b) => a - b)) hits.push(`${f}:${l}`);
  }
  return { files: files.length, hits };
}

/** I-8: the R2 domain and its env name never appear in the Activity client code. */
export function scanI8() {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n')
    .filter((f) => (f.startsWith('tcg-activity/src/') || f.startsWith('tcg-activity/public/')) && /\.(m?js|ts|html|css|json)$/.test(f));
  const hits = [];
  for (const f of files) {
    let text; try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
    text.split('\n').forEach((l, i) => { if (/img\.lionpridetcg\.com|R2_PUBLIC_BASE/.test(l)) hits.push(`${f}:${i + 1}`); });
  }
  return hits;
}

if (process.argv.includes('--print')) {
  const i = process.argv.indexOf('--ref');
  const r = scan(i > 0 ? process.argv[i + 1] : null);
  for (const h of r.hits) console.log(`ART-DIRECT FAIL ${h}`);
  console.log(`files scanned ${r.files}, hits ${r.hits.length}`);
} else {
  test('G3a: no storage API call of the card art outside the allow list (the PR tree)', () => {
    const r = scan();
    assert.ok(r.files > 250, `scanned ${r.files} files`);
    assert.deepEqual(r.hits.map((h) => `ART-DIRECT FAIL ${h}`), []);
  });

  test('G3a: on the base 14f533ea the same scan names exactly the known direct calls', (t) => {
    try { git('cat-file', '-e', `${BASE_REF}^{commit}`); } catch { t.skip(`${BASE_REF} is not in this clone (CI: fetch-depth 0)`); return; }
    assert.deepEqual(scan(BASE_REF).hits, BASE_HITS);
  });

  test('G3a: the patterns find a call split over lines, in any case', () => {
    const text = 'x\nconst a = supabase.STORAGE\n   .From (BUCKET).upload(o)\nb.getPublicURL( o )\nfetch(`${U}/storage/v1/object/card-art/${o}`)\nfetch(`${U}/storage/v1/object/public/card-art/${o}`)';
    const lines = new Set();
    for (const re of PATTERNS) for (const m of text.matchAll(re)) lines.add(text.slice(0, m.index).split('\n').length);
    assert.deepEqual([...lines].sort(), [2, 4, 5]);
  });

  test('I-8: no img.lionpridetcg.com or R2_PUBLIC_BASE in tcg-activity/src or tcg-activity/public', () => {
    assert.deepEqual(scanI8(), []);
  });
}
