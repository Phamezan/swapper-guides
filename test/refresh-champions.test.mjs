import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshot } from '../scripts/refresh-champions.mjs';

test('champion refresh keeps only real champions, sorts ids and drops unrelated fields', () => {
  assert.deepEqual(snapshot([
    { id: 238, name: 'Zed', alias: 'Zed' },
    { id: -1, name: 'None' },
    { id: 103, name: 'Ahri', squarePortraitPath: 'unused' },
  ]), [{ id: 103, name: 'Ahri' }, { id: 238, name: 'Zed' }]);
});

test('champion refresh rejects a malformed summary before replacing the snapshot', () => {
  for (const summary of [{}, [null], [{ id: '103', name: 'Ahri' }], [{ id: 103 }], []]) {
    assert.throws(() => snapshot(summary));
  }
});

test('champion refresh rejects duplicate ids and names', () => {
  assert.throws(() => snapshot([{ id: 103, name: 'Ahri' }, { id: 103, name: 'Zed' }]), /duplicate/);
  assert.throws(() => snapshot([{ id: 103, name: 'Ahri' }, { id: 238, name: 'Ahri' }]), /duplicate/);
});

test('champion refresh excludes Jade mode duplicates from CommunityDragon', () => {
  assert.deepEqual(snapshot([
    { id: 103, name: 'Ahri', alias: 'Ahri' },
    { id: 60103, name: 'Ahri', alias: 'Jade_Ahri' },
  ]), [{ id: 103, name: 'Ahri' }]);
});
