import { MessageFlags, type MessageComponentInteraction } from 'discord.js';

// The old /hub panel is retired: the Activity is the way to play (Nathan, 2026-10-03).
// Hub messages already posted in Discord still carry these custom ids. Each prefix is
// the exact id or prefix that the removed ui/hub.ts, ui/panel.ts and ui/browser.ts built:
//   hub:open                               (the public hub button; any "hub:" id opened the panel)
//   panel:open|col|cat|daily|showoff|home|close  (the private panel buttons)
//   br:<col|cat>:<page>:<filter>, br:showoff:<cardId>  (the browser buttons)
//   brf:<col|cat>                          (the browser rarity select menu)
// "rev:next" is NOT retired: /open and /testpack still use the reveal (ui/reveal.ts).
export const RETIRED_PANEL_PREFIXES = ['hub:', 'panel:', 'br:', 'brf:'] as const;

export const RETIRED_PANEL_REPLY =
  'This panel is retired — open Lion Pride TCG with the Activity button.';

/** True if this custom id belonged to the removed hub / panel / browser. */
export function isRetiredPanelId(customId: string): boolean {
  return RETIRED_PANEL_PREFIXES.some((prefix) => customId.startsWith(prefix));
}

/**
 * Answer a click on a retired panel with a short private message. Works for buttons and
 * select menus. Never throws: an interaction that is already acknowledged gets a
 * follow-up, and a failed Discord call is ignored.
 */
export async function replyRetiredPanel(interaction: MessageComponentInteraction): Promise<void> {
  const body = { content: RETIRED_PANEL_REPLY, flags: MessageFlags.Ephemeral } as const;
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(body);
    else await interaction.reply(body);
  } catch {
    // An expired token or a deleted message: nothing more to do.
  }
}
