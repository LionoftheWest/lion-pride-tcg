// R2-MOVE: the mutations of the live checkers G5-G10 (run by card-studio/scripts/r2-mutations.mjs g5-g10).
// Each one breaks one check of a checker, so a negative case of the stub tests passes wrongly -> the test command FAILs.
const CHECKS = { cmd: 'node scripts/test-r2-checks.mjs', cwd: 'card-studio' };
const RETIRE = { cmd: 'node scripts/test-r2-retire.mjs', cwd: 'card-studio' };
const S = 'card-studio/scripts/r2-stats-check.mjs';
const L = 'card-studio/scripts/r2-live-check.mjs';
const P = 'card-studio/scripts/r2-preflight.mjs';
const R = 'card-studio/scripts/r2-retire-supabase.mjs';

export default {
  baseline: [{ name: 'test-r2-checks', ...CHECKS }, { name: 'test-r2-retire', ...RETIRE }],
  mutations: [
    { id: 'm_g5_ignore_fallback_lines', file: S, find: 'if (f) { bad.push(', replace: 'if (false) { bad.push(', ...CHECKS, expect: 'one inserted img-fallback line -> FAIL FAIL' },
    { id: 'm_g5_no_stats_values', file: S, find: 'else if (fb > 0 || er > 0)', replace: 'else if (false)', ...CHECKS, expect: 'edited to fallback=1 -> FAIL FAIL' },
    { id: 'm_g5_no_hours', file: S, find: 'if (hours < minHours) bad.push', replace: 'if (false) bad.push', ...CHECKS, expect: 'cut to 23 h -> FAIL FAIL' },
    { id: 'm_g6_no_source_check', file: L, find: "if (!(src === 'r2' || boss === 'vm'))", replace: 'if (false)', ...CHECKS, expect: 'host in mode supabase -> FAIL (no X-Img-Source: r2) FAIL' },
    { id: 'm_g6_gallery_host', file: L, find: "if (!k || !k.startsWith('card-art/')) { bad.push(", replace: "if (false) { bad.push(", ...CHECKS, expect: 'GALLERY_ART=supabase -> FAIL FAIL' },
    { id: 'm_g6_no_grid', file: L, find: 'if (k && !byKey.has(k)) bad.push', replace: 'if (false) bad.push', ...CHECKS, expect: 'grid key removed from the R2 list -> FAIL FAIL' },
    { id: 'm_g7_no_mode', file: L, find: "if (c.img !== 'supabase') bad.push", replace: 'if (false) bad.push', ...CHECKS, expect: 'every image is a cache hit (no header) -> FAIL FAIL' },
    { id: 'm_g7_no_env_count', file: R, find: "if (c.out.trim() !== '1') bad.push", replace: 'if (false) bad.push', ...CHECKS, expect: 'count 0 -> FAIL FAIL' },
    { id: 'm_g10_no_type', file: P, find: 'if (type !== k.type) {', replace: 'if (false) {', ...CHECKS, expect: 'expected type changed for one key -> FAIL FAIL' },
    { id: 'm_g10_cache_hit', file: P, find: ".toUpperCase() === 'HIT') bad.push", replace: ".toUpperCase() === 'NEVER') bad.push", ...CHECKS, expect: 'second answer HIT) -> FAIL FAIL' },
    { id: 'm_g9_no_host_mode', file: R, find: 'else if (img !== mode) bad.push', replace: 'else if (false) bad.push', ...RETIRE, expect: 'refused: host main not r2 FAIL' },
    { id: 'm_g9_no_old_build', file: R, find: 'if (img === undefined) bad.push', replace: 'if (false) bad.push', ...RETIRE, expect: 'old build (no img field) -> refused FAIL' },
    { id: 'm_g9_no_standby', file: R, find: '"sudo docker ps -a --format', replace: '"sudo docker ps --format', ...RETIRE, expect: 'no IMG_UPSTREAM -> refused FAIL' },
    { id: 'm_g9_no_derived', file: R, find: 'if (!known.has(ip)) throw', replace: 'if (false) throw', ...RETIRE, expect: 'not in --hosts -> refused FAIL' },
    { id: 'm_g9_no_verify', file: R, find: 'if (!/^R2VERIFY PASS/m.test(v)) throw', replace: 'if (false) throw', ...RETIRE, expect: 'no log line (r2-verify FAIL) -> refused FAIL' },
    { id: 'm_g9_stale_plan', file: R, find: '!(now - Date.parse(plan.at) < PLAN_MAX_MS)', replace: 'false', ...RETIRE, expect: 'without a fresh plan -> refused, 0 deletes FAIL' },
  ],
};
