import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTip, namedItems } from '../scripts/validate.mjs';
import { snapshot } from '../scripts/refresh-items.mjs';

const context = { champions: new Map([['Leona', 89]]), sources: new Map([['author', {}]]), participants: [89], scope: 'pair' };
const raw = (text, items) => ({
  text, loc: { file: 'guide.md', line: 12 },
  metadata: { value: { sources: ['author'], ...(items && { items }) }, at: () => ({ file: 'guide.md', line: 13 }) },
});

test('named current items require ids, using case-sensitive longest whole phrases', () => {
  const text = 'Open Sundered Sky or Spear of Shojin; Black Cleaver into tanks.';
  assert.throws(() => compileTip(raw(text), context), /guide.md:12:.*items:.*Sundered Sky.*Spear of Shojin.*Black Cleaver/);
  assert.throws(() => compileTip(raw(text, [6610, 3161]), context), /3071.*Black Cleaver/);
  assert.deepEqual(compileTip(raw(text, [6610, 3161, 3071]), context).itemIds, [6610, 3161, 3071]);
  assert.deepEqual(namedItems("Black Cleavers black cleaver éBlack Cleaver Black Cleaveré"), []);
  assert.deepEqual(namedItems('Ionian Boots of Lucidity'), [{ id: 3158, name: 'Ionian Boots of Lucidity' }]);
  assert.doesNotThrow(() => compileTip(raw('Boots help; Cull the wave.', undefined), context));
  assert.throws(() => compileTip(raw('Buy Eclipse.', undefined), { ...context, participants: [103] }), /6692.*Eclipse/);
  assert.doesNotThrow(() => compileTip({ ...raw('Eclipse into the trade.'), metadata: { value: { sources: ['author'], abilities: ['Leona.W'] }, at: () => ({ file: 'guide.md', line: 13 }) } }, context));
});

test('item snapshot includes only purchasable Summoner Rift items and validates ids and names', () => {
  const item = { name: 'Black Cleaver', maps: { 11: true }, gold: { purchasable: true }, description: 'unused' };
  assert.deepEqual(snapshot({ 3071: item, 323071: item, 1: { ...item, maps: { 12: true } }, 2: { ...item, gold: { purchasable: false } }, 3: { ...item, inStore: false }, 4: { ...item, requiredAlly: 'Ornn' } }), { 3071: 'Black Cleaver' });
  for (const data of [{}, { bad: item }, { 1: { ...item, name: '' } }]) assert.throws(() => snapshot(data));
});
