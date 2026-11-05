// S1-FACE B11 (SPEC v2.2 2.6, D-219): the boss models and clips from the game server's disk, behind a flag file.
// The client URLs do not change: /api/img/storage/v1/object/public/card-art/boss/<models|behemoth>/<name> (src/boss-models.js MODEL_BASE,
// src/boss-video.js CARD_ART). server.js asks lookup(path) before the Supabase proxy:
//   - the path is boss/models/<name> or boss/behemoth/<name> (name: letters, digits, . _ -; no "..")
//   - AND the flag file <dir>/ENABLED exists (checked at most every 30 s)
//   - AND the file <dir>/<models|behemoth>/<name> exists
//   => { buf, type }: server.js sends it with Cache-Control immutable and X-Boss-Source: vm. Else null: today's code path.
// Flag OFF (no ENABLED file, or no folder) = today's behavior. ON = `touch /srv/lptcg/boss-files/ENABLED` on the VM (no deploy).
// ops/deploy.sh mounts /srv/lptcg/boss-files read-only at /app/boss-files.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATH_RE = /^storage\/v1\/object\/public\/card-art\/boss\/(models|behemoth)\/([A-Za-z0-9._-]+)$/;
const TYPES = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', webm: 'video/webm', mp4: 'video/mp4', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', json: 'application/json', bin: 'application/octet-stream' };

export function createBossFiles({ dir = process.env.BOSS_FILES_DIR || '/app/boss-files', ttlMs = 30000, now = () => Date.now() } = {}) {
  let flag = false, checkedAt = -Infinity, types = {};
  // types.json (written by B11a from the backup): { "<models|behemoth>/<name>": "<the Content-Type that Supabase served>" }
  const enabled = () => {
    if (now() - checkedAt >= ttlMs) {
      checkedAt = now();
      try { flag = existsSync(join(dir, 'ENABLED')); } catch { flag = false; }
      try { types = flag && existsSync(join(dir, 'types.json')) ? JSON.parse(readFileSync(join(dir, 'types.json'), 'utf8')) : {}; } catch { types = {}; }
    }
    return flag;
  };
  return {
    enabled,
    /** path = the decoded /api/img/ path (no leading slash, no query). */
    lookup(path) {
      const m = PATH_RE.exec(path || '');
      if (!m || m[2].includes('..')) return null;
      if (!enabled()) return null;
      const file = join(dir, m[1], m[2]);
      try {
        if (!statSync(file).isFile()) return null;
        return { buf: readFileSync(file), type: types[`${m[1]}/${m[2]}`] || TYPES[m[2].split('.').pop().toLowerCase()] || 'application/octet-stream' };
      } catch { return null; }
    },
  };
}
