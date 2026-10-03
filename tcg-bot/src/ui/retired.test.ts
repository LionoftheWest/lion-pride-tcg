import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import { isRetiredPanelId, replyRetiredPanel, RETIRED_PANEL_REPLY } from './retired.js';
import { LAUNCH_ACTIVITY_ID } from './launch.js';
import { REVEAL_NEXT } from './reveal.js';

test('every custom id of the old hub, panel and browser is retired', () => {
  for (const id of [
    'hub:open', 'hub:daily', // any legacy hub button
    'panel:open', 'panel:col', 'panel:cat', 'panel:daily', 'panel:showoff', 'panel:home', 'panel:close',
    'br:col:0:all', 'br:cat:12:gold', 'br:showoff:42', // browser buttons
    'brf:col', 'brf:cat', // the rarity select menu
  ]) {
    assert.equal(isRetiredPanelId(id), true, id);
  }
});

test('the live buttons are not retired', () => {
  for (const id of [LAUNCH_ACTIVITY_ID, REVEAL_NEXT, '', 'hub', 'panel', 'brx:1', 'xbr:col', 'launch:activity']) {
    assert.equal(isRetiredPanelId(id), false, id);
  }
});

/** A fake interaction that records the call and can fail like Discord does. */
function fake(state: { replied?: boolean; deferred?: boolean; fail?: boolean }) {
  const calls: { method: string; body: { content: string; flags: number } }[] = [];
  const record = (method: string) => async (body: { content: string; flags: number }) => {
    calls.push({ method, body });
    if (state.fail) throw new Error('Unknown interaction');
  };
  const interaction = {
    replied: state.replied ?? false,
    deferred: state.deferred ?? false,
    reply: record('reply'),
    followUp: record('followUp'),
  } as unknown as MessageComponentInteraction;
  return { interaction, calls };
}

test('the retired reply is private, and a follow-up if the click was already acknowledged', async () => {
  const fresh = fake({});
  await replyRetiredPanel(fresh.interaction);
  assert.deepEqual(fresh.calls, [
    { method: 'reply', body: { content: RETIRED_PANEL_REPLY, flags: MessageFlags.Ephemeral } },
  ]);

  for (const state of [{ replied: true }, { deferred: true }]) {
    const acked = fake(state);
    await replyRetiredPanel(acked.interaction);
    assert.equal(acked.calls.length, 1);
    assert.equal(acked.calls[0]!.method, 'followUp');
    assert.equal(acked.calls[0]!.body.flags, MessageFlags.Ephemeral);
  }
});

test('the retired reply does not throw when Discord rejects it', async () => {
  const failing = fake({ fail: true });
  await assert.doesNotReject(replyRetiredPanel(failing.interaction));
});
