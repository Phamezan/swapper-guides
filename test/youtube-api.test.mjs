import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { MetadataClient, YouTubeStop, HarvestStop, parseChapters, harvest } from '../scripts/harvest-vods.mjs';

test('description chapters accept minute/hour timestamps and separators', () => {
  assert.deepEqual(parseChapters('Description\n0:00 Intro\n12:34 - Team fight\n1:02:03 | Victory', 3800), [
    { title: 'Intro', start_time: 0 }, { title: 'Team fight', start_time: 754 }, { title: 'Victory', start_time: 3723 },
  ]);
  assert.equal(parseChapters('00:00 – Intro\n00:10 Game\n00:20 End', 30).length, 3);
});

test('description chapters require zero, three ordered timestamps and ten-second chapters', () => {
  for (const text of ['0:01 Intro\n0:20 Fight\n0:40 End', '0:00 Intro\n0:20 End',
    '0:00 Intro\n0:40 Fight\n0:20 End', '0:00 Intro\n0:20 Fight\n0:20 End',
    '0:00 Intro\n0:09 Fight\n0:20 End', '0:00 Intro\n0:20 Fight\n0:59 End',
    '0:00 Intro\n1:99 Fight\n2:00 End', 'Mention 0:00 Intro\n0:20 Fight\n0:40 End']) {
    assert.deepEqual(parseChapters(text, 60), [], text);
  }
  assert.deepEqual(parseChapters(undefined), []);
});

const item = (id, extra = {}) => ({ id, snippet: { title: 'Ahri Mid vs Zed - KR Master Patch 26.21',
  publishedAt: '2026-10-20T14:20:00Z', description: '0:00 Intro\n0:20 Ahri kills Zed\n19:00 Victory' },
  contentDetails: { duration: 'PT20M' }, status: { embeddable: true }, ...extra });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('API lists uploads in pages and stops at the first known video', async () => {
  const calls = [];
  const client = new MetadataClient({ apiKey: 'test-key', fetch: async url => {
    calls.push(url);
    assert.equal(url.pathname, '/youtube/v3/playlistItems');
    assert.equal(url.searchParams.get('playlistId'), 'UUBT1vkFS4C7GlsjyNfglgrw');
    assert.equal(url.searchParams.get('maxResults'), '50');
    const ids = calls.length === 1 ? ['newvideo001'] : ['knownvideo1', 'oldvideo001'];
    return response({ items: ids.map(videoId => ({ snippet: { title: videoId }, contentDetails: {
      videoId, videoPublishedAt: '2026-10-20T00:00:00Z' } })), nextPageToken: 'next' });
  } });
  const visited = [];
  await client.list('UCBT1vkFS4C7GlsjyNfglgrw', entry => { visited.push(entry); return entry.id !== 'knownvideo1'; });
  assert.deepEqual(visited.map(entry => entry.id), ['newvideo001', 'knownvideo1']);
  assert.equal(visited[0].upload_date, '20261020');
  assert.equal(calls[1].searchParams.get('pageToken'), 'next');
  assert.equal(client.requests, 2);
});

test('API maps metadata, duration, chapters and omitted IDs without exposing the key', async () => {
  const client = new MetadataClient({ apiKey: 'test-key', fetch: async url => {
    assert.equal(url.pathname, '/youtube/v3/videos');
    assert.equal(url.searchParams.get('part'), 'snippet,contentDetails,status');
    assert.equal(url.searchParams.get('id'), 'abcdefghijk,missing0001');
    return response({ items: [item('abcdefghijk', { contentDetails: { duration: 'PT1H2M3S' }, status: { embeddable: false } })] });
  } });
  const info = await client.videos(['abcdefghijk', 'missing0001']);
  assert.equal(info.abcdefghijk.upload_date, '20261020');
  assert.equal(info.abcdefghijk.duration, 3723);
  assert.equal(info.abcdefghijk.playable_in_embed, false);
  assert.match(info.abcdefghijk.description, /Ahri kills Zed/);
  assert.deepEqual(info.missing0001, { unavailable: true, reason: 'Not returned by YouTube (deleted or private)' });
  await assert.rejects(client.videos(Array(51).fill('abcdefghijk')), /50/);
});

test('quota, rate limits and server errors stop; API and network errors never reveal credentials', async () => {
  for (const [status, reason] of [[403, 'quotaExceeded'], [403, 'rateLimitExceeded'], [429, 'tooManyRequests'], [503, 'backendError']]) {
    const client = new MetadataClient({ apiKey: 'secret-key', fetch: async () => response({ error: {
      message: 'https://example.com/?key=secret-key', errors: [{ reason }] } }, status) });
    await assert.rejects(client.videos(['abcdefghijk']), error => error instanceof YouTubeStop && !error.message.includes('secret-key'));
  }
  const client = new MetadataClient({ apiKey: 'secret-key', fetch: async () => { throw new Error('https://example.com/?key=secret-key'); } });
  await assert.rejects(client.videos(['abcdefghijk']), error => !error.message.includes('secret-key'));
  const forbidden = new MetadataClient({ apiKey: 'secret-key', fetch: async () => response({ error: {
    message: 'secret-key', errors: [{ reason: 'secret-key' }] } }, 403) });
  await assert.rejects(forbidden.videos(['abcdefghijk']), error => !(error instanceof YouTubeStop) && !error.message.includes('secret-key'));
  const cancelled = new MetadataClient({ apiKey: 'secret-key', fetch: async () => assert.fail('cancelled') });
  cancelled.cancel();
  await assert.rejects(cancelled.videos(['abcdefghijk']), HarvestStop);
});

test('harvest batches the backlog, checkpoints a quota stop and resumes, including new upload durations', async () => {
  const parent = path.resolve(import.meta.dirname, '../.test-tmp');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'api-'));
  try {
    const channel = { id: 'UCBT1vkFS4C7GlsjyNfglgrw', name: 'Test replays', style: 'challenger', patchStyle: 'calendar', approved: true };
    await mkdir(path.join(root, 'vods/cache'), { recursive: true });
    await writeFile(path.join(root, 'champions.json'), await readFile(new URL('../champions.json', import.meta.url)));
    await writeFile(path.join(root, 'vods/channels.yml'), stringify([channel]));
    const ids = Array.from({ length: 101 }, (_, i) => `video${String(i).padStart(6, '0')}`);
    const apiItem = id => item(id, id === ids[1] ? { contentDetails: { duration: 'PT9M59S' } } : {});
    await writeFile(path.join(root, 'vods/cache/listings.json'), JSON.stringify({ version: 1, channels: {}, videos:
      Object.fromEntries(ids.map(id => [id, { id, title: item(id).snippet.title, channel: channel.id, durationSec: 1200 }])) }));
    let batches = 0;
    const fetch = async url => {
      if (url.pathname.endsWith('/playlistItems')) return response({ items: [{ snippet: { title: item('newvideo001').snippet.title },
        contentDetails: { videoId: 'newvideo001', videoPublishedAt: '2026-10-21T00:00:00Z' } }] });
      const requested = url.searchParams.get('id').split(',');
      assert.ok(requested.length <= 50);
      if (++batches === 3) return response({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
      return response({ items: requested.filter(id => id !== ids[0]).map(apiItem) });
    };
    const first = await harvest(root, { client: new MetadataClient({ apiKey: 'test', fetch }) });
    assert.match(first.stopped, /quotaExceeded/);
    assert.equal(first.written, 100, 'refreshed duration must still pass the existing filters');
    const details = JSON.parse(await readFile(path.join(root, 'vods/cache/details.json'), 'utf8'));
    assert.equal(Object.keys(details).length, 51);
    assert.equal(details.newvideo001.chapters.length, 3);
    const listings = JSON.parse(await readFile(path.join(root, 'vods/cache/listings.json'), 'utf8'));
    assert.equal(listings.videos.newvideo001.durationSec, 1200);
    const second = await harvest(root, { detailsOnly: true, client: new MetadataClient({ apiKey: 'test', fetch: async url => {
      const requested = url.searchParams.get('id').split(',');
      assert.ok(requested.every(id => !details[id]), 'cached details must not be fetched again');
      return response({ items: requested.filter(id => id !== ids[0]).map(apiItem) });
    } }) });
    assert.equal(second.detailsRemaining, 0);
    assert.equal(second.written, 100);
    assert.equal(second.withMoments, 100);
    assert.equal(JSON.parse(await readFile(path.join(root, 'vods/cache/details.json'), 'utf8'))[ids[0]].unavailable, true);
  } finally {
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
});
