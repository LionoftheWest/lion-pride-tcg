import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import type { Command } from '../types.js';
import { getCollection } from '../store.js';
import { RARITY_EMOJI, RARITY_LABEL, RARITY_ORDER } from '../display.js';
import type { Rarity } from '../draw.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('collection')
    .setDescription('Show a member collection summary.')
    .addUserOption((option) =>
      option
        .setName('member')
        .setDescription('The member to look up. Defaults to you.')
        .setRequired(false),
    ),
  async execute(interaction) {
    await interaction.deferReply();

    const target = interaction.options.getUser('member') ?? interaction.user;
    const owned = await getCollection(target.id);

    if (owned.length === 0) {
      await interaction.editReply(
        `${target.username} has no cards yet. Post messages, then use /open.`,
      );
      return;
    }

    // Count unique cards and total copies per rarity.
    const unique: Record<Rarity, number> = {
      normal: 0,
      illustrated_rare: 0,
      secret_rare: 0,
      full_art: 0,
      gold: 0,
    };
    const copies: Record<Rarity, number> = { ...unique };
    for (const row of owned) {
      unique[row.card.rarity] += 1;
      copies[row.card.rarity] += row.quantity;
    }

    const totalUnique = owned.length;
    const totalCopies = owned.reduce((sum, row) => sum + row.quantity, 0);

    const lines = RARITY_ORDER.filter((rarity) => copies[rarity] > 0).map(
      (rarity) =>
        `${RARITY_EMOJI[rarity]} ${RARITY_LABEL[rarity]}: ${unique[rarity]} unique (${copies[rarity]} total)`,
    );

    const embed = new EmbedBuilder()
      .setTitle(`${target.username} — collection`)
      .setColor(0x3b82f6)
      .setDescription(lines.join('\n'))
      .setFooter({
        text: `${totalUnique} unique cards, ${totalCopies} total copies`,
      });

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
