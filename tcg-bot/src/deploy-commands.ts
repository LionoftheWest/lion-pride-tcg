import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commands/index.js';

// Registers slash commands with Discord. Run this once, and again whenever
// you add, remove, or change a command's name/description/options.
//   npm run deploy

const body = (await loadCommands()).map((command) => command.data.toJSON());

const rest = new REST().setToken(config.token);

const route = config.guildId
  ? Routes.applicationGuildCommands(config.clientId, config.guildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body });

console.log(
  `Registered ${body.length} command(s) ${
    config.guildId ? `to guild ${config.guildId}` : 'globally'
  }.`,
);
