import { getSupabase } from './supabase.js';
import { art, buf } from './playing-posts.js';
import { renderTrade, type TradeInput } from './post-pictures.js';

// The trade picture (Nathan, 2026-10-02): the two members and the cards between them, on the trade
// and card gift posts. The Activity sends only ids (/announce picture); the bot reads the rest.
// Flag: FEATURE_TRADE_PICTURES=1 (default OFF; a failed picture still posts the text).
export const tradePicturesEnabled = (): boolean => process.env.FEATURE_TRADE_PICTURES === '1';

export type TradeSpec =
  | { type: 'trade'; kind: 'offer' | 'picked' | 'accepted'; offerId: number }
  | { type: 'gift'; fromId: string; toId: string; cardId: number };

const ID = /^\d{17,20}$/;
/** Allow-list the picture spec from the Activity (the bot trusts nothing else). */
export function cleanTradeSpec(x: unknown): TradeSpec | null {
  if (!x || typeof x !== 'object') return null;
  const s = x as Record<string, unknown>;
  if (s.type === 'trade' && ['offer', 'picked', 'accepted'].includes(String(s.kind)) && Number.isInteger(s.offerId) && (s.offerId as number) > 0) {
    return { type: 'trade', kind: s.kind as 'offer' | 'picked' | 'accepted', offerId: s.offerId as number };
  }
  if (s.type === 'gift' && ID.test(String(s.fromId)) && ID.test(String(s.toId)) && Number.isInteger(s.cardId) && (s.cardId as number) > 0) {
    return { type: 'gift', fromId: String(s.fromId), toId: String(s.toId), cardId: s.cardId as number };
  }
  return null;
}

const avatarUrl = (id: string, hash: string | null | undefined): string | null => (hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=256` : null);
type CardRow = { id: number; name: string; rarity: string; image_url: string | null };

/** The picture for a trade / gift post, or null (flag off, unknown ids). */
export async function tradePicture(spec: TradeSpec): Promise<Buffer | null> {
  if (!tradePicturesEnabled()) return null;
  const sb = getSupabase();
  let fromId: string, toId: string, offerId: number | null, requestId: number | null;
  if (spec.type === 'trade') {
    const { data } = await sb.from('trade_offers').select('from_id, to_id, offer_card_id, request_card_id').eq('id', spec.offerId).maybeSingle();
    const o = data as { from_id: string; to_id: string; offer_card_id: number | null; request_card_id: number | null } | null;
    if (!o) return null;
    fromId = String(o.from_id); toId = String(o.to_id); offerId = o.offer_card_id; requestId = o.request_card_id;
  } else {
    fromId = spec.fromId; toId = spec.toId; offerId = spec.cardId; requestId = null;
  }
  const ids = [offerId, requestId].filter((v): v is number => !!v);
  const [{ data: players }, { data: cards }] = await Promise.all([
    sb.from('players').select('id, username, avatar').in('id', [fromId, toId]),
    ids.length ? sb.from('cards').select('id, name, rarity, image_url').in('id', ids) : Promise.resolve({ data: [] as CardRow[] }),
  ]);
  const pl = new Map(((players ?? []) as { id: string; username?: string; avatar?: string | null }[]).map((p) => [String(p.id), p]));
  const cd = new Map(((cards ?? []) as CardRow[]).map((c) => [c.id, c]));
  const f = pl.get(fromId), t = pl.get(toId), oc = offerId ? cd.get(offerId) : undefined, rc = requestId ? cd.get(requestId) : undefined;
  const [fa, ta, oa, ra] = await Promise.all([buf(avatarUrl(fromId, f?.avatar)), buf(avatarUrl(toId, t?.avatar)), art(oc?.image_url ?? null), art(rc?.image_url ?? null)]);
  const card = (c: CardRow | undefined, a: Buffer | null): TradeInput['offer'] => (c ? { name: c.name, rarity: c.rarity, art: a } : null);
  return renderTrade({ kind: spec.type === 'gift' ? 'gift' : spec.kind, from: f?.username || 'A member', fromAvatar: fa, to: t?.username || 'a member', toAvatar: ta,
    offer: card(oc, oa), request: card(rc, ra) });
}
