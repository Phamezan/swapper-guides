import { readFile, readdir, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileContent } from './compile.mjs';

async function markdownFiles(root, relative) {
  let entries;
  try { entries = await readdir(path.join(root, relative), { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await markdownFiles(root, file));
    else if (entry.name.endsWith('.md')) {
      if (!entry.isFile()) throw new Error(`${file}:1: source must be a regular file`);
      files.push(file);
    }
  }
  return files;
}

export async function build(root = process.cwd(), options = {}) {
  const files = ['authors.yml', 'champions.json', ...await markdownFiles(root, 'guides'), ...await markdownFiles(root, 'enemies')];
  const input = new Map();
  for (const file of files) {
    try { input.set(file, await readFile(path.join(root, file), 'utf8')); }
    catch (error) { throw new Error(`${file}:1: ${error.message}`); }
  }
  const result = compileContent(input, options);
  // Validate everything before replacing the last successful build.
  const output = path.resolve(root, 'dist');
  if (path.dirname(output) !== path.resolve(root)) throw new Error('dist must be inside the repository');
  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, 'champions'), { recursive: true });
  for (const [file, bytes] of result.files) await writeFile(path.join(output, file), bytes, 'utf8');
  return result.index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const index = await build();
    console.log(`Built ${Object.values(index.champions).reduce((total, champion) => total + champion.guides, 0)} guides into dist/`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
