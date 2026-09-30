import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntPost } from './hunt-notify.js';
import { LAUNCH_ACTIVITY_ID } from './ui/launch.js';

const closes = '2026-10-05T23:00:00Z';
const EVENTS: { kind: string; payload: Record<string, unknown> }[] = [
  { kind: 'spawn', payload: { name: 'The Salt Kraken', tier: 'Normal', hp: 2768, weak: [{ kind: 'tag', value: 'trait:beast' }], closes_at: closes } },
  { kind: 'nudge', payload: { name: 'The Salt Kraken', hp_remaining: 1200, hp_max: 2768, closes_at: closes } },
  { kind: 'defeat', payload: { name: 'The Salt Kraken', tier: 'Normal', settle: { participants: 3, total_packs: 9 }, top: [{ player_id: '1', damage: 900 }] } },
  { kind: 'expired', payload: { name: 'The Salt Kraken', settle: { participants: 1, total_packs: 2 }, top: [] } },
  { kind: 'player_done', payload: { player_id: '1', total: 1500, cards_used: 4, top_card: 'Baego', top_damage: 600, boss_hp: 1200, boss_hp_max: 2768 } },
];

for (const ev of EVENTS) {
  test(`the ${ev.kind} raid post carries the Open Lion Pride TCG button`, () => {
    const post = huntPost(ev);
    assert.ok(post, 'a known event must produce a post');
    assert.ok(post.content && post.content.length > 0);
    assert.doesNotMatch(post.content, /(^|\s)\/[a-z]+/, 'must not tell members to type a command');
    const rows = (post.components ?? []).map((r) => ('toJSON' in r ? r.toJSON() : r)) as {
      components: { custom_id?: string; label?: string }[];
    }[];
    const buttons = rows.flatMap((r) => r.components);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].custom_id, LAUNCH_ACTIVITY_ID);
    assert.equal(buttons[0].label, 'Open Lion Pride TCG');
  });
}

test('the spawn post names the boss once and shows readable weak points', () => {
  const post = huntPost({ kind: 'spawn', payload: { name: 'The Ban-Wave Demon', tier: 'Mythic', hp: 20000,
    weak: [{ kind: 'tag', value: 'trait:ranged' }, { kind: 'tag', value: 'genre:party-games' }], closes_at: closes } });
  assert.match(post!.content!, /^🦁 \*\*The Ban-Wave Demon has appeared!\*\*/);
  assert.doesNotMatch(post!.content!, /A wild The|trait:|genre:/);
  assert.match(post!.content!, /Weak to \*\*Ranged, Party Games\*\*/);
});

test('an unknown event posts nothing', () => {
  assert.equal(huntPost({ kind: 'nope', payload: {} }), null);
});

test('a single hit never posts: only the end-of-day summary does', () => {
  assert.equal(huntPost({ kind: 'attack', payload: { player_id: '1', damage: 321, card: 'Baego', crit: true, downed: true } }), null);
});
