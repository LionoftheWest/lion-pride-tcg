import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmbedBuilder } from 'discord.js';
import { RARITY_COLOR, RARITY_EMOJI, RARITY_LABEL, type CardRarity } from './display.js';

// Every value of the card_rarity enum in the database (Nathan, 2026-10-01: /card showed an Event
// card as "undefined" and failed before the art).
const DB_RARITIES: CardRarity[] = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold', 'promo', 'event'];

test('every database rarity has a label, a color and an emoji', () => {
  for (const r of DB_RARITIES) {
    assert.ok(RARITY_LABEL[r], `label for ${r}`);
    assert.equal(typeof RARITY_COLOR[r], 'number', `color for ${r}`);
    assert.ok(RARITY_EMOJI[r], `emoji for ${r}`);
  }
});

test('the /card embed builds for an Event and a Promo card (discord.js validates the fields)', () => {
  for (const r of ['event', 'promo'] as CardRarity[]) {
    const embed = new EmbedBuilder()
      .setTitle(`Launch Day Raider — ${RARITY_LABEL[r]}`)
      .setColor(RARITY_COLOR[r])
      .addFields({ name: 'Subject', value: 'Launch Day Raider', inline: true }, { name: 'Rarity', value: RARITY_LABEL[r], inline: true });
    const json = embed.toJSON();
    assert.ok(!String(json.title).includes('undefined'));
    assert.equal(json.fields?.[1]?.value, RARITY_LABEL[r]);
  }
});
