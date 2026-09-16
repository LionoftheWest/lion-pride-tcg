import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

// The public hub has ONE button. Pressing it opens a private panel that then
// updates itself in place. The router treats any "hub:" id as "open the panel".
export const HUB_OPEN = 'hub:open';

/** Build the pinned public hub message. */
export function buildHub(): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
} {
  const embed = new EmbedBuilder()
    .setTitle('🎴 Lion Pride TCG')
    .setColor(0xf59e0b)
    .setDescription(
      [
        'Press **Open Menu** to play. Your menu is private and updates in place —',
        'it does not spam the channel.',
        '',
        '🎁 Open your daily pack · 📚 browse your collection · ✨ show off a card',
        '',
        'Earn a pack by posting each day. Reach 25 messages for a bonus pack.',
      ].join('\n'),
    );

  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(HUB_OPEN)
      .setLabel('Open Menu')
      .setEmoji('🎴')
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}
