import { fail } from './markdown.mjs';
import abilityNames from '../ability-names.json' with { type: 'json' };
import itemNames from '../item-names.json' with { type: 'json' };

// Ordinary shopping/wave words; ability-name collisions are excluded per tip below.
export const IGNORED_ITEM_NAMES = new Set(['Boots', 'Cull']);
const itemsByName = new Map(Object.entries(itemNames.items).map(([id, name]) => [name, Number(id)]));
const itemPattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${[...itemsByName.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');

export function namedItems(text, abilities = []) {
  return [...new Set([...text.matchAll(itemPattern)].map(match => match[0]))]
    .filter(name => !IGNORED_ITEM_NAMES.has(name) && !abilities.some(ability => ability.name === name))
    .map(name => ({ id: itemsByName.get(name), name }));
}

// Existing Renata tips use "Leverage Rumor" for another spell, not her passive Leverage.
export const IGNORED_ABILITY_NAMES = new Set(['Leverage']);
const abilityPatterns = new Map(Object.entries(abilityNames.champions).map(([champion, spells]) => [Number(champion),
  Object.entries(spells).map(([key, name]) => ({ key, patterns: name.split(' / ').map(phrase => ({
    name: phrase,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u'),
  })) })),
]));

export function namedAbilities(text, participants) {
  return [...new Set(participants)].flatMap(champion => {
    const abilities = abilityPatterns.get(champion);
    if (!abilities) throw new Error(`No Data Dragon ability names for champion ${champion}; run npm run refresh:abilities`);
    return abilities.flatMap(({ key, patterns }) => {
      const match = patterns.find(({ pattern }) => pattern.test(text));
      return match ? [{ champion, key, name: match.name }] : [];
    });
  });
}

export const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];

export function blindPicks(document, champions, loc) {
  fields(document, ['patch', 'lanes'], [], loc);
  patch(document.patch, loc);
  fields(document.lanes, LANES, [], loc);
  const lanes = {};
  for (const [lane, picks] of Object.entries(document.lanes)) {
    if (!Array.isArray(picks) || !picks.length || picks.length > 10) fail(loc, `${lane} needs 1 to 10 blind picks`);
    const seen = new Set();
    lanes[lane] = picks.map(pick => {
      fields(pick, ['champion', 'reason', 'sources'], [], loc);
      const champion = championId(pick.champion, champions, loc);
      if (seen.has(champion)) fail(loc, `duplicate blind pick in ${lane}`);
      seen.add(champion);
      plain(pick.reason, loc, 'reason');
      if ([...pick.reason].length > 90 || /[\r\n]/u.test(pick.reason)) fail(loc, 'reason must be one line of at most 90 characters');
      if (!Array.isArray(pick.sources) || !pick.sources.length) fail(loc, 'blind pick sources must be nonempty');
      for (const source of pick.sources) {
        fields(source, ['name', 'url'], [], loc);
        plain(source.name, loc, 'source name');
        let url;
        try { url = new URL(source.url); } catch { fail(loc, 'invalid source URL'); }
        if (url.protocol !== 'https:' || url.username || url.password || url.port || source.url.length > 2048) fail(loc, 'invalid source URL');
      }
      return { champion, reason: pick.reason, sources: pick.sources };
    });
  }
  return { patch: document.patch, lanes };
}
const RANKS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'];

export function authorRank(source, loc) {
  if (Object.hasOwn(source, 'rank') && !RANKS.includes(source.rank)) fail(loc, `rank must be one of ${RANKS.join(', ')}`);
  if (Object.hasOwn(source, 'peak') && source.peak !== true) fail(loc, 'peak must be true when present');
}
const HOSTS = new Set(['mobafire.com', 'www.mobafire.com', 'docs.google.com', 'youtube.com', 'www.youtube.com', 'youtu.be', 'reddit.com', 'www.reddit.com', 'old.reddit.com', 'lolmatchups.gg', 'www.inven.co.kr', 'talk.op.gg', 'mobalytics.gg', 'riven.saltyy.at']);

export function fields(value, required, optional, loc) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(loc, `expected a YAML mapping with required fields: ${required.join(', ')}`);
  for (const field of required) if (!Object.hasOwn(value, field)) fail(loc, `required field ${field} is missing`);
  for (const field of Object.keys(value)) if (![...required, ...optional].includes(field)) fail(loc, `unknown field ${field}`);
}

export function plain(value, loc, label, participants = []) {
  if (typeof value !== 'string' || !value.trim()) fail(loc, `${label} must be nonempty plain text`);
  if (/<[^>]*>|<\/?[a-z][^>]*$|<!--/iu.test(value)) fail(loc, `${label}: HTML is forbidden; use plain text`);
  if (/\*\*|__|~~|`|(^|\W)\*[^*\n]+\*(?=\W|$)|(^|\W)_[^_\n]+_(?=\W|$)|!?\[[^\]]*\]\([^)]*\)/u.test(value)) {
    fail(loc, `${label} must be plain text, without Markdown formatting`);
  }
  if (/\b(?:\d+(?:[.,]\d+)?(?:\s*[–—/\-]\s*\d+(?:[.,]\d+)?)*|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|sixty)[\s-]*(?:seconds?|secs?|s)\b/iu.test(value)) {
    fail(loc, `${label}: literal seconds are forbidden; use a cooldown token`);
  }
  const remaining = value.replace(/\{cd:([1-9]\d*):([QWER])\}/gu, (token, champion) => {
    if (!participants.includes(Number(champion))) fail(loc, `${label}: cooldown champion must be a participant`);
    return '';
  });
  if (/[{}]/u.test(remaining)) fail(loc, `${label}: malformed or unknown token; expected {cd:<championId>:<Q|W|E|R>}`);
  return value;
}

export function patch(value, loc) {
  if (typeof value !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/u.test(value)) fail(loc, 'patch must be a quoted version string, e.g. "26.21"');
  return value;
}

export function ids(value, loc, label) {
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/u.test(id))) {
    fail(loc, `${label} must be a nonempty array of author ids`);
  }
  if (new Set(value).size !== value.length) fail(loc, `${label} contains duplicate ids`);
  return value;
}

export function sourceUrl(value, loc) {
  let url;
  try { url = new URL(value); } catch { fail(loc, 'invalid source URL'); }
  if (url.protocol !== 'https:') fail(loc, 'source URL must use https');
  if (!HOSTS.has(url.hostname) || url.port) fail(loc, 'source URL host is not allowed');
  if (url.username || url.password) fail(loc, 'source URL must not contain credentials');
}

export function championMap(rows, loc = { file: 'champions.json', line: 1 }) {
  if (!Array.isArray(rows) || !rows.length) fail(loc, 'champions snapshot must be a nonempty array');
  const names = new Map();
  const seenIds = new Set();
  for (const row of rows) {
    fields(row, ['id', 'name'], [], loc);
    if (!Number.isSafeInteger(row.id) || row.id <= 0) fail(loc, 'champion id must be a positive integer');
    if (typeof row.name !== 'string' || !row.name.trim() || /[<>:"/\\|?*{}\x00-\x1f]/u.test(row.name)) fail(loc, 'champion name must be a valid file name');
    if (names.has(row.name) || seenIds.has(row.id)) fail(loc, 'duplicate champion name or id');
    names.set(row.name, row.id);
    seenIds.add(row.id);
  }
  return names;
}

export function championId(name, champions, loc, label = 'champion') {
  if (typeof name !== 'string' || !champions.has(name)) fail(loc, `unknown ${label} name ${JSON.stringify(name)}; use a name from champions.json`);
  return champions.get(name);
}

export function compileTip(raw, { champions, sources, participants, scope, onWarning = () => {} }) {
  const metadata = raw.metadata.value ?? {};
  fields(metadata, ['sources'], ['heading', 'patch', 'abilities', 'items', 'outdated'], raw.loc);
  const at = raw.metadata.at;
  const sourceIds = ids(metadata.sources, at('sources'), 'tip sources');
  for (const id of sourceIds) if (!sources.has(id)) fail(at('sources'), `tip source ${id} must be vetted in authors.yml and declared in the guide sources`);
  const tip = { text: plain(raw.text, raw.loc, 'tip text', participants), scope, sourceIds };
  for (const field of ['heading', 'outdated']) {
    if (Object.hasOwn(metadata, field)) tip[field] = plain(metadata[field], at(field), field, participants);
  }
  if (Object.hasOwn(metadata, 'patch')) tip.patch = patch(metadata.patch, at('patch'));
  if (Object.hasOwn(metadata, 'abilities')) {
    if (!Array.isArray(metadata.abilities) || !metadata.abilities.length) fail(at('abilities'), 'abilities must be a nonempty array of Champion.Q references');
    tip.abilityKeys = metadata.abilities.map(reference => {
      const match = typeof reference === 'string' && /^(.*)\.([PQWER])$/u.exec(reference);
      if (!match) fail(at('abilities'), `malformed ability reference ${JSON.stringify(reference)}`);
      const champion = championId(match[1], champions, at('abilities'));
      if (!participants.includes(champion)) fail(at('abilities'), 'ability champion must be a participant');
      return { champion, key: match[2] };
    });
  }
  if (Object.hasOwn(metadata, 'items')) {
    if (!Array.isArray(metadata.items) || !metadata.items.length || metadata.items.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      fail(at('items'), 'items must be a nonempty array of positive integer item ids');
    }
    tip.itemIds = metadata.items;
  }
  const named = namedAbilities(tip.text, participants);
  const reference = ref => `${[...champions].find(([, id]) => id === ref.champion)[0]}.${ref.key}`;
  const sameAbility = (a, b) => a.champion === b.champion && a.key === b.key;
  const missing = named.filter(ref => !IGNORED_ABILITY_NAMES.has(ref.name) && !tip.abilityKeys?.some(listed => sameAbility(ref, listed)));
  if (missing.length) fail(raw.loc, `tip names abilities missing from abilities: ${missing.map(ref => `${reference(ref)} (${ref.name})`).join(', ')}`);
  const missingItems = namedItems(tip.text, named).filter(item => !tip.itemIds?.includes(item.id));
  if (missingItems.length) fail(raw.loc, `tip names items missing from items: ${missingItems.map(item => `${item.id} (${item.name})`).join(', ')}`);
  for (const ref of tip.abilityKeys ?? []) {
    if (!named.some(match => sameAbility(ref, match))) {
      onWarning(`${raw.loc.file}:${raw.loc.line}: ${reference(ref)} (${abilityNames.champions[ref.champion][ref.key]}) is listed but not named in tip text`);
    }
  }
  return tip;
}
