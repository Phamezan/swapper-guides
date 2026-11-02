import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mock } from 'node:test';
import { parseTitle, normalizePatch, championAliases, selectVideos, videoDetails, harvest, YouTubeStop, HarvestStop, discover, MetadataClient } from '../scripts/harvest-vods.mjs';

const champions = JSON.parse(await readFile(new URL('../champions.json', import.meta.url)));
const aliases = championAliases(champions);
const fixtures = JSON.parse(await readFile(new URL('./fixtures/vod-titles.json', import.meta.url)));
for (const { style, title, expected } of fixtures) {
  test(`${style}: ${title}`, () => {
    const parsed = parseTitle(title, { style, patchStyle: style === 'super-carry' ? 'season' : 'calendar' }, aliases);
    assert.deepEqual(parsed && [parsed.champion, parsed.enemy, parsed.lane, parsed.patch], expected);
  });
}

test('rejects ambiguous, unknown, old and incomplete titles', () => {
  for (const title of ['Ahri montage vs Zed', 'Ahri Mid vs Unknown - KR Master Patch 26.21',
    'Ahri Mid vs Zed - KR Master Patch 25.24', 'Ahri Mid vs Zed - KR Master Patch 26.0',
    'Ahri Mid vs Zed - KR Diamond Patch 26.21', 'Ahri Mid vs Zed - KR Master Patch 16.21']) {
    assert.equal(parseTitle(title, { style: 'challenger', patchStyle: 'calendar' }, aliases), null, title);
  }
  assert.equal(parseTitle('MID.GG: [ LegitKorea ] Ahri MID vs Zed | NA MASTER | LOL Season 2026',
    { style: 'midgg', patchStyle: 'calendar' }, aliases), null, 'season alone does not identify a patch');
  assert.equal(parseTitle('Ahri vs Zed 19/3/17 (Mid) | EUW Master | Ahri OTP Replay',
    { style: 'otp', patchStyle: 'calendar' }, aliases), null);
});

test('normalizes season patches without treating old calendar patches as current', () => {
  assert.equal(normalizePatch('16.21', 'season'), '26.21');
  assert.equal(normalizePatch('26.01', 'calendar'), '26.1');
  assert.equal(normalizePatch('15.24', 'season'), null);
  assert.equal(normalizePatch('25.24', 'season'), null, 'this channel also has calendar-style older titles');
  assert.equal(normalizePatch('26.21', 'season'), '26.21');
  assert.equal(normalizePatch('26.0', 'calendar'), null);
  assert.equal(normalizePatch('16.21', 'calendar'), null);
});

test('maps aliases to snapshot display names', () => {
  for (const [input, expected] of [['kaisa', "Kai'Sa"], ['monkeyking', 'Wukong'], ['nunu', 'Nunu & Willump'],
    ['jarvaniv', 'Jarvan IV'], ['renata', 'Renata Glasc'], ['drmundo', 'Dr. Mundo']]) assert.equal(aliases.get(input), expected);
});

test('keeps every video and sorts newest patch then newest upload across champions', () => {
  const row = { champion: 'Ahri', enemy: 'Zed', lane: 'mid', patch: '26.21', uploadDate: '20261020', channel: 'one', player: 'A' };
  const rows = [{ ...row, id: 'a' }, { ...row, id: 'b' }, { ...row, id: 'c', channel: 'two', player: 'B' },
    { ...row, id: 'd', patch: '26.9', uploadDate: '20261101' }, { ...row, id: 'e', uploadDate: '20261021' }];
  assert.deepEqual(selectVideos(rows).map(v => v.id), ['e', 'a', 'b', 'c', 'd']);
  assert.equal(selectVideos([...rows, rows[0]]).length, 5, 'duplicates stay removed');
  assert.equal(selectVideos([...rows, { ...row, champion: 'Zed', id: 'newest', patch: '26.22' }])[0].id, 'newest');
  assert.deepEqual(selectVideos([...rows].reverse()), selectVideos(rows), 'cache order is irrelevant');
});

test('upload ordering stays deterministic when no player is named', () => {
  const row = { champion: 'Ahri', enemy: 'Zed', lane: 'mid', patch: '26.21', uploadDate: '20261020', channel: 'one' };
  assert.deepEqual(selectVideos([{ ...row, id: 'a' }, { ...row, id: 'b' }, { ...row, id: 'c', channel: 'two' }]).map(v => v.id), ['a', 'b', 'c']);
});

test('drops unsafe chapters individually, infers kinds and leaves unknown results absent', () => {
  const row = { id: 'abcdefghijk', title: 'Ahri Mid vs Zed', champion: 'Ahri', rankClaim: 'Master', patch: '26.21', durationSec: 1000 };
  const video = videoDetails(row, { chapters: [{ start_time: 10, title: '<b>bad</b>' }, { start_time: 20, title: 'Ahri dies' },
    { start_time: 999, title: 'Victory' }, { start_time: 1000, title: 'Past end' }] });
  assert.equal(video.result, 'W');
  assert.deepEqual(video.moments, [{ at: '0:20', label: 'Ahri dies', kind: 'death' }, { at: '16:39', label: 'Victory' }]);
  assert.equal(Object.hasOwn(videoDetails(row, {}), 'result'), false);
  assert.equal(Object.hasOwn(video, 'player'), false);
});

test('extracts POV player/team without attributing an opponent or channel', () => {
  const channel = { style: 'challenger', patchStyle: 'calendar' };
  assert.deepEqual(parseTitle('(WBG Xiaohao) Ahri Mid vs Orianna (BFX Raptor) - KR Grandmaster Patch 26.21', channel, aliases), {
    champion: 'Ahri', enemy: 'Orianna', lane: 'mid', rankClaim: 'Grandmaster', patch: '26.21', team: 'WBG', player: 'Xiaohao',
  });
  assert.equal(parseTitle('Zed Mid vs Ahri (CNA Pcelica) - EUW Grandmaster Patch 26.21', channel, aliases).player, undefined);
  for (const [style, title] of [['midgg', 'MID.GG: [ LegitKorea ] Ahri MID vs Zed | NA MASTER | Patch 26.21'],
    ['otp', 'Ahri vs Zed 19/3/17 (Mid) | EUW Master | Patch 26.21']]) {
    assert.equal(parseTitle(title, { style, patchStyle: 'calendar' }, aliases).enemy, 'Zed');
  }
});

test('Master Yi is a champion name, not a rank claim', () => {
  const channel = { style: 'super-carry', patchStyle: 'season' };
  assert.equal(parseTitle('Master Yi vs Lee Sin Jungle - KR Challenger - Patch 16.21 Season 16', channel, aliases).rankClaim, 'Challenger');
  assert.equal(parseTitle('Master Yi vs Lee Sin Jungle - KR Diamond - Patch 16.21 Season 16', channel, aliases), null);
});

const channel = { id: 'UCBT1vkFS4C7GlsjyNfglgrw', name: 'Ahri Challenger Replays', style: 'challenger', patchStyle: 'calendar', approved: true };
const listing = id => ({ id, title: '(T1 Faker) Ahri Mid vs Zed - KR Challenger Patch 26.21', duration: 1200, upload_date: '20261020' });
async function temporaryRoot(run) {
  const parent = path.resolve(import.meta.dirname, '../.test-tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'harvest-'));
  try {
    await mkdir(path.join(root, 'vods'), { recursive: true });
    await writeFile(path.join(root, 'champions.json'), JSON.stringify(champions));
    await writeFile(path.join(root, 'vods/channels.yml'), stringify([channel, { ...channel, id: 'UCEflCDloIcofvi2GFQOHvPg', approved: false }]));
    await run(root);
  } finally {
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
}

test('harvest lists only approved channels, skips invalid durations and reruns without details requests', async () => {
  await temporaryRoot(async root => {
    let detailRequests = 0, listRequests = 0, visited = [];
    const client = { requests: 0, invocations: 0, async get(args, onEntry) {
      if (onEntry) {
        listRequests++;
        assert.match(args.at(-1), new RegExp(channel.id));
        visited = [];
        for (const entry of [listing('abcdefghijk'), { ...listing('shortshort1'), duration: 599 },
          { ...listing('longlong123'), duration: 3601 }, { ...listing('oldoldold12'), title: 'Ahri Mid vs Zed - KR Master Patch 25.24' }]) {
          visited.push(entry.id);
          if (onEntry(entry) === false) break;
        }
        return {};
      }
      detailRequests++;
      return { upload_date: '20261020', chapters: [{ start_time: 1190, title: 'Victory' }] };
    } };
    const first = await harvest(root, { client });
    assert.deepEqual([first.listed, first.parsed, first.selected, first.written, first.withResult], [4, 1, 1, 1, 1]);
    const generated = await readFile(path.join(root, 'vods-auto/Ahri/Zed-mid.yml'), 'utf8');
    const second = await harvest(root, { client });
    assert.equal(second.written, 1);
    assert.equal(detailRequests, 1);
    assert.equal(listRequests, 2);
    assert.deepEqual(visited, ['abcdefghijk']);
    assert.equal(await readFile(path.join(root, 'vods-auto/Ahri/Zed-mid.yml'), 'utf8'), generated);
  });
});

test('a bot check preserves partially listed uploads and issues no detail requests', async () => {
  await temporaryRoot(async root => {
    let requests = 0;
    const client = { async get(args, onEntry) { requests++; onEntry(listing('abcdefghijk')); throw new YouTubeStop('Sign in to confirm: wait or pass manually'); } };
    const report = await harvest(root, { client });
    assert.match(report.stopped, /Sign in/);
    assert.equal(report.listed, 1);
    assert.equal(report.written, 1, 'unfetched videos still ship on a bot stop');
    assert.equal(requests, 1);
    const cache = JSON.parse(await readFile(path.join(root, 'vods/cache/listings.json'), 'utf8'));
    assert.equal(cache.channels[channel.id].complete, false);
  });
});

test('a failed detail request keeps older generated videos available for that matchup', async () => {
  await temporaryRoot(async root => {
    const firstClient = { async get(args, onEntry) {
      if (onEntry) { onEntry(listing('abcdefghijk')); return {}; }
      return { chapters: [{ start_time: 1190, title: 'Victory' }] };
    } };
    await harvest(root, { client: firstClient });
    const client = { async get(args, onEntry) {
      if (onEntry) {
        for (const id of ['newvideo001', 'newvideo002', 'newvideo003', 'newvideo004', 'abcdefghijk']) {
          if (onEntry({ ...listing(id), upload_date: id === 'abcdefghijk' ? '20261020' : '20261021' }) === false) break;
        }
        return {};
      }
      throw new YouTubeStop('Sign in to confirm');
    } };
    const report = await harvest(root, { client });
    assert.match(report.stopped, /Sign in/);
    assert.equal(report.selected, 5);
    assert.equal(report.written, 5);
    const videos = parse(await readFile(path.join(root, 'vods-auto/Ahri/Zed-mid.yml'), 'utf8'));
    assert.equal(videos[0].videoId, 'newvideo001');
    assert.equal(Object.hasOwn(videos[0], 'result'), false);
    assert.equal(videos.find(video => video.videoId === 'abcdefghijk').result, 'W');
  });
});

test('ordinary listing errors still allow other approved channels and cached uploads to be harvested', async () => {
  await temporaryRoot(async root => {
    const second = { ...channel, id: 'UCEflCDloIcofvi2GFQOHvPg', approved: true };
    await writeFile(path.join(root, 'vods/channels.yml'), stringify([channel, second]));
    let lists = 0, details = 0;
    const client = { async get(args, onEntry) {
      if (onEntry) {
        lists++;
        onEntry(listing(lists === 1 ? 'abcdefghijk' : 'newvideo001'));
        if (lists === 1) throw new Error('HTTP Error 500');
        return {};
      }
      details++;
      return { chapters: [] };
    } };
    await assert.rejects(harvest(root, { client }), /HTTP Error 500/u);
    assert.equal(lists, 2);
    assert.equal(details, 2);
    const report = JSON.parse(await readFile(path.join(root, 'vods/cache/harvest-report.json'), 'utf8'));
    assert.equal(report.written, 2);
    assert.equal(report.listingErrors.length, 1);
  });
});

test('unavailable videos are cached and do not block other selected details or get retried', async () => {
  await temporaryRoot(async root => {
    let detailRequests = 0;
    const client = { async get(args, onEntry) {
      if (onEntry) {
        for (const id of ['abcdefghijk', 'newvideo001']) if (onEntry(listing(id)) === false) break;
        return {};
      }
      detailRequests++;
      if (args.at(-1).endsWith('abcdefghijk')) throw new Error('Video unavailable. This video is private');
      return { chapters: [] };
    } };
    assert.equal((await harvest(root, { client })).written, 1);
    assert.equal((await harvest(root, { client })).written, 1);
    assert.equal(detailRequests, 2);
    assert.equal(JSON.parse(await readFile(path.join(root, 'vods/cache/details.json'), 'utf8')).abcdefghijk.unavailable, true);
  });
});

test('cached-only regeneration publishes all matching videos without fetching pending details', async () => {
  await temporaryRoot(async root => {
    await mkdir(path.join(root, 'vods/cache'), { recursive: true });
    const videos = {};
    for (let i = 0; i < 7; i++) {
      const id = `newvideo00${i}`;
      videos[id] = { id, title: listing(id).title, durationSec: 1200, channel: channel.id, uploadDate: '20261020', order: i };
    }
    await writeFile(path.join(root, 'vods/cache/listings.json'), JSON.stringify({ version: 1, channels: {}, videos }));
    await writeFile(path.join(root, 'vods/cache/details.json'), JSON.stringify({ newvideo000: { chapters: [{ start_time: 1190, title: 'Victory' }] } }));
    const client = { requests: 0, invocations: 0, async get() { assert.fail('cached regeneration must never fetch'); } };
    const report = await harvest(root, { client, cachedOnly: true });
    assert.deepEqual([report.written, report.detailsCached, report.detailsRemaining], [7, 1, 6]);
    const output = parse(await readFile(path.join(root, 'vods-auto/Ahri/Zed-mid.yml'), 'utf8'));
    assert.equal(output.length, 7);
    assert.equal(output[0].result, 'W');
    assert.equal(Object.hasOwn(output[1], 'result'), false);
    assert.equal(Object.hasOwn(output[1], 'moments'), false);
  });
});

test('detail fetching is globally newest first and pending metadata ships before the first lookup', async () => {
  await temporaryRoot(async root => {
    const fetched = [];
    const client = { async get(args, onEntry) {
      if (onEntry) {
        onEntry({ ...listing('oldvideo001'), title: 'Ahri Mid vs Zed - KR Master Patch 26.1' });
        onEntry({ ...listing('newvideo001'), title: 'Zed Mid vs Ahri - KR Master Patch 26.21' });
        return {};
      }
      fetched.push(args.at(-1).split('=').at(-1));
      assert.equal(parse(await readFile(path.join(root, 'vods-auto/Ahri/Zed-mid.yml'), 'utf8')).length, 1);
      assert.equal(parse(await readFile(path.join(root, 'vods-auto/Zed/Ahri-mid.yml'), 'utf8')).length, 1);
      if (fetched.length === 2) throw new YouTubeStop('Sign in to confirm');
      return { chapters: [] };
    } };
    const report = await harvest(root, { client });
    assert.deepEqual(fetched, ['newvideo001', 'oldvideo001']);
    assert.deepEqual([report.written, report.detailsCached, report.detailsRemaining], [2, 1, 1]);
  });
});

test('discovery only appends new unapproved candidates and preserves maintainer text', async () => {
  await temporaryRoot(async root => {
    const file = path.join(root, 'vods/channels.yml');
    const before = '# Maintainer comment\n' + await readFile(file, 'utf8');
    await writeFile(file, before);
    const client = { async get() { return { entries: [
      { channel_id: channel.id, channel: channel.name },
      { channel_id: 'UCmKloVPOSuc4conaiOdc4Cg', channel: 'Jinx Challenger Replays' },
      { channel_id: 'bad', channel: 'Fake Challenger Replays' },
    ] }; } };
    const candidates = await discover(root, ['Jinx'], parse(before), client);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].approved, false);
    assert.ok((await readFile(file, 'utf8')).startsWith(before));
  });
});

test('metadata subprocess uses rate limits, hides windows and stops on bot checks or HTTP 429', async () => {
  for (const message of ['Sign in to confirm you’re not a bot', 'HTTP Error 429: Too Many Requests']) {
    let killed = false;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 123456;
    child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', null)); };
    const stub = mock.method(childProcess, 'spawn', (executable, args, options) => {
      if (executable === 'taskkill.exe') {
        assert.deepEqual(args, ['/PID', String(child.pid), '/T', '/F']);
        assert.equal(options.windowsHide, true);
        child.kill();
        return new EventEmitter();
      }
      assert.ok(args.includes('--ignore-config'));
      assert.ok(args.includes('--skip-download'));
      assert.equal(args[args.indexOf('--sleep-requests') + 1], '1');
      assert.equal(options.windowsHide, true);
      queueMicrotask(() => child.stderr.write(`[download] Downloading item 1 of 10\n[youtube] video: Downloading webpage\nERROR: ${message}\n`));
      return child;
    });
    syncBuiltinESMExports();
    try {
      const client = new MetadataClient();
      await assert.rejects(client.get(['-J', 'https://www.youtube.com/watch?v=abcdefghijk']), YouTubeStop);
      assert.equal(killed, true);
      assert.equal(client.requests, 1);
    } finally { stub.mock.restore(); syncBuiltinESMExports(); }
  }
});

test('streaming stops after a known ID even when more entries share the same stdout chunk', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 123456;
  let killed = false;
  child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 1)); };
  const stub = mock.method(childProcess, 'spawn', executable => {
    if (executable === 'taskkill.exe') { child.kill(); return new EventEmitter(); }
    queueMicrotask(() => {
      child.stderr.write('[youtube:tab] channel: Downloading webpage\n');
      child.stdout.write(`${JSON.stringify(listing('abcdefghijk'))}\n${JSON.stringify(listing('newvideo001'))}\n`);
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const visited = [], client = new MetadataClient();
    await client.get(['--flat-playlist', '--dump-json', 'https://www.youtube.com/channel/' + channel.id + '/videos'], entry => {
      visited.push(entry.id);
      return false;
    });
    assert.deepEqual(visited, ['abcdefghijk']);
    assert.equal(killed, true);
    assert.equal(client.requests, 1);
  } finally { stub.mock.restore(); syncBuiltinESMExports(); }
});

test('manual cancellation kills only the active downloader tree and prevents later requests', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 123456;
  let client, killed = false, invocations = 0;
  child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 1)); };
  const stub = mock.method(childProcess, 'spawn', (executable, args) => {
    if (executable === 'taskkill.exe') {
      assert.deepEqual(args, ['/PID', String(child.pid), '/T', '/F']);
      child.kill();
      return new EventEmitter();
    }
    invocations++;
    queueMicrotask(() => client.cancel());
    return child;
  });
  syncBuiltinESMExports();
  try {
    client = new MetadataClient();
    await assert.rejects(client.get(['-J', 'https://www.youtube.com/watch?v=abcdefghijk']), HarvestStop);
    assert.equal(killed, true);
    await assert.rejects(client.get(['-J', 'https://www.youtube.com/watch?v=newvideo001']), HarvestStop);
    assert.equal(invocations, 1);
  } finally { stub.mock.restore(); syncBuiltinESMExports(); }
});
