// Builds the upload zips for GitHub's web uploader, which takes at most 100
// files per upload. Run it from the project root:
//
//   node scripts/package.mjs [--out _package] [--name POV_Exchange]
//
// It writes, into the output folder:
//   <name>_1_app.zip          everything except povs/samples/  (upload this FIRST)
//   <name>_2_samples_A.zip    the first half of povs/samples/
//   <name>_3_samples_B.zip    the second half
// A project with no samples gets just the app zip.
//
// Why the order matters: the app zip contains the build that understands
// povs/samples/. If the samples went up first, the old build on GitHub would
// refuse them and the deploy would fail.
//
// Nothing here deletes or changes project files. It only writes inside the
// output folder (which must be directly inside the project and start with _).

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const LIMIT = 100; // GitHub: "up to 100 files to GitHub at the same time"
export const SAFE_BATCH = 95; // leave room: a README or two may be added by hand

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Files and folders that belong in the project and are uploaded.
const INCLUDE = ['.gitignore', 'CLAUDE.md', 'CONTRIBUTING.md', 'package.json', 'povs', 'scripts', 'site'];

/** Every file under `dir`, as paths relative to `base`, with forward slashes, sorted. */
export function listFiles(base, dir = base) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(base, full));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
}

/**
 * Split files into the three upload sets.
 * @returns {{app:string[], samples:string[][]}} samples is a list of batches, each at most `max` files;
 *          a sample POV folder is never split between two batches.
 */
export function planBatches(files, max = SAFE_BATCH) {
  const isSample = (f) => f.startsWith('povs/samples/');
  const app = files.filter((f) => !isSample(f));
  const samples = files.filter(isSample);

  // group by sample folder so a POV and its documents travel together
  const groups = new Map();
  for (const f of samples) {
    const parts = f.split('/'); // povs/samples/<folder>/<file>, or povs/samples/README.md
    const key = parts.length > 3 ? parts[2] : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const batches = [];
  let current = [];
  for (const [, group] of [...groups].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (group.length > max) throw new Error('one sample folder has more files than a single upload allows');
    if (current.length + group.length > max) { batches.push(current); current = []; }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return { app, samples: batches };
}

function zip(root, files, target) {
  // tar (bsdtar, included with Windows 10+) writes a zip when the name ends in .zip
  const tar = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  const r = spawnSync(tar, ['-a', '-cf', target, '-C', root, ...files], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not write ${basename(target)}: ${r.stderr || r.error}`);
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback; };
  const fail = (m) => { console.error(`package: ${m}`); process.exit(1); };

  const name = arg('--name', 'POV_Exchange');
  if (!/^[A-Za-z0-9_-]+$/.test(name)) fail('--name may only contain letters, digits, - and _');
  const out = resolve(repo, arg('--out', '_package'));
  if (dirname(out) !== repo || !basename(out).startsWith('_')) fail('--out must be a folder directly inside the project whose name starts with _');

  // Stage a clean copy first, so only intended files are ever zipped.
  const stage = mkdtempSync(join(tmpdir(), 'pov-package-'));
  for (const item of INCLUDE) {
    const from = join(repo, item);
    if (!existsSync(from)) continue;
    cpSync(from, join(stage, item), { recursive: true });
  }
  const files = listFiles(stage);
  const { app, samples } = planBatches(files);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const written = [];
  const add = (label, list) => {
    if (list.length > LIMIT) fail(`${label} has ${list.length} files, over GitHub's limit of ${LIMIT}`);
    const target = join(out, label);
    zip(stage, list, target);
    written.push({ label, files: list.length, kb: Math.round(statSync(target).size / 1024) });
  };

  add(`${name}_1_app.zip`, app);
  samples.forEach((batch, i) => add(`${name}_${i + 2}_samples_${String.fromCharCode(65 + i)}.zip`, batch));
  rmSync(stage, { recursive: true, force: true });

  for (const w of written) console.log(`package: ${w.label}  ${w.files} files  ${w.kb} KB`);
  console.log(`package: wrote ${written.length} zip${written.length === 1 ? '' : 's'} to ${basename(out)}/ (upload in the order shown)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
