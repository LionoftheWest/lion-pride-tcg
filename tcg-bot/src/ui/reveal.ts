import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type MessageComponentInteraction,
} from 'discord.js';
import type { Card, OpenResult } from '../store.js';
import { RARITY_COLOR, RARITY_EMOJI, RARITY_LABEL } from '../display.js';
import type { Rarity } from '../draw.js';

const RARE: Rarity[] = ['secret_rare', 'full_art', 'gold'];
type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;

// The shared lion card back, shown face-down before the pack is revealed.
const BACK_IMAGE_URL =
  'https://kgvdqqehefezbypozvrh.supabase.co/storage/v1/object/public/card-art/cards/card-back.png';

export const REVEAL_NEXT = 'rev:next';

// A member's in-progress manual reveal. Kept in memory, keyed by user id. If the
// bot restarts mid-reveal, the session is lost and the member simply re-opens.
interface Session {
  cards: Card[];
  index: number;
  finalComponents: Row[];
  // Each card's image is fetched up front so it is attached to the message
  // (Discord reserves space from the file's dimensions -> no collapse or lag).
  images: Promise<Buffer | null>[];
}
const sessions = new Map<string, Session>();

/** Fetch a card image up front so we can attach it to the reveal message. */
async function fetchImage(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** A stable per-card attachment name; the extension matches the stored asset. */
function imageName(card: Card, index: number): string {
  const path = (card.image_url ?? '').split('?')[0];
  const ext = path.endsWith('.png') ? 'png' : 'webp';
  return `card${index}.${ext}`;
}

function revealButton(label: string): Row {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(REVEAL_NEXT)
      .setLabel(label)
      .setEmoji('🎴')
      .setStyle(ButtonStyle.Primary),
  );
}

function coverEmbed(total: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🎁 You earned a pack!')
    .setColor(0xf59e0b)
    .setImage(BACK_IMAGE_URL)
    .setFooter({ text: `${total} cards • press Reveal to flip each one` });
}

function revealEmbed(card: Card, position: number, total: number): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[card.rarity]} ${card.name}`)
    .setColor(RARITY_COLOR[card.rarity])
    .setFooter({ text: `Card ${position} of ${total}` });
  if (card.subject_name) embed.setAuthor({ name: card.subject_name });
  if (card.lore) embed.setDescription(`*${card.lore}*`);
  return embed;
}

function finalEmbed(cards: Card[], last: Card): EmbedBuilder {
  const lines = cards.map(
    (card) => `${RARITY_EMOJI[card.rarity]} **${card.name}** — ${RARITY_LABEL[card.rarity]}`,
  );
  const embed = new EmbedBuilder()
    .setTitle(`${RARITY_EMOJI[last.rarity]} ${last.name}`)
    .setColor(RARITY_COLOR[last.rarity])
    .addFields({ name: 'Your pull', value: lines.join('\n') });

  const rares = cards.filter((card) => RARE.includes(card.rarity));
  embed.setFooter({
    text:
      rares.length > 0
        ? `✨ Rare pull — ${rares.map((card) => RARITY_LABEL[card.rarity]).join(', ')}!`
        : 'Pack complete',
  });
  return embed;
}

/**
 * Begin a manual reveal. The cards are already drawn and granted; this shows
 * the face-down pack and a Reveal button. Call after the interaction is
 * deferred (deferReply for a command, deferUpdate for a component).
 */
export async function startManualReveal(
  interaction: ChatInputCommandInteraction | MessageComponentInteraction,
  result: OpenResult,
  userId: string,
  finalComponents: Row[] = [],
): Promise<void> {
  const cards = result.packs.flat();
  // Start downloading every card image now, while the member reads the cover
  // and before the first click, so each reveal attaches instantly.
  const images = cards.map((card) => fetchImage(card.image_url));
  sessions.set(userId, { cards, index: 0, finalComponents, images });
  await interaction.editReply({
    content: '',
    embeds: [coverEmbed(cards.length)],
    components: [revealButton('Reveal ▶')],
  });
}

/** Flip the next card in a member's reveal. */
export async function revealNext(
  interaction: MessageComponentInteraction,
  userId: string,
): Promise<void> {
  const state = sessions.get(userId);
  if (!state) {
    await interaction.update({
      content: 'This reveal expired. Open a new pack.',
      embeds: [],
      components: [],
    });
    return;
  }

  const cardIndex = state.index;
  const card = state.cards[cardIndex]!;
  state.index += 1;

  // Attach the pre-fetched image so the box keeps a fixed size and never
  // collapses while loading. Fall back to the URL if the fetch failed.
  const buffer = await state.images[cardIndex];
  const name = imageName(card, cardIndex);
  const files = buffer ? [new AttachmentBuilder(buffer, { name })] : [];
  const setImage = (embed: EmbedBuilder): EmbedBuilder => {
    if (buffer) return embed.setImage(`attachment://${name}`);
    if (card.image_url) return embed.setImage(card.image_url);
    return embed;
  };

  if (state.index >= state.cards.length) {
    sessions.delete(userId);
    await interaction.update({
      embeds: [setImage(finalEmbed(state.cards, card))],
      components: state.finalComponents,
      files,
    });
  } else {
    await interaction.update({
      embeds: [setImage(revealEmbed(card, state.index, state.cards.length))],
      components: [revealButton('Reveal next ▶')],
      files,
    });
  }
}
