import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectPost, effectPostsEnabled, type PlayRow } from './effect-notify.js';
import { LAUNCH_ACTIVITY_ID } from './ui/launch.js';

const base: PlayRow = {
  id: 1, player_id: '10', target_id: '20', aimed_at: '20', kind: 'prank', outcome: 'applied',
  sender: 'Keeb', card: 'Ketchup on Hotdogs', effect_name: 'Condiment Crime', effect_desc: 'A title for 24 hours.',
};
const buttons = (p: ReturnType<typeof effectPost>) =>
  (p.components ?? []).map((r) => ('toJSON' in r ? r.toJSON() : r) as { components: { custom_id?: string }[] })
    .flatMap((r) => r.components);

test('an applied play @mentions the target and names the sender, card, and effect', () => {
  const p = effectPost(base);
  assert.match(p.content ?? '', /<@20>/);
  assert.match(p.content ?? '', /\*\*Keeb\*\*/);
  assert.match(p.content ?? '', /\*\*Ketchup on Hotdogs\*\*/);
  assert.match(p.content ?? '', /\*\*Condiment Crime\*\*/);
  assert.doesNotMatch(p.content ?? '', /<@10>/, 'the sender is not pinged');
});

test('a reflected play says it bounced back to the sender', () => {
  const p = effectPost({ ...base, outcome: 'reflected', target_id: '10' });
  assert.match(p.content ?? '', /bounced back/);
  assert.match(p.content ?? '', /<@20>/, 'the member it was aimed at');
});

test('a blocked play says it was blocked', () => {
  assert.match(effectPost({ ...base, outcome: 'blocked' }).content ?? '', /blocked/);
});

test('every play post carries exactly the Open Lion Pride TCG button', () => {
  for (const outcome of ['applied', 'blocked', 'reflected']) {
    const b = buttons(effectPost({ ...base, outcome }));
    assert.equal(b.length, 1);
    assert.equal(b[0].custom_id, LAUNCH_ACTIVITY_ID);
  }
});

test('the post poller is off unless FEATURE_CARD_EFFECT_POSTS is exactly "1"', () => {
  const before = process.env.FEATURE_CARD_EFFECT_POSTS;
  try {
    for (const v of [undefined, '', '0', 'true']) {
      if (v === undefined) delete process.env.FEATURE_CARD_EFFECT_POSTS; else process.env.FEATURE_CARD_EFFECT_POSTS = v;
      assert.equal(effectPostsEnabled(), false);
    }
    process.env.FEATURE_CARD_EFFECT_POSTS = '1';
    assert.equal(effectPostsEnabled(), true);
  } finally {
    if (before === undefined) delete process.env.FEATURE_CARD_EFFECT_POSTS; else process.env.FEATURE_CARD_EFFECT_POSTS = before;
  }
});
