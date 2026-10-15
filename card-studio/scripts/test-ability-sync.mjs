/**
 * Test of the studio ability push (F-3 4a): a refused ability must show the database reason, and must not be saved in the card file.
 *   LOCALDB=1 node --import ./scripts/localdb-preload.mjs scripts/test-ability-sync.mjs
 * 1. syncAbilityLive (src/ability-sync.js), with a mock client: a database refusal (an error with a code) = { refused: message };
 *    a failure with no code (the network) = not refused (best-effort, as before); no subject = not refused; success = synced.
 * 2. The real route and screen (source): POST /api/ability/:id calls syncAbilityLive BEFORE updateCard and answers 400 with the error;
 *    the card screen (public/admin/cards.js) shows r2.error.
 * 3. The real database (LOCAL copy, after f3_ability_kinds.sql): a bad ability through syncAbilityLive on a real subject is refused
 *    with the reason, and the subject is unchanged. Nothing is written.
 */
import './localdb-guard.mjs';
import dotenv from 'dotenv'; dotenv.config({ override: true });
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncAbilityLive } from '../src/ability-sync.js';

let fails = 0;
const check = (name, ok, got) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  ' + JSON.stringify(got).slice(0, 300)}`); };
const mock = ({ subject = { id: 7 }, updateError = null, throwOn = null } = {}) => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => { if (throwOn === 'select') throw new Error('fetch failed'); return { data: subject }; } }) }),
    update: () => ({ eq: async () => { if (throwOn === 'update') throw new Error('fetch failed'); return { error: updateError }; } }),
  }),
});
const ab = { name: 'x', kind: 'attack', effect: 'focus', amount: 5 };

let r = await syncAbilityLive(mock({ updateError: { code: 'P0001', message: 'ability refused (a-card): field "amount" is 5: the maximum for focus is 0.4' } }), 'a-card', ab);
check('a database refusal returns the database message', r.refused && r.refused.includes('maximum for focus'), r);
r = await syncAbilityLive(mock({ updateError: { code: '', message: 'TypeError: fetch failed' } }), 'a-card', ab);
check('a failure with no database code is not a refusal (best-effort)', r.refused === null && r.synced === false, r);
r = await syncAbilityLive(mock({ throwOn: 'update' }), 'a-card', ab);
check('a thrown network error is not a refusal', r.refused === null, r);
r = await syncAbilityLive(mock({ subject: null }), 'a-card', ab);
check('a card with no subject yet is not a refusal', r.refused === null && r.synced === false, r);
r = await syncAbilityLive(mock(), 'a-card', ab);
check('a good write is synced', r.refused === null && r.synced === true, r);

const server = readFileSync(fileURLToPath(new URL('../src/server.js', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const route = server.slice(server.indexOf("app.post('/api/ability/:id'"), server.indexOf("app.post('/api/tradeable/:id/:slot'"));
const iSync = route.indexOf('syncAbilityLive('), iSave = route.indexOf('updateCard(');
check('the route asks the database BEFORE it saves the card file', iSync > 0 && iSave > iSync, { iSync, iSave });
check('the route answers 400 with the database error when it is refused', /if \(live\.refused\) return res\.status\(400\)\.json\(\{ ok: false, error: live\.refused \}\)/.test(route), route.slice(0, 200));
const screen = readFileSync(fileURLToPath(new URL('../public/admin/cards.js', import.meta.url)), 'utf8');
const saveInfo = screen.slice(screen.indexOf('async function saveCardInfo'), screen.indexOf('// The tier previews'));
check('the card screen shows the error and does not say Saved', /if \(r2\.error\) \{ \$\('cs-ci-status'\)\.textContent = 'Ability not saved: ' \+ r2\.error; return; \}/.test(saveInfo)
  && saveInfo.indexOf('r2.error') < saveInfo.indexOf("= 'Saved'"), saveInfo.slice(0, 300));

// 3. the real database
if (process.env.LOCALDB !== '1') { console.log('SKIP the database part (run it with LOCALDB=1 and the preload)'); }
else {
  const { supabase } = await import('../src/supabase.js');
  // Never write a bad ability into the copy when the migration is not applied: look for its trigger first.
  const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
  const probe = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "select count(*)::int n from pg_trigger where tgname = 'subjects_ability_check' and not tgisinternal" }) })).json();
  const applied = Array.isArray(probe) && probe[0].n === 1;
  check('f3_ability_kinds.sql is applied on this copy (its trigger exists)', applied, probe);
  if (applied) {
  const { data: s } = await supabase.from('subjects').select('id, key, ability').eq('ability->>effect', 'focus').order('key').limit(1).single();
  const bad = { ...s.ability, amount: 5 };
  r = await syncAbilityLive(supabase, s.key, bad);
  check('the real database refuses a bad ability with the reason (amount 5 on focus)', r.refused && r.refused.includes('maximum for focus') && r.refused.includes(s.key), r);
  const { data: after } = await supabase.from('subjects').select('ability').eq('id', s.id).single();
  check('the subject is unchanged after the refusal', JSON.stringify(after.ability) === JSON.stringify(s.ability), after);
  r = await syncAbilityLive(supabase, s.key, { ...s.ability, effect: 'heal' });
  check('the real database refuses a wrong slot', r.refused && r.refused.includes('support effect'), r);
  }
}
console.log(fails ? `FAIL ${fails}` : 'PASS all');
process.exit(fails ? 1 : 0);
