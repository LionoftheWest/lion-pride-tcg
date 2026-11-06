// R2-MOVE G1 mutations (spec 6.2 G1): r2-copy / r2-verify / the S3 client. Each must make test-r2-copy.mjs FAIL.
const cmd = 'node scripts/test-r2-copy.mjs';
const cwd = 'card-studio';
export default {
  baseline: [{ name: 'test-r2-copy', cmd, cwd }],
  mutations: [
    { id: 'm1_skip_md5', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'DIFF card-art/cards/b-gold.webp etag',
      find: 'if (r.buf && md5hex(r.buf) === o.eTag) return { buf: r.buf, src: 2 };', replace: 'if (r.buf) return { buf: r.buf, src: 2 };' },
    { id: 'm2_drop_one', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'missing=1',
      find: 'let objs = await listDbObjects(db);', replace: 'let objs = (await listDbObjects(db)).slice(1);' },
    { id: 'm3_no_type', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'R2VERIFY FAIL missing=0 differ=0 type=6',
      find: 'await putTries(s3, o.key, got.buf, o.mimetype);', replace: 'await putTries(s3, o.key, got.buf, undefined);' },
    { id: 'm4_count_from_r2', file: 'card-studio/scripts/r2-verify.mjs', cmd, cwd, expect: 'TEST verify-sees-missing FAIL',
      find: 'const subject = dbObjs;', replace: 'const subject = dbObjs.filter((o) => r2Keys.has(o.key));' },
    { id: 'm15_delta_skips_existing', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'TEST delta-copies-K FAIL',
      find: 'if (r2.get(o.key) === o.eTag) { skipped += 1; continue; }', replace: 'if (r2.has(o.key)) { skipped += 1; continue; }' },
    { id: 'm16_copy_after_cut', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'TEST post-cut-verify-still-newer FAIL',
      find: 'if (st.cutover) { out(', replace: 'if (false) { out(' },
    { id: 'm17_reverse_missing_only', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'TEST reverse-exact-pass FAIL',
      find: '    const g = await s3.get(key);',
      replace: "    if ((await db.storage.from(BUCKET).list(name.split('/').slice(0, -1).join('/'))).data?.some((f) => f.name === name.split('/').pop())) continue;\n    const g = await s3.get(key);" },
    { id: 'm28_delta_no_delete', file: 'card-studio/scripts/r2-copy.mjs', cmd, cwd, expect: 'TEST delta-del-D FAIL',
      find: '      if (dbKeys.has(k)) continue;', replace: '      if (dbKeys.has(k) || true) continue;' },
    { id: 'm18_no_content_md5', file: 'card-studio/src/r2-s3.js', cmd, cwd, expect: 'TEST corrupt-in-transit-refused FAIL',
      find: "'content-md5': sentMd5 || md5b64(buf), ", replace: '' },
  ],
};
