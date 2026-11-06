// Build tests. Each case writes a throwaway repo layout to a temp folder, runs
// scripts/build.mjs against it with --root, and checks the exit code and the
// messages. Run with:  node --test scripts/test.mjs   (Node 22+, no install)

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

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

fails('site/index.html without the content marker', () => {
  const root = fixture({ p: pov() });
  writeFileSync(join(root, 'site/index.html'), '<html></html>');
  return root;
}, /must contain the <!-- build:content --> marker/);

test('a failed build leaves no dist/ behind from this run', () => {
  const root = fixture({ p: pov('x', { topics: '[nope]' }) });
  assert.equal(run(root).code, 1);
  assert.throws(() => readFileSync(join(root, 'dist/index.html')));
});
