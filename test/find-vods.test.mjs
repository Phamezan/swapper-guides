import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { draftVod } from '../scripts/find-vods.mjs';

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
    durationSec: 1352, moments: [{ at: '3:04', label: 'First trade' }],
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
