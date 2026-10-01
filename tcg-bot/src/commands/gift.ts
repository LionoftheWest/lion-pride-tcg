import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { ensurePlayer, giftPacks, getPackBalance } from '../store.js';
import { announce } from '../internal.js';

// Any player can gift packs from their OWN balance to another player.
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Give packs from your balance to another player.')
    .addUserOption((o) => o.setName('user').setDescription('Who to gift to').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('How many (default 1)').setMinValue(1)),
  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount') ?? 1;
    if (user.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot gift yourself.', ephemeral: true });
      return;
    }
    if (user.bot) {
      await interaction.reply({ content: 'You cannot gift a bot.', ephemeral: true });
      return;
    }
    await interaction.deferReply();
    await ensurePlayer(user.id, user.username);
    const ok = await giftPacks(interaction.user.id, user.id, amount);
    if (!ok) {
      await interaction.editReply(`You do not have ${amount} pack(s) to gift.`);
      return;
    }
    const left = await getPackBalance(interaction.user.id);
    // The gift waits in the recipient's bell with a Redeem button (gift_claims.sql), plus a
    // public channel post that names them (their ping settings decide the ping).
    announce(interaction.client, `🎁 <@${user.id}> — **${interaction.user.username}** gifted you ${amount} pack${amount === 1 ? '' : 's'}!`);
    await interaction.editReply(`🎁 You gifted **${amount}** pack(s) to ${user}. They redeem it in the bell. You have **${left}** left.`);
  },
};

export default command;
