// R2-MOVE G2 mutations (the proxy modes): tcg-activity/img-route-r2.test.js must FAIL on each.
const T = { cmd: 'node --test img-route-r2.test.js', cwd: 'tcg-activity' };
export default {
  baseline: [
    { name: 'img-route-r2 + img-route + img-cache + art-url', cmd: 'node --test img-route-r2.test.js img-route.test.js img-cache.test.js art-url.test.js', cwd: 'tcg-activity' },
  ],
  mutations: [
    { id: 'm5_key_is_fetch_url', file: 'tcg-activity/img-route.js', find: 'await imgCache.get(url, {', replace: "await imgCache.get(mode === 'supabase' ? url : r2Url(key, v, r2Base), {", ...T, expect: 'warm cache' },
    { id: 'm6_no_fallback', file: 'tcg-activity/img-route.js', find: "if (mode === 'r2') { r.imgSource = 'r2'; return r; }", replace: "{ r.imgSource = 'r2'; return r; }", ...T, expect: 'R2 404 -> Supabase' },
    { id: 'm6b_fallback_404_only', file: 'tcg-activity/img-route.js', find: "status = r.status;\n      if (mode === 'r2')", replace: "status = r.status;\n      if (mode === 'r2' || status !== 404)", ...T, expect: 'R2 403 -> Supabase' },
    { id: 'm7_fallback_in_r2', file: 'tcg-activity/img-route.js', find: "if (mode === 'r2') { r.imgSource = 'r2'; return r; }", replace: "if (false) { r.imgSource = 'r2'; return r; }", ...T, expect: '0 Supabase calls' },
    { id: 'm8_wrong_prefix', file: 'tcg-activity/art-url.js', find: '/${key}${v ?', replace: "/${key.replace('card-art/', '')}${v ?", cmd: 'node --test img-route-r2.test.js art-url.test.js', cwd: 'tcg-activity', expect: 'the R2 URL' },
    { id: 'm9_unset_is_supabase', file: 'tcg-activity/img-route.js', find: "if (!mode) throw new Error('refused: IMG_UPSTREAM unset (supabase | r2-first | r2)');", replace: "if (!mode) return { mode: 'supabase', r2Base: '' };", ...T, expect: 'refused (exit 1)' },
    { id: 'm26_fallback_line_hourly_only', file: 'tcg-activity/img-route.js', find: 'log(`img-fallback ${key} ${status} mode=${mode}`);', replace: '/* counted only for the hourly line */', ...T, expect: 'stop test' },
  ],
};
