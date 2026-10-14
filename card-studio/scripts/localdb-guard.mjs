// The shared LOCALDB guard. A script that reads LOCALDB=1 means "the LOCAL copy". It is local only when the preload (localdb-preload.mjs)
// sends its requests there: without it the token in .env is the LIVE one and the SQL goes to the live project. This file stops the script
// before it does any work. Each script imports it as its first import:   import './localdb-guard.mjs';
// (lab-lib.mjs loads the preload by itself and checks inline; combat-golden.mjs the same.) test-localdb-guard.mjs lists every script that
// reads LOCALDB and fails when one has neither this import nor a named reason.
if (process.env.LOCALDB === '1' && !globalThis.__LOCALDB_API) {
  console.error('localdb-guard: LOCALDB=1 without the localdb preload would use the LIVE project. Run: LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/<this script>.mjs');
  process.exit(2);
}
