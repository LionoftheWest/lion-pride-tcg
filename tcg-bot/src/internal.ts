import { createServer } from 'node:http';
import type { Client } from 'discord.js';
import { openOnePack, openTestPacks, getPackBalance, giftPacks } from './store.js';

// A tiny internal HTTP server, reachable ONLY from other processes on the same
// VM (it binds to 127.0.0.1, and the container runs with --network host). It lets
// the Discord Activity open a player's earned packs through the SAME path as the
// /open command, so the bot stays the one source of truth for draw odds and the
// daily-pack limit. A shared secret guards it; the Activity sends that secret.
const TOKEN = process.env.INTERNAL_TOKEN ?? '';
const PORT = Number(process.env.INTERNAL_PORT) || 4451;
// Public activity/notifications channel — directed events post here and @mention
// the person who needs to act. Unset = no channel posts (in-app bell still works).
const NOTIF_CHANNEL = process.env.NOTIF_CHANNEL_ID ?? '';

// Post a message to the public notifications channel (best-effort).
export async function announce(client: Client, message: string): Promise<boolean> {
  if (!NOTIF_CHANNEL) return false;
  try {
    const channel = await client.channels.fetch(NOTIF_CHANNEL);
    if (channel && channel.isTextBased() && 'send' in channel) {
      await channel.send({ content: message, allowedMentions: { parse: ['users'] } });
      return true;
    }
  } catch { /* channel missing or no permission — ignore */ }
  return false;
}
// TEST ONLY: these Discord ids can open unlimited packs (ignore the daily limit)
// so the reveal flow can be walked through. Clear TEST_USER_IDS to disable.
const TEST_USERS = new Set(
  (process.env.TEST_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
);

export function startInternalServer(client: Client): void {
  if (!TOKEN) {
    console.warn('INTERNAL_TOKEN is not set — the internal open endpoint is disabled.');
    return;
  }
  const server = createServer((req, res) => {
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const route = req.method === 'POST' ? req.url : null;
    if (route !== '/open' && route !== '/status' && route !== '/gift' && route !== '/announce') return json(404, { error: 'not found' });
    if (req.headers['x-internal-token'] !== TOKEN) return json(401, { error: 'unauthorized' });

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) req.destroy(); // refuse an oversized body
    });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}') as {
          userId?: string;
          username?: string;
          fromId?: string;
          toId?: string;
          amount?: number;
          message?: string;
        };
        // Announce: post a directed event to the public notifications channel.
        if (route === '/announce') {
          if (!body.message) return json(400, { error: 'missing message' });
          const posted = await announce(client, String(body.message));
          return json(200, { posted });
        }
        // Gift: move packs from one player's balance to another.
        if (route === '/gift') {
          if (!body.fromId || !body.toId) return json(400, { error: 'missing ids' });
          const ok = await giftPacks(String(body.fromId), String(body.toId), Math.max(1, Number(body.amount) || 1));
          return json(200, { ok });
        }
        const { userId, username } = body;
        if (!userId) return json(400, { error: 'missing userId' });
        const isTester = TEST_USERS.has(String(userId));
        if (route === '/status') {
          // Testers always have a pack waiting (so the Open button shows).
          if (isTester) return json(200, { packs: 1 });
          return json(200, { packs: await getPackBalance(String(userId)) });
        }
        // Testers open on demand (draw without spending the balance). Everyone
        // else spends one pack from their balance and draws it.
        if (isTester) {
          const r = await openTestPacks(String(userId), String(username ?? 'Player'), 1);
          return json(200, { packs: r.packs });
        }
        const pack = await openOnePack(String(userId), String(username ?? 'Player'));
        json(200, { packs: pack ? [pack] : [] });
      } catch (error) {
        json(500, { error: String((error as Error)?.message ?? error) });
      }
    });
  });
  server.listen(PORT, '127.0.0.1', () =>
    console.log(`Internal API -> http://127.0.0.1:${PORT}`),
  );
}
