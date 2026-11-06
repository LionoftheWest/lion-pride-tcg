// R2-MOVE G3b: the bot sends no request to the Supabase host when IMG_UPSTREAM is not supabase.
// A fetch stub records each request. art() = R6 (card art), R7 (the boss picture), R8 (the reveal card back: reveal.ts
// fetchImage = art(BACK_IMAGE_URL), read from the real reveal.ts text). publicImg = R5 (embeds through the proxy).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { art } from './playing-posts.js';
import { publicImg } from './img-url.js';

const SUPA = 'https://kgvdqqehefezbypozvrh.supabase.co';
const SUPA_HOST = new URL(SUPA).host;
const PROXY = 'http://127.0.0.1:4441';
const R2_HOST = 'img.lionpridetcg.com';
const CARD = `${SUPA}/storage/v1/object/public/card-art/cards/abc-gold.webp?v=17`;
const BOSS = `${SUPA}/storage/v1/object/public/card-art/boss/thumbs/warrok.png`; // as playing-posts.ts sceneFor builds it
const BACK = (readFileSync(new URL('./ui/reveal.ts', import.meta.url), 'utf8').match(/BACK_IMAGE_URL =\s*'([^']+)'/) || [])[1]!;

const realFetch = globalThis.fetch;
let seen: string[] = [];
function stub(proxyStatus: number) {
  seen = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url);
    const host = new URL(url).host;
    if (url.startsWith(PROXY)) return new Response(proxyStatus === 200 ? 'FROM-PROXY' : null, { status: proxyStatus });
    if (host === R2_HOST) return new Response('FROM-R2', { status: 200 });
    if (host === SUPA_HOST) return new Response('FROM-SUPABASE', { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
const saved = { ...process.env };
beforeEach(() => {
  process.env.SUPABASE_URL = SUPA;
  process.env.ACTIVITY_INTERNAL_URL = PROXY;
  process.env.R2_PUBLIC_BASE = `https://${R2_HOST}`;
  process.env.PUBLIC_IMG_BASE = 'https://lionpridetcg.duckdns.org/app/api/img';
});
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...saved }; });
const supaRequests = () => seen.filter((u) => new URL(u).host === SUPA_HOST);

test('the reveal back URL is read from reveal.ts and is a logical card-art URL', () => {
  assert.match(BACK, /^https:\/\/kgvdqqehefezbypozvrh\.supabase\.co\/storage\/v1\/object\/public\/card-art\//);
});

for (const mode of ['r2', 'r2-first']) {
  test(`case A (${mode}): the proxy answers 200 -> its bytes, 0 Supabase-host requests (card, boss, reveal back)`, async () => {
    process.env.IMG_UPSTREAM = mode;
    stub(200);
    for (const u of [CARD, BOSS, BACK]) assert.equal(String(await art(u)), 'FROM-PROXY');
    assert.equal(seen.length, 3);
    assert.deepEqual(supaRequests(), []);
  });

  test(`case B (${mode}): the proxy answers 502 -> one request to img.lionpridetcg.com/card-art/..., 0 Supabase-host requests`, async () => {
    process.env.IMG_UPSTREAM = mode;
    for (const u of [CARD, BOSS, BACK]) {
      stub(502);
      assert.equal(String(await art(u)), 'FROM-R2', u);
      const r2 = seen.filter((x) => new URL(x).host === R2_HOST);
      assert.equal(r2.length, 1);
      assert.ok(r2[0]!.startsWith(`https://${R2_HOST}/card-art/`), r2[0]);
      assert.deepEqual(supaRequests(), [], u);
    }
    stub(502);
    await art(CARD);
    assert.equal(seen[1], `https://${R2_HOST}/card-art/cards/abc-gold.webp?v=17`, 'the R2 URL keeps the ?v');
  });
}

test('case C (IMG_UPSTREAM=supabase): the behavior of before = the proxy, then the Supabase URL', async () => {
  process.env.IMG_UPSTREAM = 'supabase';
  stub(502);
  assert.equal(String(await art(CARD)), 'FROM-SUPABASE');
  assert.deepEqual(seen, [`${PROXY}/api/img/storage/v1/object/public/card-art/cards/abc-gold.webp?v=17`, CARD]);
});

test('publicImg(BACK) (R8 embed): no request, and the returned URL host = the PUBLIC_IMG_BASE host (the proxy)', () => {
  process.env.IMG_UPSTREAM = 'r2';
  stub(200);
  const u = publicImg(BACK)!;
  assert.equal(new URL(u).host, new URL(process.env.PUBLIC_IMG_BASE!).host);
  assert.notEqual(new URL(u).host, SUPA_HOST);
  assert.equal(seen.length, 0);
});
