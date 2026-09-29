import type { Client, MessageCreateOptions } from 'discord.js';
import { announce } from './internal.js';
import { claimFirstPackPing, getPackBalance, releaseFirstPackPing } from './store.js';
import { launchActivityRow } from './ui/launch.js';

// One public @mention per member, ever, the next time they earn a pack. The bell
// alone never reached them: 26 members read 0 of 138 notifications (2026-09-27).
// Everything happens in the Activity (Nathan, 2026-09-27), so the post carries a
// button that opens the Activity. It never tells the member to type a command.
// Flag: default OFF, and any value other than '1' keeps it off.
export const firstPackPingEnabled = (): boolean => process.env.FEATURE_FIRST_PACK_PING === '1';

export function firstPackMessage(playerId: string, balance: number): MessageCreateOptions {
  const packs = `${balance} pack${balance === 1 ? '' : 's'}`;
  return {
    content:
      `🎁 <@${playerId}> you earned a Lion Pride TCG pack! You have **${packs}** waiting. ` +
      'Press **Open Lion Pride TCG** to open them. You earn a pack each day you post, ' +
      'and a bonus pack at 25 messages.',
    components: [launchActivityRow()],
  };
}

/** Post the first-pack @mention if this member never got one. Returns true if posted. */
export async function maybeFirstPackPing(client: Client, playerId: string): Promise<boolean> {
  if (!firstPackPingEnabled()) return false;
  if (!(await claimFirstPackPing(playerId))) return false;
  const balance = await getPackBalance(playerId);
  if (await announce(client, firstPackMessage(playerId, balance), 'packs')) return true;
  // The post failed (no channel or no permission): free the claim so a later earn retries.
  await releaseFirstPackPing(playerId);
  return false;
}
