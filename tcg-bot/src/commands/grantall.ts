import { SlashCommandBuilder, MessageFlags, Routes, type APIGuildMember } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { grantPacksAll, notifyAll } from '../store.js';
import { getSupabase } from '../supabase.js';

// everyone:true (Nathan, 2026-09-30): EVERY human member of the server gets the packs,
// also members who never played. Each member gets one start gift only (gift_all_members.sql),
// so a repeat run or a member who already got the welcome packs never doubles it. It posts
// nothing in Discord: the reply is only for the admin, and each member gets a bell note.
async function allMembers(interaction: Parameters<Command['execute']>[0]): Promise<{ id: string; username: string; avatar: string | null }[]> {
  const out: { id: string; username: string; avatar: string | null }[] = [];
  let after = '0';
  for (;;) {
    const page = (await interaction.client.rest.get(Routes.guildMembers(interaction.guildId!), {
      query: new URLSearchParams({ limit: '1000', after }),
    })) as APIGuildMember[];
    for (const m of page) if (m.user && !m.user.bot) out.push({ id: m.user.id, username: m.user.username, avatar: m.user.avatar ?? null });
    if (page.length < 1000) break;
    after = page[page.length - 1]!.user!.id;
  }
  return out;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('grantall')
    .setDescription('Admin: give every player packs (event drop).')
    .addIntegerOption((o) => o.setName('amount').setDescription('Packs per player').setRequired(true).setMinValue(1))
    .addStringOption((o) => o.setName('reason').setDescription('Why (shown in the ledger)'))
    .addBooleanOption((o) => o.setName('everyone').setDescription('Every member of the server (one start gift each, no Discord post)')),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const amount = interaction.options.getInteger('amount', true);
    if (interaction.options.getBoolean('everyone')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (!interaction.guildId) { await interaction.editReply('Run this in the server.'); return; }
      const members = await allMembers(interaction);
      const { data, error } = await getSupabase().rpc('gift_all_members', { p_members: members, p_amount: amount, p_by: interaction.user.id });
      if (error || !data?.ok) { await interaction.editReply(`The gift failed: ${error?.message ?? data?.error ?? 'unknown'}. Nothing was given.`); return; }
      await interaction.editReply(`🎁 **${data.gifted}** members got **${amount}** packs (${data.created} of them new to the game). `
        + `${data.skipped} already had their start gift. No Discord post was made.`);
      return;
    }
    const reason = interaction.options.getString('reason') ?? 'event';
    await interaction.deferReply();
    const players = await grantPacksAll(amount, reason, interaction.user.id);
    await notifyAll('admin', `🎉 Event drop! You received ${amount} pack${amount === 1 ? '' : 's'}!`);
    await interaction.editReply(`🎉 Granted **${amount}** pack(s) to all **${players}** players.`);
  },
};

export default command;
