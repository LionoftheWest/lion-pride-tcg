import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allowPing, mentionIds } from './ping-prefs.js';

describe('ping settings (the bell > Settings in the Activity)', () => {
  it('finds each mentioned member once, in both mention forms', () => {
    assert.deepEqual(mentionIds('🎁 <@123456> — <@!789012> sent <@123456> a gift, not <@&55555> (a role)'), ['123456', '789012']);
    assert.deepEqual(mentionIds('no mentions here'), []);
  });
  it('pings by default: no settings, or a kind not set', () => {
    assert.equal(allowPing(null, 'plays'), true);
    assert.equal(allowPing({}, 'raid'), true);
    assert.equal(allowPing({ trades: false }, 'raid'), true);
  });
  it('a muted kind is silent, and Mute all silences every kind', () => {
    assert.equal(allowPing({ plays: false }, 'plays'), false);
    assert.equal(allowPing({ all: false }, 'packs'), false);
    assert.equal(allowPing({ all: false, raid: true }, 'raid'), false);
    assert.equal(allowPing({ all: true, raid: false }, 'raid'), false);
  });
});
