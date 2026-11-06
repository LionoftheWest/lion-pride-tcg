// R2-MOVE G3a / G3b / G4 mutations. Each must FAIL its test (spec 6.2).
const G4 = { cmd: 'node scripts/test-art-store.mjs', cwd: 'card-studio' };
const G3A = { cmd: 'node --test ci/gates/art-direct.test.mjs', cwd: '.' };
const MT_PUT = "try { await store.put(obj, out, 'image/webp', { cacheControl: '604800' }); }";
export default {
  baseline: [
    { name: 'G4 test-art-store', ...G4 },
    { name: 'G4 the existing tier-delete, card-delete, storage-url tests (unchanged)', cmd: 'node scripts/test-studio-tier-delete.mjs && node scripts/test-studio-card-delete.mjs && node scripts/test-storage-url.mjs', cwd: 'card-studio' },
    { name: 'G3a art-direct', ...G3A },
    { name: 'G3b bot art-fallback', cmd: 'node --import tsx --test src/art-fallback.test.ts', cwd: 'tcg-bot' },
    { name: 'G3b gallery', cmd: 'node scripts/test-gallery-art.mjs', cwd: 'card-studio' },
  ],
  mutations: [
    // G4 (writers)
    { id: 'm12_dual_write', file: 'card-studio/src/art-store.js', find: "    const c = await r2();\n    const key = `${BUCKET}/${name}`;\n    log({ op: 'put'", replace: "    await db.storage.from(BUCKET).upload(name, buf, { contentType, upsert: true });\n    const c = await r2();\n    const key = `${BUCKET}/${name}`;\n    log({ op: 'put'", ...G4, expect: 'TEST r2+CUTOVER: 0 Supabase storage calls (I-2, no dual write) FAIL' },
    { id: 'm13_url_r2_host', file: 'card-studio/src/push.js', find: 'const url = `${publicUrl(db, BUCKET, object)}?v=${Date.now()}`;', replace: 'const url = `https://img.lionpridetcg.com/card-art/${object}?v=${Date.now()}`;', ...G4, expect: 'the row url = the LOGICAL Supabase form with ?v=<ms> (I-4) FAIL' },
    { id: 'm14_no_refuse', file: 'card-studio/scripts/stage-faces.mjs', find: '  if (LIVE) { const a = checkArtState(); if (a) { console.log(a); return 6; } } // R2-MOVE, before any request', replace: '', ...G4, expect: 'W6 stage-faces swap --live with FROZEN: exit 6, the refusal, 0 stub requests FAIL' },
    { id: 'm20_frozen_writes', file: 'card-studio/src/art-store.js', find: 'if (s.frozen && !ownOpen()) throw', replace: 'if (false && s.frozen) throw', ...G4, expect: 'a put with no open logical write = refused, 0 requests FAIL' },
    { id: 'm21_no_log', file: 'card-studio/src/art-store.js', find: "    log({ op: 'put', key, md5: md5hex(buf), bytes: buf.length, type: contentType });", replace: '', ...G4, expect: '3 write-log lines {t, op, key, md5, bytes, type} FAIL' },
    { id: 'm22_marker_ignored', file: 'card-studio/src/art-store.js', find: "const cutRefused = (s, backend) => s.cutover && backend === 'supabase';", replace: 'const cutRefused = () => false;', ...G4, expect: 'CUTOVER + ART_STORE=supabase: refused, 0 Supabase calls, no row FAIL' },
    { id: 'm23_freeze_read_once', file: 'card-studio/src/art-store.js', find: 'const state = () => readStateFn(env);', replace: 'const s0 = readStateFn(env); const state = () => s0;', ...G4, expect: 'N1 freeze read on every call: write, FROZEN, new logical write -> refused, 0 requests FAIL' },
    { id: 'm24_w5_ignores_freeze', file: 'card-studio/scripts/make-thumbs.mjs',
      find: "      await store.withWrite(`make-thumbs ${p}`, async () => {\n        for (const [obj, out] of [[gridObject(p), grid], [revealObject(p), reveal]]) {\n          if (!out) continue;\n          " + MT_PUT,
      replace: "      await (async (f) => f())(async () => {\n        for (const [obj, out] of [[gridObject(p), grid], [revealObject(p), reveal]]) {\n          if (!out) continue;\n          try { const u = await fetch(`${URL}/storage/v1/object/card-art/${obj}`, { method: 'POST', body: out, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'image/webp', 'x-upsert': 'true' } }); if (!u.ok) throw new Error(String(u.status)); }",
      ...G4, expect: 'FROZEN: W5 make-thumbs refused with its label, 0 write requests FAIL' },
    { id: 'm25_cut_mid_push', file: 'card-studio/src/art-store.js', find: 'if (s.frozen && !ownOpen()) throw', replace: 'if (s.frozen) throw', ...G4, expect: 'N2 in flight: FROZEN after the main PUT -> grid, reveal and the row still written, inflight empty after FAIL' },
    // Review r1 M1: ART_STORE=r2 before the cut. L1: the in-flight file before the state read. L3: only the OWN open write.
    { id: 'm34_r2_before_cut', file: 'card-studio/src/art-store.js', find: "const r2Early = (s, backend) => backend === 'r2' && !s.cutover;", replace: 'const r2Early = () => false;', ...G4, expect: 'TEST ART_STORE=r2 without CUTOVER: push, put and remove refused (refused: line), 0 R2 requests, 0 Supabase calls, no log line, no row, inflight empty FAIL' },
    { id: 'm35_state_before_inflight', file: 'card-studio/src/art-store.js', find: '    const backend = backendOf(env);\n    // L1 (review r1)', replace: '    const backend = backendOf(env);\n    if (state().frozen) throw new Error(REFUSED_FROZEN);\n    // L1 (review r1)', ...G4, expect: 'TEST L1: FROZEN written right after the beginWrite state read -> the in-flight file already exists (the S4 wait sees the write) FAIL' },
    { id: 'm36_owner_any_pid', file: 'card-studio/src/art-store.js', find: 'const ownOpen = () => inflightFiles(env, process.pid).length > 0;', replace: 'const ownOpen = () => inflightFiles(env).length > 0;', ...G4, expect: 'TEST L3: FROZEN + an in-flight file of ANOTHER pid + a bare put -> refused, 0 storage calls FAIL' },
    // G3a (static)
    { id: 'm11', file: 'card-studio/gallery-deploy/src/gallery-server.js', find: '  const backUrl = artUrl(BACK);', replace: "  const backUrl = supabase.storage.from('card-art').getPublicUrl('cards/card-back.png').data.publicUrl;", ...G3A, expect: 'ART-DIRECT FAIL card-studio/gallery-deploy/src/gallery-server.js:' },
    { id: 'm11b', file: 'card-studio/src/push.js', find: '    try { await store.put(object, buffer, contentType); }', replace: '    try { await supabase.storage\n      .from(BUCKET).upload(object, buffer, { contentType, upsert: true }); }', ...G3A, expect: 'ART-DIRECT FAIL card-studio/src/push.js:' },
    { id: 'm19', file: 'tcg-activity/src/boss-video.js', find: "const CARD_ART = '/api/img/storage/v1/object/public/card-art';", replace: "const CARD_ART = 'https://img.lionpridetcg.com/card-art';", ...G3A, expect: 'tcg-activity/src/boss-video.js:' },
    { id: 'm27', file: 'card-studio/scripts/make-thumbs.mjs', find: MT_PUT, replace: "try { await fetch(`${URL}/storage/v1/object/card-art/${obj}`, { method: 'POST', body: out }); }", ...G3A, expect: 'ART-DIRECT FAIL card-studio/scripts/make-thumbs.mjs:' },
    // G3b (behavior)
    { id: 'm10', file: 'tcg-bot/src/playing-posts.ts', find: '    return key ? buf(r2Url(key, artVersion(imageUrl), r2PublicBase())) : null;', replace: '    return buf(imageUrl);', cmd: 'node --import tsx --test src/art-fallback.test.ts', cwd: 'tcg-bot', expect: 'case B' },
    { id: 'm10b', file: 'card-studio/gallery-deploy/src/gallery-server.js', find: '  const backUrl = artUrl(BACK);', replace: '  const backUrl = BACK;', cmd: 'node scripts/test-gallery-art.mjs', cwd: 'card-studio', expect: 'TEST public r2: every image_url and backUrl on img.lionpridetcg.com FAIL' },
    { id: 'm10c', file: 'tcg-bot/src/img-url.ts', find: 'return supa && url.startsWith(`${supa}/`) ? `${base()}/${url.slice(supa.length + 1)}` : url;', replace: 'return url;', cmd: 'node --import tsx --test src/art-fallback.test.ts', cwd: 'tcg-bot', expect: 'publicImg' },
  ],
};
