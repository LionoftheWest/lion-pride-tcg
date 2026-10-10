// The fixture anonymizer (fixture-lib.mjs): no real member name reaches the public fixture. The names here are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { anonymizer, residue, NAME_SLOT } from './fixture-lib.mjs';

const members = [{ id: '111111111111111111', username: 'zorbluk' }, { id: '222222222222222222', username: 'quandelfi' }];

test('a display name in a notification name slot becomes "Member 9NN"; the same name gets the same label', () => {
  const a = anonymizer(members, '111111111111111111');
  const out = a.walk({ items: [
    { message: '🔄 Plonky Vex picked a card for your trade! Accept to swap.' },
    { message: '✅ Plonky Vex accepted your trade!' },
    { message: '🔄 Wimbel sent you a trade offer! Pick a card to trade back.' },
    { message: '🔨 Wimbel declined your accepted bid. Your auction is open again.' },
  ] });
  assert.deepEqual(out.items.map((x) => x.message), [
    '🔄 Member 901 picked a card for your trade! Accept to swap.',
    '✅ Member 901 accepted your trade!',
    '🔄 Member 902 sent you a trade offer! Pick a card to trade back.',
    '🔨 Member 902 declined your accepted bid. Your auction is open again.',
  ]);
});

test('a username in a slot uses the members label; an anonymous label and a message with no slot stay as they are', () => {
  const a = anonymizer(members, '111111111111111111');
  const out = a.walk({ items: [
    { message: '✅ quandelfi accepted your trade!' },
    { message: '✅ Member 061 accepted your trade!' },
    { message: '🎁 You earned 1 pack! Open them in the Lion Pride TCG activity.' },
  ] });
  assert.deepEqual(out.items.map((x) => x.message), ['✅ Member 002 accepted your trade!', '✅ Member 061 accepted your trade!',
    '🎁 You earned 1 pack! Open them in the Lion Pride TCG activity.']);
});

test('residue flags a display name left in a notification slot', () => {
  assert.equal(residue(JSON.stringify({ message: '✅ Plonky Vex accepted your trade!' }), members).length, 1);
  assert.equal(residue(JSON.stringify({ message: '✅ Member 901 accepted your trade!' }), members).length, 0);
});

test('the committed fixture has no display name in a notification slot', () => {
  const text = readFileSync(new URL('./fixtures/api.json', import.meta.url), 'utf8');
  const left = [...text.matchAll(/"message": ?"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].match(NAME_SLOT)?.[2]).filter((n) => n && !/^Member (A|\d{3})$/.test(n));
  assert.deepEqual(left, []);
});
