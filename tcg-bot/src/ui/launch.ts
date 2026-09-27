import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

// Everything happens in the Activity (Nathan, 2026-09-27). Bot posts carry this
// button, and ui/router.ts answers a click with interaction.launchActivity().

/** customId of the button that opens the Activity. */
export const LAUNCH_ACTIVITY_ID = 'launch:activity';

export function launchActivityRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(LAUNCH_ACTIVITY_ID)
      .setLabel('Open Lion Pride TCG')
      .setEmoji('🎴')
      .setStyle(ButtonStyle.Primary),
  );
}
