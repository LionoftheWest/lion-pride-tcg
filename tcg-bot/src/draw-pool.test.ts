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
function tables() {
  let id = 0;
  const cards = (set: string) => RARITIES.flatMap((rarity) => Array.from({ length: 4 }, (_, i) => ({
    id: ++id, name: `${set} ${rarity} ${i}`, rarity, source: 'draw', image_url: null, artist_credit: null, lore: null, set_id: set, set_number: i + 1,
  })));
  return {
    card_sets: [{ id: 'S1', pullable: true }, { id: 'S2', pullable: true }, { id: 'S9', pullable: false }],
    draw_pool: [...cards('S1'), ...cards('S2')],
  };
}
let seed = 7;
const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('loadDrawPool', () => {
  it('a pack with set S2 contains only S2 cards (2,000 packs, every rarity)', async () => {
    const pool = await loadDrawPool(fakeStore(tables()) as never, 'S2');
    const sets = new Set<string>();
    for (let i = 0; i < 2000; i += 1) for (const c of drawPack(pool, TABLE, rng, i % 50 === 0 ? 100 : null)) sets.add(String(c.set_id));
    assert.deepEqual([...sets], ['S2']);
    for (const r of RARITIES) assert.ok(pool[r].length > 0 && pool[r].every((c) => c.set_id === 'S2'), r);
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
