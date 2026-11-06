// R2-MOVE G1: the real R2 signing check (the only one). Bucket lptcg-media-test ONLY, the vault keys (never printed).
//   node scripts/r2-sign-check.mjs
// put / head / get / delete one object card-art/_sign/<ts>.txt: pass = 200, 200, 200, 204, ETag = local MD5, and a PUT
// with a wrong Content-MD5 = 400 (R2 checks it). Stop line: SIGN PASS, else SIGN FAIL <step> (exit 1).
import { createS3, md5hex } from '../src/r2-s3.js';
import { readR2Vault } from '../src/r2-vault.js';

const BUCKET = 'lptcg-media-test'; // fixed: this check never writes the live bucket
const out = [];
const say = (l) => { out.push(l); console.log(l); };
let fail = 0;
const step = (name, ok, detail) => { say(`${name} ${detail} ${ok ? 'OK' : 'BAD'}`); if (!ok) fail += 1; };

async function main() {
  const creds = readR2Vault({ env: { ...process.env, R2_BUCKET: BUCKET } });
  const s3 = await createS3({ creds, bucket: BUCKET });
  const key = `card-art/_sign/${Date.now()}.txt`;
  const body = Buffer.from(`R2-MOVE signing check ${new Date().toISOString()}\n`);
  say(`bucket ${BUCKET} key ${key} md5 ${md5hex(body)}`);
  const p = await s3.put(key, body, { contentType: 'text/plain' });
  step('PUT', p.status === 200 && p.etag === md5hex(body), `status=${p.status} etag=${p.etag}`);
  const h = await s3.head(key);
  step('HEAD', h.status === 200 && h.etag === md5hex(body) && h.size === body.length, `status=${h.status} etag=${h.etag} size=${h.size} type=${h.type}`);
  const g = await s3.get(key);
  step('GET', g.status === 200 && g.buf && md5hex(g.buf) === md5hex(body), `status=${g.status} md5=${g.buf ? md5hex(g.buf) : '-'}`);
  const d = await s3.del(key);
  step('DELETE', d.status === 204, `status=${d.status}`);
  const h2 = await s3.head(key);
  step('HEAD-after-delete', h2.status === 404, `status=${h2.status}`);
  let badStatus = null;
  try {
    await s3.put(`${key}.bad`, body, { contentType: 'text/plain', md5b64: Buffer.alloc(16).toString('base64') });
    badStatus = 200;
  } catch (e) { badStatus = Number((/ (\d{3})$/.exec(e.message) || [])[1]) || e.message; }
  step('PUT-wrong-Content-MD5', badStatus === 400, `status=${badStatus}`);
  if (badStatus === 200) await s3.del(`${key}.bad`);
  say(fail ? `SIGN FAIL failed=${fail}` : 'SIGN PASS');
  return fail ? 1 : 0;
}

process.exitCode = await main().catch((e) => { say(`SIGN FAIL ${e.message}`); return 1; });
