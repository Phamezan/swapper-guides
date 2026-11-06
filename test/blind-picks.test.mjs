import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { compileContent } from '../scripts/compile.mjs';
import { build } from '../scripts/build.mjs';

const root = new URL('../', import.meta.url);
const input = new Map(await Promise.all(['authors.yml', 'champions.json', 'blind-picks/26.22.yml'].map(async file =>
  [file, await readFile(new URL(file, root), 'utf8')])));

test('publishes ten curated picks per lane in report order without changing the legacy index', async () => {
  const { files, index } = compileContent(input);
  assert.deepEqual(Object.keys(index), ['schema', 'generatedAt', 'champions']);
  const data = JSON.parse(files.get('blind-picks.json'));
  assert.equal(data.schema, 1);
  assert.equal(data.lists[0].patch, '26.22');
  const champions = new Map(JSON.parse(input.get('champions.json')).map(c => [c.name, c.id]));
  const authored = YAML.parse(input.get('blind-picks/26.22.yml'));
  for (const [lane, picks] of Object.entries(authored.lanes)) {
    assert.equal(picks.length, 10);
    assert.deepEqual(data.lists[0].lanes[lane], picks.map(p => ({ ...p, champion: champions.get(p.champion) })));
  }
  await build(fileURLToPath(root));
  assert.deepEqual(JSON.parse(await readFile(new URL('../dist/blind-picks.json', import.meta.url))), data);
});

test('rejects unknown champions, lanes, duplicates, invalid reasons and sources', () => {
  for (const [edit, expected] of [
    [d => { d.lanes.top[0].champion = 'Unknown'; }, /unknown champion/],
    [d => { d.lanes.middle = d.lanes.mid; }, /unknown field middle/],
    [d => { d.lanes.top[1] = d.lanes.top[0]; }, /duplicate/],
    [d => { d.lanes.top[0].reason = 'x'.repeat(91); }, /reason/],
    [d => { d.lanes.top[0].reason = ''; }, /reason/],
    [d => { d.lanes.top[0].sources[0].url = 'javascript:alert(1)'; }, /URL/],
  ]) {
    const document = YAML.parse(input.get('blind-picks/26.22.yml'));
    edit(document);
    const changed = new Map(input).set('blind-picks/26.22.yml', YAML.stringify(document, { aliasDuplicateObjects: false }));
    assert.throws(() => compileContent(changed), expected);
  }
});
