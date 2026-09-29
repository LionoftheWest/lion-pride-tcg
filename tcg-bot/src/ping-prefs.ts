import { getSupabase } from './supabase.js';

// Who may be pinged (notify_prefs.sql, Nathan 2026-09-29). Each member sets it in the
// Activity (the bell > Settings): Mute all, or per kind. A muted member is still NAMED in
// the post, but Discord does not ping them (allowed_mentions). A missing value = ON.
export type PingKind = 'plays' | 'trades' | 'raid' | 'packs';
export const PING_KINDS: PingKind[] = ['plays', 'trades', 'raid', 'packs'];
export type Prefs = Partial<Record<PingKind | 'all', boolean>>;

/** The member ids in a post's text (<@id> and <@!id>), each once. */
export function mentionIds(text: string): string[] {
  return [...new Set([...String(text).matchAll(/<@!?(\d{5,25})>/g)].map((m) => m[1]!))];
}

/** May this member be pinged for this kind of post? */
export function allowPing(prefs: Prefs | null | undefined, kind: PingKind | undefined): boolean {
  if (!prefs) return true;
  if (prefs.all === false) return false;
  return kind ? prefs[kind] !== false : true;
}

// A short cache: a busy channel posts many times a minute.
const cache = new Map<string, { at: number; prefs: Prefs }>();
const TTL_MS = 30_000;
export function forgetPrefs(id: string): void { cache.delete(id); }

async function loadPrefs(ids: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>();
  const miss: string[] = [];
  for (const id of ids) {
    const c = cache.get(id);
    if (c && Date.now() - c.at < TTL_MS) out.set(id, c.prefs); else miss.push(id);
  }
  if (miss.length) {
    const { data, error } = await getSupabase().from('players').select('id, notify_prefs').in('id', miss);
    if (error) throw new Error(error.message);
    for (const id of miss) {
      const prefs = ((data ?? []).find((r: { id: string }) => r.id === id) as { notify_prefs?: Prefs } | undefined)?.notify_prefs ?? {};
      cache.set(id, { at: Date.now(), prefs });
      out.set(id, prefs);
    }
  }
  return out;
}

/**
 * The members of this post who may be pinged. If the lookup fails, nobody is pinged
 * (fail closed: a silent post is better than pinging someone who muted the bot).
 */
export async function pingableUsers(text: string, kind: PingKind | undefined): Promise<string[]> {
  const ids = mentionIds(text);
  if (!ids.length) return [];
  try {
    const prefs = await loadPrefs(ids);
    return ids.filter((id) => allowPing(prefs.get(id), kind));
  } catch {
    return [];
  }
}
