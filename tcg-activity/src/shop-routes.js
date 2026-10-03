// Shards and the Shop (docs/activities/01-shards-and-shop.md; Nathan, 2026-10-02).
// The rules live in SQL (tcg-bot/supabase/shards_shop.sql): the balance, the daily stock, the
// 7-day cooldown, the prices and the limits. These routes only read and call the RPCs, and the
// member always comes from the verified token, never from the request body.
// Flag: shardsOn(id) (SHARDS_USERS = Nathan first, FEATURE_SHARDS=1 = everyone). The database
// flag settings.shards.enabled is the second switch: while it is false, every RPC refuses.

const ERR = {
  disabled: 'The Shop is closed.', no_player: 'Unknown member.', not_enough: 'You do not have enough Shards.',
  bad_qty: 'Buy 1 to 10 packs at a time.', no_slot: 'That card is not in today\'s stock.', bought: 'You bought that card today already.',
  stats_disabled: 'Stat points are off.', not_owned: 'You do not own that card.', nothing_spent: 'That card has no points to reset.',
  bad_kind: 'Unknown item.', bad_count: 'Pick how many copies to convert.', no_value: 'That card cannot convert to Shards.',
  too_many: 'You can convert only the extra copies.',
};
const fail = (res, data) => res.status(400).json({ ...data, ok: false, message: ERR[data?.error] || data?.error || 'failed' });
const KINDS = new Set(['pack', 'card', 'stat_reset']);
const int = (v) => (Number.isInteger(v) ? v : null);

export function registerShopRoutes(app, { supabase, caller, rateLimit, bustUser, getCatalogBase, shardsOn }) {
  const gate = async (req, res, write = false) => {
    const me = await caller(req);
    if (!me) { res.status(401).json({ error: 'not authenticated' }); return null; }
    if (!shardsOn(me.id)) { res.status(403).json({ error: 'off' }); return null; }
    if (write && !rateLimit(me.id)) { res.status(429).json({ error: 'slow down' }); return null; }
    return me;
  };

  // The Shop view: the balance, today's stock with the card details and my owned count, the prices.
  app.get('/api/shop', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const { data, error } = await supabase.rpc('shop_today', { p_player: String(me.id) });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    const ids = (data.stock || []).map((s) => Number(s.card_id));
    const [base, own] = await Promise.all([
      getCatalogBase(),
      ids.length ? supabase.from('player_cards').select('card_id, quantity').eq('player_id', String(me.id)).in('card_id', ids) : { data: [] },
    ]);
    const cat = new Map(base.map((c) => [Number(c.id), c]));
    const owned = new Map((own.data || []).map((r) => [Number(r.card_id), r.quantity]));
    const stock = (data.stock || []).map((s) => {
      const c = cat.get(Number(s.card_id));
      return { ...s, card: c ? { id: c.id, name: c.name, rarity: c.rarity, image_url: c.image_url, power: c.power } : null, owned: owned.get(Number(s.card_id)) || 0 };
    });
    res.json({ ...data, stock });
  });

  // Buy: { kind: 'pack', qty } | { kind: 'card', slot } | { kind: 'stat_reset', cardId }.
  app.post('/api/shop/buy', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const kind = String(req.body?.kind || '');
    if (!KINDS.has(kind)) return fail(res, { error: 'bad_kind' });
    const args = { p_player: String(me.id), p_kind: kind, p_slot: null, p_card: null, p_qty: 1 };
    if (kind === 'pack') { args.p_qty = int(req.body?.qty ?? 1); if (args.p_qty === null) return fail(res, { error: 'bad_qty' }); }
    if (kind === 'card') { args.p_slot = int(req.body?.slot); if (args.p_slot === null) return fail(res, { error: 'no_slot' }); }
    if (kind === 'stat_reset') { args.p_card = int(req.body?.cardId); if (args.p_card === null) return fail(res, { error: 'not_owned' }); }
    const { data, error } = await supabase.rpc('buy_shop_item', args);
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    bustUser(me.id); // the collection, the pack count or the stats changed
    res.json(data);
  });

  // Convert the extra copies of one card to Shards: { cardId, count }.
  app.post('/api/shards/convert', async (req, res) => {
    const me = await gate(req, res, true); if (!me) return;
    const cardId = int(req.body?.cardId), count = int(req.body?.count);
    if (cardId === null || count === null) return fail(res, { error: 'bad_count' });
    const { data, error } = await supabase.rpc('convert_dupes', { p_player: String(me.id), p_card: cardId, p_count: count });
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.ok) return fail(res, data);
    bustUser(me.id);
    res.json(data);
  });

  // How many copies of a card can convert, and the Shards for each copy (settings.shards.dupe_values;
  // the Collection panel shows the Convert extras button when count > 0).
  let values = null;
  const dupeValues = async () => {
    if (values && Date.now() - values.at < 60000) return values.v;
    const { data } = await supabase.from('settings').select('value').eq('key', 'shards').maybeSingle();
    values = { at: Date.now(), v: data?.value?.dupe_values || {} };
    return values.v;
  };
  app.get('/api/shards/convertible', async (req, res) => {
    const me = await gate(req, res); if (!me) return;
    const cardId = Number(req.query.cardId);
    if (!Number.isInteger(cardId)) return fail(res, { error: 'bad_count' });
    const [{ data, error }, base, v] = await Promise.all([
      supabase.rpc('convertible_copies', { p_player: String(me.id), p_card: cardId }), getCatalogBase(), dupeValues()]);
    if (error) return res.status(500).json({ error: error.message });
    const card = base.find((c) => Number(c.id) === cardId);
    res.json({ cardId, count: data ?? 0, each: Number(v?.[card?.rarity]) || 0 });
  });
}
