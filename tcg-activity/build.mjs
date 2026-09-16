/**
 * Bundle src/main.js + the Discord Embedded App SDK into public/main.<hash>.js.
 * The content hash in the filename means every build gets a NEW url, so Discord's
 * proxy / the webview can never serve a stale bundle. server.js injects the
 * current filename into index.html at request time.
 *
 * Run:  npm run build
 */
import * as esbuild from 'esbuild';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Clear any previous bundle(s) so only the current hash remains.
for (const f of readdirSync('public')) {
  if (/^main\..*\.js$/.test(f)) unlinkSync(join('public', f));
}

await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outdir: 'public',
  entryNames: 'main.[hash]',
  minify: true,
});

const built = readdirSync('public').find((f) => /^main\..*\.js$/.test(f));
console.log('built public/' + built);
