// Build tests. Each case writes a throwaway repo layout to a temp folder, runs
// scripts/build.mjs against it with --root, and checks the exit code and the
// messages. Run with:  node --test scripts/test.mjs   (Node 22+, no install)

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildScript = join(repo, 'scripts', 'build.mjs');
const made = [];

const TOPICS = [
  { id: 'agents', title: 'Agents', view: 'A view.' },
  { id: 'governance', title: 'Governance', view: 'Another view.', related: ['agents'] },
];

const GOOD_FM = {
  title: 'A good title',
  summary: 'A good summary.',
  type: 'pov',
  status: 'agreed',
  topics: '[agents]',
  author: 'Test Author',
  date: '2026-11-06',
};

// Realistic share-link shapes for the three services. They point at nothing.
const BOX = 'https://ibm.box.com/s/' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
const SHAREPOINT = 'https://contoso.sharepoint.com/:b:/s/Practice/' + 'EaBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd';
const ONEDRIVE_SHORT = 'https://1drv.ms/b/s!' + 'AkLmNoPqRsTuVwXyZ0123456789';
const docs = (...entries) => `[${entries.map((e) => `"${e}"`).join(', ')}]`;

function fm(overrides = {}) {
  const fields = { ...GOOD_FM, ...overrides };
  return '---\n' + Object.entries(fields).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n';
}

/** Make a temp repo with the real site/ and the given POVs. */
function fixture(povs = {}, { topics = TOPICS } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pov-test-'));
  made.push(root);
  cpSync(join(repo, 'site'), join(root, 'site'), { recursive: true });
  mkdirSync(join(root, 'povs'));
  writeFileSync(join(root, 'povs', 'topics.json'), JSON.stringify(topics));
  for (const [slug, files] of Object.entries(povs)) {
    mkdirSync(join(root, 'povs', slug), { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'povs', slug, name), content);
  }
  // Site settings are optional, so the fixtures leave site.config.json out and the defaults apply.
  return root;
}

function run(root, ...flags) {
  const r = spawnSync(process.execPath, [buildScript, '--root', root, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

const pov = (body = 'Some body text.', fmOverrides = {}) => ({ 'pov.md': fm(fmOverrides) + body + '\n' });

after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

// ------------------------------------------------------------ passing cases

test('a valid POV builds, with a page, data files and a home card', () => {
  const root = fixture({ 'my-pov': pov('Hello **world**.') });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  const page = readFileSync(join(root, 'dist/pov/my-pov/index.html'), 'utf8');
  assert.match(page, /<title>A good title \| POV Exchange<\/title>/);
  assert.match(page, /<strong>world<\/strong>/);
  assert.match(page, /href="\.\.\/\.\.\/styles\.css"/);
  const home = readFileSync(join(root, 'dist/index.html'), 'utf8');
  assert.match(home, /href="pov\/my-pov\/"/);
  assert.ok(!home.includes('build:content'));
  const povs = JSON.parse(readFileSync(join(root, 'dist/data/povs.json'), 'utf8'));
  assert.equal(povs[0].slug, 'my-pov');
});

test('a file with a BOM and Windows line endings passes', () => {
  const text = '\uFEFF' + (fm() + 'Line one.\n\nLine two.\n').replace(/\n/g, '\r\n');
  const root = fixture({ 'crlf-pov': { 'pov.md': text } });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
});

test('folders starting with an underscore are skipped', () => {
  const root = fixture({ _template: { 'pov.md': 'this is not even valid' }, 'real-pov': pov() });
  assert.equal(run(root, '--check').code, 0);
});

test('a document is a link: shown on the POV page, opened in a new tab, nothing copied', () => {
  const root = fixture({ 'doc-pov': pov('Body.', { documents: docs(`Agents deck, v2 | ${BOX}`, `Notes | ${SHAREPOINT}`, `Short | ${ONEDRIVE_SHORT}`) }) });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  const page = readFileSync(join(root, 'dist/pov/doc-pov/index.html'), 'utf8');
  assert.match(page, new RegExp(`<a href="${BOX.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}" target="_blank" rel="noopener noreferrer">Agents deck, v2</a>`));
  assert.match(page, /Box\. May ask you to sign in/);
  assert.match(page, />SharePoint\. May ask you to sign in/);
  assert.match(page, />OneDrive\. May ask you to sign in/);
  assert.ok(!existsSync(join(root, 'dist/docs')), 'no documents folder is published');
  const data = JSON.parse(readFileSync(join(root, 'dist/data/povs.json'), 'utf8'));
  assert.deepEqual(data[0].documents.map((d) => d.host), ['ibm.box.com', 'contoso.sharepoint.com', '1drv.ms']);
});

test('a document-type entry with no body is allowed', () => {
  const root = fixture({ 'deck-only': { 'pov.md': fm({ type: 'document', documents: docs(`Deck | ${BOX}`) }) } });
  assert.equal(run(root).code, 0);
});

test('a comma inside a document title does not break the list', () => {
  const root = fixture({ p: pov('x', { documents: docs(`Plan, v2 [final] | ${BOX}`, `Other | ${SHAREPOINT}`) }) });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  const data = JSON.parse(readFileSync(join(root, 'dist/data/povs.json'), 'utf8'));
  assert.deepEqual(data[0].documents.map((d) => d.title), ['Plan, v2 [final]', 'Other']);
});

test('the layout and data files are identical across two builds', () => {
  const root = fixture({ a: pov(), b: pov('Other.', { related: '[a]', topics: '[agents, governance]' }) });
  run(root);
  const first = readFileSync(join(root, 'dist/data/graph.json'), 'utf8');
  run(root);
  assert.equal(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'), first);
  const g = JSON.parse(first);
  for (const n of g.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z), n.id);
  assert.ok(g.edges.some((e) => e.k === 'related'));
});

test('an https link with parentheses in the URL becomes a real link', () => {
  const root = fixture({ 'link-pov': pov('See [the entry](https://en.wikipedia.org/wiki/Agent_(software)).') });
  assert.equal(run(root).code, 0);
  const page = readFileSync(join(root, 'dist/pov/link-pov/index.html'), 'utf8');
  assert.match(page, /<a href="https:\/\/en\.wikipedia\.org\/wiki\/Agent_\(software\)" rel="noopener noreferrer">the entry<\/a>\./);
});

test('no built page ever contains a javascript: or data: href', () => {
  const root = fixture({ ok: pov('A [safe](https://example.com/a) link.') });
  run(root);
  const page = readFileSync(join(root, 'dist/pov/ok/index.html'), 'utf8');
  assert.ok(!/href="\s*(javascript|data|vbscript):/i.test(page.replace('href="data:,"', '')));
});

test('## and ### headings become h2 and h3, so no heading level is skipped', () => {
  const root = fixture({ 'head-pov': pov('Intro.\n\n## Top\n\nText.\n\n### Sub\n\nText.') });
  assert.equal(run(root).code, 0);
  const page = readFileSync(join(root, 'dist/pov/head-pov/index.html'), 'utf8');
  assert.match(page, /<h2>Top<\/h2>/);
  assert.match(page, /<h3>Sub<\/h3>/);
  assert.ok(!/<h4>/.test(page));
});

test('HTML-special characters in text are escaped on the page', () => {
  const root = fixture({ 'esc-pov': pov('Use `<b>` and 5 > 3 & more.', { title: 'Tom & "Jerry" \'s', summary: 'a > b' }) });
  assert.equal(run(root).code, 0);
  const page = readFileSync(join(root, 'dist/pov/esc-pov/index.html'), 'utf8');
  assert.match(page, /Tom &amp; &quot;Jerry&quot; &#39;s/);
  assert.match(page, /<code>&lt;b&gt;<\/code>/);
  assert.ok(!page.includes('<b>'));
});

// ------------------------------------------------------------ failing cases

function fails(name, build, expected, { mustNotEcho = [] } = {}) {
  test(`fails: ${name}`, () => {
    const root = build();
    const r = run(root, '--check');
    assert.equal(r.code, 1, r.all);
    assert.match(r.err, expected, r.all);
    assert.match(r.err, /Nothing was built/);
    for (const secret of mustNotEcho) assert.ok(!r.all.includes(secret), 'output repeated the offending text');
    assert.ok(run(root).code === 1, 'full build must also fail');
  });
}

fails('unknown topic', () => fixture({ p: pov('x', { topics: '[agents, nope]' }) }), /povs\/p\/pov\.md:\d+: lists a topic that is not in povs\/topics\.json/);

fails('raw <script> in the body', () => fixture({ p: pov('Hello <script>alert(1)</script>') }), /pov\.md:\d+: contains raw HTML/, { mustNotEcho: ['alert(1)'] });

fails('raw HTML in the front matter', () => fixture({ p: pov('x', { title: '<img src=x>' }) }), /contains raw HTML/);

const EMAIL = 'someone.private' + '@' + 'example.com';
fails('email address in the body', () => fixture({ p: pov(`Contact ${EMAIL} please`) }), /contains an email address/, { mustNotEcho: [EMAIL, 'someone.private'] });

const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
fails('access token in the body', () => fixture({ p: pov(`key ${TOKEN}`) }), /looks like an access token or key/, { mustNotEcho: [TOKEN] });

const SLACK_ID = 'U' + '01AB2CD3EF';
fails('Slack ID in the body', () => fixture({ p: pov(`ping ${SLACK_ID} now`) }), /looks like a Slack ID/, { mustNotEcho: [SLACK_ID] });

fails('webhook URL in the body', () => fixture({ p: pov('see https://hooks.slack.com/services/T000/B000/XXXX') }), /contains a webhook URL/);

fails('bidi override character', () => fixture({ p: pov('safe text\u202Eevil') }), /bidirectional or invisible/);

fails('zero-width character', () => fixture({ p: pov('zero\u200Bwidth') }), /bidirectional or invisible/);

fails('control character', () => fixture({ p: pov('bell\u0007here') }), /control characters/);

fails('http link', () => fixture({ p: pov('[x](http://example.com/a)') }), /links must start with https:\/\//);

fails('javascript: link', () => fixture({ p: pov('[x](javascript:alert(1))') }), /links must start with https:\/\/|link URL is not valid/);

fails('link to a private host', () => fixture({ p: pov('[x](https://intranet.corp/a) [y](https://10.0.0.1/a)') }), /public host name/);

fails('a single-# heading', () => fixture({ p: pov('# Big heading\n\nText.') }), /use ## for headings/);

fails('a #### heading', () => fixture({ p: pov('#### Too deep\n\nText.') }), /headings deeper than ###/);

fails('image', () => fixture({ p: pov('![alt](https://example.com/a.png)') }), /images are not supported/);

fails('fenced code block', () => fixture({ p: pov('```\ncode\n```') }), /fenced code blocks are not supported/);

fails('bad date', () => fixture({ p: pov('x', { date: '2026-02-30' }) }), /real date written YYYY-MM-DD/);

fails('missing summary', () => fixture({ p: pov('x', { summary: null }) }), /missing 'summary'/);

fails('summary over 240 characters', () => fixture({ p: pov('x', { summary: 'a'.repeat(241) }) }), /'summary' is longer than 240/);

fails('author that looks like a handle', () => fixture({ p: pov('x', { author: 'a/b' }) }), /'author' must be a name only/);

fails('unknown front matter key', () => fixture({ p: pov('x', { colour: 'red' }) }), /unknown front matter key/);

fails('POV with no body', () => fixture({ p: { 'pov.md': fm() } }), /a POV needs body text/);

fails('related POV that does not exist', () => fixture({ p: pov('x', { related: '[ghost]' }) }), /related POV that does not exist/);

fails('POV related to itself', () => fixture({ p: pov('x', { related: '[p]' }) }), /cannot list itself/);

fails('upper-case folder name', () => fixture({ 'My-POV': pov() }), /folder name must be lowercase/);

const docFails = (name, entry, expected) => fails(name, () => fixture({ p: pov('x', { documents: docs(entry) }) }), expected, { mustNotEcho: [entry.split('|').pop().trim()] });

docFails('a document with no link', 'Deck', /must be written as Title \| link/);
docFails('a document with an http link', 'Deck | http://x.box.com/s/abc', /must start with https:\/\//);
docFails('a document on another host', 'Deck | https://drive.google.com/file/d/abc', /must point to Box, SharePoint or OneDrive/);
docFails('a look-alike host', 'Deck | https://evilbox.com/s/abc', /must point to Box, SharePoint or OneDrive/);
docFails('a host that only starts with box.com', 'Deck | https://box.com.evil.io/s/abc', /must point to Box, SharePoint or OneDrive/);
docFails('a link with a user name and password', 'Deck | https://user:secret@x.box.com/s/abc', /must not contain a user name or password/);
docFails('a link with a custom port', 'Deck | https://x.box.com:8443/s/abc', /must not use a custom port/);
docFails('a personal OneDrive link', 'Deck | https://contoso-my.sharepoint.com/personal/jo_contoso_com/Documents/x.pdf', /personal OneDrive/);
docFails('a title with a quote mark', "Deck 'x' <b> | https://x.box.com/s/abc", /title contains a character that is not allowed/);
docFails('a file name instead of a link', 'notes.pdf', /must be written as Title \| link/);
docFails('a very long link', `Deck | https://x.box.com/s/${'a'.repeat(1100)}`, /longer than 1000 characters/);

fails('two documents with the same link', () => fixture({ p: pov('x', { documents: docs(`One | ${BOX}`, `Two | ${BOX}`) }) }), /same document link is listed twice/);

fails('more than 20 documents', () => fixture({ p: pov('x', { documents: docs(...Array.from({ length: 21 }, (_, i) => `Doc ${i} | https://x.box.com/s/a${i}`)) }) }), /more than 20/);

fails('an uploaded executable file', () => fixture({ p: { ...pov(), 'run.exe': 'MZ' } }), /documents must be links in pov\.md, not uploaded files/);

fails('an uploaded pdf next to pov.md', () => fixture({ p: { ...pov(), 'extra.pdf': 'x' } }), /documents must be links in pov\.md, not uploaded files/);


fails('a large uploaded file is refused for being uploaded, whatever its size', () => fixture({ p: { ...pov(), 'big.pdf': Buffer.alloc(2 * 1024 * 1024) } }), /documents must be links in pov\.md, not uploaded files/);

fails('an email address inside a document link', () => fixture({ p: pov('x', { documents: docs(`Deck | https://x.box.com/s/abc?user=${EMAIL}`) }) }), /contains an email address/, { mustNotEcho: [EMAIL, 'someone.private'] });

fails('no front matter', () => fixture({ p: { 'pov.md': 'Just text.\n' } }), /must start with a ---/);

fails('unterminated front matter', () => fixture({ p: { 'pov.md': '---\ntitle: x\n' } }), /missing its closing ---/);

fails('repeated front matter key', () => fixture({ p: { 'pov.md': fm() .replace('---\n', '---\ntitle: one\n') + 'x\n' } }), /key is repeated/);

fails('a nested folder inside a POV folder', () => {
  const root = fixture({ p: pov() });
  mkdirSync(join(root, 'povs/p/sub'));
  return root;
}, /folders and links are not allowed/);

fails('a stray file in povs/', () => {
  const root = fixture({ p: pov() });
  writeFileSync(join(root, 'povs/notes.txt'), 'x');
  return root;
}, /only topics\.json and POV folders belong in povs/);

fails('topic with an unknown parent', () => fixture({ p: pov() }, { topics: [{ id: 'agents', title: 'A', view: 'v', parent: 'nope' }] }), /parent that is not a topic/);

fails('topics in a parent loop', () => fixture({}, { topics: [{ id: 'a', title: 'A', view: 'v', parent: 'b' }, { id: 'b', title: 'B', view: 'v', parent: 'a' }] }), /parent loop/);

fails('duplicate topic id', () => fixture({}, { topics: [{ id: 'a', title: 'A', view: 'v' }, { id: 'a', title: 'B', view: 'v' }] }), /repeats an earlier topic id/);

fails('invalid topics.json', () => {
  const root = fixture({ p: pov() });
  writeFileSync(join(root, 'povs/topics.json'), '{ not json');
  return root;
}, /is not valid JSON/);

fails('site/index.html without the sections marker', () => {
  const root = fixture({ p: pov() });
  writeFileSync(join(root, 'site/index.html'), '<html></html>');
  return root;
}, /must contain the <!-- build:sections --> marker/);

test('a failed build leaves no dist/ behind from this run', () => {
  const root = fixture({ p: pov('x', { topics: '[nope]' }) });
  assert.equal(run(root).code, 1);
  assert.throws(() => readFileSync(join(root, 'dist/index.html')));
});

// ------------------------------------------------------------- phase 3 pages

function built(povs) {
  const root = fixture(povs);
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  return { root, read: (rel) => readFileSync(join(root, 'dist', rel), 'utf8') };
}

const TWO = () => ({
  alpha: pov('Alpha body.', { topics: '[agents]', related: '[beta]', title: 'Alpha POV' }),
  beta: pov('Beta body.', { topics: '[agents, governance]', title: 'Beta POV', date: '2026-10-01' }),
});

test('every generated page carries the strict CSP and no inline script or style', () => {
  const { read } = built(TWO());
  for (const page of ['index.html', '404.html', 'add/index.html', 'pov/alpha/index.html']) {
    const html = read(page);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'/, page);
    assert.ok(!/ style="|<style|onclick=|onload=|<script>[^<]/i.test(html), `${page} has inline code`);
    assert.ok(!html.includes('<!-- build:'), `${page} has an unexpanded marker`);
  }
});

test('asset paths are relative at every depth, and absolute only on 404.html', () => {
  const { read } = built(TWO());
  assert.match(read('index.html'), /href="styles\.css"/);
  assert.match(read('add/index.html'), /href="\.\.\/styles\.css"/);
  assert.match(read('pov/alpha/index.html'), /href="\.\.\/\.\.\/styles\.css"/);
  assert.match(read('404.html'), /href="\/POV_Exchange\/styles\.css"/);
});

test('the library page has a still graph preview, topic tiles, both orderings and the stats', () => {
  const { read } = built(TWO());
  const home = read('index.html');
  assert.match(home, /<div class="preview"><svg class="preview-svg pv-wide"[^>]*role="group"/);
  assert.match(home, /<svg class="preview-svg pv-narrow"/);
  assert.match(home, /<a class="cn-topic" data-topic="agents" href="graph\/#t=agents">/);
  assert.match(home, /<a class="preview-cta" href="graph\/">Open the graph/);
  assert.ok(!home.includes('<canvas'), 'the library must not start the 3D graph');
  // by topic: alpha under 1 topic, beta under 2 = 3 cards; newest first: each once = 2 cards
  assert.equal((home.match(/class="card reveal[^"]*"/g) ?? []).length, 5);
  assert.match(home, /<section class="newest" id="newest"[^>]*hidden>/);
  assert.match(home, /class="tile reveal" data-topic="agents"/);
  assert.match(home, /href="graph\/#t=agents"/);
  assert.match(home, /<noscript>/);
  assert.match(home, /data-stat="povs"[^>]*>2 POVs<\/span>/);
  assert.match(home, /data-stat="topics"[^>]*>2 topics<\/span>/);
});

test('a POV page has a where-this-sits diagram with links, and the same connections as text', () => {
  const { read } = built(TWO());
  const page = read('pov/alpha/index.html');
  // the picture is a wide and a narrow drawing, hidden from screen readers; its links are not tab stops
  assert.match(page, /<svg class="eg-svg eg-wide"[^>]*aria-hidden="true"/);
  assert.match(page, /<svg class="eg-svg eg-narrow"[^>]*aria-hidden="true"/);
  assert.match(page, /<a class="eg-link" href="\.\.\/beta\/" tabindex="-1"><title>Beta POV<\/title>/);
  assert.match(page, /<a class="eg-link" href="\.\.\/\.\.\/#topic-agents" tabindex="-1">/);
  // the text lists are the accessible version, and the old separate Related section is folded in
  assert.match(page, /<section class="sits-group"><h3>Related POVs<\/h3>\s*<ul>\s*<li><a href="\.\.\/beta\/">Beta POV<\/a>/);
  assert.match(page, /<section class="sits-group"><h3>Topics<\/h3>\s*<ul>\s*<li><a href="\.\.\/\.\.\/#topic-agents">Agents<\/a>/);
  assert.ok(!page.includes('id="rel-h"'), 'there should be one connections section, not two');
  assert.ok(!page.includes('minimap'), 'the old mini map is gone');
  assert.match(page, /min read/);
});

test('graph.json has finite positions, the newest POV, and only real edge ends', () => {
  const { read } = built(TWO());
  const g = JSON.parse(read('data/graph.json'));
  assert.equal(g.newest, 'alpha');
  const ids = new Set(g.nodes.map((n) => n.id));
  for (const n of g.nodes) for (const k of ['x', 'y', 'z']) assert.ok(Number.isFinite(n[k]), `${n.id}.${k}`);
  for (const e of g.edges) assert.ok(ids.has(e.s) && ids.has(e.t), `${e.s} -> ${e.t}`);
  assert.ok(g.edges.some((e) => e.k === 'parent' || e.k === 'topic' || e.k === 'link'));
});

test('a title with markup characters cannot break out of the svg map', () => {
  const evil = 'A "quoted" <b>bold</b> & title';
  const root = fixture({ x: pov('Body.', { title: `'${evil}'`.replace(/<b>|<\/b>/g, '') }) });
  assert.equal(run(root).code, 0);
  const html = readFileSync(join(root, 'dist/pov/x/index.html'), 'utf8');
  assert.ok(!/<svg[\s\S]*?"quoted"[\s\S]*?<\/svg>/.test(html), 'raw quotes reached the svg');
  assert.match(html, /&quot;quoted&quot;/);
});

test('shared validation modules are copied for the Add page, and the add page links its data', () => {
  const { read } = built(TWO());
  for (const m of ['frontmatter', 'markdown', 'rules']) assert.match(read(`js/shared/${m}.js`), /^\/\/ /, m);
  assert.match(read('add/index.html'), /data-repo="Owen-Rogan\/POV_Exchange"/);
});

test('the real site: vendored three.js and fonts are present and unmodified in dist', () => {
  const root = fixture({ p: pov() });
  run(root);
  const a = readFileSync(join(repo, 'site/vendor/three/three.module.js'));
  const b = readFileSync(join(root, 'dist/vendor/three/three.module.js'));
  assert.ok(a.equals(b));
  assert.ok(readFileSync(join(root, 'dist/fonts/ibm-plex-sans-latin-400-normal.woff2')).length > 10000);
});

// ---------------------------------------------------- browser source rules

import { readdirSync } from 'node:fs';

const browserFiles = readdirSync(join(repo, 'site/js')).filter((f) => f.endsWith('.js')).map((f) => join(repo, 'site/js', f));

test('browser code never uses innerHTML, outerHTML, insertAdjacentHTML, eval or document.write', () => {
  const bad = /\.innerHTML|\.outerHTML|insertAdjacentHTML|\beval\s*\(|new Function\s*\(|document\.write/;
  for (const file of browserFiles) {
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!bad.test(code), `${file} uses an unsafe API`);
  }
});

test('browser code only fetches same-site data and never contacts another host', () => {
  for (const file of browserFiles) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/fetch\(\s*['"`]([^'"`]+)['"`]/g)) assert.ok(!/^[a-z]+:/i.test(m[1]) && !m[1].startsWith('//'), `${file} fetches ${m[1]}`);
    assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(code), `${file} opens a network channel`);
  }
});

test('browser code is plain ASCII, so no invisible characters can hide in it', () => {
  for (const file of [...browserFiles, ...readdirSync(join(repo, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => join(repo, 'scripts', f)),
    ...readdirSync(join(repo, 'scripts/lib')).map((f) => join(repo, 'scripts/lib', f))]) {
    const text = readFileSync(file, 'utf8');
    assert.ok(![...text].some((c) => c.charCodeAt(0) > 127), `${file} has a non-ASCII character`);
  }
});

test('every ES import in the browser code resolves to a file that exists', () => {
  const base = join(repo, 'site/js');
  const seen = [];
  for (const file of browserFiles) {
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(/(?:from|import\()\s*['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1]);
      seen.push(m[1]);
      if (target.includes(join('js', 'shared'))) continue; // generated into dist/ by the build
      try { readFileSync(target); } catch { assert.fail(`${file} imports ${m[1]}, which does not exist`); }
    }
  }
  assert.ok(seen.length > 15);
});

// ------------------------------------------------------------ sample content

import { writeSamples } from './make-samples.mjs';

test('120 generated sample POVs build, with distinct finite positions and a quick layout', () => {
  const root = mkdtempSync(join(tmpdir(), 'pov-scale-'));
  made.push(root);
  cpSync(join(repo, 'site'), join(root, 'site'), { recursive: true });
  writeSamples(root, { count: 120, seed: 3 });
  const started = Date.now();
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  assert.ok(Date.now() - started < 30000, 'build took longer than 30 seconds');
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  assert.equal(g.nodes.filter((n) => n.kind === 'pov').length, 120);
  const seen = new Set();
  for (const n of g.nodes) {
    assert.ok([n.x, n.y, n.z].every(Number.isFinite), n.id);
    // Topics, POVs and documents fit inside radius 100; glossary terms sit on an outer shell at 1.18 times that.
    assert.ok(Math.hypot(n.x, n.y, n.z) <= (n.kind === 'term' ? 118.01 : 100.01), `${n.id} is outside the layout radius`);
    const key = `${n.x},${n.y},${n.z}`;
    assert.ok(!seen.has(key), `${n.id} sits exactly on another node`);
    seen.add(key);
  }
  const topics = g.nodes.filter((n) => n.kind === 'topic');
  let closest = Infinity;
  for (let i = 0; i < topics.length; i++) for (let j = i + 1; j < topics.length; j++) {
    closest = Math.min(closest, Math.hypot(topics[i].x - topics[j].x, topics[i].y - topics[j].y, topics[i].z - topics[j].z));
  }
  assert.ok(closest > 30, `topic nodes are only ${closest.toFixed(1)} apart`);
});

test('sample content is clearly fictional and never reaches the real povs/ folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'pov-fiction-'));
  made.push(root);
  writeSamples(root, { count: 5 });
  const text = readFileSync(join(root, 'povs/samples/sample-1/pov.md'), 'utf8');
  assert.match(text, /fictional sample/);
  assert.match(readFileSync(join(root, 'povs/topics.json'), 'utf8'), /SAMPLE TEXT/);
  assert.match(readFileSync(join(root, 'povs/samples/README.md'), 'utf8'), /fictional/);
});

test('make-samples refuses an output folder that could hold real content', () => {
  const script = join(repo, 'scripts', 'make-samples.mjs');
  const listing = () => readdirSync(join(repo, 'povs'), { recursive: true }).sort().join('|');
  const before = listing();
  for (const bad of ['povs', 'site', '..', '../elsewhere', '.', 'scripts']) {
    const r = spawnSync(process.execPath, [script, '--out', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, `--out ${bad} was accepted`);
    assert.match(r.stderr, /--out must be a folder directly inside the project/);
  }
  for (const bad of ['0', '501', 'abc', '2.5']) {
    const r = spawnSync(process.execPath, [script, '--count', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, `--count ${bad} was accepted`);
  }
  assert.equal(listing(), before, 'povs/ changed');
});

// ------------------------------------------------------ samples + graph page

function sampleFixture(realPovs = {}, samples = {}, topics = TOPICS) {
  const root = fixture(realPovs, { topics });
  mkdirSync(join(root, 'povs/samples'), { recursive: true });
  for (const [slug, files] of Object.entries(samples)) {
    mkdirSync(join(root, 'povs/samples', slug), { recursive: true });
    for (const [name, content] of Object.entries(files)) writeFileSync(join(root, 'povs/samples', slug, name), content);
  }
  return root;
}

test('povs in povs/samples/ build as samples, and are flagged everywhere', () => {
  const root = sampleFixture({ real: pov('Real.') }, { fake: pov('Fake.', { title: 'A sample' }) });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /2 POVs.*1 of them samples/);
  const povs = JSON.parse(readFileSync(join(root, 'dist/data/povs.json'), 'utf8'));
  assert.equal(povs.find((p) => p.slug === 'fake').sample, true);
  assert.equal(povs.find((p) => p.slug === 'real').sample, undefined);
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  assert.equal(g.nodes.find((n) => n.id === 'p:fake').sample, true);
  const page = readFileSync(join(root, 'dist/pov/fake/index.html'), 'utf8');
  assert.match(page, /class="sample-note"/);
  assert.match(page, /Open in graph/);
  assert.match(readFileSync(join(root, 'dist/index.html'), 'utf8'), /data-slug="fake"[^>]*data-sample="1"/);
});

test('a sample flag in front matter is rejected: only the folder decides', () => {
  const root = sampleFixture({}, { fake: pov('x', { sample: 'false' }) });
  assert.equal(run(root, '--check').code, 1);
});

test('the same folder name in povs/ and povs/samples/ is refused', () => {
  const root = sampleFixture({ twin: pov() }, { twin: pov() });
  const r = run(root, '--check');
  assert.equal(r.code, 1);
  assert.match(r.err, /already used by another POV/);
});

test('a stray file inside povs/samples/ is refused, but README.md is ignored', () => {
  const root = sampleFixture({ real: pov() }, { fake: pov() });
  writeFileSync(join(root, 'povs/samples/README.md'), '# fictional');
  assert.equal(run(root, '--check').code, 0);
  writeFileSync(join(root, 'povs/samples/notes.txt'), 'x');
  const r = run(root, '--check');
  assert.equal(r.code, 1);
  assert.match(r.err, /only POV folders belong in povs\/samples\//);
});

test('sample-only topics disappear when there are no samples, and stay when there are', () => {
  const topics = [{ id: 'agents', title: 'Agents', view: 'v' }, { id: 'extra', title: 'Extra', view: 'v', sample: true, parent: 'agents' }];
  const without = sampleFixture({ real: pov() }, {}, topics);
  assert.equal(run(without).code, 0);
  const t1 = JSON.parse(readFileSync(join(without, 'dist/data/topics.json'), 'utf8'));
  assert.deepEqual(t1.map((t) => t.id), ['agents']);

  const withSamples = sampleFixture({ real: pov() }, { fake: pov('x', { topics: '[extra]' }) }, topics);
  assert.equal(run(withSamples).code, 0);
  const t2 = JSON.parse(readFileSync(join(withSamples, 'dist/data/topics.json'), 'utf8'));
  assert.deepEqual(t2.map((t) => t.id), ['agents', 'extra']);
  assert.equal(t2.find((t) => t.id === 'extra').sample, true);
  const g = JSON.parse(readFileSync(join(withSamples, 'dist/data/graph.json'), 'utf8'));
  assert.equal(g.nodes.find((n) => n.id === 't:extra').sample, true);
  assert.equal(g.nodes.find((n) => n.id === 't:agents').sample, undefined);
});

test('a flagged topic that a real POV uses is not treated as sample-only', () => {
  const topics = [{ id: 'agents', title: 'Agents', view: 'v', sample: true }];
  const root = sampleFixture({ real: pov() }, { fake: pov() }, topics);
  assert.equal(run(root).code, 0);
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  assert.equal(g.nodes.find((n) => n.id === 't:agents').sample, undefined);
});

test('document nodes carry their POV date and sample flag', () => {
  const root = sampleFixture({}, { fake: pov('x', { documents: docs(`Notes | ${BOX}`) }) });
  assert.equal(run(root).code, 0);
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  const doc = g.nodes.find((n) => n.kind === 'doc');
  assert.equal(doc.id, 'd:fake/1');
  assert.equal(doc.label, 'Notes');
  assert.equal(doc.date, '2026-11-06');
  assert.equal(doc.sample, true);
  assert.equal(doc.status, 'agreed');
});

test('each POV gets its own body file with parsed blocks and documents', () => {
  const root = sampleFixture({ real: pov('Hello **there**.\n\n- one\n- two') });
  assert.equal(run(root).code, 0);
  const body = JSON.parse(readFileSync(join(root, 'dist/data/pov/real.json'), 'utf8'));
  assert.equal(body.slug, 'real');
  assert.deepEqual(body.blocks.map((b) => b.t), ['p', 'ul']);
  assert.ok(!JSON.stringify(body).includes('<'), 'body data holds no markup');
  const index = readFileSync(join(root, 'dist/data/povs.json'), 'utf8');
  assert.ok(!index.includes('Hello'), 'povs.json stays small: no body text');
});

test('the graph page is built with a list of every node, the CSP and relative paths', () => {
  const root = sampleFixture({ real: pov('Body.') }, { fake: pov('x', { documents: docs(`Notes | ${BOX}`) }) });
  assert.equal(run(root).code, 0);
  const html = readFileSync(join(root, 'dist/graph/index.html'), 'utf8');
  assert.match(html, /href="\.\.\/styles\.css"/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(html, /class="gp" data-tier="static"/);
  assert.match(html, /data-node="p:real"/);
  assert.match(html, /data-node="p:fake"/);
  assert.match(html, /data-node="d:fake\/1"/);
  assert.match(html, /href="\.\.\/pov\/fake\/"/);
  assert.match(html, /<a href="https:\/\/ibm\.box\.com\/s\/[^"]+" data-node="d:fake\/1" target="_blank" rel="noopener noreferrer">Notes<\/a>/);
  assert.match(html, /aria-current="page">Graph<\/a>/);
  assert.ok(!html.includes('<!-- build:'));
  for (const page of ['index.html', 'add/index.html', 'pov/real/index.html']) {
    assert.match(readFileSync(join(root, 'dist', page), 'utf8'), />Graph<\/a>/, `${page} links to the graph`);
  }
});

test('the real project builds with a graph page and its own pages', () => {
  const r = spawnSync(process.execPath, [buildScript, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// --------------------------------------------------------- pure browser modules

const modUrl = (name) => pathToFileURL(join(repo, 'site/js', name)).href;

const MODEL_GRAPH = {
  newest: 'a',
  nodes: [
    { id: 't:agents', kind: 'topic', ref: 'agents', label: 'Agents', n: 2 },
    { id: 't:gov', kind: 'topic', ref: 'gov', label: 'Governance', n: 1, sample: true },
    { id: 'p:a', kind: 'pov', ref: 'a', label: 'Agents need an owner', date: '2026-03-01' },
    { id: 'p:b', kind: 'pov', ref: 'b', label: 'Budgets', date: '2026-01-10', sample: true },
    { id: 'p:c', kind: 'pov', ref: 'c', label: 'Third one', date: '2026-02-01' },
    { id: 'd:a/x.pdf', kind: 'doc', ref: 'a', label: 'x.pdf', date: '2026-03-01' },
  ],
  edges: [
    { s: 'p:a', t: 't:agents', k: 'link' }, { s: 'p:c', t: 't:agents', k: 'link' },
    { s: 'p:b', t: 't:gov', k: 'link' }, { s: 'p:b', t: 't:agents', k: 'link' },
    { s: 'p:a', t: 'p:c', k: 'related' }, { s: 'd:a/x.pdf', t: 'p:a', k: 'doc' },
  ],
};
const POVS = new Map([
  ['a', { title: 'Agents need an owner', summary: 'Owner matters', author: 'Ann', topics: ['agents'] }],
  ['b', { title: 'Budgets', summary: 'Money talk', author: 'Bob', topics: ['gov', 'agents'], sample: true }],
  ['c', { title: 'Third one', summary: 'Plain', author: 'Cy', topics: ['agents'] }],
]);
const TOPICS_BY_ID = new Map([['agents', { title: 'Agents', view: 'About agents.' }], ['gov', { title: 'Governance', view: 'About governance.' }]]);

test('graph-data: connections group a node\'s neighbours sensibly', async () => {
  const { withIndex, connections } = await import(modUrl('graph-data.js'));
  const model = withIndex(MODEL_GRAPH);
  const pov = connections(model, 'p:a');
  assert.deepEqual(pov.topics, ['t:agents']);
  assert.deepEqual(pov.related, ['p:c']);
  assert.deepEqual(pov.docs, ['d:a/x.pdf']);
  assert.deepEqual(pov.siblings, ['p:b']); // same topic, not already related
  const topic = connections(model, 't:agents');
  assert.deepEqual(topic.povs, ['p:a', 'p:c', 'p:b'].sort((x, y) => (model.byId.get(x).date < model.byId.get(y).date ? 1 : -1)));
  assert.equal(connections(model, 'd:a/x.pdf').pov, 'p:a');
  assert.deepEqual(connections(model, 'nope').topics, []);
});

test('graph-filter: search, topic, samples and the date cut-off', async () => {
  const { withIndex } = await import(modUrl('graph-data.js'));
  const { applyFilters, focusSet, edgeVisibility } = await import(modUrl('graph-filter.js'));
  const model = withIndex(MODEL_GRAPH);
  const ids = (res, which) => model.nodes.filter((n, i) => res[which][i]).map((n) => n.id);
  const base = { q: '', topic: '', samples: true, until: null };

  let r = applyFilters(model, POVS, TOPICS_BY_ID, base);
  assert.equal(r.active, false);
  assert.equal(ids(r, 'visible').length, 6);
  assert.equal(focusSet(model, r), null);

  r = applyFilters(model, POVS, TOPICS_BY_ID, { ...base, samples: false });
  assert.ok(!ids(r, 'visible').includes('p:b') && !ids(r, 'visible').includes('t:gov'));
  const ev = edgeVisibility(model, r);
  assert.equal(ev[model.edges.findIndex((e) => e.s === 'p:b' && e.t === 't:gov')], 0);

  r = applyFilters(model, POVS, TOPICS_BY_ID, { ...base, q: 'owner' });
  assert.deepEqual(ids(r, 'matched').sort(), ['d:a/x.pdf', 'p:a', 't:agents'].sort());

  r = applyFilters(model, POVS, TOPICS_BY_ID, { ...base, q: 'AGENTS money' }); // every word must match, case-insensitively
  assert.deepEqual(ids(r, 'matched').filter((id) => id.startsWith('p:')), ['p:b']);

  r = applyFilters(model, POVS, TOPICS_BY_ID, { ...base, topic: 'gov' });
  assert.deepEqual(ids(r, 'matched').filter((id) => id.startsWith('p:')), ['p:b']);
  assert.ok(focusSet(model, r).has('t:gov'));

  r = applyFilters(model, POVS, TOPICS_BY_ID, { ...base, until: '2026-02-15' });
  assert.deepEqual(ids(r, 'visible').filter((id) => id.startsWith('p:')).sort(), ['p:b', 'p:c']);
  assert.ok(!ids(r, 'visible').includes('d:a/x.pdf'), 'a document appears with its POV, not before');
});

test('timeline: positions map to distinct dates and back', async () => {
  const { distinctDates, makeTimeline, prettyDate } = await import(modUrl('timeline.js'));
  const dates = distinctDates(MODEL_GRAPH.nodes);
  assert.deepEqual(dates, ['2026-01-10', '2026-02-01', '2026-03-01']);
  const t = makeTimeline(dates);
  assert.equal(t.usable, true);
  assert.equal(t.max, 2);
  assert.equal(t.dateAt(-5), '2026-01-10');
  assert.equal(t.dateAt(99), '2026-03-01');
  assert.equal(t.posOf('2026-02-20'), 1);
  assert.equal(makeTimeline(['2026-01-01']).usable, false);
  assert.equal(makeTimeline([]).dateAt(0), null);
  assert.equal(prettyDate('2026-01-05'), '5 Jan 2026');
  assert.equal(prettyDate('garbage'), 'garbage');
});

test('tour: busiest topic first, a closing overview, and clamped stepping', async () => {
  const { withIndex } = await import(modUrl('graph-data.js'));
  const { tourSteps, stepIndex } = await import(modUrl('tour.js'));
  const steps = tourSteps(withIndex(MODEL_GRAPH), TOPICS_BY_ID);
  assert.deepEqual(steps.map((s) => s.title), ['Agents', 'Governance', 'The whole picture']);
  assert.equal(steps[0].text, 'About agents.');
  assert.equal(tourSteps(withIndex(MODEL_GRAPH), TOPICS_BY_ID, (n) => !n.sample).length, 2);
  assert.deepEqual(tourSteps(withIndex({ nodes: [], edges: [] }), TOPICS_BY_ID), []);
  assert.equal(stepIndex(0, -1, 3), 0);
  assert.equal(stepIndex(2, 1, 3), 2);
  assert.equal(stepIndex(1, 1, 3), 2);
  assert.equal(stepIndex(0, 1, 0), 0);
});

test('labels: topics first, POV labels only when zoomed in or related, no overlaps, capped', async () => {
  const { chooseLabels } = await import(modUrl('labels.js'));
  const item = (i, kind, x, y, extra = {}) => ({ i, kind, x, y, r: 5, a: 1, w: 60, h: 14, weight: 3, ...extra });
  const items = [item(0, 'topic', 100, 100), item(1, 'pov', 300, 100), item(2, 'doc', 500, 100), item(3, 'topic', 110, 104)];
  const none = new Set();
  let out = chooseLabels(items, { selected: -1, hover: -1, near: none, zoom: 1, showPovs: false });
  assert.deepEqual([...out.keys()], [0], 'topic 3 overlaps topic 0, and the POV is not shown while zoomed out');
  out = chooseLabels(items, { selected: -1, hover: -1, near: none, zoom: 2.5 });
  assert.ok(out.has(1) && !out.has(2), 'POV label appears when zoomed in; document label never does');
  out = chooseLabels(items, { selected: 2, hover: -1, near: none, zoom: 1 });
  assert.ok(out.has(2), 'the selected document is labelled');
  out = chooseLabels(items, { selected: -1, hover: -1, near: new Set([1]), zoom: 1 });
  assert.ok(out.has(1), 'a neighbour of the selection is labelled even when zoomed out');
  const many = Array.from({ length: 200 }, (_, i) => item(i, 'topic', (i % 20) * 90, Math.floor(i / 20) * 40));
  assert.ok(chooseLabels(many, { selected: -1, hover: -1, near: none, zoom: 1, limit: 45 }).size <= 45);
  assert.equal(chooseLabels([item(0, 'topic', 0, 0, { a: 0.05 })], { selected: -1, hover: -1, near: none, zoom: 1 }).size, 0, 'faded-out nodes get no label');
});

test('camera: projection, fitting, zoom toward the cursor and panning behave', async () => {
  const cam = await import(modUrl('camera.js'));
  const c = cam.makeCamera();
  c.yaw = 0; c.pitch = 0; c.dist = 200;
  const view = { width: 800, height: 600, shiftX: 0, shiftY: 0 };
  const centre = cam.project(c, view, 0, 0, 0);
  assert.ok(Math.abs(centre.x - 400) < 1e-6 && Math.abs(centre.y - 300) < 1e-6, 'the target is at the screen centre');
  const right = cam.project(c, view, 50, 0, 0);
  assert.ok(right.x > 400 && Math.abs(right.y - 300) < 1e-6);
  const up = cam.project(c, view, 0, 50, 0);
  assert.ok(up.y < 300, 'world up is screen up');
  const nearer = cam.project(c, view, 0, 0, 100);
  assert.ok(nearer.ppu > centre.ppu, 'things closer to the camera are larger');
  const shifted = cam.project(c, { ...view, shiftX: -100 }, 0, 0, 0);
  assert.equal(Math.round(shifted.x), 300, 'the panel offset moves the picture');

  const b = cam.boundsOf([{ x: -10, y: 0, z: 0 }, { x: 30, y: 0, z: 0 }]);
  assert.equal(b.cx, 10); assert.equal(b.radius, 20);
  assert.ok(cam.fitDistance(100, { width: 800, height: 600 }) > cam.fitDistance(50, { width: 800, height: 600 }));
  assert.ok(cam.fitDistance(100, { width: 800, height: 600, insetX: 300 }) > cam.fitDistance(100, { width: 800, height: 600 }), 'a panel needs more room');

  // zoom keeps the point under the cursor in place
  const z = cam.makeCamera(); z.yaw = 0.4; z.pitch = 0.2; z.dist = 250;
  const px = 520, py = 210;
  const bs = cam.basis(z);
  const ppu = view.height / 2 / (z.dist * cam.TAN);
  const wx = (px - 400) / ppu, wy = -(py - 300) / ppu;
  const world = [z.tx + bs.right[0] * wx + bs.up[0] * wy, z.ty + bs.right[1] * wx + bs.up[1] * wy, z.tz + bs.right[2] * wx + bs.up[2] * wy];
  const before = cam.project(z, view, ...world);
  cam.zoomAt(z, view, 0.5, px, py);
  const after = cam.project(z, view, ...world);
  assert.ok(Math.abs(before.x - after.x) < 1e-6 && Math.abs(before.y - after.y) < 1e-6, 'the point under the cursor stays put');
  assert.ok(z.dist < 250);
  for (let i = 0; i < 200; i++) cam.zoomAt(z, view, 0.7, 400, 300);
  assert.ok(z.dist >= z.minDist - 1e-9, 'zoom stops at the minimum distance');

  const p = cam.makeCamera(); p.dist = 200;
  for (let i = 0; i < 500; i++) cam.panBy(p, view, 80, 0);
  assert.ok(Math.hypot(p.tx, p.ty, p.tz) <= cam.LIMIT + 1e-6, 'the target cannot wander off');

  const g = cam.makeCamera();
  cam.flyTo(g, { yaw: 3, dist: 100, tx: 10 });
  for (let i = 0; i < 600 && cam.stepCamera(g, 0.016); i++);
  assert.ok(g.goal === null && Math.abs(g.tx - 10) < 0.05 && Math.abs(g.dist - 100) < 0.1);
  const r = cam.makeCamera(); r.yaw = 3.0;
  cam.flyTo(r, { yaw: -3.0 });
  cam.stepCamera(r, 0.1);
  assert.ok(r.yaw > 3.0, 'yaw takes the shortest way round');
  cam.flyTo(r, { yaw: 1, dist: 80 }, true);
  assert.equal(r.yaw, 1); assert.equal(r.goal, null);
});

test('graph-common: hit testing prefers the closest centre, then the nearer node', async () => {
  const { nearest, diameter, nodePixels, parseColor, introDelays } = await import(modUrl('graph-common.js'));
  const pts = [
    { id: 'far', x: 100, y: 100, r: 10, ok: true, depth: 400 },
    { id: 'near', x: 104, y: 100, r: 10, ok: true, depth: 100 },
    { id: 'off', x: 100, y: 100, r: 10, ok: false, depth: 1 },
  ];
  assert.equal(nearest(pts, 101, 100, 0), 'far');
  assert.equal(nearest(pts, 103, 100, 0), 'near');
  assert.equal(nearest(pts, 300, 300, 0), null);
  assert.ok(diameter({ kind: 'topic', n: 5 }) > diameter({ kind: 'pov' }) && diameter({ kind: 'pov' }) > diameter({ kind: 'doc' }));
  assert.ok(nodePixels(12, 0.01) >= 2.4 && nodePixels(12, 1000) <= 60);
  assert.deepEqual(parseColor('#fff'), [1, 1, 1]);
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [1, 0, 0]);
  assert.deepEqual(parseColor('nonsense'), [0.5, 0.5, 0.5]);
  const delays = introDelays({ nodes: [{ kind: 'topic' }, { kind: 'pov' }, { kind: 'doc' }] });
  assert.ok(delays[0] < delays[1] && delays[1] < delays[2]);
});

// A tiny stand-in for the DOM, just enough to render blocks and compare with the build.
function stubDoc() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  class Text { constructor(t) { this.t = t; } get html() { return esc(this.t); } }
  class El {
    constructor(tag) { this.tag = tag; this.kids = []; this.attrs = []; }
    append(...n) { this.kids.push(...n); }
    setAttribute(k, v) { this.attrs.push([k, v]); }
    get html() {
      const a = this.attrs.map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      return `<${this.tag}${a}>${this.kids.map((k) => k.html).join('')}</${this.tag}>`;
    }
  }
  return { createElement: (t) => new El(t), createTextNode: (t) => new Text(t) };
}

test('render-blocks gives the same result as the build\'s own HTML (parity)', async () => {
  const { renderBlocks } = await import(modUrl('render-blocks.js'));
  const { parseBlocks } = await import(pathToFileURL(join(repo, 'scripts/lib/markdown.mjs')).href);
  const { blocksToHtml } = await import(pathToFileURL(join(repo, 'scripts/lib/pages.mjs')).href);
  const body = [
    'Plain **bold** and *italic* and `a<b>` and a [link](https://example.com/a?x=1&y=2).', '',
    '## Heading two', '', '### Heading three', '',
    '- one with **bold**', '- two', '', '1. first', '2. second', '', '> A quote & more',
  ].join('\n');
  const blocks = parseBlocks(body, () => assert.fail('the sample markdown should be clean'));
  const mine = renderBlocks(stubDoc(), blocks).map((e) => e.html).join('\n');
  // The reader sits under its own h2, so POV headings drop a level (h2 -> h3, h3 -> h4).
  const theirs = blocksToHtml(blocks).replace(/<(\/?)h3>/g, '<$1h4>').replace(/<(\/?)h2>/g, '<$1h3>');
  assert.equal(mine, theirs);
  assert.match(mine, /<h3>Heading two<\/h3>/);
  assert.match(mine, /<code>a&lt;b&gt;<\/code>/);
  assert.match(mine, /href="https:\/\/example\.com\/a\?x=1&amp;y=2"/);
});

test('render-blocks refuses a link that is not https, and unknown nodes', async () => {
  const { renderBlocks } = await import(modUrl('render-blocks.js'));
  const evil = [{ t: 'p', c: [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'click' }] }] }];
  const html = renderBlocks(stubDoc(), evil).map((e) => e.html).join('');
  assert.equal(html, '<p>click</p>');
  assert.throws(() => renderBlocks(stubDoc(), [{ t: 'script' }]));
  assert.throws(() => renderBlocks(stubDoc(), [{ t: 'p', c: [{ t: 'html', v: '<b>' }] }]));
});

// ------------------------------------------------- the repo-mode sample writer

test('--repo mode adds samples under povs/samples/ and merges sample-only topics, never deleting', () => {
  const root = mkdtempSync(join(tmpdir(), 'pov-repo-'));
  made.push(root);
  mkdirSync(join(root, 'povs'), { recursive: true });
  writeFileSync(join(root, 'povs/topics.json'), JSON.stringify([
    { id: 'ai-strategy', title: 'AI strategy', view: 'Real view.' },
    { id: 'agents', title: 'Agents', view: 'Real view.', parent: 'ai-strategy' },
    { id: 'governance', title: 'Governance and risk', view: 'Real view.', parent: 'ai-strategy' },
    { id: 'data-foundations', title: 'Data foundations', view: 'Real view.', parent: 'ai-strategy' },
  ]));
  mkdirSync(join(root, 'povs/_notes'));
  writeFileSync(join(root, 'povs/_notes/keep.txt'), 'keep me');
  const made1 = writeSamples(root, { count: 12, seed: 5, merge: true });
  assert.equal(made1.addedTopics, 6);
  const topics = JSON.parse(readFileSync(join(root, 'povs/topics.json'), 'utf8'));
  assert.equal(topics.length, 10);
  assert.equal(topics.find((t) => t.id === 'agents').view, 'Real view.', 'existing topics are untouched');
  assert.ok(topics.filter((t) => t.sample).length === 6 && topics.every((t) => t.sample || t.view === 'Real view.'));
  assert.equal(readFileSync(join(root, 'povs/_notes/keep.txt'), 'utf8'), 'keep me');
  // the result builds
  cpSync(join(repo, 'site'), join(root, 'site'), { recursive: true });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /12 of them samples/);
  // and deleting povs/samples/ removes every trace of the samples
  rmSync(join(root, 'povs/samples'), { recursive: true });
  const r2 = run(root);
  assert.equal(r2.code, 0, r2.all);
  assert.match(r2.out, /0 POVs, 4 topics|0 POVs/);
  const left = JSON.parse(readFileSync(join(root, 'dist/data/topics.json'), 'utf8'));
  assert.deepEqual(left.map((t) => t.id), ['ai-strategy', 'agents', 'governance', 'data-foundations']);
});

test('--repo mode refuses to overwrite an existing povs/samples/', () => {
  const root = mkdtempSync(join(tmpdir(), 'pov-repo2-'));
  made.push(root);
  const script = join(repo, 'scripts', 'make-samples.mjs');
  const r = spawnSync(process.execPath, [script, '--repo', '--out', 'x'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /either --repo or --out/);
  if (existsSync(join(repo, 'povs/samples'))) {
    const again = spawnSync(process.execPath, [script, '--repo'], { encoding: 'utf8' });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists/);
  }
});

// ------------------------------------------------------------- upload batches

test('package: samples split into batches under the limit, never splitting a POV folder', async () => {
  const { planBatches, LIMIT, SAFE_BATCH } = await import(pathToFileURL(join(repo, 'scripts/package.mjs')).href);
  const files = ['.gitignore', 'package.json', 'povs/topics.json', 'povs/example-pov/pov.md', 'site/index.html', 'povs/samples/README.md'];
  for (let i = 1; i <= 120; i++) {
    const n = String(i).padStart(3, '0');
    files.push(`povs/samples/sample-${n}/pov.md`);
    if (i % 5 === 0) files.push(`povs/samples/sample-${n}/sample-notes.txt`);
  }
  const { app, samples } = planBatches(files);
  assert.ok(app.includes('povs/topics.json') && app.includes('povs/example-pov/pov.md'));
  assert.ok(app.every((f) => !f.startsWith('povs/samples/')), 'no sample file in the app zip');
  assert.ok(samples.length >= 2, 'a full set needs more than one batch');
  for (const batch of samples) assert.ok(batch.length <= SAFE_BATCH && batch.length < LIMIT);
  assert.equal(samples.flat().length, 1 + 120 + 24, 'every sample file lands in exactly one batch');
  assert.equal(new Set(samples.flat()).size, samples.flat().length);
  const folderBatch = new Map();
  samples.forEach((batch, i) => { for (const f of batch) { const k = f.split('/')[2]; if (folderBatch.has(k) && folderBatch.get(k) !== i) assert.fail(`${k} was split across batches`); folderBatch.set(k, i); } });
});

test('package: with no samples there is only the app set; an oversized folder is refused', async () => {
  const { planBatches } = await import(pathToFileURL(join(repo, 'scripts/package.mjs')).href);
  assert.deepEqual(planBatches(['package.json', 'povs/topics.json']).samples, []);
  const huge = Array.from({ length: 120 }, (_, i) => `povs/samples/big/file-${i}.txt`);
  assert.throws(() => planBatches(huge), /more files than a single upload allows/);
});

test('package: the real project fits GitHub\'s upload limit in every zip', async () => {
  const { planBatches, listFiles, LIMIT } = await import(pathToFileURL(join(repo, 'scripts/package.mjs')).href);
  const stage = mkdtempSync(join(tmpdir(), 'pov-pkg-'));
  made.push(stage);
  for (const item of ['.gitignore', 'CLAUDE.md', 'CONTRIBUTING.md', 'package.json', 'povs', 'scripts', 'site']) {
    if (existsSync(join(repo, item))) cpSync(join(repo, item), join(stage, item), { recursive: true });
  }
  const { app, samples } = planBatches(listFiles(stage));
  assert.ok(app.length < LIMIT, `the app zip has ${app.length} files`);
  for (const b of samples) assert.ok(b.length < LIMIT);
  assert.ok(!app.some((f) => f.includes('node_modules') || f.startsWith('dist/') || f.startsWith('_samples') || f.startsWith('_package')), 'no build output or scratch folders');
});

test('package: refuses an output folder outside the project', () => {
  const script = join(repo, 'scripts', 'package.mjs');
  for (const bad of ['povs', '../elsewhere', '.', 'site']) {
    const r = spawnSync(process.execPath, [script, '--out', bad], { encoding: 'utf8' });
    assert.equal(r.status, 1, `--out ${bad} was accepted`);
    assert.match(r.stderr, /--out must be a folder directly inside the project/);
  }
});

// =================================================== status, glossary, settings

const glossaryFile = (term, summary, extra = {}) => {
  const fields = { term: `"${term}"`, summary: `"${summary}"`, ...extra };
  return '---\n' + Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\nOptional longer text.\n';
};
/** A fixture with glossary terms. `files` maps a term file name (without .md) to its content; `sample` puts them under povs/samples/glossary. */
function glossaryFixture(povs, files, { sample = false } = {}) {
  const root = fixture(povs);
  const dir = join(root, sample ? 'povs/samples/glossary' : 'povs/glossary');
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, `${name}.md`), content);
  return root;
}
const built2 = (root) => {
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  return { r, read: (rel) => readFileSync(join(root, 'dist', rel), 'utf8'), json: (rel) => JSON.parse(readFileSync(join(root, 'dist', rel), 'utf8')) };
};

test('status is required, and must be draft or agreed', () => {
  const missing = fixture({ p: { 'pov.md': fm({ status: null }) + 'Body.\n' } });
  const r = run(missing, '--check');
  assert.equal(r.code, 1);
  assert.match(r.err, /front matter is missing 'status'/);
  const odd = fixture({ p: pov('x', { status: 'final' }) });
  assert.match(run(odd, '--check').err, /'status' must be draft or agreed/);
});

test('a draft shows a Draft chip and banner on its page and in the data, an agreed POV does not', () => {
  const { read, json } = built2(fixture({ d: pov('Draft body.', { status: 'draft' }), a: pov('Agreed body.', { status: 'agreed' }) }));
  assert.match(read('pov/d/index.html'), /class="draft-note"/);
  assert.match(read('pov/d/index.html'), /<span class="status draft">Draft<\/span>/);
  assert.ok(!read('pov/a/index.html').includes('draft-note'));
  assert.match(read('pov/a/index.html'), /<span class="status agreed">Agreed<\/span>/);
  const povs = json('data/povs.json');
  assert.equal(povs.find((p) => p.slug === 'd').status, 'draft');
  const g = json('data/graph.json');
  assert.equal(g.nodes.find((n) => n.id === 'p:d').status, 'draft');
  assert.match(read('index.html'), /data-slug="d"[^>]*data-status="draft"/);
});

test('search engines are asked to skip every page, until indexing is switched on', () => {
  const root = fixture({ p: pov() });
  const { read } = built2(root);
  for (const page of ['index.html', 'graph/index.html', 'glossary/index.html', 'add/index.html', '404.html', 'pov/p/index.html']) {
    assert.match(read(page), /<meta name="robots" content="noindex, nofollow">/, page);
  }
  writeFileSync(join(root, 'site.config.json'), JSON.stringify({ indexing: true }));
  const again = built2(root);
  assert.ok(!again.read('index.html').includes('name="robots"'));
});

test('site settings: defaults apply, bad values are named but never repeated', () => {
  const ok = fixture({ p: pov() });
  const { read, json } = built2(ok);
  assert.match(read('pov/p/index.html'), /<p class="contact">Contact the AI &amp; Analytics Practice<\/p>/);
  assert.equal(json('data/site.json').contactLine, 'Contact the AI & Analytics Practice');

  const EMAIL2 = 'team' + '@' + 'example.com';
  for (const [config, expected] of [
    [{ contactLine: `Write to ${EMAIL2}` }, /'contactLine' must be plain text/],
    [{ contactLine: 'See https://example.com/contact' }, /'contactLine' must be plain text/],
    [{ contactLine: '' }, /'contactLine' cannot be empty/],
    [{ indexing: 'yes' }, /'indexing' must be true or false/],
    [{ siteUrl: 'http://example.com/' }, /'siteUrl' must be an https address/],
    [{ siteUrl: 'https://user:pw@example.com/' }, /'siteUrl' must be an https address/],
    [{ surprise: 1 }, /unknown setting/],
  ]) {
    const root = fixture({ p: pov() });
    writeFileSync(join(root, 'site.config.json'), JSON.stringify(config));
    const r = run(root, '--check');
    assert.equal(r.code, 1, JSON.stringify(config));
    assert.match(r.err, expected, JSON.stringify(config));
    assert.ok(!r.all.includes(EMAIL2) && !r.all.includes('example.com/contact'), 'the bad value was repeated');
  }
});

test('no contact address or internal link appears anywhere in the built site', () => {
  const { read } = built2(fixture({ p: pov() }));
  for (const page of ['index.html', 'pov/p/index.html', 'graph/index.html', 'glossary/index.html']) {
    const html = read(page);
    assert.ok(!/mailto:|slack\.com|enterprise\.slack|ibm\.com/i.test(html), `${page} contains a contact address or internal link`);
  }
});

test('citation is neutral by default and uses the publisher when one is set', () => {
  const root = fixture({ p: pov() });
  assert.match(built2(root).read('pov/p/index.html'), /data-cite>Test Author\. \(2026\)\. A good title\. POV Exchange\. 2026-11-06\. https:\/\/owen-rogan\.github\.io\/POV_Exchange\/pov\/p\/<\/p>/);
  writeFileSync(join(root, 'site.config.json'), JSON.stringify({ publisher: 'Example Practice' }));
  const again = built2(root).read('pov/p/index.html');
  assert.match(again, /POV Exchange\. Example Practice\. 2026-11-06\./);
  assert.match(again, /Example Practice\. Practice opinions only/); // the footer too
});

test('the cite block, copy and print buttons are in the page without JavaScript', () => {
  const { read } = built2(fixture({ p: pov() }));
  const page = read('pov/p/index.html');
  assert.match(page, /<details class="cite"><summary>Cite this POV<\/summary>/);
  assert.match(page, /data-share="copy-link" hidden/);
  assert.match(page, /data-share="print" hidden/);
  assert.match(page, /data-share="copy-cite" hidden/);
});

// ------------------------------------------------------------------ glossary

test('a glossary term is built into the Glossary page, the data and the graph', () => {
  const root = glossaryFixture({ p: pov('A guardrail keeps limits. A pilot is small.') }, {
    guardrail: glossaryFile('Guardrail', 'A rule that keeps a system in limits.', { aliases: '["guardrails"]' }),
    pilot: glossaryFile('Pilot', 'A small trial.', { related: '[guardrail]' }),
  });
  const { read, json, r } = built2(root);
  assert.match(r.out, /2 glossary terms/);
  const page = read('glossary/index.html');
  assert.match(page, /class="gl-entry" id="guardrail"/);
  assert.match(page, /Also: guardrails/);
  assert.match(page, /Related: <a href="#guardrail">Guardrail<\/a>/);
  assert.match(page, /Used in 1 POV/);
  assert.match(page, /aria-current="page">Glossary<\/a>/);
  assert.deepEqual(json('data/glossary.json').map((g) => g.slug), ['guardrail', 'pilot']);
  const g = json('data/graph.json');
  assert.equal(g.nodes.find((n) => n.id === 'g:guardrail').kind, 'term');
  assert.ok(g.edges.some((e) => e.k === 'term' && e.s === 'g:guardrail' && e.t === 'p:p'));
  for (const n of g.nodes) assert.ok([n.x, n.y, n.z].every(Number.isFinite), n.id);
});

test('the first mention of a term in a POV becomes a pop-up link, once, and aliases count', () => {
  const root = glossaryFixture({ p: pov('Guardrails matter. A guardrail is a rule. Another Guardrail.') }, {
    guardrail: glossaryFile('Guardrail', 'A rule that keeps limits.', { aliases: '["guardrails"]' }),
  });
  const page = built2(root).read('pov/p/index.html');
  const links = page.match(/<a class="term"[^>]*>[^<]*<\/a>/g) ?? [];
  assert.equal(links.length, 1, 'only the first mention is linked');
  assert.match(links[0], /href="\.\.\/\.\.\/glossary\/#guardrail" data-def="A rule that keeps limits\."/);
  assert.match(links[0], />Guardrails<\/a>/);
});

test('terms are matched as whole words and never inside links, code or headings', () => {
  const body = ['## A guardrail heading', '', 'The guardrailing process and unguardrail words do not count.', '', 'See [a guardrail doc](https://example.com/g) and `guardrail` in code.', '', 'Finally a real Guardrail here.'].join('\n');
  const root = glossaryFixture({ p: pov(body) }, { guardrail: glossaryFile('Guardrail', 'A rule.') });
  const page = built2(root).read('pov/p/index.html');
  const links = page.match(/<a class="term"[^>]*>[^<]*<\/a>/g) ?? [];
  assert.equal(links.length, 1);
  assert.match(links[0], />Guardrail<\/a>/);
  assert.match(page, /<h2>A guardrail heading<\/h2>/);
  assert.match(page, /<code>guardrail<\/code>/);
  assert.match(page, /<a href="https:\/\/example\.com\/g" rel="noopener noreferrer">a guardrail doc<\/a>/);
});

test('the longest name wins, so "Human in the loop" is not split by "loop"', () => {
  const root = glossaryFixture({ p: pov('A human in the loop reviews it.') }, {
    loop: glossaryFile('Loop', 'A cycle.'),
    'human-in-the-loop': glossaryFile('Human in the loop', 'A person reviews.'),
  });
  const links = built2(root).read('pov/p/index.html').match(/<a class="term"[^>]*>[^<]*<\/a>/g) ?? [];
  assert.equal(links.length, 1);
  assert.match(links[0], /#human-in-the-loop/);
});

test('a term definition is escaped in the page, whatever it contains', () => {
  const root = glossaryFixture({ p: pov('A trap is here.') }, { trap: glossaryFile('Trap', 'Say "hi" & <wave>') });
  assert.equal(run(root, '--check').code, 1, 'raw markup in a definition is refused outright');
  const quoted = glossaryFixture({ p: pov('A trap is here.') }, { trap: glossaryFile('Trap', "It is a 5 > 3 and a 'quoted' thing") });
  const r = run(quoted);
  if (r.code === 0) {
    const page = readFileSync(join(quoted, 'dist/pov/p/index.html'), 'utf8');
    assert.ok(!/data-def="[^"]*[<>]/.test(page), 'angle brackets reached an attribute');
  }
});

test('glossary rules: duplicate names, missing fields, unknown related terms and stray files fail clearly', () => {
  const dupe = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x.'), b: glossaryFile('agent', 'y.') });
  assert.match(run(dupe, '--check').err, /already used by another entry/);
  const aliasClash = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x.', { aliases: '["bot"]' }), b: glossaryFile('Bot', 'y.') });
  assert.match(run(aliasClash, '--check').err, /already used by another entry/);
  const noSummary = glossaryFixture({ p: pov() }, { a: '---\nterm: "Agent"\n---\n' });
  assert.match(run(noSummary, '--check').err, /missing 'summary'/);
  const long = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x'.repeat(201)) });
  assert.match(run(long, '--check').err, /'summary' is longer than 200/);
  const ghost = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x.', { related: '[ghost]' }) });
  assert.match(run(ghost, '--check').err, /related term that does not exist/);
  const self = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x.', { related: '[a]' }) });
  assert.match(run(self, '--check').err, /cannot list itself/);
  const stray = glossaryFixture({ p: pov() }, { a: glossaryFile('Agent', 'x.') });
  writeFileSync(join(stray, 'povs/glossary/notes.txt'), 'x');
  assert.match(run(stray, '--check').err, /only \.md term files/);
  const badName = glossaryFixture({ p: pov() }, { 'Bad Name': glossaryFile('Agent', 'x.') });
  assert.match(run(badName, '--check').err, /term file name must be lowercase/);
});

test('sample glossary terms are flagged by their folder and vanish with povs/samples', () => {
  const root = glossaryFixture({ p: pov('A pilot.') }, { pilot: glossaryFile('Pilot', 'A trial.') }, { sample: true });
  const { json, read } = built2(root);
  assert.equal(json('data/glossary.json')[0].sample, true);
  assert.equal(json('data/graph.json').nodes.find((n) => n.id === 'g:pilot').sample, true);
  assert.match(read('glossary/index.html'), /data-sample="1"/);
  rmSync(join(root, 'povs/samples'), { recursive: true });
  const after = built2(root);
  assert.deepEqual(after.json('data/glossary.json'), []);
  assert.match(after.read('glossary/index.html'), /No terms yet/);
});

test('"samples" and "glossary" cannot be used as POV folder names', () => {
  // A POV folder called "samples" inside povs/samples/ is refused outright.
  const nested = fixture({ real: pov() });
  mkdirSync(join(nested, 'povs/samples/samples'), { recursive: true });
  writeFileSync(join(nested, 'povs/samples/samples/pov.md'), fm() + 'Body.\n');
  assert.match(run(nested, '--check').err, /this folder name is reserved/);

  // povs/glossary and povs/samples/glossary are glossary folders, so a POV file placed there is
  // read as a (broken) term file and the build fails instead of quietly publishing it as a POV.
  for (const base of ['povs/glossary', 'povs/samples/glossary']) {
    const root = fixture({ real: pov() });
    mkdirSync(join(root, base), { recursive: true });
    writeFileSync(join(root, base, 'pov.md'), fm() + 'Body.\n');
    const r = run(root, '--check');
    assert.equal(r.code, 1, base);
    assert.match(r.err, /missing 'term'/, base);
  }
});

// ----------------------------------------------- an empty project still builds

test('a project with no POVs, no samples and no glossary builds (the rollout depends on it)', () => {
  const root = fixture({});
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  assert.match(r.out, /0 POVs/);
  for (const page of ['index.html', 'graph/index.html', 'glossary/index.html']) {
    assert.ok(readFileSync(join(root, 'dist', page), 'utf8').length > 500, page);
  }
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  assert.ok(g.nodes.every((n) => n.kind === 'topic'));
});

// -------------------------------------------------- the constellation picture

// Realistic topic names: a mix of short and long, like a real topic list.
const TOPIC_NAMES = ['AI strategy', 'Agents', 'Governance and risk', 'Data foundations', 'Evaluation and testing', 'Operating model', 'Workforce and skills', 'Adoption and change', 'Security', 'Platforms and tooling'];
function topicGraph(n, { povsPer = 4 } = {}) {
  const nodes = [], edges = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    nodes.push({ id: `t:t${i}`, kind: 'topic', ref: `t${i}`, label: TOPIC_NAMES[i % TOPIC_NAMES.length] + (i >= TOPIC_NAMES.length ? ` ${Math.floor(i / TOPIC_NAMES.length) + 1}` : ''), n: povsPer, x: Math.cos(a) * 80, y: Math.sin(a * 2) * 30, z: Math.sin(a) * 80 });
    if (i > 0) edges.push({ s: `t:t${i}`, t: `t:t${i - 1}`, k: 'topic' });
    for (let j = 0; j < povsPer; j++) {
      nodes.push({ id: `p:p${i}-${j}`, kind: 'pov', ref: `p${i}-${j}`, label: 'x', x: 0, y: 0, z: 0, status: j % 3 === 0 ? 'draft' : 'agreed' });
      edges.push({ s: `p:p${i}-${j}`, t: `t:t${i}`, k: 'link' });
    }
  }
  return { nodes, edges, newest: null };
}

test('constellation: deterministic, labels inside the picture and never overlapping, at 4, 10 and 25 topics', async () => {
  const { constellationSvg, W, H } = await import(pathToFileURL(join(repo, 'scripts/lib/constellation.mjs')).href);
  for (const count of [4, 10, 25]) {
    const g = topicGraph(count);
    const svg = constellationSvg(g, { className: 'x', href: (r) => `graph/#t=${r}` });
    assert.equal(svg, constellationSvg(g, { className: 'x', href: (r) => `graph/#t=${r}` }), `${count} topics: not deterministic`);
    assert.equal((svg.match(/class="cn-topic( smp)?"/g) ?? []).length, count);
    assert.ok(!/ style=/.test(svg), 'no inline styles');
    const boxes = [...svg.matchAll(/<text class="cn-label" x="([\d.-]+)" y="([\d.-]+)" text-anchor="(\w+)">([^<]+)</g)].map((m) => {
      const w = Array.from(m[4]).length * 13.5 * 0.58;
      const x = Number(m[1]);
      const x0 = m[3] === 'middle' ? x - w / 2 : m[3] === 'start' ? x : x - w;
      return { x0, x1: x0 + w, y0: Number(m[2]) - 12, y1: Number(m[2]) + 3 };
    });
    for (const b of boxes) assert.ok(b.x0 >= 0 && b.x1 <= W && b.y0 >= 0 && b.y1 <= H, `${count} topics: a label leaves the picture`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `${count} topics: two labels overlap`);
    }
    // The design drops the lowest-priority label when there is no room (the circle and its count stay),
    // so the promise is: all labels with few topics, nearly all with ten, and never an overlap.
    if (count <= 4) assert.equal(boxes.length, count, `${count} topics: every label should fit`);
    else if (count <= 10) assert.ok(boxes.length >= Math.ceil(count * 0.8), `${count} topics: only ${boxes.length} labels fit`);
    assert.ok(boxes.length >= 3, `${count} topics: too few labels survived`);
  }
});

test('constellation: topics link into the graph, sample and draft dots carry hide classes, no lines to POVs', async () => {
  const { constellationSvg } = await import(pathToFileURL(join(repo, 'scripts/lib/constellation.mjs')).href);
  const g = topicGraph(5);
  g.nodes.find((n) => n.id === 'p:p0-0').sample = true;
  g.nodes.find((n) => n.id === 't:t1').sample = true;
  const svg = constellationSvg(g, { className: 'x', href: (r) => `graph/#t=${r}` });
  assert.match(svg, /<a class="cn-topic" data-topic="t0" href="graph\/#t=t0">/);
  assert.match(svg, /<a class="cn-topic smp" data-topic="t1"/);
  assert.match(svg, /class="cn-dot drf"/);
  assert.equal((svg.match(/class="cn-edge( smp)?"/g) ?? []).length, 4, 'only topic-to-topic lines');
  assert.ok(!/<a [^>]*><a /.test(svg), 'no nested links');
  assert.ok(!constellationSvg({ nodes: [], edges: [] }, { className: 'x' }), 'an empty graph draws nothing');
});

test('constellation: a narrow drawing keeps text readable and the library draws both', async () => {
  const { constellationSvg } = await import(pathToFileURL(join(repo, 'scripts/lib/constellation.mjs')).href);
  const g = topicGraph(6);
  const narrow = constellationSvg(g, { className: 'x', width: 360, height: 340 });
  assert.match(narrow, /viewBox="0 0 360 340"/);
  const { read } = built2(fixture({ a: pov(), b: pov('x', { topics: '[agents, governance]' }) }));
  const home = read('index.html');
  assert.equal((home.match(/class="preview-svg pv-/g) ?? []).length, 2);
});

test('constellation: principal axes spread points that a front-on view would pile up', async () => {
  const { principalAxes } = await import(pathToFileURL(join(repo, 'scripts/lib/constellation.mjs')).href);
  const line = [[0, 0, 0], [10, 0, 0], [20, 0, 0]];
  const { e1, e2 } = principalAxes(line);
  assert.ok(Math.abs(Math.abs(e1[0]) - 1) < 1e-6, 'first axis follows the line');
  assert.ok(Math.abs(e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) < 1e-6, 'axes are at right angles');
  const same = principalAxes([[1, 2, 3], [1, 2, 3]]);
  assert.ok(Number.isFinite(same.e1[0]) && Number.isFinite(same.e2[0]), 'identical points do not break it');
});

// -------------------------------------------------------- document link rules

test('doc-links: the host allow-list matches on a dot boundary and handles each service\'s link shapes', async () => {
  const { checkDocumentLink, hostLabel, ALLOWED_HOSTS } = await import(pathToFileURL(join(repo, 'scripts/lib/doc-links.mjs')).href);
  assert.deepEqual(ALLOWED_HOSTS, ['box.com', 'sharepoint.com', '1drv.ms', 'onedrive.live.com']);
  for (const url of [BOX, SHAREPOINT, ONEDRIVE_SHORT, 'https://app.box.com/s/abc', 'https://contoso.sharepoint.com/sites/Team/Shared%20Documents/x.pdf', 'https://onedrive.live.com/redir?resid=ABC']) {
    assert.equal(checkDocumentLink(url).ok, true, url);
  }
  for (const url of ['https://box.com.evil.io/s/a', 'https://evilbox.com/s/a', 'https://notsharepoint.com/x', 'https://sharepoint.com.attacker.net/x', 'https://x.box.com@evil.io/s/a', 'http://x.box.com/s/a', 'ftp://x.box.com/a', 'javascript:alert(1)', 'https://192.168.0.1/x', '//x.box.com/s/a']) {
    assert.equal(checkDocumentLink(url).ok, false, url);
  }
  // A backslash is read as a slash, so this really is a Box address; what matters is that the link we keep goes to Box.
  const odd = checkDocumentLink('https://x.box.com\\@evil.io/');
  assert.equal(odd.ok, true);
  assert.equal(odd.host, 'x.box.com');
  assert.equal(new URL(odd.url).hostname, 'x.box.com');
  assert.equal(checkDocumentLink('https://contoso-my.sharepoint.com/personal/jo/x').ok, false);
  assert.equal(checkDocumentLink('https://contoso-my.sharepoint.com/personal/jo/x', { allowPersonalOneDrive: true }).ok, true);
  assert.equal(hostLabel('ibm.box.com'), 'Box');
  assert.equal(hostLabel('contoso.sharepoint.com'), 'SharePoint');
  assert.equal(hostLabel('1drv.ms'), 'OneDrive');
  assert.equal(hostLabel('onedrive.live.com'), 'OneDrive');
  assert.equal(hostLabel('other.example'), 'other.example');
});

test('doc-links: realistic share links pass every text rule, and the same shapes elsewhere are still caught', async () => {
  const { scanText } = await import(pathToFileURL(join(repo, 'scripts/lib/rules.mjs')).href);
  const line = (url) => `documents: ["Deck | ${url}"]`;
  const slackish = 'U' + '01AB2CD3EF';
  const tokenish = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6';
  for (const url of [BOX, SHAREPOINT, ONEDRIVE_SHORT, `https://x.box.com/s/${slackish}`, `https://x.sharepoint.com/:b:/s/T/${tokenish}`]) {
    assert.deepEqual(scanText(line(url), { html: true }), [], url.slice(0, 40));
  }
  assert.equal(scanText(`see https://x.com/${slackish}`, { html: true }).length, 1, 'outside documents: a Slack-shaped string is caught');
  assert.equal(scanText(`documents: ["${tokenish} | https://x.box.com/s/a"]`, { html: true }).length, 1, 'in a title it is caught');
  assert.equal(scanText(line(`https://x.box.com/s/a?u=a.b${'@'}corp.com`), { html: true }).length, 1, 'an email in a link is caught');
});

test('front matter lists: commas and brackets inside quotes stay in one item', async () => {
  const { splitFrontMatter } = await import(pathToFileURL(join(repo, 'scripts/lib/frontmatter.mjs')).href);
  const read = (v) => splitFrontMatter(`---\nk: ${v}\n---\nb`);
  assert.deepEqual(read('["Plan, v2 | https://x.box.com/s/a", "Two"]').fields.k.value, ['Plan, v2 | https://x.box.com/s/a', 'Two']);
  assert.deepEqual(read('["Q&A [draft] | https://x.box.com/s/a"]').fields.k.value, ['Q&A [draft] | https://x.box.com/s/a']);
  assert.deepEqual(read("['a, b', c]").fields.k.value, ['a, b', 'c']);
  assert.deepEqual(read('[]').fields.k.value, []);
  assert.deepEqual(read('[a] # note').fields.k.value, ['a']);
  for (const bad of ['[a, ]', '[a, b', '["a, b]', '[a] junk']) assert.ok(read(bad).errors.length > 0, bad);
});

// -------------------------------------------------- the filters and the switches

test('graph-filter: drafts, terms and topics follow the switches', async () => {
  const { withIndex } = await import(modUrl('graph-data.js'));
  const { applyFilters } = await import(modUrl('graph-filter.js'));
  const graph = {
    newest: 'a',
    nodes: [
      { id: 't:agents', kind: 'topic', ref: 'agents', label: 'Agents', n: 2 },
      { id: 't:solo', kind: 'topic', ref: 'solo', label: 'Solo', n: 1 },
      { id: 'p:a', kind: 'pov', ref: 'a', label: 'A', date: '2026-03-01', status: 'agreed' },
      { id: 'p:d', kind: 'pov', ref: 'd', label: 'D', date: '2026-02-01', status: 'draft' },
      { id: 'd:d/1', kind: 'doc', ref: 'd', label: 'Doc', date: '2026-02-01', status: 'draft' },
      { id: 'g:term', kind: 'term', ref: 'term', label: 'Term', n: 1 },
    ],
    edges: [
      { s: 'p:a', t: 't:agents', k: 'link' }, { s: 'p:d', t: 't:agents', k: 'link' }, { s: 'p:d', t: 't:solo', k: 'link' },
      { s: 'd:d/1', t: 'p:d', k: 'doc' }, { s: 'g:term', t: 'p:d', k: 'term' },
    ],
  };
  const povs = new Map([['a', { title: 'A', topics: ['agents'] }], ['d', { title: 'D', topics: ['agents', 'solo'] }]]);
  const topics = new Map([['agents', { title: 'Agents' }], ['solo', { title: 'Solo' }]]);
  const model = withIndex(graph);
  const shown = (f) => { const r = applyFilters(model, povs, topics, { q: '', topic: '', samples: true, drafts: false, terms: false, until: null, ...f }); return model.nodes.filter((n, i) => r.visible[i]).map((n) => n.id).sort(); };

  assert.deepEqual(shown({}), ['p:a', 't:agents']);
  assert.deepEqual(shown({ drafts: true }), ['d:d/1', 'p:a', 'p:d', 't:agents', 't:solo']);
  assert.deepEqual(shown({ drafts: true, terms: true }), ['d:d/1', 'g:term', 'p:a', 'p:d', 't:agents', 't:solo']);
  assert.deepEqual(shown({ terms: true }), ['p:a', 't:agents'], 'a term whose only POV is a hidden draft is hidden too');
  assert.deepEqual(shown({ drafts: true, until: '2026-02-15' }), ['d:d/1', 'p:d', 't:agents', 't:solo'], 'the date cut-off hides the March POV');
});

test('prefs: stored choices, URL overrides, and clean addresses', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const prefs = await import(modUrl('prefs.js'));
  assert.deepEqual(prefs.prefsFromParams(new URLSearchParams('')), { samples: true, drafts: false });
  prefs.savePref('drafts', true);
  assert.equal(prefs.prefsFromParams(new URLSearchParams('')).drafts, true);
  assert.equal(prefs.prefsFromParams(new URLSearchParams('drafts=0')).drafts, false, 'the address beats the stored choice');
  assert.equal(prefs.prefsFromParams(new URLSearchParams('samples=0')).samples, false);
  const p = new URLSearchParams();
  prefs.paramsFromPrefs(p, { samples: true, drafts: false });
  assert.equal(p.toString(), '', 'defaults leave the address clean');
  prefs.paramsFromPrefs(p, { samples: false, drafts: true });
  assert.equal(p.get('samples'), '0'); assert.equal(p.get('drafts'), '1');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(prefs.loadPref('samples'), true, 'blocked storage falls back to the default');
  prefs.savePref('samples', false); // must not throw
  delete globalThis.localStorage;
});

test('reader: a term and a document node have views, and render-blocks parity covers term nodes', async () => {
  const { renderBlocks } = await import(modUrl('render-blocks.js'));
  const { blocksToHtml } = await import(pathToFileURL(join(repo, 'scripts/lib/pages.mjs')).href);
  assert.ok(true);
  const blocks = [{ t: 'p', c: [{ t: 'text', v: 'See ' }, { t: 'term', slug: 'guardrail', def: 'A "rule" & more', c: [{ t: 'text', v: 'guardrail' }] }, { t: 'text', v: '.' }] }];
  const theirs = blocksToHtml(blocks);
  const mine = renderBlocks(stubDoc(), blocks, { termBase: '../../glossary/' }).map((e) => e.html).join('');
  assert.match(theirs, /<a class="term" href="\.\.\/\.\.\/glossary\/#guardrail" data-def="A &quot;rule&quot; &amp; more">guardrail<\/a>/);
  assert.equal(mine, theirs);
});

test('browser code: no new script reads or writes anything outside same-site data and local storage', () => {
  for (const file of ['prefs.js', 'share.js', 'terms.js', 'glossary.js', 'library.js', 'graph-page.js']) {
    const code = readFileSync(join(repo, 'site/js', file), 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(/.test(code), `${file} uses an unsafe API`);
    assert.ok(!/document\.cookie|sessionStorage|indexedDB|navigator\.sendBeacon/.test(code), `${file} stores data somewhere unexpected`);
  }
});


// ---------------------------------------------------- where this sits (ego diagram)

const egoUrl = pathToFileURL(join(repo, 'scripts/lib/ego.mjs')).href;
const layoutUrl = pathToFileURL(join(repo, 'scripts/lib/layout.mjs')).href;
const REAL_TITLES = [
  'Prompts fail quietly', 'A very long title that goes on and on about how pilots should always start with a small, owned checklist',
  'Supercalifragilisticexpialidocious-and-unbreakable-word-title', 'Budgets', 'Handoffs work best in pairs',
];
const egoData = (over = {}) => ({
  self: { label: 'Sample 015: Playbooks fail quietly', draft: false },
  topics: [{ label: 'Data foundations', href: '../../#topic-data' }, { label: 'Evaluation and testing', href: '../../#topic-eval' }],
  related: REAL_TITLES.map((label, i) => ({ label, href: `../r${i}/`, draft: i === 1 })),
  moreRelated: 0,
  terms: [{ label: 'Guardrail', href: '../../glossary/#guardrail' }, { label: 'Human in the loop', href: '../../glossary/#hitl' }],
  moreTerms: 0,
  moreHref: '#connections-list',
  ...over,
});

/** Pull every pill rectangle and text line out of a drawing, with the numbers the layout used. */
function egoShapes(svg) {
  const num = (s, k) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(s)[1]);
  const pills = [...svg.matchAll(/<rect class="eg-pill[^"]*"[^>]*\/>/g)].map((m) => ({ x: num(m[0], 'x'), y: num(m[0], 'y'), w: num(m[0], 'width'), h: num(m[0], 'height') }));
  const lines = [...svg.matchAll(/<tspan x="([-\d.]+)" y="([-\d.]+)">([^<]*)<\/tspan>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), text: m[3] }));
  const view = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  return { pills, lines, W: Number(view[1]), H: Number(view[2]) };
}

test('where this sits: pills never overlap and always sit inside the picture, wide and narrow', async () => {
  const { egoWide, egoNarrow } = await import(egoUrl);
  for (const d of [egoData(), egoData({ related: [], terms: [] }), egoData({ topics: [], related: [] }), egoData({ moreRelated: 9, moreTerms: 4, terms: Array.from({ length: 5 }, (_, i) => ({ label: `Term number ${i}`, href: `../g${i}` })) })]) {
    for (const draw of [egoWide, egoNarrow]) {
      const { pills, W, H } = egoShapes(draw(d).svg);
      assert.ok(pills.length >= 1);
      for (const p of pills) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H, `${draw.name}: a pill sticks out of the picture`);
      for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i], b = pills[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        assert.ok(apart, `${draw.name}: pills ${i} and ${j} overlap`);
      }
    }
  }
});

test('where this sits: every line of text fits inside its pill at the width it is drawn', async () => {
  const { egoWide, egoNarrow, FONT } = await import(egoUrl);
  assert.ok(FONT >= 12, 'text in the drawing must be at least 12px');
  for (const draw of [egoWide, egoNarrow]) {
    const { pills, lines } = egoShapes(draw(egoData()).svg);
    for (const l of lines) {
      const home = pills.find((p) => l.x >= p.x && l.x < p.x + p.w && l.y > p.y && l.y <= p.y + p.h);
      assert.ok(home, `${draw.name}: "${l.text}" is not inside any pill`);
      // a generous 0.6em per character, the same assumption the layout wraps with
      assert.ok(l.x + Array.from(l.text).length * FONT * 0.6 <= home.x + home.w, `${draw.name}: "${l.text}" runs past its pill`);
    }
  }
});

test('where this sits: long titles are cut with an ellipsis, with the full title in a tooltip', async () => {
  const { egoWide, wrapLines } = await import(egoUrl);
  const cut = wrapLines(REAL_TITLES[1], 20, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith(String.fromCharCode(0x2026)));
  assert.ok(cut.every((l) => Array.from(l).length <= 20));
  assert.deepEqual(wrapLines('Short title', 20, 2), ['Short title']);
  assert.ok(Array.from(wrapLines('Supercalifragilisticexpialidocious', 12, 2)[0]).length <= 12, 'one word longer than a line is cut');
  assert.match(egoWide(egoData()).svg, new RegExp(`<title>${REAL_TITLES[1]}</title>`));
});

test('where this sits: caps the groups and says how many more, linking to the text lists', async () => {
  const { egoWide, egoNarrow } = await import(egoUrl);
  for (const draw of [egoWide, egoNarrow]) {
    const svg = draw(egoData({ moreRelated: 9, moreTerms: 4 })).svg;
    assert.match(svg, /\+9 more/);
    assert.match(svg, /\+4 more/);
    assert.match(svg, /href="#connections-list"/);
  }
});

test('where this sits: draft pills are dashed, terms have their own colour class, and the picture is deterministic', async () => {
  const { egoWide, egoHtml } = await import(egoUrl);
  assert.match(egoWide(egoData()).svg, /class="eg-pill eg-pov drf"/);
  assert.match(egoWide(egoData()).svg, /class="eg-pill eg-term"/);
  assert.equal(egoHtml(egoData()), egoHtml(egoData()));
  const both = egoHtml(egoData());
  assert.match(both, /eg-wide/);
  assert.match(both, /eg-narrow/);
});

test('where this sits: markup in a title is escaped, and no style attribute or script is ever written', async () => {
  const { egoHtml } = await import(egoUrl);
  const html = egoHtml(egoData({ self: { label: 'A "quoted" <b>bold</b> & title' }, related: [{ label: '<img src=x onerror=alert(1)>', href: '../x/"><script>' }] }));
  assert.ok(!/<b>|<img|<script/i.test(html), 'raw markup reached the svg');
  assert.ok(!/ style=/.test(html), 'a style attribute would be blocked by the content security policy');
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt;/);
});

test('where this sits: a POV with no topics or relations still draws a valid picture', async () => {
  const { egoHtml } = await import(egoUrl);
  const html = egoHtml(egoData({ topics: [], related: [], terms: [] }));
  assert.match(html, /<svg class="eg-svg eg-wide"/);
  assert.match(html, /No related POVs/);
});

test('where this sits: the stylesheet colours every pill kind the build can draw', () => {
  const css = readFileSync(join(repo, 'site/styles.css'), 'utf8');
  for (const kind of ['topic', 'pov', 'term', 'more']) assert.match(css, new RegExp(`\\.eg-stripe\\.eg-${kind}\\b`), `no colour for ${kind}`);
  assert.match(css, /\.eg-pill\.drf\s*\{[^}]*stroke-dasharray/);
});

// ------------------------------------------------------------ clustered layout

function clusterInput(nPovs = 60) {
  const topics = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id: `t:${id}`, parent: i === 3 ? 't:a' : null, related: i === 1 ? ['t:a'] : [] }));
  const povs = Array.from({ length: nPovs }, (_, i) => {
    const main = topics[i % topics.length].id;
    const second = topics[(i * 3 + 1) % topics.length].id;
    return { id: `p:s${i}`, topics: second !== main && i % 3 === 0 ? [main, second] : [main], docs: i % 10 === 0 ? [`d:s${i}/1`] : [] };
  });
  const terms = [{ id: 'g:x', uses: ['p:s0', 'p:s1'] }, { id: 'g:y', uses: ['p:s2'] }, { id: 'g:z', uses: [] }];
  return { topics, povs, terms };
}

test('cluster layout: deterministic, finite, centred, and every node has its own place', async () => {
  const { computeClusterLayout } = await import(layoutUrl);
  const input = clusterInput();
  const a = computeClusterLayout(input);
  const b = computeClusterLayout(clusterInput());
  assert.deepEqual([...a], [...b], 'the same input must give the same positions');
  const expected = input.topics.length + input.povs.length + input.povs.reduce((n, p) => n + p.docs.length, 0) + input.terms.length;
  assert.equal(a.size, expected);
  const seen = new Set();
  for (const [id, p] of a) {
    assert.ok([p.x, p.y, p.z].every(Number.isFinite), id);
    const key = `${p.x},${p.y},${p.z}`;
    assert.ok(!seen.has(key), `${id} sits exactly on another node`);
    seen.add(key);
  }
});

test('cluster layout: at least 95 percent of POVs sit nearest their own main topic, and lines to it are short', async () => {
  const { computeClusterLayout } = await import(layoutUrl);
  const input = clusterInput(120);
  const pos = computeClusterLayout(input);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  let own = 0, longest = 0, total = 0;
  for (const p of input.povs) {
    const nearest = input.topics.map((t) => [t.id, dist(pos.get(p.id), pos.get(t.id))]).sort((x, y) => x[1] - y[1])[0][0];
    if (nearest === p.topics[0]) own += 1;
    longest = Math.max(longest, dist(pos.get(p.id), pos.get(p.topics[0])));
    total += 1;
  }
  assert.ok(own / total >= 0.95, `only ${own} of ${total} POVs are nearest their own topic`);
  assert.ok(longest < 45, `a POV is ${longest.toFixed(0)} units from its main topic`);
});

test('cluster layout: POVs and topics fit radius 100, glossary terms sit outside the clusters on a wider shell', async () => {
  const { computeClusterLayout } = await import(layoutUrl);
  const input = clusterInput();
  const pos = computeClusterLayout(input);
  let farthest = 0;
  for (const [id, p] of pos) {
    const r = Math.hypot(p.x, p.y, p.z);
    if (id.startsWith('g:')) assert.ok(Math.abs(r - 118) < 0.5, `${id} is not on the term shell (${r.toFixed(1)})`);
    else farthest = Math.max(farthest, r);
  }
  assert.ok(Math.abs(farthest - 100) < 0.5, `non-term nodes reach ${farthest.toFixed(1)}, expected 100`);
});

test('cluster layout: a topic with one POV, an empty topic and no POVs at all all lay out', async () => {
  const { computeClusterLayout } = await import(layoutUrl);
  const one = computeClusterLayout({ topics: [{ id: 't:a' }, { id: 't:b' }], povs: [{ id: 'p:only', topics: ['t:a'], docs: [] }] });
  assert.equal(one.size, 3);
  for (const p of one.values()) assert.ok([p.x, p.y, p.z].every(Number.isFinite));
  assert.equal(computeClusterLayout({ topics: [], povs: [] }).size, 0);
  const lone = computeClusterLayout({ topics: [{ id: 't:a' }], povs: [] });
  assert.equal(lone.size, 1);
});

test('cluster layout: 500 POVs lay out quickly', async () => {
  const { computeClusterLayout } = await import(layoutUrl);
  const started = Date.now();
  const pos = computeClusterLayout(clusterInput(500));
  assert.ok(pos.size > 500);
  assert.ok(Date.now() - started < 3000, 'layout took more than 3 seconds');
});

// ---------------------------------------------------------------- calm lines

test('graph.json: a POV main topic is a link, its other topics are link2, and the built file says so', () => {
  const { read } = built(TWO());
  const g = JSON.parse(read('data/graph.json'));
  const beta = g.edges.filter((e) => e.s === 'p:beta' && e.t.startsWith('t:'));
  assert.equal(beta.length, 2, 'beta lists two topics');
  assert.equal(beta.filter((e) => e.k === 'link').length, 1, 'exactly one main-topic line');
  assert.equal(beta.filter((e) => e.k === 'link2').length, 1, 'the other topic is a secondary line');
  const alpha = g.edges.filter((e) => e.s === 'p:alpha' && e.t.startsWith('t:'));
  assert.deepEqual(alpha.map((e) => e.k), ['link']);
});

test('edge reveal: secondary and glossary lines show only for the node you pick', async () => {
  const { edgeReveal, QUIET_EDGES } = await import(modUrl('graph-common.js'));
  assert.deepEqual([...QUIET_EDGES].sort(), ['link2', 'term']);
  const model = {
    edges: [
      { s: 'p:a', t: 't:x', k: 'link' }, { s: 'p:a', t: 't:y', k: 'link2' }, { s: 'p:b', t: 't:y', k: 'link2' },
      { s: 'g:q', t: 'p:a', k: 'term' }, { s: 't:x', t: 't:y', k: 'topic' }, { s: 'p:a', t: 'd:a/1', k: 'doc' },
    ],
  };
  assert.deepEqual([...edgeReveal(model, null)], [1, 0, 0, 0, 1, 1], 'calm by default');
  assert.deepEqual([...edgeReveal(model, 'p:a')], [1, 1, 0, 1, 1, 1], "p:a shows its own other-topic and term lines only");
  assert.deepEqual([...edgeReveal(model, 't:y')], [1, 1, 1, 0, 1, 1], 'a topic shows the POVs that list it second');
});

// -------------------------------------------------------------- side browser

async function browseFixture() {
  const { withIndex } = await import(modUrl('graph-data.js'));
  const { applyFilters } = await import(modUrl('graph-filter.js'));
  const { browseTree } = await import(modUrl('browse-model.js'));
  const topics = [{ id: 'agents', title: 'Agents' }, { id: 'gov', title: 'Governance' }, { id: 'empty', title: 'Empty topic' }];
  const model = withIndex({
    nodes: [
      { id: 't:agents', kind: 'topic', ref: 'agents', label: 'Agents' },
      { id: 't:gov', kind: 'topic', ref: 'gov', label: 'Governance', sample: true },
      { id: 't:empty', kind: 'topic', ref: 'empty', label: 'Empty topic' },
      { id: 'p:one', kind: 'pov', ref: 'one', label: 'One about budgets', date: '2026-03-01', status: 'agreed' },
      { id: 'p:two', kind: 'pov', ref: 'two', label: 'Two about agents', date: '2026-05-01', status: 'agreed' },
      { id: 'p:three', kind: 'pov', ref: 'three', label: 'Three is a draft', date: '2026-06-01', status: 'draft' },
      { id: 'p:four', kind: 'pov', ref: 'four', label: 'Four is a sample', date: '2026-04-01', status: 'agreed', sample: true },
      { id: 'g:term', kind: 'term', ref: 'term', label: 'Guardrail' },
    ],
    edges: [
      { s: 'p:one', t: 't:agents', k: 'link' }, { s: 'p:one', t: 't:gov', k: 'link2' },
      { s: 'p:two', t: 't:agents', k: 'link' }, { s: 'p:three', t: 't:gov', k: 'link' }, { s: 'p:four', t: 't:gov', k: 'link' },
      { s: 'g:term', t: 'p:one', k: 'term' },
    ],
  });
  const povs = [
    { slug: 'one', title: 'One about budgets', summary: 'Money.', author: 'A', topics: ['agents', 'gov'], date: '2026-03-01', status: 'agreed' },
    { slug: 'two', title: 'Two about agents', summary: '', author: 'B', topics: ['agents'], date: '2026-05-01', status: 'agreed' },
    { slug: 'three', title: 'Three is a draft', summary: '', author: 'B', topics: ['gov'], date: '2026-06-01', status: 'draft' },
    { slug: 'four', title: 'Four is a sample', summary: '', author: 'C', topics: ['gov'], date: '2026-04-01', status: 'agreed', sample: true },
  ];
  const povBySlug = new Map(povs.map((p) => [p.slug, p]));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const tree = (f) => browseTree(model, povBySlug, topics, topicById, applyFilters(model, povBySlug, topicById, { q: '', topic: '', samples: true, drafts: false, terms: false, until: null, ...f }));
  return { model, povBySlug, topics, tree };
}

test('browse model: every POV appears once, under its main topic, newest first', async () => {
  const { tree } = await browseFixture();
  const t = tree({ drafts: true });
  const rows = t.groups.flatMap((g) => g.rows.map((r) => r.id));
  assert.equal(rows.length, new Set(rows).size, 'a POV is listed twice');
  assert.equal(rows.length, 4);
  const gov = t.groups.find((g) => g.id === 't:gov');
  assert.deepEqual(gov.rows.map((r) => r.slug), ['three', 'four'], 'one is under Agents, its first topic, not here');
  assert.deepEqual(t.groups.find((g) => g.id === 't:agents').rows.map((r) => r.slug), ['two', 'one']);
  assert.deepEqual(t.groups.find((g) => g.id === 't:agents').rows[1].also, ['Governance'], 'the other topics are kept as chips');
});

test('browse model: the sample and draft switches change the list and the counts', async () => {
  const { tree } = await browseFixture();
  const count = (t) => t.groups.reduce((n, g) => n + g.rows.length, 0);
  assert.equal(count(tree({})), 3, 'drafts hidden by default: one, two, four');
  assert.equal(count(tree({ drafts: true })), 4);
  assert.equal(count(tree({ samples: false })), 2);
  assert.equal(count(tree({ samples: false, drafts: true })), 3);
  assert.equal(tree({ samples: false }).groups.find((g) => g.id === 't:gov'), undefined, 'a sample-only topic leaves the list with samples off');
  assert.equal(tree({}).total, 3);
  assert.equal(tree({}).groups.find((g) => g.id === 't:empty'), undefined, 'a topic with nothing to show is not listed');
});

test('browse model: a search keeps only matching POVs, and topics with no match disappear', async () => {
  const { tree } = await browseFixture();
  const t = tree({ q: 'budgets' });
  assert.equal(t.searching, true);
  assert.equal(t.shown, 1);
  assert.equal(t.total, 3, 'the total is what the switches allow, not what matches');
  assert.deepEqual(t.groups.map((g) => g.id), ['t:agents']);
  assert.deepEqual(t.groups[0].rows.map((r) => r.slug), ['one']);
  assert.equal(tree({ q: 'nothing like this' }).groups.length, 0);
});

test('browse model: glossary terms are listed only while the terms switch is on', async () => {
  const { tree } = await browseFixture();
  assert.equal(tree({}).terms.length, 0);
  assert.deepEqual(tree({ terms: true }).terms.map((x) => x.title), ['Guardrail']);
});

test('browse model: groupFor and rowKeyFor say where a selection lives', async () => {
  const { model, povBySlug } = await browseFixture();
  const { groupFor, rowKeyFor, TERMS_GROUP } = await import(modUrl('browse-model.js'));
  assert.equal(groupFor(model, povBySlug, 'p:one'), 't:agents');
  assert.equal(groupFor(model, povBySlug, 't:gov'), 't:gov');
  assert.equal(groupFor(model, povBySlug, 'g:term'), TERMS_GROUP);
  assert.equal(groupFor(model, povBySlug, 'nope'), null);
  assert.equal(rowKeyFor({ byId: new Map([['d:one/1', { kind: 'doc', ref: 'one' }]]) }, 'd:one/1'), 'p:one', 'a document highlights its POV');
});

// ------------------------------------------------------------ moving around

test('drag meaning: Turn mode turns, Move mode slides, Shift flips either, other buttons always slide', async () => {
  const { dragMeaning } = await import(modUrl('controls.js'));
  assert.equal(dragMeaning(), 'rotate');
  assert.equal(dragMeaning({ mode: 'turn' }), 'rotate');
  assert.equal(dragMeaning({ mode: 'move' }), 'pan');
  assert.equal(dragMeaning({ mode: 'turn', shift: true }), 'pan');
  assert.equal(dragMeaning({ mode: 'move', shift: true }), 'rotate');
  for (const mode of ['turn', 'move']) {
    assert.equal(dragMeaning({ mode, button: 1 }), 'pan', 'middle button');
    assert.equal(dragMeaning({ mode, button: 2 }), 'pan', 'right button');
  }
  // a finger or pen has no buttons and no Shift key: only the mode counts
  assert.equal(dragMeaning({ mode: 'turn', pointerType: 'touch', shift: true, button: 2 }), 'rotate');
  assert.equal(dragMeaning({ mode: 'move', pointerType: 'touch' }), 'pan');
  assert.equal(dragMeaning({ mode: 'move', pointerType: 'pen', shift: true }), 'pan');
});

// --------------------------------------------------------- page structure

test('graph page: one browser, the old List view button and long list are gone, and a plain list closes at the foot', () => {
  const { read } = built(TWO());
  const page = read('graph/index.html');
  assert.ok(!page.includes('gp-listlink') && !page.includes('List view'), 'the List view button is gone');
  assert.ok(!page.includes('The graph as a list'));
  assert.match(page, /<aside class="browse" id="browse"[^>]*hidden>/);
  assert.match(page, /<details class="plain" id="plain">\s*<summary id="plain-h">Plain list of everything<\/summary>/);
  assert.match(page, /data-mode="turn"[^>]*aria-pressed="true"/);
  assert.match(page, /data-act="zoom-in"/);
  assert.match(page, /data-act="zoom-out"/);
  assert.match(page, /data-act="home"/);
  assert.match(page, /<nav class="nodelist" id="nodelist"/);
});

test('the plain list: each POV once under its main topic, topics collapsed, other topics as chips', () => {
  const { read } = built(TWO());
  const page = read('graph/index.html');
  assert.equal((page.match(/data-node="p:alpha"/g) ?? []).length, 1);
  assert.equal((page.match(/data-node="p:beta"/g) ?? []).length, 1, 'beta lists two topics but appears once');
  assert.match(page, /<details class="pl-topic"[^>]*>\s*<summary>/);
  assert.ok(!/<details class="pl-topic"[^>]* open/.test(page), 'topics start collapsed');
  assert.match(page, /class="chip-s"/);
});

test('stylesheet: a bare .status rule cannot give the Draft and Agreed chips form margins (the old clash)', () => {
  const css = readFileSync(join(repo, 'site/styles.css'), 'utf8');
  const bare = css.split('\n').filter((l) => /^\.status\s*[,{]/.test(l.trim()));
  for (const l of bare) assert.ok(!/margin|min-height/.test(l), `a bare .status rule sets spacing: ${l}`);
  assert.match(css, /\.form-status\s*\{/);
  assert.match(readFileSync(join(repo, 'site/add/index.html'), 'utf8'), /class="form-status"/);
});
