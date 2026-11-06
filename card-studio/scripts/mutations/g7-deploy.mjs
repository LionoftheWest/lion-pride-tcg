// R2-MOVE G7 (deploy.sh part) mutations: ops/deploy-health.test.sh must FAIL on each.
const T = { cmd: 'bash ops/deploy-health.test.sh', cwd: '.' };
export default {
  baseline: [
    { name: 'deploy-health', ...T },
    { name: 'boss-files (unchanged)', cmd: 'bash ops/boss-files.test.sh', cwd: '.' },
  ],
  mutations: [
    { id: 'm_g7_health_no_img', file: 'ops/deploy.sh', find: String.raw` && curl -fsS http://127.0.0.1:4441/api/config | grep -q "\"img\":\"$M\""`, replace: '', ...T, expect: 'FAIL activity: the .env says r2 but the server runs supabase' },
    // The image check also exists in HEALTH_PREV (review r2 N1): this find takes the HEALTH copy only (it ends the assignment).
    { id: 'm_g7_health_no_image', file: 'ops/deploy.sh', find: String.raw`"\"img\":\"$M\"" && curl -fsS -o /dev/null -w %{content_type} "http://127.0.0.1:4441/api/img/storage/v1/object/public/card-art/grid/cards/card-back.webp?v=health1" | grep -qx image/webp'`, replace: String.raw`"\"img\":\"$M\""'`, ...T, expect: 'FAIL activity: image route fails' },
    // Review r2 N1: the rollback check loads one image when the img field exists. N2: HEALTH_PREV is cleared before the case.
    { id: 'm_g7_prev_no_image', file: 'ops/deploy.sh', find: String.raw`<<< "$C" && curl -fsS -o /dev/null -w %{content_type} "http://127.0.0.1:4441/api/img/storage/v1/object/public/card-art/grid/cards/card-back.webp?v=health1" | grep -qx image/webp; }; }'`, replace: String.raw`<<< "$C"; }; }'`, ...T, expect: 'FAIL activity rollback: a new build, img = the .env, the image route fails' },
    { id: 'm_g7_prev_from_env', file: 'ops/deploy.sh', find: 'HEALTH_PREV=""  # never taken', replace: ':  # never taken', ...T, expect: 'FAIL deploy.sh: an exported HEALTH_PREV is used' },
    // NO-SERVER P0b: the STANDBY block became the BOT_ENV block (the bot env refusal in the normal path).
    { id: 'm_g7_no_bot_env', file: 'ops/deploy.sh', find: `if [ "$SVC" = bot ] && ! grep -qE`, replace: 'if false && ! grep -qE', ...T, expect: 'FAIL bot env: IMG_UPSTREAM removed' },
    // Review r1 M2: the rollback checks the OLD image with HEALTH_PREV. L4: the end anchor of the IMG_UPSTREAM pattern (now the BOT_ENV block).
    { id: 'm_g7_rollback_uses_new_health', file: 'ops/deploy.sh', find: 'healthy() { local h=$HEALTH_PREV;', replace: 'healthy() { local h=$HEALTH;', ...T, expect: 'FAIL deploy.sh healthy: the rollback uses HEALTH_PREV' },
    { id: 'm_g7_prev_needs_img', file: 'ops/deploy.sh', find: String.raw`{ ! grep -q "\"img\":" <<< "$C" || { M=`, replace: '{ { M=', ...T, expect: 'FAIL activity rollback: an old build (no img field)' },
    { id: 'm_g7_prev_not_sent', file: 'ops/deploy.sh', find: "HEALTH_PREV='$HEALTH_PREV' FORCE=", replace: 'FORCE=', ...T, expect: 'FAIL deploy.sh passes HEALTH_PREV to the VM' },
    { id: 'm_g7_bot_env_no_end_anchor', file: 'ops/deploy.sh', find: "'^IMG_UPSTREAM=(supabase|r2-first|r2)$'", replace: "'^IMG_UPSTREAM=(supabase|r2-first|r2)'", ...T, expect: 'FAIL bot env: IMG_UPSTREAM=r2x' },
    { id: 'm_g7_gallery_no_backurl', file: 'ops/deploy.sh', find: String.raw` && curl -fsS http://127.0.0.1:4331/api/gallery | grep -q "\"backUrl\":\"http"`, replace: '', ...T, expect: 'FAIL gallery no backUrl' },
  ],
};
