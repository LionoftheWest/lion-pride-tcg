import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { undoAll } from '../discord-effects.js';

// Admin Undo all (docs/boons-and-pranks.md §3A): every active Discord boon/prank ends now
// (nicknames restored, roles removed, storms stopped), and pending ones are skipped.
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('undoeffects')
    .setDescription('Admin: undo every active Discord boon and prank now.'),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const n = await undoAll(interaction.client);
    await interaction.editReply(`Undid ${n} active Discord effect(s).`);
  },
};

export default command;
