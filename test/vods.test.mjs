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
  moments: [{ at: '3:04', label: 'Trading window', section: 'early-lane', kind: 'trade' }, { at: '1:02:03', label: 'Final fight' }] };
const file = 'vods/Ahri/Zed-mid.yml';
const compile = (videos = [video], name = file) => compileContent(new Map([...base, [name, JSON.stringify(videos)]]), { generatedAt });

test('VODs compile beside guides with timestamps converted and a matchup count', () => {
  const result = compile();
  const champion = JSON.parse(result.files.get('champions/103.json'));
  assert.deepEqual(champion.vods, [{ enemy: 238, lane: 'mid', videos: [{ ...video, moments: [{ atSec: 184, label: 'Trading window', section: 'early-lane', kind: 'trade' }, { atSec: 3723, label: 'Final fight' }] }] }]);
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
    { patch: 26.21 }, { patch: 'current' }, { result: 'win' }, { durationSec: 0 }, { durationSec: 1.5 }, { fixture: true }, { uploaded: '2026-13-01' }, { uploaded: 20260825 },
    { moments: [{ at: '66:60', label: 'Bad' }] }, { moments: [{ at: '1:2', label: 'Bad' }] },
    { moments: [{ at: '1:06:40', label: 'At end' }] }, { moments: [{ at: '-1:00', label: 'Bad' }] },
    { moments: [{ at: '0:01', label: '', section: 'overview' }] }, { moments: [{ at: '0:01', label: 'Bad', section: 'build' }] },
    { moments: null }, { moments: [{ atSec: 1, label: 'Bad' }] },
    { moments: [{ at: '0:01', label: 'Bad', kind: 'ward' }] }, { moments: [{ at: '0:01', label: 'Bad', kind: 'Kill' }] }, { moments: [{ at: '0:01', label: 'Bad', kind: 1 }] },
  ]) assert.throws(() => compile([{ ...video, ...change }]), /vods\/Ahri\/Zed-mid\.yml:\d+:/, JSON.stringify(change));
  assert.throws(() => compile({}), /must be an array/);
  assert.throws(() => compile([video, video]), /duplicate/);
  for (const name of ['vods/ahri/Zed-mid.yml', 'vods/Ahri/zed-mid.yml', 'vods/Ahri/Zed-bottom.yml', 'vods/Ahri/nested/Zed-mid.yml']) assert.throws(() => compile([video], name), /vods\/.+:\d+:/);
});

test('disk build discovers YAML VODs', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const temp = await mkdtemp(path.join(root, '.vod-test-'));
  try {
    for (const [name, text] of [...base, [file, JSON.stringify([video])], ['vods/channels.yml', '[]'], ['vods/players.yml', '[]'],
      ['vods-auto/Ahri/Zed-mid.yml', JSON.stringify([{ ...video, videoId: 'abcdefghijk' }])]]) {
      await mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await writeFile(path.join(temp, name), text);
    }
    assert.equal((await build(temp, { generatedAt })).champions[103].vods, 1);
    assert.equal(JSON.parse(await readFile(path.join(temp, 'dist/champions/103.json'), 'utf8')).vods[0].videos.length, 2);
  } finally {
    assert.equal(path.dirname(temp), root);
    await rm(temp, { recursive: true, force: true });
  }
});

test('player and result may be absent but explicit invalid values still fail', () => {
  const { player, result, ...optional } = video;
  assert.equal(JSON.parse(compile([optional]).files.get('champions/103.json')).vods[0].videos[0].player, undefined);
  for (const change of [{ player: null }, { player: '' }, { result: null }, { result: '?' }]) {
    assert.throws(() => compile([{ ...optional, ...change }]));
  }
});

test('generated and hand-made matchups merge once, hand-made first, independent of input order', () => {
  const auto = ['vods-auto/Ahri/Zed-mid.yml', JSON.stringify([{ ...video, title: 'Automatic duplicate' }, { ...video, videoId: 'abcdefghijk' }])];
  const manual = [file, JSON.stringify([video])];
  for (const entries of [[auto, manual], [manual, auto]]) {
    const result = compileContent(new Map([...base, ...entries]), { generatedAt });
    const vods = JSON.parse(result.files.get('champions/103.json')).vods;
    assert.equal(vods.length, 1);
    assert.deepEqual(vods[0].videos.map(v => [v.videoId, v.title]), [[video.videoId, video.title], ['abcdefghijk', video.title]]);
    assert.equal(result.index.champions[103].vods, 1);
  }
});

test('estimated patch is an optional boolean preserved by compilation', () => {
  for (const patchEstimated of [true, false]) {
    const output = compile([{ ...video, patchEstimated }]);
    assert.equal(JSON.parse(output.files.get('champions/103.json')).vods[0].videos[0].patchEstimated, patchEstimated);
  }
  for (const patchEstimated of ['true', 1, null, {}]) assert.throws(() => compile([{ ...video, patchEstimated }]), /patchEstimated must be boolean/);
});
