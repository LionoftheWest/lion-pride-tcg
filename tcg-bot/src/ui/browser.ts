import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Card } from '../store.js';
import type { Rarity } from '../draw.js';
import {
  RARITY_COLOR,
  RARITY_EMOJI,
  RARITY_LABEL,
  RARITY_ORDER,
} from '../display.js';
import { PANEL_ID } from './panel.js';

function homeButton(): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(PANEL_ID.home)
    .setEmoji('🏠')
    .setStyle(ButtonStyle.Secondary);
}

export type BrowseMode = 'col' | 'cat';

export interface BrowserItem {
  card: Card;
  quantity?: number;
}

export interface BrowserPayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

/** Sort items by rarity (rarest last) then name. */
export function sortItems(items: BrowserItem[]): BrowserItem[] {
  return [...items].sort((a, b) => {
    const rank = RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity);
    return rank !== 0 ? rank : a.card.name.localeCompare(b.card.name);
  });
}

export function filterItems(items: BrowserItem[], filter: string): BrowserItem[] {
  return filter === 'all'
    ? items
    : items.filter((item) => item.card.rarity === filter);
}

function filterRow(
  mode: BrowseMode,
  filter: string,
): ActionRowBuilder<MessageActionRowComponentBuilder> {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`brf:${mode}`)
    .setPlaceholder('Filter by rarity')
    .addOptions(
      { label: 'All rarities', value: 'all', default: filter === 'all' },
      ...RARITY_ORDER.map((rarity) => ({
        label: RARITY_LABEL[rarity],
        value: rarity,
        emoji: RARITY_EMOJI[rarity],
        default: filter === rarity,
      })),
    );
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu);
}

/**
 * Build a card-by-card browser payload.
 * The caller passes the full item list every time. This function filters,
 * sorts, clamps the page, and renders one card with navigation.
 */
export function buildBrowser(opts: {
  items: BrowserItem[];
  page: number;
  filter: string;
  mode: BrowseMode;
}): BrowserPayload {
  const { mode, filter } = opts;
  const sorted = sortItems(filterItems(opts.items, filter));

  if (sorted.length === 0) {
    const label = mode === 'col' ? 'your collection' : 'the catalog';
    const suffix = filter === 'all' ? '' : ` at ${RARITY_LABEL[filter as Rarity]} rarity`;
    return {
      content: `No cards in ${label}${suffix}.`,
      embeds: [],
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          homeButton().setLabel('Back to menu'),
        ),
        filterRow(mode, filter),
      ],
    };
  }

  const page = Math.max(0, Math.min(opts.page, sorted.length - 1));
  const item = sorted[page]!;
  const card = item.card;

  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[card.rarity]} ${card.name}`)
    .setColor(RARITY_COLOR[card.rarity])
    .addFields(
      { name: 'Subject', value: card.subject_name ?? '—', inline: true },
      { name: 'Rarity', value: RARITY_LABEL[card.rarity], inline: true },
    );
  if (item.quantity !== undefined) {
    embed.addFields({ name: 'Owned', value: `×${item.quantity}`, inline: true });
  }
  if (card.lore) embed.setDescription(card.lore);
  if (card.image_url) embed.setImage(card.image_url);
  const footer = `Card ${page + 1} of ${sorted.length}${
    card.artist_credit ? ` • Art by ${card.artist_credit}` : ''
  }`;
  embed.setFooter({ text: footer });

  const nav = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`br:${mode}:${page - 1}:${filter}`)
      .setEmoji('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`br:${mode}:${page + 1}:${filter}`)
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= sorted.length - 1),
  );

  // The Show Off button appears only in a member's own collection.
  if (mode === 'col') {
    nav.addComponents(
      new ButtonBuilder()
        .setCustomId(`br:showoff:${card.id}`)
        .setLabel('Show Off')
        .setEmoji('✨')
        .setStyle(ButtonStyle.Primary),
    );
  }
  nav.addComponents(homeButton());

  return { content: '', embeds: [embed], components: [nav, filterRow(mode, filter)] };
}
