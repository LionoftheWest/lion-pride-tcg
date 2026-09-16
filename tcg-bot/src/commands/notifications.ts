import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { getNotifications, markNotificationsRead } from '../store.js';

// A private, on-demand view of your notifications — ephemeral, so only you see it.
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('notifications')
    .setDescription('See your recent Lion Pride TCG notifications (only you can see this).'),
  async execute(interaction) {
    const items = await getNotifications(interaction.user.id, 15);
    const unread = items.filter((n) => !n.read).length;
    const body = items.length
      ? items.map((n) => `${n.read ? '·' : '🔴'} ${n.message}`).join('\n')
      : 'No notifications yet — earn a pack, get a gift, or receive a trade offer.';
    await interaction.reply({
      content: `**🔔 Your notifications**${unread ? ` — ${unread} new` : ''}\n${body}`,
      flags: MessageFlags.Ephemeral,
    });
    if (unread) markNotificationsRead(interaction.user.id).catch(() => {});
  },
};

export default command;
