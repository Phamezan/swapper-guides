import { LineCounter, parseDocument } from 'yaml';

export const SECTION_LABELS = new Map([
  ['Overview', 'overview'], ['Early lane', 'early-lane'],
  ['Mid lane', 'mid-lane'], ['Win condition', 'win-condition'],
]);

export function fail(loc, message) {
  throw new Error(`${loc.file}:${loc.line}: ${message}`);
}

export function yaml(text, loc) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  const issue = doc.errors[0] ?? doc.warnings[0];
  if (issue) fail({ ...loc, line: loc.line + (issue.linePos?.[0].line ?? 1) - 1 }, `YAML: ${issue.message.split('\n')[0]}`);
  let value;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch (error) {
    fail(loc, `YAML: ${error.message}`);
  }
  const at = key => {
    const offset = doc.getIn([key], true)?.range?.[0] ?? 0;
    return { ...loc, line: loc.line + lineCounter.linePos(offset).line - 1 };
  };
  return { value, at };
}

function table(lines, loc) {
  const rows = lines.filter(row => row.text.trim());
  const cells = row => {
    if (!row.text.startsWith('|') || !row.text.endsWith('|')) fail(row.loc, 'timeline rows must start and end with |');
    return row.text.slice(1, -1).split(/(?<!\\)\|/u).map(cell => cell.trim().replaceAll('\\|', '|'));
  };
  if (rows.length < 3 || JSON.stringify(cells(rows[0])) !== JSON.stringify(['At', 'Champion', 'Enemy'])) {
    fail(loc, 'timeline header must be | At | Champion | Enemy | and include at least one row');
  }
  const separator = cells(rows[1]);
  if (separator.length !== 3 || separator.some(cell => !/^:?-{3,}:?$/u.test(cell))) fail(rows[1].loc, 'invalid timeline header separator');
  return rows.slice(2).map(row => {
    const values = cells(row);
    if (values.length !== 3) fail(row.loc, 'timeline needs exactly three columns');
    return { at: values[0], champion: values[1], enemy: values[2], loc: row.loc };
  });
}

export function parseMarkdown(text, file, { core = false } = {}) {
  const lines = text.replace(/^\uFEFF/u, '').replaceAll('\r\n', '\n').split('\n');
  const loc = line => ({ file, line: line + 1 });
  if (lines[0] !== '---') fail(loc(0), 'YAML frontmatter must start with ---');
  const end = lines.indexOf('---', 1);
  if (end < 0) fail(loc(0), 'YAML frontmatter needs a closing ---');
  const frontmatter = yaml(lines.slice(1, end).join('\n'), loc(1));
  const blocks = new Map();
  const labels = new Map(SECTION_LABELS);
  if (!core) {
    labels.set('Key tips', 'keyTips');
    labels.set('Itemization', 'itemization');
  }
  let current;
  let target;
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line) continue;
    if (line.startsWith('## ')) {
      const id = labels.get(line.slice(3));
      if (!id) fail(loc(i), `unknown section ${line.slice(3)}`);
      if (blocks.has(id)) fail(loc(i), `duplicate section ${line.slice(3)}`);
      current = { tips: [], loc: loc(i) };
      blocks.set(id, current);
      target = current.tips;
      continue;
    }
    if (!current) fail(loc(i), 'tips must be inside a ## section');
    if (line.startsWith('### ')) {
      if (core || ![...SECTION_LABELS.values()].some(id => blocks.get(id) === current)) fail(loc(i), 'nested headings are only allowed in guide sections');
      if (line === '### Timeline') {
        if (current.timeline) fail(loc(i), 'duplicate timeline');
        const rows = [];
        const start = loc(i);
        while (i + 1 < lines.length && !/^#{2,3} /u.test(lines[i + 1])) {
          i++;
          rows.push({ text: lines[i].trim(), loc: loc(i) });
        }
        current.timeline = table(rows, start);
        target = null;
      } else if (line.startsWith('### Alternative: ')) {
        const alternative = { title: line.slice('### Alternative: '.length), tips: [], loc: loc(i) };
        while (i + 1 < lines.length && !lines[i + 1].trim()) i++;
        if (!lines[i + 1]?.startsWith('source: ')) fail(alternative.loc, 'alternative requires source: <author id>');
        i++;
        alternative.sourceId = lines[i].slice('source: '.length).trim();
        current.alternatives ??= [];
        current.alternatives.push(alternative);
        target = alternative.tips;
      } else {
        fail(loc(i), `unknown heading ${line}`);
      }
      continue;
    }
    if (!line.startsWith('- ') || !target) fail(loc(i), 'expected a tip bullet (- text), or a section heading; unsupported Markdown syntax');
    const tip = { text: line.slice(2).trim(), loc: loc(i) };
    const metadata = [];
    let metadataStart;
    while (i + 1 < lines.length && !/^(?:- |#{2,3} )/u.test(lines[i + 1])) {
      i++;
      const continuation = lines[i];
      if (!continuation.trim()) {
        if (metadataStart !== undefined) metadata.push('');
        continue;
      }
      if (!continuation.startsWith('  ')) fail(loc(i), 'tip continuation and metadata must be indented by two spaces');
      const content = continuation.slice(2);
      if (metadataStart === undefined && /^[\w-]+:/u.test(content)) metadataStart = i;
      if (metadataStart === undefined) tip.text += ` ${content.trim()}`;
      else metadata.push(content);
    }
    tip.metadata = yaml(metadata.join('\n'), metadataStart === undefined ? tip.loc : loc(metadataStart));
    target.push(tip);
  }
  return { frontmatter, blocks, loc: loc(0) };
}
