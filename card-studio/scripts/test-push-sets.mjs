/**
 * F-2 PR 3: a card never lands in S1 by accident, and a push never moves a card between sets as a side effect.
 * No database and no network (pushCard stops before its first request):
 *   node scripts/test-push-sets.mjs
 * Invariants:
 *   - cardSetId has no default: a card with no `set` (or a bad one) throws; "S2" is returned as is;
 *   - pushCard refuses a card with no set before any render, upload or database write;
 *   - setMoveProblem: a live row in another set stops the push, unless the card editor recorded the move
 *     (setMoveFrom = the live set); the same set, or no live row, passes;
 *   - every card in cards.json has an explicit set (the data migration of this PR).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unused';
const { cardSetId } = await import('../src/cardstore.js');
const { pushCard, setMoveProblem } = await import('../src/push.js');

const res = [];
const check = (name, ok, extra = '') => res.push({ name, ok: Boolean(ok), extra });
const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

check('cardSetId: no set throws (no S1 default)', /has no set/.test(throws(() => cardSetId({ id: 'x', name: 'X' })) || ''));
check('cardSetId: an empty set throws', /has no set/.test(throws(() => cardSetId({ id: 'x', set: '' })) || ''));
check('cardSetId: a bad set id throws', /bad set id/.test(throws(() => cardSetId({ id: 'x', set: 's2' })) || ''));
check('cardSetId: S2 is S2', cardSetId({ id: 'x', set: 'S2' }) === 'S2');

let fetched = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...a) => { fetched += 1; return realFetch(...a); };
let err = null;
try { await pushCard({ id: 'tst-noset', name: 'No set', type: 'Item', finishes: ['normal'] }, () => null, '.', null); } catch (e) { err = e.message; }
globalThis.fetch = realFetch;
check('pushCard refuses a card with no set before any request', /has no set/.test(err || '') && fetched === 0, `error=${err} requests=${fetched}`);

const card = { name: 'Pika' };
check('setMoveProblem: a live row in S1, the card says S2 = refused', /does not move a card between sets/.test(setMoveProblem(card, 'S1', 'S2') || ''));
check('setMoveProblem: the move recorded by "Change home set" (setMoveFrom S1) = allowed', setMoveProblem({ ...card, setMoveFrom: 'S1' }, 'S1', 'S2') === null);
check('setMoveProblem: a recorded move from another set does not open this one', /does not move/.test(setMoveProblem({ ...card, setMoveFrom: 'S3' }, 'S1', 'S2') || ''));
check('setMoveProblem: the same set, or no live row = allowed', setMoveProblem(card, 'S2', 'S2') === null && setMoveProblem(card, null, 'S2') === null);

const all = JSON.parse(readFileSync(fileURLToPath(new URL('../cards.json', import.meta.url)), 'utf8'));
const noSet = all.filter((c) => !/^[A-Z0-9]{1,8}$/.test(c.set || ''));
check(`every cards.json card has an explicit set (${all.length} cards)`, all.length > 0 && noSet.length === 0, noSet.slice(0, 5).map((c) => c.id).join(', '));

let fails = 0;
for (const r of res) { if (!r.ok) fails += 1; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  ${r.extra}`}`); }
console.log(`\n${process.env.MUTATE ? `MUTATE=${process.env.MUTATE} ` : ''}${res.length - fails}/${res.length} pass, FAILS ${fails}`);
process.exitCode = fails ? 1 : 0;
