// R2-MOVE G7 (deploy.sh part) mutations: ops/deploy-health.test.sh must FAIL on each.
const T = { cmd: 'bash ops/deploy-health.test.sh', cwd: '.' };
export default {
  baseline: [
    { name: 'deploy-health', ...T },
    { name: 'boss-files (unchanged)', cmd: 'bash ops/boss-files.test.sh', cwd: '.' },
  ],
  mutations: [
    { id: 'm_g7_health_no_img', file: 'ops/deploy.sh', find: String.raw` && curl -fsS http://127.0.0.1:4441/api/config | grep -q "\"img\":\"$M\""`, replace: '', ...T, expect: 'FAIL activity: the .env says r2 but the server runs supabase' },
    { id: 'm_g7_health_no_image', file: 'ops/deploy.sh', find: String.raw` && curl -fsS -o /dev/null -w %{content_type} "http://127.0.0.1:4441/api/img/storage/v1/object/public/card-art/grid/cards/card-back.webp?v=health1" | grep -qx image/webp`, replace: '', ...T, expect: 'FAIL activity: image route fails' },
    { id: 'm_g7_no_standby', file: 'ops/deploy.sh', find: `if [ "\${STANDBY:-}" = 1 ] && ! grep -qE`, replace: 'if false && ! grep -qE', ...T, expect: 'FAIL standby: IMG_UPSTREAM removed' },
    { id: 'm_g7_gallery_no_backurl', file: 'ops/deploy.sh', find: String.raw` && curl -fsS http://127.0.0.1:4331/api/gallery | grep -q "\"backUrl\":\"http"`, replace: '', ...T, expect: 'FAIL gallery no backUrl' },
  ],
};
