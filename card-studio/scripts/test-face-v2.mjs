// UI-68: the card face v2 data and placeholders, with no database and no browser.
//   node --test scripts/test-face-v2.mjs
// The texts are the approved UI-68 texts (lion-pride-tcg-design UI-68/source/face-data.json, confirm-1) of 6 Set 1 cards;
// the plain texts are what ability_v2_check returns for them on live (observed 2026-11-04, gate U2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { markStatuses, makesOf, usesOf, blockStatuses, loadFaceV2 } from '../src/face-data.js';
import { faceParts } from '../src/face-v2.js';

const STATUSES = [
  ['poison', 'Poison', 'Poisoned', 'apply {n} Poison'], ['burn', 'Burn', 'Burning', 'apply {n} Burn'], ['stunned', 'Stunned', 'Stunned', 'Stun {t}'],
  ['chill', 'Chill', 'Chilled', 'apply {n} Chill'], ['sleep', 'Sleep', 'Asleep', 'put {t} to Sleep'], ['paralyzed', 'Paralyzed', 'Paralyzed', 'Paralyze {t}'],
  ['exposed', 'Exposed', 'Exposed', 'Expose {t} to +{v}% damage'], ['weakened', 'Weakened', 'Weakened', 'Weaken {t} by {v}%'],
  ['mark', 'Mark', 'Marked', 'Mark {t} for +{v}% damage'], ['quickened', 'Quickened', 'Quickened', null], ['shielded', 'Shielded', 'Shielded', null],
  ['empowered', 'Empowered', 'Empowered', null], ['focused', 'Focused', 'Focused', null],
].map(([key, label, adj, verb]) => ({ key, label, adj, verb }));

// key -> [role, blocks, SQL text, SQL enables, SQL pays, approved marked text, approved makes, approved uses]
const CASES = {
  pikachu: ['striker', [{ k: 'hit', x: 1.5 }, { k: 'crit_add', v: 0.2 }, { k: 'on_crit', chance: 0.5, status: 'paralyzed' }],
    'Hit the target for 150% with +20% crit chance. Crits have a 50% chance to Paralyze the target.', ['paralyzed'], [],
    'Hit the target for 150% with +20% crit chance. Crits have a 50% chance to {paralyzed:Paralyze} the target.', ['paralyzed'], []],
  polar: ['warden', [{ k: 'shield', v: 0.32 }, { k: 'apply', chance: 1, stacks: 1, status: 'chill' }],
    'Shield an ally for 32% of its max HP. Apply 1 Chill to the enemy.', ['chill'], [],
    '{shielded:Shield} an ally for 32% of its max HP. Apply 1 {chill:Chill} to the enemy.', ['shielded', 'chill'], []],
  neverdie: ['medic', [{ k: 'cure', immune: 4, statuses: ['all'] }, { k: 'shield', v: 0.12, to: 'cured' }, { k: 'quicken', v: 0.3 }, { k: 'empower', v: 0.15 }],
    'Cure an ally of every harmful status for 4 steps. Quicken it and Empower it for +15% damage.', [], [],
    'Cure an ally of every harmful status for 4 steps. {quickened:Quicken} it and {empowered:Empower} it for +15% damage.', ['shielded', 'quickened', 'empowered'], []],
  venusaur: ['striker', [{ k: 'hit', x: 1.3 }, { k: 'payoff_dmg', v: 0.5, status: 'poison' }, { k: 'payoff_crit', v: 0.25, status: 'poison' }],
    'Hit the target for 130%. Against Poisoned targets, it deals +50% damage and has +25% crit chance.', [], ['poison'],
    'Hit the target for 130%. Against {poison:Poisoned} targets, it deals +50% damage and has +25% crit chance.', [], ['poison']],
  meow: ['flurry', [{ k: 'strikes', n: 2, x: 0.84 }, { k: 'apply', chance: 0.35, stacks: 1, status: 'poison' }],
    'Strike twice for 84% each. Each strike has a 35% chance to apply 1 Poison.', ['poison'], [],
    'Strike twice for 84% each. Each strike has a 35% chance to apply 1 {poison:Poison}.', ['poison'], []],
  launch: ['striker', [{ k: 'hit', x: 1.5 }, { k: 'per_stack', v: 0.25, status: 'chill' }],
    'Hit the target for 150%. Deals +25% damage for each Chill stack on the target.', [], ['chill'],
    'Hit the target for 150%. Deals +25% damage for each {chill:Chill} stack on the target.', [], ['chill']],
};

test('status words get their icon markup (the 6 approved texts)', () => {
  for (const [name, [, blocks, text, , , want]] of Object.entries(CASES)) {
    assert.equal(markStatuses(text, blockStatuses(blocks), STATUSES), want, name);
  }
});

test('the Silver bonus keeps its status icon; only statuses of the card are marked', () => {
  assert.equal(markStatuses('+12% Shield', blockStatuses(CASES.polar[1]), STATUSES), '+12% {shielded:Shield}');
  assert.equal(markStatuses('+23% damage', blockStatuses(CASES.pikachu[1]), STATUSES), '+23% damage');
  // "Chill" is not a status of Pikachu: no icon. A lowercase word is never a status word.
  assert.equal(markStatuses('Chill out and poison it.', blockStatuses(CASES.pikachu[1]), STATUSES), 'Chill out and poison it.');
  // the longer word wins (Poisoned, not Poison + "ed"), and a plural "s" stays inside the mark
  assert.equal(markStatuses('Poisoned and Poisons', new Set(['poison']), STATUSES), '{poison:Poisoned} and {poison:Poisons}');
});

test('Makes = enables + boon blocks, Uses = pays (the approved chips)', () => {
  for (const [name, [, blocks, , en, pays, , makes, uses]] of Object.entries(CASES)) {
    assert.deepEqual(makesOf(blocks, en), makes, `${name} makes`);
    assert.deepEqual(usesOf(blocks, pays), uses, `${name} uses`);
  }
  // a cure is not a chip (Nathan 2026-10-20: no "Cures" chip)
  assert.ok(!makesOf(CASES.neverdie[1], []).some((k) => /cure/.test(k)));
});

test('no v2 data = every v2 placeholder is empty (the face of before UI-68)', () => {
  for (const v of Object.values(faceParts({ id: 'x', name: 'X', lore: 'L' }))) assert.equal(v, '');
  for (const v of Object.values(faceParts({ id: 'x', name: 'X', lore: 'L', v2: null }))) assert.equal(v, '');
});

test('a v2 card gets the v2 class, option C, the locked Silver mark at 0 stars', () => {
  const p = faceParts({ id: 'x', name: 'X', lore: 'L', v2: { role: 'striker', element: 'fire', active: { name: 'A', text: 'B' }, silver: '+1% damage', makes: [], uses: [] } });
  assert.match(p.V2CLASS, /^v2 attacker fa-c$/);
  assert.match(p.SILVER, /<svg/); // the lock
  const on = faceParts({ id: 'x', name: 'X', v2: { role: 'warden', active: { name: 'A', text: 'B' }, silver: '+1%', makes: [], uses: [], stars: 3 } });
  assert.match(on.V2CLASS, /silver-on/);
});

// A fake supabase client: from(table).select().eq().maybeSingle() and rpc(name, args).
function fakeDb({ subject = null, check = null, element = null } = {}) {
  const calls = [];
  const q = (table) => {
    const res = table === 'subjects' ? { data: subject, error: null } : { data: STATUSES, error: null };
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => res, then: (f, r) => Promise.resolve(res).then(f, r) };
    return chain;
  };
  return {
    calls,
    from: (t) => { calls.push(`from ${t}`); return q(t); },
    rpc: async (name, args) => { calls.push(`rpc ${name} ${JSON.stringify(args)}`); return { data: name === 'card_element' ? element : check, error: null }; },
  };
}
const PIKA_CHECK = { ok: true, text: CASES.pikachu[2], silver_text: '+23% damage', enables: ['paralyzed'], pays: [] };
const PIKA_SUBJ = { ability_v2: { name: 'Thunderbolt', role: 'striker', blocks: CASES.pikachu[1], pick_factor: 1.01, silver: { block: 1, field: 'x', value: 1.725 } }, tags: { traits: ['lightning'] } };

test('loadFaceV2: the database ability gives the face data (pick_factor and role are not sent to the check)', async () => {
  delete process.env.FACE_V2; delete process.env.FACE_V2_FILE;
  const db = fakeDb({ subject: PIKA_SUBJ, check: PIKA_CHECK, element: 'lightning' });
  const v = await loadFaceV2(db, { id: 'lionofthewest-s-pikachu', tags: { traits: ['lightning'] } });
  assert.deepEqual(v, { role: 'striker', element: 'lightning', active: { name: 'Thunderbolt', text: CASES.pikachu[5] }, silver: '+23% damage', makes: ['paralyzed'], uses: [] });
  const chk = db.calls.find((c) => c.startsWith('rpc ability_v2_check'));
  assert.ok(chk && !chk.includes('pick_factor') && chk.includes('"p_role":"striker"') && chk.includes('"silver"'));
});

test('loadFaceV2: no ability = null (no check call); FACE_V2=0 = null with no database call', async () => {
  delete process.env.FACE_V2_FILE;
  const db = fakeDb({ subject: { ability_v2: null, tags: {} } });
  assert.equal(await loadFaceV2(db, { id: 'old' }), null);
  assert.ok(!db.calls.some((c) => c.startsWith('rpc')));
  process.env.FACE_V2 = '0';
  const db2 = fakeDb({ subject: PIKA_SUBJ, check: PIKA_CHECK });
  assert.equal(await loadFaceV2(db2, { id: 'lionofthewest-s-pikachu' }), null);
  assert.equal(db2.calls.length, 0);
  delete process.env.FACE_V2;
});

test('loadFaceV2: FACE_V2_FILE fills a subject with no ability_v2; a difference with the database stops the render', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const f = join(mkdtempSync(join(tmpdir(), 'face-v2-')), 'act.json');
  const row = { key: 'lionofthewest-s-pikachu', role: 'striker', ability: { name: 'Thunderbolt', blocks: CASES.pikachu[1], silver: { block: 1, field: 'x', value: 1.725 } } };
  writeFileSync(f, JSON.stringify({ about: 'test', rows: [row] }));
  process.env.FACE_V2_FILE = f;
  const v = await loadFaceV2(fakeDb({ subject: null, check: PIKA_CHECK, element: 'lightning' }), { id: 'lionofthewest-s-pikachu', tags: { traits: ['lightning'] } });
  assert.equal(v.active.name, 'Thunderbolt');
  // the same ability in both places: fine
  assert.ok(await loadFaceV2(fakeDb({ subject: PIKA_SUBJ, check: PIKA_CHECK }), { id: 'lionofthewest-s-pikachu' }));
  // a different number in the database: stop
  const other = { ...PIKA_SUBJ, ability_v2: { ...PIKA_SUBJ.ability_v2, blocks: [{ k: 'hit', x: 1.4 }, ...CASES.pikachu[1].slice(1)] } };
  await assert.rejects(loadFaceV2(fakeDb({ subject: other, check: PIKA_CHECK }), { id: 'lionofthewest-s-pikachu' }), /differ/);
  delete process.env.FACE_V2_FILE;
});

test('loadFaceV2: an ability that the check refuses stops the render', async () => {
  await assert.rejects(loadFaceV2(fakeDb({ subject: PIKA_SUBJ, check: { ok: false, errors: ['budget'] } }), { id: 'p' }), /not valid: budget/);
});
