// R2-MOVE: a small S3 client for one R2 bucket (aws4fetch signs each request). Used by art-store.js and the r2-* scripts.
// put = ONE PUT with Content-MD5 (no multipart: the largest object is 7.5 MB); R2 refuses a body whose MD5 differs (400).
// createS3({ creds, endpoint?, bucket?, fetchImpl? }):
//   put(key, buf, { contentType, cacheControl, md5b64? }) -> { status, etag }   (throws on a non-2xx or an ETag that is not the MD5)
//   head(key) -> { status, etag, size, type }      get(key) -> { status, buf, etag, type }
//   del(key) -> { status }                          list(prefix) -> [{ key, etag, size, modified }]
import { createHash } from 'node:crypto';

export const md5hex = (buf) => createHash('md5').update(buf).digest('hex');
const md5b64 = (buf) => createHash('md5').update(buf).digest('base64');
const unq = (etag) => (etag ? String(etag).replace(/^W\//, '').replace(/"/g, '') : null);
const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export async function createS3({ creds, endpoint, bucket, fetchImpl = (r) => fetch(r) }) {
  const { AwsClient } = await import('aws4fetch');
  const aws = new AwsClient({ accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, service: 's3', region: 'auto' });
  const base = String(endpoint || `https://${creds.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '');
  const b = bucket || creds.bucket;
  const url = (key) => `${base}/${b}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
  const send = async (u, init) => fetchImpl(await aws.sign(u, init));

  async function put(key, buf, { contentType = 'application/octet-stream', cacheControl = 'public, max-age=604800', md5b64: sentMd5 } = {}) {
    const md5 = md5hex(buf);
    const r = await send(url(key), {
      method: 'PUT', body: buf,
      headers: { 'content-type': contentType, 'content-md5': sentMd5 || md5b64(buf), 'cache-control': cacheControl },
    });
    if (!r.ok) throw new Error(`R2 PUT ${key} ${r.status}`);
    const etag = unq(r.headers.get('etag'));
    if (etag && etag !== md5) throw new Error(`R2 PUT ${key} etag ${etag} is not the MD5 ${md5}`);
    return { status: r.status, etag: etag || md5 };
  }
  async function head(key) {
    const r = await send(url(key), { method: 'HEAD' });
    return { status: r.status, etag: unq(r.headers.get('etag')), size: Number(r.headers.get('content-length') || 0), type: r.headers.get('content-type') };
  }
  async function get(key) {
    const r = await send(url(key), { method: 'GET' });
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    return { status: r.status, buf, etag: unq(r.headers.get('etag')), type: r.headers.get('content-type') };
  }
  async function del(key) {
    const r = await send(url(key), { method: 'DELETE' });
    if (!r.ok && r.status !== 404) throw new Error(`R2 DELETE ${key} ${r.status}`);
    return { status: r.status };
  }
  async function list(prefix = '') {
    const out = [];
    let token = null;
    do {
      const q = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token) q.set('continuation-token', token);
      const r = await send(`${base}/${b}?${q}`, { method: 'GET' });
      if (!r.ok) throw new Error(`R2 LIST ${prefix} ${r.status}`);
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const f = (t) => (m[1].match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1];
        out.push({ key: xmlText(f('Key') || ''), etag: unq(xmlText(f('ETag') || '')), size: Number(f('Size') || 0), modified: f('LastModified') || null });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText((xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1] || '') : null;
    } while (token);
    return out;
  }
  return { put, head, get, del, list, url };
}
