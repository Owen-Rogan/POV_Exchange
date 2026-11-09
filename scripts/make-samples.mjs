// Sample-content generator, for previewing the graph with many entries.
//
// Writes a throwaway copy of the site plus N clearly fictional POVs into
// _samples/ (git-ignored, never part of an upload), then builds it there. The
// real povs/ folder is never read or changed.
//
//   node scripts/make-samples.mjs [--count 36] [--seed 7] [--out _samples]
//   node scripts/serve.mjs --prefix /POV_Exchange --dir _samples/dist --port 8081
//
// Every sample says it is fictional, so nothing here can be mistaken for the
// practice's real point of view.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// id, title, parent, related
const TOPICS = [
  ['ai-strategy', 'AI strategy', null, []],
  ['agents', 'Agents', 'ai-strategy', ['governance']],
  ['governance', 'Governance and risk', 'ai-strategy', []],
  ['data-foundations', 'Data foundations', 'ai-strategy', ['agents']],
  ['evaluation', 'Evaluation and testing', 'ai-strategy', ['agents']],
  ['operating-model', 'Operating model', 'ai-strategy', ['workforce']],
  ['workforce', 'Workforce and skills', null, ['adoption']],
  ['adoption', 'Adoption and change', 'workforce', []],
  ['security', 'Security', 'governance', ['agents']],
  ['platforms', 'Platforms and tooling', null, ['data-foundations']],
];

const SUBJECTS = ['Pilots', 'Guardrails', 'Handoffs', 'Prompts', 'Metrics', 'Roadmaps', 'Reviews', 'Budgets', 'Playbooks', 'Pipelines', 'Reports', 'Checklists'];
const CLAIMS = ['need an owner', 'should start small', 'are a team sport', 'scale slower than expected', 'pay back late', 'fail quietly', 'deserve a checklist', 'work best in pairs'];
const HEADINGS = ['What we would say', 'Why it matters', 'A closer look', 'What to do first'];
const AUTHORS = ['Sample Author A', 'Sample Author B', 'Sample Author C', 'Sample Author D', 'Sample Author E'];

/**
 * Writes povs/topics.json and povs/sample-NN/ folders under `root`.
 * Creates files only: it never deletes anything.
 */
export function writeSamples(root, { count = 36, seed = 7 } = {}) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const povsDir = join(root, 'povs');
  mkdirSync(povsDir, { recursive: true });

  const topics = TOPICS.map(([id, title, parent, related]) => ({
    id, title,
    view: 'SAMPLE TEXT: a fictional placeholder, not a position the practice holds.',
    ...(parent ? { parent } : {}),
    ...(related.length ? { related } : {}),
  }));
  writeFileSync(join(povsDir, 'topics.json'), JSON.stringify(topics, null, 2) + '\n');

  const topicIds = TOPICS.map((t) => t[0]);
  const width = String(count).length;
  const start = Date.UTC(2026, 0, 5);
  const slugs = [];

  for (let i = 1; i <= count; i++) {
    const nn = String(i).padStart(width, '0');
    const slug = `sample-${nn}`;
    const chosen = new Set([pick(topicIds)]);
    if (rand() < 0.4) chosen.add(pick(topicIds));
    if (rand() < 0.1) chosen.add(pick(topicIds));
    const related = slugs.length > 0 && rand() < 0.3 ? [pick(slugs)] : [];
    const withDoc = rand() < 0.2;
    const date = new Date(start + Math.floor((i / count) * 300) * 86400000).toISOString().slice(0, 10);
    const title = `Sample ${nn}: ${pick(SUBJECTS)} ${pick(CLAIMS)}`;
    const summary = pick([
      'A fictional sample used to test how the graph and pages look with many entries.',
      'Made-up text for layout testing. It says nothing about what the practice thinks.',
      'Sample content, generated for a preview. Not a real point of view.',
    ]);

    const front = [
      '---',
      `title: "${title}"`,
      `summary: "${summary}"`,
      'type: pov',
      `topics: [${[...chosen].join(', ')}]`,
      `author: "${pick(AUTHORS)}"`,
      `date: ${date}`,
      ...(related.length ? [`related: [${related.join(', ')}]`] : []),
      ...(withDoc ? ['documents: ["sample-notes.txt"]'] : []),
      '---',
    ].join('\n');
    const body = [
      'This is a **fictional sample** used to test the site with many entries. It says nothing about what the practice thinks.',
      '',
      `## ${pick(HEADINGS)}`,
      '',
      '- First sample point',
      '- Second sample point',
      '- Third sample point',
      '',
    ].join('\n');

    const dir = join(povsDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pov.md'), `${front}\n${body}`);
    if (withDoc) writeFileSync(join(dir, 'sample-notes.txt'), 'Fictional sample attachment. Not real content.\n');
    slugs.push(slug);
  }
  return { count, topics: topics.length };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const fail = (msg) => { console.error(`make-samples: ${msg}`); process.exit(1); };

  const count = Number(arg('--count', '36'));
  const seed = Number(arg('--seed', '7'));
  if (!Number.isInteger(count) || count < 1 || count > 500) fail('--count must be a whole number from 1 to 500');
  if (!Number.isInteger(seed) || seed < 0) fail('--seed must be a whole number, 0 or more');

  // This script deletes its output folder first, so it only accepts a folder
  // directly inside the project whose name starts with _samples.
  const out = resolve(repo, arg('--out', '_samples'));
  if (dirname(out) !== repo || !basename(out).startsWith('_samples')) {
    fail('--out must be a folder directly inside the project, named starting with _samples');
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(repo, 'site'), join(out, 'site'), { recursive: true });
  const made = writeSamples(out, { count, seed });
  console.log(`make-samples: wrote ${made.count} fictional POVs and ${made.topics} topics to ${basename(out)}/`);

  const build = spawnSync(process.execPath, [join(repo, 'scripts', 'build.mjs'), '--root', out], { stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
  console.log(`make-samples: preview with: node scripts/serve.mjs --prefix /POV_Exchange --dir ${basename(out)}/dist --port 8081`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
