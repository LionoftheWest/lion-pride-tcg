// The pack draw pool by set (draw-pool.ts, card_sets.sql). The fake store holds the rows of the draw_pool
// view (the database test test-card-sets.mjs checks the view itself) and of card_sets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeStore } from './fakes.test.js';
import { loadDrawPool, openPacksArgs, SET_NOT_PULLABLE } from './draw-pool.js';
import { type Rarity, drawPack, pullTable } from './draw.js';

const MIGRATION = readFileSync(new URL('../supabase/balance_economy.sql', import.meta.url), 'utf8');
const TABLE = pullTable(JSON.parse(MIGRATION.match(/\('pulls', '(\{[^']*\})',/)![1]!));
const RARITIES: Rarity[] = ['normal', 'illustrated_rare', 'secret_rare', 'full_art', 'gold'];

// S1 and S2 are pullable, S9 is not (the view would not list S9 cards; they are here to prove the set filter).
// set_draw_pool (set_pools.sql): one row per (pool set, card). The S2 pool has its home cards and the first
// S1 card of each rarity (a reprint: the same card, home set S1).
function tables() {
  const t = baseTables();
  const s1 = t.draw_pool.filter((c) => c.set_id === 'S1');
  t.set_draw_pool = [
    ...t.draw_pool.map((c) => ({ ...c, pool_set_id: c.set_id })),
    ...s1.filter((c) => c.name.endsWith(' 0')).map((c) => ({ ...c, pool_set_id: 'S2' })),
  ];
  return t;
}
function baseTables() {
  let id = 0;
  const cards = (set: string) => RARITIES.flatMap((rarity) => Array.from({ length: 4 }, (_, i) => ({
    id: ++id, name: `${set} ${rarity} ${i}`, rarity, source: 'draw', image_url: null, artist_credit: null, lore: null, set_id: set, set_number: i + 1,
  })));
  return {
    card_sets: [{ id: 'S1', pullable: true }, { id: 'S2', pullable: true }, { id: 'S9', pullable: false }],
    draw_pool: [...cards('S1'), ...cards('S2')],
    set_draw_pool: [] as Record<string, unknown>[],
  };
}
let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('loadDrawPool', () => {
  it('a pack with set S2 contains only cards of the S2 pool (2,000 packs, every rarity)', async () => {
    const t = tables();
    const s2pool = new Set(t.set_draw_pool.filter((r) => r.pool_set_id === 'S2').map((r) => r.id));
    const pool = await loadDrawPool(fakeStore(t) as never, 'S2');
    const ids = new Set<number>();
    for (let i = 0; i < 2000; i += 1) for (const c of drawPack(pool, TABLE, rng, i % 50 === 0 ? 100 : null)) ids.add(Number(c.id));
    assert.ok([...ids].every((id) => s2pool.has(id)));
    for (const r of RARITIES) assert.equal(pool[r].length, 5, r); // 4 home cards + 1 S1 reprint of each rarity
  });
  it('a pool card in an S2 pack keeps its home set and number (S1 #1)', async () => {
    const pool = await loadDrawPool(fakeStore(tables()) as never, 'S2');
    const reprints = RARITIES.flatMap((r) => pool[r].filter((c) => c.set_id === 'S1'));
    assert.equal(reprints.length, 5);
    assert.ok(reprints.every((c) => c.set_number === 1));
  });
  it('no set = every pullable set (the draw_pool rows of S1 and S2)', async () => {
    const pool = await loadDrawPool(fakeStore(tables()) as never);
    const sets = new Set(RARITIES.flatMap((r) => pool[r].map((c) => c.set_id)));
    assert.deepEqual([...sets].sort(), ['S1', 'S2']);
    assert.equal(RARITIES.reduce((n, r) => n + pool[r].length, 0), 40);
  });
  it('a set that is not pullable, an unknown set or a bad id is refused', async () => {
    for (const s of ['S9', 'S7', 's1', 'S1; drop', '']) {
      await assert.rejects(loadDrawPool(fakeStore(tables()) as never, s), new RegExp(`^Error: ${SET_NOT_PULLABLE}$`), s);
    }
  });
  it('a bad id makes no query at all', async () => {
    const sb = fakeStore(tables());
    await assert.rejects(loadDrawPool(sb as never, 'bad id'));
    assert.equal(sb.log.length, 0);
  });
});

describe('openPacksArgs', () => {
  it('no set: exactly the 3 old arguments (the unchanged 3-argument open_packs)', () => {
    assert.deepEqual(openPacksArgs('u1', [1, 2], 5), { p_player_id: 'u1', p_cards: [1, 2], p_size: 5 });
    assert.deepEqual(Object.keys(openPacksArgs('u1', [1], 5, undefined)), ['p_player_id', 'p_cards', 'p_size']);
  });
  it('a set: the 4th argument p_set', () => {
    assert.deepEqual(openPacksArgs('u1', [1, 2], 5, 'S2'), { p_player_id: 'u1', p_cards: [1, 2], p_size: 5, p_set: 'S2' });
  });
});
