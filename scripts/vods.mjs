import { yaml, fail, SECTION_LABELS } from './markdown.mjs';
import { fields, plain, patch, championId, LANES } from './validate.mjs';

// Mirrored by the app's MomentKind (src-tauri guides model and matchupGuide.ts).
export const MOMENT_KINDS = ['kill', 'death', 'teamfight', 'dragon', 'baron', 'herald', 'grubs', 'tower', 'trade', 'roam', 'other'];

export function compileVods(text, file, champions) {
  const loc = { file, line: 1 };
  const match = /^vods\/([^/]+)\/([^/]+)-(top|jungle|mid|adc|support)\.yml$/u.exec(file);
  if (!match || !LANES.includes(match[3])) fail(loc, 'VOD file path must match vods/<Champion>/<Enemy>-<lane>.yml');
  const champion = championId(match[1], champions, loc);
  const enemy = championId(match[2], champions, loc, 'enemy champion');
  const document = yaml(text, loc);
  if (!Array.isArray(document.value)) fail(loc, 'VODs must be an array');
  const seen = new Set();
  const videos = document.value.map((video, i) => {
    const at = document.at(i);
    fields(video, ['videoId', 'title', 'player', 'rankClaim', 'patch', 'result', 'durationSec'], ['team', 'moments'], at);
    if (typeof video.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/u.test(video.videoId)) fail(at, 'videoId must be an 11-character YouTube id');
    if (seen.has(video.videoId)) fail(at, 'duplicate videoId');
    seen.add(video.videoId);
    for (const key of ['title', 'player', 'rankClaim', ...(Object.hasOwn(video, 'team') ? ['team'] : [])]) plain(video[key], at, key);
    patch(video.patch, at);
    if (!['W', 'L'].includes(video.result)) fail(at, 'result must be W or L');
    if (!Number.isSafeInteger(video.durationSec) || video.durationSec <= 0) fail(at, 'durationSec must be a positive integer');
    if (Object.hasOwn(video, 'moments') && !Array.isArray(video.moments)) fail(at, 'moments must be an array');
    const moments = (video.moments ?? []).map(moment => {
      fields(moment, ['at', 'label'], ['section', 'kind'], at);
      if (typeof moment.at !== 'string' || !/^(?:\d+:[0-5]\d|\d+:[0-5]\d:[0-5]\d)$/u.test(moment.at)) fail(at, 'moment at must be m:ss or h:mm:ss');
      const atSec = moment.at.split(':').reduce((total, part) => total * 60 + Number(part), 0);
      if (!Number.isSafeInteger(atSec) || atSec >= video.durationSec) fail(at, 'moment must be before durationSec');
      plain(moment.label, at, 'moment label');
      if (Object.hasOwn(moment, 'section') && ![...SECTION_LABELS.values()].includes(moment.section)) fail(at, 'unknown moment section');
      if (Object.hasOwn(moment, 'kind') && !MOMENT_KINDS.includes(moment.kind)) fail(at, `moment kind must be one of ${MOMENT_KINDS.join(', ')}`);
      return { atSec, label: moment.label, ...moment.section && { section: moment.section }, ...moment.kind && { kind: moment.kind } };
    });
    return { ...video, moments };
  });
  return { champion, enemy, lane: match[3], videos, loc };
}
