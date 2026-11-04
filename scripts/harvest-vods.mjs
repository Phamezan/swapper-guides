// Metadata only. No API key, cookies, media or automatic channel approvals.
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import { plain } from './validate.mjs';
import { momentKind } from './find-vods.mjs';

const STYLES = ['challenger', 'midgg', 'korean-pro', 'super-carry', 'otp', 'domisum', 'named'];
const MIN_PATCH_YEAR = 25;
const ID = /^[A-Za-z0-9_-]{11}$/u;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/u;
const loc = { file: 'YouTube metadata', line: 1 };
const normalize = name => name.toLowerCase().replace(/[^a-z0-9]/gu, '');
const laneName = name => ({ middle: 'mid', jg: 'jungle', jgl: 'jungle', bot: 'adc', sup: 'support', supp: 'support' })[name.toLowerCase()] ?? name.toLowerCase();
const LANE = '(top|jungle|jg|jgl|mid|middle|adc|bot|support|sup|supp)';
const safe = text => { try { plain(text, loc, 'metadata'); return true; } catch { return false; } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// Chapters that mark the video's structure, not a moment in the game.
const NOT_A_MOMENT = /^(?:game\s*start|gameplay|ban\s*(?:&|and)\s*picks?|picks?\s*(?:&|and)\s*bans?|loading(?:\s*screen)?|intro|outro|victory|defeat)$/iu;
// Unavailable videos and videos whose uploader disabled embedding cannot play in the app.
const playable = info => !info?.unavailable && info?.embeddable !== false;

export function validatePlayers(players) {
  if (!Array.isArray(players) || !players.length) throw new Error('players.yml must be a nonempty array');
  const seen = new Map();
  for (const player of players) {
    if (!safe(player.name) || !Array.isArray(player.aliases) || !['top', 'jungle', 'mid', 'adc', 'support'].includes(player.role)
      || !['CN', 'KR', 'EUW', 'EUNE', 'NA'].includes(player.region) || !safe(player.note)) throw new Error('Invalid player');
    for (const alias of [player.name, ...player.aliases]) {
      if (!safe(alias) || !alias.trim()) throw new Error('Invalid player alias');
      const key = alias.toLocaleLowerCase();
      if (seen.has(key) && seen.get(key) !== player.name) throw new Error(`Duplicate player alias: ${alias}`);
      seen.set(key, player.name);
    }
  }
  return players;
}
const players = validatePlayers(parse(readFileSync(new URL('../vods/players.yml', import.meta.url), 'utf8')));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const playerPatterns = players.map(player => [player, [player.name, ...player.aliases].map(alias =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(alias)}(?![\\p{L}\\p{N}_])`, 'iu'))]);
export function registryPlayer(text) {
  if (typeof text !== 'string') return undefined;
  // PerfecT is a pro name; replay performance labels are not player attribution.
  text = text.replace(/\bperfect\s+KDA\b/giu, '');
  const matches = playerPatterns.filter(([, patterns]) => patterns.some(pattern => pattern.test(text))).map(([player]) => player);
  return matches.length === 1 ? matches[0] : undefined;
}

export function championAliases(champions) {
  const aliases = new Map(champions.map(({ name }) => [normalize(name), name]));
  for (const [alias, name] of Object.entries({ monkeyking: 'Wukong', nunu: 'Nunu & Willump', renata: 'Renata Glasc', jarvan: 'Jarvan IV', chogatch: "Cho'Gath", ireli: 'Irelia', hercarim: 'Hecarim', fiddlestick: 'Fiddlesticks', vaus: 'Varus' })) {
    if (aliases.has(normalize(name))) aliases.set(alias, name);
  }
  return aliases;
}

export function normalizePatch(value, style) {
  const match = /^(\d+)\.(\d+)$/u.exec(value ?? '');
  if (!match || !['calendar', 'season'].includes(style)) return null;
  const major = Number(match[1]);
  const year = major + (style === 'season' && major < 20 ? 10 : 0), number = Number(match[2]);
  return year >= MIN_PATCH_YEAR && number >= 1 && number <= 99 ? `${year}.${number}` : null;
}

function playerTag(tag) {
  if (!tag) return {};
  const parts = tag.trim().split(/\s+/u);
  // Recognized pro tags avoid treating a multiword player name as a team.
  return parts.length > 1 && /^(?:Gen\.G|T1|HLE|KT|DK|BLG|WBG|BFX|CNA|GEN|G2|FNC|TES|JDG|LNG|IG|WE|EDG|AL|NIP|DRX|NS|BRO|FOX|KDF|BNK|BDS|KC|TL|C9|FLY)$/u.test(parts[0])
    ? { team: parts[0], player: parts.slice(1).join(' ') } : { player: tag.trim() };
}

export function parseTitle(title, channel, aliases, uploadDate, calendar = []) {
  if (typeof title !== 'string' || !safe(title)) return null;
  title = title.replace(/\bJunlge\b/giu, 'Jungle').replace(/\bGrandmater\b/giu, 'Grandmaster')
    .replace(/\bPatcj\b/giu, 'Patch').replace(/\bPatch (\d+) (\d+)\b/giu, 'Patch $1.$2');
  const titledPatch = (channel.style === 'domisum' ? /\|\s*(\d+\.\d+)\s*$/u : /\bpatch\s+(\d+\.\d+)\b/iu).exec(title);
  const patch = titledPatch ? normalizePatch(titledPatch[1], channel.patchStyle)
    : channel.estimatePatch ? estimatePatch(uploadDate, calendar, { provisional: true }) : null;
  if (!patch) return null;
  let rank = /(?:\bRanked\s+|\bKorea\s+|[-|]\s*(?:[A-Z]{2,4}\s+)?)(Challengerr?|Grandmaster|Master)\b/iu.exec(title)?.[1]?.replace(/rr$/iu, 'r');
  let match, champion, enemy, lane, player = {};
  if (channel.style === 'named') {
    if (/\b(?:montage|highlights?|compilations?|best of|shorts?)\b|集锦|精华|하이라이트/iu.test(title)
      || /\b(?:diamond|emerald|platinum|plat[1-4]?|gold|silver|bronze|iron)\b/iu.test(title)) return null;
    const named = registryPlayer(title);
    if (!named) return null;
    // Bounded matchup: only known champion names, separated by vs; prose may follow a delimiter.
    const token = [...aliases.keys(), ...aliases.values()].sort((a,b) => b.length-a.length).map(escapeRegex).join('|');
    match = new RegExp(`(?<![\\p{L}\\p{N}])(${token})\\s+(?:${LANE}\\s+)?vs\\.?\\s+(?:\\d+\\s+LP\\s+)?(${token})(?![\\p{L}\\p{N}])`, 'iu').exec(title);
    if (!match) return null;
    [, champion, lane, enemy] = match;
    lane = new RegExp(`\\b${LANE}\\b`, 'iu').exec(title)?.[1] ?? lane ?? named.role;
    player = { player: named.name };
    rank = /\b(Challenger|Grandmaster|Master)\b/iu.exec(title)?.[1];
  } else if (channel.style === 'challenger') {
    match = new RegExp(`^(?:\\(([^)]+)\\)\\s*)?(.+?)\\s+${LANE}\\s+vs\\s+(.+?)(?:\\s*\\([^)]*\\))?\\s+-\\s+`, 'iu').exec(title);
    if (match) { player = playerTag(match[1]); [, , champion, lane, enemy] = match; }
  } else if (channel.style === 'midgg') {
    match = new RegExp(`^MID[.-]GG:\\s*\\[\\s*(.+?)\\s*\\]\\s*(.+?)\\s+${LANE}\\s+vs\\s+(.+?)\\s*\\|`, 'iu').exec(title);
    if (match) { player = playerTag(match[1]); [, , champion, lane, enemy] = match; }
  } else if (channel.style === 'korean-pro') {
    match = new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s*\\[\\s*${LANE}\\s*\\]`, 'iu').exec(title);
    if (match) [, champion, enemy, lane] = match;
    else {
      match = new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s+${LANE}\\s*\\[\\s*(.+?)\\s*\\]`, 'iu').exec(title);
      if (match) { [, champion, enemy, lane] = match; player = playerTag(match[4]); }
      else {
        match = new RegExp(`^(.+?)\\s+${LANE}\\s+vs\\s+(.+?)\\s+-`, 'iu').exec(title);
        if (match) [, champion, lane, enemy] = match;
      }
    }
  } else if (channel.style === 'super-carry') {
    match = new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s+${LANE}\\s+-\\s+`, 'iu').exec(title);
    if (match) [, champion, enemy, lane] = match;
  } else if (channel.style === 'domisum') {
    match = new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s*\\(${LANE}\\)\\s*\\|(?:[^|]*\\|)*\\s*[A-Z]{2,4}\\s+(?:Master|Grandmaster|Challenger)\\s*\\|\\s*\\d+\\.\\d+\\s*$`, 'iu').exec(title);
    if (match) {
      [, champion, enemy, lane] = match;
      const duoChampion = value => {
        if (aliases.has(normalize(value))) return value;
        const parts = value.split(' & ');
        for (let i = 1; i < parts.length; i++) {
          const first = parts.slice(0, i).join(' & '), second = parts.slice(i).join(' & ');
          if (aliases.has(normalize(first)) && aliases.has(normalize(second))) return first;
        }
        return value;
      };
      champion = duoChampion(champion); enemy = duoChampion(enemy);
    }
  } else if (channel.style === 'otp') {
    match = new RegExp(`^(.+?)\\s+vs\\s+(.+?)\\s+\\d+/\\d+/\\d+\\s*\\(${LANE}\\)\\s*\\|`, 'iu').exec(title);
    if (match) [, champion, enemy, lane] = match;
  }
  if (!match) return null;
  if (['korean-pro', 'super-carry'].includes(channel.style)) {
    // Match a champion suffix, keeping preceding player/team words separate.
    const words = champion.split(/\s+/u);
    for (let i = 0; i < words.length; i++) {
      const candidate = aliases.get(normalize(words.slice(i).join(' ')));
      if (candidate) { if (i) player = playerTag(words.slice(0, i).join(' ')); champion = candidate; break; }
    }
  }
  champion = aliases.get(normalize(champion));
  if (channel.style === 'korean-pro') {
    const words = enemy.split(/\s+/u);
    enemy = words.map((_, i) => aliases.get(normalize(words.slice(i).join(' ')))).find(Boolean);
  }
  enemy = aliases.get(normalize(enemy ?? ''));
  if (!champion || !enemy || Object.values(player).some(value => !safe(value))) return null;
  if (!rank && channel.style !== 'named' && !(channel.style === 'korean-pro' && player.team)) return null;
  const region = /\b(KR|NA|EUW|EUNE|Korea)\b/iu.exec(title)?.[1]
    ?? (channel.style === 'named' && ['KR', 'NA', 'EUW', 'EUNE'].includes(registryPlayer(title)?.region) ? registryPlayer(title).region : undefined);
  const canonical = registryPlayer(player.player) ?? registryPlayer(title);
  if (canonical) player.player = canonical.name;
  return { champion, enemy, ...region && { region: /^Korea$/iu.test(region) ? 'KR' : region.toUpperCase() }, lane: laneName(lane), rankClaim: rank ? rank[0].toUpperCase() + rank.slice(1).toLowerCase() : 'Master+', patch, ...!titledPatch && { patchEstimated: true }, ...player };
}

// Require three uploads within three days: isolated mislabeled/re-uploaded games cannot set a boundary.
export function derivePatchCalendar(rows, channels) {
  const approved = new Map(channels.filter(c => c.approved).map(c => [c.id, c]));
  const dates = new Map();
  for (const row of rows) {
    const channel = approved.get(row.channel);
    const patch = channel && normalizePatch(/\bpatch\s+(\d+\.\d+)\b/iu.exec(row.title)?.[1], channel.patchStyle);
    if (!patch || !validUploadDate(row.uploadDate)) continue;
    if (!dates.has(patch)) dates.set(patch, []);
    dates.get(patch).push(row.uploadDate);
  }
  return [...dates].flatMap(([patch, days]) => {
    days.sort();
    const start = days.find((day, i) => i + 2 < days.length && dateMs(days[i + 2]) - dateMs(day) <= 2 * 86400000);
    return start ? [{ patch, start }] : [];
  }).sort((a, b) => a.start.localeCompare(b.start) || patchNumber(a.patch) - patchNumber(b.patch));
}
const dateMs = day => Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`);
const validUploadDate = day => typeof day === 'string' && /^\d{8}$/u.test(day)
  && Number.isFinite(dateMs(day)) && new Date(dateMs(day)).toISOString().slice(0, 10).replaceAll('-', '') === day;
// Older listing dates are approximate, so several patches can share a start; such days give no estimate.
// A patch lasts about two weeks, so an upload long after the last known start is not estimated either.
const MAX_ESTIMATE_DAYS = 16;
// `provisional` only selects the video for the detail pass; writeGenerated re-estimates strictly from the exact day.
export function estimatePatch(uploadDate, calendar, { provisional = false } = {}) {
  if (!validUploadDate(uploadDate)) return null;
  const entry = calendar.findLast(candidate => candidate.start <= uploadDate);
  if (provisional || !entry) return entry?.patch ?? null;
  if (calendar.filter(other => other.start === entry.start).length > 1) return null;
  return dateMs(uploadDate) - dateMs(entry.start) <= MAX_ESTIMATE_DAYS * 86400000 ? entry.patch : null;
}

const patchNumber = patch => patch.split('.').reduce((n, part) => n * 100 + Number(part), 0);
export function selectVideos(rows, published = new Set()) {
  const games = new Map();
  rows = [...rows].sort((a, b) => Number(published.has(b.id)) - Number(published.has(a.id))
    || Number(a.channel === 'UCsVz2qkd_oGXGC66fcH4SFA') - Number(b.channel === 'UCsVz2qkd_oGXGC66fcH4SFA')
    || a.id.localeCompare(b.id));
  rows = rows.filter(row => {
    if (!row.title || !Number.isFinite(row.durationSec)) return true;
    const key = normalize(row.title), prior = games.get(key) ?? [];
    if (prior.some(other => other.channel !== row.channel && [other.channel, row.channel].includes('UCsVz2qkd_oGXGC66fcH4SFA') && Math.abs(other.durationSec - row.durationSec) <= 60)) return false;
    prior.push(row); games.set(key, prior); return true;
  });
  return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => patchNumber(b.patch) - patchNumber(a.patch)
    || (b.uploadDate ?? '').localeCompare(a.uploadDate ?? '')
    || a.channel.localeCompare(b.channel, 'en') || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id, 'en'));
}

export function videoDetails(row, info) {
  const day = /^(\d{4})(\d{2})(\d{2})$/u.exec(info.uploadDate ?? '');
  const video = { videoId: row.id, title: row.title, rankClaim: row.rankClaim, patch: row.patch, durationSec: row.durationSec,
    ...row.region && { region: row.region }, ...row.patchEstimated && { patchEstimated: true }, ...row.player && { player: row.player }, ...row.team && { team: row.team }, ...day && { uploaded: `${day[1]}-${day[2]}-${day[3]}` } };
  const moments = [];
  const results = new Set();
  for (const chapter of info.chapters ?? []) {
    const at = Math.floor(chapter.start_time), label = typeof chapter.title === 'string' ? chapter.title.trim() : undefined;
    if (!Number.isFinite(at) || at < 0 || at >= row.durationSec || !safe(label)) continue;
    if (/^(victory|defeat)$/iu.test(label)) results.add(/^victory$/iu.test(label) ? 'W' : 'L');
    if (NOT_A_MOMENT.test(label)) continue;
    const kind = momentKind(label, row.champion);
    moments.push({ at: `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}`, label, ...kind && { kind } });
  }
  if (results.size === 1) video.result = [...results][0];
  if (moments.length) video.moments = moments;
  return video;
}

async function jsonFile(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

export class YouTubeStop extends Error {}
export class HarvestStop extends Error {}

// Count the actual yt-dlp HTTP request diagnostics; invocations are reported separately.
export class MetadataClient {
  constructor() { this.requests = 0; this.invocations = 0; this.lastEnd = 0; }
  cancel() {
    this.cancelled = true;
    this.stopActive?.();
  }
  async get(args, onEntry) {
    if (this.cancelled) throw new HarvestStop('Stopped; rerun node scripts/harvest-vods.mjs to continue from the cache.');
    await sleep(Math.max(0, 1000 - (Date.now() - this.lastEnd)));
    if (this.cancelled) throw new HarvestStop('Stopped; rerun node scripts/harvest-vods.mjs to continue from the cache.');
    this.invocations++;
    const executable = process.env.YTDLP ?? (process.platform === 'win32'
      ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'yt-dlp.exe') : 'yt-dlp');
    return new Promise((resolve, reject) => {
      let stdout = '', stderr = '', blocked = false, reachedKnown = false, parseError;
      const child = spawn(executable, ['--ignore-config', '--skip-download', '--sleep-requests', '1', '--retries', '0', '--extractor-retries', '0',
        '--socket-timeout', '30', '--verbose', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      const stop = () => {
        // WinGet's one-file executable has a worker child; terminate our entire tree.
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else child.kill();
      };
      this.stopActive = stop;
      child.stdout.on('data', data => {
        stdout += data;
        if (!onEntry) return;
        let end;
        while ((end = stdout.indexOf('\n')) >= 0) {
          const line = stdout.slice(0, end).trim();
          stdout = stdout.slice(end + 1);
          if (!line || reachedKnown || parseError) continue;
          try {
            if (onEntry(JSON.parse(line)) === false) { reachedKnown = true; stop(); }
          } catch (error) { parseError = error; stop(); }
        }
      });
      child.stderr.on('data', data => {
        stderr += data;
        if (/sign in to confirm|confirm you.re not a bot|HTTP(?: Error)? 429|too many requests/iu.test(stderr) && !blocked) {
          blocked = true;
          stop();
        }
      });
      child.on('error', reject);
      child.on('close', code => {
        this.stopActive = undefined;
        this.lastEnd = Date.now();
        this.requests += (stderr.match(/^\[youtube[^\]\r\n]*\] [^\r\n]*Downloading [^\r\n]+/gmu) ?? []).length;
        if (this.cancelled) return reject(new HarvestStop('Stopped; rerun node scripts/harvest-vods.mjs to continue from the cache.'));
        if (blocked) return reject(new YouTubeStop('YouTube bot check or HTTP 429: wait or pass the check manually before running again.'));
        if (parseError) return reject(parseError);
        if (reachedKnown) return resolve({});
        if (code !== 0) return reject(new Error(stderr.split(/\r?\n/u).filter(line => /ERROR:/u.test(line)).join('\n') || `yt-dlp exited ${code}`));
        if (onEntry) return resolve({});
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('yt-dlp returned invalid metadata JSON')); }
      });
    });
  }
}

export async function readChannels(root) {
  const channels = parse(await readFile(path.join(root, 'vods/channels.yml'), 'utf8'));
  if (!Array.isArray(channels)) throw new Error('channels.yml must be an array');
  const seen = new Set();
  for (const channel of channels) {
    if (!CHANNEL_ID.test(channel.id) || seen.has(channel.id) || !safe(channel.name) || !STYLES.includes(channel.style)
      || (Object.hasOwn(channel, 'estimatePatch') && typeof channel.estimatePatch !== 'boolean')
      || !['calendar', 'season'].includes(channel.patchStyle) || typeof channel.approved !== 'boolean') throw new Error('Invalid or duplicate channel in channels.yml');
    seen.add(channel.id);
  }
  return channels;
}

export async function discover(root, names, channels, client) {
  const candidates = [];
  for (const name of names) {
    const data = await client.get(['--flat-playlist', '-J', `ytsearch10:${name} Challenger Replays MID-GG`]);
    for (const entry of data.entries ?? []) {
      const id = entry.channel_id, title = entry.channel ?? entry.uploader ?? '';
      if (!CHANNEL_ID.test(id) || !safe(title) || !/replays?|challenger|mid[.-]gg|\botp\b/iu.test(title) || channels.some(c => c.id === id)) continue;
      const channel = { id, name: title, style: /mid[.-]gg/iu.test(title) ? 'midgg' : /\botp\b/iu.test(title) ? 'otp' : 'challenger', patchStyle: 'calendar', approved: false };
      channels.push(channel);
      candidates.push(channel);
      // Preserve existing maintainer edits and comments, append candidates only.
      const file = path.join(root, 'vods/channels.yml');
      await atomicWrite(file, `${(await readFile(file, 'utf8')).trimEnd()}\n${stringify([channel])}`);
      console.log(`Candidate (unapproved): ${title} ${id}`);
    }
  }
  return candidates;
}

export async function listChannel(root, channel, cache, client) {
  const state = cache.channels[channel.id] ??= { seen: [], complete: false };
  const previous = new Set(state.seen);
  let order = 0;
  try {
    // Stream one traversal so old pages are never fetched repeatedly within a run.
    await client.get(['--flat-playlist', '--lazy-playlist', '--dump-json', '--extractor-args', 'youtubetab:approximate_date',
      `https://www.youtube.com/channel/${channel.id}/videos`], entry => {
      order++;
      if (!ID.test(entry.id)) return;
      if (state.complete && previous.has(entry.id)) return false;
      // shortcut: flat dates are approximate; selected details refine them on later runs.
      const uploadDate = entry.upload_date ?? (Number.isFinite(entry.timestamp)
        ? new Date(entry.timestamp * 1000).toISOString().slice(0, 10).replaceAll('-', '') : undefined);
      cache.videos[entry.id] = { id: entry.id, title: entry.title, durationSec: entry.duration, channel: channel.id,
        ...(uploadDate && { uploadDate }), order };
      if (!previous.has(entry.id)) { state.seen.push(entry.id); previous.add(entry.id); }
      if (order % 500 === 0) console.log(`${channel.name}: ${order} uploads listed`);
    });
    state.complete = true;
  } finally {
    await atomicWrite(path.join(root, 'vods/cache/listings.json'), `${JSON.stringify(cache, null, 2)}\n`);
    console.log(`${channel.name}: ${state.seen.length} uploads cached${state.complete ? ' (up to date)' : ''}`);
  }
}

export async function writeGenerated(root, rows, details, calendar = []) {
  const groups = new Map();
  for (let row of rows) {
    const info = details[row.id] ?? {};
    if (!playable(info) || (row.namedSource && info.embeddable !== true)) continue;
    // Listing dates of older videos are approximate; an estimated patch is published only from the exact upload day.
    if (row.patchEstimated) {
      const patch = estimatePatch(info.uploadDate, calendar);
      if (!patch) continue;
      row = { ...row, patch };
    }
    const file = `${row.champion}/${row.enemy}-${row.lane}.yml`;
    if (!groups.has(file)) groups.set(file, []);
    groups.get(file).push(videoDetails(row, info));
  }
  const directory = path.join(root, 'vods-auto');
  const marker = '# Generated by scripts/harvest-vods.mjs. Edit hand-made VODs under vods/.\n';
  await mkdir(directory, { recursive: true });
  // Only replace/remove our marked files; never touch hand-made files in either tree.
  for (const champion of await readdir(directory, { withFileTypes: true })) {
    if (!champion.isDirectory()) continue;
    for (const entry of await readdir(path.join(directory, champion.name))) {
      if (!entry.endsWith('.yml')) continue;
      const relative = `${champion.name}/${entry}`, file = path.join(directory, relative);
      if (!groups.has(relative) && (await readFile(file, 'utf8')).startsWith(marker)) await unlink(file);
    }
  }
  for (const [relative, videos] of groups) {
    const file = path.join(directory, relative);
    try { if (!(await readFile(file, 'utf8')).startsWith(marker)) throw new Error(`Refusing to replace unmarked ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await atomicWrite(file, marker + stringify(videos, { lineWidth: 0 }));
  }
  return [...groups.values()].flat();
}

export async function harvest(root, { discovery = [], cachedOnly = false, detailsOnly = false, limit = Infinity, client = new MetadataClient() } = {}) {
  const published = new Set();
  const generated = path.join(root, 'vods-auto');
  for (const champion of await readdir(generated, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  })) {
    if (!champion.isDirectory()) continue;
    for (const file of await readdir(path.join(generated, champion.name))) {
      if (file.endsWith('.yml')) for (const video of parse(await readFile(path.join(generated, champion.name, file), 'utf8')) ?? []) published.add(video.videoId);
    }
  }
  const started = Date.now();
  const channels = await readChannels(root);
  const aliases = championAliases(await jsonFile(path.join(root, 'champions.json')));
  for (const name of discovery) if (!aliases.has(normalize(name))) throw new Error(`Unknown discovery champion: ${name}`);
  const cache = await jsonFile(path.join(root, 'vods/cache/listings.json'), { version: 1, channels: {}, videos: {} });
  const details = await jsonFile(path.join(root, 'vods/cache/details.json'), {});
  if (cache.version !== 1) throw new Error('Unsupported listings cache version');
  const approved = new Map(channels.filter(channel => channel.approved).map(channel => [channel.id, channel]));
  const existingChannelIds = new Set(channels.map(channel => channel.id));
  const listingErrors = [];
  let stopped, parsed = [], selected = [];
  try {
    if (discovery.length) await discover(root, discovery, channels, client);
    else if (!cachedOnly && !detailsOnly) {
      for (const channel of approved.values()) {
        try { await listChannel(root, channel, cache, client); }
        catch (error) {
          if (error instanceof YouTubeStop || error instanceof HarvestStop) throw error;
          listingErrors.push(`${channel.name}: ${error.message}`);
          console.error(listingErrors.at(-1));
        }
      }
    }
  } catch (error) { stopped = error; }
  // Only exact upload days (from the detail pass) may set patch boundaries.
  const exactCalendar = () => derivePatchCalendar(Object.values(cache.videos)
    .flatMap(row => details[row.id]?.uploadDate ? [{ ...row, uploadDate: details[row.id].uploadDate }] : []), channels);
  if (!discovery.length) {
    const calendar = exactCalendar();
    for (const row of Object.values(cache.videos)) {
      if (!approved.has(row.channel) || !(row.durationSec >= 600 && row.durationSec <= 3600) || !Number.isSafeInteger(row.durationSec)) continue;
      const facts = parseTitle(row.title, approved.get(row.channel), aliases, details[row.id]?.uploadDate ?? row.uploadDate, calendar);
      if (facts) parsed.push({ ...row, ...facts, ...(approved.get(row.channel).style === 'named' && { namedSource: true }), ...(details[row.id]?.uploadDate && { uploadDate: details[row.id].uploadDate }) });
    }
    selected = selectVideos(parsed.filter(row => playable(details[row.id])), published);
    // Publish every eligible video before starting a potentially long detail pass.
    if (!stopped && !cachedOnly) await writeGenerated(root, selected, details, calendar);
    const pending = selected.filter(row => !details[row.id]);
    console.log(`${selected.length} eligible videos; ${selected.length - pending.length} details cached; ${pending.length} remaining. ${cachedOnly ? 'Cache-only regeneration; no requests.' : 'Fetching newest first.'}`);
    const detailStarted = Date.now();
    let processed = 0;
    if (!stopped && !cachedOnly) {
      for (const row of pending.slice(0, limit)) {
        try {
          const info = await client.get(['-J', `https://www.youtube.com/watch?v=${row.id}`]);
          details[row.id] = { ...(info.upload_date && { uploadDate: info.upload_date }),
            ...(typeof info.playable_in_embed === 'boolean' && { embeddable: info.playable_in_embed }), chapters: info.chapters ?? [] };
          await atomicWrite(path.join(root, 'vods/cache/details.json'), `${JSON.stringify(details, null, 2)}\n`);
        } catch (error) {
          if (!(error instanceof YouTubeStop) && !(error instanceof HarvestStop) && /video unavailable|video is (?:private|not available)|has been removed|members.only|not available in your country/iu.test(error.message)) {
            details[row.id] = { unavailable: true, reason: error.message };
            await atomicWrite(path.join(root, 'vods/cache/details.json'), `${JSON.stringify(details, null, 2)}\n`);
          } else {
            stopped = error;
            break;
          }
        }
        processed++;
        if (processed % 25 === 0 || processed === pending.length) console.log(`${processed}/${pending.length} pending detail lookups processed; ${((Date.now() - detailStarted) / processed / 1000).toFixed(1)} sec/video; ${pending.length - processed} remaining`);
      }
    }
  }
  // Re-sort with exact dates for cached details, retaining videos still awaiting details.
  const ready = selectVideos(parsed.filter(row => playable(details[row.id])).map(row => ({ ...row,
    ...(details[row.id]?.uploadDate && { uploadDate: details[row.id].uploadDate }) })), published);
  const output = discovery.length ? [] : await writeGenerated(root, ready, details, exactCalendar());
  const report = { mode: discovery.length ? 'discover' : cachedOnly ? 'cached' : 'harvest',
    startedAt: new Date(started).toISOString(), wallSeconds: Math.round((Date.now() - started) / 1000),
    requests: client.requests, invocations: client.invocations, requestCountMethod: 'yt-dlp HTTP download diagnostics (redirects not observable)',
    listed: Object.values(cache.videos).filter(row => approved.has(row.channel)).length, parsed: parsed.length, selected: selected.length,
    duplicatesDropped: parsed.filter(row => playable(details[row.id])).length - ready.length,
    written: output.length, matchups: new Set(ready.map(row => `${row.champion}/${row.enemy}/${row.lane}`)).size,
    champions: new Set(ready.map(row => row.champion)).size,
    detailsCached: ready.filter(row => details[row.id]).length,
    detailsRemaining: ready.filter(row => !details[row.id]).length,
    withMoments: output.filter(video => video.moments?.length).length, withResult: output.filter(video => video.result).length,
    candidates: channels.filter(channel => !existingChannelIds.has(channel.id)), ...(listingErrors.length && { listingErrors }),
    ...(stopped && { stopped: stopped.message }) };
  await atomicWrite(path.join(root, discovery.length ? 'vods/cache/discovery-report.json' : 'vods/cache/harvest-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (stopped && !(stopped instanceof YouTubeStop) && !(stopped instanceof HarvestStop)) throw stopped;
  if (!stopped && listingErrors.length) throw new Error(listingErrors.join('\n'));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  const limit = limitAt < 0 ? Infinity : Number(args.splice(limitAt, 2)[1]);
  const detailsOnly = args.includes('--details-only');
  if (detailsOnly) args.splice(args.indexOf('--details-only'), 1);
  const cachedOnly = args.length === 1 && args[0] === '--cached';
  if (!(limit > 0 && (limit === Infinity || Number.isSafeInteger(limit))) || (args.length && !cachedOnly && (args[0] !== '--discover' || args.length < 2))) {
    console.error('Usage: node scripts/harvest-vods.mjs [--limit N] [--details-only] [--cached | --discover Ahri Zed ...]');
    process.exitCode = 1;
  } else {
    const client = new MetadataClient();
    const cancel = () => client.cancel();
    process.on('SIGINT', cancel);
    process.on('SIGTERM', cancel);
    harvest(process.cwd(), { discovery: cachedOnly ? [] : args.slice(1), cachedOnly, detailsOnly, limit, client })
      .catch(error => { console.error(error.message); process.exitCode = 1; })
      .finally(() => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); });
  }
}
