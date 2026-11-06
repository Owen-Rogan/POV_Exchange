// POV Exchange build script.
// Runs on the GitHub runner's built-in Node (22) with no npm install, so it
// uses only node: built-ins and no Node-24-only APIs.
//
// Phase 1: copy site/ to dist/.
// Phase 2 will add: validate povs/, build data/*.json, write pov/<slug>/ pages.
//
// Usage:
//   node scripts/build.mjs           build into dist/
//   node scripts/build.mjs --check   validate only, write nothing

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'site');
const distDir = join(root, 'dist');
const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`build: ${message}`);
  process.exit(1);
}

function validate() {
  if (!existsSync(join(siteDir, 'index.html'))) fail('site/index.html is missing');
  if (!existsSync(join(siteDir, '404.html'))) fail('site/404.html is missing');
  if (!statSync(siteDir).isDirectory()) fail('site/ is not a directory');
}

validate();

if (checkOnly) {
  console.log('build: check passed');
  process.exit(0);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(siteDir, distDir, { recursive: true });
console.log('build: wrote dist/');
