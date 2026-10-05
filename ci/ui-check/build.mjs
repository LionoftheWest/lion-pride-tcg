// Build the Activity client for the G3 UI check: tcg-activity/src/main.js with the SDK stub, into .out/bundle.
// It never writes into tcg-activity/public, and the shipped build (tcg-activity/build.mjs) does not change.
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', '..', 'tcg-activity');
const out = join(here, '.out', 'bundle');
const esbuild = createRequire(join(app, 'package.json'))('esbuild');
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: [join(app, 'src', 'main.js')],
  bundle: true, format: 'esm', target: 'es2020', outdir: out, entryNames: 'main.[hash]', splitting: true, chunkNames: 'chunk.[hash]',
  alias: { '@discord/embedded-app-sdk': join(here, 'sdk-stub.js') },
  logLevel: 'warning',
});
console.log('built', readdirSync(out).find((f) => /^main\..*\.js$/.test(f)));
