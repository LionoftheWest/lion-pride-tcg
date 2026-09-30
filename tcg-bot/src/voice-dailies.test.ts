import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleVoiceIds, type VoiceStateLite } from './voice-dailies.js';

const s = (id: string, channelId: string | null, o: Partial<VoiceStateLite> = {}): VoiceStateLite => ({ id, channelId, deaf: false, bot: false, ...o });

test('two people in one channel both earn the minute', () => {
  assert.deepEqual(eligibleVoiceIds([s('a', 'v1'), s('b', 'v1')], null).sort(), ['a', 'b']);
});

test('alone in a channel earns nothing, and a bot does not count as company', () => {
  assert.deepEqual(eligibleVoiceIds([s('a', 'v1'), s('bot', 'v1', { bot: true }), s('c', 'v2')], null), []);
});

test('the AFK channel earns nothing', () => {
  assert.deepEqual(eligibleVoiceIds([s('a', 'afk'), s('b', 'afk')], 'afk'), []);
});

test('a deafened member earns nothing but still counts as company', () => {
  assert.deepEqual(eligibleVoiceIds([s('a', 'v1'), s('b', 'v1', { deaf: true })], null), ['a']);
});

test('a member not in a channel earns nothing', () => {
  assert.deepEqual(eligibleVoiceIds([s('a', null), s('b', 'v1')], null), []);
});
