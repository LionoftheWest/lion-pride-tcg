import test from 'node:test';
import assert from 'node:assert/strict';
import { timeline, phaseAt, rarityKey, swapSound, layerHTML } from './tradefx.js';
import { TOKENS } from '../tokens.js';

test('the timeline is made from the motion tokens (4.11)', () => {
  const tl = timeline();
  assert.equal(tl.swap, TOKENS['dur-celebrate']);
  assert.equal(tl.land, TOKENS['dur-celebrate'] + TOKENS['dur-reveal']);
  assert.equal(tl.enter, TOKENS['dur-slow']);
  assert.ok(tl.start < tl.enter && tl.enter < tl.swap && tl.swap < tl.land && tl.land < tl.tap && tl.tap < tl.close && tl.close < tl.gone);
});

test('under reduced motion every movement is a fade of 200 ms or less', () => {
  const tl = timeline({ reduced: true });
  assert.ok(tl.enter <= 200);
  assert.ok(tl.land - tl.swap <= 200);
  assert.ok(tl.gone - tl.close <= 200);
});

test('phaseAt walks pre, start, swap, land, out, gone', () => {
  const tl = timeline();
  assert.equal(phaseAt(-1, tl), 'pre');
  assert.equal(phaseAt(0, tl), 'start');
  assert.equal(phaseAt(tl.swap - 1, tl), 'start');
  assert.equal(phaseAt(tl.swap, tl), 'swap');
  assert.equal(phaseAt(tl.land, tl), 'land');
  assert.equal(phaseAt(tl.close, tl), 'out');
  assert.equal(phaseAt(tl.gone, tl), 'gone');
});

test('rarity key and sound', () => {
  assert.equal(rarityKey('gold'), 'gold');
  assert.equal(rarityKey('nonsense'), 'normal');
  assert.equal(swapSound('full_art'), 'rare');
  assert.equal(swapSound('normal'), 'flip');
});

test('the markup holds both cards, the badge, GIVE, GET and the result; names are escaped', () => {
  const html = layerHTML({ give: { name: 'A<b>', rarity: 'normal', image_url: '' }, get: { name: 'Fluffy', rarity: 'illustrated_rare', image_url: '' }, label: (r) => `L-${r}` });
  assert.match(html, /u3-tfx__card--give/);
  assert.match(html, /u3-tfx__card--get/);
  assert.match(html, /u3-tfx__badge/);
  assert.match(html, /<span>Give<\/span><span>Get<\/span>/);
  assert.match(html, /Trade complete/);
  assert.match(html, /Fluffy/);
  assert.match(html, /L-illustrated_rare/);
  assert.doesNotMatch(html, /A<b>/);
});
