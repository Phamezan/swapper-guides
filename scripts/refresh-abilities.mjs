import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = 'https://ddragon.leagueoflegends.com';

export function snapshot(data) {
  const champions = {};
  if (!data || typeof data !== 'object' || !Object.keys(data).length) throw new Error('Data Dragon champion data is empty');
  for (const champion of Object.values(data)) {
    const id = Number(champion?.key);
    const names = [champion?.passive?.name, ...(champion?.spells ?? []).map(spell => spell.name)];
    if (!Number.isSafeInteger(id) || id <= 0 || champions[id] || names.length !== 5 || names.some(name => typeof name !== 'string' || !name.trim())) {
      throw new Error('Data Dragon champion must have a unique id and P/Q/W/E/R names');
    }
    champions[id] = Object.fromEntries(['P', 'Q', 'W', 'E', 'R'].map((key, i) => [key, names[i]]));
  }
  return champions;
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Data Dragon: HTTP ${response.status} for ${url}`);
  return response.json();
}

export async function refresh(root = process.cwd()) {
  const [version] = await json(`${BASE}/api/versions.json`);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Data Dragon version is invalid');
  const source = `${BASE}/cdn/${version}/data/en_US/championFull.json`;
  const champions = snapshot((await json(source)).data);
  await writeFile(path.join(root, 'ability-names.json'), `${JSON.stringify({ version, source, champions }, null, 2)}\n`);
  return Object.keys(champions).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Updated ability-names.json (${await refresh()} champions)`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
