import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import type { Command } from '../types.js';
import { buildHub } from '../ui/hub.js';

// Posts the pinned hub panel. Admin only, so members do not spawn duplicates.
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('hub')
    .setDescription('Post the TCG hub panel (admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    const channel = interaction.channel;
    if (!channel || !channel.isSendable()) {
      await interaction.reply({
        content: 'I cannot post a message in this channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await channel.send(buildHub());
    } catch {
      await interaction.reply({
        content:
          'I could not post in this channel. Give me the "View Channel", ' +
          '"Send Messages", and "Embed Links" permissions here, or run /hub in ' +
          'a channel where I can post.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: 'Posted the hub panel. Pin it so members always see it.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
