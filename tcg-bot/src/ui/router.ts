import type { MessageComponentInteraction } from 'discord.js';
import { REVEAL_NEXT, revealNext } from './reveal.js';
import { LAUNCH_ACTIVITY_ID } from './launch.js';
import { isRetiredPanelId, replyRetiredPanel } from './retired.js';

/**
 * Route every button and select-menu interaction.
 * The old /hub panel is retired (ui/retired.ts): the Activity is the way to play.
 */
export async function handleComponent(
  interaction: MessageComponentInteraction,
): Promise<void> {
  const id = interaction.customId;

  // "Open Lion Pride TCG" button on a bot post: open the Activity for whoever clicked.
  if (id === LAUNCH_ACTIVITY_ID) {
    await interaction.launchActivity();
    return;
  }

  // Flip the next card in a manual reveal (/open and /testpack).
  if (id === REVEAL_NEXT) {
    await revealNext(interaction, interaction.user.id);
    return;
  }

  // A button or select menu on an old hub / panel / browser message.
  if (isRetiredPanelId(id)) {
    await replyRetiredPanel(interaction);
    return;
  }
}
