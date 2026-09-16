import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { findCardByName, getCardById } from '../store.js';
import { getSupabase } from '../supabase.js';
import { RARITY_COLOR, RARITY_LABEL } from '../display.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('card')
    .setDescription('Show a card from the catalog.')
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('The card name to look up.')
        .setRequired(true)
        .setAutocomplete(true),
    ),
  async execute(interaction) {
    await interaction.deferReply();

    // Autocomplete sends the card's unique id; a typed name falls back to search.
    const choice = interaction.options.getString('name', true);
    const card = /^\d+$/.test(choice)
      ? await getCardById(Number(choice))
      : await findCardByName(choice);

    if (!card) {
      await interaction.editReply(`No card named "${choice}".`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`${card.name} — ${RARITY_LABEL[card.rarity]}`)
      .setColor(RARITY_COLOR[card.rarity])
      .addFields(
        { name: 'Subject', value: card.subject_name ?? '—', inline: true },
        { name: 'Rarity', value: RARITY_LABEL[card.rarity], inline: true },
      );

    if (card.lore) embed.setDescription(card.lore);
    if (card.image_url) embed.setImage(card.image_url);
    if (card.artist_credit) {
      embed.setFooter({ text: `Art by ${card.artist_credit}` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const { data } = await getSupabase()
      .from('cards')
      .select('id, name, rarity')
      .ilike('name', `%${focused}%`)
      .limit(25);

    // Each tier is its own row; show the tier and carry the unique id as value
    // so picking a specific finish opens that exact card, not the first match.
    const choices = (data ?? []).map(
      (row: { id: number; name: string; rarity: keyof typeof RARITY_LABEL }) => ({
        name: `${row.name} — ${RARITY_LABEL[row.rarity]}`.slice(0, 100),
        value: String(row.id),
      }),
    );
    await interaction.respond(choices);
  },
};

export default command;
