import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { photobomber, postRarePulls, pullDeps, pullPostText } from './pull-posts.js';
import { fakeStore } from './fakes.test.js';

// Pull Photobomb (SPEC-outside-effects.md): a rare pull post within 10 minutes after a photobomb
// was used up on that member names the sender.
const MIN = 60_000;
const iso = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();
const bomb = (player: string, msAgo: number | null, primitive = 'photobomb') =>
  ({ id: Math.random(), player_id: player, primitive, consumed_at: msAgo == null ? null : iso(msAgo), options: { sender_id: 'S1' } });
const tables = (effects: Record<string, unknown>[]) => ({ players: [{ id: 'S1', username: 'Ash' }, { id: 'T1', username: 'Misty', avatar: null }], player_effects: effects });
const gold = [[{ name: 'Mewtwo', rarity: 'gold', image_url: null }, { name: 'Pidgey', rarity: 'common', image_url: null }]];

const real = { ...pullDeps };
afterEach(() => { Object.assign(pullDeps, real); });

describe('pull photobomb', () => {
  it('finds the sender of a photobomb used up in the last 10 minutes only', async () => {
    const now = Date.now();
    assert.equal(await photobomber(fakeStore(tables([bomb('T1', 3 * MIN)])), 'T1', now), 'Ash');
    assert.equal(await photobomber(fakeStore(tables([bomb('T1', 11 * MIN)])), 'T1', now), null);  // too old
    assert.equal(await photobomber(fakeStore(tables([bomb('T1', null)])), 'T1', now), null);       // not used up yet
    assert.equal(await photobomber(fakeStore(tables([bomb('T2', 1 * MIN)])), 'T1', now), null);    // another member
    assert.equal(await photobomber(fakeStore(tables([bomb('T1', 1 * MIN, 'jinx')])), 'T1', now), null);
  });
  it('adds the line to the post text only when there is a photobomber', () => {
    const cards = [{ name: 'Mewtwo', rarity: 'gold', image_url: null }];
    assert.match(pullPostText('T1', cards, 'Ash'), /\n📸 photobombed by Ash$/);
    assert.doesNotMatch(pullPostText('T1', cards), /📸/);
  });
  it('the rare pull post carries the line (within 10 min), and a plain open asks nothing extra', async () => {
    const prev = process.env.FEATURE_PULL_POSTS;
    process.env.FEATURE_PULL_POSTS = '1';
    try {
      const sent: { content?: string }[] = [];
      pullDeps.announce = (async (_c: unknown, m: { content?: string }) => { sent.push(m); return true; }) as never;
      const sb = fakeStore(tables([bomb('T1', 2 * MIN)]));
      pullDeps.store = () => sb as never;
      assert.equal(await postRarePulls({} as never, 'T1', 'Misty', gold), true);
      assert.match(String(sent[0]?.content), /📸 photobombed by Ash/);
      const old = fakeStore(tables([bomb('T1', 11 * MIN)]));
      pullDeps.store = () => old as never;
      await postRarePulls({} as never, 'T1', 'Misty', gold);
      assert.doesNotMatch(String(sent[1]?.content), /📸/);
      assert.equal(old.log.filter((l) => l.startsWith('player_effects')).length, 1); // one small query
      const plain = fakeStore(tables([bomb('T1', 2 * MIN)]));
      pullDeps.store = () => plain as never;
      assert.equal(await postRarePulls({} as never, 'T1', 'Misty', [[{ name: 'Pidgey', rarity: 'common', image_url: null }]]), false);
      assert.equal(plain.log.length, 0); // no rare card: no query at all
    } finally {
      if (prev === undefined) delete process.env.FEATURE_PULL_POSTS; else process.env.FEATURE_PULL_POSTS = prev;
    }
  });
});
