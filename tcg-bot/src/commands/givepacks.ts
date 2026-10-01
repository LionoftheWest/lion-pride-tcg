import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { ensurePlayer } from '../store.js';
import { getSupabase } from '../supabase.js';

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
    // A promo: it waits in their bell with a Redeem button (gift_claims.sql, Nathan 2026-10-01).
    const title = reason === 'gift' ? 'Gift from the Lion Pride team' : reason;
    const { error } = await getSupabase().rpc('give_gift', { p_player: user.id, p_kind: 'promo', p_title: title, p_amount: amount, p_reason: 'admin', p_from: interaction.user.id });
    if (error) { await interaction.editReply(`The gift failed: ${error.message}`); return; }
    await interaction.editReply(`🎁 Sent **${amount}** pack(s) to ${user} ("${title}"). They redeem it in the bell.`);
  },
};

export default command;
