import { createHash } from 'node:crypto';
import { parseMarkdown, yaml, fail, SECTION_LABELS } from './markdown.mjs';
import { fields, plain, patch, ids, sourceUrl, championMap, championId, compileTip, LANES } from './validate.mjs';

const REQUIRED = ['champion', 'enemy', 'lane', 'patch', 'reviewed', 'difficulty', 'favoredWhen', 'sources'];
const MAX_CHAMPION_BYTES = 2_000_000;
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
    if (!['mobafire', 'sheet'].includes(source.kind)) fail(at, 'source kind must be mobafire or sheet');
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
    }
  }
  const groups = new Map();
  const identities = new Set();
  for (const { file, document } of guideDocuments) {
    const { value: meta, at } = document.frontmatter;
    fields(meta, REQUIRED, [], document.loc);
    const champion = championId(meta.champion, champions, at('champion'));
    const enemy = championId(meta.enemy, champions, at('enemy'), 'enemy champion');
    if (!LANES.includes(meta.lane)) fail(at('lane'), `lane must be one of ${LANES.join(', ')}`);
    if (file !== `guides/${meta.champion}/${meta.enemy}-${meta.lane}.md`) fail(document.loc, 'guide file path must match champion/enemy/lane frontmatter');
    const identity = `${champion}/${enemy}/${meta.lane}`;
    if (identities.has(identity)) fail(document.loc, 'duplicate champion/enemy/lane guide');
    identities.add(identity);
    patch(meta.patch, at('patch'));
    if (typeof meta.reviewed !== 'boolean') fail(at('reviewed'), 'reviewed must be a boolean');
    if (!['Easy', 'Medium', 'Hard', 'Skill matchup'].includes(meta.difficulty)) fail(at('difficulty'), 'invalid difficulty; expected Easy, Medium, Hard or Skill matchup');
    const participants = [champion, enemy];
    plain(meta.favoredWhen, at('favoredWhen'), 'favoredWhen', participants);
    const sourceIds = ids(meta.sources, at('sources'), 'guide sources');
    for (const id of sourceIds) if (!authors.has(id)) fail(at('sources'), `source ${id} is not vetted in authors.yml`);
    const sources = new Map(sourceIds.map(id => [id, authors.get(id)]));
    const context = { champions, sources, participants, scope: 'pair' };
    for (const [label, id] of [...SECTION_LABELS, ['Key tips', 'keyTips'], ['Itemization', 'itemization']]) {
      if (!document.blocks.has(id)) fail(document.loc, `required section ${label} is missing`);
    }
    const keyBlock = document.blocks.get('keyTips');
    if (keyBlock.tips.length !== 3) fail(keyBlock.loc, 'keyTips must contain exactly 3 tips');
    const sections = Object.fromEntries([...SECTION_LABELS.values()].map(id => [id, compileSection(document.blocks.get(id), context)]));
    const qualified = ['early-lane', 'mid-lane', 'win-condition'].filter(id => sections[id].tips.length >= 2);
    if (qualified.length < 2) fail(document.loc, 'quality bar: at least two phase sections must contain 2 or more pair tips each');
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
      keyTips: keyBlock.tips.map(tip => compileTip(tip, context)), enemyTips, sections,
      itemization: document.blocks.get('itemization').tips.map(tip => compileTip(tip, context)),
      sources: [...sources.values()],
    };
    if (!groups.has(champion)) groups.set(champion, []);
    groups.get(champion).push({ guide, loc: document.loc });
  }
  const index = { schema: 1, generatedAt, champions: {} };
  const files = new Map();
  for (const [champion, entries] of [...groups].sort(([a], [b]) => a - b)) {
    const guides = entries.map(entry => entry.guide).sort((a, b) => a.enemy - b.enemy || a.lane.localeCompare(b.lane, 'en'));
    const bytes = json({ schema: 1, champion, generatedAt, guides });
    if (Buffer.byteLength(bytes, 'utf8') > MAX_CHAMPION_BYTES) fail(entries[0].loc, `champion ${champion} file exceeds 2 MB`);
    files.set(`champions/${champion}.json`, bytes);
    index.champions[champion] = { sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'), guides: guides.length };
  }
  files.set('index.json', json(index));
  return { index, files };
}
