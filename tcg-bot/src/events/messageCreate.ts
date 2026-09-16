import type { Message } from 'discord.js';
import { recordMessage } from '../store.js';

/**
 * Count each human message toward the author's daily activity.
 * The bot needs the GuildMessages intent for this event. It does NOT read the
 * message text, so the privileged Message Content intent is not required.
 */
export async function onMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.inGuild()) return;

  try {
    await recordMessage(message.author.id, message.author.username);
  } catch (error) {
    // A failed count must never crash the bot. Log it and move on.
    console.error('Failed to record activity:', error);
  }
}
