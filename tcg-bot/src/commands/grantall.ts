import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { grantPacksAll, notifyAll } from '../store.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('grantall')
    .setDescription('Admin: give every player packs (event drop).')
    .addIntegerOption((o) => o.setName('amount').setDescription('Packs per player').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the ledger)')),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? 'event';
    await interaction.deferReply();
    const players = await grantPacksAll(amount, reason, interaction.user.id);
    await notifyAll('admin', `🎉 Event drop! You received ${amount} pack${amount === 1 ? '' : 's'}!`);
    await interaction.editReply(`🎉 Granted **${amount}** pack(s) to all **${players}** players.`);
  },
};

export default command;
