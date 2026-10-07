/**
 * Test for src/tier-delete.js (the card studio removes a tier from the live game). No database: the supabase
 * client is a mock that records each call in order.
 *   node scripts/test-studio-tier-delete.mjs         the module
 *   node scripts/test-studio-tier-delete.mjs --old   the old server.js lines (the baseline: it must FAIL)
 * Invariants:
 *   D1 when the database refuses the delete (a foreign key: Hunt / Shop / combat / plays / auction history),
 *      no image is removed, and the result is a refusal that names the history
 *   D2 when the delete succeeds, the rows are deleted BEFORE the images, and both image names of each tier go
 *   D3 when the rows cannot be read, nothing is deleted
 *   D4 a storage error after a good delete is reported as a warning (the rows are gone, that is not undone)
 *   D5 each blocking table has a plain name in the message
 */
import { removeTiers, refusalMessage, HISTORY } from '../src/tier-delete.js';

const OLD = process.argv.includes('--old');

// The old PUT /api/cards/:id lines (server.js before this fix), as one function with the same inputs.
async function oldRemoveTiers({ db, bucket, cardId, subjectId, tiers }) {
  const { data: rows } = await db.from('cards').select('id').eq('subject_id', subjectId).in('rarity', tiers);
  const rowIds = (rows || []).map((r) => r.id);
  if (rowIds.length) await db.from('cards').delete().in('id', rowIds);
  await db.storage.from(bucket).remove(tiers.flatMap((r) => [`cards/${cardId}-${r}.webp`, `cards/${cardId}-${r}.png`]));
  return { ok: true };
}
const run = OLD ? oldRemoveTiers : removeTiers;

// A mock supabase client: from('cards').select().eq().in() and .delete().in(), storage.from().remove().
function mockDb({ rows = [{ id: 11 }, { id: 12 }], readError = null, deleteError = null, removeError = null } = {}) {
  const calls = [];
  const db = {
    from(table) {
      return {
        select: () => ({ eq: () => ({ in: async () => { calls.push(['select', table]); return { data: readError ? null : rows, error: readError }; } }) }),
        delete: () => ({ in: async (_col, ids) => { calls.push(['delete', table, ids]); return { data: null, error: deleteError }; } }),
      };
    },
    storage: { from: (bucket) => ({ remove: async (paths) => { calls.push(['remove', bucket, paths]); return { data: null, error: removeError }; } }) },
  };
  return { db, calls };
}
const fkError = (table) => ({
  code: '23503',
  message: 'update or delete on table "cards" violates foreign key constraint "' + table + '_card_id_fkey" on table "' + table + '"',
  details: `Key (id)=(11) is still referenced from table "${table}".`,
});
const args = (db) => ({ db, bucket: 'card-art', cardId: 'test-card', subjectId: 7, tiers: ['secret_rare', 'gold'] });

const results = [];
const check = (name, ok, info = '') => results.push({ name, ok: Boolean(ok), info });

// D1
for (const table of ['hunt_hits', 'shop_purchases', 'combat_actions', 'card_plays', 'auctions']) {
  const { db, calls } = mockDb({ deleteError: fkError(table) });
  const r = await run(args(db));
  const removed = calls.some((c) => c[0] === 'remove');
  check(`D1 a refused delete (${table}) keeps the images`, !removed, JSON.stringify(calls));
  check(`D1 a refused delete (${table}) is reported, with the history named`, r.ok === false && r.error?.includes(HISTORY[table]), JSON.stringify(r));
}
// D2
{
  const { db, calls } = mockDb();
  const r = await run(args(db));
  const iDel = calls.findIndex((c) => c[0] === 'delete'), iRm = calls.findIndex((c) => c[0] === 'remove');
  check('D2 a good delete: the rows go first, then the images', r.ok === true && iDel >= 0 && iRm > iDel, JSON.stringify(calls));
  check('D2 the delete names the rows of the removed tiers', JSON.stringify(calls[iDel]?.[2]) === '[11,12]', JSON.stringify(calls[iDel]));
  const want = ['cards/test-card-secret_rare.webp', 'cards/test-card-secret_rare.png', 'cards/test-card-gold.webp', 'cards/test-card-gold.png'];
  check('D2 both image names of each tier are removed from the card-art bucket', calls[iRm]?.[1] === 'card-art' && JSON.stringify(calls[iRm]?.[2]) === JSON.stringify(want), JSON.stringify(calls[iRm]));
}
{
  const { db, calls } = mockDb({ rows: [] });
  const r = await run(args(db));
  check('D2 no live rows for the tiers: no delete, the images go', r.ok === true && !calls.some((c) => c[0] === 'delete') && calls.some((c) => c[0] === 'remove'), JSON.stringify(calls));
}
// D3
{
  const { db, calls } = mockDb({ readError: { message: 'network down' } });
  const r = await run(args(db));
  check('D3 the rows cannot be read: nothing is deleted', r.ok === false && !calls.some((c) => c[0] === 'delete' || c[0] === 'remove'), JSON.stringify({ r, calls }));
}
// D4
{
  const { db } = mockDb({ removeError: { message: 'storage busy' } });
  const r = await run(args(db));
  check('D4 a storage error after a good delete is a warning', r.ok === true && /storage busy/.test(r.warning || ''), JSON.stringify(r));
}
// D5
for (const table of Object.keys(HISTORY)) {
  const m = refusalMessage(fkError(table), ['gold']);
  check(`D5 the message for ${table} names "${HISTORY[table]}" and says the images were kept`, m.includes(HISTORY[table]) && m.includes('images were kept') && m.includes('gold'), m);
}

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : '  ' + r.info.slice(0, 400)}`); }
console.log(`${OLD ? '[--old baseline] ' : ''}${fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`}`);
process.exitCode = fail ? 1 : 0;
