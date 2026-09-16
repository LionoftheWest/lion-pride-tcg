import {
  EmbedBuilder,
  MessageFlags,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  getAllCards,
  getCardById,
  getCollection,
  getDailyStatus,
  getPlayerSummary,
  openEarnedPacks,
  type Card,
  type DailyStatus,
} from '../store.js';
import { RARITY_COLOR, RARITY_EMOJI, RARITY_LABEL } from '../display.js';
import { BONUS_THRESHOLD } from '../draw.js';
import { buildBrowser, type BrowseMode, type BrowserItem } from './browser.js';
import { REVEAL_NEXT, revealNext, startManualReveal } from './reveal.js';
import { buildPanelHome, homeRow, PANEL_ID } from './panel.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** Load the item list for a browser mode: a member's cards, or the whole catalog. */
async function loadItems(mode: BrowseMode, userId: string): Promise<BrowserItem[]> {
  if (mode === 'col') {
    const owned = await getCollection(userId);
    return owned.map((row) => ({ card: row.card, quantity: row.quantity }));
  }
  const cards = await getAllCards();
  return cards.map((card) => ({ card }));
}

function cardArtEmbed(card: Card): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[card.rarity]} ${card.name}`)
    .setColor(RARITY_COLOR[card.rarity])
    .addFields(
      { name: 'Subject', value: card.subject_name ?? '—', inline: true },
      { name: 'Rarity', value: RARITY_LABEL[card.rarity], inline: true },
    );
  if (card.lore) embed.setDescription(card.lore);
  if (card.image_url) embed.setImage(card.image_url);
  if (card.artist_credit) embed.setFooter({ text: `Art by ${card.artist_credit}` });
  return embed;
}

function dailyText(status: DailyStatus): string {
  return [
    '**Daily status**',
    `Messages today: **${status.messageCount}** (UTC day)`,
    `Daily pack: ${
      status.baseAvailable
        ? '🎁 ready — press Open Pack'
        : status.baseClaimed
          ? '✅ claimed'
          : 'post a message to earn it'
    }`,
    `Bonus pack: ${
      status.bonusAvailable
        ? '🎁 ready — press Open Pack'
        : status.bonusClaimed
          ? '✅ claimed'
          : `reach ${BONUS_THRESHOLD} messages`
    }`,
  ].join('\n');
}

/**
 * Route every button and select-menu interaction.
 * The public hub opens one private panel; everything after edits that panel in
 * place. Only Show Off posts a new (public) message.
 */
export async function handleComponent(
  interaction: MessageComponentInteraction,
): Promise<void> {
  const id = interaction.customId;
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Open the private panel from the public hub (or any legacy hub button).
  if (id.startsWith('hub:')) {
    await interaction.deferReply(EPHEMERAL);
    const [summary, status] = await Promise.all([
      getPlayerSummary(userId),
      getDailyStatus(userId),
    ]);
    await interaction.editReply(buildPanelHome(username, summary, status));
    return;
  }

  if (id === PANEL_ID.home) {
    await interaction.deferUpdate();
    const [summary, status] = await Promise.all([
      getPlayerSummary(userId),
      getDailyStatus(userId),
    ]);
    await interaction.editReply(buildPanelHome(username, summary, status));
    return;
  }

  if (id === PANEL_ID.close) {
    await interaction.update({
      content: 'Menu closed. Press **Open Menu** on the hub to reopen.',
      embeds: [],
      components: [],
    });
    return;
  }

  if (id === PANEL_ID.open) {
    await interaction.deferUpdate();
    const result = await openEarnedPacks(userId, username);
    if (result.packs.length === 0) {
      await interaction.editReply({
        content:
          'You have no unopened packs right now. Post messages today to earn a ' +
          'pack, and reach 25 messages for a bonus pack. Packs reset at 00:00 UTC.',
        embeds: [],
        components: [homeRow()],
      });
      return;
    }
    await startManualReveal(interaction, result, userId, [homeRow()]);
    return;
  }

  // Flip the next card in a manual reveal.
  if (id === REVEAL_NEXT) {
    await revealNext(interaction, userId);
    return;
  }

  if (id === PANEL_ID.collection || id === PANEL_ID.showoff) {
    await interaction.deferUpdate();
    const items = await loadItems('col', userId);
    await interaction.editReply(buildBrowser({ items, page: 0, filter: 'all', mode: 'col' }));
    return;
  }

  if (id === PANEL_ID.browse) {
    await interaction.deferUpdate();
    const items = await loadItems('cat', userId);
    await interaction.editReply(buildBrowser({ items, page: 0, filter: 'all', mode: 'cat' }));
    return;
  }

  if (id === PANEL_ID.daily) {
    await interaction.deferUpdate();
    const status = await getDailyStatus(userId);
    await interaction.editReply({ content: dailyText(status), embeds: [], components: [homeRow()] });
    return;
  }

  // Show Off: the one intended public post.
  if (id.startsWith('br:showoff:')) {
    const cardId = Number(id.split(':')[2]);
    const card = await getCardById(cardId);
    if (!card) {
      await interaction.reply({ content: 'That card no longer exists.', ...EPHEMERAL });
      return;
    }
    await interaction.reply({
      content: `**${username}** shows off **${card.name}**!`,
      embeds: [cardArtEmbed(card)],
    });
    return;
  }

  // Browser navigation, edited in place.
  if (id.startsWith('br:')) {
    await interaction.deferUpdate();
    const [, mode, pageStr, filter] = id.split(':');
    const items = await loadItems(mode as BrowseMode, userId);
    await interaction.editReply(
      buildBrowser({ items, page: Number(pageStr), filter: filter ?? 'all', mode: mode as BrowseMode }),
    );
    return;
  }

  // Rarity filter select, edited in place.
  if (id.startsWith('brf:') && interaction.isStringSelectMenu()) {
    await interaction.deferUpdate();
    const mode = id.split(':')[1] as BrowseMode;
    const filter = interaction.values[0] ?? 'all';
    const items = await loadItems(mode, userId);
    await interaction.editReply(buildBrowser({ items, page: 0, filter, mode }));
    return;
  }
}
