import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayIntentBits, Partials } from 'discord.js';
import { clientOptions, joinRows, guildLogOn, membersIntentOn } from './guild-log.js';

test('without the intent flag: the four intents of before, no GuildMembers (Discord would refuse the login)', () => {
  const o = clientOptions(false);
  assert.deepEqual(o.intents, [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent]);
  assert.deepEqual(o.partials, []);
});

test('with the intent flag: GuildMembers and the GuildMember partial (a leave of an uncached member still fires)', () => {
  const o = clientOptions(true);
  assert.ok(o.intents.includes(GatewayIntentBits.GuildMembers));
  assert.deepEqual(o.partials, [Partials.GuildMember]);
});

test('the flags default OFF; the intent needs both flags', () => {
  const keep = { a: process.env.FEATURE_GUILD_LOG, b: process.env.FEATURE_GUILD_MEMBERS_INTENT };
  try {
    delete process.env.FEATURE_GUILD_LOG; delete process.env.FEATURE_GUILD_MEMBERS_INTENT;
    assert.equal(guildLogOn(), false); assert.equal(membersIntentOn(), false);
    assert.equal(clientOptions().intents.includes(GatewayIntentBits.GuildMembers), false);
    process.env.FEATURE_GUILD_MEMBERS_INTENT = '1';
    assert.equal(membersIntentOn(), false, 'the intent alone does nothing');
    process.env.FEATURE_GUILD_LOG = '1';
    assert.equal(membersIntentOn(), true);
  } finally {
    if (keep.a === undefined) delete process.env.FEATURE_GUILD_LOG; else process.env.FEATURE_GUILD_LOG = keep.a;
    if (keep.b === undefined) delete process.env.FEATURE_GUILD_MEMBERS_INTENT; else process.env.FEATURE_GUILD_MEMBERS_INTENT = keep.b;
  }
});

test('joinRows: humans with a join time, as ISO text', () => {
  const at = new Date('2026-09-01T12:00:00Z');
  assert.deepEqual(joinRows([
    { id: '111111111111111111', joinedAt: at, bot: false },
    { id: '222222222222222222', joinedAt: at, bot: true },
    { id: '333333333333333333', joinedAt: null, bot: false },
  ]), [{ id: '111111111111111111', at: '2026-09-01T12:00:00.000Z' }]);
});
