import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminAlertText, adminIdsFromEnv, dmAdmins } from './admin-alert.js';

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
