import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicImg } from './img-url.js';

test('a Supabase storage URL goes through the VM cache, with the same path and version', () => {
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  delete process.env.PUBLIC_IMG_BASE;
  assert.equal(publicImg('https://abc.supabase.co/storage/v1/object/public/card-art/cards/x-gold.webp?v=3'),
    'https://lionpridetcg.duckdns.org/app/api/img/storage/v1/object/public/card-art/cards/x-gold.webp?v=3');
});

test('any other URL and an empty value are unchanged', () => {
  process.env.SUPABASE_URL = 'https://abc.supabase.co';
  assert.equal(publicImg('https://cdn.discordapp.com/a.png'), 'https://cdn.discordapp.com/a.png');
  assert.equal(publicImg(null), null);
  assert.equal(publicImg('https://abc.supabase.co.evil.com/x.png'), 'https://abc.supabase.co.evil.com/x.png', 'only the exact host');
});
