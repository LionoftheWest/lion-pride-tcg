import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstPackMessage, firstPackPingEnabled } from './first-pack.js';
import { LAUNCH_ACTIVITY_ID } from './ui/launch.js';

test('the first-pack post @mentions the member and opens the Activity, not a command', () => {
  const m = firstPackMessage('123', 3, 25);
  assert.match(m.content ?? '', /<@123>/);
  assert.match(m.content ?? '', /\*\*3 packs\*\*/);
  assert.doesNotMatch(m.content ?? '', /\/[a-z]+/, 'must not tell the member to type a slash command');
  assert.match(firstPackMessage('9', 1, 25).content ?? '', /\*\*1 pack\*\*/); // singular
  // The bonus count is balance daily.chat_bonus_at (25 today): the text is the same as before, and follows the value.
  assert.ok((m.content ?? '').endsWith('You earn a pack each day you post, and a bonus pack at 25 messages.'), m.content);
  assert.match(firstPackMessage('9', 1, 30).content ?? '', /a bonus pack at 30 messages\./);

  const rows = (m.components ?? []).map((r) => ('toJSON' in r ? r.toJSON() : r)) as {
    components: { custom_id?: string; label?: string }[];
  }[];
  const buttons = rows.flatMap((r) => r.components);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].custom_id, LAUNCH_ACTIVITY_ID);
  assert.equal(buttons[0].label, 'Open Lion Pride TCG');
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
