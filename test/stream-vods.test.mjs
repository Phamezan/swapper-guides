import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { compileContent } from '../scripts/compile.mjs';

const base = new Map();
for (const file of ['authors.yml', 'champions.json', 'guides/Ahri/Zed-mid.md', 'enemies/Zed.md']) {
  base.set(file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
}
const generatedAt = '2026-10-27T20:00:00Z';
const video = { videoId: 'A_b-cD12345', title: 'Stream game.', player: 'Faker', rankClaim: 'Challenger', patch: '26.21', durationSec: 4000 };
const compile = (videos, name = 'vods/Ahri/Zed-mid.yml', extra = []) => compileContent(new Map([...base, ...extra, [name, JSON.stringify(videos)]]), { generatedAt });
const out = (videos, name, extra) => JSON.parse(compile(videos, name, extra).files.get('champions/103.json')).vods;

test('stream format, cam and text segment compile to seconds', () => {
  const vods = out([{ ...video, format: 'stream', cam: true, start: '1:02', end: '62:03' }]);
  assert.deepEqual(vods, [{ enemy: 238, lane: 'mid', videos: [{ ...video, format: 'stream', cam: true, startSec: 62, endSec: 3723, moments: [] }] }]);
});

test('generated seconds segment compiles directly', () => {
  const vods = out([{ ...video, format: 'stream', startSec: 10, endSec: 100 }]);
  assert.equal(vods[0].videos[0].startSec, 10);
  assert.equal(vods[0].videos[0].endSec, 100);
});

test('two segments of one video compile; exact duplicate segment fails', () => {
  const a = { ...video, format: 'stream', startSec: 0, endSec: 1000 };
  const b = { ...video, format: 'stream', startSec: 1000, endSec: 2000 };
  assert.equal(out([a, b])[0].videos.length, 2);
  assert.throws(() => compile([a, a]), /duplicate/);
  assert.throws(() => compile([video, video]), /duplicate/);
});

test('invalid stream fields and segments fail', () => {
  for (const change of [
    { format: 'vod' }, { format: 'STREAM' }, { cam: 'yes' }, { cam: 1 },
    { start: '1:00' }, { end: '2:00' }, { startSec: 5 }, { endSec: 5 },
    { start: '1:00', endSec: 100 }, { startSec: 100, endSec: 100 }, { startSec: 200, endSec: 100 },
    { startSec: -1, endSec: 100 }, { startSec: 0, endSec: 4001 }, { startSec: 0.5, endSec: 100 },
    { start: '1:60', end: '2:00' }, { start: 'soon', end: '2:00' },
  ]) assert.throws(() => compile([{ ...video, ...change }]), /Zed-mid\.yml/, JSON.stringify(change));
});

test('moments must lie inside the segment', () => {
  const seg = { ...video, format: 'stream', startSec: 100, endSec: 1000 };
  assert.equal(out([{ ...seg, moments: [{ at: '2:00', label: 'Inside' }] }])[0].videos[0].moments[0].atSec, 120);
  assert.throws(() => compile([{ ...seg, moments: [{ at: '0:30', label: 'Before' }] }]), /inside the segment/);
  assert.throws(() => compile([{ ...seg, moments: [{ at: '20:00', label: 'After' }] }]), /inside the segment/);
});

test('hand and generated segments merge by videoId@startSec', () => {
  const manual = ['vods/Ahri/Zed-mid.yml', JSON.stringify([{ ...video, format: 'stream', start: '0:00', end: '10:00' }])];
  const auto = ['vods-auto/Ahri/Zed-mid.yml', JSON.stringify([
    { ...video, format: 'stream', startSec: 0, endSec: 600 },
    { ...video, format: 'stream', startSec: 600, endSec: 1200 },
  ])];
  const result = compileContent(new Map([...base, manual, auto]), { generatedAt });
  const vods = JSON.parse(result.files.get('champions/103.json')).vods;
  assert.equal(vods[0].videos.length, 2);
  assert.deepEqual(vods[0].videos.map(v => v.startSec), [0, 600]);
});

test('vs any compiles only for stream VODs with a player; enemy is absent', () => {
  const vods = out([{ ...video, format: 'stream' }], 'vods/Ahri/any-mid.yml');
  assert.deepEqual(vods, [{ lane: 'mid', videos: [{ ...video, format: 'stream', moments: [] }] }]);
  assert.equal(Object.hasOwn(vods[0], 'enemy'), false);
  assert.throws(() => compile([{ ...video }], 'vods/Ahri/any-mid.yml'), /format: stream/);
  assert.throws(() => compile([{ ...video, format: 'replay' }], 'vods/Ahri/any-mid.yml'), /format: stream/);
  const { player, ...noPlayer } = video;
  assert.throws(() => compile([{ ...noPlayer, format: 'stream' }], 'vods/Ahri/any-mid.yml'), /registry player/);
});

test('vs any requires a registry player when players.yml is present', () => {
  const players = ['vods/players.yml', JSON.stringify([{ name: 'Faker', aliases: [], role: 'mid', region: 'KR', note: 'x' }])];
  assert.equal(out([{ ...video, format: 'stream' }], 'vods/Ahri/any-mid.yml', [players])[0].videos.length, 1);
  assert.throws(() => compile([{ ...video, player: 'Nobody', format: 'stream' }], 'vods/Ahri/any-mid.yml', [players]), /registry/);
  // With an opponent, non-registry players keep compiling (replay quality bar is upstream).
  assert.equal(out([{ ...video, player: 'Nobody' }], 'vods/Ahri/Zed-mid.yml', [players])[0].videos.length, 1);
});
