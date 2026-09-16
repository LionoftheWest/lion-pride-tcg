import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { ensurePlayer, grantPacks, notifyPlayer } from '../store.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('givepacks')
    .setDescription('Admin: gift packs to a player.')
    .addUserOption((o) => o.setName('user').setDescription('Who to give packs to').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many packs').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the ledger)')),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const reason = interaction.options.getString('reason') ?? 'gift';
    await interaction.deferReply();
    await ensurePlayer(user.id, user.username);
    const balance = await grantPacks(user.id, amount, reason, interaction.user.id);
    await notifyPlayer(user.id, 'admin', `🎁 You received ${amount} pack${amount === 1 ? '' : 's'}!`);
    await interaction.editReply(`🎁 Gave **${amount}** pack(s) to ${user}. They now have **${balance}**.`);
  },
};

export default command;
