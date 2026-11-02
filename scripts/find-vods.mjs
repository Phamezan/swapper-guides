// Draft vods/<Champion>/<Enemy>-<lane>.yml from YouTube search metadata (titles, chapters; no video or captions).
// Usage: node scripts/find-vods.mjs <Champion> <Enemy> <lane> [count]
// Unknown fields are written as "?" so the build fails until a maintainer fills them or deletes the video.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const YTDLP = process.env.YTDLP ?? 'yt-dlp';
const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
const RANK = /\b(?:rank 1|challenger|grandmaster|master|diamond)\b/i;
// Channels that upload other people's games; their name is not the player.
const REPLAY_CHANNEL = /replay|challenger|grandmaster|otp|mid[-.]gg|\bpro\b|highlight/i;
const LANE_WORD = /^(?:top|jungle|jg|mid|middle|adc|bot|support|sup)$/i;
// Moment kinds stated outright by a chapter title; anything vaguer ("catches", "outplays") gets no kind.
const KIND_WORDS = [
  ['baron', /\b(?:baron|nashor)\b/i], ['herald', /\bherald\b/i], ['grubs', /\b(?:void ?)?grubs\b/i],
  ['dragon', /\b(?:dragon|drake)s?\b/i], ['tower', /\b(?:tower|turret)s?\b/i], ['teamfight', /\bteam ?fights?\b|\bace\b/i],
  ['kill', /\b(?:first blood|kills?)\b/i], ['trade', /\btrades?\b/i], ['roam', /\broam(?:s|ing)?\b/i],
];

export function momentKind(label, champion) {
  const name = champion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (new RegExp(`\\b${name}\\s+(?:dies|died|is killed|gets killed)\\b`, 'iu').test(label)) return 'death';
  return KIND_WORDS.find(([, words]) => words.test(label))?.[0];
}

const clock = sec => {
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = String(Math.floor(sec % 60)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// Returns the YAML text for one video, or null when it is not a usable VOD of champion vs enemy.
export function draftVod(info, champion, enemy) {
  const title = info.title ?? '';
  const at = name => title.toLowerCase().indexOf(name.toLowerCase());
  // The champion must be named before the enemy, otherwise the video is the enemy's perspective.
  if (at(champion) < 0 || at(enemy) < 0 || at(champion) > at(enemy)) return null;
  if (!(info.duration >= 600 && info.duration <= 3600) || !(info.upload_date >= '20260101')) return null;
  const tagged = /[[(]\s*(?:[A-Z]{2,4}\s+)?([^\])]+?)\s*[\])]/u.exec(title)?.[1];
  const player = tagged && !LANE_WORD.test(tagged) ? tagged : REPLAY_CHANNEL.test(info.channel ?? '') ? '?' : info.channel;
  const rank = RANK.exec(title)?.[0] ?? RANK.exec(info.description ?? '')?.[0] ?? '?';
  const patch = /patch\s*(2\d\.\d+)/iu.exec(title)?.[1] ?? '?';
  const end = (info.chapters ?? []).map(c => c.title.trim().toLowerCase());
  const result = end.includes('victory') ? 'W' : end.includes('defeat') ? 'L' : '?';
  const moments = (info.chapters ?? []).filter(c => c.start_time > 0 && c.start_time < info.duration)
    .map(c => `    - at: "${clock(c.start_time)}"\n      label: ${JSON.stringify(c.title)}\n`
      + (momentKind(c.title, champion) ? `      kind: ${momentKind(c.title, champion)}\n` : '')).join('');
  const date = info.upload_date.replace(/(\d{4})(\d\d)(\d\d)/u, '$1-$2-$3');
  return `# ${title} | ${info.channel}, uploaded ${date}\n# https://www.youtube.com/watch?v=${info.id}\n`
    + `- videoId: ${JSON.stringify(info.id)}\n  title: ${JSON.stringify(title)}\n  player: ${JSON.stringify(player)}\n`
    + `  rankClaim: ${JSON.stringify(rank)}\n  patch: ${JSON.stringify(patch)}\n  result: ${JSON.stringify(result)}\n  durationSec: ${Math.round(info.duration)}\n`
    + (moments ? `  moments:\n${moments}` : '');
}

function ytdlp(...args) {
  try {
    return execFileSync(YTDLP, ['--no-warnings', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
  } catch (error) {
    if (/confirm you.re not a bot|Sign in to confirm/u.test(error.stderr ?? '')) throw new Error('YouTube bot check: pass it manually in a browser, then retry later.');
    throw error;
  }
}

async function main([champion, enemy, lane, count = '3']) {
  if (!champion || !enemy || !LANES.includes(lane)) throw new Error('Usage: node scripts/find-vods.mjs <Champion> <Enemy> <lane> [count]');
  const file = `vods/${champion}/${enemy}-${lane}.yml`;
  if (existsSync(file)) throw new Error(`${file} exists; edit it by hand or delete it first.`);
  const found = ytdlp('--flat-playlist', '--print', '%(id)s|%(title)s', `ytsearch${Number(count) * 6}:${champion} vs ${enemy} ${lane}`)
    .split('\n').filter(Boolean).map(line => line.split('|'));
  const drafts = [];
  for (const [id, title] of found) {
    if (drafts.length >= Number(count)) break;
    const lower = title.toLowerCase();
    if (!lower.includes(champion.toLowerCase()) || lower.indexOf(champion.toLowerCase()) > lower.indexOf(enemy.toLowerCase())) continue;
    await new Promise(resolve => setTimeout(resolve, 3000)); // one request every few seconds
    const draft = draftVod(JSON.parse(ytdlp('--skip-download', '-J', `https://www.youtube.com/watch?v=${id}`)), champion, enemy);
    if (draft) drafts.push(draft);
  }
  if (!drafts.length) return console.log(`No 2026 VODs of ${champion} vs ${enemy} ${lane} found.`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `# Draft from find-vods.mjs. Fill every "?" (result, player, rankClaim, patch), add a section to moments\n# where it fits, check each moment kind, and delete videos you do not want. The build rejects the file until then.\n\n${drafts.join('\n')}`);
  console.log(`Wrote ${drafts.length} draft VODs to ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
