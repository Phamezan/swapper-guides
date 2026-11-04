import { yaml, fail, SECTION_LABELS } from './markdown.mjs';
import { fields, plain, patch, championId, LANES } from './validate.mjs';

// Mirrored by the app's MomentKind (src-tauri guides model and matchupGuide.ts).
export const MOMENT_KINDS = ['kill', 'death', 'teamfight', 'dragon', 'baron', 'herald', 'grubs', 'tower', 'trade', 'roam', 'other'];

const TIME = /^(?:\d+:[0-5]\d|\d+:[0-5]\d:[0-5]\d)$/u;
const toSec = value => value.split(':').reduce((total, part) => total * 60 + Number(part), 0);

export function compileVods(text, file, champions, players) {
  const loc = { file, line: 1 };
  const match = /^(?:vods|vods-auto)\/([^/]+)\/([^/]+)-(top|jungle|mid|adc|support)\.yml$/u.exec(file);
  if (!match || !LANES.includes(match[3])) fail(loc, 'VOD file path must match vods/<Champion>/<Enemy>-<lane>.yml or vods/<Champion>/any-<lane>.yml (or vods-auto/ equivalents)');
  const champion = championId(match[1], champions, loc);
  const enemy = match[2] === 'any' ? undefined : championId(match[2], champions, loc, 'enemy champion');
  const document = yaml(text, loc);
  if (!Array.isArray(document.value)) fail(loc, 'VODs must be an array');
  const seen = new Set();
  const videos = document.value.map((video, i) => {
    const at = document.at(i);
    fields(video, ['videoId', 'title', 'rankClaim', 'patch', 'durationSec'], ['player', 'result', 'team', 'uploaded', 'moments', 'patchEstimated', 'region', 'format', 'cam', 'start', 'end', 'startSec', 'endSec'], at);
    if (typeof video.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/u.test(video.videoId)) fail(at, 'videoId must be an 11-character YouTube id');
    if (Object.hasOwn(video, 'format') && !['replay', 'stream'].includes(video.format)) fail(at, 'format must be replay or stream');
    if (Object.hasOwn(video, 'cam') && typeof video.cam !== 'boolean') fail(at, 'cam must be a boolean');
    for (const key of ['title', 'rankClaim', ...['player', 'team'].filter(key => Object.hasOwn(video, key))]) plain(video[key], at, key);
    if (Object.hasOwn(video, 'region') && !['KR', 'NA', 'EUW', 'EUNE'].includes(video.region)) fail(at, 'invalid region');
    patch(video.patch, at);
    if (Object.hasOwn(video, 'patchEstimated') && typeof video.patchEstimated !== 'boolean') fail(at, 'patchEstimated must be boolean');
    if (Object.hasOwn(video, 'result') && !['W', 'L'].includes(video.result)) fail(at, 'result must be W or L');
    if (!Number.isSafeInteger(video.durationSec) || video.durationSec <= 0) fail(at, 'durationSec must be a positive integer');
    const hasTextSeg = Object.hasOwn(video, 'start') || Object.hasOwn(video, 'end');
    const hasSecSeg = Object.hasOwn(video, 'startSec') || Object.hasOwn(video, 'endSec');
    if (hasTextSeg && hasSecSeg) fail(at, 'use either start/end or startSec/endSec, not both');
    if (hasTextSeg && !(Object.hasOwn(video, 'start') && Object.hasOwn(video, 'end'))) fail(at, 'start and end must be provided together');
    if (hasSecSeg && !(Object.hasOwn(video, 'startSec') && Object.hasOwn(video, 'endSec'))) fail(at, 'startSec and endSec must be provided together');
    let startSec, endSec;
    if (hasTextSeg) {
      if (typeof video.start !== 'string' || !TIME.test(video.start) || typeof video.end !== 'string' || !TIME.test(video.end)) fail(at, 'start/end must be m:ss or h:mm:ss');
      startSec = toSec(video.start); endSec = toSec(video.end);
    } else if (hasSecSeg) {
      if (!Number.isSafeInteger(video.startSec) || !Number.isSafeInteger(video.endSec)) fail(at, 'startSec/endSec must be integers');
      startSec = video.startSec; endSec = video.endSec;
    }
    if (startSec !== undefined && !(0 <= startSec && startSec < endSec && endSec <= video.durationSec)) fail(at, 'segment must satisfy 0 <= startSec < endSec <= durationSec');
    if (enemy === undefined) {
      if (video.format !== 'stream') fail(at, 'vs any VODs must have format: stream');
      if (typeof video.player !== 'string' || !video.player) fail(at, 'vs any VODs require a registry player');
      if (players && !players.has(video.player)) fail(at, 'vs any player must be in the vods/players.yml registry');
    }
    const dedupeKey = `${video.videoId}@${startSec ?? 0}`;
    if (seen.has(dedupeKey)) fail(at, 'duplicate videoId segment');
    seen.add(dedupeKey);
    if (Object.hasOwn(video, 'uploaded') && (typeof video.uploaded !== 'string' || !/^2\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(video.uploaded))) fail(at, 'uploaded must be YYYY-MM-DD');
    if (Object.hasOwn(video, 'moments') && !Array.isArray(video.moments)) fail(at, 'moments must be an array');
    const moments = (video.moments ?? []).map(moment => {
      fields(moment, ['at', 'label'], ['section', 'kind'], at);
      if (typeof moment.at !== 'string' || !/^(?:\d+:[0-5]\d|\d+:[0-5]\d:[0-5]\d)$/u.test(moment.at)) fail(at, 'moment at must be m:ss or h:mm:ss');
      const atSec = moment.at.split(':').reduce((total, part) => total * 60 + Number(part), 0);
      if (!Number.isSafeInteger(atSec) || atSec >= video.durationSec) fail(at, 'moment must be before durationSec');
      if (startSec !== undefined && (atSec < startSec || atSec >= endSec)) fail(at, 'moment must be inside the segment');
      plain(moment.label, at, 'moment label');
      if (Object.hasOwn(moment, 'section') && ![...SECTION_LABELS.values()].includes(moment.section)) fail(at, 'unknown moment section');
      if (Object.hasOwn(moment, 'kind') && !MOMENT_KINDS.includes(moment.kind)) fail(at, `moment kind must be one of ${MOMENT_KINDS.join(', ')}`);
      return { atSec, label: moment.label, ...moment.section && { section: moment.section }, ...moment.kind && { kind: moment.kind } };
    });
    const { start, end, startSec: rawStartSec, endSec: rawEndSec, ...output } = video;
    return { ...output, ...(startSec !== undefined && { startSec, endSec }), moments };
  });
  return { champion, ...(enemy !== undefined && { enemy }), lane: match[3], videos, loc };
}
