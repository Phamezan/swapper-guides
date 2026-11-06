import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function snapshot(data) {
  const items = {};
  if (!data || typeof data !== 'object' || !Object.keys(data).length) throw new Error('Data Dragon item data is empty');
  for (const [key, item] of Object.entries(data)) {
    if (!item?.maps?.['11'] || !item.gold?.purchasable || item.inStore === false || item.requiredAlly) continue;
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0 || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Data Dragon item must have a positive id and name');
    items[id] = item.name;
  }
  if (!Object.keys(items).length) throw new Error('Data Dragon has no purchasable Summoner Rift items');
  // Data Dragon also marks mode variants as map 11; prefer the base id for duplicate names.
  const baseIds = new Map();
  for (const [id, name] of Object.entries(items)) baseIds.set(name, Math.min(baseIds.get(name) ?? Infinity, Number(id)));
  return Object.fromEntries([...baseIds].map(([name, id]) => [id, name]));
}

export async function refresh(root = process.cwd()) {
  const { version } = JSON.parse(await readFile(path.join(root, 'ability-names.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Ability snapshot version is invalid');
  const source = `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`;
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Data Dragon: HTTP ${response.status} for ${source}`);
  const items = snapshot((await response.json()).data);
  await writeFile(path.join(root, 'item-names.json'), `${JSON.stringify({ version, source, items }, null, 2)}\n`);
  return Object.keys(items).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Updated item-names.json (${await refresh()} items)`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
