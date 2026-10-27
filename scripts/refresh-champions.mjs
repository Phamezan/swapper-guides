import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { championMap } from './validate.mjs';

export const CHAMPION_SUMMARY_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json';

export function snapshot(summary) {
  if (!Array.isArray(summary) || summary.some(row => !row || !Number.isSafeInteger(row.id) || typeof row.name !== 'string')) {
    throw new Error('CommunityDragon champion summary must be an array of {id, name} entries');
  }
  // Exclude the placeholder and Jade mode variants that reuse champion names.
  const champions = summary.filter(row => row.id > 0 && !row.alias?.startsWith('Jade_'))
    .map(({ id, name }) => ({ id, name })).sort((a, b) => a.id - b.id);
  championMap(champions);
  return champions;
}

export async function refresh(root = process.cwd()) {
  const response = await fetch(CHAMPION_SUMMARY_URL, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`CommunityDragon: HTTP ${response.status}`);
  const champions = snapshot(await response.json());
  await writeFile(path.join(root, 'champions.json'), `${JSON.stringify(champions, null, 2)}\n`);
  return champions.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Updated champions.json (${await refresh()} champions)`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
