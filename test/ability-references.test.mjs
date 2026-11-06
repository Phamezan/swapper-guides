import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTip } from '../scripts/validate.mjs';
import { snapshot } from '../scripts/refresh-abilities.mjs';

const champions = new Map([['Ahri', 103], ['Zed', 238]]);
const context = { champions, sources: new Map([['author', {}]]), participants: [103, 238], scope: 'pair' };
const raw = (text, abilities) => ({
  text, loc: { file: 'guide.md', line: 12 },
  metadata: { value: { sources: ['author'], ...(abilities && { abilities }) }, at: () => ({ file: 'guide.md', line: 13 }) },
});

test('tips must reference every participant ability named as a case-sensitive whole phrase', () => {
  assert.throws(() => compileTip(raw('Hold Charm for Living Shadow.'), context), /guide.md:12:.*Ahri.E.*Zed.W/);
  assert.throws(() => compileTip(raw('Hold Charm for Living Shadow.', ['Ahri.E']), context), /Zed.W/);
  assert.doesNotThrow(() => compileTip(raw('Hold Charm for Living Shadow.', ['Ahri.E', 'Zed.W']), context));
  assert.doesNotThrow(() => compileTip(raw('Charming charm éCharm Charmé Living Shadows; {cd:238:W}.'), context));
  assert.doesNotThrow(() => compileTip(raw('Use Disintegrate.'), context)); // Annie is not a participant.
  assert.throws(() => compileTip(raw('Dodge Cocoon or Rappel.'), { ...context, champions: new Map([['Elise', 60]]), participants: [60] }), /Elise.E/);
  assert.doesNotThrow(() => compileTip(raw('Dodge Cocoon or Rappel.', ['Elise.E']), { ...context, champions: new Map([['Elise', 60]]), participants: [60] }));
});

test('unused references are informational, including names excluded from required matching', () => {
  const warnings = [];
  compileTip(raw('Hold the wave.', ['Ahri.E']), { ...context, onWarning: warning => warnings.push(warning) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /guide.md:12:.*Ahri.E.*Charm.*not named/);
  assert.doesNotThrow(() => compileTip(raw('Leverage Rumor sets up the trade.'), {
    ...context, champions: new Map([['Renata Glasc', 888]]), participants: [888],
  }));
});

test('Data Dragon snapshot keeps only ids and complete ability names', () => {
  const champion = { key: '103', passive: { name: 'Essence Theft' }, spells: ['Orb of Deception', 'Fox-Fire', 'Charm', 'Spirit Rush'].map(name => ({ name, description: 'unused' })) };
  assert.deepEqual(snapshot({ Ahri: champion }), { 103: { P: 'Essence Theft', Q: 'Orb of Deception', W: 'Fox-Fire', E: 'Charm', R: 'Spirit Rush' } });
  for (const data of [{}, { Ahri: { ...champion, key: 'bad' } }, { Ahri: { ...champion, spells: [] } }, { Ahri: champion, Duplicate: champion }]) {
    assert.throws(() => snapshot(data));
  }
});
