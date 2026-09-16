import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { RARITY_EMOJI, RARITY_LABEL } from '../display.js';
import type { DailyStatus, PlayerSummary } from '../store.js';

// The private panel's buttons. Every one edits the same panel in place.
export const PANEL_ID = {
  open: 'panel:open',
  collection: 'panel:col',
  browse: 'panel:cat',
  daily: 'panel:daily',
  showoff: 'panel:showoff',
  home: 'panel:home',
  close: 'panel:close',
} as const;

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

/** The panel's home view: a personal dashboard plus the action menu. */
export function buildPanelHome(
  username: string,
  summary: PlayerSummary,
  status: DailyStatus,
): { content: string; embeds: EmbedBuilder[]; components: Row[] } {
  const packReady = status.baseAvailable || status.bonusAvailable;
  const packLine = packReady
    ? '🎁 ready — press Open Pack!'
    : status.baseClaimed
      ? '✅ claimed for today'
      : 'post a message to earn one';
  const rarest = summary.rarest
    ? `${RARITY_EMOJI[summary.rarest.rarity]} ${summary.rarest.name} (${RARITY_LABEL[summary.rarest.rarity]})`
    : 'none yet';

  const embed = new EmbedBuilder()
    .setTitle('🎴 Lion Pride TCG')
    .setColor(0xf59e0b)
    .setAuthor({ name: `${username}'s menu` })
    .addFields(
      {
        name: 'Your collection',
        value: `${summary.totalUnique} unique · ${summary.totalCopies} total`,
        inline: true,
      },
      { name: 'Your rarest', value: rarest, inline: true },
      { name: 'Daily pack', value: packLine, inline: false },
    )
    .setFooter({ text: `${status.messageCount} message(s) today` });

  const row1 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_ID.open).setLabel('Open Pack').setEmoji('🎁').setStyle(packReady ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_ID.collection).setLabel('My Collection').setEmoji('📚').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PANEL_ID.daily).setLabel('Daily Status').setEmoji('📅').setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(PANEL_ID.browse).setLabel('Browse Cards').setEmoji('🔍').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_ID.showoff).setLabel('Show Off').setEmoji('✨').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PANEL_ID.close).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Danger),
  );

  return { content: '', embeds: [embed], components: [row1, row2] };
}

/** A single "back to menu" button row for sub-views. */
export function homeRow(): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_ID.home)
      .setLabel('Back to menu')
      .setEmoji('🏠')
      .setStyle(ButtonStyle.Secondary),
  );
}
