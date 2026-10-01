import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reusePost, SESSION_REUSE_MS } from './playing-posts.js';

// Nathan, 2026-10-01: a member's second session of the day edited their first post, far up the
// channel. A new session posts again; the same session (and a quick return) edits.
const now = Date.parse('2026-10-01T23:00:00Z');
const ago = (ms: number): string => new Date(now - ms).toISOString();

test('no post yet today: send a new one', () => {
  assert.equal(reusePost(null, false, now), false);
  assert.equal(reusePost({ message_id: null, updated_at: ago(1000) }, true, now), false);
});

test('the same session: edit the post', () => {
  assert.equal(reusePost({ message_id: '1', updated_at: ago(5 * 3600_000) }, false, now), true);
});

test('a new session hours later: a NEW post', () => {
  assert.equal(reusePost({ message_id: '1', updated_at: ago(3 * 3600_000) }, true, now), false);
});

test('a new session within 10 minutes (a bot restart, a quick return): edit', () => {
  assert.equal(reusePost({ message_id: '1', updated_at: ago(SESSION_REUSE_MS - 1000) }, true, now), true);
  assert.equal(reusePost({ message_id: '1', updated_at: ago(SESSION_REUSE_MS + 1000) }, true, now), false);
});
