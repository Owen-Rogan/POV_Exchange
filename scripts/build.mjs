// POV Exchange build script.
//
// Runs on the GitHub runner's built-in Node (22) with no npm install, so it
// uses only node: built-ins and nothing newer than Node 22.
//
//   node scripts/build.mjs           validate, then build into dist/
//   node scripts/build.mjs --check   validate only, write nothing
//   node scripts/build.mjs --root D  use D instead of the repo root (tests)
//
// Inputs:  povs/topics.json, povs/<slug>/pov.md (+ documents), site/
// Outputs: dist/  = site/ + data/*.json + docs/<slug>/* + pov/<slug>/index.html
//
// Errors name the file, the line and the rule. They never repeat the offending
// text, because it may be something that should not be repeated (a token, an
// email address).

import {
  copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalise, splitFrontMatter } from './lib/frontmatter.mjs';
import { computeLayout } from './lib/layout.mjs';
import { parseBlocks } from './lib/markdown.mjs';
import { scanText } from './lib/rules.mjs';

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const rootFlag = argv.indexOf('--root');
const root = resolve(
  rootFlag !== -1 && argv[rootFlag + 1] ? argv[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const siteDir = join(root, 'site');
const distDir = join(root, 'dist');

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DOC_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;
const DOC_EXT = new Set(['pdf', 'pptx', 'docx', 'xlsx', 'csv', 'txt', 'md']);
const TEXT_EXT = new Set(['csv', 'txt', 'md']);
const MAX_DOC_BYTES = 20 * 1024 * 1024;
const MAX_POV_BYTES = 200 * 1024;
const POV_KEYS = new Set(['title', 'summary', 'type', 'topics', 'author', 'date', 'related', 'documents']);
const TOPIC_KEYS = new Set(['id', 'title', 'view', 'parent', 'related']);
const CONTENT_MARKER = '<!-- build:content -->';
const CSP = "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

const errors = [];
const report = (file, line, rule) => errors.push({ file, line, rule });
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const readText = (rel) => normalise(readFileSync(join(root, rel), 'utf8'));

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
    topics.push({
      id, title, view,
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

function loadPov(slug, topicIds) {
  const dir = `povs/${slug}`;
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

  // Documents: only files listed in front matter are published.
  const documents = [];
  const fileByName = new Map(entries.filter((e) => e.isFile()).map((e) => [e.name, e]));
  const listed = new Set();
  for (const name of docsField.items) {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const docPath = `${dir}/${name}`;
    if (name.toLowerCase() === 'pov.md') { report(file, docsField.line, 'pov.md cannot be listed as a document'); continue; }
    if (!DOC_NAME.test(name) || name.length > 100) { report(file, docsField.line, 'a document name uses characters that are not allowed'); continue; }
    if (!DOC_EXT.has(ext)) { report(file, docsField.line, 'a document has a file type that is not allowed (pdf, pptx, docx, xlsx, csv, txt, md)'); continue; }
    if (listed.has(name.toLowerCase())) { report(file, docsField.line, 'a document is listed twice'); continue; }
    listed.add(name.toLowerCase());
    if (!fileByName.has(name)) { report(file, docsField.line, 'a listed document is not in the folder'); continue; }
    const bytes = lstatSync(join(root, docPath)).size;
    if (bytes > MAX_DOC_BYTES) { report(docPath, 0, `is larger than ${MAX_DOC_BYTES / 1024 / 1024} MB`); continue; }
    if (TEXT_EXT.has(ext)) for (const f of scanText(readText(docPath))) report(docPath, f.line, f.rule);
    documents.push({ name, ext, bytes });
  }
  for (const e of entries) {
    if (e.isFile() && e.name !== 'pov.md' && !listed.has(e.name.toLowerCase())) {
      report(`${dir}/${e.name}`, 0, 'file is not listed under documents in pov.md (or is not allowed)');
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
    slug, title, summary, author, date, type,
    topics: topics.items, related: related.items, relatedLine: related.line, file,
    documents, blocks,
  };
}

function loadPovs(topicIds) {
  const povsDir = join(root, 'povs');
  if (!existsSync(povsDir)) { report('povs', 0, 'folder is missing'); return []; }
  const povs = [];
  for (const e of readdirSync(povsDir, { withFileTypes: true }).sort(byName)) {
    if (e.name === 'topics.json' || e.name === 'README.md' || e.name.startsWith('_') || e.name.startsWith('.')) continue;
    if (!e.isDirectory()) { report(`povs/${e.name}`, 0, 'only topics.json and POV folders belong in povs/'); continue; }
    const p = loadPov(e.name, topicIds);
    if (p) povs.push(p);
  }
  const slugs = new Set(povs.map((p) => p.slug));
  for (const p of povs) {
    for (const r of p.related) {
      if (r === p.slug) report(p.file, p.relatedLine, 'a POV cannot list itself as related');
      else if (!slugs.has(r)) report(p.file, p.relatedLine, 'lists a related POV that does not exist');
    }
  }
  return povs;
}

// -------------------------------------------------------------- rendering

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(nodes) {
  return nodes.map((n) => {
    switch (n.t) {
      case 'text': return esc(n.v);
      case 'code': return `<code>${esc(n.v)}</code>`;
      case 'strong': return `<strong>${inline(n.c)}</strong>`;
      case 'em': return `<em>${inline(n.c)}</em>`;
      case 'link': return `<a href="${esc(n.href)}" rel="noopener noreferrer">${inline(n.c)}</a>`;
      default: throw new Error('unknown inline node');
    }
  }).join('');
}

function blocksToHtml(blocks) {
  return blocks.map((b) => {
    switch (b.t) {
      case 'h': return `<h${b.level}>${inline(b.c)}</h${b.level}>`;
      case 'p': return `<p>${inline(b.c)}</p>`;
      case 'quote': return `<blockquote><p>${inline(b.c)}</p></blockquote>`;
      case 'ul': return `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`;
      case 'ol': return `<ol>${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`;
      default: throw new Error('unknown block');
    }
  }).join('\n');
}

const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function pageHead({ title, description, up, og = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${og}<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:,">
<link rel="stylesheet" href="${up}styles.css">
</head>`;
}

function povPage(p, ctx) {
  const up = '../../';
  const topicTitles = p.topics.map((id) => ctx.topicById.get(id).title);
  const relatedPovs = p.related.map((s) => ctx.povBySlug.get(s));
  const og = [
    '<meta property="og:type" content="article">',
    `<meta property="og:title" content="${esc(p.title)}">`,
    `<meta property="og:description" content="${esc(p.summary)}">`,
    '<meta property="og:site_name" content="POV Exchange">',
  ].join('\n') + '\n';

  const docs = p.documents.length
    ? `<section class="docs" aria-labelledby="docs-h">
<h2 id="docs-h">Documents</h2>
<ul>
${p.documents.map((d) => `<li><a href="${up}docs/${p.slug}/${esc(encodeURIComponent(d.name))}" download>${esc(d.name)}</a> <span class="size">${esc(d.ext.toUpperCase())}, ${fmtSize(d.bytes)}</span></li>`).join('\n')}
</ul>
</section>`
    : '';
  const related = relatedPovs.length
    ? `<section class="related" aria-labelledby="rel-h">
<h2 id="rel-h">Related</h2>
<ul>
${relatedPovs.map((r) => `<li><a href="../${r.slug}/">${esc(r.title)}</a></li>`).join('\n')}
</ul>
</section>`
    : '';

  return `${pageHead({ title: `${p.title} | POV Exchange`, description: p.summary, up, og })}
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar"><a class="brand" href="${up}">POV Exchange</a></header>
<main id="main" class="page article">
<p class="eyebrow">${p.type === 'document' ? 'Document' : 'POV'} &middot; ${esc(topicTitles.join(', '))}</p>
<h1>${esc(p.title)}</h1>
<p class="lede">${esc(p.summary)}</p>
<p class="byline">By ${esc(p.author)} &middot; <time datetime="${esc(p.date)}">${esc(p.date)}</time></p>
<div class="prose">
${blocksToHtml(p.blocks)}
</div>
${docs}
${related}
<p class="back"><a href="${up}">&larr; All POVs</a></p>
</main>
<footer class="foot"><p>Practice opinions only. No client information.</p></footer>
</body>
</html>
`;
}

function homeContent(topics, povs) {
  const byTopic = new Map(topics.map((t) => [t.id, []]));
  for (const p of povs) for (const id of p.topics) byTopic.get(id).push(p);
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const sections = topics.map((t) => {
    const items = byTopic.get(t.id);
    const parent = t.parent ? `<p class="eyebrow">Part of ${esc(topicById.get(t.parent).title)}</p>\n` : '';
    const cards = items.length
      ? `<ul class="cards">\n${items.map((p) => `<li class="card"><a href="pov/${p.slug}/"><span class="card-kind">${p.type === 'document' ? 'Document' : 'POV'}</span><span class="card-title">${esc(p.title)}</span><span class="card-summary">${esc(p.summary)}</span><span class="card-meta">${esc(p.author)} &middot; ${esc(p.date)}</span></a></li>`).join('\n')}\n</ul>`
      : '<p class="empty">No POVs on this topic yet.</p>';
    return `<section class="topic" id="topic-${t.id}" aria-labelledby="t-${t.id}">
${parent}<h2 id="t-${t.id}">${esc(t.title)}</h2>
<p class="view">${esc(t.view)}</p>
${cards}
</section>`;
  });

  return `<p class="stats">${plural(povs.length, 'POV', 'POVs')} across ${plural(topics.length, 'topic', 'topics')}</p>\n${sections.join('\n')}`;
}

// -------------------------------------------------------------- data files

function buildGraph(topics, povs) {
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
  for (const p of povs) for (const id of p.topics) counts.set(id, counts.get(id) + 1);

  for (const t of topics) {
    nodes.push({ id: `t:${t.id}`, kind: 'topic', ref: t.id, label: t.title, n: counts.get(t.id) });
    if (t.parent) edge(`t:${t.id}`, `t:${t.parent}`, 'parent');
    for (const r of t.related) edge(`t:${t.id}`, `t:${r}`, 'topic');
  }
  for (const p of povs) {
    nodes.push({ id: `p:${p.slug}`, kind: 'pov', ref: p.slug, label: p.title, date: p.date });
    for (const id of p.topics) edge(`p:${p.slug}`, `t:${id}`, 'link');
    for (const r of p.related) edge(`p:${p.slug}`, `p:${r}`, 'related');
    for (const d of p.documents) {
      nodes.push({ id: `d:${p.slug}/${d.name}`, kind: 'doc', ref: p.slug, label: d.name });
      edge(`d:${p.slug}/${d.name}`, `p:${p.slug}`, 'doc');
    }
  }
  const layout = computeLayout(nodes, edges);
  const newest = povs.length ? povs[0].slug : null; // povs are sorted newest first
  return { newest, nodes: nodes.map((n) => ({ ...n, ...layout.get(n.id) })), edges };
}

// ------------------------------------------------------------------- main

function validateSite() {
  if (!existsSync(join(siteDir, 'index.html'))) report('site/index.html', 0, 'file is missing');
  else if (!readText('site/index.html').includes(CONTENT_MARKER)) report('site/index.html', 0, `must contain the ${CONTENT_MARKER} marker`);
  if (!existsSync(join(siteDir, '404.html'))) report('site/404.html', 0, 'file is missing');
  for (const reserved of ['data', 'docs', 'pov']) {
    if (existsSync(join(siteDir, reserved))) report(`site/${reserved}`, 0, 'is a name the build generates; rename or remove it');
  }
}

validateSite();
const topics = loadTopics();
const povs = loadPovs(new Set(topics.map((t) => t.id)));
povs.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug < b.slug ? -1 : 1));

if (errors.length) {
  errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  for (const e of errors) console.error(`build: ${e.file}${e.line ? `:${e.line}` : ''}: ${e.rule}`);
  console.error(`build: ${errors.length} problem${errors.length === 1 ? '' : 's'} found. Nothing was built.`);
  process.exit(1);
}

const docCount = povs.reduce((n, p) => n + p.documents.length, 0);
if (checkOnly) {
  console.log(`build: check passed (${povs.length} POVs, ${topics.length} topics, ${docCount} documents)`);
  process.exit(0);
}

const topicById = new Map(topics.map((t) => [t.id, t]));
const povBySlug = new Map(povs.map((p) => [p.slug, p]));
const graph = buildGraph(topics, povs);
const write = (rel, text) => {
  const abs = join(distDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });
cpSync(siteDir, distDir, { recursive: true });

write('index.html', readText('site/index.html').replace(CONTENT_MARKER, homeContent(topics, povs)));

const counts = new Map(topics.map((t) => [t.id, 0]));
for (const p of povs) for (const id of p.topics) counts.set(id, counts.get(id) + 1);
write('data/topics.json', JSON.stringify(topics.map((t) => ({ ...t, count: counts.get(t.id) }))) + '\n');
write('data/povs.json', JSON.stringify(povs.map((p) => ({
  slug: p.slug, title: p.title, summary: p.summary, type: p.type, author: p.author, date: p.date,
  topics: p.topics, related: p.related, documents: p.documents,
}))) + '\n');
write('data/graph.json', JSON.stringify(graph) + '\n');

for (const p of povs) {
  write(`pov/${p.slug}/index.html`, povPage(p, { topicById, povBySlug }));
  for (const d of p.documents) {
    mkdirSync(join(distDir, 'docs', p.slug), { recursive: true });
    copyFileSync(join(root, 'povs', p.slug, d.name), join(distDir, 'docs', p.slug, d.name));
  }
}

console.log(`build: wrote dist/ (${povs.length} POVs, ${topics.length} topics, ${docCount} documents)`);
