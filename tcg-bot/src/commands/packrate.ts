import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { getMultiplierValue, setMultiplier } from '../store.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('packrate')
    .setDescription('Admin: set the pack-earn multiplier (1 = normal, 2 = double week).')
    .addNumberOption((o) => o.setName('multiplier').setDescription('The earn multiplier').setRequired(true).setMinValue(0).setMaxValue(10)),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const mult = interaction.options.getNumber('multiplier', true);
    await setMultiplier(mult);
    const now = await getMultiplierValue();
    await interaction.reply(`⚙️ Pack-earn multiplier is now **×${now}**. Earned packs scale by this. (Takes effect within a minute.)`);
  },
};

export default command;
