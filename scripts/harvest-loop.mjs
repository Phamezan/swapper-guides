import { readFile, writeFile, rename, copyFile, mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { harvest } from './harvest-vods.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const review = path.resolve(root, '../review');
const app = 'C:/Users/Pham2/.herdr/worktrees/Swapper/feat-matchup-vod-player';
// LOCALAPPDATA is Windows-only; CI imports this module for tests on Linux.
const state = path.join(process.env.LOCALAPPDATA ?? root, 'swapper-vod-harvest');
const log = async text => appendFile(path.join(state, 'harvest.log'), `${new Date().toISOString()} ${text}\n`);
const read = async (base, name) => JSON.parse(await readFile(path.join(base, 'vods/cache', name), 'utf8'));
async function save(base, name, data) {
  const file = path.join(base, 'vods/cache', name);
  await writeFile(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n');
  await rename(`${file}.tmp`, file);
}
// Union keys and record fields; canonical records win conflicts, never drop IDs.
export function mergeRecords(older, newer) {
  const result = { ...older };
  for (const [id, row] of Object.entries(newer)) result[id] = { ...result[id], ...row };
  return result;
}
async function mergeCaches() {
  const a = await read(review, 'listings.json'), b = await read(root, 'listings.json');
  const channels = mergeRecords(a.channels, b.channels);
  for (const id of Object.keys(channels)) channels[id].seen = [...new Set([...(a.channels[id]?.seen ?? []), ...(b.channels[id]?.seen ?? [])])];
  await save(root, 'listings.json', { ...a, ...b, channels, videos: mergeRecords(a.videos, b.videos) });
  await save(root, 'details.json', mergeRecords(await read(review, 'details.json'), await read(root, 'details.json')));
  for (const name of ['listings.json', 'details.json']) await copyFile(path.join(root, 'vods/cache', name), path.join(review, 'vods/cache', name));
}
async function run(cwd, script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-8000); });
    child.stderr.on('data', data => { output = (output + data).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${output}`)));
  });
}
async function main() {
  await mkdir(state, { recursive: true });
  await mergeCaches();
  let limit = 1, backoff = 30 * 60_000;
  for (;;) {
    const started = Date.now();
    const before = Object.keys(await read(root, 'details.json')).length;
    // The scheduler log contains one summary per chunk rather than per-video output.
    const original = console.log;
    let report;
    try { console.log = () => {}; report = await harvest(root, { detailsOnly: true, limit }); }
    finally { console.log = original; }
    await mergeCaches();
    await run(review, 'scripts/harvest-vods.mjs', ['--cached']);
    await run(review, 'scripts/build.mjs');
    await run(app, 'scripts/sync-guides.mjs', [path.join(review, 'dist')]);
    const details = await read(root, 'details.json');
    const done = Object.keys(details).length - before;
    const published = await read(review, 'harvest-report.json');
    await log(`done=${done} remaining=${report.detailsRemaining} sec/video=${done ? ((Date.now() - started) / done / 1000).toFixed(1) : 'n/a'} published=${published.written} embeddable-false-hidden=${Object.values(details).filter(d => d.embeddable === false).length} unavailable-hidden=${Object.values(details).filter(d => d.unavailable).length} with-moments=${published.withMoments}${report.stopped ? ` stopped=${report.stopped}` : ''}`);
    if (report.stopped) {
      await log(`backoff=${backoff / 60000}min`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 6 * 60 * 60_000);
    } else {
      if (!report.detailsRemaining) return;
      backoff = 30 * 60_000;
    }
    limit = 300;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async error => { await log(`ERROR ${error.stack}`); process.exitCode = 1; });
}
