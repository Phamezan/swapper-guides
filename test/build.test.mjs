import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { test } from 'node:test';
import { compileContent } from '../scripts/compile.mjs';
import { build } from '../scripts/build.mjs';

const root = path.resolve(import.meta.dirname, '..');
const pilotPath = 'guides/Ahri/Zed-mid.md';
const corePath = 'enemies/Zed.md';
const generatedAt = '2026-10-27T20:00:00Z';
const base = new Map();
for (const file of ['authors.yml', 'champions.json', pilotPath, corePath]) {
  base.set(file, await readFile(path.join(root, file), 'utf8'));
}
const pilot = JSON.parse(await readFile(new URL('./fixtures/ahri-vs-zed.json', import.meta.url), 'utf8'));
const compile = files => compileContent(files, { generatedAt });
const change = (file, edit) => {
  const files = new Map(base);
  files.set(file, edit(files.get(file)));
  return files;
};
const reject = (files, message, file = pilotPath) => {
  assert.throws(() => compile(files), error => {
    assert.match(error.message, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+:`));
    assert.match(error.message, message);
    return true;
  });
};

test('pilot compiles exactly to the app fixture without fixture', () => {
  const result = compile(base);
  const champion = JSON.parse(result.files.get('champions/103.json'));
  assert.deepEqual(champion, { schema: 1, champion: 103, generatedAt, guides: [pilot] });
  assert.deepEqual(result.index, {
    schema: 1, generatedAt,
    champions: { 103: { sha256: createHash('sha256').update(result.files.get('champions/103.json')).digest('hex'), guides: 1 } },
  });
  assert.deepEqual(JSON.parse(result.files.get('index.json')), result.index);
});

test('build writes hashed bytes and removes obsolete output only after validation', async () => {
  const tempRoot = path.join(root, '.test-tmp');
  await mkdir(tempRoot, { recursive: true });
  const fixture = await mkdtemp(path.join(tempRoot, 'build-'));
  try {
    for (const [file, text] of base) {
      await mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
      await writeFile(path.join(fixture, file), text);
    }
    await mkdir(path.join(fixture, 'dist/champions'), { recursive: true });
    await writeFile(path.join(fixture, 'dist/champions/999.json'), 'obsolete');
    await build(fixture, { generatedAt });
    assert.deepEqual(await readdir(path.join(fixture, 'dist/champions')), ['103.json']);
    const bytes = await readFile(path.join(fixture, 'dist/champions/103.json'));
    const index = JSON.parse(await readFile(path.join(fixture, 'dist/index.json'), 'utf8'));
    assert.equal(index.champions['103'].sha256, createHash('sha256').update(bytes).digest('hex'));
    await writeFile(path.join(fixture, pilotPath), base.get(pilotPath).replace('reviewed: false', 'reviewed: maybe'));
    await assert.rejects(build(fixture, { generatedAt }), /reviewed/);
    assert.deepEqual(await readFile(path.join(fixture, 'dist/champions/103.json')), bytes);
  } finally {
    assert.equal(path.dirname(fixture), tempRoot);
    await rm(fixture, { recursive: true, force: true });
  }
});

test('empty content has no champion entries', () => {
  const files = new Map(base);
  files.delete(pilotPath);
  assert.deepEqual(compile(files).index.champions, {});
});

for (const field of ['champion', 'enemy', 'lane', 'patch', 'reviewed', 'difficulty', 'favoredWhen', 'sources']) {
  test(`requires guide frontmatter ${field}`, () => {
    reject(change(pilotPath, text => text.replace(new RegExp(`^${field}:.*\\n`, 'm'), '')), new RegExp(field));
  });
}

const invalidGuides = [
  ['frontmatter delimiters', text => text.replace(/^---/, 'oops'), /frontmatter/],
  ['YAML syntax', text => text.replace('reviewed: false', 'reviewed: ['), /YAML/],
  ['duplicate YAML keys', text => text.replace('reviewed: false', 'reviewed: false\nreviewed: true'), /YAML/],
  ['unknown frontmatter', text => text.replace('reviewed: false', 'reviewed: false\nfixture: true'), /unknown.*fixture/],
  ['boolean reviewed', text => text.replace('reviewed: false', 'reviewed: "false"'), /reviewed.*boolean/],
  ['quoted patch', text => text.replace('patch: "26.21"', 'patch: 26.21'), /patch/],
  ['patch format', text => text.replace('patch: "26.21"', 'patch: "latest"'), /patch/],
  ['difficulty enum', text => text.replace('difficulty: Skill matchup', 'difficulty: Impossible'), /difficulty/],
  ['lane enum', text => text.replace('lane: mid', 'lane: middle'), /lane/],
  ['nonempty favoredWhen', text => text.replace(/^favoredWhen:.*$/m, 'favoredWhen: ""'), /favoredWhen/],
  ['champion name lookup', text => text.replace('champion: Ahri', 'champion: Missing'), /champion/],
  ['enemy name lookup', text => text.replace('enemy: Zed', 'enemy: Missing'), /enemy/],
  ['numeric input champion', text => text.replace('champion: Ahri', 'champion: 103'), /champion/],
  ['path agrees with champion', text => text.replace('champion: Ahri', 'champion: Zed'), /path/],
  ['path agrees with enemy', text => text.replace('enemy: Zed', 'enemy: Ahri'), /path/],
  ['path agrees with lane', text => text.replace('lane: mid', 'lane: top'), /path/],
  ['exactly three key tips', text => text.replace(/## Key tips[\s\S]*?## Overview/, '## Key tips\n\n## Overview'), /exactly 3/],
  ['required section', text => text.replace('## Overview', '## Over view'), /unknown.*section/],
  ['missing section', text => text.replace('## Overview\n', ''), /Overview/],
  ['duplicate section', text => `${text}\n## Overview\n`, /duplicate.*section/],
  ['unknown body syntax', text => `${text}\nLoose prose\n`, /tip|syntax/],
  ['source required on every tip', text => text.replace('  sources: [peng04]\n', ''), /sources/],
  ['source declared by guide', text => text.replace('sources: [peng04, v222, aikopanda]', 'sources: [peng04, v222]'), /aikopanda/],
  ['source vetted in authors', text => text.replace('  sources: [peng04]', '  sources: [stranger]'), /stranger/],
  ['guide source vetted', text => text.replace('sources: [peng04, v222, aikopanda]', 'sources: [stranger]'), /stranger/],
  ['unique guide sources', text => text.replace('sources: [peng04, v222, aikopanda]', 'sources: [peng04, peng04]'), /duplicate/],
  ['tip sources are an array', text => text.replace('  sources: [peng04]', '  sources: peng04'), /sources/],
  ['unknown tip metadata', text => text.replace('  sources: [peng04]', '  sources: [peng04]\n  surprise: yes'), /unknown.*surprise/],
  ['ability reference syntax', text => text.replace('abilities: [Zed.Q, Zed.W]', 'abilities: [Zed.X]'), /abilit/],
  ['ability reference champion', text => text.replace('abilities: [Zed.Q, Zed.W]', 'abilities: [Missing.Q]'), /champion|abilit/],
  ['ability reference participant', text => text.replace('abilities: [Zed.Q, Zed.W]', 'abilities: [Annie.Q]'), /champion|participant/],
  ['item reference integer', text => text.replace('items: [3157]', 'items: ["3157"]'), /item/],
  ['item reference positive', text => text.replace('items: [3157]', 'items: [-1]'), /item/],
  ['tip patch format', text => text.replace('  sources: [peng04]', '  sources: [peng04]\n  patch: yesterday'), /patch/],
  ['empty heading', text => text.replace('  sources: [peng04]', '  sources: [peng04]\n  heading: ""'), /heading/],
  ['empty outdated note', text => text.replace('  sources: [peng04]', '  sources: [peng04]\n  outdated: ""'), /outdated/],
  ['HTML in tip text', text => text.replace('Levels 1–5,', '<b>Levels 1–5</b>,'), /HTML|plain text/],
  ['Markdown in output text', text => text.replace('Levels 1–5,', '**Levels 1–5**,'), /plain text/],
  ['Markdown emphasis', text => text.replace('Levels 1–5,', '*Levels 1–5*,'), /plain text/],
  ['Markdown strikethrough', text => text.replace('Levels 1–5,', '~~Levels 1–5~~,'), /plain text/],
  ['literal seconds', text => text.replace('{cd:238:Q}', '6 seconds'), /cooldown|seconds/],
  ['abbreviated cooldown', text => text.replace('{cd:238:Q}', '6s'), /cooldown|seconds/],
  ['malformed cooldown token', text => text.replace('{cd:238:Q}', '{cd:Zed:Q}'), /token/],
  ['cooldown ability', text => text.replace('{cd:238:Q}', '{cd:238:P}'), /token/],
  ['cooldown participant', text => text.replace('{cd:238:Q}', '{cd:1:Q}'), /participant|champion/],
  ['unknown token', text => text.replace('{cd:238:Q}', '{item:3157}'), /token/],
  ['HTML in frontmatter text', text => text.replace(/^favoredWhen:.*$/m, 'favoredWhen: <script>bad</script>'), /HTML|plain text/],
];
for (const [name, edit, message] of invalidGuides) {
  test(`rejects ${name}`, () => reject(change(pilotPath, edit), message));
}

test('quality bar needs two phase sections with at least two pair tips each', () => {
  reject(change(pilotPath, text => text.replace(/## Mid lane[\s\S]*?## Itemization/, '## Mid lane\n\n## Win condition\n\n## Itemization')), /two.*sections|2.*sections/);
});

test('shared enemy tips cannot rescue a guide below the pair-tip quality bar', () => {
  reject(change(pilotPath, text => text.replace(/## Early lane[\s\S]*?## Itemization/, '## Early lane\n\n## Mid lane\n\n## Win condition\n\n## Itemization')), /two.*sections|2.*sections/);
});

for (const [name, edit, message] of [
  ['missing enemy', text => text.replace('enemy: Zed\n', ''), /enemy/],
  ['enemy path mismatch', text => text.replace('enemy: Zed', 'enemy: Ahri'), /path/],
  ['invalid section', text => text.replace('## Early lane', '## Key tips'), /section/],
  ['unvetted source', text => text.replace('[aikopanda]', '[stranger]'), /stranger/],
  ['missing source', text => text.replace('  sources: [aikopanda]\n', ''), /sources/],
  ['ability outside enemy', text => text.replace('Zed.W', 'Ahri.W'), /participant|champion/],
]) {
  test(`rejects shared core ${name}`, () => reject(change(corePath, edit), message, corePath));
}

test('a shared core is optional for a new enemy', () => {
  const files = new Map(base);
  files.delete(corePath);
  assert.deepEqual(JSON.parse(compile(files).files.get('champions/103.json')).guides[0].enemyTips, {});
});

test('validates unused shared cores too', () => {
  const files = new Map(base);
  files.delete(pilotPath);
  files.set(corePath, files.get(corePath).replace('[aikopanda]', '[stranger]'));
  reject(files, /stranger/, corePath);
});

const invalidAuthors = [
  ['required author field', text => text.replace(/^  rankClaim:.*\n/m, ''), /rankClaim/],
  ['duplicate id', text => text.replace('id: v222', 'id: peng04'), /duplicate/],
  ['source kind', text => text.replace('kind: mobafire', 'kind: website'), /kind/],
  ['HTTPS', text => text.replace('https:', 'http:'), /https|HTTPS/],
  ['host allowlist', text => text.replace('www.mobafire.com', 'www.mobafire.com.evil.test'), /host|allowed/],
  ['credentialed URL', text => text.replace('https://www.mobafire.com', 'https://user:secret@www.mobafire.com'), /credentials|URL/],
  ['invalid URL', text => text.replace(/url:.*\n/, 'url: "%%%"\n'), /URL|url/],
  ['unknown author field', text => `${text}\n  extra: nope\n`, /unknown/],
];
for (const [name, edit, message] of invalidAuthors) {
  test(`rejects authors ${name}`, () => reject(change('authors.yml', edit), message, 'authors.yml'));
}

test('validates every allowed source host and both kinds', () => {
  for (const hostname of ['mobafire.com', 'www.mobafire.com', 'docs.google.com', 'youtube.com', 'www.youtube.com', 'youtu.be']) {
    const files = change('authors.yml', text => text.replaceAll('www.mobafire.com', hostname).replace('kind: mobafire', 'kind: sheet'));
    assert.equal(compile(files).index.champions['103'].guides, 1);
  }
});

test('validates champion snapshot ids', () => {
  reject(change('champions.json', () => '[{"id":0,"name":"Ahri"}]'), /id/, 'champions.json');
});

test('validates champion snapshot uniqueness', () => {
  reject(change('champions.json', () => '[{"id":103,"name":"Ahri"},{"id":103,"name":"Zed"}]'), /duplicate/, 'champions.json');
});

test('reports malformed champion JSON', () => {
  reject(change('champions.json', () => '{'), /JSON/, 'champions.json');
});

test('rejects a champion file larger than 2 MB in UTF-8 bytes', () => {
  reject(change(pilotPath, text => text.replace('Levels 1–5,', '界'.repeat(700_000))), /2 MB/);
});

test('all five lanes compile with matching paths', () => {
  for (const lane of ['top', 'jungle', 'mid', 'adc', 'support']) {
    const files = new Map(base);
    files.delete(pilotPath);
    files.set(`guides/Ahri/Zed-${lane}.md`, base.get(pilotPath).replace('lane: mid', `lane: ${lane}`));
    assert.equal(JSON.parse(compile(files).files.get('champions/103.json')).guides[0].lane, lane);
  }
});

test('alternative playstyles, timeline and optional tip fields survive compilation', () => {
  const files = change(pilotPath, text => text.replace('## Mid lane', `### Alternative: Farm safely\nsource: peng04\n\n- Hold the wave.\n  sources: [peng04]\n  patch: "26.21"\n  outdated: Review after item changes.\n  abilities: [Ahri.P]\n\n## Mid lane`));
  const guide = JSON.parse(compile(files).files.get('champions/103.json')).guides[0];
  assert.deepEqual(guide.sections['early-lane'].alternatives, [{
    title: 'Farm safely', sourceId: 'peng04', tips: [{
      text: 'Hold the wave.', scope: 'pair', sourceIds: ['peng04'], patch: '26.21',
      outdated: 'Review after item changes.', abilityKeys: [{ champion: 103, key: 'P' }],
    }],
  }]);
  assert.deepEqual(guide.sections['mid-lane'].timeline, pilot.sections['mid-lane'].timeline);
});

for (const [name, extra, message] of [
  ['unknown heading', '### Something\n', /heading/],
  ['missing alternative source', '### Alternative: Farm\n- Farm.\n  sources: [peng04]\n', /source/],
  ['undeclared alternative source', '### Alternative: Farm\nsource: stranger\n- Farm.\n  sources: [peng04]\n', /stranger/],
  ['empty alternative', '### Alternative: Farm\nsource: peng04\n', /tip/],
  ['timeline header', '### Timeline\n| Nope | Champion | Enemy |\n| --- | --- | --- |\n| 6 | Farm | Fight |\n', /header/],
  ['timeline row shape', '### Timeline\n| At | Champion | Enemy |\n| --- | --- | --- |\n| 6 | Farm |\n', /columns/],
  ['timeline HTML', '### Timeline\n| At | Champion | Enemy |\n| --- | --- | --- |\n| 6 | <b>Farm</b> | Fight |\n', /HTML|plain text/],
]) {
  test(`rejects ${name}`, () => reject(change(pilotPath, text => text.replace('## Mid lane', `${extra}\n## Mid lane`)), message));
}

test('schema and generatedAt are compiler controlled', () => {
  assert.equal(compile(base).index.schema, 1);
  reject(change(pilotPath, text => text.replace('reviewed: false', 'reviewed: false\nschema: 2')), /unknown.*schema/);
  assert.throws(() => compileContent(base, { generatedAt: 'not a date' }), /generatedAt/);
});

test('the complete README example compiles', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const example = /```markdown\n(---[\s\S]*?)\n```/u.exec(readme)?.[1];
  assert.ok(example, 'README includes a complete Markdown guide');
  const files = new Map(base);
  files.set(pilotPath, example);
  assert.equal(compile(files).index.champions['103'].guides, 1);
});

test('multiple guides are grouped, counted and hashed per champion', () => {
  const files = new Map(base);
  files.set('guides/Ahri/Zed-top.md', files.get(pilotPath).replace('lane: mid', 'lane: top'));
  files.set('guides/Zed/Ahri-mid.md', files.get(pilotPath).replace('champion: Ahri', 'champion: Zed').replace('enemy: Zed', 'enemy: Ahri'));
  const result = compile(files);
  assert.deepEqual(Object.keys(result.index.champions), ['103', '238']);
  assert.equal(result.index.champions['103'].guides, 2);
  assert.equal(result.index.champions['238'].guides, 1);
  assert.deepEqual(JSON.parse(result.files.get('champions/103.json')).guides.map(guide => guide.lane), ['mid', 'top']);
  for (const [champion, entry] of Object.entries(result.index.champions)) {
    assert.equal(entry.sha256, createHash('sha256').update(result.files.get(`champions/${champion}.json`)).digest('hex'));
  }
});
