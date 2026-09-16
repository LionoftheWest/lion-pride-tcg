import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commands/index.js';
import { onMessageCreate } from './events/messageCreate.js';
import { handleComponent } from './ui/router.js';
import { startInternalServer } from './internal.js';
import { startHuntNotifier } from './hunt-notify.js';
import type { Command } from './types.js';

// GuildMessages lets the bot count activity. It does NOT read message text, so
// the privileged Message Content intent is not needed.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const commands = new Collection<string, Command>();
for (const command of await loadCommands()) {
  commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (ready) => {
  console.log(`Ready. Logged in as ${ready.user.tag}.`);
  startHuntNotifier(ready); // drain the hunt_events outbox to the notifications channel
});

client.on(Events.MessageCreate, onMessageCreate);

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction);
      } catch (error) {
        console.error(`Autocomplete error in /${interaction.commandName}:`, error);
      }
    }
    return;
  }

  if (interaction.isMessageComponent()) {
    try {
      await handleComponent(interaction);
    } catch (error) {
      console.error(`Component error (${interaction.customId}):`, error);
      const body = {
        content: 'Something went wrong.',
        flags: MessageFlags.Ephemeral,
      } as const;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(body).catch(() => {});
      } else {
        await interaction.reply(body).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error in /${interaction.commandName}:`, error);
    const body = {
      content: 'Something went wrong running that command.',
      flags: MessageFlags.Ephemeral,
    } as const;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(body);
    } else {
      await interaction.reply(body);
    }
  }
});

// The internal open endpoint for the Discord Activity (localhost only).
startInternalServer(client);

await client.login(config.token);
