import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAlertText, adminIdsFromEnv, dmAdmins, channelAlert, postAdminChannel, resetAdminChannelCache, ADMIN_ALERT_CHANNEL_DEFAULT, type ChannelClient } from './admin-alert.js';

test('the admin ids come from ADMIN_USER_IDS; anything that is not a Discord id is ignored', () => {
  assert.deepEqual(adminIdsFromEnv({ ADMIN_USER_IDS: ' 123456789012345678 , ,abc,98765432109876543\r' }), ['123456789012345678', '98765432109876543']);
  assert.deepEqual(adminIdsFromEnv({}), []);
});

test('the alert text has the ops prefix and stays under the Discord limit', () => {
  assert.equal(adminAlertText('backup FAILED\n'), '**[Lion Pride TCG ops]** backup FAILED');
  assert.ok(adminAlertText('x'.repeat(5000)).length < 2000);
});

test('each admin gets a DM with no mentions; a failed DM does not stop the others', async () => {
  const sent: { id: string; body: { content: string; allowedMentions: unknown } }[] = [];
  const client = {
    users: {
      fetch: async (id: string) => {
        if (id === '222222') throw new Error('Unknown User');
        return { send: async (body: { content: string; allowedMentions: unknown }) => { sent.push({ id, body }); } };
      },
    },
  } as unknown as Parameters<typeof dmAdmins>[0];
  const n = await dmAdmins(client, ['111111', '222222', '333333'], 'backup FAILED @everyone');
  assert.equal(n, 2);
  assert.deepEqual(sent.map((s) => s.id), ['111111', '333333']);
  assert.deepEqual(sent[0].body.allowedMentions, { parse: [] });
  assert.match(sent[0].body.content, /backup FAILED/);
});

// DB-MEM M1: the post in the admin channel (tcg-admin-alerts).
function fakeClient(chans: Array<{ id: string; name: string; guild: string; fail?: boolean }>) {
  const posts: Array<{ id: string; body: { content: string; allowedMentions: unknown } }> = []; let byId = 0; let byList = 0;
  const mk = (c: { id: string; name: string; fail?: boolean }) => ({ id: c.id, name: c.name, isTextBased: () => true,
    send: async (body: { content: string; allowedMentions: unknown }) => { if (c.fail) throw new Error('Missing Access'); posts.push({ id: c.id, body }); } });
  const guilds = [...new Set(chans.map((c) => c.guild))].map((g) => ({ id: g, channels: { fetch: async () => { byList += 1; return new Map(chans.filter((c) => c.guild === g).map((c) => [c.id, mk(c)])); } } }));
  const client = {
    channels: { fetch: async (id: string) => { byId += 1; const c = chans.find((x) => x.id === id); return c ? mk(c) : null; } },
    guilds: { cache: { values: () => guilds.values() } },
  } as unknown as ChannelClient;
  return { client, posts, counts: () => ({ byId, byList }) };
}

test('the channel post: found by the name tcg-admin-alerts (default), no mentions, the ops prefix', async () => {
  resetAdminChannelCache();
  assert.equal(ADMIN_ALERT_CHANNEL_DEFAULT, 'tcg-admin-alerts');
  const f = fakeClient([{ id: '10', name: 'general', guild: 'G' }, { id: '11', name: 'tcg-admin-alerts', guild: 'G' }]);
  assert.equal(await postAdminChannel(f.client, 'DB memory WARN @everyone', { DISCORD_GUILD_ID: 'G' }), true);
  assert.deepEqual(f.posts.map((p) => p.id), ['11']);
  assert.deepEqual(f.posts[0].body.allowedMentions, { parse: [] });
  assert.match(f.posts[0].body.content, /^\*\*\[Lion Pride TCG ops\]\*\* DB memory WARN/);
  await postAdminChannel(f.client, 'second', { DISCORD_GUILD_ID: 'G' });
  assert.equal(f.counts().byList, 1, 'the channel found by name is kept (no second list call)');
});
test('the channel post: ADMIN_ALERT_CHANNEL_ID wins; another guild is not searched; a missing channel returns false', async () => {
  resetAdminChannelCache();
  const f = fakeClient([{ id: '11', name: 'tcg-admin-alerts', guild: 'G' }, { id: '21', name: 'tcg-admin-alerts', guild: 'OTHER' }, { id: '30', name: 'ops', guild: 'G' }]);
  assert.equal(await postAdminChannel(f.client, 'x', { ADMIN_ALERT_CHANNEL_ID: '30' }), true);
  assert.deepEqual(f.posts.map((p) => p.id), ['30']);
  resetAdminChannelCache();
  const g = fakeClient([{ id: '21', name: 'tcg-admin-alerts', guild: 'OTHER' }]);
  assert.equal(await postAdminChannel(g.client, 'x', { DISCORD_GUILD_ID: 'G' }), false);
  assert.equal(g.posts.length, 0);
  resetAdminChannelCache();
  assert.equal(await postAdminChannel(g.client, 'x', { ADMIN_ALERT_CHANNEL_ID: '99', DISCORD_GUILD_ID: 'OTHER' }), false, 'a wrong id does not fall back to a name (the name exists in that guild)');
  assert.equal(g.posts.length, 0);
});
test('the channel post: a refused send returns false and does not throw', async () => {
  resetAdminChannelCache();
  const f = fakeClient([{ id: '11', name: 'tcg-admin-alerts', guild: 'G', fail: true }]);
  assert.equal(await postAdminChannel(f.client, 'x', { DISCORD_GUILD_ID: 'G' }), false);
});
test('the channel post: with no DISCORD_GUILD_ID there is no name search (review L-5)', async () => {
  resetAdminChannelCache();
  const f = fakeClient([{ id: '21', name: 'tcg-admin-alerts', guild: 'OTHER' }]);
  assert.equal(await postAdminChannel(f.client, 'x', {}), false);
  assert.equal(f.posts.length, 0);
  assert.equal(f.counts().byList, 0, 'no guild channel list is read');
});

// review L-4: the answer of /admin-alert to=channel. A 200 with nothing delivered would make the watcher stop retrying.
test('channelAlert: channel OK = 200 channel true; channel failed + DMs = 200 sent n; nothing delivered = 502', async () => {
  const dmCalls: string[] = [];
  const dm = (n: number) => async (m: string) => { dmCalls.push(m); return n; };
  assert.deepEqual(await channelAlert('a', { postChannel: async () => true, dm: dm(3) }), { status: 200, body: { channel: true, sent: 0 } });
  assert.deepEqual(dmCalls, [], 'no DM when the channel took it');
  assert.deepEqual(await channelAlert('b', { postChannel: async () => false, dm: dm(2) }), { status: 200, body: { channel: false, sent: 2 } });
  assert.deepEqual(await channelAlert('c', { postChannel: async () => false, dm: dm(0) }), { status: 502, body: { channel: false, sent: 0 } });
  assert.deepEqual(dmCalls, ['b', 'c'], 'the DM fallback gets the same message');
});
test('internal.ts answers /admin-alert to=channel with the status of channelAlert (the 502 reaches the caller)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./internal.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = src.slice(src.indexOf("if (route === '/admin-alert')"), src.indexOf("if (route === '/announce')"));
  assert.match(block, /if \(body\.to === 'channel'\) \{\s*const r = await channelAlert\(/);
  assert.match(block, /return json\(r\.status, r\.body\);/);
});
