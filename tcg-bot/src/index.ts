import { Client, Collection, Events, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { loadCommands } from './commands/index.js';
import { onMessageCreate } from './events/messageCreate.js';
import { handleComponent } from './ui/router.js';
import { startInternalServer } from './internal.js';
import { startHuntNotifier } from './hunt-notify.js';
import { startEffectNotifier } from './effect-notify.js';
import { startAuctionPosts } from './auction-posts.js';
import { startVoiceDailies } from './voice-dailies.js';
import { startDiscordEffects, discordEffectsEnabled, onEffectMessage, onEffectVoice, isVoiceJoin, tick as effectsTick } from './discord-effects.js';
import { clientOptions, startGuildLog } from './guild-log.js';
import type { Command } from './types.js';

// GuildMessages lets the bot count activity. MessageContent (a privileged intent, on in the Developer
// Portal; effects_spread.sql) gives the text of a message: only the Parrot and SpongeBob pranks read it,
// and only the next message of their target. GuildMembers (privileged) only with FEATURE_GUILD_MEMBERS_INTENT (guild-log.ts).
const client = new Client(clientOptions());

const commands = new Collection<string, Command>();
for (const command of await loadCommands()) {
  commands.set(command.data.name, command);
}

client.once(Events.ClientReady, (ready) => {
  console.log(`Ready. Logged in as ${ready.user.tag}.`);
  startHuntNotifier(ready); // drain the hunt_events outbox to the notifications channel
  startEffectNotifier(ready); // post every card boon/prank/neutral play (flag FEATURE_CARD_EFFECT_POSTS)
  startAuctionPosts(ready); // an auction start / end picture (flag FEATURE_AUCTION_POSTS)
  startDiscordEffects(ready); // real Discord boons/pranks + their undo (flag FEATURE_DISCORD_EFFECTS)
  startVoiceDailies(ready); // the Dailies voice minutes (flag settings.dailies.enabled, in SQL)
  startGuildLog(ready); // the server join and leave times (flags FEATURE_GUILD_LOG, FEATURE_GUILD_MEMBERS_INTENT)
});

// Log, do not crash: one failed Discord call must not stop the bot for everyone.
client.on(Events.Error, (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

client.on(Events.MessageCreate, onMessageCreate);
// The reaction storm prank: the bot reacts to the target's next messages. A heckle / parrot / spongebob: one reply.
// Slowmode: the bot deletes a message that comes too soon.
client.on(Events.MessageCreate, (m) => { if (discordEffectsEnabled() && !m.author.bot && m.inGuild()) void onEffectMessage(m); });
// A member joins voice: a fanfare / squeaky posts, a waiting voice prank runs, an overdue unmute is lifted (at once).
client.on(Events.VoiceStateUpdate, (before, after) => {
  if (!discordEffectsEnabled() || !isVoiceJoin(before, after)) return;
  void onEffectVoice(client, before, after);
  void effectsTick(client, true);
});

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
    // A second failure (expired token, deleted channel) must not become an unhandled rejection.
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(body).catch(() => {});
    } else {
      await interaction.reply(body).catch(() => {});
    }
  }
});

// The internal open endpoint for the Discord Activity (localhost only).
startInternalServer(client);

await client.login(config.token);
