import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { compileContent } from '../scripts/compile.mjs';
import { build } from '../scripts/build.mjs';

const base = new Map();
for (const file of ['authors.yml', 'champions.json', 'guides/Ahri/Zed-mid.md', 'enemies/Zed.md']) {
  base.set(file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
}
const generatedAt = '2026-10-27T20:00:00Z';
const video = { videoId: 'A_b-cD12345', title: 'Hold Charm.', player: 'Test player', team: 'T1', rankClaim: 'Challenger', patch: '26.21', result: 'W', durationSec: 4000,
  moments: [{ at: '3:04', label: 'Trading window', section: 'early-lane' }, { at: '1:02:03', label: 'Final fight' }] };
const file = 'vods/Ahri/Zed-mid.yml';
const compile = (videos = [video], name = file) => compileContent(new Map([...base, [name, JSON.stringify(videos)]]), { generatedAt });

test('VODs compile beside guides with timestamps converted and a matchup count', () => {
  const result = compile();
  const champion = JSON.parse(result.files.get('champions/103.json'));
  assert.deepEqual(champion.vods, [{ enemy: 238, lane: 'mid', videos: [{ ...video, moments: [{ atSec: 184, label: 'Trading window', section: 'early-lane' }, { atSec: 3723, label: 'Final fight' }] }] }]);
  assert.equal(result.index.champions[103].vods, 1);
  const before = compileContent(base, { generatedAt });
  const empty = compile([]);
  assert.deepEqual(empty.files, before.files, 'empty VOD lists leave old bytes unchanged');
  assert.deepEqual(empty.index, before.index);
});

test('VOD-only champions compile and matchups sort by enemy then lane', () => {
  const input = new Map([...base].filter(([name]) => !name.startsWith('guides/')));
  for (const name of ['vods/Ahri/Zed-top.yml', 'vods/Ahri/Zed-mid.yml', 'vods/Ahri/Ahri-mid.yml']) input.set(name, JSON.stringify([{ ...video, moments: undefined, team: undefined }]));
  const result = compileContent(input, { generatedAt });
  const champion = JSON.parse(result.files.get('champions/103.json'));
  assert.deepEqual(champion.guides, []);
  assert.deepEqual(champion.vods.map(({ enemy, lane }) => [enemy, lane]), [[103, 'mid'], [238, 'mid'], [238, 'top']]);
  assert.deepEqual(champion.vods[0].videos[0].moments, []);
  assert.equal(result.index.champions[103].guides, 0);
  assert.equal(result.index.champions[103].vods, 3);
});

test('invalid VOD fields, moments and paths fail with source locations', () => {
  for (const change of [
    { videoId: '../bad' }, { title: '<b>bad</b>' }, { player: '' }, { team: '**T1**' }, { rankClaim: '[rank](https://bad)' },
    { patch: 26.21 }, { patch: 'current' }, { result: 'win' }, { durationSec: 0 }, { durationSec: 1.5 }, { fixture: true },
    { moments: [{ at: '66:60', label: 'Bad' }] }, { moments: [{ at: '1:2', label: 'Bad' }] },
    { moments: [{ at: '1:06:40', label: 'At end' }] }, { moments: [{ at: '-1:00', label: 'Bad' }] },
    { moments: [{ at: '0:01', label: '', section: 'overview' }] }, { moments: [{ at: '0:01', label: 'Bad', section: 'build' }] },
    { moments: null }, { moments: [{ atSec: 1, label: 'Bad' }] },
  ]) assert.throws(() => compile([{ ...video, ...change }]), /vods\/Ahri\/Zed-mid\.yml:\d+:/, JSON.stringify(change));
  assert.throws(() => compile({}), /must be an array/);
  assert.throws(() => compile([video, video]), /duplicate/);
  for (const name of ['vods/ahri/Zed-mid.yml', 'vods/Ahri/zed-mid.yml', 'vods/Ahri/Zed-bottom.yml', 'vods/Ahri/nested/Zed-mid.yml']) assert.throws(() => compile([video], name), /vods\/.+:\d+:/);
});

test('disk build discovers YAML VODs', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const temp = await mkdtemp(path.join(root, '.vod-test-'));
  try {
    for (const [name, text] of [...base, [file, JSON.stringify([video])]]) {
      await mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await writeFile(path.join(temp, name), text);
    }
    assert.equal((await build(temp, { generatedAt })).champions[103].vods, 1);
  } finally {
    assert.equal(path.dirname(temp), root);
    await rm(temp, { recursive: true, force: true });
  }
});
