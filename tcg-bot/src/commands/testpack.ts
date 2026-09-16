import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { openTestPacks } from '../store.js';
import { startManualReveal } from '../ui/reveal.js';

// Admin-only testing tool: open packs on demand, ignoring the daily limit.
// Remove or lock this down before the game is public.
const command: Command = {
  data: new SlashCommandBuilder()
    .setName('testpack')
    .setDescription('Open test packs now, ignoring the daily limit (admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription('How many packs to open (1 to 5).')
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(false),
    ),
  async execute(interaction) {
    await interaction.deferReply();
    const count = interaction.options.getInteger('count') ?? 1;
    const result = await openTestPacks(
      interaction.user.id,
      interaction.user.username,
      count,
    );
    await startManualReveal(interaction, result, interaction.user.id, []);
  },
};

export default command;
