import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPackMessage, firstPackPingEnabled } from './first-pack.js';

test('the first-pack message @mentions the member and names /open', () => {
  const m = firstPackMessage('123', 3);
  assert.match(m, /<@123>/);
  assert.match(m, /\/open/);
  assert.match(m, /\*\*3 packs\*\*/);
  assert.match(firstPackMessage('9', 1), /\*\*1 pack\*\*/); // singular
});

test('the flag is off unless it is exactly "1"', () => {
  const before = process.env.FEATURE_FIRST_PACK_PING;
  try {
    for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) {
      if (v === undefined) delete process.env.FEATURE_FIRST_PACK_PING;
      else process.env.FEATURE_FIRST_PACK_PING = v;
      assert.equal(firstPackPingEnabled(), false, `value ${JSON.stringify(v)} must stay off`);
    }
    process.env.FEATURE_FIRST_PACK_PING = '1';
    assert.equal(firstPackPingEnabled(), true);
  } finally {
    if (before === undefined) delete process.env.FEATURE_FIRST_PACK_PING;
    else process.env.FEATURE_FIRST_PACK_PING = before;
  }
});
