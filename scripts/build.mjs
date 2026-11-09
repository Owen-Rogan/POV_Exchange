// POV Exchange build script.
//
// Runs on the GitHub runner's built-in Node (22) with no npm install, so it
// uses only node: built-ins and nothing newer than Node 22.
//
//   node scripts/build.mjs           validate, then build into dist/
//   node scripts/build.mjs --check   validate only, write nothing
//   node scripts/build.mjs --root D  use D instead of the repo root (tests)
//
// Inputs:  povs/topics.json, povs/<slug>/pov.md, povs/glossary/*.md, povs/samples/..., site.config.json, site/
// Outputs: dist/  = site/ + data/*.json + data/pov/<slug>.json + pov/<slug>/index.html
//
// Documents are links to Box, SharePoint or OneDrive, written in front matter as
// `Title | link`. Nothing is uploaded into the repo, so a POV folder holds pov.md only.
//
// povs/samples/ holds fictional sample POVs. Every POV in it is flagged
// `sample`, from its folder alone (never from front matter), so deleting that one
// folder removes all of them. Topics marked "sample": true disappear by
// themselves when no POV uses them.
//
// Errors name the file, the line and the rule. They never repeat the offending
// text, because it may be something that should not be repeated (a token, an
// email address).

import {
  cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULTS, validateConfig } from './lib/config.mjs';
import { parseDocumentEntry } from './lib/doc-links.mjs';
import { normalise, splitFrontMatter } from './lib/frontmatter.mjs';
import { compileMatcher, markTerms, usedTerms } from './lib/glossary.mjs';
import { computeLayout } from './lib/layout.mjs';
import { parseBlocks } from './lib/markdown.mjs';
import {
  MARKERS, expandMarkers, filtersHtml, footerHtml, glossaryPageHtml, headTags, headerHtml, latestHtml,
  nodelistHtml, povPage, previewHtml, posterHtml, sectionsHtml, statsHtml, tilesHtml,
} from './lib/pages.mjs';
import { scanText } from './lib/rules.mjs';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const rootFlag = argv.indexOf('--root');
const root = resolve(
  rootFlag !== -1 && argv[rootFlag + 1] ? argv[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const libDir = join(dirname(fileURLToPath(import.meta.url)), 'lib'); // the build's own modules, not content
const siteDir = join(root, 'site');
const distDir = join(root, 'dist');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_POV_BYTES = 200 * 1024;
const MAX_DOCS = 20;
const POV_KEYS = new Set(['title', 'summary', 'type', 'status', 'topics', 'author', 'date', 'related', 'documents']);
const STATUSES = new Set(['draft', 'agreed']);
const TERM_KEYS = new Set(['term', 'summary', 'aliases', 'related']);
const RESERVED_FOLDERS = new Set(['samples', 'glossary']);
const TOPIC_KEYS = new Set(['id', 'title', 'view', 'parent', 'related', 'sample']);
const REPO = 'Owen-Rogan/POV_Exchange';

const errors = [];
const report = (file, line, rule) => errors.push({ file, line, rule });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const readText = (rel) => normalise(readFileSync(join(root, rel), 'utf8'));

// ------------------------------------------------------------- settings

function loadConfig() {
  const file = 'site.config.json';
  if (!existsSync(join(root, file))) return { ...DEFAULTS };
  let data;
  try { data = JSON.parse(readText(file)); } catch { report(file, 0, 'is not valid JSON'); return { ...DEFAULTS }; }
  const { config, problems } = validateConfig(data);
  for (const p of problems) report(file, 0, p);
  return config;
}
const config = loadConfig();

// ---------------------------------------------------------------- topics

function loadTopics() {
  const file = 'povs/topics.json';
  if (!existsSync(join(root, file))) { report(file, 0, 'file is missing'); return []; }
  const text = readText(file);
  for (const f of scanText(text)) report(file, f.line, f.rule);

  let data;
  try { data = JSON.parse(text); } catch { report(file, 0, 'is not valid JSON'); return []; }
  if (!Array.isArray(data) || data.length === 0) { report(file, 0, 'must be a non-empty list of topics'); return []; }

  const topics = [];
  const ids = new Set();
  data.forEach((t, i) => {
    const at = `topic #${i + 1}`;
    if (!t || typeof t !== 'object' || Array.isArray(t)) { report(file, 0, `${at} must be an object`); return; }
    for (const k of Object.keys(t)) if (!TOPIC_KEYS.has(k)) report(file, 0, `${at} has an unknown key`);

    const text1 = (k, max) => {
      if (typeof t[k] !== 'string' || !t[k].trim()) { report(file, 0, `${at} needs a text '${k}'`); return ''; }
      if (t[k].length > max) { report(file, 0, `${at} '${k}' is longer than ${max} characters`); return ''; }
      return t[k].trim();
    };
    const id = text1('id', 40);
    if (id && !SLUG.test(id)) report(file, 0, `${at} 'id' must be lowercase letters, digits and hyphens`);
    if (id && ids.has(id)) report(file, 0, `${at} repeats an earlier topic id`);
    ids.add(id);
    const title = text1('title', 80);
    const view = text1('view', 300);
    if (t.parent !== undefined && typeof t.parent !== 'string') report(file, 0, `${at} 'parent' must be a topic id`);
    if (t.related !== undefined && (!Array.isArray(t.related) || t.related.some((r) => typeof r !== 'string'))) {
      report(file, 0, `${at} 'related' must be a list of topic ids`);
    }
    if (t.sample !== undefined && typeof t.sample !== 'boolean') report(file, 0, `${at} 'sample' must be true or false`);
    topics.push({
      id, title, view,
      sample: t.sample === true,
      parent: typeof t.parent === 'string' ? t.parent : null,
      related: Array.isArray(t.related) ? t.related.filter((r) => typeof r === 'string') : [],
    });
  });

  const byId = new Map(topics.map((t) => [t.id, t]));
  for (const t of topics) {
    if (t.parent !== null && !byId.has(t.parent)) report(file, 0, `topic '${t.id}' has a parent that is not a topic`);
    if (t.parent === t.id) report(file, 0, `topic '${t.id}' is its own parent`);
    for (const r of t.related) {
      if (!byId.has(r)) report(file, 0, `topic '${t.id}' lists a related topic that does not exist`);
      if (r === t.id) report(file, 0, `topic '${t.id}' lists itself as related`);
    }
    const seen = new Set([t.id]);
    for (let p = t.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) { report(file, 0, `topic '${t.id}' is in a parent loop`); break; }
      seen.add(p);
    }
  }
  return topics;
}

// ------------------------------------------------------------------ POVs

function loadPov(slug, topicIds, base = 'povs', sample = false) {
  const dir = `${base}/${slug}`;
  const file = `${dir}/pov.md`;
  if (!SLUG.test(slug) || slug.length > 60) {
    report(dir, 0, 'folder name must be lowercase letters, digits and hyphens (max 60 characters)');
    return null;
  }
  const entries = readdirSync(join(root, dir), { withFileTypes: true }).sort(byName);
  for (const e of entries) {
    if (e.isDirectory() || e.isSymbolicLink()) report(`${dir}/${e.name}`, 0, 'folders and links are not allowed inside a POV folder');
  }
  const pov = entries.find((e) => e.name === 'pov.md');
  if (!pov || !pov.isFile()) { report(dir, 0, 'pov.md is missing'); return null; }
  if (lstatSync(join(root, file)).size > MAX_POV_BYTES) { report(file, 0, `is larger than ${MAX_POV_BYTES / 1024} KB`); return null; }

  const text = readText(file);
  const before = errors.length;
  for (const f of scanText(text, { html: true })) report(file, f.line, f.rule);

  const fm = splitFrontMatter(text);
  for (const e of fm.errors) report(file, e.line, e.rule);
  if (fm.errors.length) return null;

  for (const [k, f] of Object.entries(fm.fields)) if (!POV_KEYS.has(k)) report(file, f.line, 'unknown front matter key');

  const str = (key, max, required = true) => {
    const f = fm.fields[key];
    if (!f) { if (required) report(file, 0, `front matter is missing '${key}'`); return ''; }
    if (typeof f.value !== 'string') { report(file, f.line, `'${key}' must be text, not a list`); return ''; }
    if (!f.value) { report(file, f.line, `'${key}' is empty`); return ''; }
    if (f.value.length > max) { report(file, f.line, `'${key}' is longer than ${max} characters`); return ''; }
    return f.value;
  };
  const list = (key, required) => {
    const f = fm.fields[key];
    if (!f) { if (required) report(file, 0, `front matter is missing '${key}'`); return { items: [], line: 0 }; }
    if (!Array.isArray(f.value)) { report(file, f.line, `'${key}' must be a list like [one, two]`); return { items: [], line: f.line }; }
    if (required && f.value.length === 0) report(file, f.line, `'${key}' needs at least one entry`);
    if (f.value.length > 20) report(file, f.line, `'${key}' has more than 20 entries`);
    if (new Set(f.value).size !== f.value.length) report(file, f.line, `'${key}' repeats an entry`);
    return { items: f.value, line: f.line };
  };

  const title = str('title', 120);
  const summary = str('summary', 240);
  const author = str('author', 80);
  if (author && /[@<>:/\\]/.test(author)) report(file, fm.fields.author.line, "'author' must be a name only (no email, link or handle)");

  let type = 'pov';
  if (fm.fields.type) {
    type = str('type', 20);
    if (type && type !== 'pov' && type !== 'document') { report(file, fm.fields.type.line, "'type' must be pov or document"); type = 'pov'; }
  }

  // Status is required, so nothing becomes the practice's agreed position by default.
  const status = str('status', 10);
  if (status && !STATUSES.has(status)) { report(file, fm.fields.status.line, "'status' must be draft or agreed"); }

  const date = str('date', 10);
  if (date) {
    const m = DATE.exec(date);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      report(file, fm.fields.date.line, "'date' must be a real date written YYYY-MM-DD");
    }
  }

  const topics = list('topics', true);
  for (const t of topics.items) if (!topicIds.has(t)) report(file, topics.line, 'lists a topic that is not in povs/topics.json');
  const related = list('related', false);
  const docsField = list('documents', false);

  // Documents are links to Box, SharePoint or OneDrive. Files are never uploaded into the repo.
  const documents = [];
  if (docsField.items.length > MAX_DOCS) report(file, docsField.line, `lists more than ${MAX_DOCS} documents`);
  const seenLinks = new Set();
  for (const entry of docsField.items) {
    const doc = parseDocumentEntry(entry, { allowPersonalOneDrive: config.allowPersonalOneDrive });
    if (!doc.ok) { report(file, docsField.line, doc.rule); continue; }
    if (seenLinks.has(doc.url)) { report(file, docsField.line, 'the same document link is listed twice'); continue; }
    seenLinks.add(doc.url);
    documents.push({ title: doc.title, url: doc.url, host: doc.host });
  }
  for (const e of entries) {
    if (e.isFile() && e.name !== 'pov.md') {
      report(`${dir}/${e.name}`, 0, 'documents must be links in pov.md, not uploaded files (remove this file)');
    }
  }

  // Body.
  if (fm.body.length > 100_000) report(file, 0, 'body is longer than 100,000 characters');
  const seenRules = new Set();
  const blocks = parseBlocks(fm.body, (rule, line) => {
    if (seenRules.has(rule)) return;
    seenRules.add(rule);
    report(file, fm.bodyStartLine + line - 1, rule);
  });
  if (type === 'pov' && blocks.length === 0) report(file, 0, 'a POV needs body text (use type: document for files only)');

  if (errors.length > before) return null;
  return {
    slug, title, summary, author, date, type, status, sample, dir,
    topics: topics.items, related: related.items, relatedLine: related.line, file,
    documents, blocks,
  };
}

function loadPovs(topicIds) {
  const povsDir = join(root, 'povs');
  if (!existsSync(povsDir)) { report('povs', 0, 'folder is missing'); return []; }
  const povs = [];
  const taken = new Set();

  const readContainer = (base, sample) => {
    for (const e of readdirSync(join(root, base), { withFileTypes: true }).sort(byName)) {
      if (e.name === 'README.md' || e.name.startsWith('_') || e.name.startsWith('.')) continue;
      if (!sample && e.name === 'topics.json') continue;
      if (!sample && e.name === 'samples' && e.isDirectory()) { readContainer('povs/samples', true); continue; }
      if (e.name === 'glossary' && e.isDirectory()) continue; // read by loadGlossary()
      if (!e.isDirectory()) {
        report(`${base}/${e.name}`, 0, sample ? 'only POV folders belong in povs/samples/' : 'only topics.json and POV folders belong in povs/');
        continue;
      }
      if (RESERVED_FOLDERS.has(e.name)) { report(`${base}/${e.name}`, 0, 'this folder name is reserved'); continue; }
      if (taken.has(e.name)) { report(`${base}/${e.name}`, 0, 'folder name is already used by another POV (names must be unique, including samples)'); continue; }
      taken.add(e.name);
      const p = loadPov(e.name, topicIds, base, sample);
      if (p) povs.push(p);
    }
  };
  readContainer('povs', false);

  const slugs = new Set(povs.map((p) => p.slug));
  for (const p of povs) {
    for (const r of p.related) {
      if (r === p.slug) report(p.file, p.relatedLine, 'a POV cannot list itself as related');
      else if (!slugs.has(r)) report(p.file, p.relatedLine, 'lists a related POV that does not exist');
    }
  }
  return povs;
}

/** Topics marked "sample" that no POV uses are dropped, so removing povs/samples/ also removes them. */
function pruneTopics(all, povs) {
  const used = new Set(povs.flatMap((p) => p.topics));
  const kept = all.filter((t) => !t.sample || used.has(t.id));
  const ids = new Set(kept.map((t) => t.id));
  return kept.map((t) => ({
    ...t,
    parent: t.parent && ids.has(t.parent) ? t.parent : null,
    related: t.related.filter((r) => ids.has(r)),
  }));
}

// -------------------------------------------------------------- glossary

/**
 * Glossary entries are single files: povs/glossary/<slug>.md for real terms and
 * povs/samples/glossary/<slug>.md for samples (flagged `sample` by their folder alone).
 */
function loadGlossary() {
  const terms = [];
  const names = new Map(); // lower-case term or alias -> slug
  const slugs = new Set();
  for (const [base, sample] of [['povs/glossary', false], ['povs/samples/glossary', true]]) {
    if (!existsSync(join(root, base))) continue;
    for (const e of readdirSync(join(root, base), { withFileTypes: true }).sort(byName)) {
      if (e.name === 'README.md' || e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const rel = `${base}/${e.name}`;
      if (!e.isFile() || !e.name.endsWith('.md')) { report(rel, 0, 'only .md term files belong in the glossary folder'); continue; }
      const slug = e.name.slice(0, -3);
      if (!SLUG.test(slug) || slug.length > 60) { report(rel, 0, 'term file name must be lowercase letters, digits and hyphens (max 60 characters)'); continue; }
      if (slugs.has(slug)) { report(rel, 0, 'a term with this file name already exists'); continue; }
      slugs.add(slug);
      if (lstatSync(join(root, rel)).size > 50 * 1024) { report(rel, 0, 'is larger than 50 KB'); continue; }

      const before = errors.length;
      const text = readText(rel);
      for (const f of scanText(text, { html: true })) report(rel, f.line, f.rule);
      const fm = splitFrontMatter(text);
      for (const er of fm.errors) report(rel, er.line, er.rule);
      if (fm.errors.length) continue;
      for (const [k, f] of Object.entries(fm.fields)) if (!TERM_KEYS.has(k)) report(rel, f.line, 'unknown front matter key');

      const one = (key, max) => {
        const f = fm.fields[key];
        if (!f) { report(rel, 0, `front matter is missing '${key}'`); return ''; }
        if (typeof f.value !== 'string' || !f.value) { report(rel, f.line, `'${key}' must be text`); return ''; }
        if (f.value.length > max) { report(rel, f.line, `'${key}' is longer than ${max} characters`); return ''; }
        return f.value;
      };
      const many = (key, max) => {
        const f = fm.fields[key];
        if (!f) return { items: [], line: 0 };
        if (!Array.isArray(f.value)) { report(rel, f.line, `'${key}' must be a list like [one, two]`); return { items: [], line: f.line }; }
        if (f.value.length > max) report(rel, f.line, `'${key}' has more than ${max} entries`);
        return { items: f.value, line: f.line };
      };
      const term = one('term', 60);
      const summary = one('summary', 200);
      const aliases = many('aliases', 8);
      const related = many('related', 12);
      for (const a of aliases.items) if (!a || a.length > 60) report(rel, aliases.line, 'an alias is empty or longer than 60 characters');
      for (const name of [term, ...aliases.items]) {
        const key = name.trim().toLowerCase();
        if (!key) continue;
        if (names.has(key)) report(rel, 0, 'a term or alias is already used by another entry');
        else names.set(key, slug);
      }

      const seenRules = new Set();
      const blocks = fm.body.trim()
        ? parseBlocks(fm.body, (rule, line) => {
          if (seenRules.has(rule)) return;
          seenRules.add(rule);
          report(rel, fm.bodyStartLine + line - 1, rule);
        })
        : [];
      if (errors.length > before) continue;
      terms.push({ slug, term, summary, aliases: aliases.items, related: related.items, relatedLine: related.line, blocks, sample, file: rel });
    }
  }
  const known = new Set(terms.map((t) => t.slug));
  for (const t of terms) {
    for (const r of t.related) {
      if (r === t.slug) report(t.file, t.relatedLine, 'a term cannot list itself as related');
      else if (!known.has(r)) report(t.file, t.relatedLine, 'lists a related term that does not exist');
    }
  }
  terms.sort((a, b) => (a.term.toLowerCase() < b.term.toLowerCase() ? -1 : 1));
  return terms;
}

// -------------------------------------------------------------- data files

function buildGraph(topics, povs, glossary = []) {
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const edge = (s, t, k) => {
    const key = `${k}|${[s, t].sort().join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ s, t, k });
  };
  const counts = new Map(topics.map((t) => [t.id, 0]));
  const realUse = new Map(topics.map((t) => [t.id, 0]));
  for (const p of povs) for (const id of p.topics) { counts.set(id, counts.get(id) + 1); if (!p.sample) realUse.set(id, realUse.get(id) + 1); }

  for (const t of topics) {
    // A topic is sample-only when it is flagged and no real POV uses it, so hiding samples hides it too.
    const sampleOnly = t.sample && realUse.get(t.id) === 0;
    nodes.push({ id: `t:${t.id}`, kind: 'topic', ref: t.id, label: t.title, n: counts.get(t.id), ...(sampleOnly ? { sample: true } : {}) });
    if (t.parent) edge(`t:${t.id}`, `t:${t.parent}`, 'parent');
    for (const r of t.related) edge(`t:${t.id}`, `t:${r}`, 'topic');
  }
  for (const p of povs) {
    nodes.push({ id: `p:${p.slug}`, kind: 'pov', ref: p.slug, label: p.title, date: p.date, status: p.status, ...(p.sample ? { sample: true } : {}) });
    for (const id of p.topics) edge(`p:${p.slug}`, `t:${id}`, 'link');
    for (const r of p.related) edge(`p:${p.slug}`, `p:${r}`, 'related');
    p.documents.forEach((d, i) => {
      nodes.push({ id: `d:${p.slug}/${i + 1}`, kind: 'doc', ref: p.slug, label: d.title, date: p.date, status: p.status, ...(p.sample ? { sample: true } : {}) });
      edge(`d:${p.slug}/${i + 1}`, `p:${p.slug}`, 'doc');
    });
  }
  // Glossary terms are a fourth kind of node, linked to every POV that mentions them.
  for (const g of glossary) {
    nodes.push({ id: `g:${g.slug}`, kind: 'term', ref: g.slug, label: g.term, n: g.uses.length, ...(g.sample ? { sample: true } : {}) });
    for (const slug of g.uses) edge(`g:${g.slug}`, `p:${slug}`, 'term');
  }
  const layout = computeLayout(nodes, edges);
  const newest = povs.length ? povs[0].slug : null; // povs are sorted newest first
  return { newest, nodes: nodes.map((n) => ({ ...n, ...layout.get(n.id) })), edges };
}

/**
 * Work out which POVs mention which terms, and mark the first mention of each term
 * inside each POV so it becomes a pop-up link. Changes `povs[].blocks` and sets `glossary[].uses`.
 */
function prepareGlossary(terms, list) {
  for (const t of terms) t.uses = [];
  const matcher = compileMatcher(terms);
  const defs = new Map(terms.map((t) => [t.slug, t.summary]));
  for (const p of list) {
    for (const slug of usedTerms(p.blocks, matcher)) terms.find((t) => t.slug === slug).uses.push(p.slug);
    p.blocks = markTerms(p.blocks, matcher, { defs }).blocks;
  }
  for (const t of terms) t.uses.sort();
}

// ------------------------------------------------------------------- main

// Pages in site/ that contain <!-- build:name --> markers the build expands.
const TEMPLATE_PAGES = ['index.html', 'graph/index.html', 'glossary/index.html', '404.html', 'add/index.html'];
// Pure modules the browser reuses, so the Add page checks text exactly as the build does.
const SHARED_MODULES = ['doc-links.mjs', 'frontmatter.mjs', 'markdown.mjs', 'rules.mjs'];

function validateSite() {
  const noop = Object.fromEntries(MARKERS.map((m) => [m, () => '']));
  for (const rel of TEMPLATE_PAGES) {
    const file = `site/${rel}`;
    if (!existsSync(join(root, file))) { report(file, 0, 'file is missing'); continue; }
    const { html, unknown } = expandMarkers(readText(file), noop);
    for (const u of unknown) report(file, 0, `uses an unknown build marker (${u})`);
    if (html.includes('<!-- build:')) report(file, 0, 'contains a malformed build marker');
  }
  if (existsSync(join(root, 'site/index.html')) && !/<!-- build:sections[ >-]/.test(readText('site/index.html'))) {
    report('site/index.html', 0, 'must contain the <!-- build:sections --> marker');
  }
  if (existsSync(join(root, 'site/graph/index.html')) && !/<!-- build:nodelist[ >-]/.test(readText('site/graph/index.html'))) {
    report('site/graph/index.html', 0, 'must contain the <!-- build:nodelist --> marker');
  }
  if (existsSync(join(root, 'site/glossary/index.html')) && !/<!-- build:glossary[ >-]/.test(readText('site/glossary/index.html'))) {
    report('site/glossary/index.html', 0, 'must contain the <!-- build:glossary --> marker');
  }
  for (const reserved of ['data', 'docs', 'pov', 'samples']) { // glossary/ is a real page folder, not generated
    if (existsSync(join(siteDir, reserved))) report(`site/${reserved}`, 0, 'is a name the build generates; rename or remove it');
  }
}

validateSite();
const allTopics = loadTopics();
const povs = loadPovs(new Set(allTopics.map((t) => t.id)));
const glossary = loadGlossary();
const topics = pruneTopics(allTopics, povs);
prepareGlossary(glossary, povs);
povs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? -1 : 1));

if (errors.length) {
  errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  for (const e of errors) console.error(`build: ${e.file}${e.line ? `:${e.line}` : ''}: ${e.rule}`);
  console.error(`build: ${errors.length} problem${errors.length === 1 ? '' : 's'} found. Nothing was built.`);
  process.exit(1);
}

const docCount = povs.reduce((n, p) => n + p.documents.length, 0);
const sampleCount = povs.filter((p) => p.sample).length;
const sampleNote = (sampleCount ? `, ${sampleCount} of them samples` : '') + (glossary.length ? `, ${glossary.length} glossary terms` : '');
if (checkOnly) {
  console.log(`build: check passed (${povs.length} POVs, ${topics.length} topics, ${docCount} documents${sampleNote})`);
  process.exit(0);
}

const topicById = new Map(topics.map((t) => [t.id, t]));
const povBySlug = new Map(povs.map((p) => [p.slug, p]));
const graph = buildGraph(topics, povs, glossary);
const write = (rel, text) => {
  const abs = join(distDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(siteDir, distDir, { recursive: true });

// Site templates -> pages.
const fns = {
  head: ({ up = '' }) => headTags(up, config),
  header: ({ up = '', current = '' }) => headerHtml(up, current),
  footer: () => footerHtml(config),
  poster: () => posterHtml(graph),
  preview: () => previewHtml(graph),
  tiles: () => tilesHtml(topics, povs),
  stats: () => statsHtml(topics, povs),
  filters: () => filtersHtml(topics),
  sections: () => sectionsHtml(topics, povs),
  latest: () => latestHtml(topics, povs),
  nodelist: () => nodelistHtml(topics, povs, glossary),
  glossary: () => glossaryPageHtml(glossary, povs),
  repo: () => REPO,
};
for (const rel of TEMPLATE_PAGES) write(rel, expandMarkers(readText(`site/${rel}`), fns).html);

// Data for the browser.
const counts = new Map(topics.map((t) => [t.id, 0]));
for (const p of povs) for (const id of p.topics) counts.set(id, counts.get(id) + 1);
const sampleOnlyTopic = new Set(graph.nodes.filter((n) => n.kind === 'topic' && n.sample).map((n) => n.ref));
write('data/topics.json', JSON.stringify(topics.map((t) => ({
  id: t.id, title: t.title, view: t.view, parent: t.parent, related: t.related, count: counts.get(t.id),
  ...(sampleOnlyTopic.has(t.id) ? { sample: true } : {}),
}))) + '\n');
write('data/povs.json', JSON.stringify(povs.map((p) => ({
  slug: p.slug, title: p.title, summary: p.summary, type: p.type, status: p.status, author: p.author, date: p.date,
  topics: p.topics, related: p.related, documents: p.documents,
  ...(p.sample ? { sample: true } : {}),
}))) + '\n');
write('data/glossary.json', JSON.stringify(glossary.map((g) => ({
  slug: g.slug, term: g.term, summary: g.summary, aliases: g.aliases, related: g.related, uses: g.uses,
  ...(g.sample ? { sample: true } : {}),
}))) + '\n');
write('data/site.json', JSON.stringify({ contactLine: config.contactLine, siteUrl: config.siteUrl, publisher: config.publisher }) + '\n');
// Full text for the Graph page reader, fetched one POV at a time so povs.json stays small.
for (const p of povs) write(`data/pov/${p.slug}.json`, JSON.stringify({ slug: p.slug, blocks: p.blocks, documents: p.documents }) + '\n');
write('data/graph.json', JSON.stringify(graph) + '\n');

// Shared validation modules for the Add page.
for (const name of SHARED_MODULES) write(`js/shared/${name.replace(/\.mjs$/, '.js')}`, readFileSync(join(libDir, name), 'utf8'));

// One page per POV.
for (const p of povs) write(`pov/${p.slug}/index.html`, povPage(p, { topicById, povBySlug, graph, config, glossary }));

console.log(`build: wrote dist/ (${povs.length} POVs, ${topics.length} topics, ${docCount} documents${sampleNote})`);
