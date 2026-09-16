import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { openOnePack } from '../store.js';
import { startManualReveal } from '../ui/reveal.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('open')
    .setDescription('Open a pack from your balance.'),
  async execute(interaction) {
    // Drawing touches the database, so defer to avoid the 3-second timeout.
    await interaction.deferReply();

    const pack = await openOnePack(interaction.user.id, interaction.user.username);
    if (!pack) {
      await interaction.editReply(
        'You have no packs to open. Post messages to earn packs — one for posting ' +
          'today, and a bonus at 25 messages. Packs reset at 00:00 UTC.',
      );
      return;
    }

    const result = { award: { base: true, bonus: false }, packs: [pack] };
    await startManualReveal(interaction, result, interaction.user.id, []);
  },
};

export default command;
