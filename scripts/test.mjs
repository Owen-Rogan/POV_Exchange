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
  topics: '[agents]',
  author: 'Test Author',
  date: '2026-11-06',
};

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

test('a listed document is copied and linked', () => {
  const root = fixture({ 'doc-pov': { ...pov('Body.', { documents: '[notes.txt]' }), 'notes.txt': 'plain notes\n' } });
  const r = run(root);
  assert.equal(r.code, 0, r.all);
  assert.equal(readFileSync(join(root, 'dist/docs/doc-pov/notes.txt'), 'utf8'), 'plain notes\n');
  assert.match(readFileSync(join(root, 'dist/pov/doc-pov/index.html'), 'utf8'), /href="\.\.\/\.\.\/docs\/doc-pov\/notes\.txt"/);
});

test('a document-type entry with no body is allowed', () => {
  const root = fixture({ 'deck-only': { 'pov.md': fm({ type: 'document', documents: '[deck.pdf]' }), 'deck.pdf': '%PDF-1.4 fake' } });
  assert.equal(run(root).code, 0);
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

fails('listed document missing from the folder', () => fixture({ p: pov('x', { documents: '[gone.pdf]' }) }), /listed document is not in the folder/);

fails('disallowed document type', () => fixture({ p: { ...pov('x', { documents: '[run.exe]' }), 'run.exe': 'MZ' } }), /file type that is not allowed/);

fails('file in the folder that is not listed', () => fixture({ p: { ...pov(), 'extra.pdf': 'x' } }), /not listed under documents/);

fails('document name with a path in it', () => fixture({ p: pov('x', { documents: '[../topics.json]' }) }), /characters that are not allowed/);

fails('document over 20 MB', () => fixture({ p: { ...pov('x', { documents: '[big.pdf]' }), 'big.pdf': Buffer.alloc(20 * 1024 * 1024 + 1) } }), /is larger than 20 MB/);

fails('email inside a text document', () => fixture({ p: { ...pov('x', { documents: '[n.txt]' }), 'n.txt': `mail ${EMAIL}` } }), /povs\/p\/n\.txt:1: contains an email address/, { mustNotEcho: [EMAIL] });

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
  assert.match(home, /<a class="preview" href="graph\/"[^>]*><svg class="preview-svg"[^>]*aria-hidden="true"/);
  assert.ok(!home.includes('<canvas'), 'the library must not start the 3D graph');
  // by topic: alpha under 1 topic, beta under 2 = 3 cards; newest first: each once = 2 cards
  assert.equal((home.match(/class="card reveal[^"]*"/g) ?? []).length, 5);
  assert.match(home, /<section class="newest" id="newest"[^>]*hidden>/);
  assert.match(home, /class="tile reveal" data-topic="agents"/);
  assert.match(home, /href="graph\/#t=agents"/);
  assert.match(home, /<noscript>/);
  assert.match(home, /data-stat="povs" data-all="2" data-real="2"[^>]*>2 POVs<\/span>/);
  assert.match(home, /data-stat="topics"[^>]*>2 topics<\/span>/);
});

test('a POV page has a where-this-sits map with links, and related links', () => {
  const { read } = built(TWO());
  const page = read('pov/alpha/index.html');
  assert.match(page, /<svg class="minimap-svg"[^>]*role="group"/);
  assert.match(page, /<a href="\.\.\/beta\/"><title>Beta POV<\/title>/);
  assert.match(page, /<a href="\.\.\/\.\.\/#topic-agents">/);
  assert.match(page, /<h2 id="rel-h">Related<\/h2>/);
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
    assert.ok(Math.hypot(n.x, n.y, n.z) <= 100.01, `${n.id} is outside the layout radius`);
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
  const root = sampleFixture({}, { fake: { ...pov('x', { documents: '[n.txt]' }), 'n.txt': 'notes' } });
  assert.equal(run(root).code, 0);
  const g = JSON.parse(readFileSync(join(root, 'dist/data/graph.json'), 'utf8'));
  const doc = g.nodes.find((n) => n.kind === 'doc');
  assert.equal(doc.date, '2026-11-06');
  assert.equal(doc.sample, true);
  assert.ok(readFileSync(join(root, 'dist/docs/fake/n.txt'), 'utf8') === 'notes');
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
  const root = sampleFixture({ real: pov('Body.') }, { fake: { ...pov('x', { documents: '[n.txt]' }), 'n.txt': 'n' } });
  assert.equal(run(root).code, 0);
  const html = readFileSync(join(root, 'dist/graph/index.html'), 'utf8');
  assert.match(html, /href="\.\.\/styles\.css"/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(html, /class="gp" data-tier="static"/);
  assert.match(html, /data-node="p:real"/);
  assert.match(html, /data-node="p:fake"/);
  assert.match(html, /data-node="d:fake\/n\.txt"/);
  assert.match(html, /href="\.\.\/pov\/fake\/"/);
  assert.match(html, /href="\.\.\/docs\/fake\/n\.txt"/);
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
