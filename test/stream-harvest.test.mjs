import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseTitle, championAliases, chapterSegments, streamDate, videoDetails } from '../scripts/harvest-vods.mjs';

const champions = JSON.parse(await readFile(new URL('../champions.json', import.meta.url)));
const aliases = championAliases(champions);
const calendar = [{ patch: '26.21', start: '20261023' }];
const chan = extra => ({ style: 'stream', patchStyle: 'calendar', estimatePatch: true, ...extra });
const parse = (title, channel) => parseTitle(title, channel, aliases, '20261025', calendar);

test('DirtyMobs title gives champion, opponent, lane, player, stream and cam', () => {
  const v = parse('DirtyMobs Illaoi vs Gnar Top', chan({ player: 'DirtyMobs', cam: true }));
  assert.deepEqual([v.champion, v.enemy, v.lane, v.player, v.format, v.cam, v.rankClaim, v.patch], ['Illaoi', 'Gnar', 'top', 'DirtyMobs', 'stream', true, 'Master+', '26.21']);
});

test('foggedftw2 opponent verbs and vs-any fallback', () => {
  const c = chan({ player: 'Fogged', cam: true, champion: 'Tryndamere' });
  const v = parse('THIS WAS A MASTERCLASS IN HOW TO BEAT RENEKTON! (RANK 1 TRYNDAMERE)', c);
  assert.deepEqual([v.champion, v.enemy, v.lane], ['Tryndamere', 'Renekton', 'top']);
  const any = parse('Back To 1v9 Like I Never Left', c);
  assert.equal(any.champion, 'Tryndamere');
  assert.equal(any.enemy, undefined);
  assert.equal(any.format, 'stream');
});

test('Solarbacca title opponent and two-game chapter split', () => {
  const c = chan({ player: 'Solarbacca', cam: true, champion: 'Gangplank' });
  const v = parse('NEVER LOSE TO TRUNDLE AGAIN', c);
  assert.deepEqual([v.champion, v.enemy], ['Gangplank', 'Trundle']);
  const row = { champion: 'Gangplank', lane: 'top', durationSec: 3043 };
  const info = { chapters: [{ start_time: 0, title: 'Game 1 (vs Trundle)' }, { start_time: 1452, title: 'Game 2 (vs Vex)' }] };
  assert.deepEqual(chapterSegments(row, info, aliases), [
    { champion: 'Gangplank', enemy: 'Trundle', lane: 'top', startSec: 0, endSec: 1452 },
    { champion: 'Gangplank', enemy: 'Vex', lane: 'top', startSec: 1452, endSec: 3043 },
  ]);
});

test('Makkro opponent, vs-any and unresolvable titles', () => {
  const c = chan({ player: 'Makkro', cam: true });
  const v = parse('WHY ORNN IS ALWAYS PICKED AGAINST RUMBLE', c);
  assert.deepEqual([v.champion, v.enemy, v.player, v.cam], ['Ornn', 'Rumble', 'Makkro', true]);
  assert.equal(parse('TITANIC ORNN GAMEPLAY', c).enemy, undefined);
  assert.equal(parse('MAY THE DESPAIR NEVER END FOR THIS CAMILLE', c), null, 'enemy-only title must not misfile the enemy as the played champion');
  assert.equal(parse("IT'S TIME TO COOK @sinerias1229", c), null);
});

test('CN Sniper parenthetical opponent, extracted registry player, adc lane, no cam', () => {
  const c = chan({ lane: 'adc' });
  const v = parse(`"Jz" 2000LP Aphelios : DOMINATING KR HighElo at 1000LP Match - Engsub ( vs Kai'sa, Tris )`, c);
  assert.deepEqual([v.champion, v.enemy, v.lane, v.player, v.format], ['Aphelios', "Kai'Sa", 'adc', 'Jz', 'stream']);
  assert.equal(v.cam, undefined);
  assert.equal(parse(`Rank 1 Kai'sa : This is Why Statikk Shiv is BEST ITEMS FOR Kai'sa - Engsub`, c), null, 'vs any requires a registry player');
  const any = parse(`"Jz" 2000LP Caitlyn : Keep Me Alive ! LET ME COOK - Engsub`, c);
  assert.deepEqual([any.champion, any.enemy, any.player], ['Caitlyn', undefined, 'Jz']);
});

test('Baicaiovo verb opponent, voice without cam', () => {
  const v = parse('Rank 1 Katarina : His ONE SHOT DELETES Syndra in CN Super Server', chan({ player: 'Baicaiovo' }));
  assert.deepEqual([v.champion, v.enemy, v.lane, v.player, v.cam], ['Katarina', 'Syndra', 'mid', 'Baicaiovo', undefined]);
});

test('shok, Sinerias and Broxah vs-any single games', () => {
  const shok = parse("THIS IS WHY SYNDRA ISN'T BALANCED...  EDUCATIONAL CHALLENGER GAME", chan({ player: 'Shok', cam: true }));
  assert.deepEqual([shok.champion, shok.enemy, shok.lane, shok.rankClaim], ['Syndra', undefined, 'mid', 'Challenger']);
  const sin = parse('FULL EDUCATIONAL VOLIBEAR GAMEPLAY | FREE GUIDE', chan({ player: 'Sinerias', cam: true }));
  assert.deepEqual([sin.champion, sin.enemy, sin.lane], ['Volibear', undefined, 'jungle']);
  const brox = parse('The Reason Why Broxah Loves Brand Jungle', chan({ player: 'Broxah', cam: true }));
  assert.deepEqual([brox.champion, brox.enemy, brox.lane], ['Brand', undefined, 'jungle']);
  assert.equal(parse('Broxah Experiences the TRUE Life of an EUNE Jungler', chan({ player: 'Broxah', cam: true })), null, 'no champion in title');
});

test('edited stream uploads are rejected', () => {
  const c = chan({ player: 'DirtyMobs', cam: true });
  for (const title of ['DirtyMobs Illaoi vs Gnar Top Montage', 'DirtyMobs Illaoi Highlights', 'Best of DirtyMobs Illaoi vs Gnar']) {
    assert.equal(parse(title, c), null, title);
  }
});

test('Alois split streams parse without a title matchup; chapters segment games', () => {
  const c = chan({ player: 'Alois', cam: true, split: true });
  const v = parse('REACHING GRANDMASTER IN KOREA | KOREA DAY 15', c);
  assert.deepEqual([v.champion, v.enemy, v.lane, v.player, v.format, v.cam, v.streamSplit, v.rankClaim], [undefined, undefined, 'top', 'Alois', 'stream', true, true, 'Grandmaster']);
  const row = { lane: 'top', durationSec: 37809 };
  const info = { chapters: [
    { start_time: 0, title: 'Intro' },
    { start_time: 123, title: 'Dr. Mundo vs Illaoi' },
    { start_time: 2192, title: 'Riven vs Viktor' },
    { start_time: 4145, title: 'Queue' },
    { start_time: 4300, title: 'Riven vs Jax' },
    { start_time: 5000, title: 'Riven vs Teemo' },
    { start_time: 9000, title: 'Outro' },
  ] };
  // Queue breaks the Jax segment (155s, too short); Teemo runs to the next chapter (4000s, too long).
  assert.deepEqual(chapterSegments(row, info, aliases), [
    { champion: 'Dr. Mundo', enemy: 'Illaoi', lane: 'top', startSec: 123, endSec: 2192 },
    { champion: 'Riven', enemy: 'Viktor', lane: 'top', startSec: 2192, endSec: 4145 },
  ]);
});

test('stream date comes from title or description text', () => {
  assert.equal(streamDate('VOD July 29th 2025'), '20250729');
  assert.equal(streamDate('no date', 'Streamed on August 3, 2026 live'), '20260803');
  assert.equal(streamDate('KOREA DAY 15'), undefined);
});

test('split rows without a champion do not crash video details', () => {
  const row = { id: 'abcdefghijk', title: 'Full stream', rankClaim: 'Master+', patch: '26.21', durationSec: 7200, format: 'stream' };
  const video = videoDetails(row, { chapters: [{ start_time: 10, title: 'Riven vs Jax' }] });
  assert.equal(video.format, 'stream');
  assert.equal(video.moments[0].kind, undefined);
});

test('existing BeiFeng and XiaoMing VODs are marked stream without cam', () => {
  const base = { id: 'abcdefghijk', title: 'BeiFeng Qiyana vs Viktor', rankClaim: 'Challenger', patch: '26.21', durationSec: 1300 };
  assert.equal(videoDetails({ ...base, channel: 'UC8_CJP1lfMjzGo_jkMW8SQg' }, {}).format, 'stream');
  assert.equal(videoDetails({ ...base, channel: 'UCBnsdnhdPysrE0JCjQPn-QA' }, {}).format, 'stream');
  assert.equal(videoDetails({ ...base, channel: 'UCBnsdnhdPysrE0JCjQPn-QA' }, {}).cam, undefined);
  assert.equal(videoDetails({ ...base, channel: 'other' }, {}).format, undefined);
});
