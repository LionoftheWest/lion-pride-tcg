import { SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is alive.'),
  async execute(interaction) {
    await interaction.reply(
      `Pong. Gateway latency ${Math.round(interaction.client.ws.ping)}ms.`,
    );
  },
};

export default command;
