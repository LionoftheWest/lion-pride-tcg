import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { getPackBalance } from '../store.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('packs').setDescription('Check how many packs you have.'),
  async execute(interaction) {
    const n = await getPackBalance(interaction.user.id);
    await interaction.reply({
      content: n > 0 ? `You have **${n}** pack${n === 1 ? '' : 's'}. Open with /open.` : 'You have no packs yet. Post messages to earn some.',
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default command;
