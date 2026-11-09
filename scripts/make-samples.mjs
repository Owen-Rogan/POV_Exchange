// Sample-content generator: fictional POVs, for ideation and for testing the
// graph with many entries.
//
// Two modes:
//
//   node scripts/make-samples.mjs [--count 36] [--seed 7] [--out _samples]
//       Preview. Writes a throwaway copy of the site plus N samples into a
//       folder named _samples* (git-ignored, never uploaded), then builds it.
//       The real povs/ folder is never read or changed.
//         node scripts/serve.mjs --prefix /POV_Exchange --dir _samples/dist --port 8081
//
//   node scripts/make-samples.mjs --repo [--count 120] [--seed 7]
//       Adds the samples to the real project, under povs/samples/, and adds the
//       sample-only topics to povs/topics.json (flagged "sample": true). It only
//       creates files, never deletes, and refuses to run if povs/samples/ exists.
//       To remove every sample later: delete povs/samples/. The sample-only
//       topics then disappear from the site by themselves.
//
// Every sample says it is fictional, so nothing here can be mistaken for the
// practice's real point of view.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// id, title, parent, related, sampleOnly
// The first four match the placeholder topics already in povs/topics.json. The
// rest exist only for the samples and are flagged so they vanish with them.
const TOPICS = [
  ['ai-strategy', 'AI strategy', null, [], false],
  ['agents', 'Agents', 'ai-strategy', ['governance'], false],
  ['governance', 'Governance and risk', 'ai-strategy', [], false],
  ['data-foundations', 'Data foundations', 'ai-strategy', ['agents'], false],
  ['evaluation', 'Evaluation and testing', 'ai-strategy', ['agents'], true],
  ['operating-model', 'Operating model', 'ai-strategy', ['workforce'], true],
  ['workforce', 'Workforce and skills', null, ['adoption'], true],
  ['adoption', 'Adoption and change', 'workforce', [], true],
  ['security', 'Security', 'governance', ['agents'], true],
  ['platforms', 'Platforms and tooling', null, ['data-foundations'], true],
];

const SAMPLE_VIEW = 'SAMPLE TEXT: a fictional placeholder, not a position the practice holds.';
const SUBJECTS = ['Pilots', 'Guardrails', 'Handoffs', 'Prompts', 'Metrics', 'Roadmaps', 'Reviews', 'Budgets', 'Playbooks', 'Pipelines', 'Reports', 'Checklists'];
const CLAIMS = ['need an owner', 'should start small', 'are a team sport', 'scale slower than expected', 'pay back late', 'fail quietly', 'deserve a checklist', 'work best in pairs'];
const HEADINGS = ['What we would say', 'Why it matters', 'A closer look', 'What to do first'];
const AUTHORS = ['Sample Author A', 'Sample Author B', 'Sample Author C', 'Sample Author D', 'Sample Author E'];

// Fictional glossary terms: slug, term, aliases, related (slugs), one-line definition.
// Each says plainly that it is a sample, so it cannot be read as the practice's definition.
const TERMS = [
  ['agent', 'Agent', ['agents'], ['guardrail', 'human-in-the-loop'], 'Sample definition: software that takes steps toward a goal on its own.'],
  ['guardrail', 'Guardrail', ['guardrails'], ['human-in-the-loop'], 'Sample definition: a rule that keeps a system inside agreed limits.'],
  ['human-in-the-loop', 'Human in the loop', [], ['guardrail'], 'Sample definition: a person who reviews or approves before an action happens.'],
  ['prompt', 'Prompt', ['prompts'], [], 'Sample definition: the instruction given to a model.'],
  ['evaluation', 'Evaluation', ['evals'], ['benchmark'], 'Sample definition: a repeatable test of how well a system does a task.'],
  ['benchmark', 'Benchmark', ['benchmarks'], ['evaluation'], 'Sample definition: a shared test used to compare systems.'],
  ['hallucination', 'Hallucination', ['hallucinations'], ['grounding'], 'Sample definition: a confident answer that is not supported by the facts.'],
  ['grounding', 'Grounding', [], ['hallucination', 'retrieval'], 'Sample definition: tying an answer to a named source.'],
  ['retrieval', 'Retrieval', [], ['grounding'], 'Sample definition: fetching relevant material before answering.'],
  ['pilot', 'Pilot', ['pilots'], ['proof-of-value'], 'Sample definition: a small, time-boxed trial of a new approach.'],
  ['proof-of-value', 'Proof of value', [], ['pilot'], 'Sample definition: evidence that a pilot is worth scaling.'],
  ['operating-model', 'Operating model', [], ['governance-board'], 'Sample definition: how people, process and tools fit together to deliver.'],
  ['governance-board', 'Governance board', [], ['operating-model'], 'Sample definition: the group that decides what is allowed and who is accountable.'],
  ['use-case', 'Use case', ['use cases'], ['pilot'], 'Sample definition: a specific task a system is meant to help with.'],
  ['model-card', 'Model card', [], [], 'Sample definition: a short document describing what a model is for and its limits.'],
  ['drift', 'Drift', [], ['monitoring'], 'Sample definition: performance slowly changing as the world changes.'],
  ['monitoring', 'Monitoring', [], ['drift'], 'Sample definition: watching a live system for problems.'],
  ['red-teaming', 'Red teaming', [], ['guardrail'], 'Sample definition: deliberately trying to break a system to find weaknesses.'],
  ['data-lineage', 'Data lineage', [], [], 'Sample definition: a record of where data came from and how it changed.'],
  ['upskilling', 'Upskilling', [], [], 'Sample definition: helping people learn the skills a new way of working needs.'],
  ['change-champion', 'Change champion', ['champions'], ['upskilling'], 'Sample definition: a colleague who helps their team adopt something new.'],
  ['shadow-ai', 'Shadow AI', [], ['governance-board'], 'Sample definition: AI tools used without the organisation knowing.'],
  ['fine-tuning', 'Fine-tuning', [], [], 'Sample definition: adjusting a model with extra examples for one purpose.'],
  ['context-window', 'Context window', [], ['prompt'], 'Sample definition: how much text a model can consider at once.'],
  ['orchestration', 'Orchestration', [], ['agent'], 'Sample definition: coordinating several steps or systems to finish a job.'],
];
// Words from the terms above that the sample POV text can mention, so the pop-ups have something to show.
const MENTIONS = ['guardrail', 'pilot', 'evaluation', 'human in the loop', 'agent', 'prompt', 'monitoring', 'use case', 'operating model', 'hallucination'];

// Fake Box-shaped links. They look like real share links but point at nothing.
const fakeLink = (slug, n) => `https://example.box.com/s/sample${slug.replace(/\D/g, '')}doc${n}`;

const README = `# Sample POVs

Everything in this folder is **fictional**. These POVs were generated to try out the library and the knowledge graph while the site is still being shaped. They say nothing about what the practice thinks.

Each folder here is flagged as a sample by its location alone. On the site they carry a "Sample" tag, and a switch hides them. Document links here are fake: they look like Box links but open nothing. The \`glossary\` folder holds fictional terms in the same way.

## Remove them all

Delete this whole \`povs/samples\` folder. Then, in \`povs/topics.json\`, you can also delete the topics marked \`"sample": true\` (the site already hides them once no POV uses them).

## Add your own

Real POVs go in \`povs/<name>/pov.md\`, not here. See CONTRIBUTING.md.
`;

/**
 * Writes samples under `<root>/povs/samples/`. In `merge` mode it adds the
 * sample-only topics to an existing povs/topics.json instead of replacing it.
 * Only creates files: it never deletes anything.
 */
export function writeSamples(root, { count = 36, seed = 7, merge = false } = {}) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const povsDir = join(root, 'povs');
  const samplesDir = join(povsDir, 'samples');
  mkdirSync(samplesDir, { recursive: true });

  // Topics: preview mode writes all ten; merge mode adds only the ones that are missing.
  const topicsFile = join(povsDir, 'topics.json');
  let topics = [];
  if (merge && existsSync(topicsFile)) topics = JSON.parse(readFileSync(topicsFile, 'utf8'));
  const have = new Set(topics.map((t) => t.id));
  const wanted = new Set([...have, ...TOPICS.filter(([id, , , , sampleOnly]) => !have.has(id) && (!merge || sampleOnly)).map(([id]) => id)]);
  let added = 0;
  for (const [id, title, parent, related, sampleOnly] of TOPICS) {
    if (have.has(id) || !wanted.has(id)) continue;
    const t = { id, title, view: SAMPLE_VIEW };
    if (parent && wanted.has(parent)) t.parent = parent;
    const rel = related.filter((r) => wanted.has(r));
    if (rel.length) t.related = rel;
    if (sampleOnly) t.sample = true;
    topics.push(t);
    added += 1;
  }
  writeFileSync(topicsFile, JSON.stringify(topics, null, 2) + '\n');

  const topicIds = topics.map((t) => t.id);
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
    const status = rand() < 0.6 ? 'agreed' : 'draft';
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
      `status: ${status}`,
      `topics: [${[...chosen].join(', ')}]`,
      `author: "${pick(AUTHORS)}"`,
      `date: ${date}`,
      ...(related.length ? [`related: [${related.join(', ')}]`] : []),
      ...(withDoc ? [`documents: ["Sample deck, part ${(i % 3) + 1} | ${fakeLink(nn, 1)}"]`] : []),
      '---',
    ].join('\n');
    const body = [
      'This is a **fictional sample** used to test the site with many entries. It says nothing about what the practice thinks.',
      '',
      `## ${pick(HEADINGS)}`,
      '',
      `- A sample point about each ${pick(MENTIONS)}`,
      `- A second sample point, this time about a ${pick(MENTIONS)}`,
      '- A third sample point with nothing special in it',
      '',
    ].join('\n');

    const dir = join(samplesDir, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pov.md'), `${front}\n${body}`);
    slugs.push(slug);
  }

  // Fictional glossary terms, one file each, in their own sample folder.
  const glossaryDir = join(samplesDir, 'glossary');
  mkdirSync(glossaryDir, { recursive: true });
  for (const [slug, term, aliases, related, summary] of TERMS) {
    const lines = ['---', `term: "${term}"`, `summary: "${summary}"`];
    if (aliases.length) lines.push(`aliases: [${aliases.map((a) => `"${a}"`).join(', ')}]`);
    if (related.length) lines.push(`related: [${related.join(', ')}]`);
    lines.push('---', 'This is a fictional sample term. It says nothing about how the practice uses the word.', '');
    writeFileSync(join(glossaryDir, `${slug}.md`), lines.join('\n'));
  }
  writeFileSync(join(samplesDir, 'README.md'), README);
  return { count, topics: topics.length, addedTopics: added, terms: TERMS.length };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const fail = (msg) => { console.error(`make-samples: ${msg}`); process.exit(1); };

  const toRepo = argv.includes('--repo');
  const count = Number(arg('--count', toRepo ? '120' : '36'));
  const seed = Number(arg('--seed', '7'));
  if (!Number.isInteger(count) || count < 1 || count > 500) fail('--count must be a whole number from 1 to 500');
  if (!Number.isInteger(seed) || seed < 0) fail('--seed must be a whole number, 0 or more');
  if (toRepo && argv.includes('--out')) fail('use either --repo or --out, not both');

  if (toRepo) {
    if (existsSync(join(repo, 'povs', 'samples'))) fail('povs/samples already exists. Delete it first if you want to generate again.');
    if (!existsSync(join(repo, 'povs', 'topics.json'))) fail('povs/topics.json is missing, so there is nothing to add topics to');
    const made = writeSamples(repo, { count, seed, merge: true });
    console.log(`make-samples: wrote ${made.count} fictional POVs and ${made.terms} glossary terms to povs/samples/ and added ${made.addedTopics} sample-only topics to povs/topics.json`);
    console.log('make-samples: to remove them all later, delete povs/samples/');
    return;
  }

  // This mode deletes its output folder first, so it only accepts a folder
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
