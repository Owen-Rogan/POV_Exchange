// "Add a POV" page. Builds the pov.md text from a short form, runs the same
// checks the build runs (the same modules, copied into js/shared/ at build
// time), then offers a link that opens GitHub's create-file page pre-filled.
// The page itself makes no network call to GitHub: it only builds a link.

import { normalise, splitFrontMatter } from './shared/frontmatter.js';
import { parseBlocks } from './shared/markdown.js';
import { scanText } from './shared/rules.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_URL = 6000; // beyond this GitHub's address limit is a risk, so we offer "copy" only
const DOC_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*$/;
const DOC_EXT = new Set(['pdf', 'pptx', 'docx', 'xlsx', 'csv', 'txt', 'md']);

const $ = (id) => document.getElementById(id);

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

/** Always quote text values, so characters like # and [ cannot change their meaning. */
function quote(value) {
  const v = value.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (!v.includes('"')) return { text: `"${v}"` };
  if (!v.includes("'")) return { text: `'${v}'` };
  return { error: 'Use either double or single quote marks in this field, not both.' };
}

export async function initAdd() {
  const form = $('add-form');
  const repo = form.dataset.repo;
  const f = {
    title: $('f-title'), summary: $('f-summary'), type: $('f-type'), author: $('f-author'),
    date: $('f-date'), slug: $('f-slug'), docs: $('f-docs'), body: $('f-body'),
  };
  const topicBox = $('f-topics');
  const relatedBox = $('f-related');
  const problems = $('problems');
  const status = $('add-status');
  const open = $('open-github');
  const copy = $('copy-text');
  const summaryCount = $('summary-count');

  const [topics, povs] = await Promise.all([
    fetch('../data/topics.json').then((r) => r.json()),
    fetch('../data/povs.json').then((r) => r.json()),
  ]);
  const topicIds = new Set(topics.map((t) => t.id));
  const takenSlugs = new Set(povs.map((p) => p.slug));

  const box = (container, name, id, label) => {
    const wrap = document.createElement('label');
    wrap.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = id;
    const span = document.createElement('span');
    span.textContent = label;
    wrap.append(input, span);
    container.append(wrap);
    return input;
  };
  for (const t of topics) box(topicBox, 'topic', t.id, t.title);
  if (povs.length === 0) relatedBox.closest('fieldset').hidden = true;
  for (const p of povs) box(relatedBox, 'related', p.slug, p.title);

  f.date.value = new Date().toISOString().slice(0, 10);
  let slugEdited = false;
  f.slug.addEventListener('input', () => { slugEdited = true; });
  f.title.addEventListener('input', () => { if (!slugEdited) f.slug.value = slugify(f.title.value); });

  const checked = (container) => [...container.querySelectorAll('input:checked')].map((i) => i.value);

  function compose() {
    const issues = [];
    const need = (value, what) => { if (!value.trim()) issues.push({ rule: `${what} is required.` }); };

    const title = f.title.value.trim();
    const summary = f.summary.value.trim();
    const author = f.author.value.trim();
    const slug = f.slug.value.trim();
    const date = f.date.value.trim();
    const type = f.type.value === 'document' ? 'document' : 'pov';
    const topicList = checked(topicBox);
    const relatedList = checked(relatedBox);
    const docs = f.docs.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const body = normalise(f.body.value).replace(/\s+$/, '');

    need(title, 'Title'); need(summary, 'Summary'); need(author, 'Author'); need(slug, 'Folder name');
    if (title.length > 120) issues.push({ rule: 'Title is longer than 120 characters.' });
    if (summary.length > 240) issues.push({ rule: 'Summary is longer than 240 characters.' });
    if (author.length > 80) issues.push({ rule: 'Author is longer than 80 characters.' });
    if (author && /[@<>:/\\]/.test(author)) issues.push({ rule: 'Author must be a name only (no email, link or handle).' });
    if (slug && !SLUG.test(slug)) issues.push({ rule: 'Folder name must be lowercase letters, digits and hyphens.' });
    if (slug && takenSlugs.has(slug)) issues.push({ rule: 'A POV with this folder name already exists. Choose another.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) issues.push({ rule: 'Date must be written YYYY-MM-DD.' });
    if (topicList.length === 0) issues.push({ rule: 'Choose at least one topic.' });
    if (topicList.some((t) => !topicIds.has(t))) issues.push({ rule: 'A chosen topic is not in the topic list.' });
    if (type === 'pov' && !body) issues.push({ rule: 'A POV needs body text. Choose "Document" for files only.' });
    if (type === 'document' && docs.length === 0) issues.push({ rule: 'A document entry needs at least one file name.' });
    for (const d of docs) {
      const ext = d.includes('.') ? d.slice(d.lastIndexOf('.') + 1).toLowerCase() : '';
      if (!DOC_NAME.test(d) || d.length > 100) issues.push({ rule: 'A document name uses characters that are not allowed.' });
      else if (!DOC_EXT.has(ext)) issues.push({ rule: 'A document has a file type that is not allowed (pdf, pptx, docx, xlsx, csv, txt, md).' });
    }

    const lines = ['---'];
    for (const [key, value] of [['title', title], ['summary', summary], ['author', author]]) {
      const q = quote(value);
      if (q.error) issues.push({ rule: `${key[0].toUpperCase()}${key.slice(1)}: ${q.error}` });
      lines.push(`${key}: ${q.text ?? ''}`);
    }
    lines.splice(3, 0, `type: ${type}`, `topics: [${topicList.join(', ')}]`);
    lines.push(`date: ${date}`);
    if (relatedList.length) lines.push(`related: [${relatedList.join(', ')}]`);
    if (docs.length) lines.push(`documents: [${docs.map((d) => `"${d}"`).join(', ')}]`);
    lines.push('---');
    const header = lines.join('\n');
    const text = `${header}\n${body}\n`;

    // Same checks the build applies.
    const norm = normalise(text);
    for (const hit of scanText(norm, { html: true })) issues.push({ line: hit.line, rule: `This text ${hit.rule}.` });
    const fm = splitFrontMatter(norm);
    for (const e of fm.errors) issues.push({ line: e.line, rule: e.rule });
    const seen = new Set();
    parseBlocks(fm.body, (rule, line) => {
      if (seen.has(rule)) return;
      seen.add(rule);
      issues.push({ line: fm.bodyStartLine + line - 1, rule: `${rule[0].toUpperCase()}${rule.slice(1)}.` });
    });

    return { issues, text, slug };
  }

  function render() {
    const { issues, text, slug } = compose();
    summaryCount.textContent = `${f.summary.value.length} / 240`;
    problems.replaceChildren();
    for (const issue of issues.slice(0, 8)) {
      const li = document.createElement('li');
      li.textContent = issue.line ? `Line ${issue.line} of the file: ${issue.rule}` : issue.rule;
      problems.append(li);
    }
    problems.hidden = issues.length === 0;

    const ready = issues.length === 0;
    const url = `https://github.com/${repo}/new/main?filename=${encodeURIComponent(`povs/${slug}/pov.md`)}&value=${encodeURIComponent(text)}`;
    const tooLong = url.length > MAX_URL;
    open.classList.toggle('disabled', !ready || tooLong);
    open.setAttribute('aria-disabled', String(!ready || tooLong));
    if (ready && !tooLong) {
      open.href = url;
      open.removeAttribute('tabindex');
    } else {
      open.removeAttribute('href');
      open.tabIndex = -1;
    }
    copy.disabled = !ready;
    status.textContent = !ready
      ? 'Fix the points above to continue.'
      : tooLong
        ? 'This POV is too long to send to GitHub in a link. Copy the text, then paste it into a new file on GitHub.'
        : 'Ready. Opening GitHub shows the new file with this text filled in. Nothing is published until you commit it there.';
    return { text, ready };
  }

  form.addEventListener('input', render);
  form.addEventListener('change', render);
  form.addEventListener('submit', (ev) => ev.preventDefault());
  open.addEventListener('click', (ev) => { if (open.getAttribute('aria-disabled') === 'true') ev.preventDefault(); });
  copy.addEventListener('click', async () => {
    const { text, ready } = render();
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'Copied';
    } catch {
      f.body.focus();
      copy.textContent = 'Copy failed. Select the text yourself.';
    }
    setTimeout(() => { copy.textContent = 'Copy the file text'; }, 2200);
  });

  render();
}
