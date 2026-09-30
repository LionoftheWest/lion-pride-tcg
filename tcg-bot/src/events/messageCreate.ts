import type { Message } from 'discord.js';
import { recordMessage } from '../store.js';
import { maybeFirstPackPing } from '../first-pack.js';

/**
 * Count each human message toward the author's daily activity.
 * The bot needs the GuildMessages intent for this event. It does NOT read the
 * message text, so the privileged Message Content intent is not required.
 */
export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  try {
    const earned = await recordMessage(message.author.id, message.author.username, message.author.avatar);
    if (earned > 0) await maybeFirstPackPing(message.client, message.author.id);
  } catch (error) {
    // A failed count must never crash the bot. Log it and move on.
    console.error('Failed to record activity:', error);
  }
}
