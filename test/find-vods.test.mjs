import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { draftVod, momentKind } from '../scripts/find-vods.mjs';

const info = {
  id: 'abcdefghijk', title: '(DIA Yuros) Ahri Mid vs Zed - EUW Challenger Patch 26.20', channel: 'Ahri Challenger Replays',
  duration: 1352, upload_date: '20261020', description: '',
  chapters: [{ start_time: 0, title: 'Intro' }, { start_time: 184, title: 'First trade' }, { start_time: 3723, title: 'Past the end' }],
};
const won = { ...info, chapters: [...info.chapters, { start_time: 1340, title: 'Victory' }],
};

test('drafts a VOD with stated facts and "?" for unknowns', () => {
  const [video] = parse(draftVod(info, 'Ahri', 'Zed'));
  assert.deepEqual(video, {
    videoId: 'abcdefghijk', title: info.title, player: 'Yuros', rankClaim: 'Challenger', patch: '26.20', result: '?',
    durationSec: 1352, moments: [{ at: '3:04', label: 'First trade', kind: 'trade' }],
  });
});

test('reads the result from a Victory or Defeat chapter', () => {
  assert.equal(parse(draftVod(won, 'Ahri', 'Zed'))[0].result, 'W');
});

test('falls back to the channel for creators and to "?" for replay channels', () => {
  const draft = title => parse(draftVod({ ...info, title, chapters: [] }, 'Ahri', 'Zed'))[0];
  assert.equal(draft('Ahri vs Zed 19/3/17 (Mid) | EUW Master').player, '?');
  assert.equal(parse(draftVod({ ...info, title: 'Rank 1 Ahri teaches you how to beat Zed', channel: 'Sjorry' }, 'Ahri', 'Zed'))[0].player, 'Sjorry');
});

test('skips the enemy perspective, shorts and old uploads', () => {
  assert.equal(draftVod({ ...info, title: 'Zed Mid vs Ahri - KR Master' }, 'Ahri', 'Zed'), null);
  assert.equal(draftVod({ ...info, duration: 26 }, 'Ahri', 'Zed'), null);
  assert.equal(draftVod({ ...info, upload_date: '20210101' }, 'Ahri', 'Zed'), null);
});

test('infers a moment kind only when the chapter title states it', () => {
  const kinds = ['First Blood — Ahri kills Diana', 'Ahri Double Kill', 'Blue takes 1st Dragon (Hextech)', 'Blue takes Rift Herald',
    'Void Grubs', 'Baron Nashor', 'Mid tower falls', 'Big teamfight', 'Ahri dies to gank', 'Zed dies', 'Zed roams bot',
    'Ahri catches Zed again', 'Ahri outduels Zed (3rd time)', 'Victory', 'Accelerated growth'].map(label => momentKind(label, 'Ahri'));
  assert.deepEqual(kinds, ['kill', 'kill', 'dragon', 'herald', 'grubs', 'baron', 'tower', 'teamfight', 'death', undefined, 'roam',
    undefined, undefined, undefined, undefined]);
  assert.equal(momentKind("Kai'Sa dies", "Kai'Sa"), 'death');
  assert.equal(momentKind('Ahri. dies', 'A.ri'), undefined, 'champion names match literally');
});
