import { createHash } from 'node:crypto';
import { compileVods } from './vods.mjs';
import { parseMarkdown, yaml, fail, SECTION_LABELS } from './markdown.mjs';
import { fields, plain, patch, ids, sourceUrl, championMap, championId, compileTip, LANES } from './validate.mjs';

const REQUIRED = ['champion', 'enemy', 'lane', 'patch', 'reviewed', 'difficulty', 'favoredWhen', 'sources'];
const GENERAL_REQUIRED = ['champion', 'lane', 'patch', 'reviewed', 'sources'];
const MAX_CHAMPION_BYTES = 8_000_000;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function readAuthors(text) {
  const loc = { file: 'authors.yml', line: 1 };
  if (text === undefined) fail(loc, 'required authors.yml is missing');
  const document = yaml(text, loc);
  if (!Array.isArray(document.value)) fail(loc, 'authors.yml must be an array of vetted sources');
  const sources = new Map();
  for (const [index, source] of document.value.entries()) {
    const at = document.at(index);
    fields(source, ['id', 'author', 'rankClaim', 'url', 'kind'], [], at);
    ids([source.id], at, 'author id');
    if (sources.has(source.id)) fail(at, `duplicate author id ${source.id}`);
    plain(source.author, at, 'author');
    plain(source.rankClaim, at, 'rankClaim');
    if (!['mobafire', 'sheet', 'youtube', 'web'].includes(source.kind)) fail(at, 'source kind must be mobafire, sheet, youtube or web');
    sourceUrl(source.url, at);
    sources.set(source.id, source);
  }
  return sources;
}

function compileSection(raw, context) {
  const section = { tips: raw.tips.map(tip => compileTip(tip, context)) };
  if (raw.alternatives) {
    section.alternatives = raw.alternatives.map(alternative => {
      const title = plain(alternative.title, alternative.loc, 'alternative title', context.participants);
      if (!context.sources.has(alternative.sourceId)) fail(alternative.loc, `alternative source ${alternative.sourceId} must be vetted and declared in the guide`);
      if (!alternative.tips.length) fail(alternative.loc, 'alternative must have at least one tip');
      return { title, sourceId: alternative.sourceId, tips: alternative.tips.map(tip => compileTip(tip, context)) };
    });
  }
  if (raw.timeline) {
    section.timeline = raw.timeline.map(row => ({
      at: plain(row.at, row.loc, 'timeline at', context.participants),
      champion: plain(row.champion, row.loc, 'timeline champion', context.participants),
      enemy: plain(row.enemy, row.loc, 'timeline enemy', context.participants),
    }));
  }
  return section;
}

export function compileContent(input, { generatedAt = new Date().toISOString() } = {}) {
  const dateLoc = { file: 'index.json', line: 1 };
  if (typeof generatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(generatedAt) || !Number.isFinite(Date.parse(generatedAt))) {
    fail(dateLoc, 'generatedAt must be an ISO UTC timestamp');
  }
  const authors = readAuthors(input.get('authors.yml'));
  const championsLoc = { file: 'champions.json', line: 1 };
  let rows;
  try { rows = JSON.parse(input.get('champions.json')); } catch { fail(championsLoc, 'champions.json must contain valid JSON'); }
  const champions = championMap(rows);
  const cores = new Map();
  const guideDocuments = [];
  const generalDocuments = [];
  for (const [file, text] of [...input].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (file.startsWith('enemies/')) {
      const document = parseMarkdown(text, file, { core: true });
      fields(document.frontmatter.value, ['enemy'], [], document.loc);
      const enemy = championId(document.frontmatter.value.enemy, champions, document.frontmatter.at('enemy'), 'enemy champion');
      if (file !== `enemies/${document.frontmatter.value.enemy}.md`) fail(document.loc, 'enemy file path must match frontmatter enemy');
      if (cores.has(enemy)) fail(document.loc, 'duplicate enemy core');
      const context = { champions, sources: authors, participants: [enemy], scope: 'enemy' };
      const enemyTips = Object.fromEntries([...document.blocks].map(([id, block]) => [id, block.tips.map(tip => compileTip(tip, context))]));
      cores.set(enemy, { document, enemyTips });
    } else if (file.startsWith('guides/')) {
      guideDocuments.push({ file, document: parseMarkdown(text, file) });
    } else if (file.startsWith('general/')) {
      generalDocuments.push({ file, document: parseMarkdown(text, file) });
    }
  }
  // Shared by matchup guides and per-lane general guides.
  const guideBody = (document, meta, at, participants, scope) => {
    if (!LANES.includes(meta.lane)) fail(at('lane'), `lane must be one of ${LANES.join(', ')}`);
    patch(meta.patch, at('patch'));
    if (typeof meta.reviewed !== 'boolean') fail(at('reviewed'), 'reviewed must be a boolean');
    const sourceIds = ids(meta.sources, at('sources'), 'guide sources');
    for (const id of sourceIds) if (!authors.has(id)) fail(at('sources'), `source ${id} is not vetted in authors.yml`);
    const sources = new Map(sourceIds.map(id => [id, authors.get(id)]));
    const context = { champions, sources, participants, scope };
    for (const [label, id] of [...SECTION_LABELS, ['Key tips', 'keyTips'], ['Itemization', 'itemization']]) {
      if (!document.blocks.has(id)) fail(document.loc, `required section ${label} is missing`);
    }
    const keyBlock = document.blocks.get('keyTips');
    if (keyBlock.tips.length !== 3) fail(keyBlock.loc, 'keyTips must contain exactly 3 tips');
    const sections = Object.fromEntries([...SECTION_LABELS.values()].map(id => [id, compileSection(document.blocks.get(id), context)]));
    const qualified = ['early-lane', 'mid-lane', 'win-condition'].filter(id => sections[id].tips.length >= 2);
    if (qualified.length < 2) fail(document.loc, `quality bar: at least two phase sections must contain 2 or more ${scope} tips each`);
    return {
      sources,
      keyTips: keyBlock.tips.map(tip => compileTip(tip, context)),
      sections,
      itemization: document.blocks.get('itemization').tips.map(tip => compileTip(tip, context)),
    };
  };
  const groups = new Map();
  const identities = new Set();
  for (const { file, document } of guideDocuments) {
    const { value: meta, at } = document.frontmatter;
    fields(meta, REQUIRED, [], document.loc);
    const champion = championId(meta.champion, champions, at('champion'));
    const enemy = championId(meta.enemy, champions, at('enemy'), 'enemy champion');
    if (file !== `guides/${meta.champion}/${meta.enemy}-${meta.lane}.md`) fail(document.loc, 'guide file path must match champion/enemy/lane frontmatter');
    const identity = `${champion}/${enemy}/${meta.lane}`;
    if (identities.has(identity)) fail(document.loc, 'duplicate champion/enemy/lane guide');
    identities.add(identity);
    if (!['Easy', 'Medium', 'Hard', 'Skill matchup'].includes(meta.difficulty)) fail(at('difficulty'), 'invalid difficulty; expected Easy, Medium, Hard or Skill matchup');
    const participants = [champion, enemy];
    plain(meta.favoredWhen, at('favoredWhen'), 'favoredWhen', participants);
    const { sources, keyTips, sections, itemization } = guideBody(document, meta, at, participants, 'pair');
    const enemyTips = cores.get(enemy)?.enemyTips ?? {};
    for (const block of cores.get(enemy)?.document.blocks.values() ?? []) {
      for (const tip of block.tips) {
        for (const id of tip.metadata.value.sources) {
          if (!sources.has(id)) fail(at('sources'), `shared enemy source ${id} must be declared in guide sources`);
        }
      }
    }
    const guide = {
      champion, enemy, lane: meta.lane, patch: meta.patch, reviewed: meta.reviewed,
      difficulty: meta.difficulty, favoredWhen: meta.favoredWhen,
      keyTips, enemyTips, sections, itemization,
      sources: [...sources.values()],
    };
    if (!groups.has(champion)) groups.set(champion, { guides: [], general: [] });
    groups.get(champion).guides.push({ guide, loc: document.loc });
  }
  for (const { file, document } of generalDocuments) {
    const { value: meta, at } = document.frontmatter;
    fields(meta, GENERAL_REQUIRED, [], document.loc);
    const champion = championId(meta.champion, champions, at('champion'));
    if (file !== `general/${meta.champion}-${meta.lane}.md`) fail(document.loc, 'general guide file path must match champion/lane frontmatter');
    const identity = `${champion}/${meta.lane}`;
    if (identities.has(identity)) fail(document.loc, 'duplicate champion/lane general guide');
    identities.add(identity);
    const { sources, keyTips, sections, itemization } = guideBody(document, meta, at, [champion], 'champion');
    const guide = { champion, lane: meta.lane, patch: meta.patch, reviewed: meta.reviewed, keyTips, sections, itemization, sources: [...sources.values()] };
    if (!groups.has(champion)) groups.set(champion, { guides: [], general: [] });
    groups.get(champion).general.push({ guide, loc: document.loc });
  }
  const index = { schema: 1, generatedAt, champions: {} };
  const vodFiles = [...input].filter(([file]) => /^(?:vods|vods-auto)\//u.test(file) && file.endsWith('.yml') && file !== 'vods/channels.yml')
    .sort(([a], [b]) => Number(a.startsWith('vods-auto/')) - Number(b.startsWith('vods-auto/')) || a.localeCompare(b, 'en'));
  for (const [file, text] of vodFiles) {
    const { champion, ...entry } = compileVods(text, file, champions);
    if (!entry.videos.length) continue;
    if (!groups.has(champion)) groups.set(champion, { guides: [], general: [] });
    const group = groups.get(champion);
    const matchups = group.vods ??= [];
    const existing = matchups.find(vod => vod.enemy === entry.enemy && vod.lane === entry.lane);
    if (existing) {
      const seen = new Set(existing.videos.map(video => video.videoId));
      for (const video of entry.videos) if (!seen.has(video.videoId)) {
        existing.videos.push(video);
        seen.add(video.videoId);
      }
    } else matchups.push(entry);
  }
  const files = new Map();
  for (const [champion, entries] of [...groups].sort(([a], [b]) => a - b)) {
    const guides = entries.guides.map(entry => entry.guide).sort((a, b) => a.enemy - b.enemy || a.lane.localeCompare(b.lane, 'en'));
    const general = entries.general.map(entry => entry.guide).sort((a, b) => a.lane.localeCompare(b.lane, 'en'));
    const vods = (entries.vods ?? []).map(({ loc, ...entry }) => entry).sort((a, b) => a.enemy - b.enemy || a.lane.localeCompare(b.lane, 'en'));
    // `general` is omitted when empty so matchup-only files keep their original shape.
    const bytes = json({ schema: 1, champion, generatedAt, guides, ...general.length && { general }, ...vods.length && { vods } });
    const loc = (entries.guides[0] ?? entries.general[0] ?? entries.vods[0]).loc;
    if (Buffer.byteLength(bytes, 'utf8') > MAX_CHAMPION_BYTES) fail(loc, `champion ${champion} file exceeds 8 MB`);
    files.set(`champions/${champion}.json`, bytes);
    index.champions[champion] = { sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'), guides: guides.length, ...general.length && { general: general.length }, ...vods.length && { vods: vods.length } };
  }
  files.set('index.json', json(index));
  return { index, files };
}
