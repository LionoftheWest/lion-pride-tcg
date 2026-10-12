import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../types.js';
import { isAdmin } from '../config.js';
import { setPackRate } from '../store.js';

// /packrate is a shortcut for a modifier event on the event calendar (F-1 PR 4, admin_packrate): a factor other than 1
// makes (or edits) the live event {"pack_earn_mult": factor} for the hours given; 1 ends it now. The base value stays in
// balance pack_earn_multiplier; the event and its change log are on the Admin Events page.
export const PACKRATE_DEFAULT_HOURS = 168; // one week, the old "double week"

/** The reply text for an answer of admin_packrate. */
export function packRateReply(factor: number, r: { ok: boolean; note?: string; ended?: boolean; errors?: string[]; error?: string; event?: { key: string; ends_at: string } }): string {
  if (!r.ok) return `⚠️ Pack rate not changed: ${(r.errors ?? [r.error ?? 'unknown error']).join('; ')}`;
  if (factor === 1) return r.note === 'none' ? 'ℹ️ No /packrate event is live: earned packs are already normal.' : '⚙️ The /packrate event ended: earned packs are normal again.';
  const end = r.event ? `<t:${Math.floor(new Date(r.event.ends_at).getTime() / 1000)}:F>` : 'its end';
  return `⚙️ Earned packs are now **×${factor}** until ${end} (event \`${r.event?.key ?? '?'}\`). Takes effect within 30 seconds.`;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('packrate')
    .setDescription('Admin: earned packs x a factor for some hours (a modifier event; 1 = back to normal).')
    .addNumberOption((o) => o.setName('multiplier').setDescription('The factor (0 = paused, 2 = double, 1 = end the event)').setRequired(true).setMinValue(0).setMaxValue(5))
    .addNumberOption((o) => o.setName('hours').setDescription(`How long from now (default ${PACKRATE_DEFAULT_HOURS})`).setMinValue(1).setMaxValue(62 * 24)),
  async execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
      await interaction.reply({ content: 'That command is admin-only.', flags: MessageFlags.Ephemeral });
      return;
    }
    const factor = interaction.options.getNumber('multiplier', true);
    const hours = interaction.options.getNumber('hours') ?? PACKRATE_DEFAULT_HOURS;
    const r = await setPackRate(factor, hours, `discord:${interaction.user.id}`);
    await interaction.reply(packRateReply(factor, r));
  },
};

export default command;
