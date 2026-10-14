/**
 * Test for src/card-delete.js (the card studio deletes a WHOLE card). No database, no real art folder: the supabase
 * client is a mock that records each call in order, and the files are in a temp folder.
 *   node scripts/test-studio-card-delete.mjs
 *   CARD_DELETE_MODULE=<path> node scripts/test-studio-card-delete.mjs     (the mutation runs use a changed copy)
 * Invariants:
 *   C1 a card that is not live: only the local entry and files go (art, gallery PNGs, frame / artist / source entries);
 *      the files of a card whose id starts with this id and a dash stay; nothing is called on the live game but the lookup
 *   C2 a live card with no history: the rows, then the images, then the cooldowns, the subject, the log row, then the
 *      local entry and files, in this order
 *   C3 a live card with history: refused (409) with the history named, and NOTHING changes (no later live call, the
 *      local entry and files stay)
 *   C4 a subject delete that is refused: 409, the local card and files stay, the message says what was already deleted
 *   C5 a storage error after the DB delete is a warning, the delete still completes
 *   C6 the live lookup or the live rows cannot be read: 502, nothing deleted
 *   C7 a live tier that cards.json no longer lists is deleted too; a log or local file failure is a warning
 */
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modPath = process.env.CARD_DELETE_MODULE ? pathToFileURL(resolve(process.env.CARD_DELETE_MODULE)).href : '../src/card-delete.js';
const { deleteWholeCard, removeLocalFiles } = await import(modPath);

// ---- the mock supabase client ---------------------------------------------------------------------------------------
function mockDb({ subject = { id: 7 }, subjectErr = null, liveRarities = ['gold', 'secret_rare'], rowsErr = null, cardIds = [11, 12],
  cardsDeleteErr = null, cooldownErr = null, subjectDeleteErr = null, removeErr = null, logErr = null } = {}) {
  const calls = [];
  const db = {
    from(table) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => { calls.push(['lookup', table]); return { data: subjectErr ? null : subject, error: subjectErr }; },
            in: async () => { calls.push(['select-ids', table]); return { data: cardIds.map((id) => ({ id })), error: null }; },
            then: (res) => {
              calls.push(['select-rarities', table]);
              return Promise.resolve({ data: rowsErr ? null : liveRarities.map((rarity) => ({ rarity })), error: rowsErr }).then(res);
            },
          }),
        }),
        delete: () => ({
          in: async (_c, ids) => { calls.push(['delete-cards', ids]); return { error: cardsDeleteErr }; },
          eq: async (_c, v) => {
            calls.push([table === 'subjects' ? 'delete-subject' : 'delete-cooldowns', v]);
            return { error: table === 'subjects' ? subjectDeleteErr : cooldownErr };
          },
        }),
      };
    },
    storage: { from: () => ({ remove: async (paths) => { calls.push(['remove-images', paths]); return { error: removeErr }; } }) },
    rpc: async (fn, args) => { calls.push(['log', fn, args]); return { error: logErr }; },
  };
  return { db, calls };
}
const fk = (table) => ({ code: '23503', message: 'violates foreign key', details: `Key (id)=(11) is still referenced from table "${table}".` });

// ---- a temp art / out folder and a fake cards store ---------------------------------------------------------------
function world() {
  const root = mkdtempSync(join(tmpdir(), 'card-delete-'));
  const artDir = join(root, 'art'), outDir = join(root, 'out');
  mkdirSync(artDir); mkdirSync(outDir);
  for (const f of ['dragon-gold.png', 'dragon-secret_rare.jpg', 'dragon-king-gold.png', 'other-gold.png']) writeFileSync(join(artDir, f), 'x');
  for (const f of ['gallery-dragon-gold.png', 'gallery-dragon-king-gold.png']) writeFileSync(join(outDir, f), 'x');
  writeFileSync(join(artDir, '_sources.json'), JSON.stringify({
    dragon: { gold: { fromId: 'other', fromSlot: 'gold' } },
    other: { gold: { fromId: 'dragon', fromSlot: 'gold' } },
    keep: { gold: { fromId: 'other', fromSlot: 'gold' } },
  }));
  writeFileSync(join(artDir, '_frames.json'), JSON.stringify({ 'dragon-gold': { x: 1 }, 'dragon-king-gold': { x: 2 } }));
  writeFileSync(join(artDir, '_artists.json'), JSON.stringify({ dragon: { gold: 'A' }, 'dragon-king': { gold: 'B' } }));
  const store = [{ id: 'dragon', name: 'Dragon', finishes: ['gold', 'secret_rare'] }, { id: 'dragon-king', name: 'King', finishes: ['gold'] }];
  const removeLocal = () => {
    const l = removeLocalFiles({ id: 'dragon', artDir, outDir });
    store.splice(0, store.length, ...store.filter((c) => c.id !== 'dragon'));
    return l;
  };
  const files = () => [...readdirSync(artDir), ...readdirSync(outDir)].sort();
  const json = (n) => JSON.parse(readFileSync(join(artDir, n), 'utf8'));
  return { artDir, outDir, store, removeLocal, files, json };
}
const card = { id: 'dragon', name: 'Dragon', finishes: ['gold', 'secret_rare'] };
const run = (w, db, extra = {}) => deleteWholeCard({ db, bucket: 'card-art', card, actor: 'studio:test', removeLocal: w.removeLocal, ...extra });

const results = [];
const check = (name, ok, info = '') => results.push({ name, ok: Boolean(ok), info });
const names = (calls) => calls.map((c) => c[0]);
const localWholly = (w) => !w.store.some((c) => c.id === 'dragon') && !w.files().some((f) => /^(gallery-)?dragon-(gold|secret_rare)\./.test(f));
const localUntouched = (w) => w.store.some((c) => c.id === 'dragon') && ['dragon-gold.png', 'dragon-secret_rare.jpg', 'gallery-dragon-gold.png'].every((f) => w.files().includes(f));

// C1
{
  const w = world();
  const { db, calls } = mockDb({ subject: null });
  const r = await run(w, db);
  check('C1 not live: ok, live false', r.ok && r.live === false, JSON.stringify(r));
  check('C1 not live: the local entry and the art / gallery files of the card are gone', localWholly(w), w.files().join(','));
  check('C1 not live: a card with the same id plus a dash keeps its files, frame and artist entries',
    ['dragon-king-gold.png', 'gallery-dragon-king-gold.png', 'other-gold.png'].every((f) => w.files().includes(f))
      && w.json('_frames.json')['dragon-king-gold'] && w.json('_artists.json')['dragon-king'] && w.store.some((c) => c.id === 'dragon-king'), w.files().join(','));
  check('C1 not live: its own frame, artist and source entries are gone',
    !w.json('_frames.json')['dragon-gold'] && !w.json('_artists.json').dragon && !w.json('_sources.json').dragon,
    JSON.stringify([w.json('_frames.json'), w.json('_artists.json'), w.json('_sources.json')]));
  check('C1 not live: a pointer of another card to this art is cleared and reported',
    !w.json('_sources.json').other && w.json('_sources.json').keep && /1 tier\(s\) of other cards/.test((r.warnings || []).join(' ')),
    JSON.stringify([w.json('_sources.json'), r.warnings]));
  check('C1 not live: nothing but the lookup was called on the live game', JSON.stringify(names(calls)) === '["lookup"]', JSON.stringify(names(calls)));
}
// C2
{
  const w = world();
  const { db, calls } = mockDb();
  const orig = w.removeLocal;
  const r = await run(w, db, { removeLocal: () => { calls.push(['local']); return orig(); } });
  const order = names(calls);
  check('C2 live, no history: ok, live true, no storage or log warning (only the fixture pointer note)', r.ok && r.live === true && r.warnings.length === 1 && /reused the art/.test(r.warnings[0]), JSON.stringify(r));
  check('C2 live: the order is lookup, rarities, rows, images, cooldowns, subject, log, local',
    JSON.stringify(order) === '["lookup","select-rarities","select-ids","delete-cards","remove-images","delete-cooldowns","delete-subject","log","local"]', JSON.stringify(order));
  const rm = calls.find((c) => c[0] === 'remove-images');
  check('C2 live: both image names of each tier are removed',
    JSON.stringify(rm?.[1]) === JSON.stringify(['gold', 'secret_rare'].flatMap((t) => [`cards/dragon-${t}.webp`, `cards/dragon-${t}.png`])), JSON.stringify(rm));
  check('C2 live: the subject delete targets the subject id, the cooldowns too',
    calls.find((c) => c[0] === 'delete-subject')?.[1] === 7 && calls.find((c) => c[0] === 'delete-cooldowns')?.[1] === 7, JSON.stringify(calls));
  const lg = calls.find((c) => c[0] === 'log');
  check('C2 live: the admin log row names the card, the actor and the source studio',
    lg?.[1] === 'admin_log_action' && lg[2].p_actor === 'studio:test' && lg[2].p_action === 'card_delete' && lg[2].p_target_id === 'dragon' && lg[2].p_source === 'studio', JSON.stringify(lg));
  check('C2 live: the local entry and files are gone', localWholly(w), w.files().join(','));
}
// C3
for (const table of ['hunt_hits', 'shop_purchases', 'combat_actions', 'card_plays', 'auctions', 'gift_claims', 'wish_grants']) {
  const w = world();
  const { db, calls } = mockDb({ cardsDeleteErr: fk(table) });
  const r = await run(w, db);
  const later = calls.some((c) => ['remove-images', 'delete-cooldowns', 'delete-subject', 'log'].includes(c[0]));
  check(`C3 history (${table}): 409 and the refusal is plain`, r.ok === false && r.status === 409 && /must stay/.test(r.error) && /Nothing was deleted/.test(r.error), JSON.stringify(r));
  check(`C3 history (${table}): no image, cooldown, subject or log call, the local card and files stay`, !later && localUntouched(w), JSON.stringify(names(calls)));
}
// C4
{
  const w = world();
  const { db, calls } = mockDb({ subjectDeleteErr: { message: 'subject is referenced' } });
  const r = await run(w, db);
  check('C4 the subject delete is refused: 409, the reason and what was already deleted are in the message',
    r.ok === false && r.status === 409 && /subject is referenced/.test(r.error) && /already deleted/.test(r.error), JSON.stringify(r));
  check('C4 the subject delete is refused: the local card and files stay, no log row', localUntouched(w) && !names(calls).includes('log'), JSON.stringify(names(calls)));
}
{
  const w = world();
  const { db, calls } = mockDb({ cooldownErr: { message: 'cooldown locked' } });
  const r = await run(w, db);
  check('C4 the cooldown delete is refused: 409, the subject is not deleted, the local card stays',
    r.ok === false && r.status === 409 && !names(calls).includes('delete-subject') && localUntouched(w), JSON.stringify(r));
}
// C5
{
  const w = world();
  const { db } = mockDb({ removeErr: { message: 'storage busy' } });
  const r = await run(w, db);
  check('C5 a storage error after the DB delete is a warning, the delete completes', r.ok === true && r.warnings.some((x) => /storage busy/.test(x)) && localWholly(w), JSON.stringify(r));
}
// C6
{
  const w = world();
  const { db, calls } = mockDb({ subjectErr: { message: 'network down' } });
  const r = await run(w, db);
  check('C6 the lookup fails: 502, nothing deleted, the local card stays',
    r.ok === false && r.status === 502 && localUntouched(w) && JSON.stringify(names(calls)) === '["lookup"]', JSON.stringify([r, names(calls)]));
}
{
  const w = world();
  const { db, calls } = mockDb({ rowsErr: { message: 'rows down' } });
  const r = await run(w, db);
  check('C6 the live rows cannot be read: 502, nothing deleted', r.ok === false && r.status === 502 && !names(calls).includes('delete-cards') && localUntouched(w), JSON.stringify([r, names(calls)]));
}
// C7
{
  const w = world();
  const { db, calls } = mockDb({ liveRarities: ['gold', 'secret_rare', 'common'] });
  const r = await run(w, db);
  const rm = calls.find((c) => c[0] === 'remove-images');
  check('C7 a live tier that cards.json no longer lists is deleted too', r.ok && rm?.[1].includes('cards/dragon-common.webp'), JSON.stringify(rm));
}
{
  const w = world();
  const { db } = mockDb({ logErr: { message: 'log down' } });
  const r = await run(w, db);
  check('C7 a log failure is a warning, the delete completes', r.ok === true && r.warnings.some((x) => /log down/.test(x)) && localWholly(w), JSON.stringify(r));
}
{
  const w = world();
  const { db } = mockDb();
  const r = await run(w, db, { removeLocal: () => { throw new Error('disk locked'); } });
  check('C7 a local file error after the live delete is a warning', r.ok === true && r.warnings.some((x) => /disk locked/.test(x)), JSON.stringify(r));
}

let fail = 0;
for (const r of results) { if (!r.ok) fail++; console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : '  ' + r.info.slice(0, 300)}`); }
console.log(fail ? `${fail} of ${results.length} FAILED` : `PASS all ${results.length}`);
process.exitCode = fail ? 1 : 0;
