// UI-15 Profile style editor (v3): the markup of src/ui3/style-editor.js. node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPOT_CAP, slotsHTML, titleSelectHTML, frameChipsHTML, styleEditorHTML } from './style-editor.js';

const card = (id, extra = {}) => ({ id, name: `Card ${id}`, rarity: 'rare', image_url: '', ...extra });
const count = (s, re) => (s.match(re) || []).length;

test('slots: always 3 places; a picked card has a remove button; an empty slot shows its number and keeps its place (E15)', () => {
  assert.equal(SPOT_CAP, 3);
  const h = slotsHTML([card(7), card(9)]);
  assert.equal(count(h, /<li /g), 3);
  assert.equal(count(h, /data-sepick=/g), 3);   // every slot opens the Card picker (D-80 item 16)
  assert.equal(count(h, /data-seunpick=/g), 2);
  assert.match(h, /data-seunpick="7"/);
  assert.match(h, /<span>3<\/span>/);
  assert.equal(count(slotsHTML([]), /data-seunpick=/g), 0);
});

test('title select: None, the owned titles, then the locked ones as disabled options with how to get them', () => {
  const h = titleSelectHTML(['Hunter'], [{ value: 'Raider', by: 'Raid track' }], 'Hunter');
  assert.match(h, /<option value="">None<\/option>/);
  assert.match(h, /<option value="Hunter" selected>/);
  assert.match(h, /<option disabled>[^<]*Raider · Raid track<\/option>/);
  assert.doesNotMatch(titleSelectHTML(['A'], [], null), /optgroup/);
});

test('frame chips: owned ones can be picked, locked ones are disabled, text is escaped', () => {
  const h = frameChipsHTML([{ value: 'gold', label: 'Gold frame' }], [{ value: 'holo', label: 'Holo frame', by: 'a "b"' }], 'gold');
  assert.match(h, /data-seframe=""/);
  assert.match(h, /data-seframe="gold"/);
  assert.match(h, /Unlock: a &quot;b&quot;/);
  assert.equal(count(h, /disabled/g) >= 1, true);
  assert.doesNotMatch(h, /data-seframe="holo"/);
});

test('window: dialog, Close, Save; the message shows only when there is one; the name is escaped', () => {
  const d = { avatar: '<i></i>', name: '<b>N</b>', cards: [card(1)], titles: { owned: [], locked: [] }, title: null, frames: { owned: [], locked: [] }, frame: null, msg: '', busy: false };
  const h = styleEditorHTML(d);
  assert.match(h, /role="dialog"/);
  assert.match(h, /data-seclose="1"/);
  assert.match(h, /data-sesave="1"/);
  assert.match(h, /1\/3/);
  assert.match(h, /&lt;b&gt;N&lt;\/b&gt;/);
  assert.doesNotMatch(h, /Could not save/);
  assert.match(styleEditorHTML({ ...d, msg: 'Could not save. Try again.' }), /Could not save\. Try again\./);
});
